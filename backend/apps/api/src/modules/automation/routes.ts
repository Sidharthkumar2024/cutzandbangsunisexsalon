import { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "@cutz/db";
import { enqueueCampaignRecipient } from "@cutz/queue";
import { authorize } from "../../plugins/auth.js";
import { audit } from "../../lib/audit.js";
import {
  fillAutomationTemplate,
  normalizeReceiptAutomationSettings,
} from "../../lib/automationSettings.js";
import { publicProviderSettings } from "../provider-config/config.js";

type DeliveryChannel = "EMAIL" | "WHATSAPP_OFFICIAL" | "WHATSAPP_UNOFFICIAL";

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

function automationKey(branchId: string) {
  return `branch:${branchId}:automation`;
}

async function automationRule(branchId: string, config: unknown) {
  const id = `non-returning-${branchId}`;
  return prisma.automationRule.upsert({
    where: { id },
    create: { id, name: `Non-returning customers · ${branchId}`, trigger: "lapsed", config: config as Prisma.InputJsonValue },
    update: { config: config as Prisma.InputJsonValue, isActive: true },
  });
}

function customerDedupeKey(customerId: string, lastVisitAt: Date, channel: DeliveryChannel) {
  return `non-returning:${customerId}:${lastVisitAt.toISOString()}:${channel}`;
}

async function claimRun(ruleId: string, dedupeKey: string) {
  try {
    await prisma.automationRun.create({ data: { ruleId, dedupeKey, status: "queued" } });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
    throw error;
  }
}

async function createCampaign(
  branchId: string,
  channel: DeliveryChannel,
  content: string,
  customerIds: string[],
  approvedBy: string | undefined,
) {
  if (!customerIds.length) return null;
  const now = new Date();
  const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { timezone: true } });
  const providerConfig = await publicProviderSettings(branchId);
  const timeZone = branch?.timezone ?? "Asia/Kolkata";
  const intervalSeconds = channel === "WHATSAPP_UNOFFICIAL"
    ? providerConfig.whatsappUnofficial.intervalSeconds
    : 0;
  const dailyCap = channel === "WHATSAPP_UNOFFICIAL"
    ? providerConfig.whatsappUnofficial.dailyCap
    : customerIds.length;

  const existingSlots = channel === "WHATSAPP_UNOFFICIAL"
    ? await prisma.campaignRecipient.findMany({
        where: {
          campaign: { branchId, channel: "WHATSAPP_UNOFFICIAL" },
          status: "queued",
          scheduledFor: { gte: now },
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

  let cursor = new Date(now);
  const schedule: Date[] = [];
  for (let index = 0; index < customerIds.length; index += 1) {
    if (channel === "WHATSAPP_UNOFFICIAL") {
      let key = localParts(cursor, timeZone).key;
      while ((occupied.get(key) ?? 0) >= dailyCap) {
        cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1_000);
        key = localParts(cursor, timeZone).key;
      }
      occupied.set(key, (occupied.get(key) ?? 0) + 1);
    }
    schedule.push(new Date(cursor));
    cursor = new Date(cursor.getTime() + intervalSeconds * 1_000);
  }

  const campaign = await prisma.campaign.create({
    data: {
      branchId,
      name: `Automatic non-returning follow-up · ${now.toLocaleDateString("en-IN")}`,
      channel,
      content,
      status: schedule[0]!.getTime() > now.getTime() + 5_000 ? "SCHEDULED" : "SENDING",
      approvedBy,
      intervalSeconds: intervalSeconds || null,
      dailyCap: channel === "WHATSAPP_UNOFFICIAL" ? dailyCap : null,
      recipients: {
        create: customerIds.map((customerId, index) => ({
          customerId,
          scheduledFor: schedule[index],
        })),
      },
    },
    include: { recipients: { select: { id: true, scheduledFor: true } } },
  });
  await Promise.all(
    campaign.recipients.map((recipient) =>
      enqueueCampaignRecipient(
        { campaignId: campaign.id, recipientId: recipient.id },
        recipient.scheduledFor ?? now,
      ),
    ),
  );
  return campaign;
}

export async function runNonReturningAutomation(branchId: string, actorUserId?: string) {
  const setting = await prisma.setting.findUnique({ where: { key: automationKey(branchId) } });
  const config = normalizeReceiptAutomationSettings(setting?.value);
  if (!config.nonReturningEnabled) {
    return { enabled: false, eligible: 0, queued: 0, skippedDuplicate: 0, campaigns: [] as string[] };
  }
  const cutoff = new Date(Date.now() - config.nonReturningDays * 24 * 60 * 60 * 1_000);
  const customers = await prisma.customer.findMany({
    where: {
      branchId,
      deletedAt: null,
      visitCount: { gt: 0 },
      lastVisitAt: { not: null, lte: cutoff },
    },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      emailConsent: true,
      waConsent: true,
      lastVisitAt: true,
    },
    take: 5_000,
  });
  const rule = await automationRule(branchId, config);
  const channels = await prisma.channel.findMany({
    where: { type: { in: ["WHATSAPP_OFFICIAL", "WHATSAPP_UNOFFICIAL"] }, isActive: true },
    select: { type: true },
  });
  const activeChannels = new Set(channels.map((channel) => channel.type));
  const planned = new Map<DeliveryChannel, string[]>();
  if (config.nonReturningEmail) planned.set("EMAIL", []);
  if (config.nonReturningWhatsapp && activeChannels.has(config.nonReturningWhatsappChannel)) {
    planned.set(config.nonReturningWhatsappChannel, []);
  }

  let skippedDuplicate = 0;
  for (const customer of customers) {
    if (!customer.lastVisitAt) continue;
    for (const [channel, ids] of planned) {
      const eligible = channel === "EMAIL"
        ? Boolean(customer.email && customer.emailConsent)
        : Boolean(customer.phone && customer.waConsent);
      if (!eligible) continue;
      if (await claimRun(rule.id, customerDedupeKey(customer.id, customer.lastVisitAt, channel))) ids.push(customer.id);
      else skippedDuplicate += 1;
    }
  }

  const content = fillAutomationTemplate(config.nonReturningTemplate, {
    days: config.nonReturningDays,
  });
  const campaigns = [];
  for (const [channel, customerIds] of planned) {
    const campaign = await createCampaign(branchId, channel, content, customerIds, actorUserId);
    if (campaign) campaigns.push(campaign.id);
  }
  const queued = [...planned.values()].reduce((sum, ids) => sum + ids.length, 0);
  return { enabled: true, eligible: customers.length, queued, skippedDuplicate, campaigns };
}

