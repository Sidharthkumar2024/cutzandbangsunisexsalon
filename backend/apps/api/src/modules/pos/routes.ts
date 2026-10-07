import { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@cutz/db";
import { authorize } from "../../plugins/auth.js";
import { computeLine, computeInvoiceTotals, allocateProportional } from "../../lib/money.js";
import { redeem, InsufficientCreditError } from "../memberships/ledger.js";
import { renderInvoicePdf } from "../../lib/invoicePdf.js";
import { invoiceEmail, isRestrictedWahaHost, providers, WAHA_INLINE_MEDIA_MAX_BYTES } from "@cutz/providers";
import { enqueueEmail } from "@cutz/queue";
import { audit } from "../../lib/audit.js";
import { applyMarketingRewardBonuses, calculateRedemptionMinor, earnForPaidInvoice, getLoyaltyRules, postLoyaltyEntry } from "../loyalty/ledger.js";
import { consumeCoupon, quoteCoupon } from "../coupons/engine.js";
import { applyProviderSettings } from "../provider-config/config.js";
import {
  fillAutomationTemplate,
  normalizeReceiptAutomationSettings,
  plainTextEmailHtml,
} from "../../lib/automationSettings.js";
import { zonedToUtc } from "../../lib/tz.js";

const paymentSchema = z.object({
  method: z.enum(["CASH", "UPI", "CARD", "SPLIT", "MEMBERSHIP_CREDIT", "WALLET"]),
  amountMinor: z.number().int().positive(),
  reference: z.string().optional(),
  membershipId: z.string().optional(),
});
const moneyText = (minor: number) => `₹${(minor / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const invoicePdfPrefix = "invoices/v3/";
const googleReviewUrl = "https://maps.app.goo.gl/1FgtMd6URf8T6G53A";

function customerPortalUrl(phone?: string | null) {
  const base = process.env.PUBLIC_APP_URL?.replace(/\/$/u, "");
  if (!base) return undefined;
  const query = phone ? `?phone=${encodeURIComponent(phone)}` : "";
  return `${base}/customer${query}`;
}

function invoiceWhatsAppBody(input: {
  customerPhone?: string | null;
  invoiceNumber: string;
  totalMinor: number;
  earnedPoints?: number;
  marketingRewardPoints?: number;
  balanceAfter?: number | null;
}) {
  const earned = (input.earnedPoints ?? 0) + (input.marketingRewardPoints ?? 0);
  const lines = [
    `Thank you for visiting Cutz & Bangs.`,
    `Invoice ${input.invoiceNumber} · ${moneyText(input.totalMinor)}`,
  ];
  if (earned > 0) lines.push(`Loyalty earned: +${earned} points`);
  if (typeof input.balanceAfter === "number") lines.push(`Current loyalty balance: ${input.balanceAfter} points`);
  const portal = customerPortalUrl(input.customerPhone);
  if (portal) lines.push(`View invoices, stamp card and rewards: ${portal}`);
  lines.push(`Loved your visit? Please review us: ${googleReviewUrl}`);
  return lines.join("\n");
}

function inlineInvoicePdfError(bytes: Buffer) {
  if (bytes.length > WAHA_INLINE_MEDIA_MAX_BYTES) return "invoice_pdf_too_large_for_inline_whatsapp";
  if (bytes.length < 5 || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") return "invoice_pdf_invalid";
  return null;
}

function invoiceWhatsAppMediaError(
  channel: "WHATSAPP_OFFICIAL" | "WHATSAPP_UNOFFICIAL",
  value: string,
) {
  try {
    const url = new URL(value);
    if (!url.hostname || !["http:", "https:"].includes(url.protocol)) return "invoice_public_url_required";
    // Meta must be able to retrieve the document over the public internet.
    // WAHA may intentionally use a private HTTP address on the same network.
    if (channel === "WHATSAPP_OFFICIAL" && url.protocol !== "https:") return "invoice_https_url_required";
    if (channel === "WHATSAPP_OFFICIAL" && isRestrictedWahaHost(url.hostname)) return "invoice_public_url_required";
    return null;
  } catch {
    return "invoice_public_url_required";
  }
}

function invoiceSendAuditPayload(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as { channel?: unknown; recipient?: unknown; status?: unknown };
}

function membershipPlanAllowsService(
  plan: { eligibleCategoryIds: string[]; excludedServiceIds: string[] },
  service: { id: string; categoryId: string } | undefined,
) {
  if (!service) return false;
  if (plan.excludedServiceIds.includes(service.id)) return false;
  return plan.eligibleCategoryIds.length === 0 || plan.eligibleCategoryIds.includes(service.categoryId);
}

async function alreadyDeliveredInvoice(id: string, channel: "EMAIL" | "WHATSAPP_OFFICIAL" | "WHATSAPP_UNOFFICIAL") {
  const logs = await prisma.auditLog.findMany({
    where: { action: "invoice.send", entityType: "Invoice", entityId: id },
    orderBy: { createdAt: "desc" },
    take: 25,
  });
  return logs.find((log) => {
    const after = invoiceSendAuditPayload(log.after);
    return (
      after.channel === channel &&
      (after.status === "sent" ||
        after.status === "queued" ||
        after.status === "already_queued" ||
        after.status === undefined)
    );
  });
}

const invoiceArchiveQuerySchema = z.object({
  branchId: z.string().trim().min(1).optional(),
  customerId: z.string().trim().min(1).optional(),
  status: z.enum(["DRAFT", "ISSUED", "PAID", "PARTIALLY_PAID", "VOID"]).optional(),
  q: z.string().trim().max(120).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

function invoiceArchiveWhere(
  query: z.infer<typeof invoiceArchiveQuerySchema>,
  user: NonNullable<FastifyRequest["user"]>,
): Prisma.InvoiceWhereInput {
  const requestedBranch = ["OWNER", "ADMIN"].includes(user.role) ? query.branchId : user.branchId ?? undefined;
  const search = query.q?.trim();
  const dateRange = query.from || query.to
    ? { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) }
    : undefined;
  return {
    ...(requestedBranch ? { branchId: requestedBranch } : {}),
    ...(query.customerId ? { customerId: query.customerId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(dateRange
      ? { OR: [{ issuedAt: dateRange }, { issuedAt: null, createdAt: dateRange }] }
      : {}),
    ...(search
      ? {
          OR: [
            { number: { contains: search, mode: "insensitive" } },
            { customer: { is: { name: { contains: search, mode: "insensitive" } } } },
            { customer: { is: { phone: { contains: search } } } },
            { customer: { is: { email: { contains: search, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };
}

const posSchema = z.object({
  branchId: z.string(),
  customerId: z.string().optional(),
  appointmentId: z.string().optional(),
  lines: z
    .array(
      z.object({
        kind: z.enum(["service", "product"]),
        serviceId: z.string().optional(),
        productId: z.string().optional(),
        staffId: z.string().optional(),
        companionId: z.string().optional(),
        description: z.string(),
        qty: z.number().int().positive().default(1),
        unitMinor: z.number().int().nonnegative(),
        discountMinor: z.number().int().nonnegative().default(0),
        taxRateBps: z.number().int().nonnegative().default(0),
      }),
    )
    .min(1),
  payments: z.array(paymentSchema).default([]),
  packageRedemptions: z
    .array(
      z.object({
        customerServicePackageId: z.string(),
        serviceId: z.string(),
        qty: z.number().int().positive().default(1),
      }),
    )
    .default([]),
  loyaltyPointsToRedeem: z.number().int().nonnegative().default(0),
  couponCode: z.string().trim().min(3).max(24).optional(),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional(),
});

async function nextInvoiceNumber(tx: Prisma.TransactionClient): Promise<string> {
  // Serialize number allocation so concurrent reception checkouts cannot both
  // claim the same human-facing invoice number.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('cutz_invoice_number')) IS NULL AS locked`;
  const year = new Date().getUTCFullYear();
  const prefix = `CB-${year}-`;
  // A count is not a sequence: deleting or importing an invoice can leave a
  // higher number behind and make count + 1 collide with it. The fixed-width
  // suffix keeps descending lexicographic order aligned with numeric order.
  const latest = await tx.invoice.findFirst({
    where: { number: { startsWith: prefix } },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const suffix = latest?.number.slice(prefix.length) ?? "0";
  const lastSequence = Number.parseInt(suffix, 10);
  const nextSequence = Number.isSafeInteger(lastSequence) && lastSequence >= 0 ? lastSequence + 1 : 1;
  return `${prefix}${String(nextSequence).padStart(6, "0")}`;
}

export default async function posRoutes(app: FastifyInstance) {
  app.post("/invoices/reset", { preHandler: authorize("OWNER") }, async (req) => {
    const { branchId, confirmation } = z.object({ branchId: z.string().min(1), confirmation: z.literal("CLEAR INVOICES") }).parse(req.body);
    const result = await prisma.$transaction(async (tx) => {
      const backup = await tx.invoice.findMany({ where: { branchId }, include: { items: true, payments: true, refunds: { include: { items: true } }, couponRedemption: true } });
      await tx.setting.create({ data: { key: `invoice-reset-backup:${branchId}:${Date.now()}`, value: JSON.parse(JSON.stringify(backup)) as Prisma.InputJsonValue } });
      const invoices = await tx.invoice.findMany({ where: { branchId }, select: { id: true, customerId: true, totalMinor: true, status: true } });
      const ids = invoices.map((invoice) => invoice.id);
      const refunds = await tx.invoiceRefund.findMany({ where: { invoiceId: { in: ids } }, select: { id: true } });
      await tx.invoiceRefundItem.deleteMany({ where: { refundId: { in: refunds.map((refund) => refund.id) } } });
      await tx.invoiceRefund.deleteMany({ where: { invoiceId: { in: ids } } });
      const payments = await tx.payment.findMany({ where: { invoiceId: { in: ids } }, select: { id: true } });
      await tx.paymentReconciliation.updateMany({ where: { paymentId: { in: payments.map((payment) => payment.id) } }, data: { paymentId: null } });
      await tx.payment.deleteMany({ where: { invoiceId: { in: ids } } });
      await tx.couponRedemption.deleteMany({ where: { invoiceId: { in: ids } } });
      await tx.invoiceItem.deleteMany({ where: { invoiceId: { in: ids } } });
      await tx.invoice.deleteMany({ where: { id: { in: ids } } });
      for (const customerId of [...new Set(invoices.flatMap((invoice) => invoice.customerId ? [invoice.customerId] : []))]) {
        const remaining = await tx.invoice.aggregate({ where: { customerId, status: "PAID" }, _sum: { totalMinor: true }, _count: true });
        const latest = await tx.invoice.findFirst({ where: { customerId, status: "PAID" }, orderBy: { issuedAt: "desc" }, select: { issuedAt: true } });
        await tx.customer.update({ where: { id: customerId }, data: { totalSpent: remaining._sum.totalMinor ?? 0, visitCount: remaining._count, lastVisitAt: latest?.issuedAt ?? null } });
      }
      await audit("invoice.reset", "Branch", branchId, { actorUserId: req.user?.id, after: { count: ids.length }, ip: req.ip }, tx);
      return { cleared: ids.length };
    }, { timeout: 60000 });
    return result;
  });
  app.get(
    "/invoices",
    { preHandler: authorize("OWNER", "ADMIN", "MANAGER", "RECEPTION") },
    async (req) => {
      const { branchId, customerId, take = "50" } = req.query as Record<string, string>;
      const scopedBranch = req.user?.role === "OWNER" || req.user?.role === "ADMIN" ? branchId : req.user?.branchId;
      return prisma.invoice.findMany({
        where: {
          ...(scopedBranch ? { branchId: scopedBranch } : {}),
          ...(customerId ? { customerId } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: Math.min(100, Math.max(1, Number(take) || 50)),
        include: { customer: { select: { id: true, name: true, email: true, phone: true } }, items: true, payments: true },
      });
    },
  );

  // Paginated, filterable invoice archive for finance/admin screens. The
  // existing /invoices endpoint stays array-shaped for backwards compatibility.
  app.get(
    "/invoices/archive",
    { preHandler: authorize("OWNER", "ADMIN", "MANAGER", "RECEPTION") },
    async (req, reply) => {
      const parsed = invoiceArchiveQuerySchema.safeParse(req.query);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_query", details: parsed.error.flatten() });
      const query = parsed.data;
      if (query.from && query.to && query.from > query.to) {
        return reply.code(400).send({ error: "invalid_date_range" });
      }
      const where = invoiceArchiveWhere(query, req.user!);
      const [rows, total, totals] = await Promise.all([
        prisma.invoice.findMany({
          where,
          orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: {
            id: true,
            number: true,
            status: true,
            subtotalMinor: true,
            discountMinor: true,
            taxMinor: true,
            totalMinor: true,
            paidMinor: true,
            pdfUrl: true,
            issuedAt: true,
            createdAt: true,
            customer: { select: { id: true, name: true, email: true, phone: true } },
          },
        }),
        prisma.invoice.count({ where }),
        prisma.invoice.aggregate({ where, _sum: { totalMinor: true, paidMinor: true } }),
      ]);
      const totalMinor = totals._sum.totalMinor ?? 0;
      const paidMinor = totals._sum.paidMinor ?? 0;
      return {
        items: rows.map(({ pdfUrl, ...invoice }) => ({
          ...invoice,
          pdfReady: Boolean(pdfUrl),
          downloadPath: `/api/v1/invoices/${invoice.id}/pdf?download=1`,
        })),
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
        summary: { totalMinor, paidMinor, balanceMinor: Math.max(0, totalMinor - paidMinor) },
      };
    },
  );

  app.get(
    "/invoices/:id",
    { preHandler: authorize("OWNER", "ADMIN", "MANAGER", "RECEPTION") },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const invoice = await prisma.invoice.findUnique({
        where: { id },
        include: { customer: true, appointment: true, branch: true, items: true, payments: true },
      });
      if (!invoice) return reply.code(404).send({ error: "not_found" });
      if (!['OWNER', 'ADMIN'].includes(req.user!.role) && req.user!.branchId !== invoice.branchId) {
        return reply.code(403).send({ error: "forbidden" });
      }
      return invoice;
    },
  );

  app.post(
    "/pos/checkout",
    { preHandler: authorize("OWNER", "ADMIN", "MANAGER", "RECEPTION") },
    async (req, reply) => {
      const parsed = posSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid", details: parsed.error.flatten() });
      const body = parsed.data;
      if (!["OWNER", "ADMIN"].includes(req.user!.role) && req.user!.branchId !== body.branchId) {
        return reply.code(403).send({ error: "forbidden" });
      }
      const serviceIds = [...new Set(body.lines.filter((line) => line.kind === "service").map((line) => line.serviceId).filter((id): id is string => Boolean(id)))];
      const productIds = [...new Set(body.lines.filter((line) => line.kind === "product").map((line) => line.productId).filter((id): id is string => Boolean(id)))];
      const companionIds = [...new Set(body.lines.flatMap((line) => line.companionId ? [line.companionId] : []))];
      if (serviceIds.length !== new Set(body.lines.filter((line) => line.kind === "service").map((line) => line.serviceId)).size || body.lines.some((line) => line.kind === "service" && !line.serviceId)) {
        return reply.code(400).send({ error: "service_id_required" });
      }
      if (productIds.length !== new Set(body.lines.filter((line) => line.kind === "product").map((line) => line.productId)).size || body.lines.some((line) => line.kind === "product" && !line.productId)) {
        return reply.code(400).send({ error: "product_id_required" });
      }
      const [branch, customer, appointment, staffCount, companions, services, products, cashSession] = await Promise.all([
        prisma.branch.findFirst({ where: { id: body.branchId, deletedAt: null }, select: { id: true, timezone: true } }),
        body.customerId ? prisma.customer.findFirst({ where: { id: body.customerId, branchId: body.branchId, deletedAt: null }, select: { id: true, name: true, email: true, phone: true, emailConsent: true, waConsent: true, loyaltyPoints: true } }) : null,
        body.appointmentId ? prisma.appointment.findFirst({ where: { id: body.appointmentId, branchId: body.branchId, deletedAt: null }, select: { id: true } }) : null,
        prisma.staff.count({ where: { id: { in: body.lines.flatMap((line) => line.staffId ? [line.staffId] : []) }, branchId: body.branchId, deletedAt: null } }),
        prisma.customerCompanion.findMany({
          where: { id: { in: companionIds }, customerId: body.customerId ?? "__none__", deletedAt: null },
          select: { id: true, name: true },
        }),
        prisma.service.findMany({ where: { id: { in: serviceIds }, isActive: true, deletedAt: null } }),
        prisma.product.findMany({ where: { id: { in: productIds }, branchId: body.branchId, isActive: true, deletedAt: null } }),
        prisma.cashSession.findFirst({ where: { branchId: body.branchId, status: "OPEN" }, select: { id: true, businessDate: true } }),
      ]);
      if (!branch) return reply.code(404).send({ error: "branch_not_found" });
      if (!cashSession) return reply.code(409).send({ error: "open_cash_session_required" });
      if (body.customerId && !customer) return reply.code(400).send({ error: "customer_branch_mismatch" });
      if (companionIds.length && !body.customerId) return reply.code(400).send({ error: "customer_required_for_companion" });
      if (companions.length !== companionIds.length) return reply.code(400).send({ error: "companion_customer_mismatch" });
      if (body.packageRedemptions.length && !body.customerId) return reply.code(400).send({ error: "customer_required_for_package" });
      if (body.loyaltyPointsToRedeem && !body.customerId) return reply.code(400).send({ error: "customer_required_for_loyalty" });
      if (body.appointmentId && !appointment) return reply.code(400).send({ error: "appointment_branch_mismatch" });
      const uniqueStaffIds = new Set(body.lines.flatMap((line) => line.staffId ? [line.staffId] : []));
      if (staffCount !== uniqueStaffIds.size) return reply.code(400).send({ error: "staff_branch_mismatch" });
      if (services.length !== serviceIds.length) return reply.code(400).send({ error: "service_not_found" });
      if (products.length !== productIds.length) return reply.code(400).send({ error: "product_not_found" });
      const invoiceBusinessDate = body.businessDate ?? cashSession.businessDate;
      const issuedAt = zonedToUtc(`${invoiceBusinessDate}T12:00:00`, branch.timezone);

      const serviceById = new Map(services.map((service) => [service.id, service]));
      const productById = new Map(products.map((product) => [product.id, product]));
      const companionById = new Map(companions.map((companion) => [companion.id, companion]));
      const redemptionRemaining = new Map<string, number>();
      for (const redemption of body.packageRedemptions) {
        redemptionRemaining.set(redemption.serviceId, (redemptionRemaining.get(redemption.serviceId) ?? 0) + redemption.qty);
      }

      let computed = body.lines.map((line) => {
        const catalog = line.kind === "service" ? serviceById.get(line.serviceId!) : productById.get(line.productId!);
        const unitMinor =
          line.kind === "service"
            ? line.unitMinor
            : productById.get(line.productId!)!.sellMinor;
        const remaining = line.kind === "service" ? redemptionRemaining.get(line.serviceId!) ?? 0 : 0;
        const redeemedQty = Math.min(line.qty, remaining);
        if (redeemedQty) redemptionRemaining.set(line.serviceId!, remaining - redeemedQty);
        const input = {
          ...line,
          description: catalog!.name,
          servedFor: line.companionId ? companionById.get(line.companionId)?.name : body.customerId ? "Primary customer" : "Walk-in",
          unitMinor,
          // Cutz & Bangs currently bills catalogue prices as the final payable
          // price. Do not add a separate GST/tax amount in POS, even if older
          // clients or catalogue rows still carry taxRateBps.
          taxRateBps: 0,
          // Service MRP may be adjusted at the billing table for client-specific
          // pricing. Package redemptions cover the edited service price so the
          // customer is not charged a residual amount for a covered service.
          discountMinor:
            line.kind === "service"
              ? redeemedQty * unitMinor
              : 0,
        };
        return {
          input,
          calc: computeLine({
            qty: input.qty,
            unitMinor: input.unitMinor,
            discountMinor: input.discountMinor,
            taxRateBps: input.taxRateBps,
          }),
        };
      });
      if ([...redemptionRemaining.values()].some((qty) => qty > 0)) {
        return reply.code(400).send({ error: "package_service_not_in_cart" });
      }
      const baseTotals = computeInvoiceTotals(computed.map((c) => c.calc));
      let couponQuote: Awaited<ReturnType<typeof quoteCoupon>> | null = null;
      if (body.couponCode) {
        try {
          couponQuote = await quoteCoupon(prisma, {
            branchId: body.branchId,
            code: body.couponCode,
            amountMinor: baseTotals.totalMinor,
            customerId: body.customerId,
          });
        } catch (error) {
          return reply.code(409).send({ error: error instanceof Error ? error.message : "coupon_invalid" });
        }
      }
      const couponDiscountMinor = couponQuote?.discountMinor ?? 0;
      // Apply an invoice-level coupon by allocating it across line bases. A
      // largest-remainder split keeps the allocations summing exactly to the
      // coupon value while POS tax remains zero.
      if (couponDiscountMinor > 0) {
        const bases = computed.map((c) => Math.max(0, c.calc.qty * c.calc.unitMinor - c.calc.discountMinor));
        const alloc = allocateProportional(bases, couponDiscountMinor);
        computed = computed.map((c, i) => {
          if (!alloc[i]) return c;
          const input = { ...c.input, discountMinor: c.input.discountMinor + alloc[i] };
          return { input, calc: computeLine({ qty: input.qty, unitMinor: input.unitMinor, discountMinor: input.discountMinor, taxRateBps: input.taxRateBps }) };
        });
      }
      const totals = computeInvoiceTotals(computed.map((c) => c.calc));

      // WALLET tender is not backed by a wallet-credit flow yet — reject it so
      // an invoice can never be "paid" with credit that was never funded.
      if (body.payments.some((p) => p.method === "WALLET")) {
        return reply.code(400).send({ error: "wallet_payment_not_supported" });
      }
      // Membership credit must belong to THIS invoice's customer (prevents
      // draining another customer's / branch's membership).
      const membershipPayments = body.payments.filter((p) => p.method === "MEMBERSHIP_CREDIT");
      if (membershipPayments.length) {
        if (!body.customerId) return reply.code(400).send({ error: "customer_required_for_membership_credit" });
        if (membershipPayments.some((p) => !p.membershipId)) return reply.code(400).send({ error: "membership_id_required" });
        const ids = [...new Set(membershipPayments.map((p) => p.membershipId as string))];
        const owned = await prisma.membership.findMany({
          where: { id: { in: ids }, customerId: body.customerId, isActive: true },
          include: { plan: true },
        });
        if (owned.length !== ids.length) return reply.code(403).send({ error: "membership_not_owned_by_customer" });
        const requestedByMembershipId = new Map<string, number>();
        for (const payment of membershipPayments) {
          requestedByMembershipId.set(
            payment.membershipId!,
            (requestedByMembershipId.get(payment.membershipId!) ?? 0) + payment.amountMinor,
          );
        }
        for (const membership of owned) {
          const eligibleMinor = computed.reduce((sum, line) => {
            if (line.input.kind !== "service" || !line.input.serviceId) return sum;
            return membershipPlanAllowsService(membership.plan, serviceById.get(line.input.serviceId))
              ? sum + line.calc.lineTotalMinor
              : sum;
          }, 0);
          const requestedMinor = requestedByMembershipId.get(membership.id) ?? 0;
          if (requestedMinor > eligibleMinor) {
            return reply.code(400).send({
              error: "membership_service_not_eligible",
              eligibleMinor,
              requestedMinor,
            });
          }
        }
      }

      const loyaltyRules = await getLoyaltyRules(prisma, body.branchId);
      if (body.loyaltyPointsToRedeem > 0) {
        if (!loyaltyRules.enabled) return reply.code(409).send({ error: "loyalty_disabled" });
        if (body.loyaltyPointsToRedeem < loyaltyRules.minRedeemPoints) {
          return reply.code(409).send({ error: "loyalty_minimum_not_met", minRedeemPoints: loyaltyRules.minRedeemPoints });
        }
        if (body.loyaltyPointsToRedeem > (customer?.loyaltyPoints ?? 0)) {
          return reply.code(409).send({ error: "insufficient_loyalty_points", balancePoints: customer?.loyaltyPoints ?? 0 });
        }
      }
      const loyaltyRedemptionMinor = calculateRedemptionMinor(body.loyaltyPointsToRedeem, loyaltyRules);
      if (loyaltyRedemptionMinor > totals.totalMinor) {
        return reply.code(409).send({ error: "loyalty_redemption_exceeds_total", maximumMinor: totals.totalMinor });
      }

      const paidMinor = body.payments.reduce((s, p) => s + p.amountMinor, 0) + loyaltyRedemptionMinor;
      if (paidMinor > totals.totalMinor) {
        return reply.code(400).send({ error: "overpayment", totalMinor: totals.totalMinor, paidMinor });
      }
      const servicePriceOverrides = computed.flatMap((line) => {
        if (line.input.kind !== "service" || !line.input.serviceId) return [];
        const catalogPriceMinor = serviceById.get(line.input.serviceId)?.priceMinor;
        return catalogPriceMinor !== undefined && catalogPriceMinor !== line.input.unitMinor
          ? [
              {
                serviceId: line.input.serviceId,
                description: line.input.description,
                catalogPriceMinor,
                billedUnitMinor: line.input.unitMinor,
              },
            ]
          : [];
      });

      try {
        const result = await prisma.$transaction(async (tx) => {
          const number = await nextInvoiceNumber(tx);
          const status =
            totals.totalMinor === 0 || paidMinor >= totals.totalMinor ? "PAID" : paidMinor === 0 ? "ISSUED" : "PARTIALLY_PAID";

          const inv = await tx.invoice.create({
            data: {
              number,
              branchId: body.branchId,
              customerId: body.customerId,
              appointmentId: body.appointmentId,
              status,
              subtotalMinor: totals.subtotalMinor,
              discountMinor: totals.discountMinor,
              taxMinor: totals.taxMinor,
              totalMinor: totals.totalMinor,
              paidMinor,
              partySize: Math.max(1, companionIds.length + (body.customerId ? 1 : 0)),
              issuedAt,
              items: {
                create: computed.map((c) => ({
                  kind: c.input.kind,
                  serviceId: c.input.serviceId,
                  productId: c.input.productId,
                  staffId: c.input.staffId,
                  companionId: c.input.companionId,
                  servedFor: c.input.servedFor,
                  description: c.input.description,
                  qty: c.calc.qty,
                  unitMinor: c.calc.unitMinor,
                  discountMinor: c.calc.discountMinor,
                  taxRateBps: c.calc.taxRateBps,
                  taxMinor: c.calc.taxMinor,
                  lineTotalMinor: c.calc.lineTotalMinor,
                })),
              },
            },
          });

          if (couponQuote && body.couponCode) {
            await consumeCoupon(tx, {
              couponId: couponQuote.coupon.id,
              branchId: body.branchId,
              code: body.couponCode,
              amountMinor: baseTotals.totalMinor,
              discountMinor: couponDiscountMinor,
              invoiceId: inv.id,
              customerId: body.customerId,
            });
          }

          // Product lines atomically reduce inventory and append immutable
          // SALE movements. Advisory locks avoid two tills overselling the same
          // product during concurrent checkouts.
          const soldByProduct = new Map<string, number>();
          for (const line of computed) {
            if (line.input.kind === "product" && line.input.productId) {
              soldByProduct.set(line.input.productId, (soldByProduct.get(line.input.productId) ?? 0) + line.calc.qty);
            }
          }
          for (const [productId, qty] of [...soldByProduct.entries()].sort(([a], [b]) => a.localeCompare(b))) {
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${productId})) IS NULL AS locked`;
            const product = await tx.product.findFirst({ where: { id: productId, branchId: body.branchId } });
            if (!product) throw new Error("product_not_found");
            if (product.stockQty < qty) throw new Error(`insufficient_stock:${product.name}`);
            const stockAfter = product.stockQty - qty;
            await tx.product.update({ where: { id: productId }, data: { stockQty: stockAfter } });
            await tx.inventoryMovement.create({
              data: { branchId: body.branchId, productId, reason: "SALE", qtyDelta: -qty, stockAfter, refType: "invoice", refId: inv.id, actorUserId: req.user?.id },
            });
          }

          for (const redemption of body.packageRedemptions) {
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${redemption.customerServicePackageId})) IS NULL AS locked`;
            const customerPackage = await tx.customerServicePackage.findUnique({
              where: { id: redemption.customerServicePackageId },
              include: { package: { include: { items: true } } },
            });
            if (!customerPackage || !customerPackage.isActive || customerPackage.customerId !== body.customerId) {
              throw new Error("package_not_found");
            }
            if (customerPackage.expiresAt && customerPackage.expiresAt < new Date()) throw new Error("package_expired");
            if (!customerPackage.package.items.some((item) => item.serviceId === redemption.serviceId)) {
              throw new Error("service_not_in_package");
            }
            const aggregate = await tx.servicePackageLedger.aggregate({
              where: { customerServicePackageId: customerPackage.id, serviceId: redemption.serviceId },
              _sum: { qtyDelta: true },
            });
            const balance = aggregate._sum.qtyDelta ?? 0;
            if (balance < redemption.qty) throw new Error("insufficient_package_balance");
            await tx.servicePackageLedger.create({
              data: {
                customerServicePackageId: customerPackage.id,
                serviceId: redemption.serviceId,
                type: "REDEEM",
                qtyDelta: -redemption.qty,
                balanceAfter: balance - redemption.qty,
                invoiceId: inv.id,
                reason: "POS service package redemption",
                actorUserId: req.user?.id,
              },
            });
          }

          for (const p of body.payments) {
            await tx.payment.create({
              data: {
                invoiceId: inv.id,
                method: p.method,
                amountMinor: p.amountMinor,
                reference: p.reference,
                membershipId: p.membershipId,
                createdByUserId: req.user?.id,
              },
            });
            // Membership credit redemption posts to the append-only ledger.
            if (p.method === "MEMBERSHIP_CREDIT") {
              if (!p.membershipId) throw new Error("membership_id_required");
              await redeem(tx, p.membershipId, p.amountMinor, inv.id, req.user?.id);
            }
          }

          let loyaltyBalanceAfter = customer?.loyaltyPoints ?? null;
          if (body.customerId && body.loyaltyPointsToRedeem > 0) {
            const redemption = await postLoyaltyEntry(tx, {
              customerId: body.customerId,
              type: "REDEEM",
              deltaPoints: -body.loyaltyPointsToRedeem,
              invoiceId: inv.id,
              reason: "Points redeemed at POS",
              actorUserId: req.user?.id,
            });
            loyaltyBalanceAfter = redemption.balanceAfter;
            await tx.payment.create({
              data: {
                invoiceId: inv.id,
                method: "LOYALTY_POINTS",
                amountMinor: loyaltyRedemptionMinor,
                reference: `${body.loyaltyPointsToRedeem} points`,
                createdByUserId: req.user?.id,
              },
            });
          }

          // Update customer 360 rollups (denormalized cache).
          if (body.customerId) {
            await tx.customer.update({
              where: { id: body.customerId },
              data: {
                lastVisitAt: new Date(),
                visitCount: { increment: 1 },
                totalSpent: { increment: totals.totalMinor },
              },
            });
          }
          for (const companionId of companionIds) {
            await tx.customerCompanion.update({
              where: { id: companionId },
              data: { visitCount: { increment: 1 }, lastVisitAt: new Date() },
            });
          }

          const earned = body.customerId && status === "PAID"
            ? await earnForPaidInvoice(tx, {
                invoiceId: inv.id,
                customerId: body.customerId,
                eligibleMinor: Math.max(0, totals.totalMinor - loyaltyRedemptionMinor),
                rules: loyaltyRules,
                actorUserId: req.user?.id,
              })
            : { points: 0, balanceAfter: loyaltyBalanceAfter };
          const marketingRewards = body.customerId && status === "PAID"
            ? await applyMarketingRewardBonuses(tx, {
                branchId: body.branchId,
                invoiceId: inv.id,
                customerId: body.customerId,
                eligibleMinor: Math.max(0, totals.totalMinor - loyaltyRedemptionMinor),
                actorUserId: req.user?.id,
              })
            : { points: 0, balanceAfter: null };

          await audit("pos.checkout", "Invoice", inv.id, {
            actorUserId: req.user?.id,
            after: {
              number: inv.number,
              totalMinor: totals.totalMinor,
              paidMinor,
              couponCode: couponQuote?.coupon.code,
              couponDiscountMinor,
              loyaltyPointsRedeemed: body.loyaltyPointsToRedeem,
              loyaltyPointsEarned: earned.points,
              marketingRewardPoints: marketingRewards.points,
              servicePriceOverrides,
            },
            ip: req.ip,
          }, tx);

          return {
            invoice: inv,
            loyalty: {
              redeemedPoints: body.loyaltyPointsToRedeem,
              redeemedMinor: loyaltyRedemptionMinor,
              earnedPoints: earned.points,
              marketingRewardPoints: marketingRewards.points,
              balanceAfter: marketingRewards.balanceAfter ?? earned.balanceAfter ?? loyaltyBalanceAfter,
            },
          };
        });

        let archivedPdf: Awaited<ReturnType<typeof buildAndStorePdf>> | undefined;
        if (result.invoice.status === "PAID") {
          try {
            archivedPdf = await buildAndStorePdf(result.invoice.id);
          } catch (error) {
            app.log.error({ err: error, invoiceId: result.invoice.id }, "invoice PDF archive could not be stored");
          }
        }
        if (result.invoice.status === "PAID" && customer) {
          const storedAutomation = await prisma.setting.findUnique({
            where: { key: `branch:${body.branchId}:automation` },
          });
          const automation = normalizeReceiptAutomationSettings(storedAutomation?.value);
          const templateValues = {
            name: customer.name,
            invoiceNumber: result.invoice.number,
            total: moneyText(result.invoice.totalMinor),
            customerPortalUrl: customerPortalUrl(customer.phone) ?? "",
            googleReviewUrl,
          };
          const loyaltySummary = [
            result.loyalty.earnedPoints + result.loyalty.marketingRewardPoints > 0
              ? `Loyalty earned: +${result.loyalty.earnedPoints + result.loyalty.marketingRewardPoints} points`
              : undefined,
            typeof result.loyalty.balanceAfter === "number"
              ? `Current loyalty balance: ${result.loyalty.balanceAfter} points`
              : undefined,
            customerPortalUrl(customer.phone)
              ? `Customer rewards portal: ${customerPortalUrl(customer.phone)}`
              : undefined,
          ].filter(Boolean).join("\n");
          const receiptPdf = async () => {
            if (!automation.invoiceAttachPdf) return undefined;
            archivedPdf ??= await buildAndStorePdf(result.invoice.id);
            return archivedPdf;
          };

          if (automation.autoInvoiceEmail && customer.email && customer.emailConsent) {
            try {
              const pdf = await receiptPdf();
              await enqueueEmail({
                branchId: body.branchId,
                to: customer.email,
                subject: fillAutomationTemplate(automation.invoiceEmailSubject, templateValues),
                html: plainTextEmailHtml([
                  fillAutomationTemplate(automation.invoiceEmailBody, templateValues),
                  loyaltySummary,
                ].filter(Boolean).join("\n\n")),
                attachments: pdf
                  ? [{ filename: `${result.invoice.number}.pdf`, storageKey: pdf.key }]
                  : undefined,
                dedupeKey: `invoice-auto:${result.invoice.id}:email`,
              });
              await audit("invoice.send", "Invoice", result.invoice.id, {
                actorUserId: req.user?.id,
                after: { channel: "EMAIL", recipient: customer.email, status: "queued", automatic: true },
                ip: req.ip,
              });
            } catch (error) {
              app.log.error({ err: error, invoiceId: result.invoice.id }, "automatic invoice email could not be queued");
            }
          }
          if (automation.autoInvoiceWhatsapp && customer.phone && customer.waConsent) {
            try {
              const providerContext = await applyProviderSettings(body.branchId);
              const messaging = providerContext.whatsapp(automation.invoiceWhatsappChannel);
              const providerHealth = await messaging.health?.();
              if (providerHealth?.configured === false) {
                throw new Error(`${automation.invoiceWhatsappChannel === "WHATSAPP_OFFICIAL" ? "wa_official_not_configured" : "wa_unofficial_not_configured"}: ${providerHealth.detail ?? "Provider is not configured"}`);
              }
              if (providerHealth?.configured && providerHealth.connected === false) {
                throw new Error(`${automation.invoiceWhatsappChannel === "WHATSAPP_OFFICIAL" ? "wa_official_not_connected" : "wa_unofficial_not_connected"}: ${providerHealth.detail ?? providerHealth.status ?? "Provider is not connected"}`);
              }
              const pdf = await receiptPdf();
              let mediaUrl: string | undefined;
              let mediaData: string | undefined;
              if (pdf && automation.invoiceWhatsappChannel === "WHATSAPP_UNOFFICIAL") {
                const pdfError = inlineInvoicePdfError(pdf.buf);
                if (pdfError) throw new Error(pdfError);
                mediaData = pdf.buf.toString("base64");
              } else if (pdf) {
                mediaUrl = await providers.storage().signedUrl(pdf.key, 3_600);
                const mediaError = invoiceWhatsAppMediaError(automation.invoiceWhatsappChannel, mediaUrl);
                if (mediaError) throw new Error(mediaError);
              }
              const sendResult = await messaging.send({
                to: customer.phone,
                body: [
                  fillAutomationTemplate(automation.invoiceWhatsappBody, templateValues),
                  loyaltySummary,
                ].filter(Boolean).join("\n\n"),
                mediaUrl,
                mediaData,
                mediaMimeType: mediaData ? "application/pdf" : undefined,
                mediaFilename: pdf ? `${result.invoice.number}.pdf` : undefined,
                mediaType: mediaUrl || mediaData ? "document" : undefined,
              });
              if (sendResult.status === "failed") {
                throw new Error([sendResult.error ?? "whatsapp_send_failed", sendResult.detail].filter(Boolean).join(": "));
              }
              await audit("invoice.send", "Invoice", result.invoice.id, {
                actorUserId: req.user?.id,
                after: {
                  channel: automation.invoiceWhatsappChannel,
                  recipient: customer.phone,
                  status: sendResult.status,
                  externalId: sendResult.externalId,
                  automatic: true,
                },
                ip: req.ip,
              });
            } catch (error) {
              app.log.warn({ err: error, invoiceId: result.invoice.id }, "automatic WhatsApp receipt was skipped");
            }
          }
        }
        return reply.code(201).send({
          ...result.invoice,
          loyalty: result.loyalty,
          coupon: couponQuote ? { code: couponQuote.coupon.code, discountMinor: couponDiscountMinor } : null,
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002" &&
          Array.isArray(err.meta?.target) &&
          err.meta.target.includes("number")
        ) {
          app.log.warn({ err }, "invoice number collision; checkout can be retried safely");
          return reply.code(409).send({ error: "invoice_number_conflict", retryable: true });
        }
        if (err instanceof InsufficientCreditError) {
          return reply.code(409).send({
            error: "insufficient_membership_credit",
            balanceMinor: err.balanceMinor,
            requestedMinor: err.requestedMinor,
          });
        }
        if (err instanceof Error && err.message.startsWith("insufficient_stock:")) {
          return reply.code(409).send({ error: "insufficient_stock", product: err.message.slice("insufficient_stock:".length) });
        }
        if (err instanceof Error && ["package_not_found", "package_expired", "service_not_in_package", "insufficient_package_balance"].includes(err.message)) {
          return reply.code(409).send({ error: err.message });
        }
        if (err instanceof Error && (err.message.startsWith("coupon_") || err.message.includes("loyalty"))) {
          return reply.code(409).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  // Manual payment marking for Cash/UPI/Card/Wallet. This is intentionally
  // independent of a payment gateway: provider reconciliation can be added in
  // a later phase without changing the immutable Payment records.
  app.post(
    "/invoices/:id/payments",
    { preHandler: authorize("OWNER", "ADMIN", "MANAGER", "RECEPTION") },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { payments } = z.object({ payments: z.array(paymentSchema).min(1) }).parse(req.body);
      const existing = await prisma.invoice.findUnique({ where: { id } });
      if (!existing) return reply.code(404).send({ error: "not_found" });
      if (!['OWNER', 'ADMIN'].includes(req.user!.role) && req.user!.branchId !== existing.branchId) {
        return reply.code(403).send({ error: "forbidden" });
      }
      if (["VOID", "PAID"].includes(existing.status)) return reply.code(409).send({ error: "invoice_not_collectible" });
      if (payments.some((p) => p.method === "WALLET")) return reply.code(400).send({ error: "wallet_payment_not_supported" });
      const membershipPayments = payments.filter((p) => p.method === "MEMBERSHIP_CREDIT");
      if (membershipPayments.length) {
        if (!existing.customerId) return reply.code(400).send({ error: "customer_required_for_membership_credit" });
        if (membershipPayments.some((p) => !p.membershipId)) return reply.code(400).send({ error: "membership_id_required" });
        const ids = [...new Set(membershipPayments.map((p) => p.membershipId as string))];
        const owned = await prisma.membership.findMany({
          where: { id: { in: ids }, customerId: existing.customerId, isActive: true },
          include: { plan: true },
        });
        if (owned.length !== ids.length) return reply.code(403).send({ error: "membership_not_owned_by_customer" });
        const items = await prisma.invoiceItem.findMany({
          where: { invoiceId: id },
          select: { kind: true, serviceId: true, lineTotalMinor: true },
        });
        const itemServices = await prisma.service.findMany({
          where: { id: { in: items.flatMap((item) => item.serviceId ? [item.serviceId] : []) } },
          select: { id: true, categoryId: true },
        });
        const itemServiceById = new Map(itemServices.map((service) => [service.id, service]));
        const requestedByMembershipId = new Map<string, number>();
        for (const payment of membershipPayments) {
          requestedByMembershipId.set(
            payment.membershipId!,
            (requestedByMembershipId.get(payment.membershipId!) ?? 0) + payment.amountMinor,
          );
        }
        for (const membership of owned) {
          const eligibleMinor = items.reduce((sum, item) => {
            if (item.kind !== "service" || !item.serviceId) return sum;
            return membershipPlanAllowsService(membership.plan, itemServiceById.get(item.serviceId))
              ? sum + item.lineTotalMinor
              : sum;
          }, 0);
          const requestedMinor = requestedByMembershipId.get(membership.id) ?? 0;
          if (requestedMinor > eligibleMinor) {
            return reply.code(400).send({
              error: "membership_service_not_eligible",
              eligibleMinor,
              requestedMinor,
            });
          }
        }
      }
      const addedMinor = payments.reduce((sum, payment) => sum + payment.amountMinor, 0);
      try {
        const invoice = await prisma.$transaction(async (tx) => {
          // Advisory lock + re-read inside the tx so two concurrent payment calls
          // can't both read a stale paidMinor and lose an update (double-pay).
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`invoice:${id}`})) IS NULL AS locked`;
          const fresh = await tx.invoice.findUnique({ where: { id }, select: { paidMinor: true, totalMinor: true, status: true } });
          if (!fresh) throw new Error("not_found");
          if (["VOID", "PAID"].includes(fresh.status)) throw new Error("invoice_not_collectible");
          const nextPaid = fresh.paidMinor + addedMinor;
          if (nextPaid > fresh.totalMinor) throw new Error("overpayment");
          for (const payment of payments) {
            await tx.payment.create({ data: { invoiceId: id, method: payment.method, amountMinor: payment.amountMinor, reference: payment.reference, membershipId: payment.membershipId, createdByUserId: req.user!.id } });
            if (payment.method === "MEMBERSHIP_CREDIT") {
              await redeem(tx, payment.membershipId!, payment.amountMinor, id, req.user!.id);
            }
          }
          const updated = await tx.invoice.update({
            where: { id },
            data: {
              paidMinor: nextPaid,
              status: nextPaid === fresh.totalMinor ? "PAID" : "PARTIALLY_PAID",
              // Paid/status values are printed in the PDF. Invalidate the
              // stored rendition so the next open/send regenerates it.
              pdfUrl: null,
            },
            include: { payments: true },
          });
          if (updated.status === "PAID" && updated.customerId) {
            const rules = await getLoyaltyRules(tx, updated.branchId);
            const loyaltyTenderMinor = updated.payments
              .filter((payment) => payment.method === "LOYALTY_POINTS")
              .reduce((sum, payment) => sum + payment.amountMinor, 0);
            await earnForPaidInvoice(tx, {
              invoiceId: updated.id,
              customerId: updated.customerId,
              eligibleMinor: Math.max(0, updated.totalMinor - loyaltyTenderMinor),
              rules,
              actorUserId: req.user!.id,
            });
            await applyMarketingRewardBonuses(tx, {
              branchId: updated.branchId,
              invoiceId: updated.id,
              customerId: updated.customerId,
              eligibleMinor: Math.max(0, updated.totalMinor - loyaltyTenderMinor),
              actorUserId: req.user!.id,
            });
          }
          await audit("invoice.payment_marked", "Invoice", id, { actorUserId: req.user!.id, before: { paidMinor: existing.paidMinor, status: existing.status }, after: { paidMinor: nextPaid, status: updated.status, payments } }, tx);
          return updated;
        });
        return reply.code(201).send(invoice);
      } catch (error) {
        if (error instanceof InsufficientCreditError) return reply.code(409).send({ error: "insufficient_membership_credit", balanceMinor: error.balanceMinor, requestedMinor: error.requestedMinor });
        if (error instanceof Error && ["not_found", "invoice_not_collectible", "overpayment"].includes(error.message)) {
          return reply.code(error.message === "not_found" ? 404 : 409).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  // Render + store the branded PDF for an invoice; returns {key, buf}.
  async function buildAndStorePdf(id: string) {
    const inv = await prisma.invoice.findUnique({
      where: { id },
      include: { items: true, customer: true, branch: true },
    });
    if (!inv) return null;
    const buf = await renderInvoicePdf({
      number: inv.number,
      issuedAt: inv.issuedAt ?? inv.createdAt,
      salonName: inv.branch.name,
      salonAddress: inv.branch.address ?? undefined,
      customerName: inv.customer?.name,
      items: inv.items.map((it) => ({
        description: it.description,
        qty: it.qty,
        unitMinor: it.unitMinor,
        discountMinor: it.discountMinor,
        servedFor: it.servedFor,
        taxMinor: it.taxMinor,
        lineTotalMinor: it.lineTotalMinor,
      })),
      subtotalMinor: inv.subtotalMinor,
      discountMinor: inv.discountMinor,
      taxMinor: inv.taxMinor,
      totalMinor: inv.totalMinor,
      paidMinor: inv.paidMinor,
      currency: inv.branch.currency,
    });
    const key = `${invoicePdfPrefix}${inv.number}.pdf`;
    const storage = providers.storage();
    if (inv.pdfUrl && !/^invoices\/v[23]\//.test(inv.pdfUrl)) {
      // Cloudinary's old delivery mode exposed raw objects publicly. Its
      // adapter implements this hook; S3/local private storage intentionally
      // omits it so migration cannot remove an otherwise valid private file.
      await storage.retireLegacyPublicObject?.(inv.pdfUrl);
    }
    const storedKey = await storage.put(key, buf, "application/pdf");
    await prisma.invoice.update({ where: { id }, data: { pdfUrl: storedKey } });
    return { key: storedKey, buf, number: inv.number };
  }

  // Generate (or regenerate) the branded PDF, store it, return a signed URL.
  app.post(
    "/invoices/:id/pdf",
    { preHandler: authorize("OWNER", "ADMIN", "MANAGER", "RECEPTION") },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const invoice = await prisma.invoice.findUnique({ where: { id }, select: { branchId: true } });
      if (!invoice) return reply.code(404).send({ error: "not_found" });
      if (!["OWNER", "ADMIN"].includes(req.user!.role) && req.user?.branchId !== invoice.branchId) {
        return reply.code(403).send({ error: "forbidden" });
      }
      const out = await buildAndStorePdf(id);
      if (!out) return reply.code(404).send({ error: "not_found" });
      const url = await providers.storage().signedUrl(out.key, 3600);
      return { url, key: out.key };
    },
  );

  // Stream the PDF bytes (generating on demand if needed). Works with any
  // storage backend — used by the admin UI to view/download an invoice.
  app.get(
    "/invoices/:id/pdf",
    { preHandler: authorize("OWNER", "ADMIN", "MANAGER", "RECEPTION") },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const query = z.object({ download: z.enum(["1", "true"]).optional() }).parse(req.query ?? {});
      const inv = await prisma.invoice.findUnique({ where: { id }, select: { pdfUrl: true, number: true, branchId: true } });
      if (!inv) return reply.code(404).send({ error: "not_found" });
      if (!["OWNER", "ADMIN"].includes(req.user!.role) && req.user?.branchId !== inv.branchId) {
        return reply.code(403).send({ error: "forbidden" });
      }

      // A versioned key lets template fixes apply to older invoices lazily.
      // Legacy PDFs are regenerated on first open/download instead of serving
      // a permanently broken layout from storage.
      let bytes = inv.pdfUrl?.startsWith(invoicePdfPrefix)
        ? await providers.storage().get(inv.pdfUrl)
        : null;
      let number = inv.number;
      if (!bytes) {
        const out = await buildAndStorePdf(id);
        if (!out) return reply.code(404).send({ error: "not_found" });
        bytes = out.buf;
        number = out.number;
      }
      reply.header("Content-Type", "application/pdf");
      reply.header("Content-Disposition", `${query.download ? "attachment" : "inline"}; filename="${number}.pdf"`);
      reply.header("Cache-Control", "private, no-store");
      return reply.send(bytes);
    },
  );

  // Email the invoice PDF to the customer (queued, idempotent).
  app.post(
    "/invoices/:id/send",
    { preHandler: authorize("OWNER", "ADMIN", "MANAGER", "RECEPTION") },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { channel } = z.object({ channel: z.enum(["EMAIL", "WHATSAPP_OFFICIAL", "WHATSAPP_UNOFFICIAL"]).default("EMAIL") }).parse(req.body ?? {});
      const inv = await prisma.invoice.findUnique({ where: { id }, include: { customer: true } });
      if (!inv) return reply.code(404).send({ error: "not_found" });
      if (!["OWNER", "ADMIN"].includes(req.user!.role) && req.user?.branchId !== inv.branchId) {
        return reply.code(403).send({ error: "forbidden" });
      }
      const emailRecipient = channel === "EMAIL" ? inv.customer?.email : undefined;
      const whatsappRecipient = channel === "EMAIL" ? undefined : inv.customer?.phone;
      if (channel === "EMAIL" && !emailRecipient) return reply.code(400).send({ error: "customer_has_no_email" });
      if (channel !== "EMAIL" && !whatsappRecipient) return reply.code(400).send({ error: "customer_has_no_phone" });
      if (channel !== "EMAIL" && !inv.customer?.waConsent) {
        return reply.code(409).send({ error: "whatsapp_consent_required" });
      }
      const previousDelivery = await alreadyDeliveredInvoice(id, channel);
      if (previousDelivery) {
        const previous = invoiceSendAuditPayload(previousDelivery.after);
        const status = typeof previous.status === "string" ? previous.status : "already_queued";
        return {
          queued: channel === "EMAIL" || status === "queued" || status === "already_queued",
          channel,
          status: "already_queued",
          alreadySent: true,
        };
      }
      // Auto-generate the PDF if it hasn't been rendered yet.
      let key = inv.pdfUrl;
      let storedPdf = key?.startsWith(invoicePdfPrefix)
        ? await providers.storage().get(key)
        : null;
      if (!storedPdf) {
        const out = await buildAndStorePdf(id);
        if (!out) return reply.code(404).send({ error: "not_found" });
        key = out.key;
        storedPdf = out.buf;
      }
      if (!key) return reply.code(503).send({ error: "invoice_pdf_unavailable" });

      if (channel === "EMAIL") {
        const to = emailRecipient!;
        await enqueueEmail({
          branchId: inv.branchId,
          to,
          subject: `Your invoice ${inv.number}`,
          html: invoiceEmail({ name: inv.customer?.name, invoiceNumber: inv.number, totalMinor: inv.totalMinor }),
          // The worker resolves this storage key to bytes — works with S3 or local disk.
          attachments: [{ filename: `${inv.number}.pdf`, storageKey: key }],
          dedupeKey: `invoice-email-${inv.id}`,
        });
        await audit("invoice.send", "Invoice", id, { actorUserId: req.user?.id, after: { channel, recipient: to }, ip: req.ip });
        return { queued: true, channel };
      }

      const phone = whatsappRecipient!;
      const providerContext = await applyProviderSettings(inv.branchId);
      const messaging = providerContext.whatsapp(channel);
      const providerHealth = await messaging.health?.();
      if (providerHealth?.configured === false) {
        const error = channel === "WHATSAPP_OFFICIAL" ? "wa_official_not_configured" : "wa_unofficial_not_configured";
        app.log.warn({ invoiceId: id, branchId: inv.branchId, channel, error }, "invoice WhatsApp provider is not configured");
        return reply.code(503).send({ error, channel, detail: providerHealth.detail });
      }
      if (providerHealth?.configured && providerHealth.connected === false) {
        const error = channel === "WHATSAPP_OFFICIAL" ? "wa_official_not_connected" : "wa_unofficial_not_connected";
        app.log.warn({ invoiceId: id, branchId: inv.branchId, channel, error, providerStatus: providerHealth.status }, "invoice WhatsApp provider is not connected");
        return reply.code(503).send({ error, channel, detail: providerHealth.detail, providerStatus: providerHealth.status });
      }
      let mediaUrl: string | undefined;
      let mediaData: string | undefined;
      if (channel === "WHATSAPP_UNOFFICIAL") {
        const pdfError = inlineInvoicePdfError(storedPdf);
        if (pdfError) {
          app.log.warn({ invoiceId: id, branchId: inv.branchId, channel, pdfError, size: storedPdf.length }, "invoice PDF cannot be sent inline");
          return reply.code(pdfError.includes("too_large") ? 413 : 503).send({ error: pdfError, channel });
        }
        mediaData = storedPdf.toString("base64");
      } else {
        try {
          mediaUrl = await providers.storage().signedUrl(key, 3600);
        } catch (error) {
          app.log.warn({ err: error, invoiceId: id, branchId: inv.branchId, channel }, "invoice WhatsApp media URL could not be created");
          return reply.code(503).send({
            error: "invoice_public_url_unavailable",
            channel,
            detail: "Configure S3/Cloudinary storage with a provider-reachable invoice URL.",
          });
        }
        const mediaError = invoiceWhatsAppMediaError(channel, mediaUrl);
        if (mediaError) {
          app.log.warn({ invoiceId: id, branchId: inv.branchId, channel, mediaError }, "invoice WhatsApp media URL is not provider-reachable");
          return reply.code(503).send({
            error: mediaError,
            channel,
            detail: "Official WhatsApp invoice media requires a public HTTPS URL; configure S3 or Cloudinary storage.",
          });
        }
      }
      const result = await messaging.send({
        to: phone,
        body: invoiceWhatsAppBody({
          customerPhone: inv.customer?.phone,
          invoiceNumber: inv.number,
          totalMinor: inv.totalMinor,
          balanceAfter: inv.customer?.loyaltyPoints,
        }),
        mediaUrl,
        mediaData,
        mediaMimeType: mediaData ? "application/pdf" : undefined,
        mediaFilename: `${inv.number}.pdf`,
        mediaType: "document",
      });
      if (result.status === "failed") {
        app.log.warn({
          invoiceId: id,
          branchId: inv.branchId,
          channel,
          error: result.error,
          providerCode: result.providerCode,
        }, "invoice WhatsApp delivery was rejected");
        const unavailable = result.error === "wa_official_not_configured"
          || result.error === "wa_unofficial_not_configured"
          || result.error === "wa_official_unavailable";
        return reply.code(unavailable ? 503 : 422).send({ ...result, channel });
      }
      await audit("invoice.send", "Invoice", id, { actorUserId: req.user?.id, after: { channel, recipient: phone, status: result.status }, ip: req.ip });
      app.log.info({ invoiceId: id, branchId: inv.branchId, channel, status: result.status, externalId: result.externalId }, "invoice WhatsApp delivery accepted");
      return { queued: result.status === "queued", channel, status: result.status, externalId: result.externalId };
    },
  );
}
