// Membership credit engine — append-only ledger.
//
// Balance is ALWAYS the sum of ledger deltas. The `Membership.balanceMinor`
// column is a denormalized cache updated in the same transaction as the ledger
// row, and `balanceAfter` on each row is a running snapshot for audit. Rows are
// never updated or deleted — corrections are new ADJUST entries.

import { PrismaClient, Prisma, LedgerEntryType } from "@prisma/client";

export class InsufficientCreditError extends Error {
  constructor(public balanceMinor: number, public requestedMinor: number) {
    super(`Insufficient membership credit: have ${balanceMinor}, need ${requestedMinor}`);
  }
}

type Tx = Prisma.TransactionClient;

/** Post a ledger entry and update the cached balance atomically. */
async function post(
  tx: Tx,
  membershipId: string,
  type: LedgerEntryType,
  deltaMinor: number,
  opts: { invoiceId?: string; reason?: string; actorUserId?: string } = {},
): Promise<number> {
  const m = await tx.membership.findUnique({ where: { id: membershipId } });
  if (!m) throw new Error("membership_not_found");
  const balanceAfter = m.balanceMinor + deltaMinor;
  if (balanceAfter < 0) throw new InsufficientCreditError(m.balanceMinor, -deltaMinor);

  await tx.membershipLedger.create({
    data: {
      membershipId,
      type,
      deltaMinor,
      balanceAfter,
      invoiceId: opts.invoiceId,
      reason: opts.reason,
      actorUserId: opts.actorUserId,
    },
  });
  await tx.membership.update({
    where: { id: membershipId },
    data: { balanceMinor: balanceAfter },
  });
  return balanceAfter;
}

/** Grant credit when a membership is created or topped up. */
export function grant(tx: Tx, membershipId: string, amountMinor: number, actorUserId?: string) {
  return post(tx, membershipId, "CREDIT", Math.abs(amountMinor), {
    reason: "grant",
    actorUserId,
  });
}

/** Redeem credit against an invoice. Throws if balance is insufficient. */
export function redeem(
  tx: Tx,
  membershipId: string,
  amountMinor: number,
  invoiceId: string,
  actorUserId?: string,
) {
  return post(tx, membershipId, "REDEEM", -Math.abs(amountMinor), {
    invoiceId,
    reason: "redeem",
    actorUserId,
  });
}

/** Permissioned manual correction — always audited by the caller. */
export function adjust(tx: Tx, membershipId: string, deltaMinor: number, reason: string, actorUserId: string) {
  return post(tx, membershipId, "ADJUST", deltaMinor, { reason, actorUserId });
}

/** Restore credit when an invoice that redeemed membership credit is refunded. */
export function refund(tx: Tx, membershipId: string, amountMinor: number, invoiceId?: string, actorUserId?: string) {
  return post(tx, membershipId, "REFUND", Math.abs(amountMinor), { invoiceId, reason: "refund", actorUserId });
}

/** Expire a membership: zero the balance with an EXPIRE ledger entry. Idempotent
 * (no-op when the balance is already zero). */
export async function expire(tx: Tx, membershipId: string, reason = "validity_elapsed"): Promise<number> {
  const m = await tx.membership.findUnique({ where: { id: membershipId } });
  if (!m || m.balanceMinor === 0) return 0;
  const zeroed = m.balanceMinor;
  await post(tx, membershipId, "EXPIRE", -m.balanceMinor, { reason });
  return zeroed;
}

/**
 * Verification helper (used by tests and reconciliation): recompute balance
 * straight from the ledger and compare to the cached column.
 */
export async function verifyBalance(db: PrismaClient, membershipId: string): Promise<{ ok: boolean; cached: number; computed: number }> {
  const agg = await db.membershipLedger.aggregate({
    where: { membershipId },
    _sum: { deltaMinor: true },
  });
  const computed = agg._sum.deltaMinor ?? 0;
  const m = await db.membership.findUnique({ where: { id: membershipId } });
  const cached = m?.balanceMinor ?? 0;
  return { ok: cached === computed, cached, computed };
}
