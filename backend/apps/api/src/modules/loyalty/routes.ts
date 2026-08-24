import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@cutz/db";
import { authorize } from "../../plugins/auth.js";
import { audit } from "../../lib/audit.js";
import { getLoyaltyRules, postLoyaltyEntry } from "./ledger.js";

const STAFF = ["OWNER", "ADMIN", "MANAGER", "RECEPTION", "STAFF"] as const;

export default async function loyaltyRoutes(app: FastifyInstance) {
  app.get("/loyalty/rules", { preHandler: authorize(...STAFF, "CUSTOMER") }, async (req, reply) => {
    const parsed = z.object({ branchId: z.string().optional() }).safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_query", details: parsed.error.flatten().fieldErrors });
    }
    const branchId = parsed.data.branchId ?? req.user?.branchId ?? "main";
    if (!["OWNER", "ADMIN", "CUSTOMER"].includes(req.user!.role) && req.user?.branchId !== branchId) {
      return reply.code(403).send({ error: "forbidden" });
    }
    return getLoyaltyRules(prisma, branchId);
  });

  app.post(
    "/customers/:id/loyalty/adjust",
    { preHandler: authorize("OWNER", "ADMIN", "MANAGER") },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = z
        .object({
          deltaPoints: z.number().int().min(-1_000_000).max(1_000_000).refine((value) => value !== 0),
          reason: z.string().trim().min(3).max(240),
        })
        .parse(req.body);
      const customer = await prisma.customer.findUnique({ where: { id } });
      if (!customer) return reply.code(404).send({ error: "customer_not_found" });
      if (req.user?.role === "MANAGER" && req.user.branchId !== customer.branchId) {
        return reply.code(403).send({ error: "forbidden" });
      }
      try {
        const result = await prisma.$transaction(async (tx) => {
          const entry = await postLoyaltyEntry(tx, {
            customerId: id,
            type: "ADJUST",
            deltaPoints: body.deltaPoints,
            reason: body.reason,
            actorUserId: req.user?.id,
          });
          await audit("loyalty.adjust", "Customer", id, {
            actorUserId: req.user?.id,
            before: { loyaltyPoints: customer.loyaltyPoints },
            after: { loyaltyPoints: entry.balanceAfter, ...body },
            ip: req.ip,
          }, tx);
          return entry;
        });
        return reply.code(201).send(result);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "loyalty_adjustment_failed";
        return reply.code(reason === "insufficient_loyalty_points" ? 409 : 422).send({ error: reason });
      }
    },
  );
}
