# Cutz & Bangs Salon Platform

A responsive front-end MVP for the Cutz & Bangs salon ERP/CRM brief. It includes the public website, a conflict-aware booking flow, admin operations, POS, Customer 360, membership ledger views, inbox, campaigns, reports, and customer/staff portals.

## Experiences

- `/` — public salon website
- `/book` — multi-service guest booking with per-service staff assignment
- `/admin` — owner/reception workspace; use the sidebar to explore all core modules
- `/customer` — appointments, history, membership balance, and invoices
- `/staff` — daily schedule, attendance, client notes, and commission snapshot

## API integration

The booking client reads `NEXT_PUBLIC_API_URL`. If it is unset, the included `/api/bookings` route acts as a development adapter. Set the variable to the cloud API origin when that backend is ready; the UI sends a JSON payload containing audience, services with staff assignments, date, time, and customer details.

The screens currently use representative local data so every flow can be reviewed before backend integration. Replace the arrays with API queries without changing the UI contracts.

## Website content management

Admin → **Website content** manages the public homepage through persisted D1 data:

- Ranked “Popular right now” services; row order controls first, second, and third position.
- Testimonials, including quote, customer label, rating, and display order.
- Membership cards, including name, pay amount, service credit, validity, benefits, colour, order, and “most popular” state.

The public homepage reads this content from the same server-side store on every request. The admin API is `GET/PUT /api/admin/content`; the read-only public API is `GET /api/site-content`. The current Sites deployment is owner-only, which protects the admin surface. App authentication must be added before changing the site to public access.

`CONTENT_API_URL` accepts the external cloud backend’s exact matching content endpoint. When configured, reads and writes go through that endpoint and mirror into D1; if it is unavailable, the UI falls back to D1. Until the external endpoint is supplied, D1 is the working backend rather than temporary browser storage.

## Local use

```bash
npm run dev
npm run build
```

See `docs/MVP_ACCEPTANCE_CHECKLIST.md` for the brief-to-build verification checklist.
