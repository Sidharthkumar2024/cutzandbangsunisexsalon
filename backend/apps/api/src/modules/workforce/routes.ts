import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@cutz/db";
import { authorize } from "../../plugins/auth.js";
import { audit } from "../../lib/audit.js";
import { parseCsv } from "../../lib/csv.js";
import { assertStaffImportRowLimit, parseStaffImportRow, staffDedupeKey, staffPhoneKey } from "./import.js";
import { lateMinutesForCheckIn } from "../attendance/calculations.js";

const MANAGERS = ["OWNER", "ADMIN", "MANAGER"] as const;
const WORKFORCE = ["OWNER", "ADMIN", "MANAGER", "RECEPTION", "STAFF"] as const;

const hashSecret = (value: string) => createHash("sha256").update(value).digest("hex");
const safeSecretMatch = (value: string, hash: string) => {
  const supplied = Buffer.from(hashSecret(value));
  const expected = Buffer.from(hash);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
};

function scopedBranch(user: { role: string; branchId: string | null }, requested?: string) {
  return ["OWNER", "ADMIN"].includes(user.role) ? requested : user.branchId ?? "__none__";
}

async function staffForUser(userId: string) {
  return prisma.staff.findUnique({ where: { userId }, select: { id: true, branchId: true } });
}

function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.find((part) => part.type === "weekday")?.value ?? "Sun");
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0) % 24;
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return { weekday, minuteOfDay: hour * 60 + minute };
}

