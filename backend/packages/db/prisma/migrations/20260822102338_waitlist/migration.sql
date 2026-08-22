-- CreateEnum
CREATE TYPE "WaitlistStatus" AS ENUM ('WAITING', 'NOTIFIED', 'BOOKED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Waitlist" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "staffId" TEXT,
    "customerId" TEXT,
    "guestName" TEXT,
    "guestPhone" TEXT,
    "guestEmail" TEXT,
    "desiredDate" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "status" "WaitlistStatus" NOT NULL DEFAULT 'WAITING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Waitlist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Waitlist_branchId_status_desiredDate_idx" ON "Waitlist"("branchId", "status", "desiredDate");
