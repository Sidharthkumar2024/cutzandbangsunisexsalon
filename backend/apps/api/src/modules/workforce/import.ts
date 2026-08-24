import { z } from "zod";

export const STAFF_IMPORT_MAX_ROWS = 500;

export function assertStaffImportRowLimit(rowCount: number) {
  if (rowCount > STAFF_IMPORT_MAX_ROWS) throw new Error(`staff_import_row_limit_${STAFF_IMPORT_MAX_ROWS}`);
}

type RawRow = Record<string, unknown>;

const DAYS: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

export type StaffImportRow = {
  displayName: string;
  phone?: string;
  designation: string;
  baseSalaryMinor: number;
  commissionRate: number;
  commissionThresholdMinor: number;
  lateGraceMinutes: number;
  lateDeductionMinor: number;
  halfDayAfterMinutes: number;
  overtimePaid: boolean;
  weeklyOff: number[];
  shifts?: Array<{ weekday: number; startMin: number; endMin: number }>;
};

const cleanKey = (value: string) => value.toLowerCase().replace(/[\s_-]+/g, "");

function normalizedRow(row: RawRow) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [cleanKey(key), value]));
}

function valueFor(row: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = row[cleanKey(key)];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return undefined;
}

function optionalString(value: unknown) {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text || undefined;
}

export function staffDedupeKey(name: string) {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-IN");
}

export function staffPhoneKey(phone?: string) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits || null;
}

export function parseMoneyMinor(value: unknown, alreadyMinor = false) {
  if (value === undefined || value === null || String(value).trim() === "") return 0;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) throw new Error("invalid_nonnegative_money");
    return alreadyMinor ? Math.round(value) : Math.round(value * 100);
  }
  const raw = String(value).trim().toLowerCase().replace(/[₹,\s]/g, "");
  const multiplier = raw.endsWith("k") ? 1_000 : raw.endsWith("l") || raw.endsWith("lac") || raw.endsWith("lakh") ? 100_000 : 1;
  const numericText = raw.replace(/(lakh|lac|[kl])$/u, "");
  const amount = Number(numericText) * multiplier;
  if (!Number.isFinite(amount) || amount < 0) throw new Error("invalid_nonnegative_money");
  return alreadyMinor ? Math.round(amount) : Math.round(amount * 100);
}

export function parseClockMinutes(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1440) return value;
  const text = String(value ?? "").trim().toLowerCase().replace(/\./g, ":");
  const match = text.match(/^(\d{1,2})(?::(\d{1,2}))?\s*(am|pm)?$/u);
  if (!match) throw new Error("invalid_time");
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  if (minute > 59 || hour > (match[3] ? 12 : 23)) throw new Error("invalid_time");
  if (match[3]) {
    hour %= 12;
    if (match[3] === "pm") hour += 12;
  }
  const result = hour * 60 + minute;
  if (result > 1440) throw new Error("invalid_time");
  return result;
}

function parseWeekdays(value: unknown, fallback: number[]) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const values = Array.isArray(value) ? value : String(value).split(/[;,|]/u);
  const days = values.map((item) => {
    if (typeof item === "number" || /^\d$/u.test(String(item).trim())) return Number(item);
    const day = DAYS[String(item).trim().toLowerCase()];
    if (day === undefined) throw new Error("invalid_weekday");
    return day;
  });
  if (days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) throw new Error("invalid_weekday");
  return [...new Set(days)].sort((a, b) => a - b);
}

function parseBoolean(value: unknown, fallback: boolean) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  if (typeof value === "boolean") return value;
  if (["true", "yes", "1", "y"].includes(String(value).trim().toLowerCase())) return true;
  if (["false", "no", "0", "n"].includes(String(value).trim().toLowerCase())) return false;
  throw new Error("invalid_boolean");
}

export function parseStaffImportRow(input: RawRow): StaffImportRow {
  const row = normalizedRow(input);
  const displayName = optionalString(valueFor(row, "displayName", "name", "staffName"));
  if (!displayName) throw new Error("display_name_required");
  const designation = optionalString(valueFor(row, "designation", "role", "jobTitle")) ?? "Stylist";
  const phone = optionalString(valueFor(row, "phone", "mobile", "mobileNumber"));

  const salaryMinorValue = valueFor(row, "baseSalaryMinor", "salaryMinor");
  const salaryRupeesValue = valueFor(row, "baseSalary", "salary", "monthlySalary");
  const startValue = valueFor(row, "startMin", "shiftStartMin", "startTime", "shiftStart");
  const endValue = valueFor(row, "endMin", "shiftEndMin", "endTime", "shiftEnd");
  if ((startValue === undefined) !== (endValue === undefined)) throw new Error("shift_start_and_end_required_together");
  const weekdays = parseWeekdays(valueFor(row, "weekdays", "workingDays"), [0, 1, 3, 4, 5, 6]).filter((weekday) => weekday !== 2);
  const weeklyOff = [...new Set([...parseWeekdays(valueFor(row, "weeklyOff", "offDays"), []), 2])].sort((a, b) => a - b);
  const startMin = startValue === undefined ? undefined : parseClockMinutes(startValue);
  const endMin = endValue === undefined ? undefined : parseClockMinutes(endValue);
  if (startMin !== undefined && endMin !== undefined && endMin <= startMin) throw new Error("shift_end_must_be_after_start");

  return z.object({
    displayName: z.string().trim().min(2).max(120),
    phone: z.string().trim().max(30).optional(),
    designation: z.string().trim().min(2).max(100),
    baseSalaryMinor: z.number().int().nonnegative(),
    commissionRate: z.number().int().min(0).max(10_000),
    commissionThresholdMinor: z.number().int().nonnegative(),
    lateGraceMinutes: z.number().int().min(0).max(180),
    lateDeductionMinor: z.number().int().nonnegative(),
    halfDayAfterMinutes: z.number().int().min(30).max(720),
    overtimePaid: z.boolean(),
    weeklyOff: z.array(z.number().int().min(0).max(6)).max(7),
    shifts: z.array(z.object({ weekday: z.number().int().min(0).max(6), startMin: z.number().int().min(0).max(1439), endMin: z.number().int().min(1).max(1440) })).optional(),
  }).parse({
    displayName,
    phone,
    designation,
    baseSalaryMinor: salaryMinorValue !== undefined ? parseMoneyMinor(salaryMinorValue, true) : parseMoneyMinor(salaryRupeesValue),
    commissionRate: Number(valueFor(row, "commissionRate", "commissionBps") ?? 0),
    commissionThresholdMinor: parseMoneyMinor(valueFor(row, "commissionThresholdMinor"), true),
    lateGraceMinutes: Number(valueFor(row, "lateGraceMinutes") ?? 15),
    lateDeductionMinor: parseMoneyMinor(valueFor(row, "lateDeductionMinor"), true),
    halfDayAfterMinutes: Number(valueFor(row, "halfDayAfterMinutes") ?? 240),
    overtimePaid: parseBoolean(valueFor(row, "overtimePaid"), false),
    weeklyOff,
    shifts: startMin !== undefined && endMin !== undefined ? weekdays.map((weekday) => ({ weekday, startMin, endMin })) : undefined,
  });
}
