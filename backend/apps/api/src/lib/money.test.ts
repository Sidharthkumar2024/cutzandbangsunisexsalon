import { describe, it, expect } from "vitest";
import { computeLine, computeInvoiceTotals, applyBps } from "./money.js";
import { overlaps, minutesInTz } from "../modules/bookings/availability.js";

describe("money", () => {
  it("applies GST on the post-discount base, half-up", () => {
    // ₹400, qty 2 = ₹800; ₹100 discount => base ₹700; 18% = ₹126
    const line = computeLine({ qty: 2, unitMinor: 40000, discountMinor: 10000, taxRateBps: 1800 });
    expect(line.taxMinor).toBe(12600);
    expect(line.lineTotalMinor).toBe(70000 + 12600);
  });

  it("rounds tax half-up deterministically", () => {
    expect(applyBps(105, 500)).toBe(5); // 5.25 -> 5
    expect(applyBps(110, 500)).toBe(6); // 5.5 -> 6
  });

  it("aggregates invoice totals without float drift", () => {
    const lines = [
      computeLine({ qty: 1, unitMinor: 33333, taxRateBps: 1800 }),
      computeLine({ qty: 3, unitMinor: 12345, discountMinor: 500, taxRateBps: 500 }),
    ];
    const t = computeInvoiceTotals(lines);
    // totals must equal the sum of the line totals exactly
    expect(t.totalMinor).toBe(lines[0].lineTotalMinor + lines[1].lineTotalMinor);
    expect(t.subtotalMinor).toBe(33333 + 3 * 12345);
  });
});

describe("booking overlap", () => {
  it("touching edges do not overlap", () => {
    const a = new Date("2026-08-22T10:00:00Z");
    const b = new Date("2026-08-22T10:30:00Z");
    const c = new Date("2026-08-22T11:00:00Z");
    expect(overlaps(a, b, b, c)).toBe(false);
    expect(overlaps(a, c, b, c)).toBe(true);
  });

  it("maps a UTC instant to salon-local minutes", () => {
    // 10:00 IST == 04:30 UTC
    const { min } = minutesInTz(new Date("2026-08-22T04:30:00Z"), "Asia/Kolkata");
    expect(min).toBe(10 * 60);
  });
});
