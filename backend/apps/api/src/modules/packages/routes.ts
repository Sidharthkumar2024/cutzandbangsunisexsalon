import { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "@cutz/db";
import { z } from "zod";
import { authorize } from "../../plugins/auth.js";
import { audit } from "../../lib/audit.js";

const ADMIN = ["OWNER", "ADMIN", "MANAGER"] as const;

async function serviceBalance(
  tx: Prisma.TransactionClient,
  customerServicePackageId: string,
  serviceId: string,
) {
  const aggregate = await tx.servicePackageLedger.aggregate({
    where: { customerServicePackageId, serviceId },
    _sum: { qtyDelta: true },
  });
  return aggregate._sum.qtyDelta ?? 0;
}

export default async function packageRoutes(app: FastifyInstance) {
  app.get("/service-packages", async () =>
    prisma.servicePackagePlan.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: { items: { include: { service: true } } },
    }),
  );

  app.post(
    "/service-packages",
    { preHandler: authorize(...ADMIN) },
    async (req, reply) => {
      const body = z
        .object({
          name: z.string().trim().min(2),
          priceMinor: z.number().int().nonnegative(),
          validityDays: z.number().int().positive().nullable().optional(),
          items: z
            .array(
              z.object({
                serviceId: z.string(),
                qty: z.number().int().positive().max(100),
              }),
            )
            .min(1),
        })
        .parse(req.body);
      if (new Set(body.items.map((item) => item.serviceId)).size !== body.items.length) {
        return reply.code(400).send({ error: "duplicate_service" });
      }
      const serviceCount = await prisma.service.count({
        where: {
          id: { in: body.items.map((item) => item.serviceId) },
          isActive: true,
          deletedAt: null,
        },
      });
      if (serviceCount !== body.items.length) {
        return reply.code(400).send({ error: "service_not_found" });
      }
      const created = await prisma.servicePackagePlan.create({
        data: {
          name: body.name,
          priceMinor: body.priceMinor,
          validityDays: body.validityDays,
          items: { create: body.items },
        },
        include: { items: { include: { service: true } } },
      });
      await audit("service_package.create", "ServicePackagePlan", created.id, {
        actorUserId: req.user?.id,
        after: body,
        ip: req.ip,
      });
      return reply.code(201).send(created);
    },
  );

  app.get(
    "/customer-packages",
    { preHandler: authorize(...ADMIN, "RECEPTION", "CUSTOMER") },
    async (req, reply) => {
      const { customerId } = z.object({ customerId: z.string() }).parse(req.query);
      const customer = await prisma.customer.findFirst({
        where: { id: customerId, deletedAt: null },
        select: { userId: true, branchId: true },
      });
      if (!customer) return reply.code(404).send({ error: "customer_not_found" });
      if (req.user?.role === "CUSTOMER" && customer.userId !== req.user.id) {
        return reply.code(403).send({ error: "forbidden" });
      }
      if (!["OWNER", "ADMIN", "CUSTOMER"].includes(req.user!.role) && req.user?.branchId !== customer.branchId) {
        return reply.code(403).send({ error: "forbidden" });
      }
      return prisma.customerServicePackage.findMany({
        where: { customerId, isActive: true },
        orderBy: { createdAt: "desc" },
        include: {
          package: { include: { items: { include: { service: true } } } },
          ledger: { orderBy: { createdAt: "asc" }, include: { service: true } },
        },
      });
    },
  );

  app.post(
    "/customer-packages",
    { preHandler: authorize(...ADMIN, "RECEPTION") },
    async (req, reply) => {
      const body = z.object({ customerId: z.string(), packageId: z.string(), soldByStaffId: z.string().optional() }).parse(req.body);
      const [customer, plan, salesperson] = await Promise.all([
        prisma.customer.findFirst({ where: { id: body.customerId, deletedAt: null }, select: { branchId: true } }),
        prisma.servicePackagePlan.findFirst({
          where: { id: body.packageId, isActive: true, deletedAt: null },
          include: { items: true },
        }),
        body.soldByStaffId ? prisma.staff.findFirst({ where: { id: body.soldByStaffId, isActive: true, deletedAt: null } }) : null,
      ]);
      if (!customer) return reply.code(404).send({ error: "customer_not_found" });
      if (!plan) return reply.code(404).send({ error: "package_not_found" });
      if (body.soldByStaffId && (!salesperson || salesperson.branchId !== customer.branchId)) return reply.code(400).send({ error: "salesperson_not_found" });
      if (!["OWNER", "ADMIN"].includes(req.user!.role) && req.user?.branchId !== customer.branchId) {
        return reply.code(403).send({ error: "forbidden" });
      }
      const enrolled = await prisma.$transaction(async (tx) => {
        const row = await tx.customerServicePackage.create({
          data: {
            customerId: body.customerId,
            packageId: plan.id,
            soldByStaffId: body.soldByStaffId,
            expiresAt: plan.validityDays
              ? new Date(Date.now() + plan.validityDays * 86_400_000)
              : null,
          },
        });
        for (const item of plan.items) {
          await tx.servicePackageLedger.create({
            data: {
              customerServicePackageId: row.id,
              serviceId: item.serviceId,
              type: "GRANT",
              qtyDelta: item.qty,
              balanceAfter: item.qty,
              reason: "Opening package entitlement",
              actorUserId: req.user?.id,
            },
          });
        }
        await audit("customer_package.enroll", "CustomerServicePackage", row.id, {
          actorUserId: req.user?.id,
          after: body,
          ip: req.ip,
        }, tx);
        return tx.customerServicePackage.findUnique({
          where: { id: row.id },
          include: {
            package: { include: { items: { include: { service: true } } } },
            ledger: { include: { service: true } },
          },
        });
      });
      return reply.code(201).send(enrolled);
    },
  );

  app.post(
    "/customer-packages/:id/redeem",
    { preHandler: authorize(...ADMIN, "RECEPTION") },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = z
        .object({
          serviceId: z.string(),
          qty: z.number().int().positive().default(1),
          invoiceId: z.string().optional(),
          reason: z.string().trim().min(2).default("Service package redemption"),
        })
        .parse(req.body);
      try {
        const result = await prisma.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${id})) IS NULL AS locked`;
            const enrollment = await tx.customerServicePackage.findUnique({
              where: { id },
              include: { customer: { select: { branchId: true, deletedAt: true } }, package: { include: { items: true } } },
            });
            if (!enrollment || !enrollment.isActive || enrollment.customer.deletedAt) throw new Error("package_not_found");
            if (enrollment.expiresAt && enrollment.expiresAt < new Date()) throw new Error("package_expired");
            if (!["OWNER", "ADMIN"].includes(req.user!.role) && req.user?.branchId !== enrollment.customer.branchId) {
              throw new Error("forbidden");
            }
            if (!enrollment.package.items.some((item) => item.serviceId === body.serviceId)) {
              throw new Error("service_not_in_package");
            }
            const current = await serviceBalance(tx, id, body.serviceId);
            if (current < body.qty) throw new Error("insufficient_package_balance");
            const balanceAfter = current - body.qty;
            const ledger = await tx.servicePackageLedger.create({
              data: {
                customerServicePackageId: id,
                serviceId: body.serviceId,
                type: "REDEEM",
                qtyDelta: -body.qty,
                balanceAfter,
                invoiceId: body.invoiceId,
                reason: body.reason,
                actorUserId: req.user?.id,
              },
            });
            await audit("customer_package.redeem", "CustomerServicePackage", id, {
              actorUserId: req.user?.id,
              after: { ...body, balanceAfter },
              ip: req.ip,
            }, tx);
            return ledger;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        return reply.code(201).send(result);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "package_redeem_failed";
        const status = reason === "forbidden" ? 403 : reason === "package_not_found" ? 404 : 409;
        return reply.code(status).send({ error: reason });
      }
    },
  );
}
