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
  it("shows a safe actionable Graph diagnostic for credential failures", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { message: "Invalid OAuth access token: meta-test-token", code: 190, error_subcode: 123 },
    }), { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    const health = await new WhatsAppOfficialProvider(config).health();

    expect(health).toEqual({
      configured: true,
      connected: false,
      detail: "Meta returned 401 (190:123): Invalid OAuth access token: [redacted]",
    });
    expect(health.detail).not.toContain("meta-test-token");
  });

  it("submits a structured message template to the WABA endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "template-1", status: "PENDING", category: "MARKETING" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new WhatsAppOfficialProvider(config).createTemplate({
      name: "festival_offer_2026",
      language: "en",
      category: "MARKETING",
      header: "Festival offer",
      body: "Hello {{1}}, enjoy 20% off.",
      footer: "Reply STOP to opt out",
    });

    expect(result).toEqual({ id: "template-1", status: "pending", category: "MARKETING" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://graph.facebook.com/v23.0/waba-id/message_templates",
      expect.objectContaining({ method: "POST" }),
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      name: "festival_offer_2026",
      language: "en",
      category: "MARKETING",
      components: [
        { type: "HEADER", format: "TEXT", text: "Festival offer" },
        { type: "BODY", text: "Hello {{1}}, enjoy 20% off." },
        { type: "FOOTER", text: "Reply STOP to opt out" },
      ],
    });
  });

  it("submits an authentication OTP template with copy-code button", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "template-otp", status: "PENDING", category: "AUTHENTICATION" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new WhatsAppOfficialProvider(config).createTemplate({
      name: "cutz_customer_otp",
      language: "en",
      category: "AUTHENTICATION",
      body: "{{1}} is your Cutz & Bangs login code.",
      footer: "This code expires in 10 minutes.",
    });

    expect(result).toEqual({ id: "template-otp", status: "pending", category: "AUTHENTICATION" });
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      name: "cutz_customer_otp",
      language: "en",
      category: "AUTHENTICATION",
      components: [
        { type: "BODY", text: "{{1}} is your Cutz & Bangs login code." },
        { type: "FOOTER", text: "This code expires in 10 minutes." },
        { type: "BUTTONS", buttons: [{ type: "OTP", otp_type: "COPY_CODE", text: "Copy code" }] },
      ],
    });
  });

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
