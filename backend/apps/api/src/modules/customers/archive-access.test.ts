import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  customerFindFirst: vi.fn(),
  branchFindUnique: vi.fn(),
  invoiceFindFirst: vi.fn(),
  signedUrl: vi.fn(),
}));

vi.mock("@cutz/db", () => ({
  prisma: {
    customer: { findFirst: mocks.customerFindFirst },
    branch: { findUnique: mocks.branchFindUnique },
    invoice: { findFirst: mocks.invoiceFindFirst },
  },
}));
vi.mock("@cutz/providers", () => ({
  providers: {
    storage: () => ({ signedUrl: mocks.signedUrl }),
  },
  staffInvitationEmail: vi.fn(),
}));
vi.mock("@cutz/queue", () => ({
  enqueueEmail: vi.fn(),
  enqueueReminder: vi.fn(),
  cancelReminders: vi.fn(),
}));
vi.mock("../../lib/audit.js", () => ({ audit: vi.fn() }));
vi.mock("../../lib/appointmentNotifications.js", () => ({ notifyAppointment: vi.fn() }));

import bookingRoutes from "../bookings/routes.js";
import mediaRoutes from "../media/routes.js";
import platformRoutes from "../platform/routes.js";

type TestRole = "CUSTOMER" | "OWNER";

async function testApp(
  routes: (app: ReturnType<typeof Fastify>) => Promise<void>,
  role: TestRole = "CUSTOMER",
) {
  const app = Fastify();
  app.decorateRequest("user", undefined);
  app.addHook("onRequest", async (req) => {
    req.user = { id: "customer-user-1", role, branchId: "dwarka", permissionKeys: [] };
  });
  await app.register(routes);
  return app;
}

describe("archived customer access boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.customerFindFirst.mockResolvedValue(null);
    mocks.branchFindUnique.mockResolvedValue({ id: "dwarka", timezone: "Asia/Kolkata" });
  });

  it("does not resolve an archived customer in the customer portal", async () => {
    const app = await testApp(platformRoutes);
    const response = await app.inject({ method: "GET", url: "/portal/customer/overview" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "customer_profile_not_found" });
    expect(mocks.customerFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "customer-user-1", deletedAt: null },
    }));
    await app.close();
  });

  it("does not issue a signed invoice URL for an archived customer", async () => {
    const app = await testApp(mediaRoutes);
    const response = await app.inject({
      method: "GET",
      url: "/media/url?key=invoices%2Fdwarka%2Finvoice-1.pdf",
    });

    expect(response.statusCode).toBe(403);
    expect(mocks.customerFindFirst).toHaveBeenCalledWith({
      where: { userId: "customer-user-1", deletedAt: null },
      select: { id: true },
    });
    expect(mocks.invoiceFindFirst).not.toHaveBeenCalled();
    expect(mocks.signedUrl).not.toHaveBeenCalled();
    await app.close();
  });

  it("does not create a booking for an archived customer id", async () => {
    const app = await testApp(bookingRoutes);
    const response = await app.inject({
      method: "POST",
      url: "/bookings",
      payload: {
        branchId: "dwarka",
        customerId: "customer-1",
        items: [{ serviceId: "service-1", staffId: "staff-1", startAt: "2026-09-01T06:00:00.000Z" }],
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "customer_not_found" });
    expect(mocks.customerFindFirst).toHaveBeenCalledWith({
      where: { id: "customer-1", deletedAt: null },
      select: { userId: true, branchId: true },
    });
    await app.close();
  });
});
