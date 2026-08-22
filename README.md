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

## Local use

```bash
npm run dev
npm run build
```

See `docs/MVP_ACCEPTANCE_CHECKLIST.md` for the brief-to-build verification checklist.
