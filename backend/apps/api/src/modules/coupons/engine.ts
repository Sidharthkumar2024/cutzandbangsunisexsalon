import { Coupon, Prisma, PrismaClient } from "@prisma/client";

type CouponDb = PrismaClient | Prisma.TransactionClient;

export function calculateCouponDiscount(
  coupon: Pick<Coupon, "type" | "value" | "maxDiscountMinor">,
  amountMinor: number,
) {
  const raw =
    coupon.type === "PERCENTAGE"
      ? Math.round((amountMinor * coupon.value) / 10_000)
      : coupon.value;
  const capped = coupon.maxDiscountMinor != null ? Math.min(raw, coupon.maxDiscountMinor) : raw;
  return Math.max(0, Math.min(amountMinor, capped));
}

export async function quoteCoupon(
  db: CouponDb,
  input: { branchId: string; code: string; amountMinor: number; customerId?: string },
) {
  const code = input.code.trim().toUpperCase();
  const coupon = await db.coupon.findFirst({
    where: { branchId: input.branchId, code, isActive: true, deletedAt: null },
  });
  if (!coupon) throw new Error("coupon_not_found");
  const now = new Date();
  if (coupon.startsAt && coupon.startsAt > now) throw new Error("coupon_not_started");
  if (coupon.endsAt && coupon.endsAt < now) throw new Error("coupon_expired");
  if (input.amountMinor < coupon.minSpendMinor) throw new Error("coupon_minimum_spend");
  if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) {
    throw new Error("coupon_usage_limit_reached");
  }
  if (coupon.perCustomerLimit != null) {
    if (!input.customerId) throw new Error("customer_required_for_coupon");
    const uses = await db.couponRedemption.count({
      where: { couponId: coupon.id, customerId: input.customerId },
    });
    if (uses >= coupon.perCustomerLimit) throw new Error("coupon_customer_limit_reached");
  }
  const discountMinor = calculateCouponDiscount(coupon, input.amountMinor);
  if (discountMinor <= 0) throw new Error("coupon_zero_discount");
  return { coupon, discountMinor };
}

export async function consumeCoupon(
  tx: Prisma.TransactionClient,
  input: {
    couponId: string;
    branchId: string;
    code: string;
    amountMinor: number;
    discountMinor: number;
    invoiceId: string;
    customerId?: string;
  },
) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`coupon:${input.couponId}`})) IS NULL AS locked`;
  const quote = await quoteCoupon(tx, input);
  if (quote.coupon.id !== input.couponId || quote.discountMinor !== input.discountMinor) {
    throw new Error("coupon_changed_retry");
  }
  await tx.couponRedemption.create({
    data: {
      couponId: input.couponId,
      customerId: input.customerId,
      invoiceId: input.invoiceId,
      discountMinor: input.discountMinor,
    },
  });
  await tx.coupon.update({ where: { id: input.couponId }, data: { usedCount: { increment: 1 } } });
}
