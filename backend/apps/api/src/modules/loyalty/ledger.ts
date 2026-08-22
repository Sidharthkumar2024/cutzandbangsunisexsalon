import { LoyaltyLedgerType, Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";

export const loyaltyRulesSchema = z.object({
  enabled: z.boolean().default(true),
  welcomePoints: z.number().int().min(0).max(1_000_000).default(50),
  earnPoints: z.number().int().min(0).max(100_000).default(1),
  earnEveryMinor: z.number().int().positive().max(100_000_000).default(10_000),
  redeemMinorPerPoint: z.number().int().positive().max(1_000_000).default(100),
  minRedeemPoints: z.number().int().min(1).max(1_000_000).default(50),
});

export type LoyaltyRules = z.infer<typeof loyaltyRulesSchema>;

export const DEFAULT_LOYALTY_RULES: LoyaltyRules = loyaltyRulesSchema.parse({});

export function parseLoyaltyRules(value: unknown): LoyaltyRules {
  const parsed = loyaltyRulesSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_LOYALTY_RULES;
}

export async function getLoyaltyRules(
  db: PrismaClient | Prisma.TransactionClient,
  branchId: string,
): Promise<LoyaltyRules> {
  const row = await db.setting.findUnique({ where: { key: `branch:${branchId}:loyalty` } });
  return parseLoyaltyRules(row?.value);
}

export function calculateEarnedPoints(eligibleMinor: number, rules: LoyaltyRules): number {
  if (!rules.enabled || rules.earnPoints <= 0 || eligibleMinor <= 0) return 0;
  return Math.floor(eligibleMinor / rules.earnEveryMinor) * rules.earnPoints;
}

export function calculateRedemptionMinor(points: number, rules: LoyaltyRules): number {
  if (!rules.enabled || points <= 0) return 0;
  return points * rules.redeemMinorPerPoint;
}

export async function postLoyaltyEntry(
  tx: Prisma.TransactionClient,
  input: {
    customerId: string;
    type: LoyaltyLedgerType;
    deltaPoints: number;
    invoiceId?: string;
    reason: string;
    actorUserId?: string;
  },
) {
  if (!input.deltaPoints) throw new Error("loyalty_delta_required");
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`loyalty:${input.customerId}`})) IS NULL AS locked`;
  const customer = await tx.customer.findUnique({
    where: { id: input.customerId },
    select: { loyaltyPoints: true },
  });
  if (!customer) throw new Error("customer_not_found");
  const balanceAfter = customer.loyaltyPoints + input.deltaPoints;
  if (balanceAfter < 0) throw new Error("insufficient_loyalty_points");
  await tx.customer.update({
    where: { id: input.customerId },
    data: { loyaltyPoints: balanceAfter },
  });
  const ledger = await tx.loyaltyLedger.create({
    data: { ...input, balanceAfter },
  });
  return { ledger, balanceAfter };
}

export async function earnForPaidInvoice(
  tx: Prisma.TransactionClient,
  input: {
    invoiceId: string;
    customerId: string;
    eligibleMinor: number;
    rules: LoyaltyRules;
    actorUserId?: string;
  },
) {
  const existing = await tx.loyaltyLedger.findFirst({
    where: { invoiceId: input.invoiceId, type: "EARN" },
    select: { id: true, deltaPoints: true, balanceAfter: true },
  });
  if (existing) return { points: existing.deltaPoints, balanceAfter: existing.balanceAfter };
  const points = calculateEarnedPoints(input.eligibleMinor, input.rules);
  if (!points) return { points: 0, balanceAfter: null };
  const result = await postLoyaltyEntry(tx, {
    customerId: input.customerId,
    type: "EARN",
    deltaPoints: points,
    invoiceId: input.invoiceId,
    reason: "Points earned on paid invoice",
    actorUserId: input.actorUserId,
  });
  return { points, balanceAfter: result.balanceAfter };
}
