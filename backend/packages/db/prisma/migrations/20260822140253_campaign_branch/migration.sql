-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "branchId" TEXT NOT NULL DEFAULT 'main';

-- CreateIndex
CREATE INDEX "Campaign_branchId_createdAt_idx" ON "Campaign"("branchId", "createdAt");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
