import { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "@cutz/db";
import { staffInvitationEmail } from "@cutz/providers";
import { enqueueEmail } from "@cutz/queue";
import { authorize, hashToken, WORKSPACE_PERMISSIONS } from "../../plugins/auth.js";
import { audit } from "../../lib/audit.js";
import { hashPassword } from "../../lib/password.js";
import { resolveTenantScope } from "../../lib/tenant-scope.js";
import { getLoyaltyRules } from "../loyalty/ledger.js";

const OPERATIONS = ["OWNER", "ADMIN", "MANAGER", "RECEPTION", "STAFF"] as const;
const slugify = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 60);

export default async function platformRoutes(app: FastifyInstance) {
  app.get("/tenants", { preHandler: authorize("SUPERADMIN", "OWNER", "ADMIN", "MANAGER", "RECEPTION", "STAFF") }, async (req) => {
    if (req.user!.role === "SUPERADMIN") {
      return prisma.tenant.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        include: { plan: true, branches: { where: { deletedAt: null }, orderBy: { name: "asc" } } },
      });
    }
    const memberships = await prisma.tenantMembership.findMany({
      where: { userId: req.user!.id, isActive: true, tenant: { deletedAt: null } },
      orderBy: { createdAt: "asc" },
      include: { tenant: { include: { plan: true, branches: { where: { deletedAt: null }, orderBy: { name: "asc" } } } } },
    });
    return memberships.map((membership) => ({ ...membership.tenant, membershipRole: membership.role, membershipBranchId: membership.branchId }));
  });

  app.post("/tenants", { preHandler: authorize("SUPERADMIN") }, async (req, reply) => {
    const body = z.object({
      name: z.string().min(2),
      slug: z.string().min(2).optional(),
      ownerEmail: z.string().email().optional(),
      planSlug: z.string().default("starter"),
      timezone: z.string().default("Asia/Kolkata"),
      currency: z.string().length(3).default("INR"),
      branchName: z.string().min(2).optional(),
    }).parse(req.body);
    const plan = await prisma.plan.findUnique({ where: { slug: body.planSlug } });
    if (!plan) return reply.code(400).send({ error: "plan_not_found" });
    const slug = slugify(body.slug ?? body.name);
    if (!slug) return reply.code(400).send({ error: "invalid_slug" });
    const tenant = await prisma.$transaction(async (tx) => {
      const created = await tx.tenant.create({
        data: { name: body.name, slug, status: "TRIAL", planId: plan.id, timezone: body.timezone, currency: body.currency },
      });
      const branch = await tx.branch.create({
        data: { tenantId: created.id, name: body.branchName ?? `${body.name} — Main`, timezone: body.timezone, currency: body.currency },
      });
      if (body.ownerEmail) {
        const owner = await tx.user.upsert({
          where: { email: body.ownerEmail.toLowerCase() },
          create: { email: body.ownerEmail.toLowerCase(), role: "OWNER", activeTenantId: created.id, branchId: branch.id },
          update: { role: "OWNER", activeTenantId: created.id, branchId: branch.id, isActive: true },
        });
        await tx.tenant.update({ where: { id: created.id }, data: { ownerUserId: owner.id } });
        await tx.tenantMembership.create({ data: { tenantId: created.id, userId: owner.id, role: "OWNER", branchId: branch.id } });
      }
      return tx.tenant.findUniqueOrThrow({ where: { id: created.id }, include: { plan: true, branches: true, ownerUser: { select: { id: true, email: true } } } });
    });
    await audit("tenant.create", "Tenant", tenant.id, { actorUserId: req.user?.id, after: { name: body.name, slug, planId: plan.id }, ip: req.ip });
    return reply.code(201).send(tenant);
  });

  app.get("/branches", { preHandler: authorize(...OPERATIONS) }, async (req, reply) => {
    const { tenantId } = req.query as Record<string, string>;
    const scope = await resolveTenantScope(req.user!, tenantId);
    if (!scope.ok) return reply.code(scope.statusCode).send({ error: scope.error });
    return prisma.branch.findMany({ where: { tenantId: scope.tenantId, deletedAt: null, ...(!["OWNER", "ADMIN"].includes(req.user?.role ?? "") ? { id: req.user?.branchId ?? "__none__" } : {}) }, orderBy: { name: "asc" } });
  });

  app.post("/branches", { preHandler: authorize("OWNER", "ADMIN") }, async (req, reply) => {
    const body = z.object({ tenantId: z.string().optional(), name: z.string().min(2), timezone: z.string().default("Asia/Kolkata"), currency: z.string().length(3).default("INR"), address: z.string().optional(), phone: z.string().optional(), latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional() }).parse(req.body);
    const scope = await resolveTenantScope(req.user!, body.tenantId);
    if (!scope.ok) return reply.code(scope.statusCode).send({ error: scope.error });
    const { tenantId: _tenantId, ...branchData } = body;
    const branch = await prisma.branch.create({ data: { ...branchData, tenantId: scope.tenantId } });
    await audit("branch.create", "Branch", branch.id, { actorUserId: req.user?.id, after: { tenantId: scope.tenantId, ...branchData }, ip: req.ip });
    return reply.code(201).send(branch);
  });

  app.patch("/branches/:id", { preHandler: authorize("OWNER", "ADMIN") }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ name: z.string().min(2).optional(), timezone: z.string().optional(), currency: z.string().length(3).optional(), address: z.string().nullable().optional(), phone: z.string().nullable().optional(), latitude: z.number().min(-90).max(90).nullable().optional(), longitude: z.number().min(-180).max(180).nullable().optional() }).parse(req.body);
    const before = await prisma.branch.findUnique({ where: { id } });
    if (!before) return reply.code(404).send({ error: "not_found" });
    const branch = await prisma.branch.update({ where: { id }, data: body });
    await audit("branch.update", "Branch", id, { actorUserId: req.user?.id, before, after: body, ip: req.ip });
    return branch;
  });

  app.get("/settings/:branchId", { preHandler: authorize(...OPERATIONS) }, async (req) => {
    const { branchId } = req.params as { branchId: string };
    if (!["OWNER", "ADMIN"].includes(req.user?.role ?? "") && req.user?.branchId !== branchId) return {};
    const prefix = `branch:${branchId}:`;
    const rows = await prisma.setting.findMany({ where: { key: { startsWith: prefix } } });
    return Object.fromEntries(rows.map(row => [row.key.slice(prefix.length), row.value]));
  });

  app.put("/settings/:branchId/:name", { preHandler: authorize("OWNER", "ADMIN", "MANAGER") }, async (req, reply) => {
    const { branchId, name } = req.params as { branchId: string; name: string };
    if (name === "providers") return reply.code(400).send({ error: "use_secure_provider_config_route" });
    if (req.user?.role === "MANAGER" && req.user.branchId !== branchId) return reply.code(403).send({ error: "forbidden" });
    const value = z.record(z.unknown()).parse(req.body);
    const key = `branch:${branchId}:${name}`;
    const before = await prisma.setting.findUnique({ where: { key } });
    const setting = await prisma.setting.upsert({ where: { key }, create: { key, value: value as any }, update: { value: value as any } });
    await audit("setting.update", "Setting", key, { actorUserId: req.user?.id, before: before?.value, after: value, ip: req.ip });
    return setting;
  });

  app.get("/audit-logs", { preHandler: authorize("OWNER", "ADMIN") }, async (req) => {
    const { entityType, entityId, action, from, take = "100" } = req.query as Record<string, string>;
    return prisma.auditLog.findMany({
      where: {
        ...(entityType ? { entityType } : {}),
        ...(entityId ? { entityId } : {}),
        ...(action ? { action: { contains: action, mode: "insensitive" as const } } : {}),
        ...(from ? { createdAt: { gte: new Date(from) } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(500, Math.max(1, Number(take) || 100)),
      include: { actor: { select: { id: true, email: true, role: true } } },
    });
  });

  app.get("/team-accounts", { preHandler: authorize("OWNER", "ADMIN", "MANAGER") }, async (req) =>
    prisma.staff.findMany({
      where: { deletedAt: null, ...(req.user?.role === "MANAGER" ? { branchId: req.user.branchId ?? "__none__" } : {}) },
      orderBy: { displayName: "asc" },
      include: {
        user: { select: { id: true, email: true, role: true, isActive: true, permissionKeys: true } },
        invites: { where: { acceptedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true, email: true, role: true, permissionKeys: true, expiresAt: true, createdAt: true } },
        shifts: { orderBy: [{ weekday: "asc" }, { startMin: "asc" }] },
        leaves: { orderBy: { startDate: "desc" }, take: 20 },
      },
    }),
  );

  app.get(
    "/notifications",
    { preHandler: authorize("OWNER", "ADMIN", "MANAGER", "RECEPTION", "STAFF") },
    async (req) =>
      prisma.notification.findMany({
        where: { userId: req.user!.id },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
  );

  app.post(
    "/notifications/:id/read",
    { preHandler: authorize("OWNER", "ADMIN", "MANAGER", "RECEPTION", "STAFF") },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const notification = await prisma.notification.findUnique({ where: { id } });
      if (!notification) return reply.code(404).send({ error: "notification_not_found" });
      if (notification.userId !== req.user!.id) return reply.code(403).send({ error: "forbidden" });
      return prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
    },
  );

  app.post("/staff/:id/account", { preHandler: authorize("OWNER", "ADMIN") }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      email: z.string().email(),
      password: z.string().min(10),
      role: z.enum(["MANAGER", "RECEPTION", "STAFF"]).default("STAFF"),
      permissionKeys: z.array(z.enum(WORKSPACE_PERMISSIONS)).max(WORKSPACE_PERMISSIONS.length).default([]),
      commissionRate: z.number().int().min(0).max(10_000).optional(),
    }).parse(req.body);
    const staff = await prisma.staff.findUnique({ where: { id } });
    if (!staff) return reply.code(404).send({ error: "staff_not_found" });
    const duplicate = await prisma.user.findUnique({ where: { email: body.email } });
    if (duplicate && duplicate.id !== staff.userId) return reply.code(409).send({ error: "email_taken" });
    const passwordHash = await hashPassword(body.password);
    const user = staff.userId
      ? await prisma.user.update({ where: { id: staff.userId }, data: { email: body.email, passwordHash, role: body.role, permissionKeys: { set: body.permissionKeys }, branchId: staff.branchId, isActive: true } })
      : await prisma.user.create({ data: { email: body.email, passwordHash, role: body.role, permissionKeys: body.permissionKeys, branchId: staff.branchId, staff: { connect: { id: staff.id } } } });
    if (body.commissionRate !== undefined) await prisma.staff.update({ where: { id }, data: { commissionRate: body.commissionRate } });
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await audit("staff.account_set", "Staff", id, { actorUserId: req.user?.id, after: { userId: user.id, email: user.email, role: user.role, commissionRate: body.commissionRate }, ip: req.ip });
    return reply.code(staff.userId ? 200 : 201).send({ id: user.id, email: user.email, role: user.role, permissionKeys: user.permissionKeys });
  });

  app.post("/staff/:id/invite", { preHandler: authorize("OWNER", "ADMIN") }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      email: z.string().email(),
      role: z.enum(["ADMIN", "MANAGER", "RECEPTION", "STAFF"]).default("STAFF"),
      permissionKeys: z.array(z.enum(WORKSPACE_PERMISSIONS)).max(WORKSPACE_PERMISSIONS.length).default([]),
      commissionRate: z.number().int().min(0).max(10_000).optional(),
    }).parse(req.body);
    if (body.role === "ADMIN" && req.user?.role !== "OWNER") return reply.code(403).send({ error: "only_owner_can_grant_admin" });
    const email = body.email.trim().toLowerCase();
    const staff = await prisma.staff.findFirst({ where: { id, deletedAt: null } });
    if (!staff) return reply.code(404).send({ error: "staff_not_found" });
    const duplicate = await prisma.user.findUnique({ where: { email }, include: { staff: { select: { id: true } } } });
    if (duplicate?.staff && duplicate.staff.id !== id) return reply.code(409).send({ error: "email_taken" });
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 48 * 60 * 60_000);
    const invite = await prisma.$transaction(async (tx) => {
      let userId = staff.userId;
      if (duplicate && !userId) userId = duplicate.id;
      if (!userId) {
        const account = await tx.user.create({ data: { email, role: body.role, permissionKeys: body.permissionKeys, branchId: staff.branchId, isActive: false } });
        userId = account.id;
      } else {
        await tx.user.update({ where: { id: userId }, data: { email, role: body.role, permissionKeys: { set: body.permissionKeys }, branchId: staff.branchId, isActive: false } });
        await tx.session.deleteMany({ where: { userId } });
      }
      await tx.staff.update({ where: { id }, data: { userId, ...(body.commissionRate === undefined ? {} : { commissionRate: body.commissionRate }) } });
      await tx.staffInvite.updateMany({ where: { staffId: id, acceptedAt: null }, data: { acceptedAt: new Date() } });
      const created = await tx.staffInvite.create({ data: { staffId: id, email, role: body.role, permissionKeys: body.permissionKeys, tokenHash: hashToken(token), expiresAt, invitedByUserId: req.user?.id } });
      await audit("staff.invite.send", "Staff", id, { actorUserId: req.user?.id, after: { email, role: body.role, permissionKeys: body.permissionKeys, expiresAt }, ip: req.ip }, tx);
      return created;
    });
    const baseUrl = (process.env.PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/u, "");
    const acceptUrl = `${baseUrl}/staff/accept-invite?token=${encodeURIComponent(token)}`;
    await enqueueEmail({
      branchId: staff.branchId,
      to: email,
      subject: "Your Cutz & Bangs team invitation",
      html: staffInvitationEmail({ name: staff.displayName, role: body.role, acceptUrl, expiresAt }),
      dedupeKey: `staff-invite:${invite.id}`,
    });
    return reply.code(201).send({ invited: true, id: invite.id, email, role: body.role, permissionKeys: body.permissionKeys, expiresAt });
  });

  // Customer portal: server-owned identity, never a customerId supplied by the browser.
  app.get("/portal/customer/overview", { preHandler: authorize("CUSTOMER") }, async (req, reply) => {
    const customer = await prisma.customer.findFirst({ where: { userId: req.user!.id, deletedAt: null }, include: { appointments: { where: { deletedAt: null }, orderBy: { startAt: "desc" }, take: 100, include: { items: { include: { service: true, staff: true } } } }, invoices: { orderBy: { createdAt: "desc" }, take: 100, include: { items: true, payments: true } }, memberships: { where: { isActive: true }, include: { plan: true, ledger: { orderBy: { createdAt: "desc" } } } }, servicePackages: { where: { isActive: true }, orderBy: { createdAt: "desc" }, include: { package: { include: { items: { include: { service: true } } } }, ledger: { orderBy: { createdAt: "asc" }, include: { service: true } } } }, walletLedger: { orderBy: { createdAt: "desc" }, take: 100 }, loyaltyLedger: { orderBy: { createdAt: "desc" }, take: 100 } } });
    if (!customer) return reply.code(404).send({ error: "customer_profile_not_found" });
    return { ...customer, loyaltyRules: await getLoyaltyRules(prisma, customer.branchId) };
  });

  // Backward-compatible alias for older frontend paths.
  app.get("/platform/portal/customer/overview", { preHandler: authorize("CUSTOMER") }, async (req, reply) => {
    const customer = await prisma.customer.findFirst({ where: { userId: req.user!.id, deletedAt: null }, include: { appointments: { where: { deletedAt: null }, orderBy: { startAt: "desc" }, take: 100, include: { items: { include: { service: true, staff: true } } } }, invoices: { orderBy: { createdAt: "desc" }, take: 100, include: { items: true, payments: true } }, memberships: { where: { isActive: true }, include: { plan: true, ledger: { orderBy: { createdAt: "desc" } } } }, servicePackages: { where: { isActive: true }, orderBy: { createdAt: "desc" }, include: { package: { include: { items: { include: { service: true } } } }, ledger: { orderBy: { createdAt: "asc" }, include: { service: true } } } }, walletLedger: { orderBy: { createdAt: "desc" }, take: 100 }, loyaltyLedger: { orderBy: { createdAt: "desc" }, take: 100 } } });
    if (!customer) return reply.code(404).send({ error: "customer_profile_not_found" });
    return { ...customer, loyaltyRules: await getLoyaltyRules(prisma, customer.branchId) };
  });

  app.post(
    "/portal/customer/appointments/:id/reschedule-request",
    { preHandler: authorize("CUSTOMER") },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { note } = z.object({ note: z.string().trim().max(500).optional() }).parse(req.body);
      const customer = await prisma.customer.findFirst({
        where: { userId: req.user!.id, deletedAt: null },
        select: { id: true, name: true, branchId: true },
      });
      if (!customer) return reply.code(404).send({ error: "customer_profile_not_found" });
      const appointment = await prisma.appointment.findFirst({
        where: { id, customerId: customer.id, deletedAt: null },
        include: { items: { include: { service: { select: { name: true } } } } },
      });
      if (!appointment) return reply.code(404).send({ error: "appointment_not_found" });
      if (["COMPLETED", "CANCELLED", "NO_SHOW"].includes(appointment.status)) {
        return reply.code(409).send({ error: "cannot_reschedule_terminal_appointment" });
      }
      const existing = await prisma.appointmentEvent.findFirst({
        where: { appointmentId: id, type: "reschedule_request", createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      });
      if (existing) return reply.code(409).send({ error: "reschedule_request_already_sent" });
      const team = await prisma.user.findMany({
        where: { branchId: customer.branchId, role: { in: ["OWNER", "ADMIN", "MANAGER", "RECEPTION"] }, isActive: true },
        select: { id: true },
      });
      const serviceNames = appointment.items.map((item) => item.service.name).join(", ");
      const event = await prisma.$transaction(async (tx) => {
        const created = await tx.appointmentEvent.create({
          data: { appointmentId: id, type: "reschedule_request", actorUserId: req.user!.id, meta: { note: note || null } },
        });
        if (team.length) {
          await tx.notification.createMany({
            data: team.map((user) => ({
              userId: user.id,
              title: `Reschedule request · ${customer.name}`,
              body: `${serviceNames || "Appointment"} · ${appointment.startAt.toISOString()}${note ? ` · ${note}` : ""}`,
            })),
          });
        }
        return created;
      });
      await audit("appointment.reschedule_request", "Appointment", id, {
        actorUserId: req.user?.id,
        after: { customerId: customer.id, note: note || null },
        ip: req.ip,
      });
      return reply.code(201).send({ requested: true, eventId: event.id });
    },
  );

  // Staff portal: own schedule, customer context and commission only.
  app.get("/portal/staff/my-day", { preHandler: authorize("STAFF") }, async (req, reply) => {
    const { from, to } = req.query as Record<string, string>;
    const start = from ? new Date(from) : new Date(new Date().setUTCHours(0, 0, 0, 0));
    const end = to ? new Date(to) : new Date(start.getTime() + 86_400_000);
    const staff = await prisma.staff.findUnique({ where: { userId: req.user!.id }, include: { shifts: { orderBy: [{ weekday: "asc" }, { startMin: "asc" }] }, leaves: { orderBy: { startDate: "desc" }, take: 30 } } });
    if (!staff) return reply.code(404).send({ error: "staff_profile_not_found" });
    const [appointments, attendance, invoiceItems, notifications, membershipsSold, packagesSold] = await Promise.all([
      prisma.appointment.findMany({ where: { deletedAt: null, startAt: { gte: start, lt: end }, items: { some: { staffId: staff.id } } }, orderBy: { startAt: "asc" }, include: { customer: { select: { id: true, name: true, phone: true, notes: true, tags: true } }, items: { where: { staffId: staff.id }, include: { service: true } } } }),
      prisma.attendance.findMany({ where: { staffId: staff.id, createdAt: { gte: start, lt: end } }, orderBy: { createdAt: "desc" } }),
      prisma.invoiceItem.findMany({ where: { staffId: staff.id, invoice: { createdAt: { gte: start, lt: end }, status: { not: "VOID" } } } }),
      prisma.notification.findMany({ where: { userId: req.user!.id, readAt: null }, orderBy: { createdAt: "desc" }, take: 50 }),
      prisma.membership.count({ where: { soldByStaffId: staff.id, createdAt: { gte: start, lt: end } } }),
      prisma.customerServicePackage.count({ where: { soldByStaffId: staff.id, createdAt: { gte: start, lt: end } } }),
    ]);
    const serviceRevenueMinor = invoiceItems.filter(item => item.kind === "service").reduce((sum, item) => sum + item.lineTotalMinor, 0);
    const productItems = invoiceItems.filter(item => item.kind === "product" && item.productId);
    const products = await prisma.product.findMany({ where: { id: { in: productItems.map(item => item.productId!) } }, select: { id: true, commissionBps: true } });
    const productCommission = new Map(products.map(product => [product.id, product.commissionBps]));
    const productRevenueMinor = productItems.reduce((sum, item) => sum + item.lineTotalMinor, 0);
    const serviceCommissionMinor = serviceRevenueMinor >= staff.commissionThresholdMinor ? Math.round(serviceRevenueMinor * staff.commissionRate / 10_000) : 0;
    const productCommissionMinor = productItems.reduce((sum, item) => sum + Math.round(item.lineTotalMinor * (productCommission.get(item.productId!) ?? 0) / 10_000), 0);
    return { staff, appointments, attendance, notifications, performance: { serviceRevenueMinor, productRevenueMinor, commissionRateBps: staff.commissionRate, commissionThresholdMinor: staff.commissionThresholdMinor, serviceCommissionMinor, productCommissionMinor, estimatedCommissionMinor: serviceCommissionMinor + productCommissionMinor, membershipsSold, packagesSold } };
  });
}
