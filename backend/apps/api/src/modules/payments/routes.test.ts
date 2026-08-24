import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reconciliationFindMany: vi.fn(),
  reconciliationFindUnique: vi.fn(),
  reconciliationCreate: vi.fn(),
  paymentFindFirst: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@cutz/db", () => ({
  prisma: {
    paymentReconciliation: {
      findMany: mocks.reconciliationFindMany,
      findUnique: mocks.reconciliationFindUnique,
      create: mocks.reconciliationCreate,
    },
    payment: { findFirst: mocks.paymentFindFirst },
  },
}));
vi.mock("@cutz/providers", () => ({ providers: { payment: () => ({ createIntent: vi.fn() }) } }));
vi.mock("../../lib/audit.js", () => ({ audit: mocks.audit }));

import paymentRoutes from "./routes.js";

async function testApp(branchId: string | null = "dwarka") {
  const app = Fastify();
  app.decorateRequest("user", undefined);
  app.addHook("onRequest", async (req) => {
    req.user = { id: "manager-1", role: "MANAGER", branchId, permissionKeys: [] };
  });
  await app.register(paymentRoutes);
  return app;
}

describe("payment reconciliation branch isolation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("filters reconciliation reads to the manager's branch", async () => {
    mocks.reconciliationFindMany.mockResolvedValue([]);
    const app = await testApp();
    const response = await app.inject({ method: "GET", url: "/payments/reconciliation?status=PENDING" });
    expect(response.statusCode).toBe(200);
    expect(mocks.reconciliationFindMany).toHaveBeenCalledWith({
      where: { branchId: "dwarka", status: "PENDING" },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    await app.close();
  });

  it("rejects a manager requesting another branch", async () => {
    const app = await testApp();
    const response = await app.inject({ method: "GET", url: "/payments/reconciliation?branchId=gurugram" });
    expect(response.statusCode).toBe(403);
    expect(mocks.reconciliationFindMany).not.toHaveBeenCalled();
    await app.close();
  });

  it("deduplicates and matches references inside the resolved branch", async () => {
    mocks.reconciliationFindUnique.mockResolvedValue(null);
    mocks.paymentFindFirst.mockResolvedValue({ id: "payment-1", amountMinor: 50000 });
    mocks.reconciliationCreate.mockResolvedValue({ id: "reconciliation-1", branchId: "dwarka", status: "MATCHED" });
    const app = await testApp();
    const response = await app.inject({ method: "POST", url: "/payments/reconciliation", payload: { provider: "upi", externalRef: "txn-123", amountMinor: 50000 } });
    expect(response.statusCode).toBe(201);
    expect(mocks.reconciliationFindUnique).toHaveBeenCalledWith({ where: { branchId_provider_externalRef: { branchId: "dwarka", provider: "upi", externalRef: "txn-123" } } });
    expect(mocks.paymentFindFirst).toHaveBeenCalledWith({ where: { reference: "txn-123", invoice: { branchId: "dwarka" } }, orderBy: { createdAt: "desc" } });
    expect(mocks.reconciliationCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ branchId: "dwarka", paymentId: "payment-1", status: "MATCHED" }) });
    await app.close();
  });
});
