import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { prisma } from "@cutz/db";
import authPlugin from "./plugins/auth.js";
import authRoutes from "./modules/auth/routes.js";
import bookingRoutes from "./modules/bookings/routes.js";
import posRoutes from "./modules/pos/routes.js";
import customerRoutes from "./modules/customers/routes.js";
import catalogRoutes from "./modules/catalog/routes.js";
import membershipRoutes from "./modules/memberships/routes.js";
import inventoryRoutes from "./modules/inventory/routes.js";
import reportRoutes from "./modules/reports/routes.js";
import campaignRoutes from "./modules/campaigns/routes.js";
import inboxRoutes from "./modules/inbox/routes.js";
import waitlistRoutes from "./modules/waitlist/routes.js";
import integrationRoutes from "./modules/integration/routes.js";
import attendanceRoutes from "./modules/attendance/routes.js";
import platformRoutes from "./modules/platform/routes.js";
import paymentRoutes from "./modules/payments/routes.js";
import mediaRoutes from "./modules/media/routes.js";
import packageRoutes from "./modules/packages/routes.js";
import refundRoutes from "./modules/refunds/routes.js";
import maintenanceRoutes from "./modules/maintenance/routes.js";
import consolidatedRoutes from "./modules/consolidated/routes.js";
import loyaltyRoutes from "./modules/loyalty/routes.js";
import couponRoutes from "./modules/coupons/routes.js";
import scanRoutes from "./modules/scan/routes.js";
import discountRoutes from "./modules/discounts/routes.js";
import rebookRoutes from "./modules/rebook/routes.js";
import providerConfigRoutes from "./modules/provider-config/routes.js";
import systemRoutes from "./modules/system/routes.js";
import operationsRoutes from "./modules/operations/routes.js";
import workforceRoutes from "./modules/workforce/routes.js";

export function buildServer() {
  const app = Fastify({
    logger: true,
    bodyLimit: 5 * 1024 * 1024,
    trustProxy: process.env.TRUST_PROXY === "true",
  });

  // CORS: "*" (or unset) reflects any origin — fine for dev and the public
  // booking endpoint (bearer auth, no cookies). In prod set an explicit list.
  const corsEnv = process.env.CORS_ORIGIN ?? "*";
  if (process.env.NODE_ENV === "production" && corsEnv === "*") {
    throw new Error("CORS_ORIGIN must be an explicit production allowlist");
  }
  app.register(cors, { origin: corsEnv === "*" ? true : corsEnv.split(",").filter(Boolean) });
  app.register(rateLimit, { max: Number(process.env.RATE_LIMIT_MAX ?? 100), timeWindow: "1 minute" });
  app.register(authPlugin);
  app.addHook("onSend", async (_req, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)");
    if (process.env.NODE_ENV === "production") reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    return payload;
  });

  app.get("/health", async () => ({ status: "ok" }));
  app.get("/health/db", async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: "ok" };
    } catch {
      return reply.code(503).send({ status: "db_unavailable" });
    }
  });

  const v1 = { prefix: "/api/v1" };
  app.register(authRoutes, v1);
  app.register(bookingRoutes, v1);
  app.register(posRoutes, v1);
  app.register(customerRoutes, v1);
  app.register(catalogRoutes, v1);
  app.register(membershipRoutes, v1);
  app.register(inventoryRoutes, v1);
  app.register(reportRoutes, v1);
  app.register(campaignRoutes, v1);
  app.register(inboxRoutes, v1);
  app.register(waitlistRoutes, v1);
  app.register(attendanceRoutes, v1);
  app.register(platformRoutes, v1);
  app.register(paymentRoutes, v1);
  app.register(mediaRoutes, v1);
  app.register(packageRoutes, v1);
  app.register(refundRoutes, v1);
  app.register(maintenanceRoutes, v1);
  app.register(consolidatedRoutes, v1);
  app.register(loyaltyRoutes, v1);
  app.register(couponRoutes, v1);
  app.register(scanRoutes, v1);
  app.register(discountRoutes, v1);
  app.register(rebookRoutes, v1);
  app.register(providerConfigRoutes, v1);
  app.register(systemRoutes, v1);
  app.register(operationsRoutes, v1);
  app.register(workforceRoutes, v1);

  // Compatibility adapter for the Codex salon UI (POST /api/bookings).
  app.register(integrationRoutes, { prefix: "/api" });

  return app;
}

if (process.argv[1] && /server\.(js|ts)$/.test(process.argv[1])) {
  const app = buildServer();
  const port = Number(process.env.PORT ?? 4000);
  app.listen({ port, host: "0.0.0.0" }).catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
}
