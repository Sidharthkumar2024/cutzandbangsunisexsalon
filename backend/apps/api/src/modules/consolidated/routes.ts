// Consolidated multi-branch reporting for owners/admins: per-branch sales,
// bills and averages plus a grand total, over a date range. Reception/managers
// are scoped to their own branch elsewhere; this is the cross-branch rollup.

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@cutz/db";
import { authorize } from "../../plugins/auth.js";

export default async function consolidatedRoutes(app: FastifyInstance) {
  app.get("/reports/consolidated", { preHandler: authorize("OWNER", "ADMIN") }, async (req) => {
    const { from, to } = z
      .object({ from: z.string().optional(), to: z.string().optional() })
      .parse(req.query);
    const now = new Date();
    const gte = from ? new Date(from) : new Date(now.getFullYear(), now.getMonth(), 1);
    const lte = to ? new Date(to) : now;

    const branches = await prisma.branch.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, currency: true },
    });

    const invoices = await prisma.invoice.findMany({
      where: { createdAt: { gte, lte }, status: { not: "VOID" } },
      select: { branchId: true, totalMinor: true, paidMinor: true },
    });

    const perBranch = branches.map((b) => {
      const rows = invoices.filter((i) => i.branchId === b.id);
      const salesMinor = rows.reduce((s, i) => s + i.totalMinor, 0);
      const collectedMinor = rows.reduce((s, i) => s + i.paidMinor, 0);
      return {
        branchId: b.id,
        branchName: b.name,
        currency: b.currency,
        bills: rows.length,
        salesMinor,
        collectedMinor,
        avgBillMinor: rows.length ? Math.round(salesMinor / rows.length) : 0,
      };
    });

    const totals = perBranch.reduce(
      (acc, b) => ({
        bills: acc.bills + b.bills,
        salesMinor: acc.salesMinor + b.salesMinor,
        collectedMinor: acc.collectedMinor + b.collectedMinor,
      }),
      { bills: 0, salesMinor: 0, collectedMinor: 0 },
    );

    return {
      range: { from: gte.toISOString(), to: lte.toISOString() },
      branches: perBranch.sort((a, b) => b.salesMinor - a.salesMinor),
      totals: { ...totals, avgBillMinor: totals.bills ? Math.round(totals.salesMinor / totals.bills) : 0 },
    };
  });
}
