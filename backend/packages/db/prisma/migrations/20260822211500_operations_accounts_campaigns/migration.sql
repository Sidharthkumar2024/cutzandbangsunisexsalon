-- Customer history imported from the salon's earlier records.
CREATE TABLE "CustomerHistoryEntry" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "visitedAt" TIMESTAMP(3) NOT NULL,
    "serviceName" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL DEFAULT 0,
    "staffName" TEXT,
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'historical_import',
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerHistoryEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CustomerHistoryEntry_customerId_visitedAt_idx" ON "CustomerHistoryEntry"("customerId", "visitedAt");
ALTER TABLE "CustomerHistoryEntry" ADD CONSTRAINT "CustomerHistoryEntry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Retail pricing and staff commission configuration.
ALTER TABLE "Product" ADD COLUMN "mrpMinor" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN "discountBps" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN "commissionBps" INTEGER NOT NULL DEFAULT 0;

-- One auditable cash drawer per branch and business date.
CREATE TABLE "CashSession" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "businessDate" TEXT NOT NULL,
    "openingCashMinor" INTEGER NOT NULL,
    "closingCashMinor" INTEGER,
    "expectedCashMinor" INTEGER,
    "varianceMinor" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "openingNote" TEXT,
    "closingNote" TEXT,
    "openedByUserId" TEXT NOT NULL,
    "closedByUserId" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    CONSTRAINT "CashSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CashSession_branchId_businessDate_key" ON "CashSession"("branchId", "businessDate");
CREATE INDEX "CashSession_branchId_openedAt_idx" ON "CashSession"("branchId", "openedAt");
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "cashSessionId" TEXT,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "vendorName" TEXT,
    "receiptUrl" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Expense_branchId_occurredAt_idx" ON "Expense"("branchId", "occurredAt");
CREATE INDEX "Expense_cashSessionId_idx" ON "Expense"("cashSessionId");
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_cashSessionId_fkey" FOREIGN KEY ("cashSessionId") REFERENCES "CashSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Campaign creative and delivery/reply attribution.
ALTER TABLE "Campaign" ADD COLUMN "mediaKey" TEXT;
ALTER TABLE "Campaign" ADD COLUMN "mediaType" TEXT;
ALTER TABLE "CampaignRecipient" ADD COLUMN "deliveredAt" TIMESTAMP(3);
ALTER TABLE "CampaignRecipient" ADD COLUMN "readAt" TIMESTAMP(3);
ALTER TABLE "CampaignRecipient" ADD COLUMN "repliedAt" TIMESTAMP(3);
ALTER TABLE "CampaignRecipient" ADD COLUMN "externalId" TEXT;
CREATE UNIQUE INDEX "CampaignRecipient_externalId_key" ON "CampaignRecipient"("externalId");
