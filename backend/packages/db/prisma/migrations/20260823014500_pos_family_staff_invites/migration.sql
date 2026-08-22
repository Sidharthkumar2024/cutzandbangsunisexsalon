-- Membership-aware family POS and granular staff onboarding.
ALTER TABLE "User"
ADD COLUMN "permissionKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "StaffInvite" (
  "id" TEXT NOT NULL,
  "staffId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "role" "RoleName" NOT NULL,
  "permissionKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "invitedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StaffInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StaffInvite_tokenHash_key" ON "StaffInvite"("tokenHash");
CREATE INDEX "StaffInvite_staffId_expiresAt_idx" ON "StaffInvite"("staffId", "expiresAt");
CREATE INDEX "StaffInvite_email_expiresAt_idx" ON "StaffInvite"("email", "expiresAt");
ALTER TABLE "StaffInvite" ADD CONSTRAINT "StaffInvite_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffInvite" ADD CONSTRAINT "StaffInvite_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CustomerCompanion" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "relation" TEXT,
  "phone" TEXT,
  "notes" TEXT,
  "visitCount" INTEGER NOT NULL DEFAULT 0,
  "lastVisitAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "CustomerCompanion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CustomerCompanion_customerId_deletedAt_idx" ON "CustomerCompanion"("customerId", "deletedAt");
ALTER TABLE "CustomerCompanion" ADD CONSTRAINT "CustomerCompanion_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Invoice" ADD COLUMN "partySize" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "InvoiceItem" ADD COLUMN "companionId" TEXT;
ALTER TABLE "InvoiceItem" ADD COLUMN "servedFor" TEXT;
CREATE INDEX "InvoiceItem_companionId_idx" ON "InvoiceItem"("companionId");
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_companionId_fkey" FOREIGN KEY ("companionId") REFERENCES "CustomerCompanion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
