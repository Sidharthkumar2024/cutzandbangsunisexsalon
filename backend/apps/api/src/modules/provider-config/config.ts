import { Prisma } from "@prisma/client";
import { prisma } from "@cutz/db";
import { providers, decryptSecret, encryptSecret, type ProviderRuntimeConfig } from "@cutz/providers";

export type ProviderSettingsInput = {
  smtp: {
    enabled: boolean;
    host: string;
    port: number;
    secure: boolean;
    user: string;
    password?: string;
    from: string;
  };
  whatsappOfficial: {
    enabled: boolean;
    phoneId: string;
    wabaId: string;
    graphVersion: string;
    token?: string;
    appSecret?: string;
    webhookVerifyToken?: string;
  };
  whatsappUnofficial: {
    enabled: boolean;
    baseUrl: string;
    callbackUrl: string;
    session: string;
    apiKey?: string;
    webhookSecret?: string;
    intervalSeconds: number;
    dailyCap: number;
    windowStartHour: number;
    windowEndHour: number;
  };
};

class ProviderConfigError extends Error {
  statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = "ProviderConfigError";
  }
}

type StoredProviderSettings = {
  smtp?: Omit<ProviderSettingsInput["smtp"], "password"> & { passwordEncrypted?: string };
  whatsappOfficial?: Omit<ProviderSettingsInput["whatsappOfficial"], "token" | "appSecret" | "webhookVerifyToken"> & {
    tokenEncrypted?: string;
    appSecretEncrypted?: string;
    webhookVerifyTokenEncrypted?: string;
  };
  whatsappUnofficial?: Omit<ProviderSettingsInput["whatsappUnofficial"], "apiKey" | "webhookSecret"> & {
    apiKeyEncrypted?: string;
    webhookSecretEncrypted?: string;
    /** Legacy key from the earlier generic connector. */
    secretEncrypted?: string;
  };
};

const keyFor = (branchId: string) => `branch:${branchId}:providers`;

async function storedSettings(branchId: string): Promise<StoredProviderSettings> {
  const row = await prisma.setting.findUnique({ where: { key: keyFor(branchId) } });
  return (row?.value ?? {}) as StoredProviderSettings;
}

function runtimeConfig(stored: StoredProviderSettings): ProviderRuntimeConfig {
  return {
    smtp: stored.smtp
      ? { ...stored.smtp, password: decryptSecret(stored.smtp.passwordEncrypted) }
      : undefined,
    whatsappOfficial: stored.whatsappOfficial
      ? {
          ...stored.whatsappOfficial,
          token: decryptSecret(stored.whatsappOfficial.tokenEncrypted),
          appSecret: decryptSecret(stored.whatsappOfficial.appSecretEncrypted),
        }
      : undefined,
    whatsappUnofficial: stored.whatsappUnofficial
      ? {
          ...stored.whatsappUnofficial,
          apiKey: decryptSecret(stored.whatsappUnofficial.apiKeyEncrypted ?? stored.whatsappUnofficial.secretEncrypted),
          webhookSecret: decryptSecret(stored.whatsappUnofficial.webhookSecretEncrypted),
          callbackUrl: stored.whatsappUnofficial.callbackUrl || process.env.WA_UNOFFICIAL_CALLBACK_URL,
        }
      : undefined,
  };
}

export async function applyProviderSettings(branchId = "main") {
  const stored = await storedSettings(branchId);
  providers.configure(runtimeConfig(stored));
  return stored;
}

export async function publicProviderSettings(branchId = "main") {
  const stored = await storedSettings(branchId);
  return {
    smtp: {
      enabled: stored.smtp?.enabled ?? false,
      host: stored.smtp?.host ?? "",
      port: stored.smtp?.port ?? 587,
      secure: stored.smtp?.secure ?? false,
      user: stored.smtp?.user ?? "",
      from: stored.smtp?.from ?? "",
      hasPassword: Boolean(stored.smtp?.passwordEncrypted || process.env.SMTP_PASS),
    },
    whatsappOfficial: {
      enabled: stored.whatsappOfficial?.enabled ?? false,
      phoneId: stored.whatsappOfficial?.phoneId ?? "",
      wabaId: stored.whatsappOfficial?.wabaId ?? "",
      graphVersion: stored.whatsappOfficial?.graphVersion ?? "v23.0",
      hasToken: Boolean(stored.whatsappOfficial?.tokenEncrypted || process.env.WA_OFFICIAL_TOKEN),
      hasAppSecret: Boolean(stored.whatsappOfficial?.appSecretEncrypted || process.env.WA_APP_SECRET),
      hasWebhookVerifyToken: Boolean(stored.whatsappOfficial?.webhookVerifyTokenEncrypted || process.env.WA_WEBHOOK_VERIFY_TOKEN),
    },
    whatsappUnofficial: {
      enabled: stored.whatsappUnofficial?.enabled ?? false,
      baseUrl: stored.whatsappUnofficial?.baseUrl ?? "",
      callbackUrl: stored.whatsappUnofficial?.callbackUrl ?? process.env.WA_UNOFFICIAL_CALLBACK_URL ?? "",
      session: stored.whatsappUnofficial?.session ?? process.env.WAHA_SESSION ?? "cutz-bangs-main",
      intervalSeconds: stored.whatsappUnofficial?.intervalSeconds ?? 90,
      dailyCap: stored.whatsappUnofficial?.dailyCap ?? 75,
      windowStartHour: stored.whatsappUnofficial?.windowStartHour ?? 10,
      windowEndHour: stored.whatsappUnofficial?.windowEndHour ?? 20,
      hasApiKey: Boolean(stored.whatsappUnofficial?.apiKeyEncrypted || stored.whatsappUnofficial?.secretEncrypted || process.env.WAHA_API_KEY),
      hasWebhookSecret: Boolean(stored.whatsappUnofficial?.webhookSecretEncrypted || process.env.WA_UNOFFICIAL_WEBHOOK_SECRET),
    },
  };
}

