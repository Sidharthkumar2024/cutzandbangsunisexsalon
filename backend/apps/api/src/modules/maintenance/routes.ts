// Maintenance endpoint: runs membership/package expiry + renewal reminders.
// Trigger either as an authenticated owner/admin, or from a cron job using the
// shared MAINTENANCE_TOKEN header (so no user session is needed on a schedule).
//
// Cron example (daily 02:30):
//   30 2 * * * curl -fsS -X POST https://api.example.com/api/v1/maintenance/run \
//     -H "x-maintenance-token: $MAINTENANCE_TOKEN"

import { FastifyInstance } from "fastify";
import { prisma } from "@cutz/db";
import { authorize } from "../../plugins/auth.js";
import { runExpiryAndRenewals } from "../../lib/expiry.js";

export default async function maintenanceRoutes(app: FastifyInstance) {
  app.post("/maintenance/run", async (req, reply) => {
    const token = req.headers["x-maintenance-token"];
    const cronAuthorized = !!process.env.MAINTENANCE_TOKEN && token === process.env.MAINTENANCE_TOKEN;

    if (!cronAuthorized) {
      // Fall back to session auth (owner/admin) when no valid cron token.
      if (!req.user) return reply.code(401).send({ error: "unauthenticated" });
      if (!["OWNER", "ADMIN"].includes(req.user.role)) return reply.code(403).send({ error: "forbidden" });
    }

    const result = await runExpiryAndRenewals(prisma);
    return { ok: true, ...result };
  });
}
