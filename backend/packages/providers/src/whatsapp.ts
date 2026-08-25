import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  MessagingProvider,
  OutboundMessage,
  SendResult,
  WhatsAppContact,
  WhatsAppSessionAction,
  WhatsAppSessionState,
} from "@cutz/types";
import { validateWahaBaseUrl } from "./waha-url.js";

const digits = (value: string) => value.replace(/\D/g, "");

const recipient = (value: string) => {
  let normalized = digits(value);
  // This salon operates in India and historical CRM rows can contain a local
  // 10-digit mobile. WAHA/Meta both require an international recipient.
  if (/^[6-9]\d{9}$/.test(normalized)) normalized = `91${normalized}`;
  return /^\d{8,15}$/.test(normalized) ? normalized : null;
};

const validMediaUrl = (value: string) => {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && Boolean(url.hostname);
  } catch {
    return false;
  }
};

/** Keep JSON/base64 requests bounded before they reach the local WAHA API. */
export const WAHA_INLINE_MEDIA_MAX_BYTES = 8 * 1024 * 1024;

function inlinePdfError(msg: OutboundMessage) {
  if (!msg.mediaData) return null;
  if (msg.mediaType !== "document" || msg.mediaMimeType !== "application/pdf") {
    return "whatsapp_inline_media_unsupported";
  }
  const data = msg.mediaData.trim();
  const maxEncodedLength = 4 * Math.ceil(WAHA_INLINE_MEDIA_MAX_BYTES / 3);
  if (data.length > maxEncodedLength) return "whatsapp_media_too_large";
  if (!data || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    return "whatsapp_media_data_invalid";
  }
  const decoded = Buffer.from(data, "base64");
  if (!decoded.length || decoded.length > WAHA_INLINE_MEDIA_MAX_BYTES) {
    return decoded.length ? "whatsapp_media_too_large" : "whatsapp_media_data_invalid";
  }
  if (decoded.toString("base64") !== data) return "whatsapp_media_data_invalid";
  if (decoded.length < 5 || decoded.subarray(0, 5).toString("ascii") !== "%PDF-") {
    return "whatsapp_media_data_invalid";
  }
  return null;
}

function safePdfFilename(value?: string) {
  const basename = (value ?? "document.pdf").split(/[\\/]/).pop() ?? "document.pdf";
  const sanitized = basename.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "document.pdf";
  return sanitized.toLowerCase().endsWith(".pdf") ? sanitized : `${sanitized}.pdf`;
}

type MetaErrorPayload = {
  error?: {
    message?: string;
    code?: number | string;
    error_subcode?: number | string;
    error_data?: { details?: string };
  };
};

function officialFailure(status: number, raw: string): SendResult {
  let parsed: MetaErrorPayload | undefined;
  try {
    parsed = JSON.parse(raw) as MetaErrorPayload;
  } catch {
    // Some proxies return plain text or HTML. Keep the public error code stable.
  }
  const meta = parsed?.error;
  const providerCode = meta?.code === undefined
    ? undefined
    : [meta.code, meta.error_subcode].filter((part) => part !== undefined).join(":");
  const detail = (meta?.error_data?.details ?? meta?.message ?? `Meta returned HTTP ${status}`).slice(0, 500);
  return {
    externalId: "",
    status: "failed",
    error: "wa_official_rejected",
    detail,
    providerCode,
  };
}

export type WhatsAppOfficialConfig = {
  enabled?: boolean;
  token?: string;
  phoneId?: string;
  wabaId?: string;
  appSecret?: string;
  graphVersion?: string;
};

export type WhatsAppUnofficialConfig = {
  enabled?: boolean;
  baseUrl?: string;
  apiKey?: string;
  webhookSecret?: string;
  session?: string;
  callbackUrl?: string;
};

/** Official WhatsApp Business Platform / Cloud API adapter. */
export class WhatsAppOfficialProvider implements MessagingProvider {
  readonly channel = "WHATSAPP_OFFICIAL" as const;
  private token: string;
  private phoneId: string;
  private wabaId: string;
  private appSecret: string;
  private graphVersion: string;

  constructor(config?: WhatsAppOfficialConfig) {
    const enabled = config?.enabled !== false;
    this.token = enabled ? config?.token ?? process.env.WA_OFFICIAL_TOKEN ?? "" : "";
    this.phoneId = enabled ? config?.phoneId ?? process.env.WA_OFFICIAL_PHONE_ID ?? "" : "";
    this.wabaId = enabled ? config?.wabaId ?? process.env.WA_OFFICIAL_WABA_ID ?? "" : "";
    this.appSecret = enabled ? config?.appSecret ?? process.env.WA_APP_SECRET ?? "" : "";
    this.graphVersion = config?.graphVersion ?? process.env.WA_GRAPH_VERSION ?? "v23.0";
  }

