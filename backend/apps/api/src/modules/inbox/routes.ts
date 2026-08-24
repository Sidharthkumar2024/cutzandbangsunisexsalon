import { FastifyInstance } from "fastify";
import { ChannelType } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@cutz/db";
import type { MessagingProvider } from "@cutz/types";
import { authorize } from "../../plugins/auth.js";
import { audit } from "../../lib/audit.js";
import {
  applyProviderSettings,
  publicProviderSettings,
  resolveOfficialVerificationBranch,
  resolveOfficialWebhookBranch,
  resolveUnofficialWebhookBranch,
} from "../provider-config/config.js";
import { whatsappConversationId } from "../provider-config/webhook-scope.js";

const STAFF = ["OWNER", "ADMIN", "MANAGER", "RECEPTION"] as const;
const WHATSAPP_CHANNELS = ["WHATSAPP_OFFICIAL", "WHATSAPP_UNOFFICIAL"] as const;

async function safeProviderHealth(provider: MessagingProvider) {
  try {
    return await provider.health?.() ?? { configured: false, connected: false, detail: "Health check unavailable" };
  } catch (error) {
    return {
      configured: true,
      connected: false,
      status: "UNREACHABLE",
      detail: error instanceof Error ? `Provider unavailable: ${error.message}` : "Provider unavailable",
    };
  }
}

async function ensureChannels() {
  await Promise.all([
    prisma.channel.upsert({
      where: { id: "channel-wa-official" },
      create: { id: "channel-wa-official", type: "WHATSAPP_OFFICIAL", label: "WhatsApp Official" },
      update: {},
    }),
    prisma.channel.upsert({
      where: { id: "channel-wa-unofficial" },
      create: { id: "channel-wa-unofficial", type: "WHATSAPP_UNOFFICIAL", label: "WhatsApp Unofficial" },
      update: {},
    }),
    prisma.channel.upsert({
      where: { id: "channel-email" },
      create: { id: "channel-email", type: "EMAIL", label: "Email" },
      update: {},
    }),
    prisma.channel.upsert({
      where: { id: "channel-web-chat" },
      create: { id: "channel-web-chat", type: "WEB_CHAT", label: "Website chat", isActive: true },
      update: {},
    }),
  ]);
}

const stringHeaders = (headers: Record<string, string | string[] | undefined>) =>
  Object.fromEntries(
    Object.entries(headers).flatMap(([key, value]) =>
      typeof value === "string" ? [[key.toLowerCase(), value]] : [],
    ),
  );

function inboundContent(message: any) {
  const type = String(message.type ?? (message.text ? "text" : "unknown"));
  const media = message[type] as { id?: string; mime_type?: string; caption?: string } | undefined;
  const location = message.location as { latitude?: number; longitude?: number; name?: string; address?: string } | undefined;
  const body =
    message.text?.body ??
    media?.caption ??
    (location?.latitude != null && location.longitude != null
      ? `Location: ${location.latitude},${location.longitude}${location.name ? ` · ${location.name}` : ""}`
      : "");
  return {
    body,
    mediaType: ["image", "document", "video", "audio"].includes(type) ? type : undefined,
    attachment: media?.id ? { url: `whatsapp-media://${media.id}`, mimeType: media.mime_type } : undefined,
  };
}

async function markCampaignDelivery(branchId: string, externalId: string, rawStatus: string) {
  if (!externalId) return;
  const normalized = rawStatus.toLowerCase();
  const read = normalized.includes("read") || normalized.includes("played");
  const delivered = read || normalized.includes("deliver");
  const failed = normalized.includes("fail");
  await prisma.campaignRecipient.updateMany({
    where: { externalId, campaign: { branchId } },
    data: {
      status: failed ? "failed" : read ? "read" : delivered ? "delivered" : "sent",
      ...(delivered ? { deliveredAt: new Date() } : {}),
      ...(read ? { deliveredAt: new Date(), readAt: new Date() } : {}),
      ...(failed ? { error: rawStatus.slice(0, 500) } : {}),
    },
  });
}

