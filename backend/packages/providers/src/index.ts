// Provider factory — one place that picks concrete implementations from env.
// Swap an implementation here without touching call sites.

import { SmtpEmailProvider } from "./email.js";
import { WhatsAppOfficialProvider, WhatsAppUnofficialProvider } from "./whatsapp.js";
import { S3StorageProvider, LocalStorageProvider } from "./storage.js";
import { AnthropicAIProvider } from "./ai.js";
import { UpiPaymentProvider } from "./payment.js";
import type { EmailProvider, MessagingProvider, StorageProvider, AIProvider, PaymentProvider } from "@cutz/types";
import type { SmtpEmailConfig } from "./email.js";
import type { WhatsAppOfficialConfig, WhatsAppUnofficialConfig } from "./whatsapp.js";

export type ProviderRuntimeConfig = {
  smtp?: SmtpEmailConfig;
  whatsappOfficial?: WhatsAppOfficialConfig;
  whatsappUnofficial?: WhatsAppUnofficialConfig;
};

let runtimeConfig: ProviderRuntimeConfig = {};

let _email: EmailProvider | undefined;
let _waOfficial: MessagingProvider | undefined;
let _waUnofficial: MessagingProvider | undefined;
let _storage: StorageProvider | undefined;
let _ai: AIProvider | undefined;
let _payment: PaymentProvider | undefined;

export const providers = {
  email(): EmailProvider {
    return (_email ??= new SmtpEmailProvider(runtimeConfig.smtp));
  },
  whatsapp(channel: "WHATSAPP_OFFICIAL" | "WHATSAPP_UNOFFICIAL" = "WHATSAPP_OFFICIAL"): MessagingProvider {
    return channel === "WHATSAPP_UNOFFICIAL"
      ? (_waUnofficial ??= new WhatsAppUnofficialProvider(runtimeConfig.whatsappUnofficial))
      : (_waOfficial ??= new WhatsAppOfficialProvider(runtimeConfig.whatsappOfficial));
  },
  storage(): StorageProvider {
    // Use S3 only when credentials are configured; otherwise local disk so PDF
    // invoices work in dev / on a VPS without object storage.
    return (_storage ??= process.env.STORAGE_ACCESS_KEY
      ? new S3StorageProvider()
      : new LocalStorageProvider());
  },
  ai(): AIProvider {
    return (_ai ??= new AnthropicAIProvider());
  },
  payment(): PaymentProvider {
    return (_payment ??= new UpiPaymentProvider());
  },
  configure(config: ProviderRuntimeConfig) {
    runtimeConfig = config;
    _email = undefined;
    _waOfficial = undefined;
    _waUnofficial = undefined;
  },
};

export { SmtpEmailProvider, WhatsAppOfficialProvider, WhatsAppUnofficialProvider };
export type { SmtpEmailConfig, WhatsAppOfficialConfig, WhatsAppUnofficialConfig };
export { encryptSecret, decryptSecret } from "./secrets.js";
export { salonEmailLayout, passwordResetEmail, staffInvitationEmail, appointmentEmail, invoiceEmail, appointmentWhatsAppText } from "./salon-templates.js";
