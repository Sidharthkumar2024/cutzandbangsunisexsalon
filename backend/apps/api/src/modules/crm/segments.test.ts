import { describe, it, expect } from "vitest";
import { classify, DEFAULT_SEGMENT_CONFIG } from "./segments.js";

const now = new Date("2026-08-22T00:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

describe("segmentation", () => {
  it("marks a first-timer as NEW, not REPEAT", () => {
    const segs = classify({ visitCount: 1, totalSpent: 5000, lastVisitAt: daysAgo(1), hasActiveMembership: false }, DEFAULT_SEGMENT_CONFIG, now);
    expect(segs).toContain("NEW");
    expect(segs).not.toContain("REPEAT");
  });

  it("separates REPEAT from LAPSED by recency", () => {
    const recent = classify({ visitCount: 5, totalSpent: 50000, lastVisitAt: daysAgo(10), hasActiveMembership: false }, DEFAULT_SEGMENT_CONFIG, now);
    expect(recent).toContain("REPEAT");
    expect(recent).not.toContain("LAPSED");

    const lapsed = classify({ visitCount: 5, totalSpent: 50000, lastVisitAt: daysAgo(90), hasActiveMembership: false }, DEFAULT_SEGMENT_CONFIG, now);
    expect(lapsed).toContain("LAPSED");
  });

  it("flags AT_RISK before LAPSED", () => {
    const segs = classify({ visitCount: 3, totalSpent: 30000, lastVisitAt: daysAgo(50), hasActiveMembership: false }, DEFAULT_SEGMENT_CONFIG, now);
    expect(segs).toContain("AT_RISK");
    expect(segs).not.toContain("LAPSED");
  });

  it("marks high spenders VIP", () => {
    const segs = classify({ visitCount: 8, totalSpent: 2_500_000, lastVisitAt: daysAgo(5), hasActiveMembership: true }, DEFAULT_SEGMENT_CONFIG, now);
    expect(segs).toEqual(expect.arrayContaining(["VIP", "HIGH_SPEND", "MEMBER", "REPEAT"]));
  });
});
