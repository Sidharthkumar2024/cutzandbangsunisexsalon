// Discount approval gate.
//
// Reception may grant discounts up to a configurable limit; anything larger
// needs a manager+. This is an authorization step the POS calls before applying
// a discount — every decision is written to the audit trail. Limits live in the
// `Setting` table (key `pos.discount`) so owners can tune them without a deploy.
//
//   POST /discounts/authorize  { subtotalMinor, discountMinor, reason }
//     -> 200 { approved:true, level:"auto"|"manager", bps }
//     -> 403 { error:"needs_manager_approval", ... } when reception exceeds its cap

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@cutz/db";
import { authorize } from "../../plugins/auth.js";
import { audit } from "../../lib/audit.js";

const MANAGER_ROLES = ["OWNER", "ADMIN", "MANAGER"] as const;

interface DiscountPolicy {
  receptionMaxBps: number; // e.g. 1000 = 10%
  receptionMaxMinor: number; // absolute cap, e.g. 50000 = ₹500
  managerMaxBps: number; // ceiling even for managers (owner/admin unlimited)
}

const DEFAULT_POLICY: DiscountPolicy = { receptionMaxBps: 1000, receptionMaxMinor: 50_000, managerMaxBps: 5000 };

async function loadPolicy(): Promise<DiscountPolicy> {
  const row = await prisma.setting.findUnique({ where: { key: "pos.discount" } });
  return { ...DEFAULT_POLICY, ...((row?.value as Partial<DiscountPolicy>) ?? {}) };
}

export default async function discountRoutes(app: FastifyInstance) {
  app.get("/discounts/policy", { preHandler: authorize(...MANAGER_ROLES, "RECEPTION") }, async () => loadPolicy());

  app.put("/discounts/policy", { preHandler: authorize("OWNER", "ADMIN") }, async (req, reply) => {
    const body = z
      .object({
        receptionMaxBps: z.number().int().min(0).max(10000),
        receptionMaxMinor: z.number().int().min(0),
        managerMaxBps: z.number().int().min(0).max(10000),
      })
      .parse(req.body);
    await prisma.setting.upsert({ where: { key: "pos.discount" }, create: { key: "pos.discount", value: body }, update: { value: body } });
    await audit("discount.policy_update", "Setting", "pos.discount", { actorUserId: req.user?.id, after: body, ip: req.ip });
    return body;
  });

  app.post("/discounts/authorize", { preHandler: authorize(...MANAGER_ROLES, "RECEPTION") }, async (req, reply) => {
    const { subtotalMinor, discountMinor, reason } = z
      .object({ subtotalMinor: z.number().int().positive(), discountMinor: z.number().int().positive(), reason: z.string().min(2) })
      .parse(req.body);
    if (discountMinor > subtotalMinor) return reply.code(400).send({ error: "discount_exceeds_subtotal" });

    const policy = await loadPolicy();
    const bps = Math.round((discountMinor / subtotalMinor) * 10000);
    const role = req.user!.role;
    const isManager = (MANAGER_ROLES as readonly string[]).includes(role);
    const isOwnerAdmin = role === "OWNER" || role === "ADMIN";

    // Owner/Admin: unlimited. Manager: up to managerMaxBps. Reception: within both caps.
    let approved: boolean;
    let level: "auto" | "manager";
    if (isOwnerAdmin) {
      approved = true;
      level = "manager";
    } else if (isManager) {
      approved = bps <= policy.managerMaxBps;
      level = "manager";
    } else {
      approved = bps <= policy.receptionMaxBps && discountMinor <= policy.receptionMaxMinor;
      level = "auto";
    }

    await audit(approved ? "discount.authorized" : "discount.denied", "Invoice", "pending", {
      actorUserId: req.user?.id,
      ip: req.ip,
      after: { subtotalMinor, discountMinor, bps, reason, level, role },
    });

    if (!approved) {
      return reply.code(403).send({
        error: "needs_manager_approval",
        bps,
        limits: { receptionMaxBps: policy.receptionMaxBps, receptionMaxMinor: policy.receptionMaxMinor },
      });
    }
    return { approved: true, level, bps };
  });
}
