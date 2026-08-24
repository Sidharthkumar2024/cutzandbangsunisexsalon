import { describe, expect, it } from "vitest";
import { inclusiveDateKeys, nextDateKey } from "./dashboard-range.js";

describe("dashboard date ranges", () => {
  it("treats both from and to as inclusive, including across a month boundary", () => {
    expect(inclusiveDateKeys("2026-07-30", "2026-08-02")).toEqual([
      "2026-07-30",
      "2026-07-31",
      "2026-08-01",
      "2026-08-02",
    ]);
  });

  it("validates real calendar dates and ordering", () => {
    expect(() => inclusiveDateKeys("2026-02-30", "2026-03-01")).toThrow("invalid_date_key");
    expect(() => inclusiveDateKeys("2026-08-10", "2026-08-01")).toThrow("to_must_not_be_before_from");
  });

  it("caps expensive historical queries and calculates the exclusive end key", () => {
    expect(() => inclusiveDateKeys("2020-01-01", "2026-08-24")).toThrow("date_range_too_large");
    expect(nextDateKey("2026-08-31")).toBe("2026-09-01");
  });
});
