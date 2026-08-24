import { describe, expect, it, vi } from "vitest";
import { resolveSlot, SlotUnavailableError } from "./availability.js";

describe("booking branch isolation", () => {
  it("rejects a selected staff member who does not belong to the appointment branch", async () => {
    const db = {
      service: {
        findFirst: vi.fn().mockResolvedValue({
          id: "service-1",
          durationMin: 30,
          bufferMin: 0,
          priceMinor: 50000,
        }),
      },
      staff: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const request = {
      serviceId: "service-1",
      staffId: "staff-other-branch",
      startAt: new Date("2026-08-25T05:00:00.000Z"),
    };

    await expect(resolveSlot(db as never, "main", "Asia/Kolkata", request)).rejects.toMatchObject({
      reason: "staff_branch_mismatch",
    } satisfies Partial<SlotUnavailableError>);
    expect(db.staff.findFirst).toHaveBeenCalledWith({
      where: {
        id: "staff-other-branch",
        branchId: "main",
        isActive: true,
        deletedAt: null,
      },
      select: { id: true },
    });
  });
});
