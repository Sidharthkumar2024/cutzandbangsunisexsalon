// Provider adapter contracts. Concrete implementations live behind these
// interfaces so official/unofficial WhatsApp, email vendors, storage backends,
// AI models and payment gateways stay swappable.
//
// The unofficial WhatsApp connector implements MessagingProvider like any
// other, but runs in its own isolated worker/session. It contains NO anti-ban
// or platform-enforcement-evasion logic.

export interface OutboundMessage {
  to: string;
  body?: string;
  templateName?: string;
  templateLanguage?: string;
  variables?: Record<string, string>;
  mediaUrl?: string;
  /** Bare base64 bytes for providers that support inline media (never a data: URL). */
  mediaData?: string;
  mediaMimeType?: string;
  mediaFilename?: string;
  mediaType?: "image" | "document" | "video" | "audio";
  location?: { latitude: number; longitude: number; name?: string; address?: string };
}

export interface SendResult {
  externalId: string;
  status: "sent" | "queued" | "failed";
  /** Stable machine-readable failure code. */
  error?: string;
  /** Provider/user-facing context; callers must never populate it with credentials. */
  detail?: string;
  /** Optional upstream provider error code (for example a Meta Graph code). */
  providerCode?: string;
}

export type WhatsAppSessionAction = "create" | "start" | "restart" | "stop" | "logout";

export interface WhatsAppContact {
  id: string;
  number: string;
  name: string;
  isBlocked: boolean;
  isGroup: boolean;
  isMe: boolean;
}

export interface WhatsAppSessionState {
  configured: boolean;
  connected: boolean;
  status?: string;
  detail?: string;
  session?: string;
  accountName?: string;
  accountNumber?: string;
  qrDataUrl?: string;
}

export interface MessagingProvider {
  readonly channel: "WHATSAPP_OFFICIAL" | "WHATSAPP_UNOFFICIAL" | "SMS";
  send(msg: OutboundMessage): Promise<SendResult>;
  verifyWebhook(headers: Record<string, string>, rawBody: string): boolean;
  health?(): Promise<WhatsAppSessionState>;
  listTemplates?(): Promise<Array<{ name: string; language: string; status: string; body: string }>>;
  sessionAction?(action: WhatsAppSessionAction): Promise<WhatsAppSessionState>;
  listContacts?(limit?: number): Promise<WhatsAppContact[]>;
}

export interface EmailAttachment {
  filename: string;
  content?: Buffer; // inline bytes (preferred — backend-agnostic)
  path?: string; // or a URL/path the transport can fetch
}

export interface EmailProvider {
  send(input: {
    to: string;
    subject: string;
    html: string;
    attachments?: EmailAttachment[];
    dedupeKey?: string;
  }): Promise<SendResult>;
  health?(): Promise<{ configured: boolean; connected: boolean; detail?: string }>;
}

export interface StorageProvider {
  /** Upload and return an opaque key; access is via signed URLs only. */
  put(key: string, body: Buffer, contentType: string): Promise<string>;
  signedUrl(key: string, expiresInSec: number): Promise<string>;
  /** Read an object's bytes back (null if missing). Used to stream stored PDFs. */
  get(key: string): Promise<Buffer | null>;
  /**
   * Optional migration hook for providers that previously exposed public
   * objects. Private/local providers can omit it; callers must not delete
   * their historical object when no public twin exists.
   */
  retireLegacyPublicObject?(key: string): Promise<void>;
}

export interface AIProvider {
  draft(prompt: string, context?: Record<string, unknown>): Promise<string>;
  /** Returns null when the model is not confident and should hand off to a human. */
  answerFaq(question: string, kb: Record<string, unknown>): Promise<string | null>;
  /** Extracts a candidate vendor bill. Callers must require human review before posting stock. */
  extractVendorBill(input: { imageUrl: string }): Promise<VendorBillExtraction>;
}

export interface VendorBillExtraction {
  vendorName: string | null;
  billNumber: string | null;
  billDate: string | null;
  totalMinor: number | null;
  confidence: number;
  lines: Array<{ description: string; qty: number; unitMinor: number; amountMinor: number }>;
  warnings: string[];
}

export interface PaymentProvider {
  /** MVP: display UPI QR + manual confirmation. Gateway reconciliation later. */
  createIntent(input: { amountMinor: number; reference: string }): Promise<{ qrPayload: string }>;
}
