# Cutz & Bangs Unisex Salon

Complete salon website and operations platform for Cutz & Bangs, Sector 15 Dwarka, New Delhi.

## What is included

- Public local-SEO landing page, service catalogue, memberships and online booking
- Owner/admin/manager/reception role-based workspace
- Staff and customer account portals
- Appointment calendar, waitlist and conflict-safe scheduling
- POS with service/product lines, cash/UPI/card/split tenders and PDF invoices
- Customer 360, duplicate phone lookup, historical visits and retention lists
- Admin-managed loyalty points, coupons, memberships and service packages
- Category-wise service management and inventory/stock/vendor-bill workflows
- Opening/closing cash, daily expenses, attendance, commission and payroll summaries
- Unified inbox, official Meta WhatsApp and optional self-hosted WAHA QR connector
- Consent-aware CSV campaigns with paced delivery, images/PDFs and engagement reporting
- SMTP/provider settings, health checks, audit logs and responsive mobile UI
- Dedicated `/admin/login`, HttpOnly browser sessions and Google Authenticator-compatible 2FA with one-time recovery codes

The payment gateway is intentionally excluded. POS records the salon's existing payment methods.

## Repository layout

```text
app/                 Vinext/Next.js Sites frontend
lib/                 Frontend API and content clients
backend/apps/api/    Fastify REST API
backend/apps/worker/ BullMQ background worker
backend/packages/db/ PostgreSQL/Prisma schema and migrations
backend/packages/    Shared provider, queue and type packages
```

The root `app/` is the production frontend. The older `backend/apps/web`
prototype is retained only as reference and is excluded from production builds.

## Run the complete platform locally

Requirements: Node.js 22+, Docker Desktop and Corepack.

```bash
npm run dev
```

`npm run dev:stack` is retained as an alias. Both commands start the complete
stack; `npm run dev:web` is only for frontend work when the API is already
running separately.

The first run installs dependencies, starts PostgreSQL/Redis/WAHA, applies migrations, seeds the local salon, and runs:

- Website: http://localhost:3000
- Admin: http://localhost:3000/admin
- Customer portal: http://localhost:3000/customer
- Staff portal: http://localhost:3000/staff
- API health: http://localhost:4100/health
- Local WAHA service: http://localhost:3005

The local owner is provisioned from `SEED_OWNER_EMAIL` and
`SEED_OWNER_PASSWORD` in `backend/.env.local`. Placeholder
`@cutzbangs.local` accounts are intentionally rejected. Never commit the
owner password, and remove the seed password after the first production login.

## Validate

```bash
npm run build:all
npm run test:backend
```

Production setup, credentials and VPS deployment are documented in `backend/DEPLOYMENT.md` and `backend/CREDENTIALS.md`. Real SMTP, official WhatsApp and object-storage delivery require the salon's provider credentials. The unofficial WhatsApp connector requires a one-time Linked Devices QR scan and can never be guaranteed against account restrictions.

For a VPS that already hosts the GMB growth workload, use `backend/DEPLOYMENT_ISOLATED.md`; it deploys this backend on a separate loopback port and dedicated volumes without modifying the existing application.
