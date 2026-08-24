import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  invoiceFindUnique: vi.fn(),
  invoiceUpdate: vi.fn(),
  paymentCreate: vi.fn(),
  membershipRefundGroup: vi.fn(),
  invoiceRefundCreate: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@cutz/db", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("../../lib/audit.js", () => ({ audit: mocks.audit }));
vi.mock("../memberships/ledger.js", () => ({ refund: vi.fn() }));
vi.mock("../loyalty/ledger.js", () => ({ getLoyaltyRules: vi.fn(), postLoyaltyEntry: vi.fn() }));

import refundRoutes from "./routes.js";

describe("refund invoice PDF invalidation", () => {
  it("clears pdfUrl when refund accounting changes paid/status values", async () => {
    mocks.queryRaw.mockResolvedValue([{ id: "invoice-1" }]);
    mocks.invoiceFindUnique.mockResolvedValue({
      id: "invoice-1",
      number: "CB-2026-000001",
      branchId: "dwarka",
      customerId: null,
      status: "PAID",
      totalMinor: 100_000,
      paidMinor: 100_000,
      notes: null,
      pdfUrl: "invoices/v2/CB-2026-000001.pdf",
      items: [{ id: "item-1", qty: 1, lineTotalMinor: 100_000, kind: "service", productId: null }],
      payments: [{ amountMinor: 100_000, method: "CASH", membershipId: null }],
      refunds: [],
    });
    mocks.membershipRefundGroup.mockResolvedValue([]);
    mocks.invoiceUpdate.mockResolvedValue({ status: "VOID" });
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
      $queryRaw: mocks.queryRaw,
      invoice: { findUnique: mocks.invoiceFindUnique, update: mocks.invoiceUpdate },
      membershipLedger: { groupBy: mocks.membershipRefundGroup },
      payment: { create: mocks.paymentCreate },
      invoiceRefund: { create: mocks.invoiceRefundCreate },
    }));

    const app = Fastify();
    app.decorateRequest("user", undefined);
    app.addHook("onRequest", async (req) => {
      req.user = { id: "owner-1", role: "OWNER", branchId: null, permissionKeys: [] };
    });
    await app.register(refundRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/invoices/invoice-1/refund",
      payload: {
        items: [{ invoiceItemId: "item-1", qty: 1 }],
        method: "CASH",
        reason: "Customer requested refund",
        restock: false,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.invoiceUpdate).toHaveBeenCalledWith({
      where: { id: "invoice-1" },
      data: {
        paidMinor: 0,
        status: "VOID",
        notes: "Refunded 100000 (Customer requested refund)",
        pdfUrl: null,
      },
    });
    await app.close();
  });
});
