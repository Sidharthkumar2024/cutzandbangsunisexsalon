import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@cutz/db";
import { providers } from "@cutz/providers";
import { authorize } from "../../plugins/auth.js";
import { audit } from "../../lib/audit.js";

const FINANCE = ["OWNER", "ADMIN", "MANAGER", "RECEPTION"] as const;

export default async function paymentRoutes(app: FastifyInstance) {
  app.post("/payments/intent", { preHandler: authorize(...FINANCE) }, async (req) => {
    const body = z.object({ amountMinor: z.number().int().positive(), reference: z.string().min(2) }).parse(req.body);
    return providers.payment().createIntent(body);
  });

  app.get("/payments/reconciliation", { preHandler: authorize("OWNER", "ADMIN", "MANAGER") }, async (req) => {
    const { status, take = "100" } = req.query as Record<string, string>;
    return prisma.paymentReconciliation.findMany({ where: status ? { status: status as "PENDING" | "MATCHED" | "MISMATCH" } : {}, orderBy: { createdAt: "desc" }, take: Math.min(500, Number(take)) });
  });

  // Provider/webhook adapters normalize their result into this idempotent record.
  app.post("/payments/reconciliation", { preHandler: authorize("OWNER", "ADMIN", "MANAGER") }, async (req, reply) => {
    const body = z.object({ provider: z.string().min(2), externalRef: z.string().min(2), amountMinor: z.number().int().positive(), payload: z.record(z.unknown()).optional() }).parse(req.body);
    const existing = await prisma.paymentReconciliation.findUnique({ where: { provider_externalRef: { provider: body.provider, externalRef: body.externalRef } } });
    if (existing) return reply.code(200).send(existing);
    const payment = await prisma.payment.findFirst({ where: { reference: body.externalRef }, orderBy: { createdAt: "desc" } });
    const status = !payment ? "PENDING" : payment.amountMinor === body.amountMinor ? "MATCHED" : "MISMATCH";
    const record = await prisma.paymentReconciliation.create({ data: { provider: body.provider, externalRef: body.externalRef, amountMinor: body.amountMinor, status, paymentId: payment?.id, payload: body.payload as any } });
    await audit("payment.reconcile", "PaymentReconciliation", record.id, { actorUserId: req.user?.id, after: { status, paymentId: payment?.id, amountMinor: body.amountMinor }, ip: req.ip });
    return reply.code(201).send(record);
  });
}
