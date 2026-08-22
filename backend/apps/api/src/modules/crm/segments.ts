// Customer segmentation — recency/frequency/spend rules.
// Lapsed thresholds are configurable (30/45/60/90 days) via Settings.

import { PrismaClient } from "@prisma/client";

export interface SegmentConfig {
  lapsedDays: number; // e.g. 60
  atRiskDays: number; // e.g. 45
  vipMinSpentMinor: number; // e.g. 2000000 (₹20,000)
  highSpendMinShare?: number; // reserved
  repeatMinVisits: number; // e.g. 2
}

export const DEFAULT_SEGMENT_CONFIG: SegmentConfig = {
  lapsedDays: 60,
  atRiskDays: 45,
  vipMinSpentMinor: 2_000_000,
  repeatMinVisits: 2,
};

export function classify(
  c: { visitCount: number; totalSpent: number; lastVisitAt: Date | null; hasActiveMembership: boolean },
  cfg: SegmentConfig,
  now: Date,
): string[] {
  const segs: string[] = [];
  const daysSince = c.lastVisitAt
    ? Math.floor((now.getTime() - c.lastVisitAt.getTime()) / 86_400_000)
    : Infinity;

  if (c.visitCount <= 1) segs.push("NEW");
  if (c.visitCount >= cfg.repeatMinVisits) segs.push("REPEAT");
  if (c.hasActiveMembership) segs.push("MEMBER");
  if (c.totalSpent >= cfg.vipMinSpentMinor) segs.push("VIP", "HIGH_SPEND");

  if (daysSince >= cfg.lapsedDays) segs.push("LAPSED");
  else if (daysSince >= cfg.atRiskDays) segs.push("AT_RISK");

  return Array.from(new Set(segs));
}

/** Return customers in a segment for follow-up queues / campaigns. */
export async function customersInSegment(
  db: PrismaClient,
  branchId: string,
  segment: string,
  cfg: SegmentConfig,
  now: Date,
): Promise<string[]> {
  const customers = await db.customer.findMany({
    where: { branchId, deletedAt: null },
    select: {
      id: true,
      visitCount: true,
      totalSpent: true,
      lastVisitAt: true,
      memberships: { where: { isActive: true }, select: { id: true } },
    },
  });
  return customers
    .filter((c) =>
      classify(
        {
          visitCount: c.visitCount,
          totalSpent: c.totalSpent,
          lastVisitAt: c.lastVisitAt,
          hasActiveMembership: c.memberships.length > 0,
        },
        cfg,
        now,
      ).includes(segment),
    )
    .map((c) => c.id);
}
