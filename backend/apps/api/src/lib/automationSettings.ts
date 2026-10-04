export type ReceiptAutomationSettings = {
  autoInvoiceEmail: boolean;
  autoInvoiceWhatsapp: boolean;
  invoiceWhatsappChannel: "WHATSAPP_OFFICIAL" | "WHATSAPP_UNOFFICIAL";
  invoiceAttachPdf: boolean;
  invoiceEmailSubject: string;
  invoiceEmailBody: string;
  invoiceWhatsappBody: string;
  nonReturningEnabled: boolean;
  nonReturningDays: number;
  nonReturningEmail: boolean;
  nonReturningWhatsapp: boolean;
  nonReturningWhatsappChannel: "WHATSAPP_OFFICIAL" | "WHATSAPP_UNOFFICIAL";
  nonReturningTemplate: string;
};

export const DEFAULT_RECEIPT_AUTOMATION_SETTINGS: ReceiptAutomationSettings = {
  autoInvoiceEmail: true,
  autoInvoiceWhatsapp: true,
  invoiceWhatsappChannel: "WHATSAPP_UNOFFICIAL",
  invoiceAttachPdf: true,
  invoiceEmailSubject: "Your Cutz & Bangs invoice {{invoiceNumber}}",
  invoiceEmailBody:
    "Hi {{name}}, thank you for visiting Cutz & Bangs. Your invoice {{invoiceNumber}} total is {{total}}.",
  invoiceWhatsappBody:
    "Hi {{name}}, thank you for visiting Cutz & Bangs.\nInvoice {{invoiceNumber}} total {{total}} is attached as PDF.\nRewards/login: {{customerPortalUrl}}\nPlease review us on Google: {{googleReviewUrl}}",
  nonReturningEnabled: false,
  nonReturningDays: 30,
  nonReturningEmail: false,
  nonReturningWhatsapp: true,
  nonReturningWhatsappChannel: "WHATSAPP_UNOFFICIAL",
  nonReturningTemplate:
    "Hi {{name}}, we have missed you at Cutz & Bangs. It has been {{days}} days since your last visit. Reply BOOK and we will reserve a convenient slot.",
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const text = (value: unknown, fallback: string, max: number) => {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : fallback;
};

const bool = (value: unknown, fallback: boolean) =>
  typeof value === "boolean" ? value : fallback;

export function normalizeReceiptAutomationSettings(
  value: unknown,
): ReceiptAutomationSettings {
  const input = record(value);
  const defaults = DEFAULT_RECEIPT_AUTOMATION_SETTINGS;
  const parsedDays = Number(input.nonReturningDays);
  return {
    autoInvoiceEmail: bool(input.autoInvoiceEmail, defaults.autoInvoiceEmail),
    autoInvoiceWhatsapp: bool(
      input.autoInvoiceWhatsapp,
      defaults.autoInvoiceWhatsapp,
    ),
    invoiceWhatsappChannel: "WHATSAPP_UNOFFICIAL",
    invoiceAttachPdf: bool(input.invoiceAttachPdf, defaults.invoiceAttachPdf),
    invoiceEmailSubject: text(
      input.invoiceEmailSubject,
      defaults.invoiceEmailSubject,
      180,
    ),
    invoiceEmailBody: text(
      input.invoiceEmailBody,
      defaults.invoiceEmailBody,
      4_000,
    ),
    invoiceWhatsappBody: text(
      input.invoiceWhatsappBody,
      defaults.invoiceWhatsappBody,
      4_000,
    ),
    nonReturningEnabled: bool(
      input.nonReturningEnabled,
      defaults.nonReturningEnabled,
    ),
    nonReturningDays: Number.isFinite(parsedDays)
      ? Math.min(365, Math.max(7, Math.round(parsedDays)))
      : defaults.nonReturningDays,
    nonReturningEmail: bool(
      input.nonReturningEmail,
      defaults.nonReturningEmail,
    ),
    nonReturningWhatsapp: bool(
      input.nonReturningWhatsapp,
      defaults.nonReturningWhatsapp,
    ),
    nonReturningWhatsappChannel: "WHATSAPP_UNOFFICIAL",
    nonReturningTemplate: text(
      input.nonReturningTemplate,
      defaults.nonReturningTemplate,
      4_000,
    ),
  };
}

export function fillAutomationTemplate(
  template: string,
  values: Record<string, string | number | null | undefined>,
) {
  return template.replace(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/gu, (_match, key: string) => {
    const value = values[key];
    return value === null || value === undefined ? "" : String(value);
  });
}

export const plainTextEmailHtml = (body: string) =>
  `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#2f2925">${body
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
    .replaceAll("\n", "<br>")}</div>`;
