# Phase 1 (P0) acceptance checklist

Payroll, live payment-gateway reconciliation, vendor-bill OCR, GPS selfie attendance, advanced AI, multi-branch, official WhatsApp activation, campaigns and inventory expansion are intentionally deferred from this Phase 1 checklist.

## Public site and booking

- [x] Premium responsive public website with service, studio, team, membership, and booking entry points.
- [x] Guest booking works without requiring an account.
- [x] Customer can select multiple services in one visit.
- [x] Each selected service receives an eligible staff assignment.
- [x] Time step explains that displayed slots are conflict-free for all assigned staff.
- [x] Booking collects customer details, communication consent, and returns a confirmation reference.
- [x] Mobile layouts preserve the primary booking action.
- [x] “Popular right now” services are persisted and managed from Admin → Website content, including first/second/third ordering.
- [x] Testimonials are persisted and managed from the admin panel.
- [x] Three public membership cards are persisted and admin-managed, including ₹3,000→₹5,000 and ₹10,000→₹15,000 plans.
- [x] Scheduling API enforces duration, buffers, shifts, breaks, leave, eligible staff, multi-service sequencing, and booking conflicts server-side.
- [x] Scheduling API supports waitlist, reschedule, manager override, and audit events.

## Admin, CRM, and operations

- [x] Admin dashboard shows today’s sales, appointments, average bill, new customers, customer mix, and action queues.
- [x] Calendar presents live appointments and creates walk-ins through the same conflict-safe engine.
- [x] POS supports customer selection, service tiles, staff attribution, ledger-backed membership redemption, GST, Cash/UPI/Card/Split manual marking, PDF invoice generation, and idempotent email delivery.
- [x] Customer list supports search plus New, Repeat, VIP, At-risk, and Lapsed segments.
- [x] Membership screen enrols a customer and creates append-only opening-credit ledger history.
- [x] Unified inbox loads complete live history and stores replies/internal notes through the provider interface.
- [x] Campaign UI covers audience, eligibility, content approval, scheduling, status, bookings, and attributed revenue.
- [x] Reports cover sales, visits, repeat rate, no-shows, revenue trend, and top services.
- [x] Staff and attendance views cover skills, sales/commission context, check-ins, hours, late marks, and leave.
- [x] Booking settings include interval, notice, waitlist, override, and cancellation window controls.
- [x] Website content APIs read/write D1-backed services, testimonials, and membership plans.
- [x] Admin dashboard, calendar, POS, customers, Customer 360, services, staff, memberships and inbox are connected to role-protected backend APIs.
- [x] Add inventory, vendor bills, purchase movements, and low-stock workflows.
- [x] Add branded PDF invoice generation and email delivery.

## Customer and staff portals

- [x] Customer portal shows upcoming booking, history, preferences/notes, membership balance, ledger access, and invoices.
- [x] Staff portal shows own day, client context, status changes, attendance, sales, and estimated commission.
- [x] Authenticate each portal and enforce server-side access control.

## Platform and safety

- [x] Front end uses an API-origin environment variable and contains no provider secrets.
- [x] UI includes responsive states, clear empty-state copy in POS, success feedback, and disabled submit states.
- [x] Social preview metadata and a branded 1200×630 image are configured.
- [x] Cloud stack code implements RBAC, secure sessions, rate limits, upload validation, signed media, webhook verification, and container-separated secrets.
- [x] Cloud stack code implements persistent volumes, versioned migrations, backups, restore/rollback documentation, soft deletes, and immutable invoice/payment/membership audit records.
- [x] Add integration and end-to-end tests against stable backend APIs.

## Production deployment dependency

- [ ] Deploy the backend stack to a real VPS/domain and configure the private Site `BACKEND_API_URL` with its public HTTPS origin.
- [ ] Configure production SMTP and storage credentials for Phase 1 email/invoice delivery.
- [ ] Configure WhatsApp, AI and payment-provider credentials only when their later phases begin.