async function findOrCreateInboundCustomer(branchId: string, rawPhone: string, displayName?: string) {
  const digits = rawPhone.replace(/\D/gu, "");
  const suffix = digits.slice(-10);
  const existing = await prisma.customer.findFirst({
    where: { branchId, phone: { endsWith: suffix } },
  });
  if (existing) {
    if (existing.deletedAt) {
      return prisma.customer.update({ where: { id: existing.id }, data: { deletedAt: null } });
    }
    return existing;
  }
  return prisma.customer.create({
    data: {
      branchId,
      phone: `+${digits}`,
      name: displayName?.trim().slice(0, 120) || `WhatsApp ${digits.slice(-4)}`,
      source: "Incoming WhatsApp",
      waConsent: false,
    },
  });
}

async function markLatestCampaignReply(customerId: string | undefined) {
  if (!customerId) return;
  const recipient = await prisma.campaignRecipient.findFirst({
    where: { customerId, sentAt: { gte: new Date(Date.now() - 30 * 86_400_000) }, repliedAt: null },
    orderBy: { sentAt: "desc" },
    select: { id: true },
  });
  if (recipient) await prisma.campaignRecipient.update({ where: { id: recipient.id }, data: { repliedAt: new Date() } });
}

export default async function inboxRoutes(app: FastifyInstance) {
  app.post("/public/chat", { config: { rateLimit: { max: 20, timeWindow: "1 hour" } } }, async (req, reply) => {
    const body = z.object({
      branchId: z.string().default("main"),
      threadId: z.string().uuid(),
      name: z.string().trim().min(2).max(120),
      phone: z.string().trim().min(8).max(30),
      message: z.string().trim().min(1).max(2_000),
    }).parse(req.body);
    const branch = await prisma.branch.findFirst({ where: { id: body.branchId, deletedAt: null }, select: { id: true } });
    if (!branch) return reply.code(404).send({ error: "branch_not_found" });
    await ensureChannels();
    const digits = body.phone.replace(/\D/gu, "");
    const normalizedPhone = digits.length === 10 ? `+91${digits}` : `+${digits}`;
    let customer = await prisma.customer.findFirst({ where: { branchId: body.branchId, phone: normalizedPhone, deletedAt: null } });
    if (!customer) {
      customer = await prisma.customer.create({ data: { branchId: body.branchId, name: body.name, phone: normalizedPhone, source: "Website chat" } });
    }
    const channel = await prisma.channel.findUniqueOrThrow({ where: { id: "channel-web-chat" } });
    const existing = await prisma.conversation.findUnique({ where: { externalThreadId: body.threadId } });
    if (existing && existing.customerId !== customer.id) return reply.code(409).send({ error: "chat_thread_conflict" });
    const conversation = existing ?? await prisma.conversation.create({ data: { channelId: channel.id, customerId: customer.id, externalThreadId: body.threadId, unread: true } });
    const message = await prisma.message.create({ data: { conversationId: conversation.id, direction: "in", body: body.message, status: "received" } });
    await prisma.conversation.update({ where: { id: conversation.id }, data: { unread: true, lastMessageAt: message.createdAt } });
    return reply.code(201).send({ threadId: body.threadId, conversationId: conversation.id, message: { id: message.id, direction: message.direction, body: message.body, status: message.status, createdAt: message.createdAt } });
  });

  app.get("/public/chat/:threadId", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { threadId } = z.object({ threadId: z.string().uuid() }).parse(req.params);
    const conversation = await prisma.conversation.findUnique({
      where: { externalThreadId: threadId },
      select: {
        externalThreadId: true,
        customer: { select: { name: true } },
        messages: { where: { direction: { in: ["in", "out"] } }, orderBy: { createdAt: "asc" }, take: 200, select: { id: true, direction: true, body: true, status: true, createdAt: true } },
      },
    });
    if (!conversation) return reply.code(404).send({ error: "chat_not_found" });
    return conversation;
  });

  app.get("/channels", { preHandler: authorize(...STAFF) }, async () => {
    await ensureChannels();
    return prisma.channel.findMany({ orderBy: { label: "asc" }, include: { _count: { select: { conversations: true, templates: true } } } });
  });

  app.patch("/channels/:type", { preHandler: authorize("OWNER", "ADMIN") }, async (req, reply) => {
    const { type } = z.object({ type: z.enum(["WHATSAPP_OFFICIAL", "WHATSAPP_UNOFFICIAL", "EMAIL", "SMS", "WEB_CHAT"]) }).parse(req.params);
    const body = z.object({ isActive: z.boolean(), label: z.string().trim().min(2).optional() }).parse(req.body);
    await ensureChannels();
    const channel = await prisma.channel.findFirst({ where: { type } });
    if (!channel) return reply.code(404).send({ error: "channel_not_found" });
    const updated = await prisma.channel.update({ where: { id: channel.id }, data: body });
    await audit("channel.update", "Channel", channel.id, { actorUserId: req.user?.id, before: channel, after: body, ip: req.ip });
    return updated;
  });

  app.get("/integrations/whatsapp/status", { preHandler: authorize(...STAFF) }, async (req, reply) => {
    await ensureChannels();
    const branchId = (req.query as Record<string, string>).branchId ?? req.user?.branchId ?? "main";
    if (!["OWNER", "ADMIN"].includes(req.user!.role) && req.user!.branchId !== branchId) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const providerContext = await applyProviderSettings(branchId);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [official, unofficial, channels, settings, deliveryRows, officialTemplates] = await Promise.all([
      safeProviderHealth(providerContext.whatsapp("WHATSAPP_OFFICIAL")),
      safeProviderHealth(providerContext.whatsapp("WHATSAPP_UNOFFICIAL")),
      prisma.channel.findMany({ where: { type: { in: [...WHATSAPP_CHANNELS] } } }),
      publicProviderSettings(branchId),
      prisma.campaignRecipient.findMany({
        where: { campaign: { branchId, channel: "WHATSAPP_UNOFFICIAL" }, sentAt: { gte: since } },
        select: { status: true },
      }),
      prisma.channel.findFirst({
        where: { type: "WHATSAPP_OFFICIAL" },
        select: {
          templates: {
            where: { status: "approved" },
            select: { id: true, name: true, language: true, status: true, body: true, createdAt: true },
            orderBy: [{ name: "asc" }, { language: "asc" }],
          },
        },
      }).then((channel) => channel?.templates ?? []),
    ]);
    const failed = deliveryRows.filter((row) => row.status === "failed").length;
    const completed = deliveryRows.filter((row) => ["sent", "delivered", "failed"].includes(row.status)).length;
    const failureRate = completed ? Math.round((failed / completed) * 100) : 0;
    const guardrails = settings.whatsappUnofficial;
    const score = Math.min(100, 50
      + (unofficial?.connected ? 0 : 15)
      + (guardrails.intervalSeconds < 90 ? 8 : 0)
      + (guardrails.dailyCap > 75 ? 10 : 0)
      + (failureRate > 10 ? 12 : 0)
      + (completed === 0 ? 5 : 0));
    const risk = {
      score,
      label: score >= 85 ? "critical" : score >= 65 ? "high" : "moderate",
      heuristic: true,
      failureRate24h: failureRate,
      sent24h: completed - failed,
      failed24h: failed,
      safeguards: {
        consentRequired: true,
        optOutHonoured: true,
        intervalSeconds: guardrails.intervalSeconds,
        dailyCap: guardrails.dailyCap,
        deliveryWindow: `${String(guardrails.windowStartHour).padStart(2, "0")}:00–${String(guardrails.windowEndHour).padStart(2, "0")}:00`,
      },
    };
    return {
      official: {
        ...official,
        active: channels.find((channel) => channel.type === "WHATSAPP_OFFICIAL")?.isActive ?? false,
        templates: officialTemplates,
      },
      unofficial: { ...unofficial, active: channels.find((channel) => channel.type === "WHATSAPP_UNOFFICIAL")?.isActive ?? false, risk },
    };
  });

  app.post("/integrations/whatsapp/test", { preHandler: authorize("OWNER", "ADMIN") }, async (req, reply) => {
    const body = z.object({ channel: z.enum(WHATSAPP_CHANNELS), to: z.string().min(8), message: z.string().min(1) }).parse(req.body);
    const providerContext = await applyProviderSettings("main");
    const result = await providerContext.whatsapp(body.channel).send({ to: body.to, body: body.message });
    if (result.status === "failed") return reply.code(422).send(result);
    return result;
  });

  app.post("/integrations/whatsapp/templates/sync", { preHandler: authorize("OWNER", "ADMIN") }, async (req) => {
    await ensureChannels();
    const providerContext = await applyProviderSettings("main");
    const messaging = providerContext.whatsapp("WHATSAPP_OFFICIAL");
    const channel = await prisma.channel.findFirstOrThrow({ where: { type: "WHATSAPP_OFFICIAL" } });
    const remote = await messaging.listTemplates?.() ?? [];
    for (const template of remote) {
      const existing = await prisma.template.findFirst({ where: { channelId: channel.id, name: template.name, language: template.language } });
      if (existing) {
        await prisma.template.update({ where: { id: existing.id }, data: { status: template.status, body: template.body } });
      } else {
        await prisma.template.create({ data: { channelId: channel.id, ...template } });
      }
    }
    return { synced: remote.length, templates: remote };
  });

  app.get("/inbox", { preHandler: authorize(...STAFF) }, async (req) => {
    const { unread } = req.query as Record<string, string>;
    const scopedBranch = ["OWNER", "ADMIN"].includes(req.user!.role) ? undefined : req.user!.branchId ?? "__none__";
    return prisma.conversation.findMany({
      where: {
        ...(unread === "true" ? { unread: true } : {}),
        ...(scopedBranch ? { customer: { is: { branchId: scopedBranch } } } : {}),
      },
      orderBy: { lastMessageAt: "desc" },
      take: 100,
      include: { customer: { select: { id: true, name: true, phone: true, avatarUrl: true } }, channel: true },
    });
  });

  app.post("/inbox", { preHandler: authorize(...STAFF) }, async (req, reply) => {
    const body = z.object({ customerId: z.string(), channel: z.enum(WHATSAPP_CHANNELS) }).parse(req.body);
    await ensureChannels();
    const [customer, channel] = await Promise.all([
      prisma.customer.findUnique({ where: { id: body.customerId } }),
      prisma.channel.findFirst({ where: { type: body.channel } }),
    ]);
    if (!customer) return reply.code(404).send({ error: "customer_not_found" });
    if (!channel) return reply.code(404).send({ error: "channel_not_found" });
    if (!["OWNER", "ADMIN"].includes(req.user!.role) && req.user?.branchId !== customer.branchId) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const existing = await prisma.conversation.findFirst({ where: { customerId: customer.id, channelId: channel.id } });
    if (existing) return existing;
    return reply.code(201).send(await prisma.conversation.create({
      data: { customerId: customer.id, channelId: channel.id, assignedTo: req.user?.id, unread: false },
      include: { customer: true, channel: true },
    }));
  });

  app.get("/inbox/:id", { preHandler: authorize(...STAFF) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: "asc" }, include: { attachments: true } }, customer: true, channel: true },
    });
    if (!conversation) return reply.code(404).send({ error: "not_found" });
    if (!["OWNER", "ADMIN"].includes(req.user!.role) && conversation.customer?.branchId !== req.user?.branchId) {
      return reply.code(403).send({ error: "forbidden" });
    }
    await prisma.conversation.update({ where: { id }, data: { unread: false } });
    return conversation;
  });

  app.patch("/inbox/:id", { preHandler: authorize(...STAFF) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ assignedTo: z.string().nullable().optional(), tags: z.array(z.string()).optional(), unread: z.boolean().optional() }).parse(req.body);
    const existing = await prisma.conversation.findUnique({ where: { id }, include: { customer: { select: { branchId: true } } } });
    if (!existing) return reply.code(404).send({ error: "not_found" });
    if (!["OWNER", "ADMIN"].includes(req.user!.role) && existing.customer?.branchId !== req.user?.branchId) {
      return reply.code(403).send({ error: "forbidden" });
    }
    return prisma.conversation.update({ where: { id }, data: body });
  });

  app.post("/inbox/:id/messages", { preHandler: authorize(...STAFF) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      body: z.string().default(""),
      internal: z.boolean().default(false),
      templateName: z.string().optional(),
      templateLanguage: z.string().optional(),
      mediaUrl: z.string().url().optional(),
      mediaType: z.enum(["image", "document", "video", "audio"]).optional(),
      location: z.object({ latitude: z.number(), longitude: z.number(), name: z.string().optional(), address: z.string().optional() }).optional(),
    }).refine((value) => value.internal ? value.body.length > 0 : Boolean(value.body || value.templateName || value.mediaUrl || value.location), "message_content_required").parse(req.body);
    const conversation = await prisma.conversation.findUnique({ where: { id }, include: { customer: true, channel: true } });
    if (!conversation) return reply.code(404).send({ error: "not_found" });
    if (!["OWNER", "ADMIN"].includes(req.user!.role) && conversation.customer?.branchId !== req.user?.branchId) {
      return reply.code(403).send({ error: "forbidden" });
    }

    let externalId: string | undefined;
    let status = "internal";
    if (!body.internal) {
      if (conversation.channel.type === "WEB_CHAT") {
        status = "sent";
      } else if (!conversation.customer?.phone || !WHATSAPP_CHANNELS.includes(conversation.channel.type as typeof WHATSAPP_CHANNELS[number])) {
        return reply.code(422).send({ error: "channel_cannot_send" });
      } else {
        const providerContext = await applyProviderSettings(conversation.customer.branchId);
        const result = await providerContext.whatsapp(conversation.channel.type as typeof WHATSAPP_CHANNELS[number]).send({
          to: conversation.customer.phone,
          body: body.body,
          templateName: body.templateName,
          templateLanguage: body.templateLanguage,
          mediaUrl: body.mediaUrl,
          mediaType: body.mediaType,
          location: body.location,
        });
        externalId = result.externalId || undefined;
        status = result.status;
        if (result.status === "failed") return reply.code(422).send({ error: result.error ?? "send_failed" });
      }
    }

    const message = await prisma.message.create({
      data: {
        conversationId: id,
        direction: body.internal ? "internal_note" : "out",
        body: body.body || body.templateName,
        mediaType: body.mediaType ?? (body.location ? "location" : undefined),
        externalId,
        status,
        attachments: body.mediaUrl ? { create: { url: body.mediaUrl } } : undefined,
      },
      include: { attachments: true },
    });
    await prisma.conversation.update({ where: { id }, data: { lastMessageAt: new Date() } });
    return reply.code(201).send(message);
  });

  // Official webhook uses a local raw-body parser so normal JSON API routes
  // remain unaffected while X-Hub-Signature-256 can be verified exactly.
  app.register(async (webhooks) => {
    webhooks.removeContentTypeParser("application/json");
    webhooks.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
      try {
        done(null, { raw: body as string, json: JSON.parse(body as string) });
      } catch (error) {
        done(error as Error);
      }
    });

    webhooks.get("/webhooks/whatsapp", async (req, reply) => {
      const query = req.query as Record<string, string>;
      const branchId = await resolveOfficialVerificationBranch(query["hub.verify_token"] ?? "");
      if (branchId && query["hub.mode"] === "subscribe") {
        return reply.type("text/plain").send(query["hub.challenge"]);
      }
      return reply.code(403).send();
    });

    webhooks.post("/webhooks/whatsapp", async (req, reply) => {
      const parsed = req.body as { raw: string; json: any };
      const entries: any[] = Array.isArray(parsed?.json?.entry) ? parsed.json.entry : [];
      const wabaIds = [...new Set<string>(entries.map((entry: any) => String(entry?.id ?? "")).filter(Boolean))];
      const phoneIds = [...new Set<string>(entries.flatMap((entry: any) => (entry?.changes ?? []).map((change: any) => String(change?.value?.metadata?.phone_number_id ?? ""))).filter(Boolean))];
      if (wabaIds.length > 1 || phoneIds.length > 1) return reply.code(401).send({ error: "provider_not_resolved" });
      const branchId = await resolveOfficialWebhookBranch({ wabaId: wabaIds[0], phoneId: phoneIds[0] });
      if (!branchId) return reply.code(401).send({ error: "provider_not_resolved" });
      const providerContext = await applyProviderSettings(branchId);
      const ok = providerContext.whatsapp("WHATSAPP_OFFICIAL").verifyWebhook(stringHeaders(req.headers), parsed?.raw ?? "");
      if (!ok) return reply.code(401).send({ error: "bad_signature" });
      await ensureChannels();
      const channel = await prisma.channel.findFirstOrThrow({ where: { type: "WHATSAPP_OFFICIAL" } });
      for (const entry of entries) {
        for (const change of entry.changes ?? []) {
          for (const status of change.value?.statuses ?? []) {
            await prisma.message.updateMany({ where: { externalId: status.id }, data: { status: status.status } });
            await markCampaignDelivery(branchId, String(status.id ?? ""), String(status.status ?? "sent"));
          }
          for (const message of change.value?.messages ?? []) {
            const from = String(message.from ?? "");
            const externalId = String(message.id ?? "");
            if (!from || !externalId) continue;
            const contactName = change.value?.contacts?.find((contact: any) => String(contact?.wa_id ?? "") === from)?.profile?.name;
            const customer = await findOrCreateInboundCustomer(branchId, from, typeof contactName === "string" ? contactName : undefined);
            const conversation = await prisma.conversation.upsert({
              where: { id: whatsappConversationId("official", branchId, from) },
              create: { id: whatsappConversationId("official", branchId, from), channelId: channel.id, customerId: customer.id, unread: true, lastMessageAt: new Date() },
              update: { customerId: customer.id, unread: true, lastMessageAt: new Date() },
            });
            const content = inboundContent(message);
            await prisma.message.create({
              data: {
                conversationId: conversation.id,
                direction: "in",
                body: content.body,
                mediaType: content.mediaType,
                externalId,
                status: "received",
                attachments: content.attachment ? { create: content.attachment } : undefined,
              },
            }).catch(() => undefined);
            await markLatestCampaignReply(customer.id);
          }
        }
      }
      return reply.send({ received: true });
    });
  });

  app.post("/webhooks/whatsapp/unofficial", async (req, reply) => {
    const untrusted = req.body as Record<string, unknown> | undefined;
    const untrustedPayload = untrusted?.payload as Record<string, unknown> | undefined;
    const session = String(untrusted?.session ?? untrustedPayload?.session ?? "");
    const branchId = await resolveUnofficialWebhookBranch(session);
    if (!branchId) return reply.code(401).send({ error: "provider_not_resolved" });
    const providerContext = await applyProviderSettings(branchId);
    if (!providerContext.whatsapp("WHATSAPP_UNOFFICIAL").verifyWebhook(stringHeaders(req.headers), "")) {
      return reply.code(401).send({ error: "bad_secret" });
    }
    const envelope = z.object({
      event: z.string().optional(),
      payload: z.record(z.unknown()).optional(),
      externalId: z.string().optional(),
      from: z.string().optional(),
      body: z.string().optional(),
      mediaType: z.string().optional(),
      timestamp: z.number().optional(),
      session: z.string().optional(),
    }).passthrough().parse(req.body);
    const payload = (envelope.payload ?? envelope) as Record<string, unknown>;
    if (envelope.event === "session.status") return reply.send({ received: true });
    if (envelope.event === "message.ack") {
      const externalId = String(payload.id ?? "");
      const status = String(payload.ackName ?? "sent").toLowerCase();
      if (externalId) {
        await prisma.message.updateMany({ where: { externalId }, data: { status } });
        await markCampaignDelivery(branchId, externalId, status);
      }
      return reply.send({ received: true });
    }
    if (envelope.event && envelope.event !== "message") return reply.send({ received: true });
    if (Boolean(payload.fromMe)) return reply.send({ received: true });
    const from = String(payload.from ?? envelope.from ?? "").split("@")[0].replace(/\D/g, "");
    const externalId = String(payload.id ?? envelope.externalId ?? "");
    const messageBody = String(payload.body ?? envelope.body ?? "");
    const timestamp = Number(payload.timestamp ?? envelope.timestamp ?? 0) || undefined;
    if (!from || !externalId) return reply.code(400).send({ error: "invalid_waha_message" });
    await ensureChannels();
    const channel = await prisma.channel.findFirstOrThrow({ where: { type: "WHATSAPP_UNOFFICIAL" } });
    const displayName = typeof payload.pushName === "string" ? payload.pushName : typeof payload.notifyName === "string" ? payload.notifyName : undefined;
    const customer = await findOrCreateInboundCustomer(branchId, from, displayName);
    const optOut = /^(stop|unsubscribe|cancel|opt\s*out|band|बंद)$/i.test(messageBody.trim());
    if (optOut) {
      await prisma.customer.update({
        where: { id: customer.id },
        data: { waConsent: false, tags: Array.from(new Set([...customer.tags, "wa-opt-out"])) },
      });
      await audit("customer.whatsapp_opt_out", "Customer", customer.id, { after: { waConsent: false, source: "incoming_whatsapp" } });
    }
    const conversation = await prisma.conversation.upsert({
      where: { id: whatsappConversationId("unofficial", branchId, from) },
      create: { id: whatsappConversationId("unofficial", branchId, from), channelId: channel.id, customerId: customer.id, unread: true, lastMessageAt: new Date() },
      update: { customerId: customer.id, unread: true, lastMessageAt: new Date() },
    });
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: "in",
        body: messageBody,
        mediaType: Boolean(payload.hasMedia) ? "media" : envelope.mediaType,
        externalId,
        status: "received",
        createdAt: timestamp ? new Date(timestamp * 1000) : undefined,
      },
    }).catch(() => undefined);
    await markLatestCampaignReply(customer.id);
    return reply.send({ received: true });
  });
}
