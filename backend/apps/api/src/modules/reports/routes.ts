import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@cutz/db";
import { authorize } from "../../plugins/auth.js";
import { classify, DEFAULT_SEGMENT_CONFIG } from "../crm/segments.js";
import { zonedToUtc } from "../../lib/tz.js";

const ADMIN = ["OWNER", "ADMIN", "MANAGER"] as const;

export default async function reportRoutes(app: FastifyInstance) {
  // Today snapshot for the dashboard.
  app.get("/reports/today", { preHandler: authorize(...ADMIN, "RECEPTION") }, async (req) => {
    const query = req.query as Record<string, string>;
    const branchId = ["OWNER", "ADMIN"].includes(req.user!.role) ? query.branchId : req.user!.branchId ?? undefined;
    const now = new Date();
    const timezone = branchId
      ? (await prisma.branch.findUnique({ where: { id: branchId }, select: { timezone: true } }))?.timezone ?? "UTC"
      : "UTC";
    const todayKey = dateKey(now, timezone);
    const start = zonedToUtc(`${todayKey}T00:00:00`, timezone);
    const end = zonedToUtc(`${calendarKeys(todayKey, 1, 1)[0]}T00:00:00`, timezone);
    const branchWhere = branchId ? { branchId } : {};

    const [appointments, walkIns, invoices, lowStock] = await Promise.all([
      prisma.appointment.count({ where: { ...branchWhere, startAt: { gte: start, lt: end }, deletedAt: null } }),
      prisma.appointment.count({ where: { ...branchWhere, isWalkIn: true, startAt: { gte: start, lt: end } } }),
      prisma.invoice.findMany({
        where: { ...branchWhere, createdAt: { gte: start, lt: end }, status: { not: "VOID" } },
        select: { totalMinor: true, paidMinor: true },
      }),
      prisma.product.findMany({ where: { deletedAt: null } }),
    ]);

    const salesMinor = invoices.reduce((s, i) => s + i.totalMinor, 0);
    const avgBillMinor = invoices.length ? Math.round(salesMinor / invoices.length) : 0;
    const low = lowStock.filter((p) => p.stockQty <= p.reorderLevel).length;

    return { appointments, walkIns, bills: invoices.length, salesMinor, avgBillMinor, lowStockCount: low };
  });

  // Range report: sales, payment mix, new vs repeat, top services/staff.
  app.get("/reports/range", { preHandler: authorize(...ADMIN) }, async (req) => {
    const parsed = z
      .object({ from: z.string(), to: z.string(), branchId: z.string().optional() })
      .parse(req.query);
    const { from, to } = parsed;
    const gte = new Date(from);
    const lte = new Date(to);
    const branchId = ["OWNER", "ADMIN"].includes(req.user!.role) ? parsed.branchId : req.user!.branchId ?? undefined;
    const branchWhere = branchId ? { branchId } : {};

    const invoices = await prisma.invoice.findMany({
      where: { ...branchWhere, createdAt: { gte, lte }, status: { not: "VOID" } },
      include: { payments: true, items: true },
    });

    const salesMinor = invoices.reduce((s, i) => s + i.totalMinor, 0);
    const paymentMix: Record<string, number> = {};
    const topServices: Record<string, number> = {};
    const topStaff: Record<string, number> = {};
    for (const inv of invoices) {
      for (const p of inv.payments) paymentMix[p.method] = (paymentMix[p.method] ?? 0) + p.amountMinor;
      for (const it of inv.items) {
        if (it.kind === "service") topServices[it.description] = (topServices[it.description] ?? 0) + it.lineTotalMinor;
        if (it.staffId) topStaff[it.staffId] = (topStaff[it.staffId] ?? 0) + it.lineTotalMinor;
      }
    }

    // New vs repeat / lapsed via segmentation.
    const customers = await prisma.customer.findMany({
      where: { ...branchWhere, deletedAt: null },
      select: { visitCount: true, totalSpent: true, lastVisitAt: true, memberships: { where: { isActive: true }, select: { id: true } } },
    });
    const now = new Date();
    let repeat = 0, lapsed = 0, neu = 0;
    for (const c of customers) {
      const segs = classify(
        { visitCount: c.visitCount, totalSpent: c.totalSpent, lastVisitAt: c.lastVisitAt, hasActiveMembership: c.memberships.length > 0 },
        DEFAULT_SEGMENT_CONFIG,
        now,
      );
      if (segs.includes("REPEAT")) repeat++;
      if (segs.includes("LAPSED")) lapsed++;
      if (segs.includes("NEW")) neu++;
    }

    return {
      salesMinor,
      bills: invoices.length,
      paymentMix,
      topServices: Object.entries(topServices).sort((a, b) => b[1] - a[1]).slice(0, 10),
      topStaff: Object.entries(topStaff).sort((a, b) => b[1] - a[1]).slice(0, 10),
      customers: { new: neu, repeat, lapsed, total: customers.length },
    };
  });

  app.get("/reports/dashboard", { preHandler: authorize(...ADMIN, "RECEPTION") }, async (req, reply) => {
    const query = z.object({ branchId: z.string().optional(), days: z.coerce.number().int().min(7).max(31).default(15), inactiveDays: z.coerce.number().int().min(15).max(365).optional() }).parse(req.query);
    const branchId = ["OWNER", "ADMIN"].includes(req.user!.role) ? query.branchId ?? req.user!.branchId ?? "main" : req.user!.branchId;
    if (!branchId) return reply.code(400).send({ error: "branch_required" });
    const branch = await prisma.branch.findFirst({ where: { id: branchId, deletedAt: null }, select: { timezone: true } });
    if (!branch) return reply.code(404).send({ error: "branch_not_found" });
    const retentionSetting = await prisma.setting.findUnique({ where: { key: `branch:${branchId}:retention` } });
    const configuredInactiveDays = Number((retentionSetting?.value as { inactiveDays?: unknown } | null)?.inactiveDays);
    const inactiveDays = query.inactiveDays ?? ([30, 45, 60, 90].includes(configuredInactiveDays) ? configuredInactiveDays : 60);

    const now = new Date();
    const todayKey = dateKey(now, branch.timezone);
    const dailyKeys = calendarKeys(todayKey, query.days);
    const rolling10Keys = calendarKeys(todayKey, 10);
    const [year, month] = todayKey.split("-");
    const monthStartKey = `${year}-${month}-01`;
    const rolling15Start = calendarKeys(todayKey, 15)[0];
    const earliestKey = monthStartKey < rolling15Start ? monthStartKey : rolling15Start;
    const rangeStart = zonedToUtc(`${earliestKey}T00:00:00`, branch.timezone);
    const rangeEnd = zonedToUtc(`${calendarKeys(todayKey, 1, 1)[0]}T00:00:00`, branch.timezone);
    const inactiveCutoff = new Date(now.getTime() - inactiveDays * 86_400_000);

    const [invoices, customers, inactiveCustomers, inactiveTotal, neverVisited] = await Promise.all([
      prisma.invoice.findMany({
        where: { branchId, status: { not: "VOID" }, createdAt: { gte: rangeStart, lt: rangeEnd } },
        select: { id: true, totalMinor: true, paidMinor: true, createdAt: true },
      }),
      prisma.customer.findMany({
        where: { branchId, deletedAt: null },
        select: { id: true, visitCount: true, totalSpent: true, lastVisitAt: true },
      }),
      prisma.customer.findMany({
        where: { branchId, deletedAt: null, visitCount: { gt: 0 }, lastVisitAt: { lt: inactiveCutoff } },
        orderBy: { lastVisitAt: "asc" },
        take: 50,
        select: { id: true, name: true, phone: true, email: true, visitCount: true, totalSpent: true, lastVisitAt: true, loyaltyPoints: true },
      }),
      prisma.customer.count({ where: { branchId, deletedAt: null, visitCount: { gt: 0 }, lastVisitAt: { lt: inactiveCutoff } } }),
      prisma.customer.count({ where: { branchId, deletedAt: null, visitCount: 0 } }),
    ]);

    const dailyMap = new Map<string, { salesMinor: number; collectedMinor: number; bills: number }>();
    for (const key of calendarKeys(todayKey, daysInMonth(Number(year), Number(month)))) {
      if (key >= monthStartKey && key <= todayKey) dailyMap.set(key, { salesMinor: 0, collectedMinor: 0, bills: 0 });
    }
    for (const key of dailyKeys) if (!dailyMap.has(key)) dailyMap.set(key, { salesMinor: 0, collectedMinor: 0, bills: 0 });
    for (const invoice of invoices) {
      const key = dateKey(invoice.createdAt, branch.timezone);
      const row = dailyMap.get(key) ?? { salesMinor: 0, collectedMinor: 0, bills: 0 };
      row.salesMinor += invoice.totalMinor;
      row.collectedMinor += invoice.paidMinor;
      row.bills += 1;
      dailyMap.set(key, row);
    }
    const totalFor = (keys: string[]) => keys.reduce((sum, key) => sum + (dailyMap.get(key)?.salesMinor ?? 0), 0);
    const monthKeys = [...dailyMap.keys()].filter((key) => key >= monthStartKey && key <= todayKey).sort();
    const monthInvoices = invoices.filter((invoice) => dateKey(invoice.createdAt, branch.timezone) >= monthStartKey);
    const ticketValues = monthInvoices.map((invoice) => invoice.totalMinor).filter((value) => value > 0);
    const maxDay = monthKeys.reduce((best, key) => {
      const salesMinor = dailyMap.get(key)?.salesMinor ?? 0;
      return salesMinor > best.salesMinor ? { date: key, salesMinor } : best;
    }, { date: monthStartKey, salesMinor: 0 });
    const repeatCustomers = customers.filter((customer) => customer.visitCount >= DEFAULT_SEGMENT_CONFIG.repeatMinVisits).length;

    return {
      generatedAt: now.toISOString(),
      timezone: branch.timezone,
      thresholds: { inactiveDays, repeatMinVisits: DEFAULT_SEGMENT_CONFIG.repeatMinVisits },
      sales: {
        todayMinor: dailyMap.get(todayKey)?.salesMinor ?? 0,
        rolling10Minor: totalFor(rolling10Keys),
        rolling15Minor: totalFor(calendarKeys(todayKey, 15)),
        monthMinor: totalFor(monthKeys),
        maxDaily: maxDay,
      },
      tickets: {
        minimumMinor: ticketValues.length ? Math.min(...ticketValues) : 0,
        maximumMinor: ticketValues.length ? Math.max(...ticketValues) : 0,
        averageMinor: ticketValues.length ? Math.round(ticketValues.reduce((sum, value) => sum + value, 0) / ticketValues.length) : 0,
      },
      customers: {
        total: customers.length,
        repeat: repeatCustomers,
        repeatRate: customers.length ? Math.round((repeatCustomers / customers.length) * 100) : 0,
        inactive: inactiveTotal,
        neverVisited,
        inactiveList: inactiveCustomers.map((customer) => ({ ...customer, daysSinceVisit: customer.lastVisitAt ? Math.floor((now.getTime() - customer.lastVisitAt.getTime()) / 86_400_000) : null })),
      },
      dailySales: dailyKeys.map((date) => ({ date, ...(dailyMap.get(date) ?? { salesMinor: 0, collectedMinor: 0, bills: 0 }) })),
    };
  });
}

function dateKey(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function calendarKeys(todayKey: string, count: number, offsetDays = 0) {
  const [year, month, day] = todayKey.split("-").map(Number);
  const end = Date.UTC(year, month - 1, day + offsetDays);
  return Array.from({ length: count }, (_, index) => new Date(end - (count - 1 - index) * 86_400_000).toISOString().slice(0, 10));
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
