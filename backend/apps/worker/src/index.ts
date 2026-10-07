// Background worker: reminders, email, campaigns.
//
// Idempotency is enforced two ways so a restart never double-sends:
//   1. Reminder scheduling uses a deterministic BullMQ jobId
//      (`reminder:<appointmentId>:<type>`) — re-enqueueing is a no-op.
//   2. Send handlers write an AutomationRun / EmailLog with a unique dedupeKey;
//      a duplicate key means "already handled — skip".

import { Worker } from "bullmq";
import { prisma } from "@cutz/db";
import { enqueueCampaignRecipient, makeConnection, QUEUES, ReminderJob, EmailJob, CampaignJob } from "@cutz/queue";
import { appointmentEmail, appointmentWhatsAppText, decryptSecret, providers } from "@cutz/providers";

const connection = makeConnection();

type CampaignCtaButton = {
  type: "CALL" | "WEBSITE" | "LOCATION";
  label: string;
  value: string;
  secondary?: string | null;
};
type CampaignRecurrenceRule = {
  enabled: boolean;
  frequency: "WEEKLY" | "MONTHLY";
  daysOfWeek?: number[];
  daysOfMonth?: number[];
  time: string;
  endDate?: string;
};

function campaignCtaButtons(value: unknown): CampaignCtaButton[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const button = item as Partial<CampaignCtaButton>;
    if (!["CALL", "WEBSITE", "LOCATION"].includes(String(button.type))) return [];
    const label = String(button.label ?? "").trim();
    const rawValue = String(button.value ?? "").trim();
    if (label.length < 2 || rawValue.length < 3) return [];
    return [{ type: button.type as CampaignCtaButton["type"], label, value: rawValue, secondary: button.secondary }];
  }).slice(0, 3);
}

function campaignLocationUrl(value: string) {
  if (/^https?:\/\//iu.test(value)) return value;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(value)}`;
}

function campaignCtaText(value: unknown) {
  const buttons = campaignCtaButtons(value);
  if (!buttons.length) return "";
  const lines = buttons.map((button) => {
    if (button.type === "CALL") return `☎ ${button.label}: ${button.value}`;
    if (button.type === "LOCATION") return `📍 ${button.label}: ${campaignLocationUrl(button.value)}`;
    return `↗ ${button.label}: ${button.value}`;
  });
  return `\n\nQuick actions:\n${lines.join("\n")}`;
}

function campaignRecurrenceRule(value: unknown): CampaignRecurrenceRule | null {
  if (!value || typeof value !== "object") return null;
  const rule = value as Partial<CampaignRecurrenceRule>;
  const frequency = rule.frequency;
  const time = rule.time;
  if (!rule.enabled || (frequency !== "WEEKLY" && frequency !== "MONTHLY")) return null;
  if (typeof time !== "string" || !/^\d{2}:\d{2}$/u.test(time)) return null;
  const daysOfWeek = Array.isArray(rule.daysOfWeek)
    ? rule.daysOfWeek.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    : [];
  const daysOfMonth = Array.isArray(rule.daysOfMonth)
    ? rule.daysOfMonth.map(Number).filter((day) => Number.isInteger(day) && day >= 1 && day <= 31)
    : [];
  if (frequency === "WEEKLY" && !daysOfWeek.length) return null;
  if (frequency === "MONTHLY" && !daysOfMonth.length) return null;
  const endDate = typeof rule.endDate === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(rule.endDate) ? rule.endDate : undefined;
  return { enabled: true, frequency, daysOfWeek, daysOfMonth, time, endDate };
}

function localDateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return { year: get("year"), month: get("month"), day: get("day") };
}

function localDateKeyFromParts(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function localToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string) {
  const rough = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
  const actual = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(rough);
  const part = (type: string) => Number(actual.find((item) => item.type === type)?.value ?? "0");
  const actualAsUtc = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), 0, 0);
  const wantedAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  return new Date(rough.getTime() + (wantedAsUtc - actualAsUtc));
}

