export type HistoricalDailySale = { businessDate: string; totalSalesMinor: number | null; reviewRequired: boolean };

/** Verified register totals are a fallback only when that day has no live POS invoices. */
export function historicalSalesFallback(rows: HistoricalDailySale[], liveBusinessDates: Set<string>) {
  const byDate = new Map<string, number>();
  for (const row of rows) {
    if (row.reviewRequired || row.totalSalesMinor === null || liveBusinessDates.has(row.businessDate)) continue;
    byDate.set(row.businessDate, row.totalSalesMinor);
  }
  return { byDate, totalMinor: [...byDate.values()].reduce((sum, value) => sum + value, 0) };
}
