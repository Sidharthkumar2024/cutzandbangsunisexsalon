import { describe, expect, it } from "vitest";
import { addHistoricalVisitEvents, buildCustomerRetention, retentionBucketKey, retentionStatus } from "./retention.js";

describe("customer retention report", () => {
  it("uses calendar buckets in the salon timezone", () => {
    expect(retentionBucketKey(new Date("2026-08-31T19:00:00Z"), "Asia/Kolkata", "month")).toBe("2026-09");
  });
  it("derives status only from real visit events", () => {
    expect(retentionStatus(null, 0, new Date("2026-08-24T00:00:00Z"), 60)).toBe("NEVER_VISITED");
    expect(retentionStatus(new Date("2026-08-01T00:00:00Z"), 2, new Date("2026-08-24T00:00:00Z"), 60)).toBe("REPEAT");
  });
  it("builds matrix counts and revenue from supplied events", () => {
    const rows = buildCustomerRetention(
      [{ id: "c1", name: "Client", phone: null, createdAt: new Date("2026-01-01T00:00:00Z") }],
      [
        { customerId: "c1", occurredAt: new Date("2026-07-01T06:00:00Z"), revenueMinor: 50000, source: "invoice" },
        { customerId: "c1", occurredAt: new Date("2026-08-01T06:00:00Z"), revenueMinor: 0, source: "appointment" },
      ],
      { from: new Date("2026-07-01T00:00:00Z"), to: new Date("2026-09-01T00:00:00Z"), timeZone: "Asia/Kolkata", bucket: "month", now: new Date("2026-08-24T00:00:00Z"), inactiveDays: 60 },
    );
    expect(rows[0]).toMatchObject({ lifetimeVisits: 2, rangeVisits: 2, rangeRevenueMinor: 50000, buckets: { "2026-07": 1, "2026-08": 1 }, status: "REPEAT" });
  });
  it("adds historical visits without duplicating same-day invoice history", () => {
    const events = addHistoricalVisitEvents(
      [{ customerId: "c1", occurredAt: new Date("2026-08-01T10:00:00Z"), revenueMinor: 50000, source: "invoice" }],
      [
        { customerId: "c1", visitedAt: new Date("2026-08-01T12:00:00Z"), amountMinor: 50000, source: "historical_import" },
        { customerId: "c1", visitedAt: new Date("2026-07-01T12:00:00Z"), amountMinor: 30000, source: "historical_import" },
        { customerId: "c1", visitedAt: new Date("2026-06-01T12:00:00Z"), amountMinor: 10000, source: "invoice" },
      ],
      "Asia/Kolkata",
    );
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ source: "history", revenueMinor: 30000 });
  });
});