export default async function workforceRoutes(app: FastifyInstance) {
  app.post("/staff/import", { preHandler: authorize(...MANAGERS) }, async (req, reply) => {
    const parsed = z.object({
      branchId: z.string().trim().min(1),
      csv: z.string().min(1).optional(),
      rows: z.array(z.record(z.unknown())).min(1).max(500).optional(),
    }).refine((body) => Boolean(body.csv) !== Boolean(body.rows), "provide_exactly_one_of_csv_or_rows").safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_staff_import", details: parsed.error.flatten() });
    const { branchId } = parsed.data;
    if (req.user?.role === "MANAGER" && req.user.branchId !== branchId) return reply.code(403).send({ error: "forbidden" });
    const branch = await prisma.branch.findFirst({ where: { id: branchId, deletedAt: null }, select: { id: true } });
    if (!branch) return reply.code(404).send({ error: "branch_not_found" });

    const rawRows = parsed.data.rows ?? parseCsv(parsed.data.csv!);
    try {
      assertStaffImportRowLimit(rawRows.length);
    } catch {
      return reply.code(413).send({ error: "staff_import_row_limit", maxRows: 500 });
    }
    if (!rawRows.length) return reply.code(400).send({ error: "staff_import_empty" });
    const issues: Array<{ row: number; error: string }> = [];
    const rows = rawRows.map((row, index) => {
      try {
        return parseStaffImportRow(row);
      } catch (error) {
        issues.push({ row: index + 2, error: error instanceof Error ? error.message : "invalid_row" });
        return null;
      }
    }).filter((row): row is NonNullable<typeof row> => row !== null);
    const inputKeys = new Set<string>();
    rows.forEach((row, index) => {
      const key = staffDedupeKey(row.displayName);
      if (inputKeys.has(key)) issues.push({ row: index + 2, error: "duplicate_staff_name_in_import" });
      inputKeys.add(key);
    });
    if (issues.length) return reply.code(400).send({ error: "staff_import_validation_failed", issues });

    const existing = await prisma.staff.findMany({ where: { branchId }, include: { shifts: true } });
    const byName = new Map<string, typeof existing>();
    const byPhone = new Map<string, typeof existing>();
    for (const staff of existing) {
      const nameKey = staffDedupeKey(staff.displayName);
      byName.set(nameKey, [...(byName.get(nameKey) ?? []), staff]);
      const phoneKey = staffPhoneKey(staff.phone ?? undefined);
      if (phoneKey) byPhone.set(phoneKey, [...(byPhone.get(phoneKey) ?? []), staff]);
    }
    for (const [index, row] of rows.entries()) {
      const nameMatches = byName.get(staffDedupeKey(row.displayName)) ?? [];
      const phoneMatches = row.phone ? byPhone.get(staffPhoneKey(row.phone) ?? "") ?? [] : [];
      const matches = nameMatches.length ? nameMatches : phoneMatches;
      if (matches.length > 1) issues.push({ row: index + 2, error: "ambiguous_existing_staff_match" });
      if (nameMatches.length === 1 && phoneMatches.length === 1 && nameMatches[0].id !== phoneMatches[0].id) {
        issues.push({ row: index + 2, error: "staff_name_phone_match_different_records" });
      }
    }
    if (issues.length) return reply.code(409).send({ error: "staff_import_dedupe_conflict", issues });

    const result = await prisma.$transaction(async (tx) => {
      const imported: Array<{ id: string; displayName: string; operation: "created" | "updated" }> = [];
      for (const row of rows) {
        const nameMatch = (byName.get(staffDedupeKey(row.displayName)) ?? [])[0];
        const phoneMatch = row.phone ? (byPhone.get(staffPhoneKey(row.phone) ?? "") ?? [])[0] : undefined;
        const current = nameMatch ?? phoneMatch;
        const { shifts, ...profile } = row;
        const staff = current
          ? await tx.staff.update({ where: { id: current.id }, data: { ...profile, isActive: true, deletedAt: null } })
          : await tx.staff.create({ data: { branchId, ...profile } });
        if (shifts) {
          await tx.shift.deleteMany({ where: { staffId: staff.id } });
          if (shifts.length) await tx.shift.createMany({ data: shifts.map((shift) => ({ staffId: staff.id, ...shift })) });
        }
        await audit(current ? "staff.import_update" : "staff.import_create", "Staff", staff.id, {
          actorUserId: req.user?.id,
          before: current ?? undefined,
          after: { ...row, branchId },
          ip: req.ip,
        }, tx);
        imported.push({ id: staff.id, displayName: staff.displayName, operation: current ? "updated" : "created" });
      }
      return imported;
    });
    return { imported: result.length, created: result.filter((row) => row.operation === "created").length, updated: result.filter((row) => row.operation === "updated").length, rows: result };
  });

  app.patch("/staff/:id/profile", { preHandler: authorize(...MANAGERS) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      displayName: z.string().trim().min(2).max(120).optional(),
      phone: z.string().trim().max(30).nullable().optional(),
      designation: z.string().trim().min(2).max(100).optional(),
      baseSalaryMinor: z.number().int().nonnegative().optional(),
      commissionRate: z.number().int().min(0).max(10_000).optional(),
      commissionThresholdMinor: z.number().int().nonnegative().optional(),
      lateGraceMinutes: z.number().int().min(0).max(180).optional(),
      lateDeductionMinor: z.number().int().nonnegative().optional(),
      halfDayAfterMinutes: z.number().int().min(30).max(720).optional(),
      overtimePaid: z.boolean().optional(),
      biometricCode: z.string().trim().min(1).max(80).nullable().optional(),
      weeklyOff: z.array(z.number().int().min(0).max(6)).max(7).optional(),
      shifts: z.array(z.object({
        weekday: z.number().int().min(0).max(6),
        startMin: z.number().int().min(0).max(1439),
        endMin: z.number().int().min(1).max(1440),
        breakStartMin: z.number().int().min(0).max(1439).nullable().optional(),
        breakEndMin: z.number().int().min(1).max(1440).nullable().optional(),
      }).refine((shift) => shift.endMin > shift.startMin, "shift_end_must_be_after_start")).max(14).optional(),
    }).parse(req.body);
    const existing = await prisma.staff.findFirst({ where: { id, deletedAt: null } });
    if (!existing) return reply.code(404).send({ error: "staff_not_found" });
    if (req.user?.role === "MANAGER" && req.user.branchId !== existing.branchId) return reply.code(403).send({ error: "forbidden" });
    const { shifts, ...profile } = body;
    const updated = await prisma.$transaction(async (tx) => {
      if (shifts) {
        await tx.shift.deleteMany({ where: { staffId: id } });
        if (shifts.length) await tx.shift.createMany({ data: shifts.map((shift) => ({ staffId: id, ...shift })) });
      }
      return tx.staff.update({
        where: { id },
        data: profile,
        include: { shifts: { orderBy: [{ weekday: "asc" }, { startMin: "asc" }] }, leaves: { orderBy: { startDate: "desc" }, take: 20 }, user: { select: { id: true, email: true, role: true, isActive: true } } },
      });
    });
    await audit("staff.profile_update", "Staff", id, { actorUserId: req.user?.id, before: existing, after: body, ip: req.ip });
    return updated;
  });

  app.get("/leaves", { preHandler: authorize(...WORKFORCE) }, async (req) => {
    const query = z.object({ branchId: z.string().optional(), staffId: z.string().optional(), from: z.string().optional(), to: z.string().optional() }).parse(req.query);
    const own = req.user?.role === "STAFF" ? await staffForUser(req.user.id) : null;
    const branchId = scopedBranch(req.user!, query.branchId);
    return prisma.leave.findMany({
      where: {
        staffId: own?.id ?? query.staffId,
        staff: { branchId },
        ...(query.from || query.to ? { endDate: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } } : {}),
      },
      orderBy: { startDate: "desc" },
      take: 200,
      include: { staff: { select: { id: true, displayName: true, designation: true } } },
    });
  });

  app.post("/leaves", { preHandler: authorize(...WORKFORCE) }, async (req, reply) => {
    const body = z.object({ staffId: z.string().optional(), startDate: z.coerce.date(), endDate: z.coerce.date(), reason: z.string().trim().min(2).max(500), approved: z.boolean().optional() }).refine((value) => value.endDate >= value.startDate, "leave_end_before_start").parse(req.body);
    const own = req.user?.role === "STAFF" ? await staffForUser(req.user.id) : null;
    const staffId = own?.id ?? body.staffId;
    if (!staffId) return reply.code(400).send({ error: "staff_required" });
    const staff = await prisma.staff.findFirst({ where: { id: staffId, deletedAt: null } });
    if (!staff) return reply.code(404).send({ error: "staff_not_found" });
    if (!["OWNER", "ADMIN"].includes(req.user!.role) && req.user?.branchId !== staff.branchId) return reply.code(403).send({ error: "forbidden" });
    const approved = MANAGERS.includes(req.user!.role as typeof MANAGERS[number]) ? Boolean(body.approved) : false;
    const leave = await prisma.leave.create({ data: { staffId, startDate: body.startDate, endDate: body.endDate, reason: body.reason, approved } });
    await audit("leave.request", "Leave", leave.id, { actorUserId: req.user?.id, after: { ...body, staffId, approved }, ip: req.ip });
    return reply.code(201).send(leave);
  });

  app.patch("/leaves/:id", { preHandler: authorize(...MANAGERS) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ approved: z.boolean() }).parse(req.body);
    const existing = await prisma.leave.findUnique({ where: { id }, include: { staff: { select: { branchId: true } } } });
    if (!existing) return reply.code(404).send({ error: "leave_not_found" });
    if (req.user?.role === "MANAGER" && req.user.branchId !== existing.staff.branchId) return reply.code(403).send({ error: "forbidden" });
    const updated = await prisma.leave.update({ where: { id }, data: body });
    await audit("leave.review", "Leave", id, { actorUserId: req.user?.id, before: { approved: existing.approved }, after: body, ip: req.ip });
    return updated;
  });

  app.get("/biometric/devices", { preHandler: authorize(...MANAGERS) }, async (req) => {
    const branchId = scopedBranch(req.user!, (req.query as Record<string, string>).branchId);
    return prisma.biometricDevice.findMany({ where: { branchId }, orderBy: { createdAt: "desc" }, select: { id: true, branchId: true, name: true, provider: true, isActive: true, lastSeenAt: true, createdAt: true } });
  });

  app.post("/biometric/devices", { preHandler: authorize("OWNER", "ADMIN") }, async (req, reply) => {
    const body = z.object({ branchId: z.string(), name: z.string().trim().min(2).max(100), provider: z.string().trim().min(2).max(80).default("GENERIC_WEBHOOK") }).parse(req.body);
    const secret = randomBytes(32).toString("base64url");
    const device = await prisma.biometricDevice.create({ data: { ...body, secretHash: hashSecret(secret) }, select: { id: true, branchId: true, name: true, provider: true, isActive: true, createdAt: true } });
    await audit("biometric_device.create", "BiometricDevice", device.id, { actorUserId: req.user?.id, after: { ...body, secret: "[shown_once]" }, ip: req.ip });
    return reply.code(201).send({ ...device, secret, webhookPath: `/api/v1/webhooks/biometric/${device.id}` });
  });

  app.post("/webhooks/biometric/:deviceId", { config: { rateLimit: { max: 500, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { deviceId } = req.params as { deviceId: string };
    const bearer = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : "";
    const device = await prisma.biometricDevice.findFirst({ where: { id: deviceId, isActive: true }, include: { branch: { select: { timezone: true } } } });
    if (!device || !bearer || !safeSecretMatch(bearer, device.secretHash)) return reply.code(401).send({ error: "invalid_device_secret" });
    const body = z.object({ eventId: z.string().trim().min(3).max(160), employeeCode: z.string().trim().min(1).max(80), action: z.enum(["CHECK_IN", "CHECK_OUT"]), occurredAt: z.coerce.date() }).parse(req.body);
    const duplicate = await prisma.auditLog.findFirst({ where: { action: "biometric.event", entityType: "BiometricEvent", entityId: body.eventId } });
    if (duplicate) return { accepted: true, duplicate: true };
    const staff = await prisma.staff.findFirst({ where: { branchId: device.branchId, biometricCode: body.employeeCode, isActive: true, deletedAt: null } });
    if (!staff) return reply.code(404).send({ error: "biometric_staff_not_mapped" });
    const clock = localParts(body.occurredAt, device.branch.timezone);
    const shift = await prisma.shift.findFirst({ where: { staffId: staff.id, weekday: clock.weekday }, orderBy: { startMin: "asc" } });
    let attendanceId: string;
    if (body.action === "CHECK_IN") {
      const open = await prisma.attendance.findFirst({ where: { staffId: staff.id, checkOutAt: null }, orderBy: { createdAt: "desc" } });
      if (open) attendanceId = open.id;
      else {
        const row = await prisma.attendance.create({ data: { staffId: staff.id, checkInAt: body.occurredAt, lateMinutes: shift ? lateMinutesForCheckIn(clock.minuteOfDay, shift.startMin, staff.lateGraceMinutes) : 0, source: "BIOMETRIC", biometricDeviceId: device.id, externalEventId: body.eventId } });
        attendanceId = row.id;
      }
    } else {
      const open = await prisma.attendance.findFirst({ where: { staffId: staff.id, checkOutAt: null }, orderBy: { createdAt: "desc" } });
      if (!open?.checkInAt) return reply.code(409).send({ error: "not_checked_in" });
      const overtimeMin = shift ? Math.max(0, clock.minuteOfDay - shift.endMin) : 0;
      const row = await prisma.attendance.update({ where: { id: open.id }, data: { checkOutAt: body.occurredAt, overtimeMin, source: "BIOMETRIC", biometricDeviceId: device.id } });
      attendanceId = row.id;
    }
    await prisma.biometricDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
    await audit("biometric.event", "BiometricEvent", body.eventId, { after: { ...body, staffId: staff.id, attendanceId, deviceId }, ip: req.ip });
    return { accepted: true, attendanceId };
  });
}
