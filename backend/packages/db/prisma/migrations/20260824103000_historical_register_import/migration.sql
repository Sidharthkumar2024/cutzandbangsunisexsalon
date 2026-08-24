-- Handwritten register imports are kept separate from POS invoices. This avoids
-- manufacturing customer bills while still preserving auditable historical totals.
CREATE TABLE "HistoricalDailySummary" (
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "businessDate" TEXT NOT NULL,
  "openingCashMinor" INTEGER,
  "cashSalesMinor" INTEGER,
  "upiSalesMinor" INTEGER,
  "cardSalesMinor" INTEGER,
  "totalSalesMinor" INTEGER,
  "availableCashMinor" INTEGER,
  "cashAdjustmentMinor" INTEGER,
  "reviewRequired" BOOLEAN NOT NULL DEFAULT false,
  "reviewNote" TEXT,
  "notes" TEXT,
  "source" TEXT NOT NULL DEFAULT 'handwritten_register',
  "sourceRef" TEXT,
  "importedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HistoricalDailySummary_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Expense" ADD COLUMN "historicalSummaryId" TEXT;
ALTER TABLE "Expense" ADD COLUMN "importLineKey" TEXT;
ALTER TABLE "Expense" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "Expense" ADD COLUMN "reviewRequired" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Expense" ADD COLUMN "reviewNote" TEXT;

CREATE UNIQUE INDEX "HistoricalDailySummary_branchId_businessDate_key" ON "HistoricalDailySummary"("branchId", "businessDate");
CREATE INDEX "HistoricalDailySummary_branchId_businessDate_idx" ON "HistoricalDailySummary"("branchId", "businessDate");
CREATE UNIQUE INDEX "Expense_historicalSummaryId_importLineKey_key" ON "Expense"("historicalSummaryId", "importLineKey");
CREATE INDEX "Expense_historicalSummaryId_idx" ON "Expense"("historicalSummaryId");

ALTER TABLE "HistoricalDailySummary" ADD CONSTRAINT "HistoricalDailySummary_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_historicalSummaryId_fkey" FOREIGN KEY ("historicalSummaryId") REFERENCES "HistoricalDailySummary"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
