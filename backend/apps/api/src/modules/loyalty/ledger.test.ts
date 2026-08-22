import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOYALTY_RULES,
  calculateEarnedPoints,
  calculateRedemptionMinor,
  parseLoyaltyRules,
} from "./ledger.js";

describe("loyalty rules", () => {
  it("earns only complete spend bands", () => {
    expect(calculateEarnedPoints(9_999, DEFAULT_LOYALTY_RULES)).toBe(0);
    expect(calculateEarnedPoints(25_000, DEFAULT_LOYALTY_RULES)).toBe(2);
  });

  it("converts points using the configured value", () => {
    expect(calculateRedemptionMinor(75, DEFAULT_LOYALTY_RULES)).toBe(7_500);
  });

  it("falls back safely for an invalid stored rule", () => {
    expect(parseLoyaltyRules({ earnEveryMinor: 0 })).toEqual(DEFAULT_LOYALTY_RULES);
  });
});
