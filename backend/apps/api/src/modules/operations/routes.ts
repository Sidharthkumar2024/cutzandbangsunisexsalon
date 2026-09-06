import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@cutz/db";
import { authorize } from "../../plugins/auth.js";
import { audit } from "../../lib/audit.js";
import { parseCsv } from "../../lib/csv.js";
import { zonedToUtc } from "../../lib/tz.js";
import { assertHistoricalCsvRowCounts, assertHistoricalImportSize, expenseImportLineKey, normalizeBusinessDate, parseHistoricalCsv, parseHistoricalCsvPair } from "./historical-import.js";

const OPERATIONS = ["OWNER", "ADMIN", "MANAGER", "RECEPTION"] as const;
const DRAWER_DENOMINATIONS = new Set(["1", "2", "5", "10", "20", "50", "100", "200", "500"]);
const cashBreakdownSchema = z.record(z.string(), z.number().int().nonnegative()).refine(
  (value) => Object.keys(value).every((key) => DRAWER_DENOMINATIONS.has(key)),
  "unsupported_cash_denomination",
);

function breakdownTotalMinor(value: Record<string, number>) {
  return Object.entries(value).reduce((sum, [denomination, count]) => sum + Number(denomination) * count * 100, 0);
}

function branchAllowed(role: string, userBranchId: string | null | undefined, branchId: string) {
  return ["OWNER", "ADMIN"].includes(role) || userBranchId === branchId;
}

