-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('PENDING', 'MATCHED', 'MISMATCH');

-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN     "checkOutLat" DOUBLE PRECISION,
ADD COLUMN     "checkOutLng" DOUBLE PRECISION,
ADD COLUMN     "checkOutSelfieUrl" TEXT,
ADD COLUMN     "consentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PaymentReconciliation" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalRef" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'PENDING',
    "paymentId" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentReconciliation_status_createdAt_idx" ON "PaymentReconciliation"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentReconciliation_provider_externalRef_key" ON "PaymentReconciliation"("provider", "externalRef");
