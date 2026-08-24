-- Persist each returned invoice quantity and its tender/credit breakdown.
CREATE TABLE "InvoiceRefund" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "grossMinor" INTEGER NOT NULL,
    "moneyMinor" INTEGER NOT NULL,
    "membershipMinor" INTEGER NOT NULL,
    "loyaltyMinor" INTEGER NOT NULL,
    "pointsRestored" INTEGER NOT NULL DEFAULT 0,
    "pointsClawedBack" INTEGER NOT NULL DEFAULT 0,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "reason" TEXT NOT NULL,
    "restock" BOOLEAN NOT NULL DEFAULT true,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InvoiceRefund_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InvoiceRefundItem" (
    "id" TEXT NOT NULL,
    "refundId" TEXT NOT NULL,
    "invoiceItemId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "restocked" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "InvoiceRefundItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InvoiceRefund_invoiceId_createdAt_idx" ON "InvoiceRefund"("invoiceId", "createdAt");
CREATE UNIQUE INDEX "InvoiceRefundItem_refundId_invoiceItemId_key" ON "InvoiceRefundItem"("refundId", "invoiceItemId");
CREATE INDEX "InvoiceRefundItem_invoiceItemId_idx" ON "InvoiceRefundItem"("invoiceItemId");

ALTER TABLE "InvoiceRefund"
  ADD CONSTRAINT "InvoiceRefund_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvoiceRefundItem"
  ADD CONSTRAINT "InvoiceRefundItem_refundId_fkey"
  FOREIGN KEY ("refundId") REFERENCES "InvoiceRefund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvoiceRefundItem"
  ADD CONSTRAINT "InvoiceRefundItem_invoiceItemId_fkey"
  FOREIGN KEY ("invoiceItemId") REFERENCES "InvoiceItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The old constraint accidentally allowed only one loyalty REFUND row for an
-- invoice. Preserve EARN replay protection while permitting partial returns.
DROP INDEX IF EXISTS "LoyaltyLedger_invoiceId_type_key";
CREATE INDEX "LoyaltyLedger_invoiceId_type_idx" ON "LoyaltyLedger"("invoiceId", "type");
CREATE UNIQUE INDEX "LoyaltyLedger_invoiceId_singleton_type_key"
  ON "LoyaltyLedger"("invoiceId", "type")
  WHERE "invoiceId" IS NOT NULL AND "type" IN ('EARN', 'REDEEM');
