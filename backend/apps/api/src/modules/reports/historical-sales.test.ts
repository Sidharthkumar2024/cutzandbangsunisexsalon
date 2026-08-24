import { describe, expect, it } from "vitest";
import { historicalSalesFallback } from "./historical-sales.js";

describe("historical sales reporting", () => {
  it("uses verified non-null totals and gives live invoices precedence", () => {
    const result = historicalSalesFallback([
      { businessDate: "2026-08-01", totalSalesMinor: 650000, reviewRequired: false },
      { businessDate: "2026-08-02", totalSalesMinor: 421000, reviewRequired: false },
      { businessDate: "2026-08-03", totalSalesMinor: 160000, reviewRequired: true },
      { businessDate: "2026-08-04", totalSalesMinor: null, reviewRequired: false },
    ], new Set(["2026-08-02"]));
    expect(result.totalMinor).toBe(650000);
    expect([...result.byDate]).toEqual([["2026-08-01", 650000]]);
  });
});
