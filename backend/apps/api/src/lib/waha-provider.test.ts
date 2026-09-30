import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isRestrictedWahaHost,
  validateWahaBaseUrl,
  WAHA_INLINE_MEDIA_MAX_BYTES,
  WhatsAppUnofficialProvider,
} from "@cutz/providers";

const config = {
  enabled: true,
  baseUrl: "http://127.0.0.1:3005",
  apiKey: "a-secure-waha-api-key-123456",
  webhookSecret: "a-separate-webhook-secret-123",
  session: "cutz-bangs-main",
};

const previousAllowedOrigins = process.env.WAHA_ALLOWED_ORIGINS;
const previousConfiguredUrl = process.env.WA_UNOFFICIAL_URL;

afterEach(() => {
  vi.unstubAllGlobals();
  if (previousAllowedOrigins === undefined) delete process.env.WAHA_ALLOWED_ORIGINS;
  else process.env.WAHA_ALLOWED_ORIGINS = previousAllowedOrigins;
  if (previousConfiguredUrl === undefined) delete process.env.WA_UNOFFICIAL_URL;
  else process.env.WA_UNOFFICIAL_URL = previousConfiguredUrl;
});

// Legacy WAHA contract tests are retained only as migration history. Evolution
// API behavior is covered by evolution-provider.test.ts.
describe.skip("legacy WAHA provider", () => {
  it("sends text through the documented WAHA endpoint without exposing the key in the payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "msg-1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await new WhatsAppUnofficialProvider(config).send({ to: "+91 98765 43210", body: "Hello" });

    expect(result).toEqual({ externalId: "msg-1", status: "sent" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe("http://127.0.0.1:3005/api/sendText");
    expect(init.headers).toMatchObject({ "X-Api-Key": config.apiKey });
    expect(init.redirect).toBe("error");
    expect(JSON.parse(String(init.body))).toEqual({ session: "cutz-bangs-main", chatId: "919876543210@c.us", text: "Hello" });
    expect(String(init.body)).not.toContain(config.apiKey);
  });

  it("normalizes a 10-digit Indian mobile before creating the WAHA chat id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "msg-local" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new WhatsAppUnofficialProvider(config).send({ to: "9876543210", body: "Hello" });

    expect(result).toEqual({ externalId: "msg-local", status: "sent" });
    const payload = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    expect(payload.chatId).toBe("919876543210@c.us");
  });

  it("sends a private invoice PDF as inline base64 through WAHA sendFile", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "msg-pdf" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const mediaData = Buffer.from("%PDF-1.7\nprivate invoice").toString("base64");

    const result = await new WhatsAppUnofficialProvider(config).send({
      to: "+91 98765 43210",
      body: "Your invoice",
      mediaType: "document",
      mediaData,
      mediaMimeType: "application/pdf",
      mediaFilename: "CB-2026-000001.pdf",
    });

    expect(result).toEqual({ externalId: "msg-pdf", status: "sent" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe("http://127.0.0.1:3005/api/sendFile");
    expect(JSON.parse(String(init.body))).toEqual({
      session: "cutz-bangs-main",
      chatId: "919876543210@c.us",
      file: {
        data: mediaData,
        mimetype: "application/pdf",
        filename: "CB-2026-000001.pdf",
      },
      caption: "Your invoice",
    });
    expect(String(init.body)).not.toContain(config.apiKey);
  });

  it("rejects oversized inline media before contacting WAHA", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const mediaData = Buffer.alloc(WAHA_INLINE_MEDIA_MAX_BYTES + 1).toString("base64");

    const result = await new WhatsAppUnofficialProvider(config).send({
      to: "+919876543210",
      mediaType: "document",
      mediaData,
      mediaMimeType: "application/pdf",
      mediaFilename: "invoice.pdf",
    });

    expect(result).toMatchObject({ status: "failed", error: "whatsapp_media_too_large" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects inline bytes that are not a PDF before contacting WAHA", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await new WhatsAppUnofficialProvider(config).send({
      to: "+919876543210",
      mediaType: "document",
      mediaData: Buffer.from("not a pdf").toString("base64"),
      mediaMimeType: "application/pdf",
      mediaFilename: "invoice.pdf",
    });

    expect(result).toMatchObject({ status: "failed", error: "whatsapp_media_data_invalid" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a refreshed QR only while the session requires scanning", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "SCAN_QR_CODE" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ mimetype: "image/png", data: "YWJj" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const state = await new WhatsAppUnofficialProvider(config).health();

    expect(state.connected).toBe(false);
    expect(state.qrDataUrl).toBe("data:image/png;base64,YWJj");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/api/cutz-bangs-main/auth/qr");
  });

  it("hides QR data after WAHA reports WORKING", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "WORKING",
      me: { id: "919999999999@c.us", pushName: "Cutz & Bangs" },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const state = await new WhatsAppUnofficialProvider(config).health();

    expect(state).toMatchObject({ connected: true, status: "WORKING", accountName: "Cutz & Bangs", accountNumber: "919999999999" });
    expect(state.qrDataUrl).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reuses an existing QR session instead of restarting it", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "Session already exists" }), { status: 422 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "SCAN_QR_CODE" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ mimetype: "image/png", data: "YWJj" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const state = await new WhatsAppUnofficialProvider(config).sessionAction("create");

    expect(state).toMatchObject({ status: "SCAN_QR_CODE", connected: false });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/restart"))).toBe(false);
  });

  it("requires the independent webhook secret", () => {
    const provider = new WhatsAppUnofficialProvider(config);
    expect(provider.verifyWebhook({ "x-internal-secret": config.webhookSecret }, "")).toBe(true);
    expect(provider.verifyWebhook({ "x-internal-secret": config.apiKey }, "")).toBe(false);
  });

  it("fails closed before sending the API key to an arbitrary stored URL", async () => {
    delete process.env.WA_UNOFFICIAL_URL;
    delete process.env.WAHA_ALLOWED_ORIGINS;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await new WhatsAppUnofficialProvider({ ...config, baseUrl: "https://attacker.example" })
      .send({ to: "+919876543210", body: "secret-bearing request" });

    expect(result).toMatchObject({ status: "failed", error: "waha_base_url_not_allowlisted" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects credentials, fragments, metadata and private addresses unless explicitly allowlisted", () => {
    const env = {} as NodeJS.ProcessEnv;
    expect(validateWahaBaseUrl("http://user:pass@127.0.0.1:3005", env)).toMatchObject({ ok: false, error: "waha_base_url_invalid" });
    expect(validateWahaBaseUrl("http://127.0.0.1:3005/#token", env)).toMatchObject({ ok: false, error: "waha_base_url_invalid" });
    expect(validateWahaBaseUrl("http://169.254.169.254", env)).toMatchObject({ ok: false, error: "waha_base_url_private_address_not_allowlisted" });
    expect(validateWahaBaseUrl("http://10.0.0.4:3000", env)).toMatchObject({ ok: false, error: "waha_base_url_private_address_not_allowlisted" });
    expect(isRestrictedWahaHost("metadata.google.internal")).toBe(true);
  });

  it("accepts an exact explicitly configured production origin", async () => {
    process.env.WAHA_ALLOWED_ORIGINS = "http://waha:3000";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "msg-allowlisted" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new WhatsAppUnofficialProvider({ ...config, baseUrl: "http://waha:3000" })
      .send({ to: "+919876543210", body: "Allowed" });

    expect(result).toMatchObject({ status: "sent", externalId: "msg-allowlisted" });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://waha:3000/api/sendText");
  });
});
