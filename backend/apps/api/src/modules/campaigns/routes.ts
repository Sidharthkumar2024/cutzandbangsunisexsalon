import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@cutz/db";
import { authorize } from "../../plugins/auth.js";
import { customersInSegment, DEFAULT_SEGMENT_CONFIG } from "../crm/segments.js";
import { providers } from "@cutz/providers";
import { enqueueCampaignRecipient } from "@cutz/queue";
import { audit } from "../../lib/audit.js";
import { applyProviderSettings, publicProviderSettings } from "../provider-config/config.js";

const ADMIN = ["OWNER", "ADMIN", "MANAGER"] as const;
const CAMPAIGN_CTA_TYPES = ["CALL", "WEBSITE", "LOCATION"] as const;
const CAMPAIGN_RECURRENCE_FREQUENCIES = ["WEEKLY", "MONTHLY"] as const;
const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
const phoneDigits = (value: string) => {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91") && /^[6-9]\d{9}$/.test(digits.slice(2))) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0") && /^[6-9]\d{9}$/.test(digits.slice(1))) return digits.slice(1);
  return digits;
};

const validPhone = (phone: string) => phone.length >= 8 && phone.length <= 15;
const validUrl = (value: string) => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
};
const uniqueValidPhones = (values: string[]) => [
  ...new Set(values.map(phoneDigits).filter(validPhone)),
];
const campaignCtaSchema = z
  .object({
    type: z.enum(CAMPAIGN_CTA_TYPES),
    label: z.string().trim().min(2).max(32),
    value: z.string().trim().min(3).max(300),
    secondary: z.string().trim().max(300).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.type === "CALL" && !validPhone(phoneDigits(value.value))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "cta_call_phone_invalid", path: ["value"] });
    }
    if (value.type === "WEBSITE" && !validUrl(value.value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "cta_website_url_invalid", path: ["value"] });
    }
  });
const campaignRecurrenceSchema = z
  .object({
    enabled: z.boolean().default(false),
    frequency: z.enum(CAMPAIGN_RECURRENCE_FREQUENCIES).default("WEEKLY"),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    daysOfMonth: z.array(z.number().int().min(1).max(31)).max(31).optional(),
    time: z.string().regex(/^\d{2}:\d{2}$/u).default("11:00"),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.enabled) return;
    if (value.frequency === "WEEKLY" && !value.daysOfWeek?.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "recurrence_weekday_required", path: ["daysOfWeek"] });
    }
    if (value.frequency === "MONTHLY" && !value.daysOfMonth?.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "recurrence_month_day_required", path: ["daysOfMonth"] });
    }
  });
type CampaignRecurrenceRule = z.infer<typeof campaignRecurrenceSchema>;
type ManualRecipientInput = {
  name?: string;
  phone: string;
  email?: string;
};
function manualRecipientCreates(values: ManualRecipientInput[]) {
  const unique = new Map<string, { externalName: string; externalPhone: string; externalEmail?: string }>();
  for (const value of values) {
    const phone = phoneDigits(value.phone);
    if (!validPhone(phone) || unique.has(phone)) continue;
    unique.set(phone, {
      externalName: value.name?.trim() || `Guest ${phone.slice(-4)}`,
      externalPhone: phone,
      ...(value.email ? { externalEmail: value.email } : {}),
    });
  }
  return [...unique.values()];
}

