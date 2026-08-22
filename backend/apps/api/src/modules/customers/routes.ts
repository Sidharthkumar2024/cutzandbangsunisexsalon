import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@cutz/db";
import { authorize } from "../../plugins/auth.js";
import { parseCsv, phoneKey } from "../../lib/csv.js";
import { classify, DEFAULT_SEGMENT_CONFIG } from "../crm/segments.js";
import { audit } from "../../lib/audit.js";
import { getLoyaltyRules, postLoyaltyEntry } from "../loyalty/ledger.js";

const STAFF_ROLES = ["OWNER", "ADMIN", "MANAGER", "RECEPTION", "STAFF"] as const;
const companionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  relation: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(30).optional(),
  notes: z.string().trim().max(500).optional(),
});
const initialVisitSchema = z.object({
  visitedAt: z.coerce.date(),
  serviceName: z.string().trim().min(2).max(200),
  amountMinor: z.number().int().nonnegative().default(0),
  staffName: z.string().trim().max(150).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export default async function customerRoutes(app: FastifyInstance) {
  // List + search + segment filter
  app.get("/customers", { preHandler: authorize(...STAFF_ROLES) }, async (req) => {
    const { q, branchId, segment, take = "50", skip = "0" } = req.query as Record<string, string>;
    const where: Record<string, unknown> = { deletedAt: null };
    const scopedBranch = ["OWNER", "ADMIN"].includes(req.user!.role) ? branchId : req.user!.branchId;
    if (scopedBranch) where.branchId = scopedBranch;
    if (q)
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
        { email: { contains: q, mode: "insensitive" } },
      ];

    const takeN = Math.min(200, Number(take) || 50);
    const skipN = Number(skip) || 0;
    // When filtering by segment we must classify BEFORE paginating, otherwise
    // matches outside the fetched page are silently dropped. Bound the scan.
    const customers = await prisma.customer.findMany({
      where,
      take: segment ? 2000 : takeN,
      skip: segment ? 0 : skipN,
      orderBy: { lastVisitAt: "desc" },
      include: { memberships: { where: { isActive: true }, select: { id: true } } },
    });
    const now = new Date();
    const enriched = customers.map((c) => ({
      ...c,
      segments: classify(
        {
          visitCount: c.visitCount,
          totalSpent: c.totalSpent,
          lastVisitAt: c.lastVisitAt,
          hasActiveMembership: c.memberships.length > 0,
        },
        DEFAULT_SEGMENT_CONFIG,
        now,
      ),
    }));
    if (!segment) return enriched;
    return enriched.filter((c) => c.segments.includes(segment)).slice(skipN, skipN + takeN);
  });

  // Exact, fast duplicate check used while an operator types a phone number.
  app.get("/customers/lookup", { preHandler: authorize(...STAFF_ROLES) }, async (req, reply) => {
    const { branchId, phone } = z.object({ branchId: z.string(), phone: z.string().min(4) }).parse(req.query);
    if (!["OWNER", "ADMIN"].includes(req.user!.role) && req.user!.branchId !== branchId) return reply.code(403).send({ error: "forbidden" });
    const key = phoneKey(phone);
    if (!key) return null;
    return prisma.customer.findFirst({
      where: { branchId, deletedAt: null, phone: { endsWith: key } },
      include: {
        invoices: { where: { status: { not: "VOID" } }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, number: true, totalMinor: true, createdAt: true, status: true } },
        historyEntries: { orderBy: { visitedAt: "desc" }, take: 5 },
      },
    });
  });

  app.post("/customers", { preHandler: authorize(...STAFF_ROLES) }, async (req, reply) => {
    const body = z
      .object({
        branchId: z.string(),
        name: z.string().min(1),
        phone: z.string().optional(),
        email: z.string().email().optional(),
        gender: z.string().optional(),
        source: z.string().optional(),
        referralName: z.string().trim().max(150).optional(),
        referralPhone: z.string().trim().max(30).optional(),
        tags: z.array(z.string()).optional(),
        notes: z.string().optional(),
        waConsent: z.boolean().optional(),
        emailConsent: z.boolean().optional(),
        companions: z.array(companionSchema).max(12).optional(),
        initialVisit: initialVisitSchema.optional(),
      })
      .parse(req.body);
    if (!["OWNER", "ADMIN"].includes(req.user!.role) && req.user!.branchId !== body.branchId) return reply.code(403).send({ error: "forbidden" });
    if (body.initialVisit && body.initialVisit.visitedAt > new Date()) {
      return reply.code(400).send({ error: "historical_visit_cannot_be_future" });
    }
    const { companions = [], initialVisit, ...profile } = body;
    const normalized = {
      ...profile,
      phone: body.phone ? body.phone.replace(/\D/g, "") : undefined,
      referralPhone: body.referralPhone ? body.referralPhone.replace(/\D/g, "") : undefined,
    };
    try {
      const c = await prisma.$transaction(async (tx) => {
        const customer = await tx.customer.create({ data: normalized });
        if (companions.length) {
          await tx.customerCompanion.createMany({
            data: companions.map((companion) => ({
              ...companion,
              customerId: customer.id,
              phone: companion.phone ? companion.phone.replace(/\D/g, "") : undefined,
            })),
          });
        }
        if (initialVisit) {
          await tx.customerHistoryEntry.create({
            data: { customerId: customer.id, ...initialVisit, actorUserId: req.user?.id },
          });
          await tx.customer.update({
            where: { id: customer.id },
            data: {
              visitCount: { increment: 1 },
              totalSpent: { increment: initialVisit.amountMinor },
              lastVisitAt: initialVisit.visitedAt,
            },
          });
        }
        const rules = await getLoyaltyRules(tx, body.branchId);
        if (rules.enabled && rules.welcomePoints > 0) {
          await postLoyaltyEntry(tx, {
            customerId: customer.id,
            type: "WELCOME",
            deltaPoints: rules.welcomePoints,
            reason: "Welcome points",
            actorUserId: req.user?.id,
          });
        }
        await audit("customer.create", "Customer", customer.id, {
          actorUserId: req.user?.id,
          after: { ...normalized, companions: companions.length, initialVisit, welcomePoints: rules.enabled ? rules.welcomePoints : 0 },
          ip: req.ip,
        }, tx);
        return tx.customer.findUniqueOrThrow({
          where: { id: customer.id },
          include: { companions: { where: { deletedAt: null } }, historyEntries: { orderBy: { visitedAt: "desc" }, take: 10 } },
        });
      });
      return reply.code(201).send(c);
    } catch (e) {
      if ((e as { code?: string }).code === "P2002")
        return reply.code(409).send({ error: "duplicate_phone" });
      throw e;
    }
  });

  // Customer 360 timeline
  app.get("/customers/:id", { preHandler: authorize(...STAFF_ROLES) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = await prisma.customer.findUnique({
      where: { id },
      include: {
        appointments: {
          orderBy: { startAt: "desc" },
          take: 50,
          include: { items: { include: { service: true, staff: true } } },
        },
        invoices: { orderBy: { createdAt: "desc" }, take: 50, include: { payments: true, items: true } },
        memberships: { include: { plan: true, ledger: { orderBy: { createdAt: "desc" } } } },
        servicePackages: {
          where: { isActive: true },
          orderBy: { createdAt: "desc" },
          include: {
            package: { include: { items: { include: { service: true } } } },
            ledger: { orderBy: { createdAt: "desc" }, include: { service: true } },
          },
        },
        walletLedger: { orderBy: { createdAt: "desc" } },
        loyaltyLedger: { orderBy: { createdAt: "desc" } },
        historyEntries: { orderBy: { visitedAt: "desc" }, take: 200 },
        companions: { where: { deletedAt: null }, orderBy: { createdAt: "asc" } },
      },
    });
    if (!c) return reply.code(404).send({ error: "not_found" });
    if (!["OWNER", "ADMIN"].includes(req.user!.role) && req.user!.branchId !== c.branchId) return reply.code(403).send({ error: "forbidden" });
    return c;
  });

  app.post("/customers/:id/companions", { preHandler: authorize("OWNER", "ADMIN", "MANAGER", "RECEPTION") }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = companionSchema.parse(req.body);
    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) return reply.code(404).send({ error: "not_found" });
    if (!["OWNER", "ADMIN"].includes(req.user!.role) && req.user!.branchId !== customer.branchId) return reply.code(403).send({ error: "forbidden" });
    const companion = await prisma.customerCompanion.create({
      data: { ...body, customerId: id, phone: body.phone ? body.phone.replace(/\D/g, "") : undefined },
    });
    await audit("customer.companion.create", "CustomerCompanion", companion.id, { actorUserId: req.user?.id, after: body, ip: req.ip });
    return reply.code(201).send(companion);
  });

  app.patch("/customers/:id/companions/:companionId", { preHandler: authorize("OWNER", "ADMIN", "MANAGER", "RECEPTION") }, async (req, reply) => {
    const { id, companionId } = req.params as { id: string; companionId: string };
    const body = companionSchema.partial().parse(req.body);
    const companion = await prisma.customerCompanion.findFirst({ where: { id: companionId, customerId: id, deletedAt: null }, include: { customer: true } });
    if (!companion) return reply.code(404).send({ error: "companion_not_found" });
    if (!["OWNER", "ADMIN"].includes(req.user!.role) && req.user!.branchId !== companion.customer.branchId) return reply.code(403).send({ error: "forbidden" });
    const updated = await prisma.customerCompanion.update({
      where: { id: companionId },
      data: { ...body, phone: body.phone ? body.phone.replace(/\D/g, "") : body.phone },
    });
    await audit("customer.companion.update", "CustomerCompanion", companionId, { actorUserId: req.user?.id, before: companion, after: body, ip: req.ip });
    return updated;
  });

  app.delete("/customers/:id/companions/:companionId", { preHandler: authorize("OWNER", "ADMIN", "MANAGER") }, async (req, reply) => {
    const { id, companionId } = req.params as { id: string; companionId: string };
    const companion = await prisma.customerCompanion.findFirst({ where: { id: companionId, customerId: id, deletedAt: null }, include: { customer: true } });
    if (!companion) return reply.code(404).send({ error: "companion_not_found" });
    if (!["OWNER", "ADMIN"].includes(req.user!.role) && req.user!.branchId !== companion.customer.branchId) return reply.code(403).send({ error: "forbidden" });
    await prisma.customerCompanion.update({ where: { id: companionId }, data: { deletedAt: new Date() } });
    await audit("customer.companion.archive", "CustomerCompanion", companionId, { actorUserId: req.user?.id, ip: req.ip });
    return reply.code(204).send();
  });

  // Import a dated visit from the salon's previous system without inventing an
  // invoice/payment record. Rollups update transactionally for CRM/search.
  app.post("/customers/:id/history", { preHandler: authorize("OWNER", "ADMIN", "MANAGER", "RECEPTION") }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      visitedAt: z.coerce.date(),
      serviceName: z.string().trim().min(2).max(200),
      amountMinor: z.number().int().nonnegative().default(0),
      staffName: z.string().trim().max(150).optional(),
      notes: z.string().trim().max(1000).optional(),
    }).parse(req.body);
    if (body.visitedAt > new Date()) return reply.code(400).send({ error: "historical_visit_cannot_be_future" });
    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) return reply.code(404).send({ error: "not_found" });
    if (!["OWNER", "ADMIN"].includes(req.user!.role) && req.user!.branchId !== customer.branchId) return reply.code(403).send({ error: "forbidden" });
    const entry = await prisma.$transaction(async (tx) => {
      const created = await tx.customerHistoryEntry.create({ data: { customerId: id, ...body, actorUserId: req.user?.id } });
      await tx.customer.update({
        where: { id },
        data: {
          visitCount: { increment: 1 },
          totalSpent: { increment: body.amountMinor },
          ...(!customer.lastVisitAt || body.visitedAt > customer.lastVisitAt ? { lastVisitAt: body.visitedAt } : {}),
        },
      });
      await audit("customer.history.create", "CustomerHistoryEntry", created.id, { actorUserId: req.user?.id, after: body, ip: req.ip }, tx);
      return created;
    });
    return reply.code(201).send(entry);
  });

  app.patch("/customers/:id", { preHandler: authorize(...STAFF_ROLES) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      name: z.string().min(1).optional(),
      phone: z.string().nullable().optional(),
      email: z.string().email().nullable().optional(),
      gender: z.string().nullable().optional(),
      source: z.string().nullable().optional(),
      referralName: z.string().trim().max(150).nullable().optional(),
      referralPhone: z.string().trim().max(30).nullable().optional(),
      notes: z.string().nullable().optional(),
      tags: z.array(z.string()).optional(),
      waConsent: z.boolean().optional(),
      emailConsent: z.boolean().optional(),
      smsConsent: z.boolean().optional(),
    }).parse(req.body);
    const current = await prisma.customer.findUnique({ where: { id } });
    if (!current) return reply.code(404).send({ error: "not_found" });
    if (!["OWNER", "ADMIN"].includes(req.user!.role) && req.user!.branchId !== current.branchId) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const customer = await prisma.$transaction(async (tx) => {
      const updated = await tx.customer.update({ where: { id }, data: body });
      await audit("customer.update", "Customer", id, {
        actorUserId: req.user?.id,
        before: current,
        after: body,
        ip: req.ip,
      }, tx);
      return updated;
    });
    return customer;
  });

  // CSV / Google-Sheet import with phone/email dedupe
  app.post("/customers/import", { preHandler: authorize("OWNER", "ADMIN", "MANAGER") }, async (req, reply) => {
    const { branchId, csv } = z.object({ branchId: z.string(), csv: z.string() }).parse(req.body);
    if (!["OWNER", "ADMIN"].includes(req.user!.role) && req.user!.branchId !== branchId) return reply.code(403).send({ error: "forbidden" });
    const rows = parseCsv(csv);
    let created = 0;
    let skipped = 0;
    const loyaltyRules = await getLoyaltyRules(prisma, branchId);
    for (const r of rows) {
      const pk = phoneKey(r.phone);
      const email = r.email?.toLowerCase() || undefined;
      const dup = await prisma.customer.findFirst({
        where: {
          branchId,
          deletedAt: null,
          OR: [
            ...(pk ? [{ phone: { endsWith: pk } }] : []),
            ...(email ? [{ email }] : []),
          ],
        },
      });
      if (dup) { skipped++; continue; }
      await prisma.$transaction(async (tx) => {
        const customer = await tx.customer.create({
          data: {
            branchId,
            name: r.name || r.customer || "Unknown",
            phone: r.phone || undefined,
            email,
            source: r.source || "import",
            tags: r.tags ? r.tags.split(/[;|]/).map((t) => t.trim()).filter(Boolean) : [],
          },
        });
        if (loyaltyRules.enabled && loyaltyRules.welcomePoints > 0) {
          await postLoyaltyEntry(tx, {
            customerId: customer.id,
            type: "WELCOME",
            deltaPoints: loyaltyRules.welcomePoints,
            reason: "Welcome points",
            actorUserId: req.user?.id,
          });
        }
      });
      created++;
    }
    return reply.send({ created, skipped, total: rows.length });
  });
}
