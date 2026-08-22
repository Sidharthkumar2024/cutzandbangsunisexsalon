-- CreateEnum
CREATE TYPE "ServicePackageLedgerType" AS ENUM ('GRANT', 'REDEEM', 'ADJUST', 'EXPIRE', 'REFUND');

-- CreateTable
CREATE TABLE "ServicePackagePlan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "validityDays" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ServicePackagePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServicePackageItem" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "ServicePackageItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerServicePackage" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerServicePackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServicePackageLedger" (
    "id" TEXT NOT NULL,
    "customerServicePackageId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "type" "ServicePackageLedgerType" NOT NULL,
    "qtyDelta" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "invoiceId" TEXT,
    "reason" TEXT,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServicePackageLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServicePackageItem_packageId_serviceId_key" ON "ServicePackageItem"("packageId", "serviceId");

-- CreateIndex
CREATE INDEX "CustomerServicePackage_customerId_isActive_idx" ON "CustomerServicePackage"("customerId", "isActive");

-- CreateIndex
CREATE INDEX "ServicePackageLedger_customerServicePackageId_serviceId_cre_idx" ON "ServicePackageLedger"("customerServicePackageId", "serviceId", "createdAt");

-- AddForeignKey
ALTER TABLE "ServicePackageItem" ADD CONSTRAINT "ServicePackageItem_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "ServicePackagePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicePackageItem" ADD CONSTRAINT "ServicePackageItem_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerServicePackage" ADD CONSTRAINT "CustomerServicePackage_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "ServicePackagePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerServicePackage" ADD CONSTRAINT "CustomerServicePackage_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicePackageLedger" ADD CONSTRAINT "ServicePackageLedger_customerServicePackageId_fkey" FOREIGN KEY ("customerServicePackageId") REFERENCES "CustomerServicePackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicePackageLedger" ADD CONSTRAINT "ServicePackageLedger_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
