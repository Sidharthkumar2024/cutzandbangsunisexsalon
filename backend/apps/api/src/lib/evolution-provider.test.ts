import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVOLUTION_INLINE_MEDIA_MAX_BYTES, WhatsAppUnofficialProvider } from "@cutz/providers";

const config = { baseUrl: "http://evolution:8080", apiKey: "evolution-test-key-123456789", session: "cutz-bangs-main", enabled: true };
beforeEach(() => { process.env.EVOLUTION_ALLOWED_ORIGINS = "http://evolution:8080"; });
afterEach(() => { vi.unstubAllGlobals(); delete process.env.EVOLUTION_ALLOWED_ORIGINS; });

describe("Evolution API WhatsApp provider", () => {
  it("sends text using the authenticated Evolution endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ key: { id: "evolution-1" } }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new WhatsAppUnofficialProvider(config).send({ to: "9876543210", body: "Hello" })).resolves.toEqual({ externalId: "evolution-1", status: "sent" });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://evolution:8080/message/sendText/cutz-bangs-main");
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({ apikey: config.apiKey });
  });

  it("retrieves QR only while the Evolution instance is disconnected", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ instance: { state: "close" } }), { status: 200 })).mockResolvedValueOnce(new Response(JSON.stringify({ base64: "YWJj" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new WhatsAppUnofficialProvider(config).health()).resolves.toMatchObject({ connected: false, status: "SCAN_QR_CODE", qrDataUrl: "data:image/png;base64,YWJj" });
  });

  it("retrieves QR while Evolution reports connecting", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ instance: { state: "connecting" } }), { status: 200 })).mockResolvedValueOnce(new Response(JSON.stringify({ base64: "ZGVm" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new WhatsAppUnofficialProvider(config).health()).resolves.toMatchObject({ connected: false, status: "CONNECTING", qrDataUrl: "data:image/png;base64,ZGVm" });
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe("http://evolution:8080/instance/connect/cutz-bangs-main");
  });

  it("does not send oversized inline invoice media", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const mediaData = Buffer.alloc(EVOLUTION_INLINE_MEDIA_MAX_BYTES + 1).toString("base64");
    await expect(new WhatsAppUnofficialProvider(config).send({ to: "919876543210", mediaType: "document", mediaMimeType: "application/pdf", mediaData })).resolves.toMatchObject({ status: "failed", error: "whatsapp_media_too_large" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
