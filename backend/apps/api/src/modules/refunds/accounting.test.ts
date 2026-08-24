import { describe, expect, it } from "vitest";
import {
  RefundAccountingError,
  allocateRemainingTenders,
  computeRefundLines,
  cumulativeEntitlementDelta,
} from "./accounting.js";

describe("refund accounting", () => {
  it("rejects duplicate invoice item ids instead of multiplying a line refund", () => {
    expect(() => computeRefundLines({
      invoiceTotalMinor: 1_000,
      lines: [{ id: "line-1", qty: 1, lineTotalMinor: 1_000 }],
      prior: [],
      requested: [
        { invoiceItemId: "line-1", qty: 1 },
        { invoiceItemId: "line-1", qty: 1 },
      ],
    })).toThrowError(expect.objectContaining<Partial<RefundAccountingError>>({ code: "duplicate_refund_item" }));
  });

  it("enforces the quantity remaining after prior partial refunds", () => {
    expect(() => computeRefundLines({
      invoiceTotalMinor: 1_000,
      lines: [{ id: "line-1", qty: 3, lineTotalMinor: 1_000 }],
      prior: [{ invoiceItemId: "line-1", qty: 2, amountMinor: 667 }],
      requested: [{ invoiceItemId: "line-1", qty: 2 }],
    })).toThrowError(expect.objectContaining<Partial<RefundAccountingError>>({
      code: "refund_qty_exceeds_line",
      details: expect.objectContaining({ remainingQty: 1 }),
    }));
  });

  it("makes cumulative partial line refunds equal the exact discounted line allocation", () => {
    const first = computeRefundLines({
      invoiceTotalMinor: 1_000,
      lines: [{ id: "line-1", qty: 3, lineTotalMinor: 1_200 }],
      prior: [],
      requested: [{ invoiceItemId: "line-1", qty: 1 }],
    });
    const second = computeRefundLines({
      invoiceTotalMinor: 1_000,
      lines: [{ id: "line-1", qty: 3, lineTotalMinor: 1_200 }],
      prior: [{ invoiceItemId: "line-1", qty: 1, amountMinor: first.grossMinor }],
      requested: [{ invoiceItemId: "line-1", qty: 2 }],
    });
    expect(first.grossMinor + second.grossMinor).toBe(1_000);
  });

  it("never restores a tender beyond its remaining original payment", () => {
    const allocation = allocateRemainingTenders({
      requestedMinor: 300,
      invoiceTotalMinor: 1_000,
      original: { moneyMinor: 500, membershipMinor: 300, loyaltyMinor: 200 },
      refunded: { moneyMinor: 450, membershipMinor: 100, loyaltyMinor: 150 },
    });
    expect(allocation).toEqual({ moneyMinor: 50, membershipMinor: 200, loyaltyMinor: 50 });
  });

  it("delivers cumulative point restoration exactly once and caps it", () => {
    expect(cumulativeEntitlementDelta({
      originalEntitlement: 7,
      originalMinor: 1_000,
      refundedMinorBefore: 300,
      refundMinorNow: 700,
      deliveredBefore: 2,
    })).toBe(5);
    expect(cumulativeEntitlementDelta({
      originalEntitlement: 7,
      originalMinor: 1_000,
      refundedMinorBefore: 1_000,
      refundMinorNow: 100,
      deliveredBefore: 7,
    })).toBe(0);
  });
});
