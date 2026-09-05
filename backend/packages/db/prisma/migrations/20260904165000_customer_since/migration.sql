-- Store the operator-selected customer-since date independently from createdAt.
-- Backfill existing data from the earliest imported history date where possible.
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "customerSince" TIMESTAMP(3);

UPDATE "Customer" c
SET "customerSince" = COALESCE(
  (
    SELECT MIN(h."visitedAt")
    FROM "CustomerHistoryEntry" h
    WHERE h."customerId" = c."id"
  ),
  c."createdAt"
)
WHERE c."customerSince" IS NULL;

ALTER TABLE "Customer" ALTER COLUMN "customerSince" SET NOT NULL;
ALTER TABLE "Customer" ALTER COLUMN "customerSince" SET DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "Customer_branchId_deletedAt_customerSince_idx"
  ON "Customer"("branchId", "deletedAt", "customerSince");
