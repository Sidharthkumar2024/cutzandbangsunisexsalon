-- Keep customer directory/search screens responsive as salons grow past 100k customers.
CREATE INDEX IF NOT EXISTS "Customer_branchId_deletedAt_createdAt_idx"
  ON "Customer"("branchId", "deletedAt", "createdAt");

CREATE INDEX IF NOT EXISTS "Customer_branchId_deletedAt_visitCount_idx"
  ON "Customer"("branchId", "deletedAt", "visitCount");
