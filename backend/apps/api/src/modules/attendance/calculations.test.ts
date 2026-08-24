import { describe, expect, it } from "vitest";
import { attendancePenaltyCounts, commissionMinor, haversineMeters, lateMinutesForCheckIn, minutesBetween } from "./calculations.js";

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
  it("applies a 15-minute grace and records the full delay", () => {
    expect(lateMinutesForCheckIn(675, 660, 15)).toBe(0);
    expect(lateMinutesForCheckIn(676, 660, 15)).toBe(16);
    expect(lateMinutesForCheckIn(691, 660, 15)).toBe(31);
  });
  it("adds half-days for over-30-minute and every third late arrival", () => {
    const rows = [10, 16, 31, 20, 45, 0].map((lateMinutes, index) => ({
      checkInAt: new Date(`2026-08-${String(index + 1).padStart(2, "0")}T04:30:00Z`),
      checkOutAt: new Date(`2026-08-${String(index + 1).padStart(2, "0")}T12:30:00Z`),
      lateMinutes,
    }));
    expect(attendancePenaltyCounts(rows, 240)).toEqual({
      lateDays: 5,
      ordinaryLateDays: 3,
      chargeableLateDays: 0,
      excessiveLateHalfDays: 2,
      recurringLateHalfDays: 1,
      shortShiftHalfDays: 0,
      halfDays: 3,
    });
  });
  it("does not count over-30-minute arrivals again in the recurring rule", () => {
    const rows = [31, 45, 90].map((lateMinutes, index) => ({
      checkInAt: new Date(`2026-08-${String(index + 1).padStart(2, "0")}T04:30:00Z`),
      checkOutAt: new Date(`2026-08-${String(index + 1).padStart(2, "0")}T12:30:00Z`),
      lateMinutes,
    }));
    expect(attendancePenaltyCounts(rows, 240)).toMatchObject({
      excessiveLateHalfDays: 3,
      recurringLateHalfDays: 0,
      chargeableLateDays: 0,
      halfDays: 3,
    });
  });
  it("keeps short worked-duration half-days separate", () => {
    expect(attendancePenaltyCounts([{ checkInAt: new Date("2026-08-01T05:00:00Z"), checkOutAt: new Date("2026-08-01T08:00:00Z"), lateMinutes: 0 }], 240).shortShiftHalfDays).toBe(1);
  });
});
