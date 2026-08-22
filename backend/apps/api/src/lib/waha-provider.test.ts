import { afterEach, describe, expect, it, vi } from "vitest";
import { WhatsAppUnofficialProvider } from "@cutz/providers";

const config = {
  enabled: true,
  baseUrl: "http://waha:3000",
  apiKey: "a-secure-waha-api-key-123456",
  webhookSecret: "a-separate-webhook-secret-123",
  session: "cutz-bangs-main",
};

afterEach(() => vi.unstubAllGlobals());

describe("WAHA provider", () => {
  it("sends text through the documented WAHA endpoint without exposing the key in the payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "msg-1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await new WhatsAppUnofficialProvider(config).send({ to: "+91 98765 43210", body: "Hello" });

    expect(result).toEqual({ externalId: "msg-1", status: "sent" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://waha:3000/api/sendText");
    expect(init.headers).toMatchObject({ "X-Api-Key": config.apiKey });
    expect(JSON.parse(String(init.body))).toEqual({ session: "cutz-bangs-main", chatId: "919876543210@c.us", text: "Hello" });
    expect(String(init.body)).not.toContain(config.apiKey);
  });

  it("returns a refreshed QR only while the session requires scanning", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "SCAN_QR_CODE" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ mimetype: "image/png", data: "YWJj" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const state = await new WhatsAppUnofficialProvider(config).health();

    expect(state.connected).toBe(false);
    expect(state.qrDataUrl).toBe("data:image/png;base64,YWJj");
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/api/cutz-bangs-main/auth/qr");
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
});
