import { describe, expect, it, vi } from "vitest";
import { authorize, permissionForPath } from "./auth.js";

function replyMock() {
  const reply = { code: vi.fn(), send: vi.fn() };
  reply.code.mockReturnValue(reply);
  reply.send.mockReturnValue(reply);
  return reply;
}

describe("role authorization", () => {
  it("rejects requests without an authenticated session", async () => {
    const reply = replyMock();
    await authorize("OWNER")({} as never, reply as never);
    expect(reply.code).toHaveBeenCalledWith(401);
  });

  it("rejects an authenticated user with the wrong role", async () => {
    const reply = replyMock();
    await authorize("OWNER")({ user: { id: "staff-1", role: "STAFF", branchId: "main" } } as never, reply as never);
    expect(reply.code).toHaveBeenCalledWith(403);
  });

  it("allows an authenticated user with an accepted role", async () => {
    const reply = replyMock();
    await authorize("OWNER", "ADMIN")({ user: { id: "owner-1", role: "OWNER", branchId: "main" } } as never, reply as never);
    expect(reply.code).not.toHaveBeenCalled();
  });
});

describe("workspace permission routing", () => {
  it.each([
    ["/payments/reconciliation", "pos"],
    ["/scan/barcode/sku-1", "pos"],
    ["/purchase-bills/bill-1/confirm", "inventory"],
    ["/channels/WHATSAPP_UNOFFICIAL", "inbox"],
    ["/team-accounts", "staff"],
    ["/branches", "settings"],
    ["/maintenance/run", "settings"],
  ])("maps %s to the %s grant", (path, permission) => {
    expect(permissionForPath(path)).toBe(permission);
  });
});
