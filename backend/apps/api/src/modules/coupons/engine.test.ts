import { describe, expect, it } from "vitest";
import { calculateCouponDiscount } from "./engine.js";

describe("coupon discount", () => {
  it("supports percentage coupons with a cap", () => {
    expect(calculateCouponDiscount({ type: "PERCENTAGE", value: 2_000, maxDiscountMinor: 15_000 }, 100_000)).toBe(15_000);
  });

  it("supports fixed coupons without exceeding the bill", () => {
    expect(calculateCouponDiscount({ type: "FIXED", value: 50_000, maxDiscountMinor: null }, 30_000)).toBe(30_000);
  });
});
