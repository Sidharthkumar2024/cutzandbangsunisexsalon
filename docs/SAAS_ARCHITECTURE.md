# Sallon SaaS Architecture

This document is the starting blueprint for converting the current single-brand salon system into a multi-salon SaaS product.

## Product goal

Sallon SaaS should let many independent salons run their own POS, bookings, customers, staff, inventory, expenses, invoices, WhatsApp/email automation, and reports from one hosted platform.

The platform owner runs the SaaS. Each salon gets its own isolated account, settings, users, branches, data, and branding.

## Core hierarchy

```text
Sallon SaaS Platform
├── Platform super admin
│   ├── Manage salons
│   ├── Manage plans and subscriptions
│   ├── View usage and health
│   └── Support / audit tools
│
├── Salon tenant
│   ├── Owner account
│   ├── One or more branches / shops
│   ├── Staff and permissions
│   ├── Customers and memberships
│   ├── POS, invoices, expenses, inventory
│   ├── WhatsApp / SMTP / storage integrations
│   └── Reports and automations
│
└── Shared infrastructure
    ├── PostgreSQL
    ├── Redis / queues
    ├── Object storage
    ├── Email provider
    └── WhatsApp providers
```

## Data isolation model

Use one shared PostgreSQL database with strict tenant scoping.

Every salon-owned row must have a `tenantId`. A branch is only an outlet inside a tenant.

```text
Tenant
└── Branch
    ├── Staff
    ├── Customer
    ├── Service
    ├── Appointment
    ├── Invoice
    ├── Payment
    ├── Expense
    ├── Inventory
    ├── Coupon
    └── Provider settings
```

Do not rely on `branchId` alone for security. Backend requests must resolve an active tenant first, then resolve branch access inside that tenant.

## New core tables

### Tenant

- `id`
- `name`
- `slug`
- `status`: `TRIAL`, `ACTIVE`, `PAST_DUE`, `SUSPENDED`
- `primaryDomain`
- `timezone`
- `currency`
- `planId`
- `trialEndsAt`
- `createdAt`
- `updatedAt`
- `deletedAt`

### TenantMembership

- `id`
- `tenantId`
- `userId`
- `role`: `OWNER`, `ADMIN`, `MANAGER`, `RECEPTION`, `STAFF`
- `branchId` optional, for branch-bound staff
- `permissionKeys`
- `isActive`

### PlatformUser

Can be represented by `User.role = SUPERADMIN | SUPPORT`, or by a separate table if platform access must be isolated from salon users.

### Plan

- `id`
- `name`
- `monthlyPriceMinor`
- `yearlyPriceMinor`
- `maxBranches`
- `maxStaff`
- `maxInvoicesPerMonth`
- `features`

### Subscription

- `id`
- `tenantId`
- `planId`
- `provider`
- `providerCustomerId`
- `providerSubscriptionId`
- `status`
- `currentPeriodStart`
- `currentPeriodEnd`

### TenantDomain

- `id`
- `tenantId`
- `hostname`
- `status`: `PENDING`, `ACTIVE`, `FAILED`
- `verifiedAt`

### TenantProviderSettings

Salon-specific encrypted settings for:

- SMTP
- Official WhatsApp / Meta
- Unofficial WhatsApp / WAHA
- Cloudinary / storage
- Payment provider

## Auth and routing

### Login flow

```text
User enters email + password
→ Backend validates credentials
→ Backend lists accessible tenants
→ If one tenant: open it
→ If many tenants: show tenant switcher
→ Session contains userId, activeTenantId, activeBranchId, role
```

### URL strategy

Start with path-based tenancy:

```text
/app/:tenantSlug/dashboard
/app/:tenantSlug/pos
/app/:tenantSlug/customers
/book/:tenantSlug
```

Then add custom domains:

```text
salon-domain.com → tenant resolved from TenantDomain
```

## Backend rules

- Every protected API request must resolve `tenantId`.
- Every query for salon data must include `tenantId`.
- Branch access is checked after tenant access.
- Platform super admin endpoints must never share code paths with salon owner data writes unless explicitly scoped.
- All cross-tenant actions must be audited.
- Provider credentials must be encrypted per tenant.

## Frontend changes

- Replace hardcoded `branchId=main`.
- Add tenant selector.
- Add branch selector.
- Add platform super admin app.
- Add salon onboarding.
- Add plan / billing pages.
- Add per-salon branding and invoice theme settings.
- Add tenant-aware public booking website.

## Migration phases

### Phase 1 — SaaS foundation

- Add `Tenant`, `TenantMembership`, `Plan`, `Subscription`, `TenantDomain`.
- Create default tenant for the current salon.
- Attach existing branch/data to that tenant.
- Add `tenantId` to all salon-owned tables.
- Create tenant scope helper.

### Phase 2 — Auth and permissions

- Update session to carry active tenant.
- Add tenant switcher.
- Add branch switcher.
- Separate platform super admin from salon owner/admin.

### Phase 3 — Tenant-safe API conversion

- Convert all routes from branch-only scope to tenant + branch scope.
- Add tests for cross-tenant data leakage.
- Add audit coverage for tenant admin actions.

### Phase 4 — SaaS onboarding

- Create salon signup.
- Create first branch.
- Create owner account.
- Seed default services/templates.
- Upload salon logo and invoice branding.

### Phase 5 — Billing and plan limits

- Add plans.
- Enforce branch/staff/invoice limits.
- Add trial expiry and suspension.
- Add payment provider integration.

### Phase 6 — Multi-domain and production hardening

- Add custom domain mapping.
- Add tenant-aware public booking pages.
- Add backups, monitoring, usage analytics, and admin support tools.

## MVP definition

The first SaaS-ready MVP is complete when:

- Two salons can use the same deployment.
- Their customers, invoices, staff, services, settings, and reports are fully isolated.
- Each salon owner can manage their own branches and staff.
- The platform owner can create, suspend, and inspect salons.
- No route can access another tenant's data by changing `branchId`.

## Estimated build time

For a full-fledged SaaS product from the current codebase:

- SaaS foundation and migration: 5–8 days
- Auth, tenant switcher, branch switcher: 4–6 days
- API tenant-safety conversion and tests: 7–12 days
- Super admin panel: 4–7 days
- Salon onboarding and branding: 4–7 days
- Billing/plans: 4–8 days
- Production hardening, QA, backups, monitoring: 5–10 days

Realistic total: 4–7 weeks for a strong production MVP.

Polished commercial SaaS with billing, custom domains, onboarding, support tools, audits, and stable automation: 8–12 weeks.
