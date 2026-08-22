import { describe, expect, it, vi } from "vitest";
import { grant, redeem, InsufficientCreditError } from "./ledger.js";

function transaction(balanceMinor: number) {
  const membershipLedger = { create: vi.fn().mockResolvedValue({}) };
  const membership = {
    findUnique: vi.fn().mockResolvedValue({ id: "membership-1", balanceMinor }),
    update: vi.fn().mockResolvedValue({}),
  };
  return { tx: { membership, membershipLedger } as never, membership, membershipLedger };
}

describe("membership ledger", () => {
  it("appends opening credit and updates the cached balance in the same transaction", async () => {
    const mock = transaction(0);
    await expect(grant(mock.tx, "membership-1", 500_000, "owner-1")).resolves.toBe(500_000);
    expect(mock.membershipLedger.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: "CREDIT", deltaMinor: 500_000, balanceAfter: 500_000 }) });
    expect(mock.membership.update).toHaveBeenCalledWith({ where: { id: "membership-1" }, data: { balanceMinor: 500_000 } });
  });

  it("posts redemption against an invoice", async () => {
    const mock = transaction(500_000);
    await expect(redeem(mock.tx, "membership-1", 125_000, "invoice-1", "owner-1")).resolves.toBe(375_000);
    expect(mock.membershipLedger.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: "REDEEM", deltaMinor: -125_000, balanceAfter: 375_000, invoiceId: "invoice-1" }) });
  });

  it("rejects redemptions that exceed the immutable ledger balance", async () => {
    const mock = transaction(50_000);
    await expect(redeem(mock.tx, "membership-1", 75_000, "invoice-1")).rejects.toBeInstanceOf(InsufficientCreditError);
    expect(mock.membershipLedger.create).not.toHaveBeenCalled();
    expect(mock.membership.update).not.toHaveBeenCalled();
  });
});
