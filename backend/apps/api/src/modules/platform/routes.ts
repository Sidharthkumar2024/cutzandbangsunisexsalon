import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@cutz/db";
import { authorize } from "../../plugins/auth.js";
import { audit } from "../../lib/audit.js";
import { hashPassword } from "../../lib/password.js";
import { getLoyaltyRules } from "../loyalty/ledger.js";

const OPERATIONS = ["OWNER", "ADMIN", "MANAGER", "RECEPTION", "STAFF"] as const;

export default async function platformRoutes(app: FastifyInstance) {
  app.get("/branches", { preHandler: authorize(...OPERATIONS) }, async (req) =>
    prisma.branch.findMany({ where: { deletedAt: null, ...(!["OWNER", "ADMIN"].includes(req.user?.role ?? "") ? { id: req.user?.branchId ?? "__none__" } : {}) }, orderBy: { name: "asc" } }),
  );

  app.post("/branches", { preHandler: authorize("OWNER", "ADMIN") }, async (req, reply) => {
    const body = z.object({ name: z.string().min(2), timezone: z.string().default("Asia/Kolkata"), currency: z.string().length(3).default("INR"), address: z.string().optional(), phone: z.string().optional(), latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional() }).parse(req.body);
    const branch = await prisma.branch.create({ data: body });
    await audit("branch.create", "Branch", branch.id, { actorUserId: req.user?.id, after: body, ip: req.ip });
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
        user: { select: { id: true, email: true, role: true, isActive: true } },
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
      commissionRate: z.number().int().min(0).max(10_000).optional(),
    }).parse(req.body);
    const staff = await prisma.staff.findUnique({ where: { id } });
    if (!staff) return reply.code(404).send({ error: "staff_not_found" });
    const duplicate = await prisma.user.findUnique({ where: { email: body.email } });
    if (duplicate && duplicate.id !== staff.userId) return reply.code(409).send({ error: "email_taken" });
    const passwordHash = await hashPassword(body.password);
    const user = staff.userId
      ? await prisma.user.update({ where: { id: staff.userId }, data: { email: body.email, passwordHash, role: body.role, branchId: staff.branchId, isActive: true } })
      : await prisma.user.create({ data: { email: body.email, passwordHash, role: body.role, branchId: staff.branchId, staff: { connect: { id: staff.id } } } });
    if (body.commissionRate !== undefined) await prisma.staff.update({ where: { id }, data: { commissionRate: body.commissionRate } });
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await audit("staff.account_set", "Staff", id, { actorUserId: req.user?.id, after: { userId: user.id, email: user.email, role: user.role, commissionRate: body.commissionRate }, ip: req.ip });
    return reply.code(staff.userId ? 200 : 201).send({ id: user.id, email: user.email, role: user.role });
  });

  // Customer portal: server-owned identity, never a customerId supplied by the browser.
  app.get("/portal/customer/overview", { preHandler: authorize("CUSTOMER") }, async (req, reply) => {
    const customer = await prisma.customer.findUnique({ where: { userId: req.user!.id }, include: { appointments: { where: { deletedAt: null }, orderBy: { startAt: "desc" }, take: 100, include: { items: { include: { service: true, staff: true } } } }, invoices: { orderBy: { createdAt: "desc" }, take: 100, include: { items: true, payments: true } }, memberships: { where: { isActive: true }, include: { plan: true, ledger: { orderBy: { createdAt: "desc" } } } }, servicePackages: { where: { isActive: true }, orderBy: { createdAt: "desc" }, include: { package: { include: { items: { include: { service: true } } } }, ledger: { orderBy: { createdAt: "asc" }, include: { service: true } } } }, walletLedger: { orderBy: { createdAt: "desc" }, take: 100 }, loyaltyLedger: { orderBy: { createdAt: "desc" }, take: 100 } } });
    if (!customer) return reply.code(404).send({ error: "customer_profile_not_found" });
    return { ...customer, loyaltyRules: await getLoyaltyRules(prisma, customer.branchId) };
  });

  app.post(
    "/portal/customer/appointments/:id/reschedule-request",
    { preHandler: authorize("CUSTOMER") },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { note } = z.object({ note: z.string().trim().max(500).optional() }).parse(req.body);
      const customer = await prisma.customer.findUnique({
        where: { userId: req.user!.id },
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
