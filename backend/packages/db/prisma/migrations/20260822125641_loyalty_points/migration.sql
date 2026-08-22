-- CreateEnum
CREATE TYPE "LoyaltyLedgerType" AS ENUM ('WELCOME', 'EARN', 'REDEEM', 'ADJUST', 'EXPIRE', 'REFUND');

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'LOYALTY_POINTS';

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "loyaltyPoints" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "LoyaltyLedger" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" "LoyaltyLedgerType" NOT NULL,
    "deltaPoints" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "invoiceId" TEXT,
    "reason" TEXT,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoyaltyLedger_customerId_createdAt_idx" ON "LoyaltyLedger"("customerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyLedger_invoiceId_type_key" ON "LoyaltyLedger"("invoiceId", "type");

-- AddForeignKey
ALTER TABLE "LoyaltyLedger" ADD CONSTRAINT "LoyaltyLedger_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
