import { describe, expect, it } from "vitest";
import { drawerInvoiceRange } from "./drawer-date.js";

describe("drawer invoice business date", () => {
  it("excludes a past invoice entered today and includes today's invoice", () => {
    const range = drawerInvoiceRange("2026-10-04", "Asia/Kolkata");
    const included = (date: Date) => date >= range.gte && date < range.lt;
    expect(included(new Date("2026-10-01T06:30:00Z"))).toBe(false);
    expect(included(new Date("2026-10-04T06:30:00Z"))).toBe(true);
    expect(included(range.lt)).toBe(false);
    expect(range.gte.toISOString()).toBe("2026-10-03T18:30:00.000Z");
  });
  it("handles year rollover", () => {
    expect(drawerInvoiceRange("2026-12-31", "Asia/Kolkata").lt.toISOString())
      .toBe("2026-12-31T18:30:00.000Z");
  });
});
