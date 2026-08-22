// Returns & refunds.
//
// Refunds are append-only money movements: we NEVER mutate issued invoice items
// or existing payments. A refund:
//   1. Prorates the returned line value by the invoice-level discount (coupons),
//      so we never refund more than the customer actually paid.
//   2. Splits the refund across the original tenders proportionally — money is
//      returned as a negative Payment, membership credit and loyalty points are
//      restored to their ledgers rather than paid out as cash.
//   3. Claws back loyalty points that were EARNED on the invoice (anti-farming).
//   4. Restocks returned products.
// Guardrail: total refunded can never exceed the invoice total.

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@cutz/db";
import { authorize } from "../../plugins/auth.js";
import { refund as refundMembership } from "../memberships/ledger.js";
import { getLoyaltyRules, postLoyaltyEntry } from "../loyalty/ledger.js";
import { audit } from "../../lib/audit.js";

const refundSchema = z.object({
  items: z.array(z.object({ invoiceItemId: z.string(), qty: z.number().int().positive() })).min(1),
  method: z.enum(["CASH", "UPI", "CARD", "WALLET"]).default("CASH"),
  reason: z.string().min(2),
  restock: z.boolean().default(true),
});

export default async function refundRoutes(app: FastifyInstance) {
  app.post(
    "/invoices/:id/refund",
    { preHandler: authorize("OWNER", "ADMIN", "MANAGER") },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = refundSchema.parse(req.body);

      const inv = await prisma.invoice.findUnique({
        where: { id },
        include: { items: true, payments: true },
      });
      if (!inv) return reply.code(404).send({ error: "not_found" });
      if (!["OWNER", "ADMIN"].includes(req.user!.role) && req.user!.branchId !== inv.branchId) {
        return reply.code(403).send({ error: "forbidden" });
      }
      if (["DRAFT", "VOID"].includes(inv.status)) {
        return reply.code(409).send({ error: "invoice_not_refundable", status: inv.status });
      }
      if (inv.totalMinor <= 0) return reply.code(409).send({ error: "nothing_to_refund" });

      // Proration factor: invoice total (post coupon) vs sum of gross line totals.
      const sumLine = inv.items.reduce((s, it) => s + it.lineTotalMinor, 0);
      const factor = sumLine > 0 ? inv.totalMinor / sumLine : 1;

      const itemById = new Map(inv.items.map((it) => [it.id, it]));
      let grossRefund = 0;
      const restockOps: { productId: string; qty: number }[] = [];
      for (const r of body.items) {
        const it = itemById.get(r.invoiceItemId);
        if (!it || it.invoiceId !== id) return reply.code(400).send({ error: "item_not_on_invoice", invoiceItemId: r.invoiceItemId });
        if (r.qty > it.qty) return reply.code(400).send({ error: "refund_qty_exceeds_line", invoiceItemId: r.invoiceItemId });
        grossRefund += Math.round((it.lineTotalMinor * r.qty) / it.qty * factor);
        if (body.restock && it.kind === "product" && it.productId) restockOps.push({ productId: it.productId, qty: r.qty });
      }
      if (grossRefund <= 0) return reply.code(400).send({ error: "nothing_to_refund" });

      // Guardrail: never refund more than the invoice total across all refunds.
      const priorRefunded = inv.payments.filter((p) => p.amountMinor < 0).reduce((s, p) => s - p.amountMinor, 0);
      if (priorRefunded + grossRefund > inv.totalMinor) {
        return reply.code(409).send({ error: "refund_exceeds_invoice", alreadyRefunded: priorRefunded, requested: grossRefund, total: inv.totalMinor });
      }

      // Split the refund across the original tenders, proportional to how the bill was paid.
      const memberPayment = inv.payments.find((p) => p.method === "MEMBERSHIP_CREDIT" && p.membershipId);
      const membershipPaid = memberPayment?.amountMinor ?? 0;
      const loyaltyPaid = inv.payments.filter((p) => p.method === "LOYALTY_POINTS").reduce((s, p) => s + p.amountMinor, 0);
      const membershipPortion = Math.round((grossRefund * membershipPaid) / inv.totalMinor);
      const pointsPortion = Math.round((grossRefund * loyaltyPaid) / inv.totalMinor);
      const moneyPortion = Math.max(0, grossRefund - membershipPortion - pointsPortion);

      const rules = inv.customerId ? await getLoyaltyRules(prisma, inv.branchId) : null;
      // Earned-points clawback, proportional to the refunded fraction.
      const earnLedger = inv.customerId
        ? await prisma.loyaltyLedger.findFirst({ where: { invoiceId: id, type: "EARN" }, select: { deltaPoints: true } })
        : null;
      const earnedClawback = earnLedger ? Math.round((earnLedger.deltaPoints * grossRefund) / inv.totalMinor) : 0;
      const pointsToRestore = rules && rules.redeemMinorPerPoint > 0 ? Math.round(pointsPortion / rules.redeemMinorPerPoint) : 0;

      const result = await prisma.$transaction(
        async (tx) => {
          // 1. money back as a negative payment
          if (moneyPortion > 0) {
            await tx.payment.create({
              data: { invoiceId: id, method: body.method, amountMinor: -moneyPortion, reference: `refund:${body.reason}`, createdByUserId: req.user?.id },
            });
          }

          // 2. restore membership credit for its share
          if (membershipPortion > 0 && memberPayment?.membershipId) {
            await refundMembership(tx, memberPayment.membershipId, membershipPortion, id, req.user?.id);
          }

          // 3. loyalty: restore redeemed points share, then claw back earned points
          if (inv.customerId) {
            if (pointsToRestore > 0) {
              await postLoyaltyEntry(tx, { customerId: inv.customerId, type: "REFUND", deltaPoints: pointsToRestore, reason: `Points returned for refund on ${inv.number}`, actorUserId: req.user?.id });
            }
            if (earnedClawback > 0) {
              const cust = await tx.customer.findUnique({ where: { id: inv.customerId }, select: { loyaltyPoints: true } });
              const clamped = Math.min(earnedClawback, cust?.loyaltyPoints ?? 0); // never drive balance negative
              if (clamped > 0) {
                await postLoyaltyEntry(tx, { customerId: inv.customerId, type: "ADJUST", deltaPoints: -clamped, reason: `Earned points reversed for refund on ${inv.number}`, actorUserId: req.user?.id });
              }
            }
          }

          // 4. restock returned products
          for (const op of restockOps) {
            const p = await tx.product.findUnique({ where: { id: op.productId } });
            if (!p) continue;
            const stockAfter = p.stockQty + op.qty;
            await tx.inventoryMovement.create({ data: { productId: op.productId, qtyDelta: op.qty, stockAfter, reason: "ADJUSTMENT", refType: "refund", refId: id, actorUserId: req.user?.id } });
            await tx.product.update({ where: { id: op.productId }, data: { stockQty: stockAfter } });
          }

          // 5. paid + status (a permitted transition, not item mutation)
          const fullyRefunded = priorRefunded + grossRefund >= inv.totalMinor;
          const updated = await tx.invoice.update({
            where: { id },
            data: {
              paidMinor: Math.max(0, inv.paidMinor - moneyPortion - membershipPortion - pointsPortion),
              status: fullyRefunded ? "VOID" : inv.status,
              notes: `${inv.notes ? inv.notes + " | " : ""}Refunded ${grossRefund} (${body.reason})`,
            },
          });

          if (inv.customerId) {
            await tx.customer.update({ where: { id: inv.customerId }, data: { totalSpent: { decrement: grossRefund } } });
          }
          return updated;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      await audit("invoice.refund", "Invoice", id, {
        actorUserId: req.user?.id,
        ip: req.ip,
        after: { grossRefund, moneyPortion, membershipPortion, pointsPortion, pointsToRestore, earnedClawback, restock: restockOps, reason: body.reason },
      });

      return {
        refundedMinor: grossRefund,
        breakdown: { moneyMinor: moneyPortion, membershipMinor: membershipPortion, loyaltyMinor: pointsPortion, pointsRestored: pointsToRestore, pointsClawedBack: earnedClawback },
        status: result.status,
      };
    },
  );
}
