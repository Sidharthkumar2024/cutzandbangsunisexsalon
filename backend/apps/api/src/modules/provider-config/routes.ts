import { FastifyInstance } from "fastify";
import { z } from "zod";
import { providers } from "@cutz/providers";
import { prisma } from "@cutz/db";
import { authorize } from "../../plugins/auth.js";
import { audit } from "../../lib/audit.js";
import { applyProviderSettings, publicProviderSettings, saveProviderSettings } from "./config.js";

const smtpSchema = z.object({
  enabled: z.boolean(),
  host: z.string().trim().max(255),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  user: z.string().trim().max(255),
  password: z.string().min(1).max(500).optional(),
  from: z.string().trim().max(255),
});

const providerSchema = z.object({
  branchId: z.string(),
  smtp: smtpSchema,
  whatsappOfficial: z.object({
    enabled: z.boolean(),
    phoneId: z.string().trim().max(100),
    wabaId: z.string().trim().max(100),
    graphVersion: z.string().trim().regex(/^v\d+\.\d+$/),
    token: z.string().min(1).max(1000).optional(),
    appSecret: z.string().min(1).max(500).optional(),
    webhookVerifyToken: z.string().min(12).max(500).optional(),
  }),
  whatsappUnofficial: z.object({
    enabled: z.boolean(),
    baseUrl: z.string().trim().max(500).refine((value) => !value || /^https?:\/\//.test(value), "invalid_url"),
    callbackUrl: z.string().trim().max(500).refine((value) => !value || /^https?:\/\//.test(value), "invalid_callback_url"),
    session: z.string().trim().min(2).max(100).regex(/^[a-zA-Z0-9_-]+$/),
    apiKey: z.string().min(24).max(500).optional(),
    webhookSecret: z.string().min(24).max(500).optional(),
    intervalSeconds: z.number().int().min(60).max(300),
    dailyCap: z.number().int().min(5).max(200),
    windowStartHour: z.number().int().min(0).max(22),
    windowEndHour: z.number().int().min(1).max(23),
  }),
});

export default async function providerConfigRoutes(app: FastifyInstance) {
  app.get("/integrations/config", { preHandler: authorize("OWNER", "ADMIN") }, async (req) => {
    const { branchId = "main" } = req.query as Record<string, string>;
    return publicProviderSettings(branchId);
  });

  app.put("/integrations/config", { preHandler: authorize("OWNER", "ADMIN") }, async (req) => {
    const body = providerSchema.parse(req.body);
    const before = await publicProviderSettings(body.branchId);
    const after = await saveProviderSettings(body.branchId, body);
    await audit("provider_config.update", "Setting", `branch:${body.branchId}:providers`, {
      actorUserId: req.user?.id,
      before,
      after,
      ip: req.ip,
    });
    return after;
  });

  app.get("/integrations/email/status", { preHandler: authorize("OWNER", "ADMIN", "MANAGER") }, async (req, reply) => {
    const { branchId = req.user?.branchId ?? "main" } = req.query as Record<string, string>;
    if (req.user?.role === "MANAGER" && req.user.branchId !== branchId) return reply.code(403).send({ error: "forbidden" });
    await applyProviderSettings(branchId);
    try {
      return await providers.email().health?.() ?? { configured: false, connected: false, detail: "Health check unavailable" };
    } catch (error) {
      return {
        configured: true,
        connected: false,
        detail: error instanceof Error ? `SMTP unavailable: ${error.message}` : "SMTP unavailable",
      };
    }
  });

  app.post("/integrations/email/test", { preHandler: authorize("OWNER", "ADMIN") }, async (req, reply) => {
    const body = z.object({ branchId: z.string().default("main"), to: z.string().email() }).parse(req.body);
    await applyProviderSettings(body.branchId);
    const result = await providers.email().send({
      to: body.to,
      subject: "Cutz & Bangs SMTP test",
      html: "<p>Your salon email integration is working.</p>",
    });
    if (result.status === "failed") return reply.code(422).send(result);
    await audit("provider_email.test", "Setting", `branch:${body.branchId}:providers`, { actorUserId: req.user?.id, after: { to: body.to, status: result.status }, ip: req.ip });
    return result;
  });

  app.post("/integrations/whatsapp/unofficial/session", {
    preHandler: authorize("OWNER", "ADMIN"),
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
  }, async (req, reply) => {
    const body = z.object({
      branchId: z.string().default("main"),
      action: z.enum(["create", "start", "restart", "stop", "logout"]),
    }).parse(req.body);
    await applyProviderSettings(body.branchId);
    const adapter = providers.whatsapp("WHATSAPP_UNOFFICIAL");
    if (!adapter.sessionAction) return reply.code(501).send({ error: "session_control_unavailable" });
    try {
      const state = await adapter.sessionAction(body.action);
      await audit(`waha.session.${body.action}`, "Setting", `branch:${body.branchId}:providers`, {
        actorUserId: req.user?.id,
        after: { session: state.session, status: state.status, connected: state.connected },
        ip: req.ip,
      });
      return state;
    } catch (error) {
      return reply.code(422).send({ error: error instanceof Error ? error.message : "waha_session_action_failed" });
    }
  });

  app.post("/integrations/whatsapp/unofficial/contacts/sync", {
    preHandler: authorize("OWNER", "ADMIN"),
    config: { rateLimit: { max: 3, timeWindow: "5 minutes" } },
  }, async (req, reply) => {
    const body = z.object({ branchId: z.string().default("main"), limit: z.number().int().min(1).max(5_000).default(5_000) }).parse(req.body ?? {});
    const branch = await prisma.branch.findUnique({ where: { id: body.branchId }, select: { id: true } });
    if (!branch) return reply.code(404).send({ error: "branch_not_found" });
    await applyProviderSettings(body.branchId);
    const adapter = providers.whatsapp("WHATSAPP_UNOFFICIAL");
    if (!adapter.listContacts) return reply.code(501).send({ error: "contact_sync_unavailable" });
    try {
      const contacts = await adapter.listContacts(body.limit);
      let created = 0;
      let updated = 0;
      let skipped = 0;
      for (const contact of contacts) {
        if (contact.number.length < 8 || contact.number.length > 15) { skipped += 1; continue; }
        const existing = await prisma.customer.findUnique({
          where: { branchId_phone: { branchId: body.branchId, phone: contact.number } },
          select: { id: true },
        });
        if (existing) {
          await prisma.customer.update({
            where: { id: existing.id },
            data: { name: contact.name, source: "WAHA contact sync", deletedAt: null },
          });
          updated += 1;
        } else {
          await prisma.customer.create({
            data: { branchId: body.branchId, phone: contact.number, name: contact.name, source: "WAHA contact sync", waConsent: false },
          });
          created += 1;
        }
      }
      await audit("waha.contacts.sync", "Customer", body.branchId, {
        actorUserId: req.user?.id,
        after: { fetched: contacts.length, created, updated, skipped, consentImported: false },
        ip: req.ip,
      });
      return { fetched: contacts.length, created, updated, skipped, consentImported: false };
    } catch (error) {
      return reply.code(422).send({ error: error instanceof Error ? error.message : "waha_contact_sync_failed" });
    }
  });
}
