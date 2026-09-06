import { FastifyInstance } from "fastify";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { prisma } from "@cutz/db";
import { authorize } from "../../plugins/auth.js";
import { audit } from "../../lib/audit.js";
import { getLoyaltyRules, parseMarketingSettings, postLoyaltyEntry } from "./ledger.js";

const STAFF = ["OWNER", "ADMIN", "MANAGER", "RECEPTION", "STAFF"] as const;
const rewardKindSchema = z.object({ kind: z.enum(["spin", "scratch"]) });
const rewardAttemptSchema = z.object({
  kind: z.enum(["spin", "scratch"]),
  attempted: z.boolean(),
  won: z.boolean(),
  points: z.number().int(),
  prizeLabel: z.string().optional(),
  balanceAfter: z.number().int(),
  message: z.string(),
  roll: z.number().int().min(1).max(100),
  chancePercent: z.number().int().min(1).max(100),
  dateKey: z.string(),
  nextAvailableAt: z.string(),
  createdAt: z.string(),
});

function branchDateKey(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

function nextBranchDayIso(dateKey: string) {
  const next = new Date(`${dateKey}T18:30:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

function spinPrizeLabel(labels: string[], roll: number, won: boolean) {
  const fallback = won ? "Lucky reward" : "Better luck";
  const clean = labels.map((label) => label.trim()).filter(Boolean);
  if (!clean.length) return fallback;
  const winningLabels = clean.filter((label) => !/better luck|try again|no prize/i.test(label));
  const pool = won && winningLabels.length ? winningLabels : clean;
  return pool[(roll - 1) % pool.length] ?? fallback;
}

export default async function loyaltyRoutes(app: FastifyInstance) {
  app.get("/loyalty/rules", { preHandler: authorize(...STAFF, "CUSTOMER") }, async (req, reply) => {
    const parsed = z.object({ branchId: z.string().optional() }).safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_query", details: parsed.error.flatten().fieldErrors });
    }
    const branchId = parsed.data.branchId ?? req.user?.branchId ?? "main";
    if (!["OWNER", "ADMIN", "CUSTOMER"].includes(req.user!.role) && req.user?.branchId !== branchId) {
      return reply.code(403).send({ error: "forbidden" });
    }
    return getLoyaltyRules(prisma, branchId);
  });

  app.post(
    "/portal/customer/rewards/:kind/play",
    { preHandler: authorize("CUSTOMER") },
    async (req, reply) => {
      const parsedParams = rewardKindSchema.safeParse(req.params);
      if (!parsedParams.success) {
        return reply.code(400).send({ error: "invalid_reward_kind" });
      }

      const customer = await prisma.customer.findFirst({
        where: { userId: req.user!.id, deletedAt: null },
        select: {
          id: true,
          branchId: true,
          loyaltyPoints: true,
          branch: { select: { timezone: true } },
        },
      });
      if (!customer) return reply.code(404).send({ error: "customer_profile_not_found" });

      const settingsRow = await prisma.setting.findUnique({ where: { key: `branch:${customer.branchId}:marketing` } });
      const settings = parseMarketingSettings(settingsRow?.value);
      const kind = parsedParams.data.kind;
      const enabled = kind === "spin"
        ? settings.programmes.spinWin !== false
        : settings.programmes.scratchWin !== false;
      if (!enabled) return reply.code(409).send({ error: `${kind}_disabled` });

      const paidInvoiceCount = await prisma.invoice.count({
        where: { customerId: customer.id, status: "PAID" },
      });
      if (paidInvoiceCount <= 0) {
        return reply.code(409).send({ error: "reward_locked_until_first_paid_invoice" });
      }

      const dateKey = branchDateKey(new Date(), customer.branch.timezone ?? "Asia/Kolkata");
      const attemptKey = `customer:${customer.id}:reward:${kind}:${dateKey}`;
      const existing = await prisma.setting.findUnique({ where: { key: attemptKey } });
      const parsedExisting = rewardAttemptSchema.safeParse(existing?.value);
      if (parsedExisting.success) return parsedExisting.data;

      const chancePercent = kind === "spin"
        ? settings.rewardRules.spinChancePercent
        : settings.rewardRules.scratchChancePercent;
      const points = kind === "spin"
        ? settings.rewardRules.spinRewardPoints
        : settings.rewardRules.scratchRewardPoints;
      const roll = randomInt(1, 101);
      const won = points > 0 && roll <= chancePercent;
      const prizeLabel = kind === "spin"
        ? spinPrizeLabel(settings.rewardRules.spinPrizeLabels, roll, won)
        : won ? `${points} loyalty points` : "Better luck";

      try {
        const result = await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${attemptKey})) IS NULL AS locked`;
          const concurrent = await tx.setting.findUnique({ where: { key: attemptKey } });
          const parsedConcurrent = rewardAttemptSchema.safeParse(concurrent?.value);
          if (parsedConcurrent.success) return parsedConcurrent.data;

          let balanceAfter = customer.loyaltyPoints;
          if (won) {
            const posted = await postLoyaltyEntry(tx, {
              customerId: customer.id,
              type: "ADJUST",
              deltaPoints: points,
              reason: `Marketing reward: customer portal ${kind} draw ${dateKey}`,
              actorUserId: req.user?.id,
            });
            balanceAfter = posted.balanceAfter;
          }

          const payload = {
            kind,
            attempted: true,
            won,
            points: won ? points : 0,
            prizeLabel,
            balanceAfter,
            message: won
              ? `Congratulations! You won ${prizeLabel}${points > 0 ? ` (+${points} loyalty points)` : ""}.`
              : "Better luck next time. One safe try is saved for today.",
            roll,
            chancePercent,
            dateKey,
            nextAvailableAt: nextBranchDayIso(dateKey),
            createdAt: new Date().toISOString(),
          };

          await tx.setting.upsert({
            where: { key: attemptKey },
            update: { value: payload },
            create: { key: attemptKey, value: payload },
          });
          return payload;
        });
        return reply.code(201).send(result);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "reward_draw_failed";
        return reply.code(422).send({ error: reason });
      }
    },
  );

  app.post(
    "/customers/:id/loyalty/adjust",
    { preHandler: authorize("OWNER", "ADMIN", "MANAGER") },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = z
        .object({
          deltaPoints: z.number().int().min(-1_000_000).max(1_000_000).refine((value) => value !== 0),
          reason: z.string().trim().min(3).max(240),
        })
        .parse(req.body);
      const customer = await prisma.customer.findFirst({ where: { id, deletedAt: null } });
      if (!customer) return reply.code(404).send({ error: "customer_not_found" });
      if (req.user?.role === "MANAGER" && req.user.branchId !== customer.branchId) {
        return reply.code(403).send({ error: "forbidden" });
      }
      try {
        const result = await prisma.$transaction(async (tx) => {
          const entry = await postLoyaltyEntry(tx, {
            customerId: id,
            type: "ADJUST",
            deltaPoints: body.deltaPoints,
            reason: body.reason,
            actorUserId: req.user?.id,
          });
          await audit("loyalty.adjust", "Customer", id, {
            actorUserId: req.user?.id,
            before: { loyaltyPoints: customer.loyaltyPoints },
            after: { loyaltyPoints: entry.balanceAfter, ...body },
            ip: req.ip,
          }, tx);
          return entry;
        });
        return reply.code(201).send(result);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "loyalty_adjustment_failed";
        return reply.code(reason === "insufficient_loyalty_points" ? 409 : 422).send({ error: reason });
      }
    },
  );
}
