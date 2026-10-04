import { describe, expect, it } from "vitest";
import { parseConsent, parseCsv, phoneKey } from "./csv.js";

describe("CSV parsing", () => {
  it("strips a UTF-8 BOM from the first header", () => {
    expect(parseCsv("\uFEFFname,phone\nAakash,9289584803")).toEqual([
      { name: "Aakash", phone: "9289584803" },
    ]);
  });

  it("handles quoted commas and escaped quotes", () => {
    expect(parseCsv('name,notes\n"Aakash, Jr.","said ""hello"""')).toEqual([
      { name: "Aakash, Jr.", notes: 'said "hello"' },
    ]);
  });

  it("normalizes phone keys for deduplication", () => {
    expect(phoneKey("+91 92895-84803")).toBe("9289584803");
  });

  it("maps explicit consent values and leaves unknown values unset", () => {
    expect(parseConsent("yes")).toBe(true);
    expect(parseConsent("no")).toBe(false);
    expect(parseConsent("unknown")).toBeUndefined();
  });
});
