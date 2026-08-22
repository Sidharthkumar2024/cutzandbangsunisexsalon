import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@cutz/db";
import { authorize } from "../../plugins/auth.js";
import { audit } from "../../lib/audit.js";

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
    const body = z.object({ closingCashMinor: z.number().int().nonnegative(), closingBreakdown: cashBreakdownSchema, closingNote: z.string().trim().max(500).optional() }).parse(req.body);
    const session = await prisma.cashSession.findUnique({ where: { id } });
    if (!session) return reply.code(404).send({ error: "cash_session_not_found" });
    if (!branchAllowed(req.user!.role, req.user?.branchId, session.branchId)) return reply.code(403).send({ error: "forbidden" });
    if (session.status !== "OPEN") return reply.code(409).send({ error: "cash_session_already_closed" });
    const countedMinor = breakdownTotalMinor(body.closingBreakdown);
    if (countedMinor !== body.closingCashMinor) {
      return reply.code(409).send({ error: "cash_count_mismatch", countedMinor, declaredMinor: body.closingCashMinor });
    }
    const totals = await cashTotals(session);
    if (body.closingCashMinor !== totals.expectedCashMinor) {
      return reply.code(409).send({
        error: "cash_drawer_mismatch",
        expectedCashMinor: totals.expectedCashMinor,
        countedCashMinor: body.closingCashMinor,
        varianceMinor: body.closingCashMinor - totals.expectedCashMinor,
      });
    }
    const updated = await prisma.cashSession.update({
      where: { id },
      data: {
        closingCashMinor: body.closingCashMinor,
        closingNote: body.closingNote,
        expectedCashMinor: totals.expectedCashMinor,
        varianceMinor: 0,
        closedByUserId: req.user!.id,
        closedAt: new Date(),
        status: "CLOSED",
      },
    });
    await audit("cash_session.close", "CashSession", id, {
      actorUserId: req.user?.id,
      before: { status: session.status },
      after: { ...body, ...totals, varianceMinor: 0 },
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
