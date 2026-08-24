import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "@cutz/db";
import { parseCsv } from "../lib/csv.js";
import { zonedToUtc } from "../lib/tz.js";
import { assertHistoricalCsvRowCounts, assertHistoricalImportSize, expenseImportLineKey, parseHistoricalCsvPair } from "../modules/operations/historical-import.js";

function option(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function inputPath(value: string) {
  return resolve(process.env.INIT_CWD ?? process.cwd(), value);
}

async function main() {
  const dailyPath = option("--daily");
  const expensesPath = option("--expenses");
  if (!dailyPath || !expensesPath) throw new Error("Usage: --daily <daily_register.csv> --expenses <expenses.csv> [--branch-id main] [--actor-email owner@example.com]");
  const branchId = option("--branch-id") ?? "main";
  const actorEmail = option("--actor-email") ?? process.env.IMPORT_ACTOR_EMAIL ?? process.env.SEED_OWNER_EMAIL;
  const [dailyCsv, expensesCsv, branch, actor] = await Promise.all([
    readFile(inputPath(dailyPath), "utf8"),
    readFile(inputPath(expensesPath), "utf8"),
    prisma.branch.findFirst({ where: { id: branchId, deletedAt: null }, select: { id: true, timezone: true } }),
    actorEmail ? prisma.user.findFirst({ where: { email: actorEmail.toLowerCase(), role: { in: ["OWNER", "ADMIN"] }, isActive: true }, select: { id: true } }) : null,
  ]);
  if (!branch) throw new Error(`branch_not_found:${branchId}`);
  if (actorEmail && !actor) throw new Error(`active_owner_or_admin_not_found:${actorEmail}`);
  const dailyRows = parseCsv(dailyCsv);
  const expenseRows = parseCsv(expensesCsv);
  assertHistoricalCsvRowCounts(dailyRows.length, expenseRows.length);
  const days = parseHistoricalCsvPair(dailyRows, expenseRows);
  assertHistoricalImportSize(days);
  const actorUserId = actor?.id;
  const createdByUserId = actorUserId ?? "system:historical-register-import";
  let verifiedDays = 0;
  let reviewOnlyDays = 0;
  let expenseCount = 0;

  await prisma.$transaction(async (tx) => {
    for (const day of days) {
      const existing = await tx.historicalDailySummary.findUnique({ where: { branchId_businessDate: { branchId: branch.id, businessDate: day.businessDate } } });
      const data = {
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
        source: "verified_handwritten_register_csv",
        sourceRef: day.sourceRef,
        importedByUserId: actorUserId,
      };
      const summary = await tx.historicalDailySummary.upsert({
        where: { branchId_businessDate: { branchId: branch.id, businessDate: day.businessDate } },
        create: { branchId: branch.id, businessDate: day.businessDate, ...data },
        update: data,
      });
      if (summary.reviewRequired) reviewOnlyDays += 1;
      else verifiedDays += 1;
      for (const [index, expense] of day.expenses.entries()) {
        const importLineKey = expenseImportLineKey(expense, index);
        await tx.expense.upsert({
          where: { historicalSummaryId_importLineKey: { historicalSummaryId: summary.id, importLineKey } },
          create: {
            branchId: branch.id,
            historicalSummaryId: summary.id,
            importLineKey,
            source: "verified_handwritten_register_csv",
            reviewRequired: false,
            reviewNote: expense.reviewNote,
            category: expense.category,
            description: expense.description,
            amountMinor: expense.amountMinor,
            paymentMethod: expense.paymentMethod,
            vendorName: expense.vendorName,
            occurredAt: zonedToUtc(`${day.businessDate}T12:00:00`, branch.timezone),
            createdByUserId,
          },
          update: {
            reviewRequired: false,
            reviewNote: expense.reviewNote,
            category: expense.category,
            description: expense.description,
            amountMinor: expense.amountMinor,
            paymentMethod: expense.paymentMethod,
            vendorName: expense.vendorName,
          },
        });
        expenseCount += 1;
      }
      await tx.auditLog.create({
        data: {
          actorUserId,
          action: existing ? "historical_register.import_update" : "historical_register.import_create",
          entityType: "HistoricalDailySummary",
          entityId: summary.id,
          before: existing as Prisma.InputJsonValue | undefined,
          after: { businessDate: day.businessDate, reviewRequired: summary.reviewRequired, expenseCount: day.expenses.length, sourceRef: day.sourceRef ?? null },
        },
      });
    }
  });
  console.log(JSON.stringify({ branchId, verifiedDays, reviewOnlyDays, verifiedExpenses: expenseCount, actor: actorEmail ?? "system" }, null, 2));
}

main().finally(() => prisma.$disconnect());
