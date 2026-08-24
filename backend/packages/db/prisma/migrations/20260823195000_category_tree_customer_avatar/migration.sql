ALTER TABLE "Customer" ADD COLUMN "avatarUrl" TEXT;

ALTER TABLE "ServiceCategory" ADD COLUMN "parentId" TEXT;

ALTER TABLE "ServiceCategory"
  ADD CONSTRAINT "ServiceCategory_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "ServiceCategory"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "ServiceCategory_parentId_idx" ON "ServiceCategory"("parentId");
