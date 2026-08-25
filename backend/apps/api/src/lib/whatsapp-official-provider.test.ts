import { afterEach, describe, expect, it, vi } from "vitest";
import { WhatsAppOfficialProvider } from "@cutz/providers";

const config = {
  enabled: true,
  token: "meta-test-token",
  phoneId: "phone-number-id",
  wabaId: "waba-id",
  graphVersion: "v23.0",
};

afterEach(() => vi.unstubAllGlobals());

describe("official WhatsApp provider failures", () => {
  it("rejects an invalid recipient before calling Meta", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await new WhatsAppOfficialProvider(config).send({ to: "not-a-phone", body: "Hello" });

    expect(result).toMatchObject({ status: "failed", error: "whatsapp_recipient_invalid" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a local-only invoice URL before calling Meta", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await new WhatsAppOfficialProvider(config).send({
      to: "+91 98765 43210",
      body: "Invoice",
      mediaType: "document",
      mediaUrl: "local://invoices/v2/CB-1.pdf",
    });

    expect(result).toMatchObject({ status: "failed", error: "whatsapp_media_url_invalid" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a stable error plus Meta detail and provider code", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: {
        message: "Outside the allowed customer service window",
        code: 131047,
        error_subcode: 2494010,
        error_data: { details: "Re-engagement message required" },
      },
    }), { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new WhatsAppOfficialProvider(config).send({ to: "+919876543210", body: "Invoice" });

    expect(result).toEqual({
      externalId: "",
      status: "failed",
      error: "wa_official_rejected",
      detail: "Re-engagement message required",
      providerCode: "131047:2494010",
    });
  });

  it("turns a timeout/network exception into an actionable send result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("request timed out")));

    const result = await new WhatsAppOfficialProvider(config).send({ to: "+919876543210", body: "Invoice" });

    expect(result).toEqual({
      externalId: "",
      status: "failed",
      error: "wa_official_unavailable",
      detail: "request timed out",
    });
  });

  it("does not echo an unstructured proxy response to the caller", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("upstream internal response", { status: 502 })));

    const result = await new WhatsAppOfficialProvider(config).send({ to: "+919876543210", body: "Invoice" });

    expect(result).toEqual({
      externalId: "",
      status: "failed",
      error: "wa_official_rejected",
      detail: "Meta returned HTTP 502",
      providerCode: undefined,
    });
  });

  it("requires Meta to return a message id before reporting accepted", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));

    const result = await new WhatsAppOfficialProvider(config).send({ to: "+919876543210", body: "Invoice" });

    expect(result).toEqual({ externalId: "", status: "failed", error: "wa_official_invalid_response" });
  });
});
