// Package & membership expiry + renewal automation.
//
// Idempotent and append-only: expiring a membership posts an EXPIRE ledger
// entry zeroing the balance; expiring a package posts EXPIRE entries for each
// service's remaining quantity. Renewal/low-balance reminders are deduped per
// membership per day so re-running the job never double-sends.

import { PrismaClient } from "@prisma/client";
import { enqueueEmail } from "@cutz/queue";
import { expire as expireMembership } from "../modules/memberships/ledger.js";

export interface ExpiryResult {
  membershipsExpired: number;
  packagesExpired: number;
  renewalRemindersQueued: number;
}

export async function runExpiryAndRenewals(
  db: PrismaClient,
  now = new Date(),
  opts: { lowBalanceMinor?: number; renewWithinDays?: number } = {},
): Promise<ExpiryResult> {
  const lowBalanceMinor = opts.lowBalanceMinor ?? 50_000; // ₹500
  const renewWithinDays = opts.renewWithinDays ?? 7;
  let membershipsExpired = 0;
  let packagesExpired = 0;
  let renewalRemindersQueued = 0;

  // 1. Expire memberships past their validity.
  const expiredM = await db.membership.findMany({
    where: { isActive: true, expiresAt: { not: null, lt: now } },
    select: { id: true },
  });
  for (const m of expiredM) {
    await db.$transaction(async (tx) => {
      await expireMembership(tx, m.id, "validity_elapsed");
      await tx.membership.update({ where: { id: m.id }, data: { isActive: false } });
    });
    membershipsExpired++;
  }

  // 2. Expire prepaid service packages past validity (forfeit remaining qty).
  const expiredP = await db.customerServicePackage.findMany({
    where: { isActive: true, expiresAt: { not: null, lt: now } },
    select: { id: true },
  });
  for (const p of expiredP) {
    await db.$transaction(async (tx) => {
      const byService = await tx.servicePackageLedger.groupBy({
        by: ["serviceId"],
        where: { customerServicePackageId: p.id },
        _sum: { qtyDelta: true },
      });
      for (const g of byService) {
        const remaining = g._sum.qtyDelta ?? 0;
        if (remaining > 0) {
          await tx.servicePackageLedger.create({
            data: {
              customerServicePackageId: p.id,
              serviceId: g.serviceId,
              type: "EXPIRE",
              qtyDelta: -remaining,
              balanceAfter: 0,
              reason: "validity_elapsed",
            },
          });
        }
      }
      await tx.customerServicePackage.update({ where: { id: p.id }, data: { isActive: false } });
    });
    packagesExpired++;
  }

  // 3. Renewal / low-balance reminders (deduped per membership per day).
  const soon = new Date(now.getTime() + renewWithinDays * 86_400_000);
  const renewCandidates = await db.membership.findMany({
    where: {
      isActive: true,
      OR: [
        { balanceMinor: { lte: lowBalanceMinor, gt: 0 } },
        { expiresAt: { not: null, lte: soon, gte: now } },
      ],
    },
    include: { customer: { select: { name: true, email: true, branchId: true } }, plan: { select: { name: true } } },
  });
  const dayKey = now.toISOString().slice(0, 10);
  for (const m of renewCandidates) {
    if (!m.customer.email) continue;
    const expLine = m.expiresAt ? ` and it expires on ${m.expiresAt.toLocaleDateString("en-IN")}` : "";
    await enqueueEmail({
      branchId: m.customer.branchId,
      to: m.customer.email,
      subject: `Your ${m.plan.name} membership`,
      html: `<p>Hi ${m.customer.name}, your membership balance is ₹${Math.round(m.balanceMinor / 100)}${expLine}. Top up or renew to keep your benefits.</p>`,
      dedupeKey: `renew:${m.id}:${dayKey}`,
    });
    renewalRemindersQueued++;
  }

  return { membershipsExpired, packagesExpired, renewalRemindersQueued };
}
