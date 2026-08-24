export type VisitEvent = { customerId: string; occurredAt: Date; revenueMinor: number; source: "invoice" | "appointment" | "history" };

export function addHistoricalVisitEvents(
  events: VisitEvent[],
  history: Array<{ customerId: string; visitedAt: Date; amountMinor: number; source: string }>,
  timeZone: string,
) {
  const linkedSources = new Set(["invoice", "appointment", "pos"]);
  const existing = new Set(events.map((event) => `${event.customerId}:${retentionBucketKey(event.occurredAt, timeZone, "day")}:${event.revenueMinor}`));
  const merged = [...events];
  for (const entry of history) {
    if (linkedSources.has(entry.source.trim().toLowerCase())) continue;
    const key = `${entry.customerId}:${retentionBucketKey(entry.visitedAt, timeZone, "day")}:${entry.amountMinor}`;
    if (existing.has(key)) continue;
    existing.add(key);
    merged.push({ customerId: entry.customerId, occurredAt: entry.visitedAt, revenueMinor: entry.amountMinor, source: "history" });
  }
  return merged;
}

export function retentionBucketKey(date: Date, timeZone: string, bucket: "day" | "week" | "month") {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const dayKey = `${value.year}-${value.month}-${value.day}`;
  if (bucket === "day") return dayKey;
  if (bucket === "month") return dayKey.slice(0, 7);
  const [year, month, day] = dayKey.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  const weekday = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() - weekday + 1);
  return utc.toISOString().slice(0, 10);
}

export function retentionStatus(lastVisitAt: Date | null, visits: number, now: Date, inactiveDays: number) {
  if (!lastVisitAt || visits === 0) return "NEVER_VISITED" as const;
  const days = Math.floor((now.getTime() - lastVisitAt.getTime()) / 86_400_000);
  if (days >= inactiveDays * 2) return "LAPSED" as const;
  if (days >= inactiveDays) return "AT_RISK" as const;
  return visits >= 2 ? "REPEAT" as const : "NEW" as const;
}

export function buildCustomerRetention(
  customers: Array<{ id: string; name: string; phone: string | null; createdAt: Date }>,
  events: VisitEvent[],
  options: { from: Date; to: Date; timeZone: string; bucket: "day" | "week" | "month"; now: Date; inactiveDays: number },
) {
  const eventsByCustomer = new Map<string, VisitEvent[]>();
  for (const event of events) eventsByCustomer.set(event.customerId, [...(eventsByCustomer.get(event.customerId) ?? []), event]);
  return customers.map((customer) => {
    const all = (eventsByCustomer.get(customer.id) ?? []).sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    const inRange = all.filter((event) => event.occurredAt >= options.from && event.occurredAt < options.to);
    const bucketCounts: Record<string, number> = {};
    for (const event of inRange) {
      const key = retentionBucketKey(event.occurredAt, options.timeZone, options.bucket);
      bucketCounts[key] = (bucketCounts[key] ?? 0) + 1;
    }
    const lastVisitAt = all.at(-1)?.occurredAt ?? null;
    return {
      customerId: customer.id,
      name: customer.name,
      phone: customer.phone,
      createdAt: customer.createdAt,
      firstVisitAt: all[0]?.occurredAt ?? null,
      lastVisitAt,
      lifetimeVisits: all.length,
      rangeVisits: inRange.length,
      rangeRevenueMinor: inRange.reduce((sum, event) => sum + event.revenueMinor, 0),
      status: retentionStatus(lastVisitAt, all.length, options.now, options.inactiveDays),
      buckets: bucketCounts,
    };
  });
}