export default async function automationRoutes(app: FastifyInstance) {
  app.get("/automations/non-returning", { preHandler: authorize("OWNER", "ADMIN", "MANAGER") }, async (req, reply) => {
    const { branchId = req.user?.branchId ?? "main" } = req.query as Record<string, string>;
    if (req.user?.role === "MANAGER" && req.user.branchId !== branchId) return reply.code(403).send({ error: "forbidden" });
    const setting = await prisma.setting.findUnique({ where: { key: automationKey(branchId) } });
    const config = normalizeReceiptAutomationSettings(setting?.value);
    const cutoff = new Date(Date.now() - config.nonReturningDays * 24 * 60 * 60 * 1_000);
    const eligible = await prisma.customer.count({
      where: { branchId, deletedAt: null, visitCount: { gt: 0 }, lastVisitAt: { not: null, lte: cutoff } },
    });
    const recentRuns = await prisma.automationRun.findMany({
      where: { ruleId: `non-returning-${branchId}` },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return { config, eligible, cutoff, recentRuns };
  });

  app.post("/automations/non-returning/run", { preHandler: authorize("OWNER", "ADMIN", "MANAGER") }, async (req, reply) => {
    const body = (req.body ?? {}) as { branchId?: string };
    const branchId = body.branchId ?? req.user?.branchId ?? "main";
    if (req.user?.role === "MANAGER" && req.user.branchId !== branchId) return reply.code(403).send({ error: "forbidden" });
    const result = await runNonReturningAutomation(branchId, req.user?.id);
    await audit("automation.non_returning.run", "AutomationRule", `non-returning-${branchId}`, {
      actorUserId: req.user?.id,
      after: result,
      ip: req.ip,
    });
    return result;
  });

  let timer: ReturnType<typeof setInterval> | undefined;
  app.addHook("onReady", async () => {
    timer = setInterval(async () => {
      const settings = await prisma.setting.findMany({ where: { key: { endsWith: ":automation" } } });
      for (const setting of settings) {
        const config = normalizeReceiptAutomationSettings(setting.value);
        if (!config.nonReturningEnabled) continue;
        const branchId = setting.key.slice("branch:".length, -":automation".length);
        await runNonReturningAutomation(branchId).catch((error) => {
          app.log.error({ err: error, branchId }, "non-returning automation failed");
        });
      }
    }, 15 * 60 * 1_000);
    timer.unref();
  });
  app.addHook("onClose", async () => {
    if (timer) clearInterval(timer);
  });
}
