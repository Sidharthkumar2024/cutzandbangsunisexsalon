import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@cutz/db";
import { providers } from "@cutz/providers";
import { authorize } from "../../plugins/auth.js";
import { audit } from "../../lib/audit.js";
import { resolveBranchScope } from "../../lib/branch-scope.js";

const FINANCE = ["OWNER", "ADMIN", "MANAGER", "RECEPTION"] as const;

export default async function paymentRoutes(app: FastifyInstance) {
  app.post("/payments/intent", { preHandler: authorize(...FINANCE) }, async (req) => {
    const body = z.object({ amountMinor: z.number().int().positive(), reference: z.string().min(2) }).parse(req.body);
    return providers.payment().createIntent(body);
  });

  app.get("/payments/reconciliation", { preHandler: authorize("OWNER", "ADMIN", "MANAGER") }, async (req, reply) => {
    const query = z.object({ branchId: z.string().trim().min(1).optional(), status: z.enum(["PENDING", "MATCHED", "MISMATCH"]).optional(), take: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query);
    const scope = resolveBranchScope(req.user!, query.branchId);
    if (!scope.ok) return reply.code(scope.statusCode).send({ error: scope.error });
    return prisma.paymentReconciliation.findMany({ where: { branchId: scope.branchId, ...(query.status ? { status: query.status } : {}) }, orderBy: { createdAt: "desc" }, take: query.take });
  });

  // Provider/webhook adapters normalize their result into this idempotent record.
  app.post("/payments/reconciliation", { preHandler: authorize("OWNER", "ADMIN", "MANAGER") }, async (req, reply) => {
    const body = z.object({ branchId: z.string().trim().min(1).optional(), provider: z.string().min(2), externalRef: z.string().min(2), amountMinor: z.number().int().positive(), payload: z.record(z.unknown()).optional() }).parse(req.body);
    const scope = resolveBranchScope(req.user!, body.branchId);
    if (!scope.ok) return reply.code(scope.statusCode).send({ error: scope.error });
    const existing = await prisma.paymentReconciliation.findUnique({ where: { branchId_provider_externalRef: { branchId: scope.branchId, provider: body.provider, externalRef: body.externalRef } } });
    if (existing) return reply.code(200).send(existing);
    const payment = await prisma.payment.findFirst({ where: { reference: body.externalRef, invoice: { branchId: scope.branchId } }, orderBy: { createdAt: "desc" } });
    const status = !payment ? "PENDING" : payment.amountMinor === body.amountMinor ? "MATCHED" : "MISMATCH";
    const record = await prisma.paymentReconciliation.create({ data: { branchId: scope.branchId, provider: body.provider, externalRef: body.externalRef, amountMinor: body.amountMinor, status, paymentId: payment?.id, payload: body.payload as any } });
    await audit("payment.reconcile", "PaymentReconciliation", record.id, { actorUserId: req.user?.id, after: { branchId: scope.branchId, status, paymentId: payment?.id, amountMinor: body.amountMinor }, ip: req.ip });
    return reply.code(201).send(record);
  });
}
