import { describe, it, expect } from "vitest";
import { allocateProportional, computeLine, computeInvoiceTotals } from "./money.js";

describe("allocateProportional", () => {
  it("sums exactly to the amount and splits by weight", () => {
    const a = allocateProportional([100000, 100000], 20000);
    expect(a).toEqual([10000, 10000]);
    expect(a.reduce((x, y) => x + y, 0)).toBe(20000);
  });

  it("uses largest-remainder so the split is exact even when it doesn't divide evenly", () => {
    const a = allocateProportional([100, 100, 100], 10);
    expect(a.reduce((x, y) => x + y, 0)).toBe(10); // e.g. 4/3/3
    expect(Math.max(...a) - Math.min(...a)).toBeLessThanOrEqual(1);
  });

  it("caps at the total weight when the amount exceeds it (no overflow)", () => {
    // weights double as ceilings; amount > sum(weights) -> allocate all weights
    const a = allocateProportional([300, 700], 5000);
    expect(a).toEqual([300, 700]);
    expect(a.reduce((x, y) => x + y, 0)).toBe(1000);
  });

  it("respects per-bucket ceilings when one bucket is tiny", () => {
    const a = allocateProportional([10, 1000], 1005);
    expect(a[0]).toBeLessThanOrEqual(10);
    expect(a[1]).toBeLessThanOrEqual(1000);
    expect(a.reduce((x, y) => x + y, 0)).toBe(1005); // cap = min(1005, 1010)
  });

  it("handles zero / empty edges", () => {
    expect(allocateProportional([], 100)).toEqual([]);
    expect(allocateProportional([0, 0], 100)).toEqual([0, 0]);
    expect(allocateProportional([5, 5], 0)).toEqual([0, 0]);
  });
});

describe("coupon allocation keeps GST correct (regression)", () => {
  it("a coupon reduces taxable base + tax proportionally; identity holds", () => {
    // Two ₹1000 lines @18% GST, ₹400 coupon spread across the bases.
    const bases = [100000, 100000];
    const coupon = 40000;
    const alloc = allocateProportional(bases, coupon);
    expect(alloc).toEqual([20000, 20000]);
    const lines = bases.map((_, i) =>
      computeLine({ qty: 1, unitMinor: 100000, discountMinor: alloc[i], taxRateBps: 1800 }),
    );
    const t = computeInvoiceTotals(lines);
    // discount reflects the coupon exactly
    expect(t.discountMinor).toBe(40000);
    // tax is charged on the POST-coupon base (₹1600), not ₹2000
    expect(t.taxMinor).toBe(Math.round((200000 - 40000) * 0.18)); // 28800
    // accounting identity: subtotal - discount + tax == total
    expect(t.subtotalMinor - t.discountMinor + t.taxMinor).toBe(t.totalMinor);
  });
});
