import { describe, expect, it } from "vitest";
import { isSalonClosedWeekday, weekdayForDateKey, weeklyBusinessHours } from "./business-hours.js";

describe("salon business hours", () => {
  it("marks every Tuesday as closed", () => {
    expect(weekdayForDateKey("2026-08-25")).toBe(2);
    expect(isSalonClosedWeekday(2)).toBe(true);
  });

  it("does not expose stored Tuesday shifts and derives the open span for other days", () => {
    const days = weeklyBusinessHours([
      { weekday: 1, startMin: 600, endMin: 1200 },
      { weekday: 1, startMin: 660, endMin: 1260 },
      { weekday: 2, startMin: 600, endMin: 1260 },
    ]);
    expect(days[1]).toMatchObject({ isClosed: false, opensAt: "10:00", closesAt: "21:00" });
    expect(days[2]).toMatchObject({ isClosed: true, opensAt: null, closesAt: null });
  });
});
