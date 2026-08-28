CREATE TYPE "TenantStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED');
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'SUSPENDED');
CREATE TYPE "BillingInterval" AS ENUM ('MONTHLY', 'YEARLY');
CREATE TYPE "TenantDomainStatus" AS ENUM ('PENDING', 'ACTIVE', 'FAILED');

CREATE TABLE "Plan" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "monthlyPriceMinor" INTEGER NOT NULL DEFAULT 0,
  "yearlyPriceMinor" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "maxBranches" INTEGER NOT NULL DEFAULT 1,
  "maxStaff" INTEGER NOT NULL DEFAULT 5,
  "maxInvoicesPerMonth" INTEGER,
  "features" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Plan_slug_key" ON "Plan"("slug");

INSERT INTO "Plan" (
  "id", "name", "slug", "description", "maxBranches", "maxStaff", "features", "updatedAt"
) VALUES (
  'starter',
  'Starter',
  'starter',
  'Single-branch starter plan for early salon tenants.',
  1,
  8,
  ARRAY['pos', 'customers', 'staff', 'reports', 'email', 'whatsapp']::TEXT[],
  CURRENT_TIMESTAMP
) ON CONFLICT ("id") DO NOTHING;

CREATE TABLE "Tenant" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "status" "TenantStatus" NOT NULL DEFAULT 'TRIAL',
  "primaryDomain" TEXT,
  "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "planId" TEXT,
  "ownerUserId" TEXT,
  "trialEndsAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");
CREATE INDEX "Tenant_status_idx" ON "Tenant"("status");
CREATE INDEX "Tenant_planId_idx" ON "Tenant"("planId");
CREATE INDEX "Tenant_ownerUserId_idx" ON "Tenant"("ownerUserId");

INSERT INTO "Tenant" (
  "id", "name", "slug", "status", "timezone", "currency", "planId", "updatedAt"
) VALUES (
  'default',
  'Cutz & Bangs',
  'cutz-bangs',
  'ACTIVE',
  'Asia/Kolkata',
  'INR',
  'starter',
  CURRENT_TIMESTAMP
) ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "Tenant"
  ADD CONSTRAINT "Tenant_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Branch" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX "Branch_tenantId_idx" ON "Branch"("tenantId");
ALTER TABLE "Branch"
  ADD CONSTRAINT "Branch_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "User" ADD COLUMN "activeTenantId" TEXT;
CREATE INDEX "User_activeTenantId_idx" ON "User"("activeTenantId");
ALTER TABLE "User"
  ADD CONSTRAINT "User_activeTenantId_fkey"
  FOREIGN KEY ("activeTenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "User"
SET "activeTenantId" = 'default'
WHERE "branchId" IS NOT NULL AND "activeTenantId" IS NULL;

UPDATE "Tenant"
SET "ownerUserId" = (
  SELECT "id"
  FROM "User"
  WHERE "role" = 'OWNER' AND "branchId" = 'main' AND "deletedAt" IS NULL
  ORDER BY "createdAt" ASC
  LIMIT 1
)
WHERE "id" = 'default';

ALTER TABLE "Tenant"
  ADD CONSTRAINT "Tenant_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Session" ADD COLUMN "activeTenantId" TEXT;
CREATE INDEX "Session_activeTenantId_idx" ON "Session"("activeTenantId");
ALTER TABLE "Session"
  ADD CONSTRAINT "Session_activeTenantId_fkey"
  FOREIGN KEY ("activeTenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "TenantMembership" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "RoleName" NOT NULL,
  "branchId" TEXT,
  "permissionKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TenantMembership_pkey" PRIMARY KEY ("id")
);

INSERT INTO "TenantMembership" (
  "id", "tenantId", "userId", "role", "branchId", "permissionKeys", "isActive", "updatedAt"
)
SELECT
  'tm_' || "id",
  'default',
  "id",
  "role",
  "branchId",
  "permissionKeys",
  "isActive",
  CURRENT_TIMESTAMP
FROM "User"
WHERE "branchId" IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE UNIQUE INDEX "TenantMembership_tenantId_userId_key" ON "TenantMembership"("tenantId", "userId");
CREATE INDEX "TenantMembership_userId_isActive_idx" ON "TenantMembership"("userId", "isActive");
CREATE INDEX "TenantMembership_tenantId_role_idx" ON "TenantMembership"("tenantId", "role");
CREATE INDEX "TenantMembership_branchId_idx" ON "TenantMembership"("branchId");
ALTER TABLE "TenantMembership"
  ADD CONSTRAINT "TenantMembership_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TenantMembership"
  ADD CONSTRAINT "TenantMembership_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TenantMembership"
  ADD CONSTRAINT "TenantMembership_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "Subscription" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
  "interval" "BillingInterval" NOT NULL DEFAULT 'MONTHLY',
  "provider" TEXT,
  "providerCustomerId" TEXT,
  "providerSubscriptionId" TEXT,
  "currentPeriodStart" TIMESTAMP(3),
  "currentPeriodEnd" TIMESTAMP(3),
  "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Subscription_tenantId_status_idx" ON "Subscription"("tenantId", "status");
CREATE INDEX "Subscription_planId_idx" ON "Subscription"("planId");
CREATE UNIQUE INDEX "Subscription_provider_providerSubscriptionId_key" ON "Subscription"("provider", "providerSubscriptionId");
ALTER TABLE "Subscription"
  ADD CONSTRAINT "Subscription_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Subscription"
  ADD CONSTRAINT "Subscription_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "TenantDomain" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "hostname" TEXT NOT NULL,
  "status" "TenantDomainStatus" NOT NULL DEFAULT 'PENDING',
  "verifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TenantDomain_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TenantDomain_hostname_key" ON "TenantDomain"("hostname");
CREATE INDEX "TenantDomain_tenantId_status_idx" ON "TenantDomain"("tenantId", "status");
ALTER TABLE "TenantDomain"
  ADD CONSTRAINT "TenantDomain_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TenantProviderSetting" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TenantProviderSetting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TenantProviderSetting_tenantId_key_key" ON "TenantProviderSetting"("tenantId", "key");
ALTER TABLE "TenantProviderSetting"
  ADD CONSTRAINT "TenantProviderSetting_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
