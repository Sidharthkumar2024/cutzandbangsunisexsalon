import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  membershipFindFirst: vi.fn(),
}));

vi.mock("@cutz/db", () => ({
  prisma: {
    tenantMembership: {
      findFirst: mocks.membershipFindFirst,
    },
  },
}));

import { canAccessTenant, resolveTenantScope } from "./tenant-scope.js";

describe("tenant scope", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lets platform superadmins choose any tenant", async () => {
    await expect(resolveTenantScope({ id: "platform-1", role: "SUPERADMIN", activeTenantId: null, branchId: null }, "salon-a"))
      .resolves.toEqual({ ok: true, tenantId: "salon-a" });
    expect(mocks.membershipFindFirst).not.toHaveBeenCalled();
  });

  it("requires a real active membership for salon users", async () => {
    mocks.membershipFindFirst.mockResolvedValueOnce({ tenantId: "salon-a" });
    await expect(resolveTenantScope({ id: "owner-1", role: "OWNER", activeTenantId: "salon-a", branchId: "branch-a" }))
      .resolves.toEqual({ ok: true, tenantId: "salon-a" });
    expect(mocks.membershipFindFirst).toHaveBeenCalledWith({
      where: { tenantId: "salon-a", userId: "owner-1", isActive: true, tenant: { deletedAt: null } },
      select: { tenantId: true },
    });
  });

  it("fails closed when a user tries another tenant", async () => {
    mocks.membershipFindFirst.mockResolvedValueOnce(null);
    await expect(canAccessTenant({ id: "staff-1", role: "STAFF", activeTenantId: "salon-a", branchId: "branch-a" }, "salon-b"))
      .resolves.toBe(false);
  });
});
