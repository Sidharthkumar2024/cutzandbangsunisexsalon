# Cutz & Bangs — Salon ERP / CRM / POS / Booking

Backend-first monorepo per the Claude Build Brief. API-first and mobile-ready:
the web app and any future Android/iOS app talk to the same versioned API.

## Stack

| Layer     | Choice |
|-----------|--------|
| Web       | Next.js (public site + admin/staff/customer portals) |
| API       | Fastify + TypeScript, versioned under `/api/v1` |
| Worker    | BullMQ on Redis (reminders, email, campaigns, OCR, messaging) |
| Database  | PostgreSQL + Prisma migrations |
| Cache/Q   | Redis |
| Storage   | S3-compatible / Cloudinary (signed URLs) |
| Proxy     | Caddy (automatic HTTPS) |
| Deploy    | Docker Compose on a VPS |

## Layout

```
apps/
  api/     Fastify API — auth/RBAC, bookings, POS, memberships, CRM
  worker/  Background jobs (idempotent reminders, etc.)
  web/     Next.js (placeholder — Day 1 scaffold)
packages/
  db/      Prisma schema, client, seed
  types/   Shared types + provider adapter interfaces
deploy/    Caddyfile
scripts/   backup.sh / restore.sh
```

## Design decisions worth knowing

- **Money is integer minor units (paise).** No floats anywhere in the money
  path — see `apps/api/src/lib/money.ts`. GST is basis-point based.
- **Financial history is append-only.** Membership/wallet balances are the sum
  of ledger deltas (`packages/db` + `modules/memberships/ledger.ts`); invoices
  and payments are immutable once issued. Corrections are new ledger entries.
- **Booking never double-books.** The overlap check runs inside a `SERIALIZABLE`
  transaction (`modules/bookings/`), so concurrent requests can't both win;
  the loser gets `409 conflict_retry`. Availability accounts for skill, shift,
  break, leave, buffer and existing bookings, in the salon's timezone.
- **Reminders are idempotent.** Deterministic BullMQ jobIds + a unique
  `AutomationRun.dedupeKey` mean a worker restart never double-sends.
- **Providers are swappable.** `MessagingProvider`, `EmailProvider`,
  `StorageProvider`, `AIProvider`, `PaymentProvider` (`packages/types`). The
  optional unofficial WhatsApp integration uses a private self-hosted WAHA
  container with its own API key, webhook secret and persisted session volume.
  It contains no anti-ban or platform-evasion logic.
- **Provider credentials are admin-managed and encrypted.** SMTP, official Meta
  WhatsApp and the optional isolated connector can be configured per branch
  through protected APIs. AES-256-GCM ciphertext is stored in `settings`; secret
  values are never returned to the browser. Production requires an independent
  `SECRETS_KEY`.
- **Deploys never touch data.** DB is a named Docker volume; `up --build`
  replaces app containers only. Migrations are versioned; back up before risky
  ones.

## Local dev

```bash
pnpm install
cp .env.example .env            # then edit
docker compose up -d db redis   # just the datastores locally
pnpm db:generate && pnpm db:migrate && pnpm db:seed
pnpm dev:api                    # API on :4000
pnpm dev:worker                 # worker
pnpm test                       # money + booking unit tests
```

Seed creates an owner (`owner@cutzbangs.local` / `changeme123`), one staff, one
service, and a "pay 3000 get 5000" membership plan.

## Deploy (VPS)

```bash
cp .env.example .env            # set DOMAIN + strong secrets
docker compose up -d --build
docker compose exec api node ../../packages/db/node_modules/.bin/prisma migrate deploy
```

Nightly backups: cron `scripts/backup.sh` (set `BACKUP_BUCKET` for off-server).
Restore with `scripts/restore.sh <dump.sql.gz>`.

## Portals & navigation

- **Public:** Home / Services / Pricing / Team / Membership / Gallery / Book / Contact
- **Admin:** Dashboard / Calendar / POS / Customers / Staff / Services / Memberships / Inventory / Inbox / Campaigns / Reports / Attendance / Payroll / Settings
- **Staff:** My Day / Calendar / Customers / Check-in-out / Services / Commission / Notifications
- **Customer:** Book / My Appointments / History / Membership / Invoices / Profile

