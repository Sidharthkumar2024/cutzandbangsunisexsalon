import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOYALTY_RULES,
  DEFAULT_MARKETING_SETTINGS,
  calculateEarnedPoints,
  calculateRedemptionMinor,
  calculateStampRewardPoints,
  parseLoyaltyRules,
  parseMarketingSettings,
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

  it("defaults stamp rewards to 5 x ₹1000+ bills and ₹500 reward value", () => {
    const settings = parseMarketingSettings({});
    expect(settings.rewardRules.stampEveryVisits).toBe(5);
    expect(settings.rewardRules.stampMinInvoiceMinor).toBe(100_000);
    expect(settings.rewardRules.stampRewardDiscountPercent).toBe(50);
    expect(settings.rewardRules.stampRewardMaxServiceMinor).toBe(100_000);
    expect(calculateStampRewardPoints(DEFAULT_MARKETING_SETTINGS.rewardRules, DEFAULT_LOYALTY_RULES)).toBe(500);
  });
});