function nextRecurringAt(rule: CampaignRecurrenceRule | null | undefined, after: Date, timeZone: string) {
  if (!rule?.enabled) return null;
  const [hour, minute] = rule.time.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  const start = localDateParts(after, timeZone);
  const startUtc = Date.UTC(start.year, start.month - 1, start.day);
  const afterWithBuffer = new Date(after.getTime() + 60_000);
  for (let offset = 0; offset < 370; offset += 1) {
    const local = new Date(startUtc + offset * 86_400_000);
    const year = local.getUTCFullYear();
    const month = local.getUTCMonth() + 1;
    const day = local.getUTCDate();
    const localKey = localDateKeyFromParts(year, month, day);
    if (rule.endDate && localKey > rule.endDate) return null;
    const weekday = local.getUTCDay();
    const matches = rule.frequency === "WEEKLY"
      ? (rule.daysOfWeek ?? []).includes(weekday)
      : (rule.daysOfMonth ?? []).includes(day);
    if (!matches) continue;
    const candidate = localToUtc(year, month, day, hour, minute, timeZone);
    if (candidate > afterWithBuffer) return candidate;
  }
  return null;
}

// ---- Reminders ----
new Worker<ReminderJob>(
  QUEUES.reminders,
  async (job) => {
    const { appointmentId, type } = job.data;
    const appt = await prisma.appointment.findUnique({ where: { id: appointmentId }, include: { customer: true, items: { include: { service: { select: { name: true } } } } } });
    if (!appt || ["CANCELLED", "NO_SHOW", "COMPLETED"].includes(appt.status)) return;

    const dedupeKey = `reminder:${appointmentId}:${type}`;
    const existingRun = await prisma.automationRun.findUnique({ where: { dedupeKey } });
    if (existingRun?.status === "sent" || existingRun?.status === "skipped") return;
    const run = existingRun ?? await prisma.automationRun.create({ data: { ruleId: await reminderRuleId(), dedupeKey, status: "queued" } });

    const to = appt.customer?.email ?? appt.guestEmail;
    const phone = appt.customer?.phone ?? appt.guestPhone;
    const name = appt.customer?.name ?? appt.guestName ?? undefined;
    const services = appt.items.map((item) => item.service.name);
    const waConsent = Boolean(appt.customer?.waConsent || /WhatsApp consent:\s*yes/iu.test(appt.notes ?? ""));
    if (!to && (!phone || !waConsent)) {
      await prisma.automationRun.update({ where: { id: run.id }, data: { status: "skipped" } });
      return;
    }
    try {
      const providerContext = await applyStoredProviderSettings(appt.branchId);
      const emailProvider = providerContext.email();
      const officialMessaging = providerContext.whatsapp("WHATSAPP_OFFICIAL");
      const unofficialMessaging = providerContext.whatsapp("WHATSAPP_UNOFFICIAL");
      if (to) {
        const result = await emailProvider.send({ to, subject: "Reminder: your Cutz & Bangs appointment", html: appointmentEmail({ name, when: appt.startAt, services, kind: "reminder" }), dedupeKey: `email-${dedupeKey}` });
        if (result.status === "failed") throw new Error(result.error ?? "reminder_email_failed");
      }
      if (phone && waConsent) {
        const channels = await prisma.channel.findMany({ where: { type: { in: ["WHATSAPP_UNOFFICIAL", "WHATSAPP_OFFICIAL"] }, isActive: true } });
        const channel = channels.some((item) => item.type === "WHATSAPP_UNOFFICIAL")
          ? ("WHATSAPP_UNOFFICIAL" as const)
          : channels.some((item) => item.type === "WHATSAPP_OFFICIAL")
            ? ("WHATSAPP_OFFICIAL" as const)
            : undefined;
        if (channel) {
          const result = await (channel === "WHATSAPP_UNOFFICIAL" ? unofficialMessaging : officialMessaging).send({ to: phone, body: appointmentWhatsAppText({ name, when: appt.startAt, services, kind: "reminder" }) });
          if (result.status === "failed") throw new Error(result.error ?? "reminder_whatsapp_failed");
        }
      }
      await prisma.automationRun.update({ where: { id: run.id }, data: { status: "sent" } });
    } catch (error) {
      await prisma.automationRun.update({ where: { id: run.id }, data: { status: "failed" } }).catch(() => {});
      throw error;
    }
    console.log(`[reminder] ${type} for ${appointmentId}`);
  },
  { connection },
);

