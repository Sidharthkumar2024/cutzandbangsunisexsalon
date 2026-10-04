import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoiceFindMany: vi.fn(),
  invoiceFindUnique: vi.fn(),
  invoiceUpdate: vi.fn(),
  invoiceCount: vi.fn(),
  invoiceAggregate: vi.fn(),
  membershipFindMany: vi.fn(),
  transaction: vi.fn(),
  storageGet: vi.fn(),
  storagePut: vi.fn(),
  storageSignedUrl: vi.fn(),
  retireLegacyPublicObject: vi.fn(),
  enqueueEmail: vi.fn(),
  audit: vi.fn(),
  auditLogFindMany: vi.fn(),
  txQueryRaw: vi.fn(),
  txInvoiceFindUnique: vi.fn(),
  txInvoiceUpdate: vi.fn(),
  txPaymentCreate: vi.fn(),
  applyProviderSettings: vi.fn(),
  whatsappSend: vi.fn(),
  whatsappHealth: vi.fn(),
}));

vi.mock("@cutz/db", () => ({
  prisma: {
    invoice: {
      findMany: mocks.invoiceFindMany,
      findUnique: mocks.invoiceFindUnique,
      update: mocks.invoiceUpdate,
      count: mocks.invoiceCount,
      aggregate: mocks.invoiceAggregate,
    },
    membership: { findMany: mocks.membershipFindMany },
    auditLog: { findMany: mocks.auditLogFindMany },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@cutz/providers", () => ({
  EVOLUTION_INLINE_MEDIA_MAX_BYTES: 8 * 1024 * 1024,
  providers: {
    storage: () => ({
      get: mocks.storageGet,
      put: mocks.storagePut,
      signedUrl: mocks.storageSignedUrl,
      retireLegacyPublicObject: mocks.retireLegacyPublicObject,
    }),
  },
  invoiceEmail: vi.fn(() => "<p>invoice</p>"),
  isRestrictedEvolutionHost: vi.fn(() => false),
}));
vi.mock("@cutz/queue", () => ({ enqueueEmail: mocks.enqueueEmail }));
vi.mock("../../lib/audit.js", () => ({ audit: mocks.audit }));
vi.mock("../provider-config/config.js", () => ({ applyProviderSettings: mocks.applyProviderSettings }));

import posRoutes from "./routes.js";

async function testApp(role: "OWNER" | "MANAGER" = "OWNER") {
  const app = Fastify();
  app.decorateRequest("user", undefined);
  app.addHook("onRequest", async (req) => {
    req.user = {
      id: `${role.toLowerCase()}-1`,
      role,
      branchId: role === "MANAGER" ? "dwarka" : null,
      permissionKeys: [],
    };
  });
  await app.register(posRoutes);
  return app;
}

describe("invoice archive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auditLogFindMany.mockResolvedValue([]);
    mocks.whatsappHealth.mockResolvedValue(undefined);
    mocks.applyProviderSettings.mockResolvedValue({
      whatsapp: () => ({ send: mocks.whatsappSend, health: mocks.whatsappHealth }),
    });
  });

  it("returns a searchable paginated archive with finance totals and download paths", async () => {
    mocks.invoiceFindMany.mockResolvedValue([
      {
        id: "invoice-1",
        number: "CB-2026-000001",
        status: "PAID",
        subtotalMinor: 150_000,
        discountMinor: 0,
        taxMinor: 27_000,
        totalMinor: 177_000,
        paidMinor: 177_000,
        pdfUrl: "invoices/CB-2026-000001.pdf",
        issuedAt: new Date("2026-08-24T12:00:00.000Z"),
        createdAt: new Date("2026-08-24T12:00:00.000Z"),
        customer: { id: "customer-1", name: "Sidharth", email: null, phone: "9999999999" },
      },
    ]);
    mocks.invoiceCount.mockResolvedValue(1);
    mocks.invoiceAggregate.mockResolvedValue({ _sum: { totalMinor: 177_000, paidMinor: 177_000 } });
    const app = await testApp();

    const response = await app.inject({
      method: "GET",
      url: "/invoices/archive?branchId=dwarka&q=9999&status=PAID&page=1&pageSize=20",
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.invoiceFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ branchId: "dwarka", status: "PAID", OR: expect.any(Array) }),
      skip: 0,
      take: 20,
    }));
    expect(response.json()).toEqual(expect.objectContaining({
      total: 1,
      totalPages: 1,
      summary: { totalMinor: 177_000, paidMinor: 177_000, balanceMinor: 0 },
      items: [expect.objectContaining({
        id: "invoice-1",
        pdfReady: true,
        downloadPath: "/api/v1/invoices/invoice-1/pdf?download=1",
      })],
    }));
    await app.close();
  });

  it("enforces the signed-in branch for manager archive reads", async () => {
    mocks.invoiceFindMany.mockResolvedValue([]);
    mocks.invoiceCount.mockResolvedValue(0);
    mocks.invoiceAggregate.mockResolvedValue({ _sum: { totalMinor: null, paidMinor: null } });
    const app = await testApp("MANAGER");

    const response = await app.inject({ method: "GET", url: "/invoices/archive?branchId=another-branch" });

    expect(response.statusCode).toBe(200);
    expect(mocks.invoiceFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ branchId: "dwarka" }),
    }));
    await app.close();
  });

  it("serves an archived PDF as an attachment without exposing the storage key", async () => {
    mocks.invoiceFindUnique.mockResolvedValue({
      id: "invoice-1",
      pdfUrl: "invoices/v2/private.pdf",
      number: "CB-2026-000001",
      branchId: "dwarka",
    });
    mocks.storageGet.mockResolvedValue(Buffer.from("%PDF-private"));
    const app = await testApp();

    const response = await app.inject({ method: "GET", url: "/invoices/invoice-1/pdf?download=1" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/pdf");
    expect(response.headers["content-disposition"]).toBe('attachment; filename="CB-2026-000001.pdf"');
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.body).toBe("%PDF-private");
    await app.close();
  });

  it("retires a legacy public key before lazily storing the v2 PDF", async () => {
    mocks.invoiceFindUnique
      .mockResolvedValueOnce({
        pdfUrl: "invoices/CB-2026-000001.pdf",
        number: "CB-2026-000001",
        branchId: "dwarka",
      })
      .mockResolvedValueOnce({
        id: "invoice-1",
        pdfUrl: "invoices/CB-2026-000001.pdf",
        number: "CB-2026-000001",
        issuedAt: new Date("2026-08-24T12:00:00.000Z"),
        createdAt: new Date("2026-08-24T12:00:00.000Z"),
        subtotalMinor: 100_000,
        discountMinor: 0,
        taxMinor: 18_000,
        totalMinor: 118_000,
        paidMinor: 118_000,
        items: [],
        customer: { name: "Sidharth" },
        branch: { name: "Cutz & Bangs", address: "Dwarka", currency: "INR" },
      });
    mocks.storagePut.mockResolvedValue("invoices/v2/CB-2026-000001.pdf");
    mocks.invoiceUpdate.mockResolvedValue({ id: "invoice-1" });
    const app = await testApp();

    const response = await app.inject({ method: "GET", url: "/invoices/invoice-1/pdf" });

    expect(response.statusCode).toBe(200);
    expect(mocks.storageGet).not.toHaveBeenCalledWith("invoices/CB-2026-000001.pdf");
    expect(mocks.retireLegacyPublicObject).toHaveBeenCalledWith("invoices/CB-2026-000001.pdf");
    expect(mocks.storagePut).toHaveBeenCalledWith(
      "invoices/v2/CB-2026-000001.pdf",
      expect.any(Buffer),
      "application/pdf",
    );
    expect(mocks.invoiceUpdate).toHaveBeenCalledWith({
      where: { id: "invoice-1" },
      data: { pdfUrl: "invoices/v2/CB-2026-000001.pdf" },
    });
    await app.close();
  });

  it("regenerates a missing v2 object before queuing an invoice email", async () => {
    mocks.invoiceFindUnique
      .mockResolvedValueOnce({
        id: "invoice-1",
        pdfUrl: "invoices/v2/CB-2026-000001.pdf",
        number: "CB-2026-000001",
        branchId: "dwarka",
        totalMinor: 118_000,
        customer: { name: "Sidharth", email: "customer@example.com", phone: null, waConsent: false },
      })
      .mockResolvedValueOnce({
        id: "invoice-1",
        pdfUrl: "invoices/v2/CB-2026-000001.pdf",
        number: "CB-2026-000001",
        issuedAt: new Date("2026-08-24T12:00:00.000Z"),
        createdAt: new Date("2026-08-24T12:00:00.000Z"),
        subtotalMinor: 100_000,
        discountMinor: 0,
        taxMinor: 18_000,
        totalMinor: 118_000,
        paidMinor: 118_000,
        items: [],
        customer: { name: "Sidharth" },
        branch: { name: "Cutz & Bangs", address: "Dwarka", currency: "INR" },
      });
    mocks.storageGet.mockResolvedValue(null);
    mocks.storagePut.mockResolvedValue("invoices/v2/CB-2026-000001.pdf");
    mocks.invoiceUpdate.mockResolvedValue({ id: "invoice-1" });
    const app = await testApp();

    const response = await app.inject({
      method: "POST",
      url: "/invoices/invoice-1/send",
      payload: { channel: "EMAIL" },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.storageGet).toHaveBeenCalledWith("invoices/v2/CB-2026-000001.pdf");
    expect(mocks.storagePut).toHaveBeenCalledWith(
      "invoices/v2/CB-2026-000001.pdf",
      expect.any(Buffer),
      "application/pdf",
    );
    expect(mocks.enqueueEmail).toHaveBeenCalledWith(expect.objectContaining({
      attachments: [{ filename: "CB-2026-000001.pdf", storageKey: "invoices/v2/CB-2026-000001.pdf" }],
    }));
    await app.close();
  });

  it("reports that local-only invoice media cannot be sent to official WhatsApp", async () => {
    mocks.invoiceFindUnique.mockResolvedValue({
      id: "invoice-1",
      pdfUrl: "invoices/v2/CB-2026-000001.pdf",
      number: "CB-2026-000001",
      branchId: "dwarka",
      totalMinor: 118_000,
      customer: { name: "Ishita Priya", email: null, phone: "+919876543210", waConsent: true },
    });
    mocks.storageGet.mockResolvedValue(Buffer.from("%PDF-private"));
    mocks.storageSignedUrl.mockResolvedValue("local://invoices/v2/CB-2026-000001.pdf");
    const app = await testApp();

    const response = await app.inject({
      method: "POST",
      url: "/invoices/invoice-1/send",
      payload: { channel: "WHATSAPP_OFFICIAL" },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: "invoice_public_url_required",
      channel: "WHATSAPP_OFFICIAL",
    });
    expect(mocks.whatsappSend).not.toHaveBeenCalled();
    await app.close();
  });

  it("sends a local invoice PDF inline to unofficial Evolution without exposing a file route", async () => {
    const pdf = Buffer.from("%PDF-private");
    mocks.invoiceFindUnique.mockResolvedValue({
      id: "invoice-1",
      pdfUrl: "invoices/v2/CB-2026-000001.pdf",
      number: "CB-2026-000001",
      branchId: "dwarka",
      totalMinor: 118_000,
      customer: { name: "Ishita Priya", email: null, phone: "+919876543210", waConsent: true },
    });
    mocks.storageGet.mockResolvedValue(pdf);
    mocks.whatsappSend.mockResolvedValue({ externalId: "waha-inline", status: "sent" });
    const app = await testApp();

    const response = await app.inject({
      method: "POST",
      url: "/invoices/invoice-1/send",
      payload: { channel: "WHATSAPP_UNOFFICIAL" },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.storageSignedUrl).not.toHaveBeenCalled();
    expect(mocks.whatsappSend).toHaveBeenCalledWith({
      to: "+919876543210",
      body: "Thank you for visiting Cutz & Bangs.\nInvoice CB-2026-000001 · ₹1,180.00\nLoved your visit? Please review us: https://maps.app.goo.gl/1FgtMd6URf8T6G53A",
      mediaUrl: undefined,
      mediaData: pdf.toString("base64"),
      mediaMimeType: "application/pdf",
      mediaFilename: "CB-2026-000001.pdf",
      mediaType: "document",
    });
    await app.close();
  });

  it("reports an unconfigured official provider before attempting delivery", async () => {
    mocks.invoiceFindUnique.mockResolvedValue({
      id: "invoice-1",
      pdfUrl: "invoices/v2/CB-2026-000001.pdf",
      number: "CB-2026-000001",
      branchId: "dwarka",
      totalMinor: 118_000,
      customer: { name: "Ishita Priya", email: null, phone: "+919876543210", waConsent: true },
    });
    mocks.storageGet.mockResolvedValue(Buffer.from("%PDF-private"));
    mocks.whatsappHealth.mockResolvedValue({
      configured: false,
      connected: false,
      detail: "Add the Meta token and phone-number ID.",
    });
    const app = await testApp();

    const response = await app.inject({
      method: "POST",
      url: "/invoices/invoice-1/send",
      payload: { channel: "WHATSAPP_OFFICIAL" },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: "wa_official_not_configured",
      channel: "WHATSAPP_OFFICIAL",
      detail: "Add the Meta token and phone-number ID.",
    });
    expect(mocks.storageSignedUrl).not.toHaveBeenCalled();
    expect(mocks.whatsappSend).not.toHaveBeenCalled();
    await app.close();
  });

  it("preserves actionable Meta rejection details in the invoice response", async () => {
    mocks.invoiceFindUnique.mockResolvedValue({
      id: "invoice-1",
      pdfUrl: "invoices/v2/CB-2026-000001.pdf",
      number: "CB-2026-000001",
      branchId: "dwarka",
      totalMinor: 118_000,
      customer: { name: "Ishita Priya", email: null, phone: "+919876543210", waConsent: true },
    });
    mocks.storageGet.mockResolvedValue(Buffer.from("%PDF-private"));
    mocks.storageSignedUrl.mockResolvedValue("https://media.example.com/invoices/CB-2026-000001.pdf?sig=test");
    mocks.whatsappSend.mockResolvedValue({
      externalId: "",
      status: "failed",
      error: "wa_official_rejected",
      detail: "Use an approved template outside the customer service window.",
      providerCode: "131047",
    });
    const app = await testApp();

    const response = await app.inject({
      method: "POST",
      url: "/invoices/invoice-1/send",
      payload: { channel: "WHATSAPP_OFFICIAL" },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      externalId: "",
      status: "failed",
      error: "wa_official_rejected",
      detail: "Use an approved template outside the customer service window.",
      providerCode: "131047",
      channel: "WHATSAPP_OFFICIAL",
    });
    await app.close();
  });

  it("returns the provider message id when Meta accepts an invoice", async () => {
    mocks.invoiceFindUnique.mockResolvedValue({
      id: "invoice-1",
      pdfUrl: "invoices/v2/CB-2026-000001.pdf",
      number: "CB-2026-000001",
      branchId: "dwarka",
      totalMinor: 118_000,
      customer: { name: "Ishita Priya", email: null, phone: "+919876543210", waConsent: true },
    });
    mocks.storageGet.mockResolvedValue(Buffer.from("%PDF-private"));
    mocks.storageSignedUrl.mockResolvedValue("https://media.example.com/invoices/CB-2026-000001.pdf?sig=test");
    mocks.whatsappSend.mockResolvedValue({ externalId: "wamid.accepted", status: "sent" });
    const app = await testApp();

    const response = await app.inject({
      method: "POST",
      url: "/invoices/invoice-1/send",
      payload: { channel: "WHATSAPP_OFFICIAL" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      queued: false,
      channel: "WHATSAPP_OFFICIAL",
      status: "sent",
      externalId: "wamid.accepted",
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      "invoice.send",
      "Invoice",
      "invoice-1",
      expect.objectContaining({ after: expect.objectContaining({ channel: "WHATSAPP_OFFICIAL", status: "sent" }) }),
    );
    await app.close();
  });

  it("invalidates a stored PDF when a later payment changes paid/status values", async () => {
    mocks.invoiceFindUnique.mockResolvedValue({
      id: "invoice-1",
      branchId: "dwarka",
      customerId: null,
      status: "ISSUED",
      paidMinor: 0,
      totalMinor: 100_000,
      pdfUrl: "invoices/v2/CB-2026-000001.pdf",
    });
    mocks.txQueryRaw.mockResolvedValue([{ locked: true }]);
    mocks.txInvoiceFindUnique.mockResolvedValue({ paidMinor: 0, totalMinor: 100_000, status: "ISSUED" });
    mocks.txInvoiceUpdate.mockResolvedValue({
      id: "invoice-1",
      branchId: "dwarka",
      customerId: null,
      totalMinor: 100_000,
      paidMinor: 50_000,
      status: "PARTIALLY_PAID",
      payments: [],
    });
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
      $queryRaw: mocks.txQueryRaw,
      invoice: { findUnique: mocks.txInvoiceFindUnique, update: mocks.txInvoiceUpdate },
      payment: { create: mocks.txPaymentCreate },
    }));
    const app = await testApp();

    const response = await app.inject({
      method: "POST",
      url: "/invoices/invoice-1/payments",
      payload: { payments: [{ method: "CASH", amountMinor: 50_000 }] },
    });

    expect(response.statusCode).toBe(201);
    expect(mocks.txInvoiceUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "invoice-1" },
      data: { paidMinor: 50_000, status: "PARTIALLY_PAID", pdfUrl: null },
    }));
    await app.close();
  });
});