## Build status vs brief

**Done & verified end-to-end (P0 + most of P1):**
- DB schema for all core modules (42 tables), migrations, seed
- Auth/RBAC (argon2, opaque sessions), login/register/logout/me
- Booking conflict engine — availability query + SERIALIZABLE booking
  (double-book returns 409, confirmed against the running DB)
- POS/invoice with GST (integer paise), split payments, PDF (pdfkit) + email send
- Admin-managed loyalty points: welcome grants, immutable adjustment/earn/redeem ledger,
  POS tender redemption and idempotent earning on fully paid invoices
- Category/service catalogue management plus percentage and fixed-value coupons
  with dates, minimum spend, caps and global/per-customer usage limits
- Membership append-only ledger — enroll grants credit, redemption reconciles
  (cached balance == ledger sum, checked via `/verify`)
- CRM: customers CRUD, Customer 360 timeline, CSV import + phone/email dedupe,
  repeat/lapsed/VIP/member segmentation
- Inventory: products, stock movements, vendor bills with confirm-before-post
- Reports: today dashboard + range report (payment mix, top services/staff, new/repeat/lapsed)
- Retention dashboard: timezone-correct daily/10-day/15-day/month sales, ticket
  range, best daily sale, repeat rate and configurable 30/45/60/90-day inactive list
- Campaigns: AI draft → approval gate → worker send; audience snapshot by segment
- Inbox + WhatsApp official adapter (signed webhook, idempotent inbound ingest)
- WAHA adapter: admin-controlled session lifecycle, auto-refresh QR, contact sync,
  inbound webhook ingest and STOP opt-out handling
- Worker: idempotent reminders, email and recipient-level paced campaign jobs
- Provider adapters: Email (SMTP), Storage (S3), AI (Anthropic), WhatsApp, Payment (UPI)
- Protected provider configuration/status/test APIs for SMTP, official Meta
  WhatsApp and the isolated unofficial connector
- Protected system health and audit APIs: PostgreSQL, Redis, provider readiness,
  security posture, failure counts and searchable actor/change history
- Next.js web — public home/services/**booking flow**, and full admin portal:
  login, dashboard, calendar (with status transitions), POS, customers,
  memberships (enroll), inventory (add + stock adjust + low-stock flag),
  inbox (reply/internal note), campaigns (AI draft → approve → send)
- Docker Compose + Caddy + backup/restore; unit tests (money, booking, segmentation)
- Attendance: consented selfie uploads, GPS geofence enforcement, check-in/out audit trail
- Payroll foundation: present days, worked/late/overtime minutes, service revenue and commission
- Vendor-bill AI: validated image input → OCR candidate → human review → confirmed stock movements
- Multi-branch APIs and branch-scoped settings; customer/staff portal APIs enforce server-owned identity
- Branch-scoped campaigns, inbox, waitlist, reports and invoice delivery; public
  booking/waitlist rate limits; strict webhook verification and HTTP security headers
- Payment intent + idempotent reconciliation records; validated media uploads and signed access
- Local media is a persistent Docker volume and is included in backup/restore; S3 remains the production path

**Verified live through the browser UI:** booking flow (service → stylist → time
→ confirm); appointment status transition (PENDING→CONFIRMED); dashboard sales
(₹472 = ₹400 + 18% GST); membership redemption ledger reconciliation; product
add with low-stock flag; campaign create → approve → worker sends to the correct
segment audience; and a reminder job firing on schedule from the worker.

**Remaining deployment dependency:** configure a real VPS/domain, production
PostgreSQL/Redis, S3 and provider credentials, then set the salon Site's
`BACKEND_API_URL` to that public HTTPS API. The code-level P2 foundations
(vendor OCR, geofenced attendance, payroll, multi-branch and reconciliation)
are implemented; real gateway/provider certification depends on external accounts.

> The brief's "3-day MVP" is a priority order, not a calendar. The P0/P1 core is
> built and working; P2 and UI breadth are the remaining runway.
