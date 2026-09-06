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
  coupons: z.boolean().optional(),
  birthday: z.boolean().optional(),
  winBack: z.boolean().optional(),
  festival: z.boolean().optional(),
  happyHours: z.boolean().optional(),
  membershipOffers: z.boolean().optional(),
  whatsappAutomation: z.boolean().optional(),
}).passthrough();

const seasonalWindowSchema = z.object({
  name: z.string().trim().min(1).max(80),
  start: z.string().regex(/^\d{2}-\d{2}$/u),
  end: z.string().regex(/^\d{2}-\d{2}$/u),
  points: z.number().int().min(0).max(100_000).optional(),
});

const marketingRewardRulesSchema = z.object({
  stampEveryVisits: z.number().int().min(2).max(50).default(5),
  stampMinInvoiceMinor: z.number().int().min(0).max(10_000_000).default(100_000),
  stampRewardDiscountPercent: z.number().int().min(1).max(100).default(50),
  stampRewardMaxServiceMinor: z.number().int().min(0).max(10_000_000).default(100_000),
  stampRewardPoints: z.number().int().min(0).max(100_000).default(500),
  referralWelcomePoints: z.number().int().min(0).max(100_000).default(50),
  referralReferrerPoints: z.number().int().min(0).max(100_000).default(100),
  birthdayRewardPoints: z.number().int().min(0).max(100_000).default(75),
  spinChancePercent: z.number().int().min(1).max(100).default(12),
  spinRewardPoints: z.number().int().min(0).max(100_000).default(15),
  spinPrizeLabels: z.array(z.string().trim().min(1).max(40)).min(2).max(12).default([
    "₹10",
    "₹20",
    "₹50",
    "Chocolate",
    "Better luck",
    "Try again",
    "VIP treat",
    "₹100",
  ]),
  scratchEveryVisits: z.number().int().min(2).max(50).default(5),
  scratchChancePercent: z.number().int().min(1).max(100).default(2),
  scratchRewardPoints: z.number().int().min(0).max(100_000).default(20),
  happyHoursRewardPoints: z.number().int().min(0).max(100_000).default(10),
  happyHoursDaysOfWeek: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
  happyHoursStartHour: z.number().int().min(0).max(23).default(12),
  happyHoursEndHour: z.number().int().min(1).max(24).default(17),
  festivalRewardPoints: z.number().int().min(0).max(100_000).default(30),
  festivalWindows: z.array(seasonalWindowSchema).default([
    { name: "Diwali season", start: "10-01", end: "11-15" },
    { name: "New Year season", start: "12-20", end: "01-05" },
    { name: "Wedding season", start: "11-01", end: "02-28" },
    { name: "Holi season", start: "03-01", end: "03-15" },
  ]),
});

export const marketingSettingsSchema = z.object({
  programmes: marketingProgrammesSchema.default({}),
  monthlyBudgetMinor: z.number().int().min(0).max(100_000_000).default(1_000_000),
  maxRewardsPerDay: z.number().int().min(1).max(500).default(50),
  rewardRules: marketingRewardRulesSchema.default({}),
}).passthrough();

export type MarketingSettings = z.infer<typeof marketingSettingsSchema>;
export const DEFAULT_MARKETING_SETTINGS: MarketingSettings = marketingSettingsSchema.parse({});

export function calculateStampRewardPoints(
  rewardRules: MarketingSettings["rewardRules"],
  loyaltyRules: LoyaltyRules,
): number {
  const configuredPoints = Math.max(0, Math.round(rewardRules.stampRewardPoints));
  const rewardValueMinor = Math.round((rewardRules.stampRewardMaxServiceMinor * rewardRules.stampRewardDiscountPercent) / 100);
  const pointsForDiscountValue = loyaltyRules.redeemMinorPerPoint > 0
    ? Math.ceil(rewardValueMinor / loyaltyRules.redeemMinorPerPoint)
    : 0;
  return Math.max(configuredPoints, pointsForDiscountValue);
}

export function parseLoyaltyRules(value: unknown): LoyaltyRules {
  const parsed = loyaltyRulesSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_LOYALTY_RULES;
}

