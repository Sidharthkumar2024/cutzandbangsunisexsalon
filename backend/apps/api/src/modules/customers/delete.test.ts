import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  customerFindMany: vi.fn(),
  customerFindFirst: vi.fn(),
  customerUpdate: vi.fn(),
  customerDelete: vi.fn(),
  companionFindFirst: vi.fn(),
  userUpdate: vi.fn(),
  sessionDeleteMany: vi.fn(),
  transaction: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@cutz/db", () => ({
  prisma: {
    customer: {
      findMany: mocks.customerFindMany,
      findFirst: mocks.customerFindFirst,
      update: mocks.customerUpdate,
      delete: mocks.customerDelete,
    },
    customerCompanion: { findFirst: mocks.companionFindFirst },
    user: { update: mocks.userUpdate },
    session: { deleteMany: mocks.sessionDeleteMany },
    $transaction: mocks.transaction,
  },
}));
vi.mock("../../lib/audit.js", () => ({ audit: mocks.audit }));

import customerRoutes from "./routes.js";

type AllowedRole = "OWNER" | "ADMIN" | "MANAGER";
type TestRole = AllowedRole | "RECEPTION" | "STAFF";

async function testApp(role: TestRole, branchId: string | null = "dwarka") {
  const app = Fastify();
  app.decorateRequest("user", undefined);
  app.addHook("onRequest", async (req) => {
    req.user = { id: `${role.toLowerCase()}-1`, role, branchId, permissionKeys: [] };
  });
  await app.register(customerRoutes);
  return app;
}

const customer = {
  id: "customer-1",
  branchId: "dwarka",
  name: "Archived Customer",
  phone: "9999999999",
  deletedAt: null,
  user: { id: "customer-user-1", role: "CUSTOMER", isActive: true },
};

