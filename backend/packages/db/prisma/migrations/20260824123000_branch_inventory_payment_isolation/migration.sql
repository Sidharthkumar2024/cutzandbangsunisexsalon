-- Inventory and reconciliation records are tenant-owned. Existing phase-one
-- data belongs to the original `main` branch; explicit backfills below retain
-- the real branch whenever a related financial/inventory record provides it.
INSERT INTO "Branch" ("id", "name", "updatedAt")
VALUES ('main', 'Main Branch', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "PaymentReconciliation" ADD COLUMN "branchId" TEXT NOT NULL DEFAULT 'main';
ALTER TABLE "Product" ADD COLUMN "branchId" TEXT NOT NULL DEFAULT 'main';
ALTER TABLE "Vendor" ADD COLUMN "branchId" TEXT NOT NULL DEFAULT 'main';
ALTER TABLE "PurchaseBill" ADD COLUMN "branchId" TEXT NOT NULL DEFAULT 'main';
ALTER TABLE "InventoryMovement" ADD COLUMN "branchId" TEXT NOT NULL DEFAULT 'main';

UPDATE "PaymentReconciliation" AS reconciliation
SET "branchId" = invoice."branchId"
FROM "Payment" AS payment
JOIN "Invoice" AS invoice ON invoice."id" = payment."invoiceId"
WHERE reconciliation."paymentId" = payment."id";

UPDATE "PurchaseBill" AS bill
SET "branchId" = vendor."branchId"
FROM "Vendor" AS vendor
WHERE bill."vendorId" = vendor."id";

UPDATE "InventoryMovement" AS movement
SET "branchId" = product."branchId"
FROM "Product" AS product
WHERE movement."productId" = product."id";

DROP INDEX "PaymentReconciliation_provider_externalRef_key";
DROP INDEX "Product_sku_key";
DROP INDEX "Product_barcode_key";

CREATE UNIQUE INDEX "PaymentReconciliation_branchId_provider_externalRef_key"
  ON "PaymentReconciliation"("branchId", "provider", "externalRef");
CREATE INDEX "PaymentReconciliation_branchId_status_createdAt_idx"
  ON "PaymentReconciliation"("branchId", "status", "createdAt");

CREATE UNIQUE INDEX "Product_branchId_sku_key" ON "Product"("branchId", "sku");
CREATE UNIQUE INDEX "Product_branchId_barcode_key" ON "Product"("branchId", "barcode");
CREATE INDEX "Product_branchId_deletedAt_idx" ON "Product"("branchId", "deletedAt");
CREATE INDEX "Vendor_branchId_name_idx" ON "Vendor"("branchId", "name");
CREATE INDEX "PurchaseBill_branchId_createdAt_idx" ON "PurchaseBill"("branchId", "createdAt");
CREATE INDEX "InventoryMovement_branchId_createdAt_idx" ON "InventoryMovement"("branchId", "createdAt");

ALTER TABLE "PaymentReconciliation"
  ADD CONSTRAINT "PaymentReconciliation_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Product"
  ADD CONSTRAINT "Product_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Vendor"
  ADD CONSTRAINT "Vendor_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseBill"
  ADD CONSTRAINT "PurchaseBill_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement"
  ADD CONSTRAINT "InventoryMovement_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
