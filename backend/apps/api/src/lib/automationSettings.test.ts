import { describe, expect, it } from "vitest";
import {
  DEFAULT_RECEIPT_AUTOMATION_SETTINGS,
  fillAutomationTemplate,
  normalizeReceiptAutomationSettings,
  plainTextEmailHtml,
} from "./automationSettings.js";

describe("receipt automation settings", () => {
  it("uses conservative defaults and clamps invalid retention periods", () => {
    expect(normalizeReceiptAutomationSettings(null)).toEqual(
      DEFAULT_RECEIPT_AUTOMATION_SETTINGS,
    );
    expect(
      normalizeReceiptAutomationSettings({
        nonReturningDays: 1,
        invoiceWhatsappChannel: "SMS",
      }),
    ).toMatchObject({
      nonReturningDays: 7,
      invoiceWhatsappChannel: "WHATSAPP_OFFICIAL",
    });
  });

  it("fills known placeholders without evaluating template content", () => {
    expect(
      fillAutomationTemplate("Hi {{name}} · {{total}} · {{missing}}", {
        name: "Asha",
        total: "₹500.00",
      }),
    ).toBe("Hi Asha · ₹500.00 · ");
  });

  it("escapes template text before producing email HTML", () => {
    expect(plainTextEmailHtml("Hi <script>\nThanks & bye")).toBe(
      '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#2f2925">Hi &lt;script&gt;<br>Thanks &amp; bye</div>',
    );
  });
});
