export const EARTH_RADIUS_METERS = 6_371_000;

export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const radians = (value: number) => value * Math.PI / 180;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const lat1 = radians(a.lat);
  const lat2 = radians(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

export function minutesBetween(start: Date | null, end: Date | null) {
  if (!start || !end || end <= start) return 0;
  return Math.round((end.getTime() - start.getTime()) / 60_000);
}

export function commissionMinor(lineTotalMinor: number, commissionRateBps: number) {
  return Math.round(lineTotalMinor * commissionRateBps / 10_000);
}

/** Stores the actual delay from shift start once the configured grace is crossed. */
export function lateMinutesForCheckIn(actualMinute: number, shiftStartMinute: number, graceMinutes = 15) {
  const delay = Math.max(0, actualMinute - shiftStartMinute);
  return delay > graceMinutes ? delay : 0;
}

export function attendancePenaltyCounts(
  attendance: Array<{ checkInAt: Date | null; checkOutAt: Date | null; lateMinutes: number }>,
  workedDurationHalfDayMinutes: number,
) {
  const lateDays = attendance.filter((row) => row.lateMinutes > 0).length;
  const excessiveLateHalfDays = attendance.filter((row) => row.lateMinutes > 30).length;
  const ordinaryLateDays = attendance.filter((row) => row.lateMinutes > 0 && row.lateMinutes <= 30).length;
  const recurringLateHalfDays = Math.floor(ordinaryLateDays / 3);
  // A group of three ordinary late arrivals is converted to a half-day. Only
  // the remainder is eligible for an optional per-late monetary deduction.
  const chargeableLateDays = ordinaryLateDays % 3;
  const shortShiftHalfDays = attendance.filter((row) => {
    const workedMinutes = minutesBetween(row.checkInAt, row.checkOutAt);
    return Boolean(row.checkOutAt) && workedMinutes > 0 && workedMinutes < workedDurationHalfDayMinutes;
  }).length;
  return {
    lateDays,
    ordinaryLateDays,
    chargeableLateDays,
    excessiveLateHalfDays,
    recurringLateHalfDays,
    shortShiftHalfDays,
    halfDays: excessiveLateHalfDays + recurringLateHalfDays + shortShiftHalfDays,
  };
}