export async function saveProviderSettings(branchId: string, input: ProviderSettingsInput) {
  const current = await storedSettings(branchId);
  if (input.smtp.enabled) {
    if (!input.smtp.host || !input.smtp.user || !input.smtp.from) throw new ProviderConfigError("smtp_fields_required");
    if (!input.smtp.password && !current.smtp?.passwordEncrypted && !process.env.SMTP_PASS) throw new ProviderConfigError("smtp_password_required");
  }
  if (input.whatsappOfficial.enabled) {
    if (!input.whatsappOfficial.phoneId || !input.whatsappOfficial.wabaId) throw new ProviderConfigError("whatsapp_official_ids_required");
    if (!input.whatsappOfficial.token && !current.whatsappOfficial?.tokenEncrypted && !process.env.WA_OFFICIAL_TOKEN) throw new ProviderConfigError("whatsapp_official_token_required");
    if (!input.whatsappOfficial.appSecret && !current.whatsappOfficial?.appSecretEncrypted && !process.env.WA_APP_SECRET) throw new ProviderConfigError("whatsapp_app_secret_required");
    if (!input.whatsappOfficial.webhookVerifyToken && !current.whatsappOfficial?.webhookVerifyTokenEncrypted && !process.env.WA_WEBHOOK_VERIFY_TOKEN) throw new ProviderConfigError("whatsapp_webhook_verify_token_required");
  }
  if (input.whatsappUnofficial.enabled) {
    if (!input.whatsappUnofficial.baseUrl) throw new ProviderConfigError("whatsapp_unofficial_url_required");
    if (!input.whatsappUnofficial.callbackUrl) throw new ProviderConfigError("whatsapp_unofficial_callback_url_required");
    if (!input.whatsappUnofficial.session) throw new ProviderConfigError("whatsapp_unofficial_session_required");
    if (!input.whatsappUnofficial.apiKey && !current.whatsappUnofficial?.apiKeyEncrypted && !current.whatsappUnofficial?.secretEncrypted && !process.env.WAHA_API_KEY) throw new ProviderConfigError("waha_api_key_required");
    if (!input.whatsappUnofficial.webhookSecret && !current.whatsappUnofficial?.webhookSecretEncrypted && !process.env.WA_UNOFFICIAL_WEBHOOK_SECRET) throw new ProviderConfigError("waha_webhook_secret_required");
    if (input.whatsappUnofficial.windowStartHour >= input.whatsappUnofficial.windowEndHour) throw new ProviderConfigError("whatsapp_delivery_window_invalid");
  }
  const next: StoredProviderSettings = {
    smtp: {
      enabled: input.smtp.enabled,
      host: input.smtp.host,
      port: input.smtp.port,
      secure: input.smtp.secure,
      user: input.smtp.user,
      from: input.smtp.from,
      passwordEncrypted: input.smtp.password
        ? encryptSecret(input.smtp.password)
        : current.smtp?.passwordEncrypted,
    },
    whatsappOfficial: {
      enabled: input.whatsappOfficial.enabled,
      phoneId: input.whatsappOfficial.phoneId,
      wabaId: input.whatsappOfficial.wabaId,
      graphVersion: input.whatsappOfficial.graphVersion,
      tokenEncrypted: input.whatsappOfficial.token
        ? encryptSecret(input.whatsappOfficial.token)
        : current.whatsappOfficial?.tokenEncrypted,
      appSecretEncrypted: input.whatsappOfficial.appSecret
        ? encryptSecret(input.whatsappOfficial.appSecret)
        : current.whatsappOfficial?.appSecretEncrypted,
      webhookVerifyTokenEncrypted: input.whatsappOfficial.webhookVerifyToken
        ? encryptSecret(input.whatsappOfficial.webhookVerifyToken)
        : current.whatsappOfficial?.webhookVerifyTokenEncrypted,
    },
    whatsappUnofficial: {
      enabled: input.whatsappUnofficial.enabled,
      baseUrl: input.whatsappUnofficial.baseUrl,
      callbackUrl: input.whatsappUnofficial.callbackUrl,
      session: input.whatsappUnofficial.session,
      intervalSeconds: input.whatsappUnofficial.intervalSeconds,
      dailyCap: input.whatsappUnofficial.dailyCap,
      windowStartHour: input.whatsappUnofficial.windowStartHour,
      windowEndHour: input.whatsappUnofficial.windowEndHour,
      apiKeyEncrypted: input.whatsappUnofficial.apiKey
        ? encryptSecret(input.whatsappUnofficial.apiKey)
        : current.whatsappUnofficial?.apiKeyEncrypted ?? current.whatsappUnofficial?.secretEncrypted,
      webhookSecretEncrypted: input.whatsappUnofficial.webhookSecret
        ? encryptSecret(input.whatsappUnofficial.webhookSecret)
        : current.whatsappUnofficial?.webhookSecretEncrypted,
    },
  };
  const json = JSON.parse(JSON.stringify(next)) as Prisma.InputJsonValue;
  await prisma.setting.upsert({
    where: { key: keyFor(branchId) },
    create: { key: keyFor(branchId), value: json },
    update: { value: json },
  });
  providers.configure(runtimeConfig(next));
  return publicProviderSettings(branchId);
}

export async function officialWebhookVerifyToken(branchId = "main") {
  const stored = await storedSettings(branchId);
  return decryptSecret(stored.whatsappOfficial?.webhookVerifyTokenEncrypted) ?? process.env.WA_WEBHOOK_VERIFY_TOKEN;
}
