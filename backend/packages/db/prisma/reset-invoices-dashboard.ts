import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Owner-authorized financial reset.  This deliberately preserves the CRM
 * (customers), service catalogue, staff and future bookings.  It clears only
 * invoice/POS cash history and the derived sales figures shown on dashboard
 * cards and reports.
 */
async function main() {
  if (process.env.CONFIRM_RESET_INVOICES_DASHBOARD !== "yes") {
    console.error("Refusing reset. Re-run with CONFIRM_RESET_INVOICES_DASHBOARD=yes.");
    process.exitCode = 1;
    return;
  }

  const before = await prisma.$transaction([
    prisma.invoice.count(),
    prisma.payment.count(),
    prisma.cashSession.count(),
    prisma.historicalDailySummary.count(),
  ]);

  await prisma.$transaction(async (tx) => {
    // Restrict relations must be removed before invoices.
    await tx.invoiceRefundItem.deleteMany({});
    await tx.invoiceRefund.deleteMany({});
    await tx.paymentReconciliation.deleteMany({});
    await tx.payment.deleteMany({});
    await tx.couponRedemption.deleteMany({});
    await tx.invoiceItem.deleteMany({});
    await tx.invoice.deleteMany({});

    // Cash and imported daily totals are also dashboard sales sources.
    await tx.expense.deleteMany({ where: { cashSessionId: { not: null } } });
    await tx.cashSession.deleteMany({});
    await tx.expense.deleteMany({ where: { historicalSummaryId: { not: null } } });
    await tx.historicalDailySummary.deleteMany({});

    // These values are incremented by invoice completion.  Keep every customer
    // record but remove the now-reset financial/visit aggregates.
    await tx.customer.updateMany({
      data: { totalSpent: 0, visitCount: 0, lastVisitAt: null, loyaltyPoints: 0 },
    });
    await tx.loyaltyLedger.deleteMany({});
  }, { timeout: 60_000 });

  const after = await prisma.$transaction([
    prisma.invoice.count(),
    prisma.payment.count(),
    prisma.cashSession.count(),
    prisma.historicalDailySummary.count(),
  ]);

  console.log(JSON.stringify({
    reset: {
      invoices: before[0] - after[0],
      payments: before[1] - after[1],
      cashSessions: before[2] - after[2],
      historicalDays: before[3] - after[3],
    },
    remaining: { invoices: after[0], payments: after[1], cashSessions: after[2], historicalDays: after[3] },
  }, null, 2));
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