describe("customer soft deletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.customerFindFirst.mockResolvedValue(customer);
    mocks.customerUpdate.mockImplementation(async ({ data }: { data: { deletedAt: Date } }) => ({ ...customer, ...data }));
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        customer: {
          findFirst: mocks.customerFindFirst,
          update: mocks.customerUpdate,
          delete: mocks.customerDelete,
        },
        user: { update: mocks.userUpdate },
        session: { deleteMany: mocks.sessionDeleteMany },
      }),
    );
  });

  it.each<AllowedRole>(["OWNER", "ADMIN", "MANAGER"])("allows %s to archive a customer without deleting history", async (role) => {
    const app = await testApp(role);
    const response = await app.inject({ method: "DELETE", url: "/customers/customer-1" });

    expect(response.statusCode).toBe(204);
    expect(mocks.customerFindFirst).toHaveBeenCalledWith({
      where: {
        id: "customer-1",
        deletedAt: null,
        ...(role === "MANAGER" ? { branchId: "dwarka" } : {}),
      },
      include: { user: { select: { id: true, role: true, isActive: true } } },
    });
    expect(mocks.customerUpdate).toHaveBeenCalledWith({
      where: { id: "customer-1" },
      data: { deletedAt: expect.any(Date) },
    });
    expect(mocks.customerDelete).not.toHaveBeenCalled();
    expect(mocks.userUpdate).toHaveBeenCalledWith({
      where: { id: "customer-user-1" },
      data: { isActive: false },
    });
    expect(mocks.sessionDeleteMany).toHaveBeenCalledWith({ where: { userId: "customer-user-1" } });
    expect(mocks.audit).toHaveBeenCalledWith(
      "customer.archive",
      "Customer",
      "customer-1",
      expect.objectContaining({
        actorUserId: `${role.toLowerCase()}-1`,
        before: customer,
        after: { deletedAt: expect.any(Date), customerAccessRevoked: true },
      }),
      expect.any(Object),
    );
    await app.close();
  });

  it.each<TestRole>(["RECEPTION", "STAFF"])("denies %s before touching customer data", async (role) => {
    const app = await testApp(role);
    const response = await app.inject({ method: "DELETE", url: "/customers/customer-1" });

    expect(response.statusCode).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.customerUpdate).not.toHaveBeenCalled();
    await app.close();
  });

  it("scopes manager deletion to the manager's branch", async () => {
    mocks.customerFindFirst.mockImplementation(async ({ where }: { where: { branchId?: string } }) =>
      where.branchId === customer.branchId ? customer : null,
    );
    const app = await testApp("MANAGER", "gurugram");
    const response = await app.inject({ method: "DELETE", url: "/customers/customer-1" });

    expect(response.statusCode).toBe(404);
    expect(mocks.customerFindFirst).toHaveBeenCalledWith({
      where: { id: "customer-1", branchId: "gurugram", deletedAt: null },
      include: { user: { select: { id: true, role: true, isActive: true } } },
    });
    expect(mocks.customerUpdate).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    await app.close();
  });

  it("does not disable a linked non-customer account", async () => {
    mocks.customerFindFirst.mockResolvedValue({
      ...customer,
      user: { id: "manager-user-1", role: "MANAGER", isActive: true },
    });
    const app = await testApp("OWNER");
    const response = await app.inject({ method: "DELETE", url: "/customers/customer-1" });

    expect(response.statusCode).toBe(204);
    expect(mocks.customerUpdate).toHaveBeenCalledOnce();
    expect(mocks.userUpdate).not.toHaveBeenCalled();
    expect(mocks.sessionDeleteMany).not.toHaveBeenCalled();
    await app.close();
  });

  it("treats an already archived customer as unavailable", async () => {
    mocks.customerFindFirst.mockResolvedValue(null);
    const app = await testApp("OWNER");
    const response = await app.inject({ method: "DELETE", url: "/customers/customer-1" });

    expect(response.statusCode).toBe(404);
    expect(mocks.customerUpdate).not.toHaveBeenCalled();
    expect(mocks.userUpdate).not.toHaveBeenCalled();
    expect(mocks.sessionDeleteMany).not.toHaveBeenCalled();
    await app.close();
  });

  it("keeps archived customers out of the normal list", async () => {
    mocks.customerFindMany.mockResolvedValue([]);
    const app = await testApp("MANAGER");
    const response = await app.inject({ method: "GET", url: "/customers" });

    expect(response.statusCode).toBe(200);
    expect(mocks.customerFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { branchId: "dwarka", deletedAt: null },
    }));
    await app.close();
  });

  it("fails closed when a non-owner account has no branch scope", async () => {
    const app = await testApp("MANAGER", null);
    const response = await app.inject({ method: "GET", url: "/customers" });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "branch_required" });
    expect(mocks.customerFindMany).not.toHaveBeenCalled();
    await app.close();
  });

  it("does not return an archived customer from the customer timeline endpoint", async () => {
    mocks.customerFindFirst.mockResolvedValue(null);
    const app = await testApp("OWNER");
    const response = await app.inject({ method: "GET", url: "/customers/customer-1" });

    expect(response.statusCode).toBe(404);
    expect(mocks.customerFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "customer-1", deletedAt: null },
    }));
    await app.close();
  });

  it.each([
    { method: "PATCH", url: "/customers/customer-1", payload: { name: "Changed" }, error: "not_found" },
    { method: "POST", url: "/customers/customer-1/history", payload: { visitedAt: "2026-08-01", serviceName: "Haircut" }, error: "not_found" },
    { method: "POST", url: "/customers/customer-1/companions", payload: { name: "Family member" }, error: "not_found" },
  ] as const)("rejects archived customer mutation $method $url", async ({ method, url, payload, error }) => {
    mocks.customerFindFirst.mockResolvedValue(null);
    const app = await testApp("OWNER");
    const response = await app.inject({ method, url, payload });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error });
    expect(mocks.customerUpdate).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    await app.close();
  });

  it.each([
    { method: "PATCH", url: "/customers/customer-1/companions/companion-1", payload: { name: "Changed" } },
    { method: "DELETE", url: "/customers/customer-1/companions/companion-1", payload: undefined },
  ] as const)("rejects archived parent for companion mutation $method $url", async ({ method, url, payload }) => {
    mocks.companionFindFirst.mockResolvedValue(null);
    const app = await testApp("OWNER");
    const response = await app.inject({ method, url, ...(payload ? { payload } : {}) });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "companion_not_found" });
    expect(mocks.companionFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ customer: { deletedAt: null } }),
    }));
    await app.close();
  });
});
