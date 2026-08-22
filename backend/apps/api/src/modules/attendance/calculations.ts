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
