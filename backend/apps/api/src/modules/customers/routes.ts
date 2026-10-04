import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@cutz/db";
import { authorize } from "../../plugins/auth.js";
import { parseConsent, parseCsv, phoneKey } from "../../lib/csv.js";
import { classify, DEFAULT_SEGMENT_CONFIG } from "../crm/segments.js";
import { audit } from "../../lib/audit.js";
import { getLoyaltyRules, postLoyaltyEntry } from "../loyalty/ledger.js";

const STAFF_ROLES = ["OWNER", "ADMIN", "MANAGER", "RECEPTION", "STAFF"] as const;
const CUSTOMER_PAGE_SIZE_LIMIT = 500;
const CUSTOMER_IMPORT_ROW_LIMIT = 100_000;
const CUSTOMER_IMPORT_BODY_LIMIT = 25_000_000;
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
const customerSinceSchema = z.coerce.date().refine((value) => value <= new Date(), {
  message: "customer_since_cannot_be_future",
});

export default async function customerRoutes(app: FastifyInstance) {
  // List + search + segment filter
  app.get("/customers", { preHandler: authorize(...STAFF_ROLES) }, async (req, reply) => {
    const { q, branchId, segment, take = "50", skip = "0" } = req.query as Record<string, string>;
    const where: Record<string, unknown> = { deletedAt: null };
    const elevated = ["OWNER", "ADMIN"].includes(req.user!.role);
    if (!elevated && !req.user!.branchId) return reply.code(403).send({ error: "branch_required" });
    const scopedBranch = elevated ? branchId : req.user!.branchId;
    if (scopedBranch) where.branchId = scopedBranch;
    if (q)
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
        { email: { contains: q, mode: "insensitive" } },
      ];

    const takeN = Math.min(CUSTOMER_PAGE_SIZE_LIMIT, Number(take) || 50);
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

  app.get("/customers/directory", { preHandler: authorize(...STAFF_ROLES) }, async (req, reply) => {
    const { q, branchId, segment = "ALL", take = "100", skip = "0" } = req.query as Record<string, string>;
    const elevated = ["OWNER", "ADMIN"].includes(req.user!.role);
    if (!elevated && !req.user!.branchId) return reply.code(403).send({ error: "branch_required" });
    const scopedBranch = elevated ? branchId : req.user!.branchId;
    const search = q?.trim();
    const baseWhere: Record<string, unknown> = { deletedAt: null };
    if (scopedBranch) baseWhere.branchId = scopedBranch;
    if (search)
      baseWhere.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { phone: { contains: search.replace(/\D/g, "") || search } },
        { email: { contains: search, mode: "insensitive" } },
      ];

    const now = new Date();
    const lapsedCutoff = new Date(now.getTime() - DEFAULT_SEGMENT_CONFIG.lapsedDays * 86_400_000);
    const atRiskCutoff = new Date(now.getTime() - DEFAULT_SEGMENT_CONFIG.atRiskDays * 86_400_000);
    const segmentWhere =
      segment === "NEW"
        ? { visitCount: { lte: 1 } }
        : segment === "REPEAT"
          ? { visitCount: { gte: DEFAULT_SEGMENT_CONFIG.repeatMinVisits } }
          : segment === "LAPSED"
            ? { OR: [{ lastVisitAt: null }, { lastVisitAt: { lte: lapsedCutoff } }] }
            : segment === "AT_RISK"
              ? { lastVisitAt: { lte: atRiskCutoff, gt: lapsedCutoff } }
              : {};
    const andWhere = (nextSegmentWhere: Record<string, unknown>) =>
      Object.keys(nextSegmentWhere).length ? { AND: [baseWhere, nextSegmentWhere] } : baseWhere;
    const where = andWhere(segmentWhere);
    const takeN = Math.min(CUSTOMER_PAGE_SIZE_LIMIT, Math.max(1, Number(take) || 100));
    const skipN = Math.max(0, Number(skip) || 0);
    const [customers, total, all, fresh, repeat, atRisk, lapsed] = await prisma.$transaction([
      prisma.customer.findMany({
        where,
        take: takeN,
        skip: skipN,
        orderBy: [{ lastVisitAt: "desc" }, { createdAt: "desc" }, { name: "asc" }],
        include: { memberships: { where: { isActive: true }, select: { id: true } } },
      }),
      prisma.customer.count({ where }),
      prisma.customer.count({ where: baseWhere }),
      prisma.customer.count({ where: andWhere({ visitCount: { lte: 1 } }) }),
      prisma.customer.count({ where: andWhere({ visitCount: { gte: DEFAULT_SEGMENT_CONFIG.repeatMinVisits } }) }),
      prisma.customer.count({ where: andWhere({ lastVisitAt: { lte: atRiskCutoff, gt: lapsedCutoff } }) }),
      prisma.customer.count({ where: andWhere({ OR: [{ lastVisitAt: null }, { lastVisitAt: { lte: lapsedCutoff } }] }) }),
    ]);
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
    return {
      customers: enriched,
      total,
      skip: skipN,
      take: takeN,
      hasMore: skipN + enriched.length < total,
      counts: { ALL: all, NEW: fresh, REPEAT: repeat, AT_RISK: atRisk, LAPSED: lapsed },
    };
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
        customerSince: customerSinceSchema.optional(),
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
      customerSince: body.customerSince ?? initialVisit?.visitedAt,
      phone: body.phone ? body.phone.replace(/\D/g, "") : undefined,
      email: body.email ? body.email.toLowerCase() : undefined,
      referralPhone: body.referralPhone ? body.referralPhone.replace(/\D/g, "") : undefined,
    };
    try {
      const c = await prisma.$transaction(async (tx) => {
        const pk = phoneKey(normalized.phone);
        const activeDuplicate = pk
          ? await tx.customer.findFirst({
              where: { branchId: body.branchId, deletedAt: null, phone: { endsWith: pk } },
              select: { id: true },
            })
          : null;
        if (activeDuplicate) {
          throw Object.assign(new Error("duplicate_active_customer"), { appCode: "duplicate_phone" });
        }

        const archivedDuplicate = pk
          ? await tx.customer.findFirst({
              where: { branchId: body.branchId, deletedAt: { not: null }, phone: { endsWith: pk } },
            })
          : normalized.email
            ? await tx.customer.findFirst({
                where: { branchId: body.branchId, deletedAt: { not: null }, email: normalized.email },
              })
            : null;

        const customer = archivedDuplicate
          ? await tx.customer.update({
              where: { id: archivedDuplicate.id },
              data: {
                ...normalized,
                customerSince: normalized.customerSince && normalized.customerSince < archivedDuplicate.customerSince ? normalized.customerSince : archivedDuplicate.customerSince,
                source: normalized.source || "walk_in",
                deletedAt: null,
              },
            })
          : await tx.customer.create({ data: normalized });
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
              customerSince: customer.customerSince && customer.customerSince < initialVisit.visitedAt ? customer.customerSince : initialVisit.visitedAt,
            },
          });
        }
        const rules = await getLoyaltyRules(tx, body.branchId);
        const existingWelcome = archivedDuplicate
          ? await tx.loyaltyLedger.findFirst({ where: { customerId: customer.id, type: "WELCOME" }, select: { id: true } })
          : null;
        if (rules.enabled && rules.welcomePoints > 0 && !existingWelcome) {
          await postLoyaltyEntry(tx, {
            customerId: customer.id,
            type: "WELCOME",
            deltaPoints: rules.welcomePoints,
            reason: "Welcome points",
            actorUserId: req.user?.id,
          });
        }
        await audit(archivedDuplicate ? "customer.restore" : "customer.create", "Customer", customer.id, {
          actorUserId: req.user?.id,
          before: archivedDuplicate || undefined,
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
      if ((e as { appCode?: string }).appCode === "duplicate_phone")
        return reply.code(409).send({ error: "duplicate_phone" });
      if ((e as { code?: string }).code === "P2002")
        return reply.code(409).send({ error: "duplicate_phone" });
      throw e;
    }
  });

  // Customer 360 timeline
  app.get("/customers/:id", { preHandler: authorize(...STAFF_ROLES) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const elevated = ["OWNER", "ADMIN"].includes(req.user!.role);
    const c = await prisma.customer.findFirst({
      where: { id, deletedAt: null, ...(!elevated ? { branchId: req.user!.branchId ?? "__none__" } : {}) },
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

  // Archive the CRM profile while retaining every related appointment,
  // invoice, ledger entry and historical visit for audit/recovery purposes.
  app.delete("/customers/:id", { preHandler: authorize("OWNER", "ADMIN", "MANAGER") }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (req.user!.role === "MANAGER" && !req.user!.branchId) {
      return reply.code(403).send({ error: "branch_required" });
    }
    const scopedWhere = {
      id,
      deletedAt: null,
      ...(req.user!.role === "MANAGER" ? { branchId: req.user!.branchId! } : {}),
    };

    const archived = await prisma.$transaction(async (tx) => {
      const current = await tx.customer.findFirst({
        where: scopedWhere,
        include: { user: { select: { id: true, role: true, isActive: true } } },
      });
      if (!current) return null;

      const deletedAt = new Date();
      await tx.customer.update({ where: { id: current.id }, data: { deletedAt } });
      const linkedCustomerUser = current.user?.role === "CUSTOMER" ? current.user : null;
      if (linkedCustomerUser) {
        await tx.user.update({ where: { id: linkedCustomerUser.id }, data: { isActive: false } });
        await tx.session.deleteMany({ where: { userId: linkedCustomerUser.id } });
      }
      await audit("customer.archive", "Customer", current.id, {
        actorUserId: req.user?.id,
        before: current,
        after: { deletedAt, customerAccessRevoked: Boolean(linkedCustomerUser) },
        ip: req.ip,
      }, tx);
      return current.id;
    });

    if (!archived) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });

  app.post("/customers/:id/companions", { preHandler: authorize("OWNER", "ADMIN", "MANAGER", "RECEPTION") }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = companionSchema.parse(req.body);
    const customer = await prisma.customer.findFirst({ where: { id, deletedAt: null } });
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
    const companion = await prisma.customerCompanion.findFirst({
      where: { id: companionId, customerId: id, deletedAt: null, customer: { deletedAt: null } },
      include: { customer: true },
    });
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
    const companion = await prisma.customerCompanion.findFirst({
      where: { id: companionId, customerId: id, deletedAt: null, customer: { deletedAt: null } },
      include: { customer: true },
    });
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
    const customer = await prisma.customer.findFirst({ where: { id, deletedAt: null } });
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
          ...(!customer.customerSince || body.visitedAt < customer.customerSince ? { customerSince: body.visitedAt } : {}),
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
      customerSince: customerSinceSchema.optional(),
    }).parse(req.body);
    const current = await prisma.customer.findFirst({ where: { id, deletedAt: null } });
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

  // CSV / Google-Sheet import with phone/email dedupe. If a matching archived
  // customer exists (for example an old WAHA/contact-sync row), revive it
  // instead of blocking the operator with a duplicate-phone error.
  app.post("/customers/import", { preHandler: authorize("OWNER", "ADMIN", "MANAGER") }, async (req, reply) => {
    const { branchId, csv } = z.object({ branchId: z.string(), csv: z.string().max(CUSTOMER_IMPORT_BODY_LIMIT) }).parse(req.body);
    if (!["OWNER", "ADMIN"].includes(req.user!.role) && req.user!.branchId !== branchId) return reply.code(403).send({ error: "forbidden" });
    const rows = parseCsv(csv);
    if (rows.length > CUSTOMER_IMPORT_ROW_LIMIT) return reply.code(413).send({ error: "too_many_rows", maxRows: CUSTOMER_IMPORT_ROW_LIMIT });
    let created = 0;
    let restored = 0;
    let skipped = 0;
    const loyaltyRules = await getLoyaltyRules(prisma, branchId);
    for (const r of rows) {
      const pk = phoneKey(r.phone);
      const phone = r.phone ? r.phone.replace(/\D/g, "") : undefined;
      const email = r.email?.toLowerCase() || undefined;
      const duplicateWhere = [
        ...(pk ? [{ phone: { endsWith: pk } }] : []),
        ...(email ? [{ email }] : []),
      ];
      const activeDup = duplicateWhere.length ? await prisma.customer.findFirst({
        where: {
          branchId,
          deletedAt: null,
          OR: duplicateWhere,
        },
        select: { id: true },
      }) : null;
      if (activeDup) { skipped++; continue; }
      const archivedDup = duplicateWhere.length ? await prisma.customer.findFirst({
        where: {
          branchId,
          deletedAt: { not: null },
          OR: duplicateWhere,
        },
      }) : null;
      await prisma.$transaction(async (tx) => {
        const imported = {
          branchId,
          name: r.name || r.customer || "Unknown",
          phone,
          email,
          source: r.source || "import",
          tags: r.tags ? r.tags.split(/[;|]/).map((t) => t.trim()).filter(Boolean) : [],
          waConsent: parseConsent(r.whatsapp_consent || r.wa_consent),
          emailConsent: parseConsent(r.email_consent),
          customerSince: r.customerSince || r.customer_since || r.since || r.date
            ? new Date(`${r.customerSince || r.customer_since || r.since || r.date}T12:00:00`)
            : undefined,
        };
        const customer = archivedDup
          ? await tx.customer.update({
              where: { id: archivedDup.id },
              data: { ...imported, deletedAt: null },
            })
          : await tx.customer.create({ data: imported });
        const existingWelcome = archivedDup
          ? await tx.loyaltyLedger.findFirst({ where: { customerId: customer.id, type: "WELCOME" }, select: { id: true } })
          : null;
        if (loyaltyRules.enabled && loyaltyRules.welcomePoints > 0 && !existingWelcome) {
          await postLoyaltyEntry(tx, {
            customerId: customer.id,
            type: "WELCOME",
            deltaPoints: loyaltyRules.welcomePoints,
            reason: "Welcome points",
            actorUserId: req.user?.id,
          });
        }
        if (archivedDup) {
          await audit("customer.restore", "Customer", customer.id, {
            actorUserId: req.user?.id,
            before: archivedDup,
            after: imported,
            ip: req.ip,
          }, tx);
        }
      });
      if (archivedDup) restored++;
      else created++;
    }
    return reply.send({ created, restored, skipped, total: rows.length });
  });

  app.get("/customers/export", { preHandler: authorize("OWNER", "ADMIN", "MANAGER") }, async (req, reply) => {
    const { branchId = "main" } = z.object({ branchId: z.string().optional() }).parse(req.query);
    if (!['OWNER', 'ADMIN'].includes(req.user!.role) && req.user!.branchId !== branchId) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const customers = await prisma.customer.findMany({
      where: { branchId, deletedAt: null },
      orderBy: [{ name: "asc" }, { createdAt: "asc" }],
      select: {
        name: true,
        phone: true,
        email: true,
        source: true,
        tags: true,
        customerSince: true,
        waConsent: true,
        emailConsent: true,
      },
    });
    return reply.send(customers);
  });
}