// ---- Email ----
new Worker<EmailJob>(
  QUEUES.email,
  async (job) => {
    const { branchId = "main", to, subject, html, dedupeKey, attachments } = job.data;
    let logId: string | undefined;
    if (dedupeKey) {
      const existing = await prisma.emailLog.findUnique({ where: { dedupeKey } });
      if (existing?.status === "sent") return;
      const log = existing ?? await prisma.emailLog.create({ data: { to, subject, status: "queued", dedupeKey } });
      logId = log.id;
    }
    try {
      const providerContext = await applyStoredProviderSettings(branchId);
      const emailProvider = providerContext.email();
      // Resolve storage-key attachments to inline bytes (works with S3 or local disk).
      const resolved = attachments
        ? await Promise.all(
            attachments.map(async (a) => ({
              filename: a.filename,
              path: a.path,
              content: a.storageKey ? (await providers.storage().get(a.storageKey)) ?? undefined : undefined,
            })),
          )
        : undefined;
      const res = await emailProvider.send({ to, subject, html, attachments: resolved });
      if (res.status === "failed") throw new Error(res.error ?? "email_send_failed");
      if (logId) await prisma.emailLog.update({ where: { id: logId }, data: { status: res.status, error: null } });
    } catch (error) {
      if (logId) await prisma.emailLog.update({ where: { id: logId }, data: { status: "failed", error: error instanceof Error ? error.message.slice(0, 500) : "send_failed" } }).catch(() => {});
      throw error;
    }
  },
  { connection },
);

