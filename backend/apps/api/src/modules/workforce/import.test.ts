import { describe, expect, it } from "vitest";
import { assertStaffImportRowLimit, parseStaffImportRow, staffDedupeKey } from "./import.js";

describe("staff import parsing", () => {
  it("accepts human CSV headings, k salary and 12-hour shifts", () => {
    const row = parseStaffImportRow({ name: "Faizan", designation: "Female Hair Dresser", salary: "30k", "start time": "11 AM", "end time": "9 PM" });
    expect(row).toMatchObject({
      displayName: "Faizan",
      baseSalaryMinor: 3_000_000,
      designation: "Female Hair Dresser",
    });
    expect(row.shifts).toHaveLength(7);
    expect(row.shifts?.[0]).toEqual({ weekday: 0, startMin: 660, endMin: 1260 });
  });

  it("does not invent phone data and normalizes dedupe names", () => {
    expect(parseStaffImportRow({ name: "  Shanti (didi) ", salary: 12000, startTime: "09:30", endTime: "21:00" }).phone).toBeUndefined();
    expect(staffDedupeKey("  SHANTI   (didi) ")).toBe("shanti (didi)");
  });

  it("rejects incomplete shifts", () => {
    expect(() => parseStaffImportRow({ name: "Nitin", startTime: "10:40" })).toThrow("shift_start_and_end_required_together");
  });

  it("caps CSV-derived rows before a database transaction", () => {
    expect(() => assertStaffImportRowLimit(500)).not.toThrow();
    expect(() => assertStaffImportRowLimit(501)).toThrow("staff_import_row_limit_500");
  });
});
