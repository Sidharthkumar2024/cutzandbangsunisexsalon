# Cutz & Bangs Salon Platform

A responsive front-end MVP for the Cutz & Bangs salon ERP/CRM brief. It includes the public website, a conflict-aware booking flow, admin operations, POS, Customer 360, membership ledger views, inbox, campaigns, reports, and customer/staff portals.

## Experiences

- `/` — public salon website
- `/book` — multi-service guest booking with per-service staff assignment
- `/admin` — owner/reception workspace; use the sidebar to explore all core modules
- `/customer` — appointments, history, membership balance, and invoices
- `/staff` — daily schedule, attendance, client notes, and commission snapshot

## API integration

The Site proxies protected business calls through `BACKEND_API_URL`, keeping the API origin and provider credentials server-side. When the owner signs in, the admin dashboard, calendar, POS, CRM, memberships, services, coupons, inventory, inbox, campaigns, reports, attendance, payroll foundation, settings, system health, and audit history use live backend data. Representative empty-state data remains visible only while the API is not connected.

Admin → **Settings** manages retention and loyalty rules plus encrypted SMTP, official Meta WhatsApp, and a self-hosted WAHA connector. WAHA setup includes session creation, auto-refreshing QR, connected-state, contact sync, a separate webhook secret, a 60–300 second campaign interval, daily cap and delivery window. Admin → **Campaigns** accepts consent-aware CSV contact imports and shows a conservative unofficial-account risk signal. Admin → **System & audit** shows database/Redis/provider health, production-security readiness, delivery failures, and immutable changes.

## Website content management

Admin → **Website content** manages the public homepage through persisted D1 data:

- Ranked “Popular right now” services; row order controls first, second, and third position.
- Testimonials, including quote, customer label, rating, and display order.
- Membership cards, including name, pay amount, service credit, validity, benefits, colour, order, and “most popular” state.

The public homepage reads this content from the same server-side store on every request. The read-only API is `GET /api/site-content`; `PUT /api/admin/content` requires a live OWNER/ADMIN backend bearer session and also creates an audited content revision. The private Site access policy remains a second protection layer.

`CONTENT_API_URL` accepts an optional external content endpoint. When configured, reads and writes go through that endpoint and mirror into D1; if it is unavailable, the UI falls back to D1. D1 remains the durable website-content store, while operational salon data lives in PostgreSQL.

## Local use

```bash
npm run dev
npm run build
```

See `docs/MVP_ACCEPTANCE_CHECKLIST.md` for the brief-to-build verification checklist.
