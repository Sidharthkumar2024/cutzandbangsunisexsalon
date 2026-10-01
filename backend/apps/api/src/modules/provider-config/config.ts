import { Prisma } from "@prisma/client";
import { prisma } from "@cutz/db";
import { providers, decryptSecret, encryptSecret, normalizeEvolutionBaseUrl, type ProviderRuntimeConfig } from "@cutz/providers";
import {
  matchOfficialVerificationBranch,
  matchOfficialWebhookBranch,
  matchUnofficialWebhookBranch,
  type WebhookProviderBranch,
} from "./webhook-scope.js";

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
const envFlag = (value: string | undefined, fallback = false) => {
  if (value == null || value === "") return fallback;
  return /^(1|true|yes|on)$/iu.test(value.trim());
};
const nonEmpty = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const safeUnofficialDailyCap = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 75;
  // QR/web-session campaigns are deliberately kept below high-volume bulk
  // thresholds; use approved Meta templates for larger opted-in audiences.
  return Math.max(5, Math.min(60, Math.round(parsed)));
};

const safeUnofficialHour = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(23, Math.round(parsed)));
};

async function storedSettings(branchId: string): Promise<StoredProviderSettings> {
  const row = await prisma.setting.findUnique({ where: { key: keyFor(branchId) } });
  return (row?.value ?? {}) as StoredProviderSettings;
}

function envProviderSettings(): StoredProviderSettings {
  const smtpConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && (process.env.SMTP_PASS || process.env.EMAIL_FROM));
  const officialConfigured = Boolean(process.env.WA_OFFICIAL_TOKEN && process.env.WA_OFFICIAL_PHONE_ID);
  const unofficialConfigured = Boolean(process.env.EVOLUTION_API_URL && process.env.EVOLUTION_API_KEY && process.env.EVOLUTION_INSTANCE);
  return {
    smtp: {
      enabled: envFlag(process.env.SMTP_ENABLED, smtpConfigured),
      host: process.env.SMTP_HOST ?? "",
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: envFlag(process.env.SMTP_SECURE, Number(process.env.SMTP_PORT) === 465),
      user: process.env.SMTP_USER ?? "",
      from: process.env.EMAIL_FROM ?? "",
      passwordEncrypted: undefined,
    },
    whatsappOfficial: {
      enabled: envFlag(process.env.WA_OFFICIAL_ENABLED, officialConfigured),
      phoneId: process.env.WA_OFFICIAL_PHONE_ID ?? "",
      wabaId: process.env.WA_OFFICIAL_WABA_ID ?? "",
      graphVersion: process.env.WA_GRAPH_VERSION ?? "v23.0",
      tokenEncrypted: undefined,
      appSecretEncrypted: undefined,
      webhookVerifyTokenEncrypted: undefined,
    },
    whatsappUnofficial: {
      enabled: envFlag(process.env.WA_UNOFFICIAL_ENABLED, unofficialConfigured),
      baseUrl: process.env.EVOLUTION_API_URL ?? "",
      callbackUrl: process.env.WA_UNOFFICIAL_CALLBACK_URL ?? "",
      session: process.env.EVOLUTION_INSTANCE ?? "cutz-bangs-main",
      intervalSeconds: Number(process.env.WA_UNOFFICIAL_INTERVAL_SECONDS ?? 720),
      dailyCap: safeUnofficialDailyCap(process.env.WA_UNOFFICIAL_DAILY_CAP ?? 60),
      windowStartHour: safeUnofficialHour(process.env.WA_UNOFFICIAL_WINDOW_START_HOUR ?? 10, 10),
      windowEndHour: safeUnofficialHour(process.env.WA_UNOFFICIAL_WINDOW_END_HOUR ?? 22, 22),
      apiKeyEncrypted: undefined,
      webhookSecretEncrypted: undefined,
    },
  };
}

