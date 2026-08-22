import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@cutz/db";
import { authorize } from "../../plugins/auth.js";
import { audit } from "../../lib/audit.js";
import { calculateCouponDiscount } from "./engine.js";

const STAFF = ["OWNER", "ADMIN", "MANAGER", "RECEPTION"] as const;
const ADMIN = ["OWNER", "ADMIN", "MANAGER"] as const;

const couponFields = z.object({
    branchId: z.string(),
    code: z.string().trim().min(3).max(24).regex(/^[A-Za-z0-9_-]+$/),
    name: z.string().trim().min(2).max(80),
    type: z.enum(["PERCENTAGE", "FIXED"]),
    value: z.number().int().positive(),
    minSpendMinor: z.number().int().nonnegative().default(0),
    maxDiscountMinor: z.number().int().positive().nullable().optional(),
    usageLimit: z.number().int().positive().nullable().optional(),
    perCustomerLimit: z.number().int().positive().nullable().optional(),
    startsAt: z.coerce.date().nullable().optional(),
    endsAt: z.coerce.date().nullable().optional(),
    isActive: z.boolean().default(true),
  });

const couponInput = couponFields
  .superRefine((value, ctx) => {
    if (value.type === "PERCENTAGE" && value.value > 10_000) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "percentage_must_be_at_most_100" });
    }
    if (value.startsAt && value.endsAt && value.endsAt <= value.startsAt) {
      ctx.addIssue({ code: "custom", path: ["endsAt"], message: "end_must_follow_start" });
    }
  });

export default async function couponRoutes(app: FastifyInstance) {
  app.get("/coupons", { preHandler: authorize(...STAFF) }, async (req, reply) => {
    const { branchId } = z.object({ branchId: z.string() }).parse(req.query);
    if (!["OWNER", "ADMIN"].includes(req.user!.role) && req.user?.branchId !== branchId) {
      return reply.code(403).send({ error: "forbidden" });
    }
    return prisma.coupon.findMany({
      where: { branchId, deletedAt: null },
      orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
    });
  });

  app.post("/coupons", { preHandler: authorize(...ADMIN) }, async (req, reply) => {
    const body = couponInput.parse(req.body);
    if (req.user?.role === "MANAGER" && req.user.branchId !== body.branchId) {
      return reply.code(403).send({ error: "forbidden" });
    }
    try {
      const coupon = await prisma.coupon.create({
        data: { ...body, code: body.code.toUpperCase() },
      });
      await audit("coupon.create", "Coupon", coupon.id, {
        actorUserId: req.user?.id,
        after: coupon,
        ip: req.ip,
      });
      return reply.code(201).send(coupon);
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") {
        return reply.code(409).send({ error: "coupon_code_exists" });
      }
      throw error;
    }
  });

  app.patch("/coupons/:id", { preHandler: authorize(...ADMIN) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const current = await prisma.coupon.findUnique({ where: { id } });
    if (!current || current.deletedAt) return reply.code(404).send({ error: "coupon_not_found" });
    if (req.user?.role === "MANAGER" && req.user.branchId !== current.branchId) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const body = couponFields.partial().parse(req.body);
    const merged = couponInput.parse({ ...current, ...body, branchId: current.branchId });
    const coupon = await prisma.coupon.update({
      where: { id },
      // branchId is immutable on update — a coupon can't be moved between branches.
      data: { ...body, branchId: current.branchId, code: body.code?.toUpperCase() },
    });
    await audit("coupon.update", "Coupon", id, {
      actorUserId: req.user?.id,
      before: current,
      after: merged,
      ip: req.ip,
    });
    return coupon;
  });

  app.post("/coupons/preview", { preHandler: authorize(...STAFF) }, async (req, reply) => {
    const body = z
      .object({ type: z.enum(["PERCENTAGE", "FIXED"]), value: z.number().int().positive(), amountMinor: z.number().int().nonnegative(), maxDiscountMinor: z.number().int().positive().nullable().optional() })
      .parse(req.body);
    if (body.type === "PERCENTAGE" && body.value > 10_000) return reply.code(400).send({ error: "invalid_percentage" });
    return { discountMinor: calculateCouponDiscount({ ...body, maxDiscountMinor: body.maxDiscountMinor ?? null }, body.amountMinor) };
  });
}