export function parseMarketingSettings(value: unknown): MarketingSettings {
  const parsed = marketingSettingsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : DEFAULT_MARKETING_SETTINGS;
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
  if (input.eligibleMinor <= 0) return { points: 0, balanceAfter: null };
  const row = await tx.setting.findUnique({ where: { key: `branch:${input.branchId}:marketing` } });
  const settings = parseMarketingSettings(row?.value);
  const programmes = settings.programmes;
  const rewardRules = settings.rewardRules;
  const rewards: Array<{ reason: string; points: number; oncePerCustomer?: boolean; customerId?: string }> = [];

  const [branch, loyaltyRules] = await Promise.all([
    tx.branch.findUnique({ where: { id: input.branchId }, select: { timezone: true } }),
    getLoyaltyRules(tx, input.branchId),
  ]);
  const localNow = getBranchLocalParts(new Date(), branch?.timezone ?? "Asia/Kolkata");
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const monthStart = new Date(Date.UTC(localNow.year, localNow.month - 1, 1));
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
  const issuedThisMonth = await tx.loyaltyLedger.aggregate({
    _sum: { deltaPoints: true },
    where: {
      customer: { branchId: input.branchId },
      type: "ADJUST",
      deltaPoints: { gt: 0 },
      reason: { startsWith: "Marketing reward:" },
      createdAt: { gte: monthStart },
    },
  });
  let remainingMonthlyBudgetMinor = settings.monthlyBudgetMinor > 0
    ? Math.max(0, settings.monthlyBudgetMinor - ((issuedThisMonth._sum.deltaPoints ?? 0) * loyaltyRules.redeemMinorPerPoint))
    : Number.POSITIVE_INFINITY;
  const enqueueReward = (reason: string, points: number, options: { oncePerCustomer?: boolean; customerId?: string } = {}) => {
    const estimatedCostMinor = points * loyaltyRules.redeemMinorPerPoint;
    if (points <= 0 || remainingDailyBudget <= 0 || estimatedCostMinor > remainingMonthlyBudgetMinor) return;
    rewards.push({ reason, points, ...options });
    remainingDailyBudget -= 1;
    remainingMonthlyBudgetMinor -= estimatedCostMinor;
  };

  if (programmes.stampCards) {
    const paidVisits = await tx.invoice.count({
      where: {
        branchId: input.branchId,
        customerId: input.customerId,
        status: "PAID",
        totalMinor: { gte: rewardRules.stampMinInvoiceMinor },
      },
    });
    if (paidVisits > 0 && paidVisits % rewardRules.stampEveryVisits === 0) {
      enqueueReward(
        `Marketing reward: digital stamp card ${rewardRules.stampRewardDiscountPercent}% off up to ₹${Math.round(rewardRules.stampRewardMaxServiceMinor / 100).toLocaleString("en-IN")} after ${paidVisits} qualifying bills`,
        calculateStampRewardPoints(rewardRules, loyaltyRules),
      );
    }
  }

  const [customer, paidVisits] = await Promise.all([
    tx.customer.findUnique({
      where: { id: input.customerId },
      select: { source: true, referralName: true, referralPhone: true, tags: true },
    }),
    tx.invoice.count({
      where: { branchId: input.branchId, customerId: input.customerId, status: "PAID" },
    }),
  ]);

  if (programmes.referrals) {
    if (paidVisits === 1 && customer?.source === "referral" && customer.referralName) {
      enqueueReward(`Marketing reward: referral welcome via ${customer.referralName}`, rewardRules.referralWelcomePoints);
      const normalizedReferralPhone = customer.referralPhone?.replace(/\D/gu, "");
      if (normalizedReferralPhone) {
        const referrer = await tx.customer.findFirst({
          where: { branchId: input.branchId, phone: normalizedReferralPhone, deletedAt: null },
          select: { id: true },
        });
        if (referrer && referrer.id !== input.customerId) {
          enqueueReward("Marketing reward: referral successful", rewardRules.referralReferrerPoints, {
            customerId: referrer.id,
          });
        }
      }
    }
  }

  if (programmes.birthday && customer?.tags?.length) {
    const birthday = extractBirthdayMonthDay(customer.tags);
    if (birthday && birthday.month === localNow.month && birthday.day === localNow.day) {
      enqueueReward(`Marketing reward: birthday offer ${localNow.year}`, rewardRules.birthdayRewardPoints, {
        oncePerCustomer: true,
      });
    }
  }

  // Spin & Scratch are customer-portal draws now: first paid invoice unlocks
  // them, and /portal/customer/rewards/:kind/play enforces one safe attempt per
  // customer per branch day. Keeping invoice settlement out of these draws
  // prevents refreshes/payment callbacks from silently adding surprise points.

  if (programmes.happyHours && rewardRules.happyHoursDaysOfWeek.includes(localNow.weekday)) {
    const startHour = Math.min(rewardRules.happyHoursStartHour, rewardRules.happyHoursEndHour - 1);
    const endHour = Math.max(rewardRules.happyHoursEndHour, startHour + 1);
    if (localNow.hour >= startHour && localNow.hour < endHour) {
      enqueueReward(
        `Marketing reward: happy hours ${localNow.dateKey} ${startHour}:00-${endHour}:00`,
        rewardRules.happyHoursRewardPoints,
      );
    }
  }

  if (programmes.festival) {
    const activeFestival = rewardRules.festivalWindows.find((window) => isDateInsideSeason(localNow.month, localNow.day, window.start, window.end));
    if (activeFestival) {
      enqueueReward(
        `Marketing reward: festival campaign ${activeFestival.name} ${localNow.year}`,
        activeFestival.points ?? rewardRules.festivalRewardPoints,
        { oncePerCustomer: true },
      );
    }
  }

  let points = 0;
  let balanceAfter: number | null = null;
  for (const reward of rewards) {
    const rewardCustomerId = reward.customerId ?? input.customerId;
    const duplicateWhere = reward.oncePerCustomer
      ? {
          customerId: rewardCustomerId,
          type: "ADJUST" as const,
          reason: reward.reason,
        }
      : {
          invoiceId: input.invoiceId,
          customerId: rewardCustomerId,
          type: "ADJUST" as const,
          reason: reward.reason,
        };
    const existing = await tx.loyaltyLedger.findFirst({
      where: duplicateWhere,
      select: { deltaPoints: true, balanceAfter: true },
    });
    if (existing) {
      if (rewardCustomerId === input.customerId) {
        points += existing.deltaPoints;
        balanceAfter = existing.balanceAfter;
      }
      continue;
    }
    const posted = await postLoyaltyEntry(tx, {
      customerId: rewardCustomerId,
      type: "ADJUST",
      deltaPoints: reward.points,
      invoiceId: input.invoiceId,
      reason: reward.reason,
      actorUserId: input.actorUserId,
    });
    if (rewardCustomerId === input.customerId) {
      points += reward.points;
      balanceAfter = posted.balanceAfter;
    }
  }
  return { points, balanceAfter };
}