function mergeStoredWithEnv(stored: StoredProviderSettings): StoredProviderSettings {
  const env = envProviderSettings();
  const envSmtp = env.smtp!;
  const envOfficial = env.whatsappOfficial!;
  const envUnofficial = env.whatsappUnofficial!;
  return {
    smtp: {
      ...envSmtp,
      ...stored.smtp,
      enabled: envSmtp.enabled || (stored.smtp?.enabled ?? false),
      host: nonEmpty(stored.smtp?.host) ?? envSmtp.host,
      port: stored.smtp?.port ?? envSmtp.port,
      secure: stored.smtp?.secure ?? envSmtp.secure,
      user: nonEmpty(stored.smtp?.user) ?? envSmtp.user,
      from: nonEmpty(stored.smtp?.from) ?? envSmtp.from,
      passwordEncrypted: stored.smtp?.passwordEncrypted,
    },
    whatsappOfficial: {
      ...envOfficial,
      ...stored.whatsappOfficial,
      enabled: envOfficial.enabled || (stored.whatsappOfficial?.enabled ?? false),
      phoneId: nonEmpty(stored.whatsappOfficial?.phoneId) ?? envOfficial.phoneId,
      wabaId: nonEmpty(stored.whatsappOfficial?.wabaId) ?? envOfficial.wabaId,
      graphVersion: nonEmpty(stored.whatsappOfficial?.graphVersion) ?? envOfficial.graphVersion,
      tokenEncrypted: stored.whatsappOfficial?.tokenEncrypted,
      appSecretEncrypted: stored.whatsappOfficial?.appSecretEncrypted,
      webhookVerifyTokenEncrypted: stored.whatsappOfficial?.webhookVerifyTokenEncrypted,
    },
    whatsappUnofficial: {
      ...envUnofficial,
      ...stored.whatsappUnofficial,
      enabled: envUnofficial.enabled || (stored.whatsappUnofficial?.enabled ?? false),
      baseUrl: nonEmpty(stored.whatsappUnofficial?.baseUrl) ?? envUnofficial.baseUrl,
      callbackUrl: nonEmpty(stored.whatsappUnofficial?.callbackUrl) ?? envUnofficial.callbackUrl,
      session: nonEmpty(stored.whatsappUnofficial?.session) ?? envUnofficial.session,
      intervalSeconds: stored.whatsappUnofficial?.intervalSeconds ?? envUnofficial.intervalSeconds,
      dailyCap: safeUnofficialDailyCap(stored.whatsappUnofficial?.dailyCap ?? envUnofficial.dailyCap),
      windowStartHour: safeUnofficialHour(stored.whatsappUnofficial?.windowStartHour ?? envUnofficial.windowStartHour, 0),
      windowEndHour: safeUnofficialHour(stored.whatsappUnofficial?.windowEndHour ?? envUnofficial.windowEndHour, 23),
      apiKeyEncrypted: stored.whatsappUnofficial?.apiKeyEncrypted ?? stored.whatsappUnofficial?.secretEncrypted,
      webhookSecretEncrypted: stored.whatsappUnofficial?.webhookSecretEncrypted,
    },
  };
}

async function configuredWebhookBranches(): Promise<WebhookProviderBranch[]> {
  const rows = await prisma.setting.findMany({
    where: { key: { startsWith: "branch:", endsWith: ":providers" } },
    select: { key: true, value: true },
  });
  const storedCandidates = rows.flatMap((row) => {
    const branchId = /^branch:(.+):providers$/u.exec(row.key)?.[1];
    if (!branchId) return [];
    const stored = row.value as StoredProviderSettings;
    return [{
      branchId,
      whatsappOfficial: stored.whatsappOfficial ? {
        enabled: stored.whatsappOfficial.enabled,
        phoneId: stored.whatsappOfficial.phoneId,
        wabaId: stored.whatsappOfficial.wabaId,
        verifyToken: decryptSecret(stored.whatsappOfficial.webhookVerifyTokenEncrypted) ?? process.env.WA_WEBHOOK_VERIFY_TOKEN,
      } : undefined,
      whatsappUnofficial: stored.whatsappUnofficial ? {
        enabled: stored.whatsappUnofficial.enabled,
        session: stored.whatsappUnofficial.session,
      } : undefined,
    } satisfies WebhookProviderBranch];
  });

  const envBranchId = process.env.WA_DEFAULT_BRANCH_ID ?? process.env.NEXT_PUBLIC_BRANCH_ID;
  if (envBranchId && !storedCandidates.some((candidate) => candidate.branchId === envBranchId)) {
    storedCandidates.push({
      branchId: envBranchId,
      whatsappOfficial: {
        enabled: Boolean(process.env.WA_OFFICIAL_PHONE_ID && process.env.WA_OFFICIAL_WABA_ID),
        phoneId: process.env.WA_OFFICIAL_PHONE_ID ?? "",
        wabaId: process.env.WA_OFFICIAL_WABA_ID ?? "",
        verifyToken: process.env.WA_WEBHOOK_VERIFY_TOKEN,
      },
      whatsappUnofficial: {
        enabled: Boolean(process.env.EVOLUTION_API_URL && process.env.EVOLUTION_INSTANCE),
        session: process.env.EVOLUTION_INSTANCE ?? "",
      },
    });
  }

  if (!storedCandidates.length) return [];
  const branches = await prisma.branch.findMany({
    where: { id: { in: storedCandidates.map((candidate) => candidate.branchId) }, deletedAt: null },
    select: { id: true },
  });
  const active = new Set(branches.map((branch) => branch.id));
  return storedCandidates.filter((candidate) => active.has(candidate.branchId));
}

