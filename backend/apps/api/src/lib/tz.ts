// Convert a wall-clock time in an IANA timezone to the correct UTC Date.
// e.g. zonedToUtc("2026-08-24T16:30:00", "Asia/Kolkata") -> 2026-08-24T11:00:00Z
export function zonedToUtc(isoNoZone: string, timeZone: string): Date {
  const asUtc = new Date(isoNoZone + "Z");
  const local = new Date(asUtc.toLocaleString("en-US", { timeZone }));
  const utcEcho = new Date(asUtc.toLocaleString("en-US", { timeZone: "UTC" }));
  const offset = local.getTime() - utcEcho.getTime();
  return new Date(asUtc.getTime() - offset);
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Parse the Codex UI's display date ("Sat, 22 Aug" or "22 Aug") plus time
 * ("4:30 PM" / "16:30") into a UTC instant, resolving the (omitted) year to the
 * nearest future occurrence relative to `now`.
 */
export function parseDisplayDateTime(dateStr: string, timeStr: string, timeZone: string, now: Date): Date {
  const datePart = dateStr.includes(",") ? dateStr.split(",")[1].trim() : dateStr.trim();
  const [dayRaw, monRaw] = datePart.split(/\s+/);
  const day = parseInt(dayRaw, 10);
  const month = MONTHS[(monRaw ?? "").slice(0, 3).toLowerCase()];
  if (Number.isNaN(day) || month === undefined) throw new Error(`unparseable_date:${dateStr}`);

  const tm = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
  if (!tm) throw new Error(`unparseable_time:${timeStr}`);
  let hour = parseInt(tm[1], 10);
  const minute = parseInt(tm[2], 10);
  const mer = tm[3]?.toLowerCase();
  if (mer === "pm" && hour < 12) hour += 12;
  if (mer === "am" && hour === 12) hour = 0;

  const pad = (n: number) => String(n).padStart(2, "0");
  const build = (year: number) =>
    zonedToUtc(`${year}-${pad(month + 1)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00`, timeZone);

  // Resolve the omitted year: current year, or next year if that date/time has passed.
  const year = now.getUTCFullYear();
  let when = build(year);
  if (when.getTime() < now.getTime() - 60_000) when = build(year + 1);
  return when;
}
