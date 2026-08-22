import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@cutz/db";
import { authorize } from "../../plugins/auth.js";
import { audit } from "../../lib/audit.js";
import { commissionMinor, haversineMeters, minutesBetween } from "./calculations.js";

const MANAGERS = ["OWNER", "ADMIN", "MANAGER"] as const;
const ATTENDANCE_ROLES = ["OWNER", "ADMIN", "MANAGER", "RECEPTION", "STAFF"] as const;
const geofenceRadius = () => Number(process.env.ATTENDANCE_GEOFENCE_METERS ?? 150);
const selfieKey = z.string().min(3).max(512).regex(/^[a-zA-Z0-9/_\-.]+$/, "invalid_storage_key");

async function resolveStaff(user: { id: string; role: string; branchId: string | null }, requestedId?: string) {
  if (user.role === "STAFF") return prisma.staff.findUnique({ where: { userId: user.id }, include: { branch: true } });
  if (!requestedId) return null;
  return prisma.staff.findFirst({ where: { id: requestedId, deletedAt: null, ...(!["OWNER", "ADMIN"].includes(user.role) ? { branchId: user.branchId ?? "__none__" } : {}) }, include: { branch: true } });
}

function geofence(staff: { branch: { latitude: number | null; longitude: number | null } }, lat: number, lng: number) {
  if (staff.branch.latitude == null || staff.branch.longitude == null) return { ok: false, error: "branch_geofence_not_configured", distanceMeters: null };
  const distanceMeters = Math.round(haversineMeters({ lat, lng }, { lat: staff.branch.latitude, lng: staff.branch.longitude }));
  return { ok: distanceMeters <= geofenceRadius(), error: "outside_geofence", distanceMeters };
}