function businessDate(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

async function cashTotals(session: { id: string; branchId: string; openedAt: Date; openingCashMinor: number }) {
  const [payments, expenses] = await Promise.all([
    prisma.payment.groupBy({
      by: ["method"],
      where: {
        createdAt: { gte: session.openedAt },
        invoice: { branchId: session.branchId, status: { not: "VOID" } },
      },
      _sum: { amountMinor: true },
    }),
    prisma.expense.aggregate({
      where: { cashSessionId: session.id, paymentMethod: "CASH" },
      _sum: { amountMinor: true },
    }),
  ]);
  const paymentTotalsMinor = Object.fromEntries(payments.map((row) => [row.method, row._sum.amountMinor ?? 0]));
  const cashSalesMinor = paymentTotalsMinor.CASH ?? 0;
  const cashExpensesMinor = expenses._sum.amountMinor ?? 0;
  return {
    paymentTotalsMinor,
    cashSalesMinor,
    upiSalesMinor: paymentTotalsMinor.UPI ?? 0,
    cardSalesMinor: paymentTotalsMinor.CARD ?? 0,
    cashExpensesMinor,
    expectedCashMinor: session.openingCashMinor + cashSalesMinor - cashExpensesMinor,
  };
}

export default async function operationsRoutes(app: FastifyInstance) {
  app.post("/historical-register/import", { preHandler: authorize("OWNER", "ADMIN", "MANAGER") }, async (req, reply) => {
    const expenseSchema = z.object({
      lineKey: z.string().trim().min(1).max(120).optional(),
      category: z.string().trim().min(2).max(80).default("Daily expense"),
      description: z.string().trim().min(2).max(500),
      amountMinor: z.number().int().positive(),
      paymentMethod: z.enum(["CASH", "UPI", "CARD"]).default("CASH"),
      vendorName: z.string().trim().max(150).optional(),
      notes: z.string().trim().max(500).optional(),
      reviewRequired: z.boolean().default(false),
      reviewNote: z.string().trim().max(1000).optional(),
    });
    const daySchema = z.object({
      businessDate: z.string(),
      openingCashMinor: z.number().int().nonnegative().default(0),
      cashSalesMinor: z.number().int().nonnegative().default(0),
      upiSalesMinor: z.number().int().nonnegative().default(0),
      cardSalesMinor: z.number().int().nonnegative().default(0),
      totalSalesMinor: z.number().int().nonnegative().optional(),
      availableCashMinor: z.number().int().nonnegative().optional(),
      cashAdjustmentMinor: z.number().int().optional(),
      reviewRequired: z.boolean().default(false),
      reviewNote: z.string().trim().max(1000).optional(),
      notes: z.string().trim().max(1000).optional(),
      sourceRef: z.string().trim().max(500).optional(),
      expenses: z.array(expenseSchema).max(200).default([]),
    });
    const parsed = z.object({
      branchId: z.string().trim().min(1),
      source: z.string().trim().min(2).max(80).default("handwritten_register"),
      csv: z.string().min(1).optional(),
      dailyCsv: z.string().min(1).optional(),
      expensesCsv: z.string().optional(),
      days: z.array(daySchema).min(1).max(500).optional(),
    }).refine((body) => [body.csv, body.dailyCsv, body.days].filter(Boolean).length === 1, "provide_exactly_one_of_csv_dailyCsv_or_days")
      .refine((body) => !body.expensesCsv || Boolean(body.dailyCsv), "expensesCsv_requires_dailyCsv").safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_historical_register_import", details: parsed.error.flatten() });
    if (!branchAllowed(req.user!.role, req.user?.branchId, parsed.data.branchId)) return reply.code(403).send({ error: "forbidden" });
    const branch = await prisma.branch.findFirst({ where: { id: parsed.data.branchId, deletedAt: null }, select: { id: true, timezone: true } });
    if (!branch) return reply.code(404).send({ error: "branch_not_found" });

    let days;
    try {
      const dailyRows = parsed.data.dailyCsv ? parseCsv(parsed.data.dailyCsv) : undefined;
      const expenseRows = parsed.data.expensesCsv ? parseCsv(parsed.data.expensesCsv) : undefined;
      const combinedRows = parsed.data.csv ? parseCsv(parsed.data.csv) : undefined;
      if (dailyRows) assertHistoricalCsvRowCounts(dailyRows.length, expenseRows?.length ?? 0);
      if (combinedRows) assertHistoricalCsvRowCounts(combinedRows.length, 0, true);
      days = parsed.data.days?.map((day) => ({
        ...day,
        businessDate: normalizeBusinessDate(day.businessDate),
        totalSalesMinor: day.totalSalesMinor ?? day.cashSalesMinor + day.upiSalesMinor + day.cardSalesMinor,
      })) ?? (dailyRows ? parseHistoricalCsvPair(dailyRows, expenseRows ?? []) : parseHistoricalCsv(combinedRows!));
      assertHistoricalImportSize(days);
    } catch (error) {
      if (error instanceof Error && error.message.includes("_limit_")) {
        return reply.code(413).send({ error: "historical_register_import_limit", message: error.message });
      }
      return reply.code(400).send({ error: "historical_register_parse_failed", message: error instanceof Error ? error.message : "invalid_import" });
    }
    const uniqueDates = new Set<string>();
    for (const day of days) {
      if (uniqueDates.has(day.businessDate)) return reply.code(400).send({ error: "duplicate_business_date", businessDate: day.businessDate });
      uniqueDates.add(day.businessDate);
    }

    const result = await prisma.$transaction(async (tx) => {
      const imported: Array<{ businessDate: string; summaryId: string; operation: "created" | "updated"; expensesUpserted: number; warnings: string[] }> = [];
      for (const day of days) {
        const before = await tx.historicalDailySummary.findUnique({ where: { branchId_businessDate: { branchId: branch.id, businessDate: day.businessDate } } });
        const summaryData = {
          openingCashMinor: day.openingCashMinor,
          cashSalesMinor: day.cashSalesMinor,
          upiSalesMinor: day.upiSalesMinor,
          cardSalesMinor: day.cardSalesMinor,
          totalSalesMinor: day.totalSalesMinor,
          availableCashMinor: day.availableCashMinor,
          cashAdjustmentMinor: day.cashAdjustmentMinor,
          reviewRequired: day.reviewRequired ?? false,
          reviewNote: day.reviewNote,
          notes: day.notes,
          source: parsed.data.source,
          sourceRef: day.sourceRef,
          importedByUserId: req.user!.id,
        };
        const summary = await tx.historicalDailySummary.upsert({
          where: { branchId_businessDate: { branchId: branch.id, businessDate: day.businessDate } },
          create: { branchId: branch.id, businessDate: day.businessDate, ...summaryData },
          update: summaryData,
        });
        for (const [index, expense] of day.expenses.entries()) {
          const importLineKey = expenseImportLineKey(expense, index);
          const occurredAt = zonedToUtc(`${day.businessDate}T12:00:00`, branch.timezone);
          await tx.expense.upsert({
            where: { historicalSummaryId_importLineKey: { historicalSummaryId: summary.id, importLineKey } },
            create: {
              branchId: branch.id,
              historicalSummaryId: summary.id,
              importLineKey,
              source: parsed.data.source,
              reviewRequired: expense.reviewRequired ?? false,
              reviewNote: expense.reviewNote,
              category: expense.category,
              description: expense.description,
              amountMinor: expense.amountMinor,
              paymentMethod: expense.paymentMethod,
              vendorName: expense.vendorName,
              occurredAt,
              createdByUserId: req.user!.id,
            },
            update: {
              category: expense.category,
              description: expense.description,
              amountMinor: expense.amountMinor,
              paymentMethod: expense.paymentMethod,
              vendorName: expense.vendorName,
              reviewRequired: expense.reviewRequired ?? false,
              reviewNote: expense.reviewNote,
              occurredAt,
            },
          });
        }
        const paymentValues = [day.cashSalesMinor, day.upiSalesMinor, day.cardSalesMinor];
        const paymentSum = paymentValues.every((value) => value !== undefined) ? paymentValues.reduce((sum, value) => sum + (value ?? 0), 0) : null;
        const warnings = day.reviewRequired
          ? ["daily_summary_excluded_from_verified_totals"]
          : paymentSum === null || day.totalSalesMinor === undefined
            ? ["daily_summary_missing_amounts"]
            : paymentSum === day.totalSalesMinor ? [] : [`payment_mix_differs_by_${day.totalSalesMinor - paymentSum}_minor`];
        await audit(before ? "historical_register.update" : "historical_register.create", "HistoricalDailySummary", summary.id, {
          actorUserId: req.user?.id,
          before: before ?? undefined,
          after: { ...summaryData, businessDate: day.businessDate, expenses: day.expenses, warnings },
          ip: req.ip,
        }, tx);
        imported.push({ businessDate: day.businessDate, summaryId: summary.id, operation: before ? "updated" : "created", expensesUpserted: day.expenses.length, warnings });
      }
      return imported;
    });
    return { imported: result.length, created: result.filter((row) => row.operation === "created").length, updated: result.filter((row) => row.operation === "updated").length, rows: result };
  });

  app.get("/historical-register", { preHandler: authorize(...OPERATIONS) }, async (req, reply) => {
    const query = z.object({ branchId: z.string(), from: z.string().optional(), to: z.string().optional(), take: z.coerce.number().int().min(1).max(500).default(200) }).safeParse(req.query);
    if (!query.success) return reply.code(400).send({ error: "invalid_query", details: query.error.flatten() });
    if (!branchAllowed(req.user!.role, req.user?.branchId, query.data.branchId)) return reply.code(403).send({ error: "forbidden" });
    return prisma.historicalDailySummary.findMany({
      where: {
        branchId: query.data.branchId,
        businessDate: { ...(query.data.from ? { gte: normalizeBusinessDate(query.data.from) } : {}), ...(query.data.to ? { lte: normalizeBusinessDate(query.data.to) } : {}) },
      },
      orderBy: { businessDate: "desc" },
      take: query.data.take,
      include: { expenses: { orderBy: { occurredAt: "asc" } } },
    });
  });

  app.get("/cash-sessions/current", { preHandler: authorize(...OPERATIONS) }, async (req, reply) => {
    const { branchId = req.user?.branchId ?? "main" } = req.query as Record<string, string>;
    if (!branchAllowed(req.user!.role, req.user?.branchId, branchId)) return reply.code(403).send({ error: "forbidden" });
    const session = await prisma.cashSession.findFirst({
      where: { branchId, status: "OPEN" },
      orderBy: { openedAt: "desc" },
    });
    return session ? { ...session, ...(await cashTotals(session)) } : null;
  });

  app.get("/cash-sessions", { preHandler: authorize(...OPERATIONS) }, async (req, reply) => {
    const { branchId = req.user?.branchId ?? "main", take = "30" } = req.query as Record<string, string>;
    if (!branchAllowed(req.user!.role, req.user?.branchId, branchId)) return reply.code(403).send({ error: "forbidden" });
    return prisma.cashSession.findMany({
      where: { branchId },
      orderBy: { openedAt: "desc" },
      take: Math.min(100, Math.max(1, Number(take) || 30)),
    });
  });

  app.post("/cash-sessions/open", { preHandler: authorize(...OPERATIONS) }, async (req, reply) => {
    const body = z.object({
      branchId: z.string(),
      openingCashMinor: z.number().int().nonnegative(),
      openingBreakdown: cashBreakdownSchema,
      openingNote: z.string().trim().max(500).optional(),
    }).parse(req.body);
    if (!branchAllowed(req.user!.role, req.user?.branchId, body.branchId)) return reply.code(403).send({ error: "forbidden" });
    const branch = await prisma.branch.findUnique({ where: { id: body.branchId }, select: { id: true, timezone: true } });
    if (!branch) return reply.code(404).send({ error: "branch_not_found" });
    const countedMinor = breakdownTotalMinor(body.openingBreakdown);
    if (countedMinor !== body.openingCashMinor) {
      return reply.code(409).send({ error: "cash_count_mismatch", countedMinor, declaredMinor: body.openingCashMinor });
    }
    const today = businessDate(new Date(), branch.timezone);
    const open = await prisma.cashSession.findFirst({ where: { branchId: body.branchId, status: "OPEN" } });
    if (open) return reply.code(409).send({ error: "cash_session_already_open", sessionId: open.id });
    try {
      const session = await prisma.cashSession.create({
        data: { ...body, businessDate: today, openedByUserId: req.user!.id },
      });
      await audit("cash_session.open", "CashSession", session.id, { actorUserId: req.user?.id, after: body, ip: req.ip });
      return reply.code(201).send({ ...session, paymentTotalsMinor: {}, cashSalesMinor: 0, upiSalesMinor: 0, cardSalesMinor: 0, cashExpensesMinor: 0, expectedCashMinor: body.openingCashMinor });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") return reply.code(409).send({ error: "cash_session_exists_for_business_date" });
      throw error;
    }
  });

  app.post("/cash-sessions/:id/close", { preHandler: authorize(...OPERATIONS) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      closingCashMinor: z.number().int().nonnegative(),
      closingBreakdown: cashBreakdownSchema.nullable().optional(),
      closingNote: z.string().trim().max(500).optional(),
    }).parse(req.body);
    const session = await prisma.cashSession.findUnique({ where: { id } });
    if (!session) return reply.code(404).send({ error: "cash_session_not_found" });
    if (!branchAllowed(req.user!.role, req.user?.branchId, session.branchId)) return reply.code(403).send({ error: "forbidden" });
    if (session.status !== "OPEN") return reply.code(409).send({ error: "cash_session_already_closed" });
    const countedMinor = body.closingBreakdown ? breakdownTotalMinor(body.closingBreakdown) : body.closingCashMinor;
    if (body.closingBreakdown && countedMinor !== body.closingCashMinor) {
      return reply.code(409).send({ error: "cash_count_mismatch", countedMinor, declaredMinor: body.closingCashMinor });
    }
    const totals = await cashTotals(session);
    const varianceMinor = body.closingCashMinor - totals.expectedCashMinor;
    const updated = await prisma.cashSession.update({
      where: { id },
      data: {
        closingCashMinor: body.closingCashMinor,
        closingBreakdown: body.closingBreakdown ?? { manualAmountMinor: body.closingCashMinor, mode: "manual_total" },
        closingNote: body.closingNote,
        expectedCashMinor: totals.expectedCashMinor,
        varianceMinor,
        closedByUserId: req.user!.id,
        closedAt: new Date(),
        status: "CLOSED",
      },
    });
    await audit("cash_session.close", "CashSession", id, {
      actorUserId: req.user?.id,
      before: { status: session.status },
      after: { ...body, ...totals, varianceMinor },
      ip: req.ip,
    });
    return { ...updated, ...totals };
  });

  app.get("/expenses", { preHandler: authorize(...OPERATIONS) }, async (req, reply) => {
    const { branchId = req.user?.branchId ?? "main", from, to, take = "100" } = req.query as Record<string, string>;
    if (!branchAllowed(req.user!.role, req.user?.branchId, branchId)) return reply.code(403).send({ error: "forbidden" });
    return prisma.expense.findMany({
      where: {
        branchId,
        ...(from || to ? { occurredAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}),
      },
      orderBy: { occurredAt: "desc" },
      take: Math.min(500, Math.max(1, Number(take) || 100)),
    });
  });

  app.post("/expenses", { preHandler: authorize(...OPERATIONS) }, async (req, reply) => {
    const body = z.object({
      branchId: z.string(),
      category: z.string().trim().min(2).max(80),
      description: z.string().trim().min(2).max(500),
      amountMinor: z.number().int().positive(),
      paymentMethod: z.enum(["CASH", "UPI", "CARD"]).default("CASH"),
      vendorName: z.string().trim().max(150).optional(),
      receiptUrl: z.string().trim().max(1000).optional(),
      occurredAt: z.coerce.date().optional(),
    }).parse(req.body);
    if (!branchAllowed(req.user!.role, req.user?.branchId, body.branchId)) return reply.code(403).send({ error: "forbidden" });
    const open = await prisma.cashSession.findFirst({ where: { branchId: body.branchId, status: "OPEN" }, orderBy: { openedAt: "desc" } });
    if (body.paymentMethod === "CASH" && !open) return reply.code(409).send({ error: "open_cash_session_required" });
    const expense = await prisma.expense.create({
      data: { ...body, cashSessionId: open?.id, createdByUserId: req.user!.id },
    });
    await audit("expense.create", "Expense", expense.id, { actorUserId: req.user?.id, after: body, ip: req.ip });
    return reply.code(201).send(expense);
  });
}
