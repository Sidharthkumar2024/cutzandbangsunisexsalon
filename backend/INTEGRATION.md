# Integration — Codex `salon` UI ⇄ Claude `cutz-bangs` backend

Two agents, two repos, one product (per `Cutz_Bangs_MASTER_Development_Architecture.pdf`):

| Repo | Owner | Role |
|------|-------|------|
| `~/Desktop/salon` | ChatGPT Codex | Product UI/UX (Next.js on vinext/Cloudflare). Premium public site + admin/staff/customer portals. Built against stable backend APIs. |
| `~/Desktop/cutz-bangs` | Claude | Backend-first: Fastify API + worker + Postgres/Prisma + Redis, provider adapters, Docker/VPS. |

The shared source of truth for status is `salon/docs/MVP_ACCEPTANCE_CHECKLIST.md`
— `[x]` = UI done, `[ ]` = cloud/backend + integration (this repo's job).

## Wired: public booking (live, verified)

Codex's `salon/lib/client-api.ts` posts to `${NEXT_PUBLIC_API_URL}/api/bookings`:

```json
{ "audience": "All services",
  "services": [{ "id": "cut-style", "staffId": "arjun" }],
  "date": "Mon, 24 Aug", "time": "4:30 PM",
  "customer": { "name": "...", "phone": "...", "email": "..." } }
```
→ returns `{ "reference": "CB-XXXXXX", "status": "confirmed" }`.

> **Codex now proxies server-side.** `salon/app/api/bookings/route.ts` forwards to
> `${BACKEND_API_URL ?? NEXT_PUBLIC_API_URL}/api/bookings` and reads `result.id`
> as the customer reference. So set `salon/.env.local` →
> `BACKEND_API_URL=http://localhost:4100` (server-side, no browser CORS needed),
> and this backend returns `{ id, reference, status, appointmentId }` where `id`
> is the friendly `CB-XXXXXX` code. Verified: POST to salon's own
> `http://localhost:3000/api/bookings` → proxied to this backend → `CB-ATS02A`.

This backend speaks that **exact** contract via `apps/api/src/modules/integration/routes.ts`
(mounted at `/api/bookings`, i.e. outside `/api/v1`). It:
- resolves the display date/time (year omitted → next future occurrence) into a
  UTC instant in the salon timezone (`apps/api/src/lib/tz.ts`),
- chains multiple services sequentially per customer using real durations+buffers,
- runs the **real conflict-checked booking engine** inside a SERIALIZABLE txn
  (skill, shift, break, leave, overlap; double-book → 409),
- auto-confirms and schedules idempotent reminders.

So Codex's UI needs **zero code changes** — only its env pointed here. The catalog
IDs match because `packages/db/prisma/seed-codex.ts` seeds services (`cut-style`,
`global-colour`, …) and staff (`riya`, `arjun`, `meher`) with the same slug IDs
and prices/durations/eligibility the UI uses.

### To connect locally
1. Backend: `docker compose up -d db redis` (or the local pg:5433 / redis:6382),
   `pnpm db:generate && pnpm db:migrate && pnpm db:seed && pnpm db:seed:codex`,
   then run the API (default here: port 4100) and worker.
2. Salon: set `salon/.env.local` → `NEXT_PUBLIC_API_URL=http://localhost:4100`, `npm run dev`.
3. CORS: the API's `CORS_ORIGIN` must include the salon origin (e.g.
   `http://localhost:3000`). Dev tip: `CORS_ORIGIN=*` reflects any origin.

Verified end-to-end: a booking submitted from the salon origin (`http://localhost:3000`)
persists a real conflict-checked appointment (e.g. `Browser E2E` → Arjun,
2026-08-25 15:30 IST, CONFIRMED) and returns a reference.

## Next integration points (APIs already exist in this repo)

These salon screens currently use placeholder arrays; wiring them means pointing
their fetches at these endpoints (all under `/api/v1`, bearer auth):

| Salon screen | Backend endpoint(s) |
|---|---|
| Services / pricing / team | `GET /services`, `GET /staff`, `GET /availability` |
| Admin dashboard | `GET /reports/today`, `GET /reports/range` |
| Calendar | `GET /appointments`, `PATCH /appointments/:id/status`, `PATCH /appointments/:id/reschedule` |
| Waitlist / overrides | `POST /waitlist`, `GET /waitlist`, `POST /waitlist/:id/promote`; `POST /bookings {override:true}` (manager+) |
| POS | `POST /pos/checkout`, `POST /invoices/:id/pdf`, `POST /invoices/:id/send` |
| Customers / 360 | `GET /customers`, `GET /customers/:id`, `POST /customers/import` |
| Memberships | `GET /membership-plans`, `POST /memberships`, `POST /memberships/:id/adjust` |
| Inventory | `GET /products`, `POST /products`, `POST /purchase-bills(/:id/confirm)` |
| Inbox | `GET /inbox`, `GET /inbox/:id`, `POST /inbox/:id/messages`, WA webhook |
| Campaigns | `POST /campaigns/draft`, `POST /campaigns`, `POST /campaigns/:id/approve` |
| Auth (portals) | `POST /auth/login|register|logout`, `GET /auth/me` |
| Attendance / payroll | `POST /attendance/check-in|check-out`, `GET /attendance`, `GET /payroll/summary` |
| Vendor bill AI | `POST /purchase-bills/ocr`, `PATCH /purchase-bills/:id/review`, `POST /purchase-bills/:id/confirm` |
| Platform | `GET/POST /branches`, `GET/PUT /settings/:branchId`, `GET /audit-logs` |
| Secure portals | `GET /portal/customer/overview`, `GET /portal/staff/my-day` |
| Media / payments | `POST /media`, `GET /media/url`, `POST /payments/intent|reconciliation` |

## Coordination note
Codex has begun adding a Cloudflare **D1**-backed store for website CMS content
(`/api/admin/content`: services, testimonials, membership cards). That's fine as a
lightweight content CMS for the marketing site, but the **ERP system of record**
(bookings, POS, invoices, ledgers, inventory, CRM, audit) lives here in Postgres.
Keep those roles distinct to avoid two divergent sources of truth for the same data.
