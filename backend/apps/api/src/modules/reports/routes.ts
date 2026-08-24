import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@cutz/db";
import { authorize } from "../../plugins/auth.js";
import { classify, DEFAULT_SEGMENT_CONFIG } from "../crm/segments.js";
import { zonedToUtc } from "../../lib/tz.js";
import { addHistoricalVisitEvents, buildCustomerRetention, retentionBucketKey } from "./retention.js";
import { historicalSalesFallback } from "./historical-sales.js";

const ADMIN = ["OWNER", "ADMIN", "MANAGER"] as const;

export default async function reportRoutes(app: FastifyInstance) {
  app.get("/reports/customer-retention-matrix", { preHandler: authorize(...ADMIN) }, async (req, reply) => {
    const parsed = z.object({
      branchId: z.string().optional(),
      from: z.coerce.date(),
      to: z.coerce.date(),
      bucket: z.enum(["day", "week", "month"]).default("month"),
      inactiveDays: z.coerce.number().int().min(15).max(365).default(60),
    }).refine((value) => value.to > value.from, "to_must_be_after_from").safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_query", details: parsed.error.flatten() });
    const branchId = ["OWNER", "ADMIN"].includes(req.user!.role) ? parsed.data.branchId ?? req.user!.branchId : req.user!.branchId;
    if (!branchId) return reply.code(400).send({ error: "branch_required" });
    if (req.user?.role === "MANAGER" && req.user.branchId !== branchId) return reply.code(403).send({ error: "forbidden" });
    const branch = await prisma.branch.findFirst({ where: { id: branchId, deletedAt: null }, select: { timezone: true } });
    if (!branch) return reply.code(404).send({ error: "branch_not_found" });
    const [customers, invoices, appointments, historyEntries] = await Promise.all([
      prisma.customer.findMany({ where: { branchId, deletedAt: null }, orderBy: { name: "asc" }, take: 5000, select: { id: true, name: true, phone: true, createdAt: true } }),
      prisma.invoice.findMany({ where: { branchId, customerId: { not: null }, status: { not: "VOID" }, createdAt: { lt: parsed.data.to } }, select: { customerId: true, appointmentId: true, createdAt: true, totalMinor: true } }),
      prisma.appointment.findMany({ where: { branchId, customerId: { not: null }, status: "COMPLETED", startAt: { lt: parsed.data.to }, deletedAt: null }, select: { customerId: true, id: true, startAt: true } }),
      prisma.customerHistoryEntry.findMany({ where: { customer: { branchId, deletedAt: null }, visitedAt: { lt: parsed.data.to } }, select: { customerId: true, visitedAt: true, amountMinor: true, source: true } }),
    ]);
    const invoicedAppointmentIds = new Set(invoices.flatMap((invoice) => invoice.appointmentId ? [invoice.appointmentId] : []));
    const events = addHistoricalVisitEvents([
      ...invoices.flatMap((invoice) => invoice.customerId ? [{ customerId: invoice.customerId, occurredAt: invoice.createdAt, revenueMinor: invoice.totalMinor, source: "invoice" as const }] : []),
      ...appointments.flatMap((appointment) => appointment.customerId && !invoicedAppointmentIds.has(appointment.id) ? [{ customerId: appointment.customerId, occurredAt: appointment.startAt, revenueMinor: 0, source: "appointment" as const }] : []),
    ], historyEntries, branch.timezone);
    const now = new Date();
    const rows = buildCustomerRetention(customers, events, { ...parsed.data, timeZone: branch.timezone, now });
    const columns = [...new Set(events.filter((event) => event.occurredAt >= parsed.data.from && event.occurredAt < parsed.data.to).map((event) => retentionBucketKey(event.occurredAt, branch.timezone, parsed.data.bucket)))].sort();
    const totals = rows.reduce((result, row) => {
      result.customers += 1;
      result.visits += row.rangeVisits;
      result.revenueMinor += row.rangeRevenueMinor;
      result.statuses[row.status] = (result.statuses[row.status] ?? 0) + 1;
      return result;
    }, { customers: 0, visits: 0, revenueMinor: 0, statuses: {} as Record<string, number> });
    return { generatedAt: now, branchId, timezone: branch.timezone, from: parsed.data.from, to: parsed.data.to, bucket: parsed.data.bucket, inactiveDays: parsed.data.inactiveDays, columns, totals, rows };
  });

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

    const [appointments, walkIns, invoices, lowStock, newCustomers] = await Promise.all([
      prisma.appointment.count({ where: { ...branchWhere, startAt: { gte: start, lt: end }, deletedAt: null } }),
      prisma.appointment.count({ where: { ...branchWhere, isWalkIn: true, startAt: { gte: start, lt: end } } }),
      prisma.invoice.findMany({
        where: { ...branchWhere, createdAt: { gte: start, lt: end }, status: { not: "VOID" } },
        select: { totalMinor: true, paidMinor: true },
      }),
      prisma.product.findMany({ where: { ...branchWhere, deletedAt: null } }),
      prisma.customer.count({ where: { ...branchWhere, createdAt: { gte: start, lt: end }, deletedAt: null } }),
    ]);

    const salesMinor = invoices.reduce((s, i) => s + i.totalMinor, 0);
    const avgBillMinor = invoices.length ? Math.round(salesMinor / invoices.length) : 0;
    const low = lowStock.filter((p) => p.stockQty <= p.reorderLevel).length;

    return { appointments, walkIns, bills: invoices.length, salesMinor, avgBillMinor, lowStockCount: low, newCustomers };
  });

  // Range report: sales, payment mix, new vs repeat, top services/staff.
  app.get("/reports/range", { preHandler: authorize(...ADMIN) }, async (req, reply) => {
    const parsed = z
      .object({ from: z.string(), to: z.string(), branchId: z.string().optional(), staffId: z.string().optional(), serviceId: z.string().optional() })
      .safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_query", details: parsed.error.flatten().fieldErrors });
    }
    // NOTE: keep strict authorization by role and branch scoping.
    const { from, to, branchId: queryBranchId, staffId, serviceId } = parsed.data;
    const gte = new Date(from);
    const lt = new Date(to);
    const branchId = ["OWNER", "ADMIN"].includes(req.user!.role) ? queryBranchId : req.user!.branchId ?? undefined;
    const branchWhere = branchId ? { branchId } : {};

    const invoices = await prisma.invoice.findMany({
      where: {
        ...branchWhere,
        createdAt: { gte, lt },
        status: { not: "VOID" },
        ...(staffId || serviceId ? { items: { some: { ...(staffId ? { staffId } : {}), ...(serviceId ? { serviceId } : {}) } } } : {}),
      },
      include: { payments: true, items: true },
    });

    const liveSalesMinor = invoices.reduce((s, i) => s + i.totalMinor, 0);
    let historicalSalesMinor = 0;
    if (branchId && !staffId && !serviceId) {
      const branch = await prisma.branch.findFirst({ where: { id: branchId, deletedAt: null }, select: { timezone: true } });
      if (branch) {
        const fromKey = dateKey(gte, branch.timezone);
        const toKey = dateKey(lt, branch.timezone);
        const historical = await prisma.historicalDailySummary.findMany({
          where: { branchId, businessDate: { gte: fromKey, lt: toKey }, reviewRequired: false, totalSalesMinor: { not: null } },
          select: { businessDate: true, totalSalesMinor: true, reviewRequired: true },
        });
        const liveDates = new Set(invoices.map((invoice) => dateKey(invoice.createdAt, branch.timezone)));
        historicalSalesMinor = historicalSalesFallback(historical, liveDates).totalMinor;
      }
    }
    const salesMinor = liveSalesMinor + historicalSalesMinor;
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
      liveSalesMinor,
      historicalSalesMinor,
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

    const [invoices, customers, inactiveCustomers, inactiveTotal, neverVisited, historicalDaily] = await Promise.all([
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
      prisma.historicalDailySummary.findMany({
        where: { branchId, businessDate: { gte: earliestKey, lte: todayKey }, reviewRequired: false, totalSalesMinor: { not: null } },
        select: { businessDate: true, totalSalesMinor: true, reviewRequired: true },
      }),
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
    const liveDates = new Set(invoices.map((invoice) => dateKey(invoice.createdAt, branch.timezone)));
    const historicalFallback = historicalSalesFallback(historicalDaily, liveDates);
    for (const [key, salesMinor] of historicalFallback.byDate) {
      const row = dailyMap.get(key) ?? { salesMinor: 0, collectedMinor: 0, bills: 0 };
      row.salesMinor = salesMinor;
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
