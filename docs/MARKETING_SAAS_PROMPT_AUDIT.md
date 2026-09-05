# Cutz & Bangs Salon SaaS — Marketing + Loyalty Upgrade Audit

This file converts the supplied master development prompt into an implementation plan for the existing Cutz & Bangs salon SaaS. The prompt is treated as product requirements, not executable instructions.

## Phase 1 audit status

Current architecture already includes:

- Next.js admin/customer/staff UI in `app/`
- Fastify API in `backend/apps/api`
- Prisma/Postgres schema in `backend/packages/db/prisma/schema.prisma`
- Worker queue in `backend/apps/worker`
- Existing CRM/customer, POS, invoice, membership/package, coupons, campaigns, inbox, provider-config, automation, reports, cash drawer and audit modules
- Multi-tenant foundation via `Tenant`, `Branch`, `TenantMembership`, domain and branch-scoped settings

Recently completed:

- Customer historical date model: `customerSince`
- Customer create/update/import support for historical date
- Current date defaults in POS/customer forms
- Customer list/detail display of customer since date
- VPS deployment of customer date workflow

## What is now implemented from the master prompt

- Marketing Control Center page inside the existing admin panel
- Programme ON/OFF toggles saved under branch setting `marketing`
- Live/foundation/planned programme status labels
- Monthly reward budget and max rewards/day guardrail settings
- Google review link setting, with reminder that review rewards must remain separate
- Marketing overview metrics from existing campaigns, coupons and loyalty data
- Existing campaign builder already supports:
  - CRM segment or campaign-only CSV/pasted numbers
  - WhatsApp Official, WhatsApp Unofficial and Email channel choices
  - Campaign-only contacts that are not saved to Customers
  - Call / Website / Location CTA buttons
  - Approval before sending
  - Unofficial WhatsApp pacing/risk display
  - Weekly/monthly repeat campaign ON/OFF
  - Delivery engagement counts

## Gaps that still need deeper engine work

These are not safe to fake in frontend-only UI; they need backend tables, transactions and idempotent event processing:

1. Digital stamp card engine
   - Tables: stamp campaigns, stamp events, customer progress
   - Trigger: paid/completed invoices only
   - Protection: invoice-level unique constraints

2. Spin & Win engine
   - Server-side weighted result selection
   - Segment inventory, daily caps, high-value reward limits
   - Immutable spin result before frontend animation

3. Scratch & Win engine
   - Server-locked result before scratch reveal
   - Per-customer and campaign limits

4. Referral reward engine
   - Referral code/link
   - Reward after referred customer’s qualifying paid invoice
   - Anti self-referral checks

5. Secure customer rewards wallet
   - `/r/{opaque-token}` link
   - No sequential customer IDs
   - OTP for sensitive stored-value actions

6. Event-driven reward processing
   - `INVOICE_PAID`, `INVOICE_CANCELLED`, `PAYMENT_REFUNDED`, `REWARD_REDEEMED`
   - Idempotency keys and audit logs

7. Drawer late-session/reopen flow
   - Preserve closed sessions
   - Admin/manager-only reopen or late session with reason and audit entry

8. Advanced analytics
   - Campaign revenue attribution
   - Issued liability vs redeemed cost
   - ROI and repeat-visit lift

## Recommended next build order

1. Customer rewards wallet token + public wallet page
2. Reward definition/customer reward tables
3. Loyalty settings expansion and invoice-paid reward event
4. Stamp card engine
5. Coupon auto-apply and expiry reminders
6. Spin/Scratch engines with budget guardrails
7. Referral engine
8. Marketing analytics dashboard
9. Regression test suite for duplicate/reward abuse cases

## Safety rules preserved

- Do not create a separate marketing app.
- Do not rewrite working POS/CRM modules unnecessarily.
- Do not overwrite `createdAt` for historical customer data.
- Do not add CSV campaign numbers into the Customers table.
- Do not delete historical progress when a programme is switched OFF.
- Do not decide rewards in frontend JavaScript.
- Do not reward customers for positive Google reviews.
