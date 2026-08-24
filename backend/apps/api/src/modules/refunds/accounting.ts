import { allocateProportional } from "../../lib/money.js";

export class RefundAccountingError extends Error {
  constructor(
    public readonly code: "duplicate_refund_item" | "item_not_on_invoice" | "refund_qty_exceeds_line" | "refund_exceeds_invoice" | "nothing_to_refund",
    public readonly details: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

export interface RefundableLine {
  id: string;
  qty: number;
  lineTotalMinor: number;
}

export interface PriorRefundLine {
  invoiceItemId: string;
  qty: number;
  amountMinor: number;
}

export interface RequestedRefundLine {
  invoiceItemId: string;
  qty: number;
}

/**
 * Price requested return quantities against the immutable, post-discount
 * invoice total.  Cumulative pricing makes repeated partial returns add up to
 * exactly the line's allocated net amount, without per-request rounding drift.
 */
export function computeRefundLines(input: {
  invoiceTotalMinor: number;
  lines: RefundableLine[];
  prior: PriorRefundLine[];
  requested: RequestedRefundLine[];
}): { grossMinor: number; items: Array<RequestedRefundLine & { amountMinor: number }> } {
  const requestedIds = new Set<string>();
  for (const requested of input.requested) {
    if (requestedIds.has(requested.invoiceItemId)) {
      throw new RefundAccountingError("duplicate_refund_item", { invoiceItemId: requested.invoiceItemId });
    }
    requestedIds.add(requested.invoiceItemId);
  }

  const lineById = new Map(input.lines.map((line) => [line.id, line]));
  const netLineAmounts = allocateProportional(
    input.lines.map((line) => line.lineTotalMinor),
    input.invoiceTotalMinor,
  );
  const netById = new Map(input.lines.map((line, index) => [line.id, netLineAmounts[index] ?? 0]));

  const priorById = new Map<string, { qty: number; amountMinor: number }>();
  for (const item of input.prior) {
    const aggregate = priorById.get(item.invoiceItemId) ?? { qty: 0, amountMinor: 0 };
    aggregate.qty += item.qty;
    aggregate.amountMinor += item.amountMinor;
    priorById.set(item.invoiceItemId, aggregate);
  }

  let grossMinor = 0;
  const items = input.requested.map((requested) => {
    const line = lineById.get(requested.invoiceItemId);
    if (!line) {
      throw new RefundAccountingError("item_not_on_invoice", { invoiceItemId: requested.invoiceItemId });
    }
    const prior = priorById.get(line.id) ?? { qty: 0, amountMinor: 0 };
    const remainingQty = Math.max(0, line.qty - prior.qty);
    if (requested.qty > remainingQty) {
      throw new RefundAccountingError("refund_qty_exceeds_line", {
        invoiceItemId: requested.invoiceItemId,
        alreadyRefundedQty: prior.qty,
        remainingQty,
      });
    }

    const netLineMinor = netById.get(line.id) ?? 0;
    const cumulativeQty = prior.qty + requested.qty;
    const cumulativeTarget = cumulativeQty >= line.qty
      ? netLineMinor
      : Math.round((netLineMinor * cumulativeQty) / line.qty);
    const amountMinor = Math.max(0, cumulativeTarget - prior.amountMinor);
    grossMinor += amountMinor;
    return { ...requested, amountMinor };
  });

  if (grossMinor <= 0) throw new RefundAccountingError("nothing_to_refund");
  return { grossMinor, items };
}

export interface TenderAmounts {
  moneyMinor: number;
  membershipMinor: number;
  loyaltyMinor: number;
}

/**
 * Allocate only against unreturned tender balances. This keeps each credit
 * system within its original payment ceiling even after many partial refunds.
 */
export function allocateRemainingTenders(input: {
  requestedMinor: number;
  invoiceTotalMinor: number;
  original: TenderAmounts;
  refunded: TenderAmounts;
}): TenderAmounts {
  const alreadyRefunded = Math.max(
    input.refunded.moneyMinor + input.refunded.membershipMinor + input.refunded.loyaltyMinor,
    0,
  );
  if (alreadyRefunded + input.requestedMinor > input.invoiceTotalMinor) {
    throw new RefundAccountingError("refund_exceeds_invoice", {
      alreadyRefunded,
      requested: input.requestedMinor,
      total: input.invoiceTotalMinor,
    });
  }

  const remaining = [
    Math.max(0, input.original.moneyMinor - input.refunded.moneyMinor),
    Math.max(0, input.original.membershipMinor - input.refunded.membershipMinor),
    Math.max(0, input.original.loyaltyMinor - input.refunded.loyaltyMinor),
  ];
  const allocation = allocateProportional(remaining, input.requestedMinor);
  const allocated = allocation.reduce((sum, amount) => sum + amount, 0);
  if (allocated !== input.requestedMinor) {
    throw new RefundAccountingError("refund_exceeds_invoice", {
      alreadyRefunded,
      requested: input.requestedMinor,
      total: input.invoiceTotalMinor,
    });
  }
  return {
    moneyMinor: allocation[0] ?? 0,
    membershipMinor: allocation[1] ?? 0,
    loyaltyMinor: allocation[2] ?? 0,
  };
}

/** Exact cumulative entitlement delta, capped at the original entitlement. */
export function cumulativeEntitlementDelta(input: {
  originalEntitlement: number;
  originalMinor: number;
  refundedMinorBefore: number;
  refundMinorNow: number;
  deliveredBefore: number;
}): number {
  if (input.originalEntitlement <= 0 || input.originalMinor <= 0 || input.refundMinorNow <= 0) return 0;
  const cumulativeMinor = Math.min(input.originalMinor, input.refundedMinorBefore + input.refundMinorNow);
  const target = cumulativeMinor >= input.originalMinor
    ? input.originalEntitlement
    : Math.round((input.originalEntitlement * cumulativeMinor) / input.originalMinor);
  return Math.max(0, Math.min(input.originalEntitlement - input.deliveredBefore, target - input.deliveredBefore));
}