function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return { key: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
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

function defaultWeeklyRecurrence(after: Date, timeZone: string): CampaignRecurrenceRule {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(after);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const hour = get("hour") || "11";
  const minute = get("minute") || "00";
  return {
    enabled: true,
    frequency: "WEEKLY",
    daysOfWeek: ALL_WEEKDAYS,
    daysOfMonth: [1],
    time: `${hour}:${minute}`,
  };
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

function unofficialRisk(intervalSeconds: number, dailyCap: number, recipientCount: number) {
  const score = Math.min(100, 48 + (intervalSeconds < 90 ? 8 : 0) + (dailyCap > 75 ? 14 : 0) + (recipientCount > dailyCap ? 7 : 0));
  return { score, label: score >= 85 ? "critical" : score >= 65 ? "high" : "moderate" };
}

export default async function campaignRoutes(app: FastifyInstance) {
  app.get("/campaigns", { preHandler: authorize(...ADMIN) }, async (req) => {
    const rows = await prisma.campaign.findMany({
      where: !["OWNER", "ADMIN"].includes(req.user!.role)
        ? { branchId: req.user!.branchId ?? "__none__" }
        : undefined,
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        _count: { select: { recipients: true } },
        recipients: { select: { status: true, deliveredAt: true, readAt: true, repliedAt: true, customerId: true, externalPhone: true } },
      },
    });
    return rows.map(({ recipients, ...campaign }) => {
      const manualRecipientCount = recipients.filter((recipient) => recipient.externalPhone && !recipient.customerId).length;
      return {
        ...campaign,
        audienceLabel: manualRecipientCount ? "Pasted / CSV audience" : campaign.segment ?? "All customers",
        manualRecipientCount,
        engagement: {
        total: recipients.length,
        sent: recipients.filter((item) => ["sent", "delivered", "read"].includes(item.status)).length,
        delivered: recipients.filter((item) => item.deliveredAt).length,
        read: recipients.filter((item) => item.readAt).length,
        replied: recipients.filter((item) => item.repliedAt).length,
        failed: recipients.filter((item) => item.status === "failed").length,
        },
      };
    });
  });

  // AI draft (admin approves before sending).
  app.post("/campaigns/draft", { preHandler: authorize(...ADMIN) }, async (req) => {
    const { goal, segment, offer } = z
      .object({ goal: z.string(), segment: z.string().optional(), offer: z.string().optional() })
      .parse(req.body);
    // (Draft generation is stateless text; no branch payload to authorize here.)
    const content = await providers.ai().draft(
      `Write a WhatsApp/email campaign message. Goal: ${goal}.`,
      { segment, offer },
    );
    return { content };
  });

  app.post("/campaigns/contacts/import", {
    preHandler: authorize(...ADMIN),
    config: { rateLimit: { max: 5, timeWindow: "5 minutes" } },
  }, async (req, reply) => {
    const body = z.object({
      branchId: z.string(),
      rows: z.array(z.object({
        name: z.string().trim().max(150).optional(),
        phone: z.string().min(8).max(30),
        email: z.string().email().optional(),
        waConsent: z.boolean().default(false),
        emailConsent: z.boolean().default(false),
        consentSource: z.string().trim().max(200).optional(),
      })).min(1).max(5_000),
    }).parse(req.body);
    if (req.user?.role === "MANAGER" && req.user.branchId !== body.branchId) return reply.code(403).send({ error: "forbidden" });
    const branch = await prisma.branch.findUnique({ where: { id: body.branchId }, select: { id: true } });
    if (!branch) return reply.code(404).send({ error: "branch_not_found" });

    let invalid = 0;
    let duplicates = 0;
    let valid = 0;
    let consented = 0;
    const seen = new Set<string>();
    for (const row of body.rows) {
      const phone = phoneDigits(row.phone);
      if (phone.length < 8 || phone.length > 15) { invalid += 1; continue; }
      if (seen.has(phone)) { duplicates += 1; continue; }
      seen.add(phone);
      valid += 1;
      if (row.waConsent || row.emailConsent) consented += 1;
    }
    await audit("campaign.contacts.import", "Campaign", body.branchId, {
      actorUserId: req.user?.id,
      after: {
        rows: body.rows.length,
        valid,
        created: 0,
        updated: 0,
        invalid,
        duplicates,
        consented,
        mode: "campaign_audience_only",
      },
      ip: req.ip,
    });
    return reply.code(200).send({ rows: body.rows.length, valid, created: 0, updated: 0, invalid, duplicates, consented });
  });

  app.post("/campaigns/contacts/verify", {
    preHandler: authorize(...ADMIN),
    config: { rateLimit: { max: 10, timeWindow: "5 minutes" } },
  }, async (req, reply) => {
    const body = z.object({
      branchId: z.string(),
      phones: z.array(z.string().min(8).max(30)).min(1).max(5_000),
    }).parse(req.body);
    if (req.user?.role === "MANAGER" && req.user.branchId !== body.branchId) return reply.code(403).send({ error: "forbidden" });

    const seen = new Set<string>();
    let invalid = 0;
    let duplicates = 0;
    for (const raw of body.phones) {
      const phone = phoneDigits(raw);
      if (phone.length < 8 || phone.length > 15) {
        invalid += 1;
        continue;
      }
      if (seen.has(phone)) {
        duplicates += 1;
        continue;
      }
      seen.add(phone);
    }
    const phones = [...seen];
    const providerContext = await applyProviderSettings(body.branchId);
    const unofficialMessaging = providerContext.whatsapp("WHATSAPP_UNOFFICIAL");
    const state = await unofficialMessaging.health?.();
    if (!state?.connected || !unofficialMessaging.listContacts) {
      return {
        total: body.phones.length,
        valid: phones.length,
        invalid,
        duplicates,
        registered: 0,
        unknown: phones.length,
        providerConnected: false,
        detail: state?.detail ?? "WAHA contact verification is not connected.",
      };
    }
    const contacts = await unofficialMessaging.listContacts(10_000);
    const contactKeys = new Set<string>();
    for (const contact of contacts) {
      const phone = phoneDigits(contact.number);
      if (!phone) continue;
      contactKeys.add(phone);
      if (phone.length === 12 && phone.startsWith("91")) contactKeys.add(phone.slice(2));
      if (phone.length >= 10) contactKeys.add(phone.slice(-10));
    }
    const registered = phones.filter((phone) => contactKeys.has(phone) || contactKeys.has(phone.slice(-10))).length;
    return {
      total: body.phones.length,
      valid: phones.length,
      invalid,
      duplicates,
      registered,
      unknown: Math.max(0, phones.length - registered),
      providerConnected: true,
      detail: "Matched against WAHA contact list for this session.",
    };
  });

  app.post("/campaigns", { preHandler: authorize(...ADMIN) }, async (req, reply) => {
    const body = z
      .object({
        name: z.string(),
        channel: z.enum(["WHATSAPP_OFFICIAL", "WHATSAPP_UNOFFICIAL", "EMAIL", "SMS"]),
        segment: z.enum(["NEW", "REPEAT", "VIP", "AT_RISK", "LAPSED", "MEMBER", "HIGH_SPEND"]).optional(),
        content: z.string(),
        mediaKey: z.string().trim().max(512).optional(),
        mediaType: z.enum(["image", "document", "video"]).optional(),
        ctaButtons: z.array(campaignCtaSchema).max(3).optional(),
        recurrence: campaignRecurrenceSchema.optional(),
        couponCode: z.string().optional(),
        branchId: z.string(),
        scheduledAt: z.coerce.date().optional(),
        recipientContacts: z.array(z.object({
          name: z.string().trim().max(150).optional(),
          phone: z.string().min(8).max(30),
          email: z.string().email().optional(),
        })).max(5_000).optional(),
        recipientPhones: z.array(z.string().min(8).max(30)).max(5_000).optional(),
        manualConsentConfirmed: z.boolean().default(false),
      })
      .superRefine((value, ctx) => {
        const manualCount = (value.recipientContacts?.length ?? 0) + (value.recipientPhones?.length ?? 0);
        if (Boolean(value.mediaKey) !== Boolean(value.mediaType)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "media_key_and_type_required_together", path: ["mediaKey"] });
        if (manualCount && value.channel.startsWith("WHATSAPP") && !value.manualConsentConfirmed) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "whatsapp_manual_consent_required", path: ["manualConsentConfirmed"] });
        }
        if (manualCount && value.channel === "EMAIL") {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "manual_phone_campaign_is_whatsapp_only", path: ["channel"] });
        }
      })
      .parse(req.body);
    if (req.user?.role === "MANAGER" && req.user.branchId !== body.branchId) return reply.code(403).send({ error: "forbidden" });

    // Materialize recipients from the segment now (audience snapshot).
    const now = new Date();
    const manualInputs: ManualRecipientInput[] = [
      ...(body.recipientContacts ?? []),
      ...(body.recipientPhones ?? []).map((phone) => ({ phone })),
    ];
    const manualAudienceRequested = Boolean(body.recipientContacts?.length || body.recipientPhones?.length);
    const manualCreates = manualRecipientCreates(manualInputs);
    if (manualAudienceRequested && !manualCreates.length) {
      return reply.code(400).send({ error: "campaign_has_no_valid_manual_recipients" });
    }
    const ids = manualAudienceRequested
      ? []
      : body.segment
        ? await customersInSegment(prisma, body.branchId, body.segment, DEFAULT_SEGMENT_CONFIG, now)
        : (await prisma.customer.findMany({ where: { branchId: body.branchId, deletedAt: null }, select: { id: true } })).map((c) => c.id);

    const eligible = manualAudienceRequested
      ? []
      : await prisma.customer.findMany({
          where: {
            id: { in: ids },
            ...(body.channel === "EMAIL"
              ? { email: { not: null }, emailConsent: true }
              : body.channel.startsWith("WHATSAPP")
                ? { phone: { not: null }, waConsent: true }
                : {}),
          },
          select: { id: true },
        });
    const recipientCreates = manualAudienceRequested
      ? manualCreates
      : eligible.map(({ id: customerId }) => ({ customerId }));

    const campaign = await prisma.campaign.create({
      data: {
        branchId: body.branchId,
        name: body.name,
        channel: body.channel,
        segment: manualAudienceRequested ? null : body.segment,
        content: body.content,
        mediaKey: body.mediaKey,
        mediaType: body.mediaType,
        ctaJson: body.ctaButtons?.length ? body.ctaButtons : undefined,
        couponCode: body.couponCode,
        scheduledAt: body.scheduledAt,
        recurrenceEnabled: body.recurrence?.enabled ?? false,
        recurrenceRule: body.recurrence?.enabled ? body.recurrence : undefined,
        status: "PENDING_APPROVAL",
        recipients: { create: recipientCreates },
      },
      include: { _count: { select: { recipients: true } } },
    });
    await audit("campaign.create", "Campaign", campaign.id, {
      actorUserId: req.user?.id,
      after: { branchId: body.branchId, name: body.name, channel: body.channel, segment: manualAudienceRequested ? "MANUAL_EXTERNAL" : body.segment, manualPhones: manualCreates.length, recipientCount: recipientCreates.length, hasMedia: Boolean(body.mediaKey), ctaButtons: body.ctaButtons?.length ?? 0, recurrence: body.recurrence?.enabled ? body.recurrence : undefined },
      ip: req.ip,
    });
    const pacing = await publicProviderSettings(body.branchId);
    const risk = body.channel === "WHATSAPP_UNOFFICIAL"
      ? unofficialRisk(pacing.whatsappUnofficial.intervalSeconds, pacing.whatsappUnofficial.dailyCap, recipientCreates.length)
      : undefined;
    return reply.code(201).send({ ...campaign, deliveryRisk: risk });
  });

  // Approval gate — only after this does the worker send.
  app.post("/campaigns/:id/approve", { preHandler: authorize("OWNER", "ADMIN") }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.campaign.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "not_found" });
    if (existing.status !== "PENDING_APPROVAL") return reply.code(409).send({ error: "not_pending_approval" });
    const providerContext = await applyProviderSettings(existing.branchId);
    const unofficialMessaging = providerContext.whatsapp("WHATSAPP_UNOFFICIAL");
    const [providerConfig, branch, recipients] = await Promise.all([
      publicProviderSettings(existing.branchId),
      prisma.branch.findUnique({ where: { id: existing.branchId }, select: { timezone: true } }),
      prisma.campaignRecipient.findMany({ where: { campaignId: id, status: "queued" }, select: { id: true } }),
    ]);
    if (!recipients.length) return reply.code(409).send({ error: "campaign_has_no_eligible_recipients" });
    if (existing.channel === "WHATSAPP_UNOFFICIAL") {
      const state = await unofficialMessaging.health?.();
      if (!state?.connected) return reply.code(409).send({ error: "waha_session_not_connected", detail: state?.detail });
    }
    const unofficial = providerConfig.whatsappUnofficial;
    const intervalSeconds = existing.channel === "WHATSAPP_UNOFFICIAL" ? unofficial.intervalSeconds : 0;
    const dailyCap = existing.channel === "WHATSAPP_UNOFFICIAL" ? unofficial.dailyCap : recipients.length;
    const timeZone = branch?.timezone ?? "Asia/Kolkata";
    const existingSlots = existing.channel === "WHATSAPP_UNOFFICIAL"
      ? await prisma.campaignRecipient.findMany({
          where: {
            campaign: { branchId: existing.branchId, channel: "WHATSAPP_UNOFFICIAL", id: { not: id } },
            status: "queued",
            scheduledFor: { gte: new Date() },
          },
          select: { scheduledFor: true },
        })
      : [];
    const occupied = new Map<string, number>();
    for (const slot of existingSlots) {
      if (!slot.scheduledFor) continue;
      const key = localParts(slot.scheduledFor, timeZone).key;
      occupied.set(key, (occupied.get(key) ?? 0) + 1);
    }
    let cursor = new Date(Math.max(Date.now(), existing.scheduledAt?.getTime() ?? 0));
    const plan: Array<{ id: string; scheduledFor: Date }> = [];
    for (const recipient of recipients) {
      if (existing.channel === "WHATSAPP_UNOFFICIAL") {
        let key = localParts(cursor, timeZone).key;
        while ((occupied.get(key) ?? 0) >= dailyCap) {
          cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
          key = localParts(cursor, timeZone).key;
        }
        occupied.set(key, (occupied.get(key) ?? 0) + 1);
      }
      plan.push({ id: recipient.id, scheduledFor: new Date(cursor) });
      cursor = new Date(cursor.getTime() + intervalSeconds * 1000);
    }
    const risk = existing.channel === "WHATSAPP_UNOFFICIAL" ? unofficialRisk(intervalSeconds, dailyCap, recipients.length) : undefined;
    const firstRunAt = plan[0]!.scheduledFor;
    const scheduled = firstRunAt.getTime() > Date.now() + 5_000;
    const recurrenceRule = existing.recurrenceEnabled
      ? campaignRecurrenceSchema.safeParse(existing.recurrenceRule).success
        ? campaignRecurrenceSchema.parse(existing.recurrenceRule)
        : null
      : null;
    const recurrenceNextAt = nextRecurringAt(recurrenceRule, firstRunAt, timeZone);
    const campaign = await prisma.campaign.update({
      where: { id },
      data: {
        status: scheduled ? "SCHEDULED" : "SENDING",
        approvedBy: req.user?.id,
        intervalSeconds: intervalSeconds || null,
        dailyCap: existing.channel === "WHATSAPP_UNOFFICIAL" ? dailyCap : null,
        riskLevel: risk?.label,
        recurrenceNextAt,
      },
    });
    await prisma.$transaction(plan.map((item) => prisma.campaignRecipient.update({ where: { id: item.id }, data: { scheduledFor: item.scheduledFor } })));
    await Promise.all(plan.map((item) => enqueueCampaignRecipient({ campaignId: id, recipientId: item.id }, item.scheduledFor)));
    await audit("campaign.approve", "Campaign", id, {
      actorUserId: req.user?.id,
      before: { status: existing.status },
      after: { status: campaign.status, scheduledAt: firstRunAt, recipients: recipients.length, intervalSeconds, dailyCap, risk },
      ip: req.ip,
    });
    return campaign;
  });

  app.patch("/campaigns/:id/recurrence", { preHandler: authorize(...ADMIN) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      enabled: z.boolean(),
      recurrence: campaignRecurrenceSchema.optional(),
    }).parse(req.body);
    const existing = await prisma.campaign.findUnique({
      where: { id },
      select: {
        id: true,
        branchId: true,
        recurrenceEnabled: true,
        recurrenceRule: true,
        recurrenceNextAt: true,
        recurrenceParentId: true,
      },
    });
    if (!existing) return reply.code(404).send({ error: "not_found" });
    if (!["OWNER", "ADMIN"].includes(req.user!.role) && existing.branchId !== req.user?.branchId) {
      return reply.code(403).send({ error: "forbidden" });
    }
    if (existing.recurrenceParentId) return reply.code(409).send({ error: "only_parent_campaign_can_repeat" });

    const branch = await prisma.branch.findUnique({ where: { id: existing.branchId }, select: { timezone: true } });
    const timeZone = branch?.timezone ?? "Asia/Kolkata";

    if (!body.enabled) {
      await prisma.$transaction([
        prisma.campaign.update({
          where: { id },
          data: { recurrenceEnabled: false, recurrenceNextAt: null },
        }),
        prisma.campaignRecipient.updateMany({
          where: { campaign: { recurrenceParentId: id, status: { in: ["PENDING_APPROVAL", "SCHEDULED"] } }, status: "queued" },
          data: { status: "failed", error: "Recurring campaign turned off" },
        }),
        prisma.campaign.updateMany({
          where: { recurrenceParentId: id, status: { in: ["PENDING_APPROVAL", "SCHEDULED"] } },
          data: { status: "CANCELLED" },
        }),
      ]);
      await audit("campaign.recurrence.off", "Campaign", id, {
        actorUserId: req.user?.id,
        before: { recurrenceEnabled: existing.recurrenceEnabled, recurrenceNextAt: existing.recurrenceNextAt },
        after: { recurrenceEnabled: false },
        ip: req.ip,
      });
      return prisma.campaign.findUnique({ where: { id }, include: { _count: { select: { recipients: true } } } });
    }

    const parsedExisting = campaignRecurrenceSchema.safeParse(existing.recurrenceRule);
    const rule = body.recurrence?.enabled
      ? body.recurrence
      : parsedExisting.success && parsedExisting.data.enabled
        ? parsedExisting.data
        : defaultWeeklyRecurrence(new Date(), timeZone);
    const enabledRule: CampaignRecurrenceRule = {
      ...rule,
      enabled: true,
      ...(rule.frequency === "WEEKLY" ? { daysOfWeek: ALL_WEEKDAYS } : {}),
    };
    const recurrenceNextAt = nextRecurringAt(enabledRule, new Date(), timeZone);
    if (!recurrenceNextAt) return reply.code(400).send({ error: "recurrence_has_no_future_run" });
    const campaign = await prisma.campaign.update({
      where: { id },
      data: {
        recurrenceEnabled: true,
        recurrenceRule: enabledRule,
        recurrenceNextAt,
      },
      include: { _count: { select: { recipients: true } } },
    });
    await audit("campaign.recurrence.on", "Campaign", id, {
      actorUserId: req.user?.id,
      before: { recurrenceEnabled: existing.recurrenceEnabled, recurrenceNextAt: existing.recurrenceNextAt },
      after: { recurrenceEnabled: true, recurrenceRule: enabledRule, recurrenceNextAt },
      ip: req.ip,
    });
    return campaign;
  });

  app.get("/campaigns/:id", { preHandler: authorize(...ADMIN) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: { _count: { select: { recipients: true } }, recipients: { take: 100 } },
    });
    if (!campaign) return reply.code(404).send({ error: "not_found" });
    if (!["OWNER", "ADMIN"].includes(req.user!.role) && campaign.branchId !== req.user?.branchId) {
      return reply.code(403).send({ error: "forbidden" });
    }
    return campaign;
  });
}
