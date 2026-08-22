import { describe, it, expect } from "vitest";
import { zonedToUtc, parseDisplayDateTime } from "./tz.js";

const IST = "Asia/Kolkata";

describe("zonedToUtc", () => {
  it("converts IST wall-clock to UTC (subtracts 5:30)", () => {
    expect(zonedToUtc("2026-08-24T16:30:00", IST).toISOString()).toBe("2026-08-24T11:00:00.000Z");
    expect(zonedToUtc("2026-08-25T11:30:00", IST).toISOString()).toBe("2026-08-25T06:00:00.000Z");
  });
});

describe("parseDisplayDateTime (Codex UI contract)", () => {
  const now = new Date("2026-08-22T09:00:00Z"); // 22 Aug 2026, ~14:30 IST

  it("parses 'Mon, 24 Aug' + '4:30 PM' into the correct UTC instant", () => {
    const d = parseDisplayDateTime("Mon, 24 Aug", "4:30 PM", IST, now);
    expect(d.toISOString()).toBe("2026-08-24T11:00:00.000Z");
  });

  it("accepts a date without weekday and 24h time", () => {
    const d = parseDisplayDateTime("25 Aug", "11:30", IST, now);
    expect(d.toISOString()).toBe("2026-08-25T06:00:00.000Z");
  });

  it("handles 12 AM / 12 PM correctly", () => {
    expect(parseDisplayDateTime("24 Aug", "12:00 AM", IST, now).toISOString()).toBe("2026-08-23T18:30:00.000Z");
    expect(parseDisplayDateTime("24 Aug", "12:00 PM", IST, now).toISOString()).toBe("2026-08-24T06:30:00.000Z");
  });

  it("rolls the omitted year forward when the date already passed", () => {
    // 'Jan' is before Aug -> should resolve to next year, not the past.
    const d = parseDisplayDateTime("5 Jan", "10:00 AM", IST, now);
    expect(d.getUTCFullYear()).toBe(2027);
  });

  it("throws on unparseable input", () => {
    expect(() => parseDisplayDateTime("not a date", "4:30 PM", IST, now)).toThrow();
    expect(() => parseDisplayDateTime("24 Aug", "nope", IST, now)).toThrow();
  });
});
