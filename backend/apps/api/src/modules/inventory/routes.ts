import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@cutz/db";
import { authorize } from "../../plugins/auth.js";
import { providers } from "@cutz/providers";
import { audit } from "../../lib/audit.js";

const ADMIN = ["OWNER", "ADMIN", "MANAGER"] as const;

/** Record a stock movement and keep the denormalized stockQty in sync. */
async function move(
  tx: import("@prisma/client").Prisma.TransactionClient,
  productId: string,
  qtyDelta: number,
  reason: "PURCHASE" | "SALE" | "CONSUMPTION" | "WASTAGE" | "ADJUSTMENT",
  ref: { refType?: string; refId?: string; actorUserId?: string } = {},
) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${productId})) IS NULL AS locked`;
  const p = await tx.product.findUnique({ where: { id: productId } });
  if (!p) throw new Error("product_not_found");
  const stockAfter = p.stockQty + qtyDelta;
  if (stockAfter < 0) throw new Error("insufficient_stock");
  await tx.inventoryMovement.create({
    data: { productId, qtyDelta, stockAfter, reason, ...ref },
  });
  await tx.product.update({ where: { id: productId }, data: { stockQty: stockAfter } });
  return stockAfter;
}

export default async function inventoryRoutes(app: FastifyInstance) {
  app.get("/vendors", { preHandler: authorize(...ADMIN, "RECEPTION") }, async () =>
    prisma.vendor.findMany({ orderBy: { name: "asc" } }),
  );

  app.post("/vendors", { preHandler: authorize(...ADMIN) }, async (req, reply) => {
    const body = z.object({ name: z.string().min(1), phone: z.string().optional(), email: z.string().email().optional() }).parse(req.body);
    const vendor = await prisma.vendor.create({ data: body });
    await audit("vendor.create", "Vendor", vendor.id, { actorUserId: req.user?.id, after: body, ip: req.ip });
    return reply.code(201).send(vendor);
  });

  app.get("/products", { preHandler: authorize(...ADMIN, "RECEPTION") }, async (req) => {
    const { lowStock } = req.query as Record<string, string>;
    const products = await prisma.product.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } });
    return lowStock === "true" ? products.filter((p) => p.stockQty <= p.reorderLevel) : products;
  });

  app.get("/inventory-movements", { preHandler: authorize(...ADMIN, "RECEPTION") }, async (req) => {
    const { productId, take = "100" } = req.query as Record<string, string>;
    return prisma.inventoryMovement.findMany({ where: productId ? { productId } : {}, orderBy: { createdAt: "desc" }, take: Math.min(500, Number(take)), include: { product: { select: { id: true, name: true, sku: true } } } });
  });

  app.post("/products", { preHandler: authorize(...ADMIN) }, async (req, reply) => {
    const body = z
      .object({
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
    const product = await prisma.product.create({ data: body });
    await audit("product.create", "Product", product.id, { actorUserId: req.user?.id, after: body, ip: req.ip });
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
    try {
      const stockAfter = await prisma.$transaction((tx) =>
        move(tx, id, qtyDelta, reason, { refType: "manual", actorUserId: req.user?.id }),
      );
      await audit("inventory.movement", "Product", id, { actorUserId: req.user?.id, after: { qtyDelta, reason, stockAfter }, ip: req.ip });
      return { stockAfter };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "inventory_movement_failed";
      const status = reason === "product_not_found" ? 404 : reason === "insufficient_stock" ? 409 : 422;
      return reply.code(status).send({ error: reason });
    }
  });

  app.get("/purchase-bills", { preHandler: authorize(...ADMIN, "RECEPTION") }, async (req) => {
    const { pending } = req.query as Record<string, string>;
    return prisma.purchaseBill.findMany({ where: pending === "true" ? { confirmedAt: null } : {}, orderBy: { createdAt: "desc" }, take: 200, include: { vendor: true, items: { include: { product: true } } } });
  });

  // OCR creates only a review candidate. It never changes stock.
  app.post("/purchase-bills/ocr", { preHandler: authorize(...ADMIN) }, async (req, reply) => {
    const body = z.object({ vendorId: z.string(), photoUrl: z.string().url() }).parse(req.body);
    const vendor = await prisma.vendor.findUnique({ where: { id: body.vendorId } });
    if (!vendor) return reply.code(404).send({ error: "vendor_not_found" });
    try {
      const candidate = await providers.ai().extractVendorBill({ imageUrl: body.photoUrl });
      const bill = await prisma.purchaseBill.create({ data: { vendorId: body.vendorId, photoUrl: body.photoUrl, billNumber: candidate.billNumber ?? undefined, totalMinor: candidate.totalMinor ?? 0, ocrRaw: candidate as any }, include: { vendor: true, items: true } });
      await audit("purchase_bill.ocr_candidate", "PurchaseBill", bill.id, { actorUserId: req.user?.id, after: { confidence: candidate.confidence, warnings: candidate.warnings }, ip: req.ip });
      return reply.code(201).send(bill);
    } catch (error) {
      return reply.code(422).send({ error: error instanceof Error ? error.message : "ocr_failed" });
    }
  });

  // Vendor bill: create as pending review; stock updates ONLY on confirm.
  app.post("/purchase-bills", { preHandler: authorize(...ADMIN) }, async (req, reply) => {
    const body = z
      .object({
        vendorId: z.string(),
        billNumber: z.string().optional(),
        photoUrl: z.string().optional(),
        ocrRaw: z.any().optional(),
        items: z
          .array(z.object({ productId: z.string(), qty: z.number().int().positive(), unitMinor: z.number().int().nonnegative() }))
          .default([]),
      })
      .parse(req.body);
    const total = body.items.reduce((s, i) => s + i.qty * i.unitMinor, 0);
    const bill = await prisma.purchaseBill.create({
      data: {
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
    if (existing.confirmedAt) return reply.code(409).send({ error: "already_confirmed" });
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
    const bill = await prisma.purchaseBill.findUnique({ where: { id }, include: { items: true } });
    if (!bill) return reply.code(404).send({ error: "not_found" });
    if (bill.confirmedAt) return reply.code(409).send({ error: "already_confirmed" });

    await prisma.$transaction(async (tx) => {
      for (const it of bill.items) {
        await move(tx, it.productId, it.qty, "PURCHASE", { refType: "purchase", refId: bill.id, actorUserId: req.user?.id });
      }
      await tx.purchaseBill.update({ where: { id }, data: { confirmedAt: new Date() } });
    });
    await audit("purchase_bill.confirm", "PurchaseBill", id, { actorUserId: req.user?.id, after: { confirmed: true, itemCount: bill.items.length }, ip: req.ip });
    return { confirmed: true };
  });
}
