import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@cutz/db";
import { authorize } from "../../plugins/auth.js";
import { grant, adjust, verifyBalance } from "./ledger.js";
import { audit } from "../../lib/audit.js";

const ADMIN = ["OWNER", "ADMIN", "MANAGER"] as const;

export default async function membershipRoutes(app: FastifyInstance) {
  app.get("/membership-plans", async () =>
    prisma.membershipPlan.findMany({ where: { isActive: true } }),
  );

  app.post("/membership-plans", { preHandler: authorize(...ADMIN) }, async (req, reply) => {
    const body = z
      .object({
        name: z.string(),
        payMinor: z.number().int().positive(),
        creditMinor: z.number().int().positive(),
        validityDays: z.number().int().positive().nullable().optional(),
        memberDiscountBps: z.number().int().nonnegative().default(0),
        eligibleCategoryIds: z.array(z.string()).default([]),
        excludedServiceIds: z.array(z.string()).default([]),
      })
      .refine((value) => value.creditMinor >= value.payMinor, { message: "credit_must_cover_payment", path: ["creditMinor"] })
      .parse(req.body);
    const plan = await prisma.membershipPlan.create({ data: body });
    await audit("membership_plan.create", "MembershipPlan", plan.id, { actorUserId: req.user?.id, after: body, ip: req.ip });
    return reply.code(201).send(plan);
  });

  // Enroll a customer -> creates membership and grants credit in one tx.
  app.post("/memberships", { preHandler: authorize(...ADMIN, "RECEPTION") }, async (req, reply) => {
    const { customerId, planId } = z.object({ customerId: z.string(), planId: z.string() }).parse(req.body);
    const [plan, customer, duplicate] = await Promise.all([
      prisma.membershipPlan.findUnique({ where: { id: planId } }),
      prisma.customer.findUnique({ where: { id: customerId }, select: { branchId: true } }),
      prisma.membership.findFirst({ where: { customerId, planId, isActive: true }, select: { id: true } }),
    ]);
    if (!plan) return reply.code(404).send({ error: "plan_not_found" });
    if (!customer) return reply.code(404).send({ error: "customer_not_found" });
    if (!["OWNER", "ADMIN"].includes(req.user!.role) && req.user!.branchId !== customer.branchId) return reply.code(403).send({ error: "forbidden" });
    if (duplicate) return reply.code(409).send({ error: "active_membership_exists", membershipId: duplicate.id });

    const membership = await prisma.$transaction(async (tx) => {
      const m = await tx.membership.create({
        data: {
          planId,
          customerId,
          balanceMinor: 0,
          expiresAt: plan.validityDays ? new Date(Date.now() + plan.validityDays * 86_400_000) : null,
        },
      });
      await grant(tx, m.id, plan.creditMinor, req.user?.id);
      await audit("membership.enroll", "Membership", m.id, { actorUserId: req.user?.id, after: { customerId, planId, creditMinor: plan.creditMinor }, ip: req.ip }, tx);
      return tx.membership.findUnique({ where: { id: m.id }, include: { ledger: true } });
    });
    return reply.code(201).send(membership);
  });

  // Permissioned manual adjustment — audited.
  app.post("/memberships/:id/adjust", { preHandler: authorize("OWNER", "ADMIN") }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { deltaMinor, reason } = z
      .object({ deltaMinor: z.number().int(), reason: z.string().min(3) })
      .parse(req.body);
    try {
      const balanceAfter = await prisma.$transaction(async (tx) => {
        const bal = await adjust(tx, id, deltaMinor, reason, req.user!.id);
        await audit("membership.adjust", "Membership", id, { actorUserId: req.user!.id, after: { deltaMinor, reason, balanceAfter: bal } }, tx);
        return bal;
      });
      return { balanceMinor: balanceAfter };
    } catch (e) {
      return reply.code(409).send({ error: (e as Error).message });
    }
  });

  // Reconciliation check (owner/admin) — ledger vs cached balance.
  app.get("/memberships/:id/verify", { preHandler: authorize("OWNER", "ADMIN") }, async (req) => {
    const { id } = req.params as { id: string };
    return verifyBalance(prisma, id);
  });
}
