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

const marketingProgrammesSchema = z.object({
  loyaltyPoints: z.boolean().optional(),
  stampCards: z.boolean().optional(),
  referrals: z.boolean().optional(),
  spinWin: z.boolean().optional(),
  scratchWin: z.boolean().optional(),
}).passthrough();

const marketingSettingsSchema = z.object({
  programmes: marketingProgrammesSchema.default({}),
  maxRewardsPerDay: z.number().int().min(1).max(500).default(50),
}).passthrough();

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

export async function applyMarketingRewardBonuses(
  tx: Prisma.TransactionClient,
  input: {
    branchId: string;
    invoiceId: string;
    customerId: string;
    eligibleMinor: number;
    actorUserId?: string;
  },
) {
  const row = await tx.setting.findUnique({ where: { key: `branch:${input.branchId}:marketing` } });
  const parsed = marketingSettingsSchema.safeParse(row?.value ?? {});
  const settings = parsed.success ? parsed.data : marketingSettingsSchema.parse({});
  const programmes = settings.programmes;
  const rewards: Array<{ reason: string; points: number }> = [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const issuedToday = await tx.loyaltyLedger.count({
    where: {
      customer: { branchId: input.branchId },
      type: "ADJUST",
      deltaPoints: { gt: 0 },
      reason: { startsWith: "Marketing reward:" },
      createdAt: { gte: today },
    },
  });
  let remainingDailyBudget = Math.max(0, settings.maxRewardsPerDay - issuedToday);
  const enqueueReward = (reason: string, points: number) => {
    if (points <= 0 || remainingDailyBudget <= 0) return;
    rewards.push({ reason, points });
    remainingDailyBudget -= 1;
  };

  if (programmes.stampCards) {
    const paidVisits = await tx.invoice.count({
      where: { branchId: input.branchId, customerId: input.customerId, status: "PAID" },
    });
    if (paidVisits > 0 && paidVisits % 5 === 0) {
      enqueueReward("Marketing reward: digital stamp card milestone", 25);
    }
  }

  if (programmes.referrals) {
    const [customer, paidVisits] = await Promise.all([
      tx.customer.findUnique({
        where: { id: input.customerId },
        select: { source: true, referralName: true, referralPhone: true },
      }),
      tx.invoice.count({
        where: { branchId: input.branchId, customerId: input.customerId, status: "PAID" },
      }),
    ]);
    if (paidVisits === 1 && customer?.source === "referral" && customer.referralName) {
      enqueueReward(`Marketing reward: referral welcome via ${customer.referralName}`, 50);
      const normalizedReferralPhone = customer.referralPhone?.replace(/\D/gu, "");
      if (normalizedReferralPhone) {
        const referrer = await tx.customer.findFirst({
          where: { branchId: input.branchId, phone: normalizedReferralPhone, deletedAt: null },
          select: { id: true },
        });
        if (referrer && referrer.id !== input.customerId) {
          const existing = await tx.loyaltyLedger.findFirst({
            where: {
              invoiceId: input.invoiceId,
              customerId: referrer.id,
              type: "ADJUST",
              reason: "Marketing reward: referral successful",
            },
          });
          if (!existing) {
            await postLoyaltyEntry(tx, {
              customerId: referrer.id,
              type: "ADJUST",
              deltaPoints: 100,
              invoiceId: input.invoiceId,
              reason: "Marketing reward: referral successful",
              actorUserId: input.actorUserId,
            });
          }
        }
      }
    }
  }

  let points = 0;
  let balanceAfter: number | null = null;
  for (const reward of rewards) {
    const existing = await tx.loyaltyLedger.findFirst({
      where: {
        invoiceId: input.invoiceId,
        customerId: input.customerId,
        type: "ADJUST",
        reason: reward.reason,
      },
      select: { deltaPoints: true, balanceAfter: true },
    });
    if (existing) {
      points += existing.deltaPoints;
      balanceAfter = existing.balanceAfter;
      continue;
    }
    const posted = await postLoyaltyEntry(tx, {
      customerId: input.customerId,
      type: "ADJUST",
      deltaPoints: reward.points,
      invoiceId: input.invoiceId,
      reason: reward.reason,
      actorUserId: input.actorUserId,
    });
    points += reward.points;
    balanceAfter = posted.balanceAfter;
  }
  return { points, balanceAfter };
}
