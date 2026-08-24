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

    let payload: Record<string, unknown>;
    if (msg.templateName) {
      payload = {
        messaging_product: "whatsapp",
        to: digits(msg.to),
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
        to: digits(msg.to),
        type: "location",
        location: msg.location,
      };
    } else if (msg.mediaUrl && msg.mediaType) {
      payload = {
        messaging_product: "whatsapp",
        to: digits(msg.to),
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
        to: digits(msg.to),
        type: "text",
        text: { body: msg.body ?? "", preview_url: true },
      };
    }

    const res = await fetch(this.endpoint(`${this.phoneId}/messages`), {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { externalId: "", status: "failed", error: (await res.text()).slice(0, 1000) };
    const data = (await res.json()) as { messages?: { id: string }[] };
    return { externalId: data.messages?.[0]?.id ?? "", status: "sent" };
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
    try {
      const chatId = `${digits(msg.to)}@c.us`;
      let endpoint = "/api/sendText";
      let payload: Record<string, unknown> = { session: this.session, chatId, text: msg.body ?? "" };
      if (msg.location) {
        endpoint = "/api/sendLocation";
        payload = { session: this.session, chatId, ...msg.location };
      } else if (msg.mediaUrl && msg.mediaType) {
        const route = { image: "sendImage", document: "sendFile", video: "sendVideo", audio: "sendVoice" }[msg.mediaType];
        endpoint = `/api/${route}`;
        payload = {
          session: this.session,
          chatId,
          file: { url: msg.mediaUrl, filename: msg.mediaType === "document" ? "document.pdf" : undefined },
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
