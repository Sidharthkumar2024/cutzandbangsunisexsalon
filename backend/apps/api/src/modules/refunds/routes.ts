// Returns & refunds.
//
// Refunds are append-only money movements plus immutable InvoiceRefund rows.
// The invoice row is locked while remaining quantities and tender balances are
// recomputed, preventing concurrent requests/retries from restoring value or
// stock more than once.

import { randomUUID } from "node:crypto";
import { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@cutz/db";
import { authorize } from "../../plugins/auth.js";
import { refund as refundMembership } from "../memberships/ledger.js";
import { getLoyaltyRules, postLoyaltyEntry } from "../loyalty/ledger.js";
import { audit } from "../../lib/audit.js";
import { allocateProportional } from "../../lib/money.js";
import {
  RefundAccountingError,
  allocateRemainingTenders,
  computeRefundLines,
  cumulativeEntitlementDelta,
} from "./accounting.js";

const refundSchema = z.object({
  items: z.array(z.object({ invoiceItemId: z.string(), qty: z.number().int().positive() })).min(1).max(100),
  method: z.enum(["CASH", "UPI", "CARD", "WALLET"]).default("CASH"),
  reason: z.string().min(2).max(500),
  restock: z.boolean().default(true),
});

class RefundRouteError extends Error {
  constructor(public readonly status: number, public readonly payload: Record<string, unknown>) {
    super(String(payload.error ?? "refund_failed"));
  }
}

function accountingStatus(error: RefundAccountingError): number {
  return error.code === "refund_exceeds_invoice" ? 409 : 400;
}

export default async function refundRoutes(app: FastifyInstance) {
  app.post(
    "/invoices/:id/refund",
    { preHandler: authorize("OWNER", "ADMIN", "MANAGER") },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = refundSchema.parse(req.body);

      let completed: {
        refundedMinor: number;
        moneyPortion: number;
        membershipPortion: number;
        pointsPortion: number;
        pointsToRestore: number;
        earnedClawback: number;
        restock: Array<{ productId: string; qty: number }>;
        status: string;
        refundId: string;
      };

      try {
        completed = await prisma.$transaction(
          async (tx) => {
            // Serialize every refund for this invoice before reading its
            // append-only refund history. Serializable isolation alone would
            // otherwise turn a concurrent retry into an opaque 500 conflict.
            const locked = await tx.$queryRaw<Array<{ id: string }>>`
              SELECT "id" FROM "Invoice" WHERE "id" = ${id} FOR UPDATE
            `;
            if (!locked.length) throw new RefundRouteError(404, { error: "not_found" });

            const inv = await tx.invoice.findUnique({
              where: { id },
              include: {
                items: true,
                payments: true,
                refunds: { include: { items: true } },
              },
            });
            if (!inv) throw new RefundRouteError(404, { error: "not_found" });
            if (!["OWNER", "ADMIN"].includes(req.user!.role) && req.user!.branchId !== inv.branchId) {
              throw new RefundRouteError(403, { error: "forbidden" });
            }
            if (["DRAFT", "VOID"].includes(inv.status)) {
              throw new RefundRouteError(409, { error: "invoice_not_refundable", status: inv.status });
            }
            if (inv.totalMinor <= 0) throw new RefundRouteError(409, { error: "nothing_to_refund" });

            const priorItems = inv.refunds.flatMap((refund) => refund.items.map((item) => ({
              invoiceItemId: item.invoiceItemId,
              qty: item.qty,
              amountMinor: item.amountMinor,
            })));
            const priced = computeRefundLines({
              invoiceTotalMinor: inv.totalMinor,
              lines: inv.items.map((item) => ({ id: item.id, qty: item.qty, lineTotalMinor: item.lineTotalMinor })),
              prior: priorItems,
              requested: body.items,
            });

            const rules = inv.customerId ? await getLoyaltyRules(tx, inv.branchId) : null;
            const membershipPaid = inv.payments
              .filter((payment) => payment.amountMinor > 0 && payment.method === "MEMBERSHIP_CREDIT")
              .reduce((sum, payment) => sum + payment.amountMinor, 0);
            const loyaltyPaid = inv.payments
              .filter((payment) => payment.amountMinor > 0 && payment.method === "LOYALTY_POINTS")
              .reduce((sum, payment) => sum + payment.amountMinor, 0);
            const moneyPaid = Math.max(0, inv.totalMinor - membershipPaid - loyaltyPaid);

            const recorded = inv.refunds.reduce((sum, refund) => ({
              gross: sum.gross + refund.grossMinor,
              money: sum.money + refund.moneyMinor,
              membership: sum.membership + refund.membershipMinor,
              loyalty: sum.loyalty + refund.loyaltyMinor,
              pointsRestored: sum.pointsRestored + refund.pointsRestored,
              pointsClawedBack: sum.pointsClawedBack + refund.pointsClawedBack,
            }), { gross: 0, money: 0, membership: 0, loyalty: 0, pointsRestored: 0, pointsClawedBack: 0 });

            // Include pre-migration append-only side effects so a historical
            // refund cannot be replayed merely because it predates the new
            // InvoiceRefund table.
            const negativeMoney = inv.payments
              .filter((payment) => payment.amountMinor < 0)
              .reduce((sum, payment) => sum - payment.amountMinor, 0);
            const membershipRefundRows = await tx.membershipLedger.groupBy({
              by: ["membershipId"],
              where: { invoiceId: id, type: "REFUND" },
              _sum: { deltaMinor: true },
            });
            const membershipRefundedById = new Map(membershipRefundRows.map((row) => [
              row.membershipId,
              Math.max(0, row._sum.deltaMinor ?? 0),
            ]));
            const membershipRefundedMinor = [...membershipRefundedById.values()].reduce((sum, amount) => sum + amount, 0);
            const loyaltyRedeem = inv.customerId
              ? await tx.loyaltyLedger.findFirst({
                where: { invoiceId: id, type: "REDEEM" },
                select: { deltaPoints: true },
              })
              : null;
            const loyaltyRefunded = inv.customerId
              ? await tx.loyaltyLedger.aggregate({
                where: {
                  customerId: inv.customerId,
                  type: "REFUND",
                  OR: [
                    { invoiceId: id },
                    { reason: `Points returned for refund on ${inv.number}` },
                  ],
                },
                _sum: { deltaPoints: true },
              })
              : null;
            const loyaltyClawedBack = inv.customerId
              ? await tx.loyaltyLedger.aggregate({
                where: {
                  customerId: inv.customerId,
                  type: "ADJUST",
                  deltaPoints: { lt: 0 },
                  OR: [
                    { invoiceId: id },
                    { reason: `Earned points reversed for refund on ${inv.number}` },
                  ],
                },
                _sum: { deltaPoints: true },
              })
              : null;
            const originalRedeemedPoints = Math.abs(loyaltyRedeem?.deltaPoints ?? (
              rules && rules.redeemMinorPerPoint > 0 ? Math.round(loyaltyPaid / rules.redeemMinorPerPoint) : 0
            ));
            const observedPointsRestored = Math.max(0, loyaltyRefunded?._sum.deltaPoints ?? 0);
            const observedLoyaltyMinor = originalRedeemedPoints > 0
              ? Math.round((loyaltyPaid * Math.min(originalRedeemedPoints, observedPointsRestored)) / originalRedeemedPoints)
              : 0;

            const refunded = {
              moneyMinor: Math.max(recorded.money, negativeMoney),
              membershipMinor: Math.max(recorded.membership, membershipRefundedMinor),
              loyaltyMinor: Math.max(recorded.loyalty, observedLoyaltyMinor),
            };
            // A migrated record is the authority for gross value. Conservatively
            // assign any old/unclassified amount to money so the total cap still
            // fails closed.
            const classifiedPrior = refunded.moneyMinor + refunded.membershipMinor + refunded.loyaltyMinor;
            if (recorded.gross > classifiedPrior) refunded.moneyMinor += recorded.gross - classifiedPrior;

            const allocation = allocateRemainingTenders({
              requestedMinor: priced.grossMinor,
              invoiceTotalMinor: inv.totalMinor,
              original: { moneyMinor: moneyPaid, membershipMinor: membershipPaid, loyaltyMinor: loyaltyPaid },
              refunded,
            });
            const priorGross = Math.max(
              recorded.gross,
              refunded.moneyMinor + refunded.membershipMinor + refunded.loyaltyMinor,
            );

            const membershipPaidById = new Map<string, number>();
            for (const payment of inv.payments) {
              if (payment.amountMinor <= 0 || payment.method !== "MEMBERSHIP_CREDIT" || !payment.membershipId) continue;
              membershipPaidById.set(
                payment.membershipId,
                (membershipPaidById.get(payment.membershipId) ?? 0) + payment.amountMinor,
              );
            }
            const membershipSources = [...membershipPaidById.entries()].map(([membershipId, paidMinor]) => ({
              membershipId,
              remainingMinor: Math.max(0, paidMinor - (membershipRefundedById.get(membershipId) ?? 0)),
            }));
            const sourceAllocation = allocateProportional(
              membershipSources.map((source) => source.remainingMinor),
              allocation.membershipMinor,
            );
            if (sourceAllocation.reduce((sum, amount) => sum + amount, 0) !== allocation.membershipMinor) {
              throw new Error("membership_refund_source_missing");
            }

            const priorPointsRestored = Math.max(recorded.pointsRestored, observedPointsRestored);
            const pointsToRestore = cumulativeEntitlementDelta({
              originalEntitlement: originalRedeemedPoints,
              originalMinor: loyaltyPaid,
              refundedMinorBefore: refunded.loyaltyMinor,
              refundMinorNow: allocation.loyaltyMinor,
              deliveredBefore: priorPointsRestored,
            });

            const earnLedger = inv.customerId
              ? await tx.loyaltyLedger.findFirst({
                where: { invoiceId: id, type: "EARN" },
                select: { deltaPoints: true },
              })
              : null;
            const originalEarnedPoints = Math.max(0, earnLedger?.deltaPoints ?? 0);
            const priorPointsClawedBack = Math.max(
              recorded.pointsClawedBack,
              Math.abs(Math.min(0, loyaltyClawedBack?._sum.deltaPoints ?? 0)),
            );
            const intendedClawback = cumulativeEntitlementDelta({
              originalEntitlement: originalEarnedPoints,
              originalMinor: inv.totalMinor,
              refundedMinorBefore: priorGross,
              refundMinorNow: priced.grossMinor,
              deliveredBefore: priorPointsClawedBack,
            });

            const refundId = randomUUID();
            if (allocation.moneyMinor > 0) {
              await tx.payment.create({
                data: {
                  invoiceId: id,
                  method: body.method,
                  amountMinor: -allocation.moneyMinor,
                  reference: `refund:${refundId}`,
                  createdByUserId: req.user?.id,
                },
              });
            }
            for (let sourceIndex = 0; sourceIndex < membershipSources.length; sourceIndex += 1) {
              const amountMinor = sourceAllocation[sourceIndex] ?? 0;
              if (amountMinor <= 0) continue;
              await refundMembership(
                tx,
                membershipSources[sourceIndex].membershipId,
                amountMinor,
                id,
                req.user?.id,
              );
            }

            if (inv.customerId && pointsToRestore > 0) {
              await postLoyaltyEntry(tx, {
                customerId: inv.customerId,
                type: "REFUND",
                deltaPoints: pointsToRestore,
                invoiceId: id,
                reason: `Points returned for refund on ${inv.number}`,
                actorUserId: req.user?.id,
              });
            }

            let earnedClawback = 0;
            if (inv.customerId && intendedClawback > 0) {
              const customer = await tx.customer.findUnique({
                where: { id: inv.customerId },
                select: { loyaltyPoints: true },
              });
              earnedClawback = Math.min(intendedClawback, customer?.loyaltyPoints ?? 0);
              if (earnedClawback > 0) {
                await postLoyaltyEntry(tx, {
                  customerId: inv.customerId,
                  type: "ADJUST",
                  deltaPoints: -earnedClawback,
                  invoiceId: id,
                  reason: `Earned points reversed for refund on ${inv.number}`,
                  actorUserId: req.user?.id,
                });
              }
            }

            const itemById = new Map(inv.items.map((item) => [item.id, item]));
            const restock: Array<{ productId: string; qty: number }> = [];
            for (const returned of priced.items) {
              const item = itemById.get(returned.invoiceItemId)!;
              if (!body.restock || item.kind !== "product" || !item.productId) continue;
              const branchProduct = await tx.product.findFirst({
                where: { id: item.productId, branchId: inv.branchId },
                select: { id: true },
              });
              if (!branchProduct) throw new RefundRouteError(409, { error: "product_branch_mismatch" });
              const product = await tx.product.update({
                where: { id: item.productId },
                data: { stockQty: { increment: returned.qty } },
                select: { stockQty: true },
              });
              await tx.inventoryMovement.create({
                data: {
                  branchId: inv.branchId,
                  productId: item.productId,
                  qtyDelta: returned.qty,
                  stockAfter: product.stockQty,
                  reason: "ADJUSTMENT",
                  refType: "refund",
                  refId: refundId,
                  actorUserId: req.user?.id,
                },
              });
              restock.push({ productId: item.productId, qty: returned.qty });
            }

            await tx.invoiceRefund.create({
              data: {
                id: refundId,
                invoiceId: id,
                grossMinor: priced.grossMinor,
                moneyMinor: allocation.moneyMinor,
                membershipMinor: allocation.membershipMinor,
                loyaltyMinor: allocation.loyaltyMinor,
                pointsRestored: pointsToRestore,
                pointsClawedBack: earnedClawback,
                paymentMethod: body.method,
                reason: body.reason,
                restock: body.restock,
                actorUserId: req.user?.id,
                items: {
                  create: priced.items.map((returned) => {
                    const item = itemById.get(returned.invoiceItemId)!;
                    return {
                      invoiceItemId: returned.invoiceItemId,
                      qty: returned.qty,
                      amountMinor: returned.amountMinor,
                      restocked: Boolean(body.restock && item.kind === "product" && item.productId),
                    };
                  }),
                },
              },
            });

            const fullyRefunded = priorGross + priced.grossMinor >= inv.totalMinor;
            const updated = await tx.invoice.update({
              where: { id },
              data: {
                paidMinor: Math.max(0, inv.paidMinor - priced.grossMinor),
                status: fullyRefunded ? "VOID" : inv.status,
                notes: `${inv.notes ? `${inv.notes} | ` : ""}Refunded ${priced.grossMinor} (${body.reason})`,
              },
            });

            if (inv.customerId) {
              const customer = await tx.customer.findUnique({
                where: { id: inv.customerId },
                select: { totalSpent: true },
              });
              if (customer) {
                await tx.customer.update({
                  where: { id: inv.customerId },
                  data: { totalSpent: Math.max(0, customer.totalSpent - priced.grossMinor) },
                });
              }
            }

            return {
              refundedMinor: priced.grossMinor,
              moneyPortion: allocation.moneyMinor,
              membershipPortion: allocation.membershipMinor,
              pointsPortion: allocation.loyaltyMinor,
              pointsToRestore,
              earnedClawback,
              restock,
              status: updated.status,
              refundId,
            };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (error instanceof RefundRouteError) return reply.code(error.status).send(error.payload);
        if (error instanceof RefundAccountingError) {
          return reply.code(accountingStatus(error)).send({ error: error.code, ...error.details });
        }
        throw error;
      }

      await audit("invoice.refund", "Invoice", id, {
        actorUserId: req.user?.id,
        ip: req.ip,
        after: {
          refundId: completed.refundId,
          grossRefund: completed.refundedMinor,
          moneyPortion: completed.moneyPortion,
          membershipPortion: completed.membershipPortion,
          pointsPortion: completed.pointsPortion,
          pointsToRestore: completed.pointsToRestore,
          earnedClawback: completed.earnedClawback,
          restock: completed.restock,
          reason: body.reason,
        },
      });

      return {
        refundId: completed.refundId,
        refundedMinor: completed.refundedMinor,
        breakdown: {
          moneyMinor: completed.moneyPortion,
          membershipMinor: completed.membershipPortion,
          loyaltyMinor: completed.pointsPortion,
          pointsRestored: completed.pointsToRestore,
          pointsClawedBack: completed.earnedClawback,
        },
        status: completed.status,
      };
    },
  );
}
