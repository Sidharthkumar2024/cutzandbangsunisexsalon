import { zonedToUtc } from "../../lib/tz.js";

// Drawer revenue belongs to its business day, not the day a historical bill was entered.
export function drawerInvoiceRange(businessDate: string, timeZone: string) {
  const nextDay = new Date(`${businessDate}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  return {
    gte: zonedToUtc(`${businessDate}T00:00:00`, timeZone),
    lt: zonedToUtc(`${nextDay.toISOString().slice(0, 10)}T00:00:00`, timeZone),
  };
}
