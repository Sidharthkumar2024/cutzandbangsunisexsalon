export const DEFAULT_CLOSED_WEEKDAYS = [2] as const;

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export function weekdayForDateKey(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) throw new Error("invalid_date_key");
  const parsed = new Date(`${date}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error("invalid_date_key");
  return parsed.getUTCDay();
}

export function isSalonClosedWeekday(weekday: number) {
  return DEFAULT_CLOSED_WEEKDAYS.includes(weekday as (typeof DEFAULT_CLOSED_WEEKDAYS)[number]);
}

export type ShiftWindow = { weekday: number; startMin: number; endMin: number };

export function weeklyBusinessHours(shifts: ShiftWindow[]) {
  return WEEKDAY_NAMES.map((name, weekday) => {
    if (isSalonClosedWeekday(weekday)) {
      return { weekday, name, isClosed: true, opensAt: null, closesAt: null };
    }
    const windows = shifts.filter((shift) => shift.weekday === weekday);
    if (!windows.length) return { weekday, name, isClosed: true, opensAt: null, closesAt: null };
    return {
      weekday,
      name,
      isClosed: false,
      opensAt: clock(Math.min(...windows.map((shift) => shift.startMin))),
      closesAt: clock(Math.max(...windows.map((shift) => shift.endMin))),
    };
  });
}

function clock(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
