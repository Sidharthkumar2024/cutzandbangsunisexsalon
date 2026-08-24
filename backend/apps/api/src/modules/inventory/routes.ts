import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@cutz/db";
import { authorize } from "../../plugins/auth.js";
import { providers } from "@cutz/providers";
import { audit } from "../../lib/audit.js";
import { canAccessBranch, resolveBranchScope } from "../../lib/branch-scope.js";

const ADMIN = ["OWNER", "ADMIN", "MANAGER"] as const;

/** Record a stock movement and keep the denormalized stockQty in sync. */
async function move(
  tx: import("@prisma/client").Prisma.TransactionClient,
  branchId: string,
  productId: string,
  qtyDelta: number,
  reason: "PURCHASE" | "SALE" | "CONSUMPTION" | "WASTAGE" | "ADJUSTMENT",
  ref: { refType?: string; refId?: string; actorUserId?: string; idempotencyKey?: string } = {},
) {
  // Purchase confirmation is retriable. A legacy movement may pre-date the
  // explicit key, so also recognise the immutable reference tuple before
  // touching the denormalized stock balance.
  if (ref.refId && ref.refType) {
    const previous = await tx.inventoryMovement.findFirst({
      where: {
        branchId,
        productId,
        refType: ref.refType,
        refId: ref.refId,
      },
      select: { stockAfter: true },
    });
    if (previous) return previous.stockAfter;
  }
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${productId})) IS NULL AS locked`;
  const p = await tx.product.findFirst({ where: { id: productId, branchId } });
  if (!p) throw new Error("product_not_found");
  const stockAfter = p.stockQty + qtyDelta;
  if (stockAfter < 0) throw new Error("insufficient_stock");
  await tx.inventoryMovement.create({
    data: { branchId, productId, qtyDelta, stockAfter, reason, ...ref },
  });
  await tx.product.update({ where: { id: productId }, data: { stockQty: stockAfter } });
  return stockAfter;
}

type LockedPurchaseBill = { id: string; branchId: string; confirmedAt: Date | null };

async function lockPurchaseBill(tx: import("@prisma/client").Prisma.TransactionClient, id: string) {
  const rows = await tx.$queryRaw<LockedPurchaseBill[]>`
    SELECT "id", "branchId", "confirmedAt"
    FROM "PurchaseBill"
    WHERE "id" = ${id}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

