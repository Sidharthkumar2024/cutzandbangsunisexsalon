# MVP acceptance checklist

## Public site and booking

- [x] Premium responsive public website with service, studio, team, membership, and booking entry points.
- [x] Guest booking works without requiring an account.
- [x] Customer can select multiple services in one visit.
- [x] Each selected service receives an eligible staff assignment.
- [x] Time step explains that displayed slots are conflict-free for all assigned staff.
- [x] Booking collects customer details, communication consent, and returns a confirmation reference.
- [x] Mobile layouts preserve the primary booking action.
- [ ] Cloud scheduling API must enforce duration, buffers, shifts, breaks, leave, and booking conflicts server-side.
- [ ] Cloud scheduling API must support waitlist, reschedule, manager override, and audit events.

## Admin, CRM, and operations

- [x] Admin dashboard shows today’s sales, appointments, average bill, new customers, customer mix, and action queues.
- [x] Calendar presents staff schedules, walk-ins, service duration, and appointment status.
- [x] POS supports service tiles, customer context, staff attribution, membership redemption, GST, payment method, and invoice-ready completion.
- [x] Customer list supports search plus New, Repeat, VIP, At-risk, and Lapsed segments.
- [x] Membership screen exposes active balances and an append-only ledger-style history.
- [x] Unified inbox shows WhatsApp conversations, assignment, unread state, customer context, and an approval-based AI reply suggestion.
- [x] Campaign UI covers audience, eligibility, content approval, scheduling, status, bookings, and attributed revenue.
- [x] Reports cover sales, visits, repeat rate, no-shows, revenue trend, and top services.
- [x] Staff and attendance views cover skills, sales/commission context, check-ins, hours, late marks, and leave.
- [x] Booking settings include interval, notice, waitlist, override, and cancellation window controls.
- [ ] Connect admin screens to cloud APIs and role permissions.
- [ ] Add inventory, vendor bills, purchase movements, and low-stock workflows.
- [ ] Add branded PDF invoice generation and email delivery.

## Customer and staff portals

- [x] Customer portal shows upcoming booking, history, preferences/notes, membership balance, ledger access, and invoices.
- [x] Staff portal shows own day, client context, status changes, attendance, sales, and estimated commission.
- [ ] Authenticate each portal and enforce server-side access control.

## Platform and safety

- [x] Front end uses an API-origin environment variable and contains no provider secrets.
- [x] UI includes responsive states, clear empty-state copy in POS, success feedback, and disabled submit states.
- [x] Social preview metadata and a branded 1200×630 image are configured.
- [ ] Cloud stack must implement RBAC, secure sessions, rate limits, upload validation, signed media, webhook verification, and encrypted secrets.
- [ ] Cloud stack must implement persistent volumes, versioned migrations, backups, restore/rollback documentation, soft deletes, and immutable invoice/payment/membership audit records.
- [ ] Add integration and end-to-end tests against stable backend APIs.
