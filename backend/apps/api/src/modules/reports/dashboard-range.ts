const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/u;

export const MAX_DASHBOARD_RANGE_DAYS = 731;

/**
 * Return every Gregorian calendar date in an inclusive YYYY-MM-DD range.
 * Date keys are intentionally handled in UTC so DST never adds or drops a day.
 */
export function inclusiveDateKeys(from: string, to: string, maxDays = MAX_DASHBOARD_RANGE_DAYS) {
  const start = dateKeyTimestamp(from);
  const end = dateKeyTimestamp(to);
  if (end < start) throw new Error("to_must_not_be_before_from");
  const days = Math.floor((end - start) / 86_400_000) + 1;
  if (days > maxDays) throw new Error("date_range_too_large");
  return Array.from({ length: days }, (_, index) => new Date(start + index * 86_400_000).toISOString().slice(0, 10));
}

export function nextDateKey(value: string) {
  return new Date(dateKeyTimestamp(value) + 86_400_000).toISOString().slice(0, 10);
}

function dateKeyTimestamp(value: string) {
  if (!DATE_KEY.test(value)) throw new Error("invalid_date_key");
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    throw new Error("invalid_date_key");
  }
  return timestamp;
}
