import { FastifyInstance } from "fastify";
import { prisma } from "@cutz/db";
import { makeConnection } from "@cutz/queue";
import { authorize } from "../../plugins/auth.js";
import { publicProviderSettings } from "../provider-config/config.js";

async function timed<T>(work: () => Promise<T>) {
  const started = performance.now();
  try {
    const value = await work();
    return { ok: true as const, latencyMs: Math.round(performance.now() - started), value };
  } catch (error) {
    return {
      ok: false as const,
      latencyMs: Math.round(performance.now() - started),
      error: error instanceof Error ? error.message : "unavailable",
    };
  }
}

export default async function systemRoutes(app: FastifyInstance) {
  app.get("/system/health", { preHandler: authorize("OWNER", "ADMIN", "MANAGER") }, async (req, reply) => {
    const { branchId = req.user?.branchId ?? "main" } = req.query as Record<string, string>;
    if (req.user?.role === "MANAGER" && req.user.branchId !== branchId) return reply.code(403).send({ error: "forbidden" });
    const redis = makeConnection();
    const [database, cache, providerConfig, failedEmail, failedAutomation, currentUser] = await Promise.all([
      timed(async () => {
        await prisma.$queryRaw`SELECT 1`;
        return "reachable";
      }),
      timed(async () => redis.ping()),
      publicProviderSettings(branchId),
      prisma.emailLog.count({ where: { status: "failed", createdAt: { gte: new Date(Date.now() - 86_400_000) } } }),
      prisma.automationRun.count({ where: { status: "failed", createdAt: { gte: new Date(Date.now() - 86_400_000) } } }),
      prisma.user.findUnique({ where: { id: req.user!.id }, select: { twoFaEnabledAt: true } }),
    ]).finally(() => redis.disconnect());

    const checks = {
      database: { ok: database.ok, latencyMs: database.latencyMs, detail: database.ok ? database.value : database.error },
      redis: { ok: cache.ok, latencyMs: cache.latencyMs, detail: cache.ok ? cache.value : cache.error },
      smtp: { configured: providerConfig.smtp.enabled && Boolean(providerConfig.smtp.host), detail: providerConfig.smtp.hasPassword ? "Credentials saved" : "Password not saved" },
      whatsappOfficial: { configured: providerConfig.whatsappOfficial.enabled && providerConfig.whatsappOfficial.hasToken && Boolean(providerConfig.whatsappOfficial.phoneId), detail: providerConfig.whatsappOfficial.hasAppSecret ? "Webhook signing configured" : "App secret not saved" },
      whatsappUnofficial: { configured: providerConfig.whatsappUnofficial.enabled && providerConfig.whatsappUnofficial.hasApiKey && providerConfig.whatsappUnofficial.hasWebhookSecret && Boolean(providerConfig.whatsappUnofficial.baseUrl) },
    };
    const security = {
      productionMode: process.env.NODE_ENV === "production",
      explicitCorsAllowlist: Boolean(process.env.CORS_ORIGIN && process.env.CORS_ORIGIN !== "*"),
      independentSecretsKey: Boolean(process.env.SECRETS_KEY),
      providerSecretsEncrypted: true,
      strictAuthRateLimit: true,
      securityHeaders: true,
      authenticator2faEnabled: Boolean(currentUser?.twoFaEnabledAt),
      passwordResetConfigured: Boolean(process.env.PUBLIC_APP_URL),
    };
    return {
      status: checks.database.ok && checks.redis.ok ? "healthy" : "degraded",
      checkedAt: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      checks,
      security,
      failures24h: { email: failedEmail, automation: failedAutomation },
    };
  });
}