  private endpoint(path: string) {
    return `https://graph.facebook.com/${this.graphVersion}/${path}`;
  }

  async send(msg: OutboundMessage): Promise<SendResult> {
    if (!this.token || !this.phoneId) {
      return { externalId: "", status: "failed", error: "wa_official_not_configured" };
    }
    const to = recipient(msg.to);
    if (!to) {
      return {
        externalId: "",
        status: "failed",
        error: "whatsapp_recipient_invalid",
        detail: "Use an international phone number containing 8 to 15 digits.",
      };
    }
    if (msg.mediaData) {
      return {
        externalId: "",
        status: "failed",
        error: "whatsapp_inline_media_unsupported",
        detail: "Official WhatsApp media requires a public HTTPS URL.",
      };
    }
    if (Boolean(msg.mediaUrl) !== Boolean(msg.mediaType)) {
      return { externalId: "", status: "failed", error: "whatsapp_media_incomplete" };
    }
    if (msg.mediaUrl && !validMediaUrl(msg.mediaUrl)) {
      return {
        externalId: "",
        status: "failed",
        error: "whatsapp_media_url_invalid",
        detail: "WhatsApp media must use a reachable HTTP(S) URL.",
      };
    }

    let payload: Record<string, unknown>;
    if (msg.templateName) {
      payload = {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: msg.templateName,
          language: { code: msg.templateLanguage ?? "en" },
          components: msg.variables
            ? [{ type: "body", parameters: Object.values(msg.variables).map((text) => ({ type: "text", text })) }]
            : undefined,
        },
      };
    } else if (msg.location) {
      payload = {
        messaging_product: "whatsapp",
        to,
        type: "location",
        location: msg.location,
      };
    } else if (msg.mediaUrl && msg.mediaType) {
      payload = {
        messaging_product: "whatsapp",
        to,
        type: msg.mediaType,
        [msg.mediaType]: {
          link: msg.mediaUrl,
          ...(msg.body && ["image", "document", "video"].includes(msg.mediaType)
            ? { caption: msg.body }
            : {}),
        },
      };
    } else {
      payload = {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: msg.body ?? "", preview_url: true },
      };
    }

    try {
      const res = await fetch(this.endpoint(`${this.phoneId}/messages`), {
        method: "POST",
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20_000),
      });
      const raw = await res.text();
      if (!res.ok) return officialFailure(res.status, raw);
      let data: { messages?: { id: string }[] };
      try {
        data = JSON.parse(raw) as { messages?: { id: string }[] };
      } catch {
        return { externalId: "", status: "failed", error: "wa_official_invalid_response" };
      }
      const externalId = data.messages?.[0]?.id;
      return externalId
        ? { externalId, status: "sent" }
        : { externalId: "", status: "failed", error: "wa_official_invalid_response" };
    } catch (error) {
      return {
        externalId: "",
        status: "failed",
        error: "wa_official_unavailable",
        detail: (error instanceof Error ? error.message : "Meta Cloud API unavailable").slice(0, 500),
      };
    }
  }

  async health() {
    if (!this.token || !this.phoneId) {
      return { configured: false, connected: false, detail: "Add the Meta token and phone-number ID." };
    }
    try {
      const response = await fetch(this.endpoint(`${this.phoneId}?fields=display_phone_number,verified_name`), {
        headers: { Authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(10_000),
      });
      return {
        configured: true,
        connected: response.ok,
        detail: response.ok ? "Meta Cloud API reachable" : `Meta returned ${response.status}`,
      };
    } catch (error) {
      return { configured: true, connected: false, detail: error instanceof Error ? error.message : "Meta unavailable" };
    }
  }

  async listTemplates() {
    if (!this.token || !this.wabaId) return [];
    const response = await fetch(this.endpoint(`${this.wabaId}/message_templates?limit=100`), {
      headers: { Authorization: `Bearer ${this.token}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`wa_template_sync_failed:${response.status}`);
    const data = (await response.json()) as {
      data?: Array<{
        name: string;
        language: string;
        status: string;
        components?: Array<{ type: string; text?: string }>;
      }>;
    };
    return (data.data ?? []).map((template) => ({
      name: template.name,
      language: template.language,
      status: template.status.toLowerCase(),
      body: template.components?.find((component) => component.type === "BODY")?.text ?? "",
    }));
  }

  verifyWebhook(headers: Record<string, string>, rawBody: string): boolean {
    if (!this.appSecret) return process.env.NODE_ENV !== "production";
    const sig = headers["x-hub-signature-256"];
    if (!sig?.startsWith("sha256=")) return false;
    const expected = "sha256=" + createHmac("sha256", this.appSecret).update(rawBody).digest("hex");
    const actualBytes = Buffer.from(sig);
    const expectedBytes = Buffer.from(expected);
    return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
  }
}

/** Adapter for a self-hosted WAHA instance. The browser never receives its API key. */
export class WhatsAppUnofficialProvider implements MessagingProvider {
  readonly channel = "WHATSAPP_UNOFFICIAL" as const;
  private baseUrl: string;
  private apiKey: string;
  private webhookSecret: string;
  private session: string;
  private callbackUrl: string;
  private configError: string | undefined;

  constructor(config?: WhatsAppUnofficialConfig) {
    const enabled = config?.enabled !== false;
    const configuredBaseUrl = enabled ? config?.baseUrl ?? process.env.WA_UNOFFICIAL_URL ?? "" : "";
    const validatedBaseUrl = configuredBaseUrl ? validateWahaBaseUrl(configuredBaseUrl) : undefined;
    this.baseUrl = validatedBaseUrl?.ok ? validatedBaseUrl.url : "";
    this.configError = validatedBaseUrl && !validatedBaseUrl.ok ? validatedBaseUrl.error : undefined;
    this.apiKey = enabled ? config?.apiKey ?? process.env.WAHA_API_KEY ?? "" : "";
    this.webhookSecret = enabled ? config?.webhookSecret ?? process.env.WA_UNOFFICIAL_WEBHOOK_SECRET ?? "" : "";
    this.session = enabled ? config?.session ?? process.env.WAHA_SESSION ?? "cutz-bangs-main" : "";
    this.callbackUrl = enabled ? config?.callbackUrl ?? process.env.WA_UNOFFICIAL_CALLBACK_URL ?? "" : "";
  }

  private headers(accept = "application/json") {
    return { "Content-Type": "application/json", Accept: accept, "X-Api-Key": this.apiKey };
  }

  private async json(path: string, init: RequestInit = {}) {
    if (!this.baseUrl) throw new Error(this.configError ?? "wa_unofficial_not_configured");
    const target = new URL(path, `${this.baseUrl}/`);
    if (target.origin !== this.baseUrl) throw new Error("waha_request_origin_mismatch");
    const response = await fetch(target, {
      ...init,
      headers: { ...this.headers(), ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(20_000),
      redirect: "error",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = typeof data === "object" && data && "message" in data
        ? String((data as { message: unknown }).message)
        : `waha_${response.status}`;
      throw new Error(detail.slice(0, 500));
    }
    return data;
  }

  async send(msg: OutboundMessage): Promise<SendResult> {
    if (!this.baseUrl || !this.apiKey || !this.session) {
      return { externalId: "", status: "failed", error: this.configError ?? "wa_unofficial_not_configured" };
    }
    const to = recipient(msg.to);
    if (!to) {
      return {
        externalId: "",
        status: "failed",
        error: "whatsapp_recipient_invalid",
        detail: "Use an international phone number containing 8 to 15 digits.",
      };
    }
    if (msg.mediaUrl && msg.mediaData) {
      return { externalId: "", status: "failed", error: "whatsapp_media_multiple_sources" };
    }
    const hasMedia = Boolean(msg.mediaUrl || msg.mediaData);
    if (hasMedia !== Boolean(msg.mediaType)) {
      return { externalId: "", status: "failed", error: "whatsapp_media_incomplete" };
    }
    if (msg.mediaUrl && !validMediaUrl(msg.mediaUrl)) {
      return {
        externalId: "",
        status: "failed",
        error: "whatsapp_media_url_invalid",
        detail: "WhatsApp media must use a reachable HTTP(S) URL.",
      };
    }
    const dataError = inlinePdfError(msg);
    if (dataError) return { externalId: "", status: "failed", error: dataError };
    try {
      const chatId = `${to}@c.us`;
      let endpoint = "/api/sendText";
      let payload: Record<string, unknown> = { session: this.session, chatId, text: msg.body ?? "" };
      if (msg.location) {
        endpoint = "/api/sendLocation";
        payload = { session: this.session, chatId, ...msg.location };
      } else if ((msg.mediaUrl || msg.mediaData) && msg.mediaType) {
        const route = { image: "sendImage", document: "sendFile", video: "sendVideo", audio: "sendVoice" }[msg.mediaType];
        endpoint = `/api/${route}`;
        payload = {
          session: this.session,
          chatId,
          file: msg.mediaData
            ? {
                data: msg.mediaData.trim(),
                mimetype: msg.mediaMimeType,
                filename: safePdfFilename(msg.mediaFilename),
              }
            : {
                url: msg.mediaUrl,
                filename: msg.mediaType === "document" ? safePdfFilename(msg.mediaFilename) : undefined,
              },
          ...(msg.body ? { caption: msg.body } : {}),
        };
      }
      const data = (await this.json(endpoint, { method: "POST", body: JSON.stringify(payload) })) as {
        id?: string;
        key?: { id?: string };
      };
      return { externalId: data.id ?? data.key?.id ?? "", status: "sent" };
    } catch (error) {
      return { externalId: "", status: "failed", error: error instanceof Error ? error.message : "connector_unavailable" };
    }
  }

  async health(): Promise<WhatsAppSessionState> {
    if (!this.baseUrl || !this.apiKey || !this.session) {
      if (this.configError) {
        return { configured: true, connected: false, status: "INVALID_CONFIG", detail: this.configError };
      }
      return { configured: false, connected: false, status: "NOT_CONFIGURED", detail: "Add the WAHA URL, API key and session name." };
    }
    try {
      const data = (await this.json(`/api/sessions/${encodeURIComponent(this.session)}`)) as {
        status?: string;
        me?: { id?: string; pushName?: string };
      };
      const status = data.status ?? "UNKNOWN";
      let qrDataUrl: string | undefined;
      if (status === "SCAN_QR_CODE") {
        const qr = (await this.json(`/api/${encodeURIComponent(this.session)}/auth/qr`, {
          headers: { Accept: "application/json" },
        })) as { mimetype?: string; data?: string };
        if (qr.data) qrDataUrl = `data:${qr.mimetype ?? "image/png"};base64,${qr.data}`;
      }
      return {
        configured: true,
        connected: status === "WORKING",
        status,
        detail: status === "WORKING" ? "WAHA session connected" : `WAHA session: ${status}`,
        session: this.session,
        accountName: data.me?.pushName,
        accountNumber: data.me?.id?.split("@")[0],
        qrDataUrl,
      };
    } catch (error) {
      return { configured: true, connected: false, status: "UNAVAILABLE", session: this.session, detail: error instanceof Error ? error.message : "WAHA unavailable" };
    }
  }

  async sessionAction(action: WhatsAppSessionAction): Promise<WhatsAppSessionState> {
    if (!this.baseUrl || !this.apiKey || !this.session) throw new Error(this.configError ?? "wa_unofficial_not_configured");
    if (action === "create") {
      const config: Record<string, unknown> = {
        metadata: { "app.name": "Cutz & Bangs", "app.session": this.session },
        client: { deviceName: "Cutz & Bangs", browserName: "Chrome" },
      };
      if (this.callbackUrl && this.webhookSecret) {
        config.webhooks = [{
          url: this.callbackUrl,
          events: ["message", "message.ack", "session.status"],
          customHeaders: [{ name: "X-Internal-Secret", value: this.webhookSecret }],
          retries: { policy: "constant", delaySeconds: 5, attempts: 10 },
        }];
      }
      try {
        await this.json("/api/sessions", {
          method: "POST",
          body: JSON.stringify({ name: this.session, start: true, config }),
        });
      } catch (error) {
        if (!(error instanceof Error) || !/already|exist|422/i.test(error.message)) throw error;
        // An existing SCAN_QR_CODE session already exposes a fresh QR through
        // the read-only auth/qr endpoint. Restarting here makes some WAHA/WebJS
        // releases call a removed refreshQR command and leaves the UI looking
        // broken even though a valid QR is available.
        return this.health();
      }
    } else {
      await this.json(`/api/sessions/${encodeURIComponent(this.session)}/${action}`, { method: "POST", body: "{}" });
    }
    return this.health();
  }

  async listContacts(limit = 5_000): Promise<WhatsAppContact[]> {
    if (!this.baseUrl || !this.apiKey || !this.session) throw new Error(this.configError ?? "wa_unofficial_not_configured");
    const contacts: WhatsAppContact[] = [];
    for (let offset = 0; offset < limit; offset += 500) {
      const page = (await this.json(`/api/contacts/all?session=${encodeURIComponent(this.session)}&limit=500&offset=${offset}&sortBy=id&sortOrder=asc`)) as Array<{
        id?: string;
        number?: string;
        name?: string;
        pushname?: string;
        shortName?: string;
        isBlocked?: boolean;
        isGroup?: boolean;
        isMe?: boolean;
      }>;
      if (!Array.isArray(page)) break;
      contacts.push(...page.map((contact) => ({
        id: contact.id ?? contact.number ?? "",
        number: digits(contact.number ?? contact.id ?? ""),
        name: contact.name ?? contact.pushname ?? contact.shortName ?? "WhatsApp contact",
        isBlocked: Boolean(contact.isBlocked),
        isGroup: Boolean(contact.isGroup),
        isMe: Boolean(contact.isMe),
      })));
      if (page.length < 500) break;
    }
    return contacts.filter((contact) => contact.number && !contact.isBlocked && !contact.isGroup && !contact.isMe).slice(0, limit);
  }

  verifyWebhook(headers: Record<string, string>): boolean {
    const provided = headers["x-internal-secret"] ?? "";
    if (!this.webhookSecret || !provided) return false;
    const expected = Buffer.from(this.webhookSecret);
    const actual = Buffer.from(provided);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}
