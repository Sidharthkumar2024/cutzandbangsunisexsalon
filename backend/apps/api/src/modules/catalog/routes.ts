import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@cutz/db";
import { authorize } from "../../plugins/auth.js";
import { minutesInTz, overlaps, resolveBooking, SlotRequest, SlotUnavailableError } from "../bookings/availability.js";
import { audit } from "../../lib/audit.js";

const ADMIN = ["OWNER", "ADMIN", "MANAGER"] as const;

export default async function catalogRoutes(app: FastifyInstance) {
  // ---- Public read endpoints (for the website) ----
  app.get("/services", async (req) => {
    const { branchId } = req.query as Record<string, string>;
    return prisma.serviceCategory.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        parent: { select: { id: true, name: true, gender: true, parentId: true, sortOrder: true } },
        children: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, gender: true, parentId: true, sortOrder: true } },
        services: {
          where: { isActive: true, deletedAt: null },
          include: { serviceStaff: { include: { staff: { select: { id: true, displayName: true } } } } },
          orderBy: [{ name: "asc" }],
        },
      },
    });
  });

  app.get("/staff", async (req) => {
    const { branchId, serviceId } = req.query as Record<string, string>;
    return prisma.staff.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        ...(branchId ? { branchId } : {}),
        ...(serviceId ? { serviceStaff: { some: { serviceId } } } : {}),
      },
      select: { id: true, displayName: true, branchId: true },
    });
  });

  // ---- Availability: free start-times for a staff+service on a date ----
  app.get("/availability", async (req, reply) => {
    const parsed = z
      .object({ branchId: z.string(), serviceId: z.string(), staffId: z.string(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
      .safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_query", issues: parsed.error.issues.map((issue) => issue.message) });
    }
    const { branchId, serviceId, staffId, date } = parsed.data;

    const [branch, service, staff] = await Promise.all([
      prisma.branch.findFirst({ where: { id: branchId, deletedAt: null } }),
      prisma.service.findFirst({ where: { id: serviceId, isActive: true, deletedAt: null } }),
      prisma.staff.findFirst({ where: { id: staffId, branchId, isActive: true, deletedAt: null, serviceStaff: { some: { serviceId } } }, select: { id: true } }),
    ]);
    if (!branch || !service || !staff) return reply.code(404).send({ error: "not_found" });

    // Day window in salon tz -> generate candidate 15-min slots.
    const dayStart = new Date(`${date}T00:00:00`);
    const weekday = minutesInTz(dayStart, branch.timezone).weekday;
    const shifts = await prisma.shift.findMany({ where: { staffId, weekday } });
    if (!shifts.length) return { slots: [] };

    const existing = await prisma.appointmentItem.findMany({
      where: {
        staffId,
        appointment: { status: { in: ["PENDING", "CONFIRMED", "CHECKED_IN", "IN_SERVICE", "COMPLETED"] }, deletedAt: null },
        startAt: { gte: new Date(`${date}T00:00:00Z`), lt: new Date(`${date}T23:59:59Z`) },
      },
      select: { startAt: true, endAt: true },
    });

    const step = 15;
    const need = service.durationMin;
    const slots: string[] = [];
    for (const s of shifts) {
      for (let m = s.startMin; m + need <= s.endMin; m += step) {
        if (s.breakStartMin != null && s.breakEndMin != null && m < s.breakEndMin && s.breakStartMin < m + need) continue;
        // Build a UTC instant for this local minute on the given date.
        const iso = `${date}T${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00`;
        const startAt = zonedToUtc(iso, branch.timezone);
        const endAt = new Date(startAt.getTime() + (need + service.bufferMin) * 60_000);
        const clash = existing.some((e) => overlaps(startAt, endAt, e.startAt, e.endAt));
        if (!clash && startAt > new Date()) slots.push(startAt.toISOString());
      }
    }
    return { slots };
  });

  // Conflict-free starts for a complete multi-service visit. Services run
  // sequentially for the customer, while each service can use a different
  // eligible staff member. The final booking still repeats these checks in a
  // SERIALIZABLE transaction, so this read endpoint is advisory rather than a
  // concurrency guarantee.
  app.post("/availability/multi", async (req, reply) => {
    const body = z
      .object({
        branchId: z.string(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        items: z.array(z.object({ serviceId: z.string(), staffId: z.string() })).min(1).max(8),
      })
      .parse(req.body);
    if (req.user?.role === "MANAGER" && req.user.branchId !== body.branchId) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const branch = await prisma.branch.findUnique({ where: { id: body.branchId } });
    if (!branch) return reply.code(404).send({ error: "branch_not_found" });

    const services = await prisma.service.findMany({
      where: { id: { in: body.items.map((item) => item.serviceId) }, isActive: true, deletedAt: null },
      select: { id: true, durationMin: true, bufferMin: true },
    });
    const byId = new Map(services.map((service) => [service.id, service]));
    if (body.items.some((item) => !byId.has(item.serviceId))) {
      return reply.code(400).send({ error: "service_unavailable" });
    }

    const candidates = Array.from({ length: 45 }, (_, index) => 9 * 60 + index * 15);
    const checks = await Promise.all(candidates.map(async (minute) => {
      const startAt = zonedToUtc(`${body.date}T${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}:00`, branch.timezone);
      if (startAt <= new Date()) return null;
      const requests: SlotRequest[] = [];
      let cursor = startAt;
      for (const item of body.items) {
        requests.push({ ...item, startAt: cursor });
        const service = byId.get(item.serviceId)!;
        cursor = new Date(cursor.getTime() + (service.durationMin + service.bufferMin) * 60_000);
      }
      try {
        await resolveBooking(prisma, body.branchId, branch.timezone, requests);
        return startAt.toISOString();
      } catch (error) {
        if (error instanceof SlotUnavailableError) return null;
        throw error;
      }
    }));

    return { timezone: branch.timezone, slots: checks.filter((slot): slot is string => Boolean(slot)).slice(0, 32) };
  });

  // ---- Admin CRUD ----
  app.post("/services", { preHandler: authorize(...ADMIN) }, async (req, reply) => {
    const body = z
      .object({
        categoryId: z.string(),
        name: z.string().trim().min(2).max(100),
        durationMin: z.number().int().positive(),
        bufferMin: z.number().int().nonnegative().default(0),
        priceMinor: z.number().int().nonnegative(),
        taxRateBps: z.number().int().nonnegative().default(0),
        staffIds: z.array(z.string()).default([]),
      })
      .parse(req.body);
    const { staffIds, ...serviceData } = body;
    const category = await prisma.serviceCategory.findUnique({ where: { id: body.categoryId } });
    if (!category) return reply.code(400).send({ error: "category_not_found" });
    const validStaff = await prisma.staff.findMany({ where: { id: { in: staffIds }, deletedAt: null, ...(req.user?.role === "MANAGER" ? { branchId: req.user.branchId ?? "__none__" } : {}) }, select: { id: true } });
    if (validStaff.length !== new Set(staffIds).size) return reply.code(400).send({ error: "staff_not_found" });
    const service = await prisma.service.create({ data: { ...serviceData, serviceStaff: { create: staffIds.map((staffId) => ({ staffId })) }, staffSkills: { create: staffIds.map((staffId) => ({ staffId })) } } });
    await audit("service.create", "Service", service.id, { actorUserId: req.user?.id, after: body, ip: req.ip });
    return reply.code(201).send(service);
  });

  app.post("/service-categories", { preHandler: authorize(...ADMIN) }, async (req, reply) => {
    const body = z.object({
      name: z.string().trim().min(2).max(80),
      gender: z.enum(["Male", "Female", "Unisex", "Kids - Unisex", "Boys", "Girls", "Baby Boy", "Baby Girl"]).nullable().optional(),
      parentId: z.string().nullable().optional(),
      sortOrder: z.number().int().min(0).default(0),
    }).parse(req.body);
    if (body.parentId && !(await prisma.serviceCategory.findUnique({ where: { id: body.parentId } }))) {
      return reply.code(400).send({ error: "parent_category_not_found" });
    }
    const category = await prisma.serviceCategory.create({ data: body });
    await audit("service_category.create", "ServiceCategory", category.id, { actorUserId: req.user?.id, after: body, ip: req.ip });
    return reply.code(201).send(category);
  });

  app.patch("/service-categories/:id", { preHandler: authorize(...ADMIN) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      name: z.string().trim().min(2).max(80).optional(),
      gender: z.enum(["Male", "Female", "Unisex", "Kids - Unisex", "Boys", "Girls", "Baby Boy", "Baby Girl"]).nullable().optional(),
      parentId: z.string().nullable().optional(),
      sortOrder: z.number().int().min(0).optional(),
    }).parse(req.body);
    const before = await prisma.serviceCategory.findUnique({ where: { id } });
    if (!before) return reply.code(404).send({ error: "category_not_found" });
    if (body.parentId === id) return reply.code(400).send({ error: "category_cannot_parent_itself" });
    if (body.parentId && !(await prisma.serviceCategory.findUnique({ where: { id: body.parentId } }))) {
      return reply.code(400).send({ error: "parent_category_not_found" });
    }
    const category = await prisma.serviceCategory.update({ where: { id }, data: body });
    await audit("service_category.update", "ServiceCategory", id, { actorUserId: req.user?.id, before, after: body, ip: req.ip });
    return category;
  });

  app.delete("/service-categories/:id", { preHandler: authorize(...ADMIN) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const category = await prisma.serviceCategory.findUnique({ where: { id }, include: { _count: { select: { services: true, children: true } } } });
    if (!category) return reply.code(404).send({ error: "category_not_found" });
    if (category._count.services > 0) return reply.code(409).send({ error: "category_has_services" });
    if (category._count.children > 0) return reply.code(409).send({ error: "category_has_subcategories" });
    await prisma.serviceCategory.delete({ where: { id } });
    await audit("service_category.delete", "ServiceCategory", id, { actorUserId: req.user?.id, before: category, ip: req.ip });
    return reply.code(204).send();
  });

  app.patch("/services/:id", { preHandler: authorize(...ADMIN) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      categoryId: z.string().optional(),
      name: z.string().trim().min(2).max(100).optional(),
      durationMin: z.number().int().positive().optional(),
      bufferMin: z.number().int().nonnegative().optional(),
      priceMinor: z.number().int().nonnegative().optional(),
      taxRateBps: z.number().int().nonnegative().optional(),
      isActive: z.boolean().optional(),
      staffIds: z.array(z.string()).optional(),
    }).parse(req.body);
    const before = await prisma.service.findFirst({ where: { id, deletedAt: null }, include: { serviceStaff: true } });
    if (!before) return reply.code(404).send({ error: "service_not_found" });
    if (body.categoryId && !(await prisma.serviceCategory.findUnique({ where: { id: body.categoryId } }))) {
      return reply.code(400).send({ error: "category_not_found" });
    }
    if (body.staffIds) {
      const validStaff = await prisma.staff.findMany({ where: { id: { in: body.staffIds }, deletedAt: null, ...(req.user?.role === "MANAGER" ? { branchId: req.user.branchId ?? "__none__" } : {}) }, select: { id: true } });
      if (validStaff.length !== new Set(body.staffIds).size) return reply.code(400).send({ error: "staff_not_found" });
    }
    const { staffIds, ...serviceData } = body;
    const service = await prisma.$transaction(async (tx) => {
      if (staffIds) {
        await tx.serviceStaff.deleteMany({ where: { serviceId: id } });
        await tx.staffSkill.deleteMany({ where: { serviceId: id } });
      }
      return tx.service.update({
        where: { id },
        data: {
          ...serviceData,
          ...(staffIds ? { serviceStaff: { create: staffIds.map((staffId) => ({ staffId })) }, staffSkills: { create: staffIds.map((staffId) => ({ staffId })) } } : {}),
        },
      });
    });
    await audit("service.update", "Service", id, { actorUserId: req.user?.id, before, after: body, ip: req.ip });
    return service;
  });

  app.delete("/services/:id", { preHandler: authorize(...ADMIN) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const before = await prisma.service.findFirst({ where: { id, deletedAt: null } });
    if (!before) return reply.code(404).send({ error: "service_not_found" });
    const service = await prisma.service.update({ where: { id }, data: { isActive: false, deletedAt: new Date() } });
    await audit("service.archive", "Service", id, { actorUserId: req.user?.id, before, after: { isActive: false }, ip: req.ip });
    return service;
  });

  app.post("/staff", { preHandler: authorize(...ADMIN) }, async (req, reply) => {
    const body = z
      .object({
        branchId: z.string(),
        displayName: z.string().trim().min(2).max(120),
        phone: z.string().optional(),
        designation: z.string().trim().min(2).max(100).default("Stylist"),
        baseSalaryMinor: z.number().int().nonnegative().default(0),
        commissionRate: z.number().int().nonnegative().default(0),
        commissionThresholdMinor: z.number().int().nonnegative().default(0),
        lateGraceMinutes: z.number().int().min(0).max(180).default(10),
        lateDeductionMinor: z.number().int().nonnegative().default(0),
        halfDayAfterMinutes: z.number().int().min(30).max(720).default(240),
        overtimePaid: z.boolean().default(false),
        biometricCode: z.string().trim().min(1).max(80).optional(),
        weeklyOff: z.array(z.number().int().min(0).max(6)).max(7).default([]),
        shifts: z.array(z.object({ weekday: z.number().int().min(0).max(6), startMin: z.number().int().min(0).max(1439), endMin: z.number().int().min(1).max(1440) }).refine((shift) => shift.endMin > shift.startMin)).default([]),
        serviceIds: z.array(z.string()).default([]),
      })
      .parse(req.body);
    if (req.user!.role === "MANAGER" && req.user!.branchId !== body.branchId) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const staff = await prisma.staff.create({
      data: {
        branchId: body.branchId,
        displayName: body.displayName,
        phone: body.phone,
        designation: body.designation,
        baseSalaryMinor: body.baseSalaryMinor,
        commissionRate: body.commissionRate,
        commissionThresholdMinor: body.commissionThresholdMinor,
        lateGraceMinutes: body.lateGraceMinutes,
        lateDeductionMinor: body.lateDeductionMinor,
        halfDayAfterMinutes: body.halfDayAfterMinutes,
        overtimePaid: body.overtimePaid,
        biometricCode: body.biometricCode,
        weeklyOff: body.weeklyOff,
        shifts: { create: body.shifts },
        skills: { create: body.serviceIds.map((serviceId) => ({ serviceId })) },
        serviceStaff: { create: body.serviceIds.map((serviceId) => ({ serviceId })) },
      },
    });
    await audit("staff.create", "Staff", staff.id, {
      actorUserId: req.user?.id,
      after: { ...body },
      ip: req.ip,
    });
    return reply.code(201).send(staff);
  });
}

/** Convert a wall-clock time in an IANA tz to the correct UTC Date. */
function zonedToUtc(isoNoZone: string, timeZone: string): Date {
  // Interpret the naive string as UTC, then correct by the tz offset at that instant.
  const asUtc = new Date(isoNoZone + "Z");
  const local = new Date(asUtc.toLocaleString("en-US", { timeZone }));
  const utcEcho = new Date(asUtc.toLocaleString("en-US", { timeZone: "UTC" }));
  const offset = local.getTime() - utcEcho.getTime();
  return new Date(asUtc.getTime() - offset);
}