export default async function attendanceRoutes(app: FastifyInstance) {
  app.get("/attendance", { preHandler: authorize(...ATTENDANCE_ROLES) }, async (req) => {
    const { branchId, from, to, staffId } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (staffId) where.staffId = staffId;
    if (branchId) where.staff = { branchId };
    if (from || to) where.createdAt = { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) };
    if (req.user?.role === "STAFF") where.staff = { userId: req.user.id };
    // Non-owner/admin are scoped to their own branch; a null branchId sees nothing
    // (never all branches).
    else if (!["OWNER", "ADMIN"].includes(req.user?.role ?? "")) where.staff = { branchId: req.user?.branchId ?? "__none__" };
    return prisma.attendance.findMany({ where, orderBy: { createdAt: "desc" }, take: 500, include: { staff: { select: { id: true, displayName: true, branchId: true, commissionRate: true } } } });
  });

  app.post("/attendance/check-in", { preHandler: authorize(...ATTENDANCE_ROLES) }, async (req, reply) => {
    const body = z.object({ staffId: z.string().optional(), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), selfieKey, consent: z.literal(true) }).parse(req.body);
    const staff = await resolveStaff(req.user!, body.staffId);
    if (!staff) return reply.code(404).send({ error: "staff_not_found" });
    if (req.user?.role !== "STAFF" && !MANAGERS.includes(req.user!.role as typeof MANAGERS[number]) && req.user?.role !== "RECEPTION") return reply.code(403).send({ error: "forbidden" });
    const location = geofence(staff, body.lat, body.lng);
    if (!location.ok) return reply.code(409).send(location);
    const open = await prisma.attendance.findFirst({ where: { staffId: staff.id, checkOutAt: null }, orderBy: { createdAt: "desc" } });
    if (open) return reply.code(409).send({ error: "already_checked_in", attendanceId: open.id });

    const now = new Date();
    const localParts = new Intl.DateTimeFormat("en-US", { timeZone: staff.branch.timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
    const weekdayName = localParts.find(part => part.type === "weekday")?.value ?? "Sun";
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayName);
    const hour = Number(localParts.find(part => part.type === "hour")?.value ?? 0) % 24;
    const minute = Number(localParts.find(part => part.type === "minute")?.value ?? 0);
    const shift = await prisma.shift.findFirst({ where: { staffId: staff.id, weekday }, orderBy: { startMin: "asc" } });
    const lateMinutes = shift ? Math.max(0, hour * 60 + minute - shift.startMin) : 0;
    const attendance = await prisma.attendance.create({ data: { staffId: staff.id, checkInAt: now, checkInLat: body.lat, checkInLng: body.lng, selfieUrl: body.selfieKey, consentAt: now, lateMinutes } });
    await audit("attendance.check_in", "Attendance", attendance.id, { actorUserId: req.user?.id, after: { staffId: staff.id, distanceMeters: location.distanceMeters, lateMinutes }, ip: req.ip });
    return reply.code(201).send({ ...attendance, distanceMeters: location.distanceMeters });
  });

  app.post("/attendance/check-out", { preHandler: authorize(...ATTENDANCE_ROLES) }, async (req, reply) => {
    const body = z.object({ staffId: z.string().optional(), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), selfieKey, consent: z.literal(true) }).parse(req.body);
    const staff = await resolveStaff(req.user!, body.staffId);
    if (!staff) return reply.code(404).send({ error: "staff_not_found" });
    const location = geofence(staff, body.lat, body.lng);
    if (!location.ok) return reply.code(409).send(location);
    const open = await prisma.attendance.findFirst({ where: { staffId: staff.id, checkOutAt: null }, orderBy: { createdAt: "desc" } });
    if (!open?.checkInAt) return reply.code(409).send({ error: "not_checked_in" });
    const now = new Date();
    const workedMinutes = minutesBetween(open.checkInAt, now);
    const attendance = await prisma.attendance.update({ where: { id: open.id }, data: { checkOutAt: now, checkOutLat: body.lat, checkOutLng: body.lng, checkOutSelfieUrl: body.selfieKey } });
    await audit("attendance.check_out", "Attendance", attendance.id, { actorUserId: req.user?.id, before: { checkOutAt: null }, after: { checkOutAt: now.toISOString(), workedMinutes, distanceMeters: location.distanceMeters }, ip: req.ip });
    return { ...attendance, workedMinutes, distanceMeters: location.distanceMeters };
  });

  app.get("/payroll/summary", { preHandler: authorize(...MANAGERS) }, async (req, reply) => {
    const { branchId, from, to } = z.object({ branchId: z.string(), from: z.string(), to: z.string() }).parse(req.query);
    if (req.user?.role === "MANAGER" && req.user.branchId !== branchId) return reply.code(403).send({ error: "forbidden" });
    const gte = new Date(from); const lte = new Date(to);
    const staff = await prisma.staff.findMany({ where: { branchId, deletedAt: null }, include: { attendance: { where: { createdAt: { gte, lte } } }, invoiceItems: { where: { invoice: { createdAt: { gte, lte }, status: { not: "VOID" } } } } } });
    const productIds = Array.from(new Set(staff.flatMap(member => member.invoiceItems.filter(item => item.kind === "product" && item.productId).map(item => item.productId!))));
    const products = await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, commissionBps: true } });
    const productCommission = new Map(products.map(product => [product.id, product.commissionBps]));
    return staff.map(member => {
      const workedMinutes = member.attendance.reduce((sum, row) => sum + minutesBetween(row.checkInAt, row.checkOutAt), 0);
      const serviceRevenueMinor = member.invoiceItems.filter(item => item.kind === "service").reduce((sum, item) => sum + item.lineTotalMinor, 0);
      const productRevenueMinor = member.invoiceItems.filter(item => item.kind === "product").reduce((sum, item) => sum + item.lineTotalMinor, 0);
      const serviceCommissionMinor = commissionMinor(serviceRevenueMinor, member.commissionRate);
      const productCommissionMinor = member.invoiceItems.filter(item => item.kind === "product").reduce((sum, item) => sum + commissionMinor(item.lineTotalMinor, productCommission.get(item.productId ?? "") ?? 0), 0);
      return { staffId: member.id, displayName: member.displayName, presentDays: new Set(member.attendance.map(row => row.createdAt.toISOString().slice(0, 10))).size, workedMinutes, lateMinutes: member.attendance.reduce((sum, row) => sum + row.lateMinutes, 0), overtimeMinutes: member.attendance.reduce((sum, row) => sum + row.overtimeMin, 0), serviceRevenueMinor, productRevenueMinor, commissionRateBps: member.commissionRate, serviceCommissionMinor, productCommissionMinor, commissionMinor: serviceCommissionMinor + productCommissionMinor };
    });
  });
}