export async function resolveOfficialWebhookBranch(identity: { phoneId?: string; wabaId?: string }) {
  return matchOfficialWebhookBranch(await configuredWebhookBranches(), identity);
}

export async function resolveOfficialVerificationBranch(verifyToken: string) {
  return matchOfficialVerificationBranch(await configuredWebhookBranches(), verifyToken);
}

export async function resolveUnofficialWebhookBranch(session: string) {
  return matchUnofficialWebhookBranch(await configuredWebhookBranches(), session);
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
          // The VPS-managed connector key is the authoritative credential.
          // A previously saved panel key can survive a connector-key rotation
          // and then turn every QR action into a misleading 403.
          apiKey: process.env.EVOLUTION_API_KEY ?? decryptSecret(stored.whatsappUnofficial.apiKeyEncrypted ?? stored.whatsappUnofficial.secretEncrypted),
          webhookSecret: decryptSecret(stored.whatsappUnofficial.webhookSecretEncrypted),
          callbackUrl: stored.whatsappUnofficial.callbackUrl || process.env.WA_UNOFFICIAL_CALLBACK_URL,
        }
      : undefined,
  };
}

export async function applyProviderSettings(branchId = "main") {
  const stored = mergeStoredWithEnv(await storedSettings(branchId));
  return providers.scoped(runtimeConfig(stored));
}

export async function publicProviderSettings(branchId = "main") {
  const stored = mergeStoredWithEnv(await storedSettings(branchId));
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
      session: stored.whatsappUnofficial?.session ?? process.env.EVOLUTION_INSTANCE ?? "cutz-bangs-main",
      intervalSeconds: stored.whatsappUnofficial?.intervalSeconds ?? 90,
      dailyCap: safeUnofficialDailyCap(stored.whatsappUnofficial?.dailyCap ?? 75),
      windowStartHour: safeUnofficialHour(stored.whatsappUnofficial?.windowStartHour ?? 0, 0),
      windowEndHour: safeUnofficialHour(stored.whatsappUnofficial?.windowEndHour ?? 23, 23),
      hasApiKey: Boolean(stored.whatsappUnofficial?.apiKeyEncrypted || stored.whatsappUnofficial?.secretEncrypted || process.env.EVOLUTION_API_KEY),
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
    if (!input.whatsappUnofficial.apiKey && !current.whatsappUnofficial?.apiKeyEncrypted && !current.whatsappUnofficial?.secretEncrypted && !process.env.EVOLUTION_API_KEY) throw new ProviderConfigError("evolution_api_key_required");
    if (!input.whatsappUnofficial.webhookSecret && !current.whatsappUnofficial?.webhookSecretEncrypted && !process.env.WA_UNOFFICIAL_WEBHOOK_SECRET) throw new ProviderConfigError("waha_webhook_secret_required");
  }
  let normalizedWahaBaseUrl = input.whatsappUnofficial.baseUrl;
  if (input.whatsappUnofficial.baseUrl) {
    try {
      normalizedWahaBaseUrl = normalizeEvolutionBaseUrl(input.whatsappUnofficial.baseUrl);
    } catch (error) {
      throw new ProviderConfigError(error instanceof Error ? error.message : "evolution_base_url_invalid");
    }
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
      baseUrl: normalizedWahaBaseUrl,
      callbackUrl: input.whatsappUnofficial.callbackUrl,
      session: input.whatsappUnofficial.session,
      intervalSeconds: input.whatsappUnofficial.intervalSeconds,
      dailyCap: safeUnofficialDailyCap(input.whatsappUnofficial.dailyCap),
      windowStartHour: 0,
      windowEndHour: 23,
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
  return publicProviderSettings(branchId);
}
