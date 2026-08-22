// Background worker: reminders, email, campaigns.
//
// Idempotency is enforced two ways so a restart never double-sends:
//   1. Reminder scheduling uses a deterministic BullMQ jobId
//      (`reminder:<appointmentId>:<type>`) — re-enqueueing is a no-op.
//   2. Send handlers write an AutomationRun / EmailLog with a unique dedupeKey;
//      a duplicate key means "already handled — skip".

import { Worker } from "bullmq";
import { prisma } from "@cutz/db";
import { makeConnection, QUEUES, ReminderJob, EmailJob, CampaignJob } from "@cutz/queue";
import { appointmentEmail, appointmentWhatsAppText, decryptSecret, providers } from "@cutz/providers";

const connection = makeConnection();

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
      await applyStoredProviderSettings(appt.branchId);
      if (to) {
        const result = await providers.email().send({ to, subject: "Reminder: your Cutz & Bangs appointment", html: appointmentEmail({ name, when: appt.startAt, services, kind: "reminder" }), dedupeKey: `email-${dedupeKey}` });
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
          const result = await providers.whatsapp(channel).send({ to: phone, body: appointmentWhatsAppText({ name, when: appt.startAt, services, kind: "reminder" }) });
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
      await applyStoredProviderSettings(branchId);
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
      const res = await providers.email().send({ to, subject, html, attachments: resolved });
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
    await applyStoredProviderSettings(campaign.branchId);

    const recipient = await prisma.campaignRecipient.findUnique({ where: { id: recipientId } });
    if (!recipient || recipient.campaignId !== campaignId || recipient.status !== "queued") return;
    const customer = await prisma.customer.findUnique({ where: { id: recipient.customerId } });
    if (!customer) {
      await mark(recipient.id, "failed", "customer_not_found");
      await finishCampaignIfComplete(campaignId);
      return;
    }
    try {
      const mediaUrl = campaign.mediaKey ? await providers.storage().signedUrl(campaign.mediaKey, 3_600) : undefined;
      let externalId: string | undefined;
      if (campaign.channel === "EMAIL" && customer.email && customer.emailConsent) {
        const image = mediaUrl && campaign.mediaType === "image" ? `<p><img src="${mediaUrl}" alt="" style="max-width:100%;height:auto" /></p>` : "";
        const result = await providers.email().send({ to: customer.email, subject: campaign.name, html: `${image}<p>${campaign.content}</p>` });
        if (result.status === "failed") throw new Error(result.error ?? "email_send_failed");
        externalId = result.externalId || undefined;
      } else if (["WHATSAPP_OFFICIAL", "WHATSAPP_UNOFFICIAL"].includes(campaign.channel) && customer.phone && customer.waConsent) {
        const body = campaign.channel === "WHATSAPP_UNOFFICIAL" && !/reply\s+stop|बंद/i.test(campaign.content)
          ? `${campaign.content}\n\nReply STOP to opt out.`
          : campaign.content;
        const result = await providers.whatsapp(campaign.channel as "WHATSAPP_OFFICIAL" | "WHATSAPP_UNOFFICIAL").send({
          to: customer.phone,
          body,
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
    } catch (error) {
      await mark(recipient.id, "failed", error instanceof Error ? error.message : "send_failed");
    }
    await finishCampaignIfComplete(campaignId);
  },
  { connection },
);

function mark(id: string, status: string, error?: string, externalId?: string) {
  return prisma.campaignRecipient.update({
    where: { id },
    data: { status, sentAt: status === "skipped" ? undefined : new Date(), error: error?.slice(0, 500), externalId },
  });
}

async function finishCampaignIfComplete(campaignId: string) {
  const remaining = await prisma.campaignRecipient.count({ where: { campaignId, status: "queued" } });
  if (!remaining) await prisma.campaign.update({ where: { id: campaignId }, data: { status: "SENT" } });
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

console.log("worker up: reminders, email, campaigns");

type StoredProviders = {
  smtp?: { enabled?: boolean; host?: string; port?: number; secure?: boolean; user?: string; from?: string; passwordEncrypted?: string };
  whatsappOfficial?: { enabled?: boolean; phoneId?: string; wabaId?: string; graphVersion?: string; tokenEncrypted?: string; appSecretEncrypted?: string };
  whatsappUnofficial?: {
    enabled?: boolean;
    baseUrl?: string;
    callbackUrl?: string;
    session?: string;
    apiKeyEncrypted?: string;
    webhookSecretEncrypted?: string;
    secretEncrypted?: string;
  };
};

async function applyStoredProviderSettings(branchId: string) {
  const row = await prisma.setting.findUnique({ where: { key: `branch:${branchId}:providers` } });
  const value = (row?.value ?? {}) as StoredProviders;
  providers.configure({
    smtp: value.smtp ? { ...value.smtp, password: decryptSecret(value.smtp.passwordEncrypted) } : undefined,
    whatsappOfficial: value.whatsappOfficial
      ? { ...value.whatsappOfficial, token: decryptSecret(value.whatsappOfficial.tokenEncrypted), appSecret: decryptSecret(value.whatsappOfficial.appSecretEncrypted) }
      : undefined,
    whatsappUnofficial: value.whatsappUnofficial
      ? {
          ...value.whatsappUnofficial,
          apiKey: decryptSecret(value.whatsappUnofficial.apiKeyEncrypted ?? value.whatsappUnofficial.secretEncrypted),
          webhookSecret: decryptSecret(value.whatsappUnofficial.webhookSecretEncrypted),
          callbackUrl: value.whatsappUnofficial.callbackUrl || process.env.WA_UNOFFICIAL_CALLBACK_URL,
        }
      : undefined,
  });
}