// ---- Campaigns ----
new Worker<CampaignJob>(
  QUEUES.campaigns,
  async (job) => {
    const { campaignId, recipientId } = job.data;
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign || !["SENDING", "SCHEDULED"].includes(campaign.status)) return;
    if (campaign.status === "SCHEDULED") {
      await prisma.campaign.update({ where: { id: campaignId }, data: { status: "SENDING" } });
    }
    const providerContext = await applyStoredProviderSettings(campaign.branchId);
    const emailProvider = providerContext.email();
    const officialMessaging = providerContext.whatsapp("WHATSAPP_OFFICIAL");

    const recipient = await prisma.campaignRecipient.findUnique({ where: { id: recipientId } });
    if (!recipient || recipient.campaignId !== campaignId || recipient.status !== "queued") return;
    if (campaign.channel === "WHATSAPP_UNOFFICIAL") {
      await mark(recipient.id, "failed", "unofficial_whatsapp_campaigns_disabled");
      await finishCampaignIfComplete(campaignId);
      return;
    }
    const customer = recipient.customerId
      ? await prisma.customer.findUnique({ where: { id: recipient.customerId } })
      : null;
    const recipientName = customer?.name ?? recipient.externalName ?? (recipient.externalPhone ? `Guest ${recipient.externalPhone.slice(-4)}` : "there");
    const recipientPhone = customer?.phone ?? recipient.externalPhone;
    const recipientEmail = customer?.email ?? recipient.externalEmail;
    if (recipient.customerId && !customer && !recipientPhone && !recipientEmail) {
      await mark(recipient.id, "failed", "customer_not_found");
      await finishCampaignIfComplete(campaignId);
      return;
    }
    try {
      const daysSinceVisit = customer?.lastVisitAt
        ? Math.max(0, Math.floor((Date.now() - customer.lastVisitAt.getTime()) / 86_400_000))
        : 0;
      const personalizedContent = campaign.content.replace(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/gu, (_match, key: string) => {
        const values: Record<string, string | number> = {
          name: recipientName,
          days: daysSinceVisit,
        };
        return String(values[key] ?? "");
      });
      const content = `${personalizedContent}${campaignCtaText((campaign as { ctaJson?: unknown }).ctaJson)}`;
      const mediaUrl = campaign.mediaKey ? await providers.storage().signedUrl(campaign.mediaKey, 3_600) : undefined;
      let externalId: string | undefined;
      if (campaign.channel === "EMAIL" && recipientEmail && (!customer || customer.emailConsent)) {
        const image = mediaUrl && campaign.mediaType === "image" ? `<p><img src="${mediaUrl}" alt="" style="max-width:100%;height:auto" /></p>` : "";
        const result = await emailProvider.send({ to: recipientEmail, subject: campaign.name, html: `${image}<p>${content}</p>` });
        if (result.status === "failed") throw new Error(result.error ?? "email_send_failed");
        externalId = result.externalId || undefined;
      } else if (campaign.channel === "WHATSAPP_OFFICIAL" && recipientPhone && (!customer || customer.waConsent)) {
        const messaging = officialMessaging;
        const health = await messaging.health?.();
        if (health && (!health.configured || !health.connected)) {
          throw new Error(health.detail ?? `${campaign.channel.toLowerCase()}_not_connected`);
        }
        const templateVariableCount = Math.max(0, ...Array.from(campaign.content.matchAll(/\{\{(\d+)\}\}/gu), (match) => Number(match[1] ?? 0)));
        const templateValues = [recipientName, String(daysSinceVisit)];
        const variables = templateVariableCount
          ? Object.fromEntries(Array.from({ length: templateVariableCount }, (_, index) => [String(index + 1), templateValues[index] ?? "-"]))
          : undefined;
        const result = await messaging.send({
          to: recipientPhone,
          body: content,
          templateName: campaign.templateName ?? undefined,
          templateLanguage: campaign.templateLanguage ?? undefined,
          variables,
          mediaUrl,
          mediaType: campaign.mediaType as "image" | "document" | "video" | undefined,
        });
        if (result.status === "failed") throw new Error(result.error ?? "whatsapp_send_failed");
        externalId = result.externalId || undefined;
      } else {
        await mark(recipient.id, "skipped", "consent_or_destination_missing");
        await finishCampaignIfComplete(campaignId);
        return;
      }
      await mark(recipient.id, "sent", undefined, externalId);
      console.log(`[campaign] sent campaign=${campaignId} recipient=${recipient.id} channel=${campaign.channel}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "send_failed";
      const attempts = Math.max(1, Number(job.opts.attempts ?? 1));
      const finalAttempt = job.attemptsMade + 1 >= attempts;
      console.error(`[campaign] ${finalAttempt ? "failed" : "retrying"} campaign=${campaignId} recipient=${recipient.id} attempt=${job.attemptsMade + 1}/${attempts} error=${detail}`);
      if (!finalAttempt) throw error;
      await mark(recipient.id, "failed", detail);
    }
    await finishCampaignIfComplete(campaignId);
  },
  { connection },
);

async function mark(id: string, status: string, error?: string, externalId?: string) {
  try {
    return await prisma.campaignRecipient.update({
      where: { id },
      data: { status, sentAt: status === "skipped" ? undefined : new Date(), error: error?.slice(0, 500), externalId },
    });
  } catch (cause) {
    const prismaCode = typeof cause === "object" && cause && "code" in cause ? cause.code : undefined;
    const prismaTarget = typeof cause === "object" && cause && "meta" in cause
      ? (cause.meta as { target?: unknown }).target
      : undefined;
    const externalIdConflict = externalId && (
      prismaCode === "P2002"
      || (Array.isArray(prismaTarget) && prismaTarget.some((target) => String(target).toLowerCase().includes("externalid")))
      || (cause instanceof Error && /externalid/iu.test(cause.message))
    );
    if (
      externalIdConflict
    ) {
      return prisma.campaignRecipient.update({
        where: { id },
        data: {
          status,
          sentAt: status === "skipped" ? undefined : new Date(),
          error: error?.slice(0, 500),
          externalId: null,
        },
      });
    }
    throw cause;
  }
}

async function finishCampaignIfComplete(campaignId: string) {
  const remaining = await prisma.campaignRecipient.count({ where: { campaignId, status: "queued" } });
  if (!remaining) await prisma.campaign.update({ where: { id: campaignId }, data: { status: "SENT" } });
}

/**
 * Plans QR-connector campaigns for the salon's overnight window. Recipients
 * still require consent and every message includes a STOP instruction.
 */
function nextCampaignWindowStart(after: Date, timeZone: string, startHour = 22) {
  const local = localDateParts(after, timeZone);
  const today = localToUtc(local.year, local.month, local.day, startHour, 0, timeZone);
  if (after.getTime() <= today.getTime()) return today;
  const tomorrow = new Date(Date.UTC(local.year, local.month - 1, local.day + 1));
  return localToUtc(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate(), startHour, 0, timeZone);
}

async function queueCampaignRun(campaignId: string, startAt: Date, intervalSeconds: number, dailyCap?: number | null) {
  const recipients = await prisma.campaignRecipient.findMany({
    where: { campaignId, status: "queued" },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  if (!recipients.length) {
    await prisma.campaign.update({ where: { id: campaignId }, data: { status: "SENT" } });
    return;
  }
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, include: { branch: { select: { timezone: true } } } });
  if (!campaign) return;
  const timeZone = campaign.branch.timezone || "Asia/Kolkata";
  // 60 is deliberately below the former 75/day default. Bulk, high-volume
  // sends should use opted-in approved Meta templates instead.
  const cappedDailyLimit = Math.max(1, Math.min(60, Math.round(dailyCap ?? recipients.length)));
  // Unofficial campaigns are intentionally limited to 22:00–06:00 local time.
  // This is delivery scheduling, not a bypass of WhatsApp policy: consent,
  // opt-out text and the capped daily volume still apply.
  const windowStartHour = 22;
  const windowMs = 8 * 60 * 60 * 1000;
  const requestedSpacingMs = Math.max(60_000, intervalSeconds * 1000);
  const plan = recipients.map((recipient, index) => ({
    id: recipient.id,
    scheduledFor: (() => {
      const dayOffset = Math.floor(index / cappedDailyLimit);
      const base = nextCampaignWindowStart(startAt, timeZone, windowStartHour);
      const baseParts = localDateParts(new Date(base.getTime() + dayOffset * 86_400_000), timeZone);
      const dayStart = localToUtc(baseParts.year, baseParts.month, baseParts.day, windowStartHour, 0, timeZone);
      const slot = index % cappedDailyLimit;
      const distributedSpacing = Math.floor(windowMs / cappedDailyLimit);
      const spacing = Math.max(requestedSpacingMs, distributedSpacing);
      return new Date(dayStart.getTime() + Math.min(windowMs - 60_000, slot * spacing));
    })(),
  }));
  const firstRunAt = plan[0]!.scheduledFor;
  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: firstRunAt.getTime() > Date.now() + 5_000 ? "SCHEDULED" : "SENDING" },
  });
  await prisma.$transaction(plan.map((item) => prisma.campaignRecipient.update({
    where: { id: item.id },
    data: { scheduledFor: item.scheduledFor },
  })));
  await Promise.all(plan.map((item) => enqueueCampaignRecipient({ campaignId, recipientId: item.id }, item.scheduledFor)));
}

let recurringSchedulerRunning = false;
async function runRecurringCampaignScheduler() {
  if (recurringSchedulerRunning) return;
  recurringSchedulerRunning = true;
  try {
    const due = await prisma.campaign.findMany({
      where: {
        recurrenceEnabled: true,
        recurrenceParentId: null,
        recurrenceNextAt: { lte: new Date() },
      },
      orderBy: { recurrenceNextAt: "asc" },
      take: 10,
      include: {
        recipients: {
          select: {
            customerId: true,
            externalName: true,
            externalPhone: true,
            externalEmail: true,
          },
        },
      },
    });
    for (const template of due) {
      if (!template.recurrenceNextAt) continue;
      const branch = await prisma.branch.findUnique({ where: { id: template.branchId }, select: { timezone: true } });
      const timeZone = branch?.timezone ?? "Asia/Kolkata";
      const rule = campaignRecurrenceRule(template.recurrenceRule);
      const nextRun = nextRecurringAt(rule, template.recurrenceNextAt, timeZone);
      const claim = await prisma.campaign.updateMany({
        where: { id: template.id, recurrenceNextAt: template.recurrenceNextAt },
        data: { recurrenceLastAt: template.recurrenceNextAt, recurrenceNextAt: nextRun },
      });
      if (!claim.count) continue;
      if (!rule) continue;
      const recipientCreates = template.recipients
        .filter((recipient) => recipient.customerId || recipient.externalPhone || recipient.externalEmail)
        .map((recipient) => ({
          customerId: recipient.customerId,
          externalName: recipient.externalName,
          externalPhone: recipient.externalPhone,
          externalEmail: recipient.externalEmail,
        }));
      if (!recipientCreates.length) continue;
      const child = await prisma.campaign.create({
        data: {
          branchId: template.branchId,
          name: `${template.name} · auto ${template.recurrenceNextAt.toLocaleDateString("en-IN")}`,
          channel: template.channel,
          segment: template.segment,
          content: template.content,
          mediaKey: template.mediaKey,
          mediaType: template.mediaType,
          ctaJson: template.ctaJson ?? undefined,
          couponCode: template.couponCode,
          scheduledAt: template.recurrenceNextAt,
          status: "PENDING_APPROVAL",
          recurrenceParentId: template.id,
          intervalSeconds: template.intervalSeconds,
          dailyCap: template.dailyCap,
          riskLevel: template.riskLevel,
          recipients: { create: recipientCreates },
        },
      });
      await queueCampaignRun(
        child.id,
        template.recurrenceNextAt,
        template.intervalSeconds ?? (template.channel === "WHATSAPP_UNOFFICIAL" ? 120 : 0),
        template.channel === "WHATSAPP_UNOFFICIAL" ? template.dailyCap ?? 60 : recipientCreates.length,
      );
      console.log(`[campaign-recurring] queued ${child.id} from ${template.id}`);
    }
  } finally {
    recurringSchedulerRunning = false;
  }
}

let cachedRuleId: string | null = null;
async function reminderRuleId(): Promise<string> {
  if (cachedRuleId) return cachedRuleId;
  const rule = await prisma.automationRule.upsert({
    where: { id: "reminder-default" },
    create: { id: "reminder-default", name: "Appointment reminders", trigger: "reminder", config: {} },
    update: {},
  });
  return (cachedRuleId = rule.id);
}

setInterval(() => void runRecurringCampaignScheduler().catch((error) => console.error("[campaign-recurring]", error)), 60_000);
void runRecurringCampaignScheduler().catch((error) => console.error("[campaign-recurring]", error));

console.log("worker up: reminders, email, campaigns");

type StoredProviders = {
  smtp?: { enabled?: boolean; host?: string; port?: number; secure?: boolean; user?: string; from?: string; passwordEncrypted?: string };
  whatsappOfficial?: { enabled?: boolean; phoneId?: string; wabaId?: string; graphVersion?: string; tokenEncrypted?: string; appSecretEncrypted?: string };
  whatsappUnofficial?: {
    enabled?: boolean;
    baseUrl?: string;
    callbackUrl?: string;
    session?: string;
    intervalSeconds?: number;
    dailyCap?: number;
    windowStartHour?: number;
    windowEndHour?: number;
    apiKeyEncrypted?: string;
    webhookSecretEncrypted?: string;
    secretEncrypted?: string;
  };
};

const envFlag = (value: string | undefined, fallback = false) => {
  if (value == null || value === "") return fallback;
  return /^(1|true|yes|on)$/iu.test(value.trim());
};

const nonEmpty = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

async function applyStoredProviderSettings(branchId: string) {
  const row = await prisma.setting.findUnique({ where: { key: `branch:${branchId}:providers` } });
  const value = (row?.value ?? {}) as StoredProviders;
  const smtpConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && (process.env.SMTP_PASS || process.env.EMAIL_FROM));
  const officialConfigured = Boolean(process.env.WA_OFFICIAL_TOKEN && process.env.WA_OFFICIAL_PHONE_ID);
  const unofficialConfigured = Boolean(process.env.WA_UNOFFICIAL_URL && process.env.WAHA_API_KEY && process.env.WAHA_SESSION);
  const storedSmtp = value.smtp;
  const storedOfficial = value.whatsappOfficial;
  const storedUnofficial = value.whatsappUnofficial;
  return providers.scoped({
    smtp: {
      enabled: envFlag(process.env.SMTP_ENABLED, smtpConfigured) || (storedSmtp?.enabled ?? false),
      host: nonEmpty(storedSmtp?.host) ?? process.env.SMTP_HOST ?? "",
      port: storedSmtp?.port ?? Number(process.env.SMTP_PORT ?? 587),
      secure: storedSmtp?.secure ?? envFlag(process.env.SMTP_SECURE, Number(process.env.SMTP_PORT) === 465),
      user: nonEmpty(storedSmtp?.user) ?? process.env.SMTP_USER ?? "",
      from: nonEmpty(storedSmtp?.from) ?? process.env.EMAIL_FROM ?? "",
      password: decryptSecret(storedSmtp?.passwordEncrypted) ?? process.env.SMTP_PASS,
    },
    whatsappOfficial: {
      enabled: envFlag(process.env.WA_OFFICIAL_ENABLED, officialConfigured) || (storedOfficial?.enabled ?? false),
      phoneId: nonEmpty(storedOfficial?.phoneId) ?? process.env.WA_OFFICIAL_PHONE_ID ?? "",
      wabaId: nonEmpty(storedOfficial?.wabaId) ?? process.env.WA_OFFICIAL_WABA_ID ?? "",
      graphVersion: nonEmpty(storedOfficial?.graphVersion) ?? process.env.WA_GRAPH_VERSION ?? "v23.0",
      token: decryptSecret(storedOfficial?.tokenEncrypted) ?? process.env.WA_OFFICIAL_TOKEN,
      appSecret: decryptSecret(storedOfficial?.appSecretEncrypted) ?? process.env.WA_APP_SECRET,
    },
    whatsappUnofficial: storedUnofficial || unofficialConfigured
      ? {
          enabled: envFlag(process.env.WA_UNOFFICIAL_ENABLED, unofficialConfigured) || (storedUnofficial?.enabled ?? false),
          baseUrl: nonEmpty(storedUnofficial?.baseUrl) ?? process.env.WA_UNOFFICIAL_URL ?? "",
          callbackUrl: nonEmpty(storedUnofficial?.callbackUrl) ?? process.env.WA_UNOFFICIAL_CALLBACK_URL ?? "",
          session: nonEmpty(storedUnofficial?.session) ?? process.env.WAHA_SESSION ?? "cutz-bangs-main",
          // Prefer the runtime connector credential after a VPS key rotation;
          // the encrypted settings value remains a fallback for local setups.
          apiKey: process.env.WAHA_API_KEY ?? decryptSecret(storedUnofficial?.apiKeyEncrypted ?? storedUnofficial?.secretEncrypted),
          webhookSecret: decryptSecret(storedUnofficial?.webhookSecretEncrypted) ?? process.env.WA_UNOFFICIAL_WEBHOOK_SECRET,
        }
      : undefined,
  });
}