export default async function inventoryRoutes(app: FastifyInstance) {
  app.get("/vendors", { preHandler: authorize(...ADMIN, "RECEPTION") }, async (req, reply) => {
    const query = z.object({ branchId: z.string().trim().min(1).optional() }).parse(req.query);
    const scope = resolveBranchScope(req.user!, query.branchId);
    if (!scope.ok) return reply.code(scope.statusCode).send({ error: scope.error });
    return prisma.vendor.findMany({ where: { branchId: scope.branchId }, orderBy: { name: "asc" } });
  });

  app.post("/vendors", { preHandler: authorize(...ADMIN) }, async (req, reply) => {
    const body = z.object({ branchId: z.string().trim().min(1).optional(), name: z.string().min(1), phone: z.string().optional(), email: z.string().email().optional() }).parse(req.body);
    const scope = resolveBranchScope(req.user!, body.branchId);
    if (!scope.ok) return reply.code(scope.statusCode).send({ error: scope.error });
    const branch = await prisma.branch.findFirst({ where: { id: scope.branchId, deletedAt: null }, select: { id: true } });
    if (!branch) return reply.code(404).send({ error: "branch_not_found" });
    const { branchId: _requestedBranch, ...vendorData } = body;
    const vendor = await prisma.vendor.create({ data: { branchId: scope.branchId, ...vendorData } });
    await audit("vendor.create", "Vendor", vendor.id, { actorUserId: req.user?.id, after: { branchId: scope.branchId, ...vendorData }, ip: req.ip });
    return reply.code(201).send(vendor);
  });

  app.get("/products", { preHandler: authorize(...ADMIN, "RECEPTION") }, async (req, reply) => {
    const query = z.object({ branchId: z.string().trim().min(1).optional(), lowStock: z.enum(["true", "false"]).optional() }).parse(req.query);
    const scope = resolveBranchScope(req.user!, query.branchId);
    if (!scope.ok) return reply.code(scope.statusCode).send({ error: scope.error });
    const products = await prisma.product.findMany({ where: { branchId: scope.branchId, deletedAt: null }, orderBy: { name: "asc" } });
    return query.lowStock === "true" ? products.filter((p) => p.stockQty <= p.reorderLevel) : products;
  });

  app.get("/inventory-movements", { preHandler: authorize(...ADMIN, "RECEPTION") }, async (req, reply) => {
    const query = z.object({ branchId: z.string().trim().min(1).optional(), productId: z.string().optional(), take: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query);
    const scope = resolveBranchScope(req.user!, query.branchId);
    if (!scope.ok) return reply.code(scope.statusCode).send({ error: scope.error });
    return prisma.inventoryMovement.findMany({ where: { branchId: scope.branchId, ...(query.productId ? { productId: query.productId } : {}) }, orderBy: { createdAt: "desc" }, take: query.take, include: { product: { select: { id: true, name: true, sku: true } } } });
  });

  app.post("/products", { preHandler: authorize(...ADMIN) }, async (req, reply) => {
    const body = z
      .object({
        branchId: z.string().trim().min(1).optional(),
        name: z.string(),
        brand: z.string().optional(),
        sku: z.string().optional(),
        barcode: z.string().optional(),
        purchaseMinor: z.number().int().nonnegative().default(0),
        sellMinor: z.number().int().nonnegative().default(0),
        mrpMinor: z.number().int().nonnegative().default(0),
        discountBps: z.number().int().min(0).max(10_000).default(0),
        commissionBps: z.number().int().min(0).max(10_000).default(0),
        taxRateBps: z.number().int().nonnegative().default(0),
        reorderLevel: z.number().int().nonnegative().default(0),
      })
      .parse(req.body);
    const scope = resolveBranchScope(req.user!, body.branchId);
    if (!scope.ok) return reply.code(scope.statusCode).send({ error: scope.error });
    const branch = await prisma.branch.findFirst({ where: { id: scope.branchId, deletedAt: null }, select: { id: true } });
    if (!branch) return reply.code(404).send({ error: "branch_not_found" });
    const { branchId: _requestedBranch, ...productData } = body;
    const product = await prisma.product.create({ data: { branchId: scope.branchId, ...productData } });
    await audit("product.create", "Product", product.id, { actorUserId: req.user?.id, after: { branchId: scope.branchId, ...productData }, ip: req.ip });
    return reply.code(201).send(product);
  });

  app.patch("/products/:id", { preHandler: authorize(...ADMIN) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      name: z.string().trim().min(1).optional(),
      brand: z.string().trim().nullable().optional(),
      sku: z.string().trim().nullable().optional(),
      barcode: z.string().trim().nullable().optional(),
      purchaseMinor: z.number().int().nonnegative().optional(),
      sellMinor: z.number().int().nonnegative().optional(),
      mrpMinor: z.number().int().nonnegative().optional(),
      discountBps: z.number().int().min(0).max(10_000).optional(),
      commissionBps: z.number().int().min(0).max(10_000).optional(),
      taxRateBps: z.number().int().min(0).max(10_000).optional(),
      reorderLevel: z.number().int().nonnegative().optional(),
      isActive: z.boolean().optional(),
    }).parse(req.body);
    const before = await prisma.product.findUnique({ where: { id } });
    if (!before) return reply.code(404).send({ error: "product_not_found" });
    if (!canAccessBranch(req.user!, before.branchId)) return reply.code(403).send({ error: "forbidden" });
    const product = await prisma.product.update({ where: { id }, data: body });
    await audit("product.update", "Product", id, { actorUserId: req.user?.id, before, after: body, ip: req.ip });
    return product;
  });

  // Manual stock movement (consumption, wastage, adjustment).
  app.post("/products/:id/movement", { preHandler: authorize(...ADMIN) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { qtyDelta, reason } = z
      .object({
        qtyDelta: z.number().int(),
        reason: z.enum(["CONSUMPTION", "WASTAGE", "ADJUSTMENT", "PURCHASE"]),
      })
      .parse(req.body);
    const product = await prisma.product.findUnique({ where: { id }, select: { branchId: true } });
    if (!product) return reply.code(404).send({ error: "product_not_found" });
    if (!canAccessBranch(req.user!, product.branchId)) return reply.code(403).send({ error: "forbidden" });
    try {
      const stockAfter = await prisma.$transaction((tx) =>
        move(tx, product.branchId, id, qtyDelta, reason, { refType: "manual", actorUserId: req.user?.id }),
      );
      await audit("inventory.movement", "Product", id, { actorUserId: req.user?.id, after: { branchId: product.branchId, qtyDelta, reason, stockAfter }, ip: req.ip });
      return { stockAfter };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "inventory_movement_failed";
      const status = reason === "product_not_found" ? 404 : reason === "insufficient_stock" ? 409 : 422;
      return reply.code(status).send({ error: reason });
    }
  });

  app.get("/purchase-bills", { preHandler: authorize(...ADMIN, "RECEPTION") }, async (req, reply) => {
    const query = z.object({ branchId: z.string().trim().min(1).optional(), pending: z.enum(["true", "false"]).optional() }).parse(req.query);
    const scope = resolveBranchScope(req.user!, query.branchId);
    if (!scope.ok) return reply.code(scope.statusCode).send({ error: scope.error });
    return prisma.purchaseBill.findMany({ where: { branchId: scope.branchId, ...(query.pending === "true" ? { confirmedAt: null } : {}) }, orderBy: { createdAt: "desc" }, take: 200, include: { vendor: true, items: { include: { product: true } } } });
  });

  // OCR creates only a review candidate. It never changes stock.
  app.post("/purchase-bills/ocr", { preHandler: authorize(...ADMIN) }, async (req, reply) => {
    const body = z.object({ branchId: z.string().trim().min(1).optional(), vendorId: z.string(), photoUrl: z.string().url() }).parse(req.body);
    const scope = resolveBranchScope(req.user!, body.branchId);
    if (!scope.ok) return reply.code(scope.statusCode).send({ error: scope.error });
    const vendor = await prisma.vendor.findFirst({ where: { id: body.vendorId, branchId: scope.branchId } });
    if (!vendor) return reply.code(404).send({ error: "vendor_not_found" });
    try {
      const candidate = await providers.ai().extractVendorBill({ imageUrl: body.photoUrl });
      const bill = await prisma.purchaseBill.create({ data: { branchId: scope.branchId, vendorId: body.vendorId, photoUrl: body.photoUrl, billNumber: candidate.billNumber ?? undefined, totalMinor: candidate.totalMinor ?? 0, ocrRaw: candidate as any }, include: { vendor: true, items: true } });
      await audit("purchase_bill.ocr_candidate", "PurchaseBill", bill.id, { actorUserId: req.user?.id, after: { branchId: scope.branchId, confidence: candidate.confidence, warnings: candidate.warnings }, ip: req.ip });
      return reply.code(201).send(bill);
    } catch (error) {
      return reply.code(422).send({ error: error instanceof Error ? error.message : "ocr_failed" });
    }
  });

  // Vendor bill: create as pending review; stock updates ONLY on confirm.
  app.post("/purchase-bills", { preHandler: authorize(...ADMIN) }, async (req, reply) => {
    const body = z
      .object({
        branchId: z.string().trim().min(1).optional(),
        vendorId: z.string(),
        billNumber: z.string().optional(),
        photoUrl: z.string().optional(),
        ocrRaw: z.any().optional(),
        items: z
          .array(z.object({ productId: z.string(), qty: z.number().int().positive(), unitMinor: z.number().int().nonnegative() }))
          .default([]),
      })
      .parse(req.body);
    const scope = resolveBranchScope(req.user!, body.branchId);
    if (!scope.ok) return reply.code(scope.statusCode).send({ error: scope.error });
    const vendor = await prisma.vendor.findFirst({ where: { id: body.vendorId, branchId: scope.branchId }, select: { id: true } });
    if (!vendor) return reply.code(404).send({ error: "vendor_not_found" });
    const productIds = [...new Set(body.items.map((item) => item.productId))];
    const productCount = await prisma.product.count({ where: { id: { in: productIds }, branchId: scope.branchId, deletedAt: null } });
    if (productCount !== productIds.length) return reply.code(400).send({ error: "product_branch_mismatch" });
    const total = body.items.reduce((s, i) => s + i.qty * i.unitMinor, 0);
    const bill = await prisma.purchaseBill.create({
      data: {
        branchId: scope.branchId,
        vendorId: body.vendorId,
        billNumber: body.billNumber,
        photoUrl: body.photoUrl,
        ocrRaw: body.ocrRaw,
        totalMinor: total,
        items: { create: body.items },
      },
      include: { items: true },
    });
    return reply.code(201).send(bill);
  });

  // Human review replaces candidate line items; still no stock mutation.
  app.patch("/purchase-bills/:id/review", { preHandler: authorize(...ADMIN) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ billNumber: z.string().optional(), items: z.array(z.object({ productId: z.string(), qty: z.number().int().positive(), unitMinor: z.number().int().nonnegative(), batch: z.string().optional(), expiry: z.coerce.date().optional() })).min(1) }).parse(req.body);
    const existing = await prisma.purchaseBill.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "not_found" });
    if (!canAccessBranch(req.user!, existing.branchId)) return reply.code(403).send({ error: "forbidden" });
    if (existing.confirmedAt) return reply.code(409).send({ error: "already_confirmed" });
    const productIds = [...new Set(body.items.map((item) => item.productId))];
    const productCount = await prisma.product.count({ where: { id: { in: productIds }, branchId: existing.branchId, deletedAt: null } });
    if (productCount !== productIds.length) return reply.code(400).send({ error: "product_branch_mismatch" });
    const totalMinor = body.items.reduce((sum, item) => sum + item.qty * item.unitMinor, 0);
    const bill = await prisma.$transaction(async tx => {
      await tx.purchaseItem.deleteMany({ where: { purchaseBillId: id } });
      return tx.purchaseBill.update({ where: { id }, data: { billNumber: body.billNumber, totalMinor, items: { create: body.items } }, include: { vendor: true, items: { include: { product: true } } } });
    });
    await audit("purchase_bill.review", "PurchaseBill", id, { actorUserId: req.user?.id, before: { totalMinor: existing.totalMinor }, after: { totalMinor, itemCount: body.items.length }, ip: req.ip });
    return bill;
  });

  // Human confirmation step — never auto-post uncertain OCR.
  app.post("/purchase-bills/:id/confirm", { preHandler: authorize(...ADMIN) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await prisma.$transaction(async (tx) => {
      // The lock and confirmedAt check must live in the same transaction as
      // stock posting. A second confirmation waits here, then observes the
      // first transaction's confirmedAt and exits without posting again.
      const locked = await lockPurchaseBill(tx, id);
      if (!locked) return { status: "not_found" as const };
      if (!canAccessBranch(req.user!, locked.branchId)) return { status: "forbidden" as const };
      if (locked.confirmedAt) return { status: "already_confirmed" as const };

      const bill = await tx.purchaseBill.findUnique({ where: { id }, include: { items: true } });
      if (!bill || bill.branchId !== locked.branchId) return { status: "not_found" as const };

      // A reviewed bill can contain the same product on multiple lines. Post
      // one deterministic movement per product so the reference is uniquely
      // idempotent and product advisory locks are acquired in a stable order.
      const purchasedByProduct = new Map<string, number>();
      for (const item of bill.items) {
        purchasedByProduct.set(item.productId, (purchasedByProduct.get(item.productId) ?? 0) + item.qty);
      }
      for (const [productId, qty] of [...purchasedByProduct.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        await move(tx, bill.branchId, productId, qty, "PURCHASE", {
          refType: "purchase",
          refId: bill.id,
          actorUserId: req.user?.id,
          idempotencyKey: `purchase:${bill.branchId}:${bill.id}:${productId}`,
        });
      }
      await tx.purchaseBill.update({ where: { id }, data: { confirmedAt: new Date() } });
      return { status: "confirmed" as const, branchId: bill.branchId, itemCount: bill.items.length };
    });

    if (result.status === "not_found") return reply.code(404).send({ error: "not_found" });
    if (result.status === "forbidden") return reply.code(403).send({ error: "forbidden" });
    if (result.status === "already_confirmed") return reply.code(409).send({ error: "already_confirmed" });

    await audit("purchase_bill.confirm", "PurchaseBill", id, { actorUserId: req.user?.id, after: { branchId: result.branchId, confirmed: true, itemCount: result.itemCount }, ip: req.ip });
    return { confirmed: true };
  });
}
