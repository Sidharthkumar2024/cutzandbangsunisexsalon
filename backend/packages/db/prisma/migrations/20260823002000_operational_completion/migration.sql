-- Daily drawer denomination audit, workforce policy, biometric bridge,
-- salesperson attribution, and first-party website chat.

ALTER TABLE "Staff"
  ADD COLUMN "designation" TEXT NOT NULL DEFAULT 'Stylist',
  ADD COLUMN "baseSalaryMinor" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "commissionThresholdMinor" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lateGraceMinutes" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN "lateDeductionMinor" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "halfDayAfterMinutes" INTEGER NOT NULL DEFAULT 240,
  ADD COLUMN "overtimePaid" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "biometricCode" TEXT;

CREATE UNIQUE INDEX "Staff_biometricCode_key" ON "Staff"("biometricCode");

ALTER TABLE "Leave"
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "CashSession"
  ADD COLUMN "openingBreakdown" JSONB,
  ADD COLUMN "closingBreakdown" JSONB;

ALTER TABLE "Membership"
  ADD COLUMN "soldByStaffId" TEXT;

ALTER TABLE "CustomerServicePackage"
  ADD COLUMN "soldByStaffId" TEXT;

ALTER TABLE "Membership"
  ADD CONSTRAINT "Membership_soldByStaffId_fkey"
  FOREIGN KEY ("soldByStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CustomerServicePackage"
  ADD CONSTRAINT "CustomerServicePackage_soldByStaffId_fkey"
  FOREIGN KEY ("soldByStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TYPE "ChannelType" ADD VALUE IF NOT EXISTS 'WEB_CHAT';

ALTER TABLE "Conversation"
  ADD COLUMN "externalThreadId" TEXT;

CREATE UNIQUE INDEX "Conversation_externalThreadId_key" ON "Conversation"("externalThreadId");

CREATE TABLE "BiometricDevice" (
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'GENERIC_WEBHOOK',
  "secretHash" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "lastSeenAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BiometricDevice_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BiometricDevice_branchId_isActive_idx" ON "BiometricDevice"("branchId", "isActive");

ALTER TABLE "BiometricDevice"
  ADD CONSTRAINT "BiometricDevice_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Attendance"
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'WEB',
  ADD COLUMN "externalEventId" TEXT,
  ADD COLUMN "biometricDeviceId" TEXT;

CREATE UNIQUE INDEX "Attendance_externalEventId_key" ON "Attendance"("externalEventId");

ALTER TABLE "Attendance"
  ADD CONSTRAINT "Attendance_biometricDeviceId_fkey"
  FOREIGN KEY ("biometricDeviceId") REFERENCES "BiometricDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