function deterministicPercent(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (Math.abs(hash) % 100) + 1;
}

function extractBirthdayMonthDay(tags: string[]): { month: number; day: number } | null {
  for (const rawTag of tags) {
    const tag = rawTag.trim().toLowerCase();
    const iso = tag.match(/^(?:dob|birthday|bday)[:=\s]+(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/u);
    if (iso) return normalMonthDay(Number(iso[2]), Number(iso[3]));
    const monthDay = tag.match(/^(?:birthday|bday)[:=\s]+(\d{1,2})[-/](\d{1,2})$/u);
    if (monthDay) return normalMonthDay(Number(monthDay[1]), Number(monthDay[2]));
  }
  return null;
}

function normalMonthDay(month: number, day: number): { month: number; day: number } | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { month, day };
}

function getBranchLocalParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const year = Number(pick("year"));
  const month = Number(pick("month"));
  const day = Number(pick("day"));
  return {
    year,
    month,
    day,
    weekday: weekdayMap[pick("weekday")] ?? date.getUTCDay(),
    hour: Number(pick("hour")),
    dateKey: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

function isDateInsideSeason(month: number, day: number, start: string, end: string): boolean {
  const current = month * 100 + day;
  const startValue = monthDayNumber(start);
  const endValue = monthDayNumber(end);
  if (!startValue || !endValue) return false;
  return startValue <= endValue
    ? current >= startValue && current <= endValue
    : current >= startValue || current <= endValue;
}

function monthDayNumber(value: string): number | null {
  const [monthRaw, dayRaw] = value.split("-");
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return month * 100 + day;
}
