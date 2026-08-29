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
const phoneDigits = (value: string) => {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91") && /^[6-9]\d{9}$/.test(digits.slice(2))) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0") && /^[6-9]\d{9}$/.test(digits.slice(1))) return digits.slice(1);
  return digits;
};

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

function insideDeliveryWindow(date: Date, timeZone: string, startHour: number, endHour: number) {
  const { hour } = localParts(date, timeZone);
  if (hour < startHour) return new Date(date.getTime() + (startHour - hour) * 60 * 60 * 1000);
  if (hour >= endHour) return new Date(date.getTime() + (24 - hour + startHour) * 60 * 60 * 1000);
  return date;
}

function unofficialRisk(intervalSeconds: number, dailyCap: number, recipientCount: number) {
  const score = Math.min(100, 50 + (intervalSeconds < 90 ? 8 : 0) + (dailyCap > 75 ? 10 : 0) + (recipientCount > dailyCap ? 7 : 0));
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
        recipients: { select: { status: true, deliveredAt: true, readAt: true, repliedAt: true } },
      },
    });
    return rows.map(({ recipients, ...campaign }) => ({
      ...campaign,
      engagement: {
        total: recipients.length,
        sent: recipients.filter((item) => ["sent", "delivered", "read"].includes(item.status)).length,
        delivered: recipients.filter((item) => item.deliveredAt).length,
        read: recipients.filter((item) => item.readAt).length,
        replied: recipients.filter((item) => item.repliedAt).length,
        failed: recipients.filter((item) => item.status === "failed").length,
      },
    }));
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

    let created = 0;
    let updated = 0;
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
      const existing = await prisma.customer.findUnique({ where: { branchId_phone: { branchId: body.branchId, phone } } });
      const source = row.consentSource || "Admin CSV marketing import";
      const safeName = row.name?.trim() || `Customer ${phone.slice(-4)}`;
      if (existing) {
        if (existing.deletedAt) { invalid += 1; continue; }
        await prisma.customer.update({
          where: { id: existing.id },
          data: {
            name: row.name?.trim() || existing.name,
            email: row.email ?? existing.email,
            waConsent: existing.waConsent || row.waConsent,
            emailConsent: existing.emailConsent || row.emailConsent,
            source,
          },
        });
        updated += 1;
      } else {
        await prisma.customer.create({
          data: { branchId: body.branchId, name: safeName, phone, email: row.email, waConsent: row.waConsent, emailConsent: row.emailConsent, source },
        });
        created += 1;
      }
      if (row.waConsent) consented += 1;
    }
    await audit("campaign.contacts.import", "Customer", body.branchId, {
      actorUserId: req.user?.id,
      after: { rows: body.rows.length, valid, created, updated, invalid, duplicates, consented },
      ip: req.ip,
    });
    return reply.code(201).send({ rows: body.rows.length, valid, created, updated, invalid, duplicates, consented });
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
        couponCode: z.string().optional(),
        branchId: z.string(),
        scheduledAt: z.coerce.date().optional(),
        recipientPhones: z.array(z.string().min(8).max(30)).max(5_000).optional(),
        manualConsentConfirmed: z.boolean().default(false),
      })
      .superRefine((value, ctx) => {
        if (Boolean(value.mediaKey) !== Boolean(value.mediaType)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "media_key_and_type_required_together", path: ["mediaKey"] });
        if (value.recipientPhones?.length && value.channel.startsWith("WHATSAPP") && !value.manualConsentConfirmed) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "whatsapp_manual_consent_required", path: ["manualConsentConfirmed"] });
        }
      })
      .parse(req.body);
    if (req.user?.role === "MANAGER" && req.user.branchId !== body.branchId) return reply.code(403).send({ error: "forbidden" });

    // Materialize recipients from the segment now (audience snapshot).
    const now = new Date();
    const manualPhones = [...new Set((body.recipientPhones ?? []).map(phoneDigits).filter((phone) => phone.length >= 8 && phone.length <= 15))];
    if (manualPhones.length) {
      for (const phone of manualPhones) {
        const existing = await prisma.customer.findUnique({ where: { branchId_phone: { branchId: body.branchId, phone } } });
        if (existing || !body.channel.startsWith("WHATSAPP")) continue;
        await prisma.customer.create({
          data: {
            branchId: body.branchId,
            name: `Customer ${phone.slice(-4)}`,
            phone,
            waConsent: true,
            emailConsent: false,
            source: "Manual WhatsApp campaign audience",
          },
        });
      }
    }
    const ids = manualPhones.length
      ? (await prisma.customer.findMany({
          where: { branchId: body.branchId, phone: { in: manualPhones }, deletedAt: null },
          select: { id: true },
        })).map((c) => c.id)
      : body.segment
        ? await customersInSegment(prisma, body.branchId, body.segment, DEFAULT_SEGMENT_CONFIG, now)
        : (await prisma.customer.findMany({ where: { branchId: body.branchId, deletedAt: null }, select: { id: true } })).map((c) => c.id);

    const eligible = await prisma.customer.findMany({
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

    const campaign = await prisma.campaign.create({
      data: {
        branchId: body.branchId,
        name: body.name,
        channel: body.channel,
        segment: manualPhones.length ? null : body.segment,
        content: body.content,
        mediaKey: body.mediaKey,
        mediaType: body.mediaType,
        couponCode: body.couponCode,
        scheduledAt: body.scheduledAt,
        status: "PENDING_APPROVAL",
        recipients: { create: eligible.map(({ id: customerId }) => ({ customerId })) },
      },
      include: { _count: { select: { recipients: true } } },
    });
    await audit("campaign.create", "Campaign", campaign.id, {
      actorUserId: req.user?.id,
      after: { branchId: body.branchId, name: body.name, channel: body.channel, segment: manualPhones.length ? "MANUAL" : body.segment, manualPhones: manualPhones.length, recipientCount: eligible.length, hasMedia: Boolean(body.mediaKey) },
      ip: req.ip,
    });
    const pacing = await publicProviderSettings(body.branchId);
    const risk = body.channel === "WHATSAPP_UNOFFICIAL"
      ? unofficialRisk(pacing.whatsappUnofficial.intervalSeconds, pacing.whatsappUnofficial.dailyCap, eligible.length)
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
        cursor = insideDeliveryWindow(cursor, timeZone, unofficial.windowStartHour, unofficial.windowEndHour);
        let key = localParts(cursor, timeZone).key;
        while ((occupied.get(key) ?? 0) >= dailyCap) {
          cursor = insideDeliveryWindow(new Date(cursor.getTime() + 24 * 60 * 60 * 1000), timeZone, unofficial.windowStartHour, unofficial.windowEndHour);
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
    const campaign = await prisma.campaign.update({
      where: { id },
      data: {
        status: scheduled ? "SCHEDULED" : "SENDING",
        approvedBy: req.user?.id,
        intervalSeconds: intervalSeconds || null,
        dailyCap: existing.channel === "WHATSAPP_UNOFFICIAL" ? dailyCap : null,
        riskLevel: risk?.label,
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
