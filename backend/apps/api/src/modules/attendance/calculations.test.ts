import { describe, expect, it } from "vitest";
import { commissionMinor, haversineMeters, minutesBetween } from "./calculations.js";

describe("attendance and payroll calculations", () => {
  it("accepts a point within a typical salon geofence", () => {
    expect(haversineMeters({ lat: 28.6139, lng: 77.2090 }, { lat: 28.6142, lng: 77.2092 })).toBeLessThan(50);
  });
  it("calculates positive worked minutes only", () => {
    expect(minutesBetween(new Date("2026-08-22T04:30:00Z"), new Date("2026-08-22T12:30:00Z"))).toBe(480);
    expect(minutesBetween(new Date("2026-08-22T12:30:00Z"), new Date("2026-08-22T04:30:00Z"))).toBe(0);
  });
  it("uses basis points for staff commission", () => {
    expect(commissionMinor(118000, 1000)).toBe(11800);
  });
});
