// POS scanning & fast product lookup.
//   GET /scan/barcode/:code   -> single product by exact barcode (or SKU fallback)
//   GET /scan/search?q=        -> fuzzy product search by name / SKU / barcode
// Kept in its own module so it composes with the (concurrently-evolving)
// inventory routes without touching them.

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@cutz/db";
import { authorize } from "../../plugins/auth.js";

const POS_ROLES = ["OWNER", "ADMIN", "MANAGER", "RECEPTION"] as const;

const productSelect = {
  id: true,
  name: true,
  brand: true,
  sku: true,
  barcode: true,
  sellMinor: true,
  taxRateBps: true,
  stockQty: true,
  reorderLevel: true,
} as const;

export default async function scanRoutes(app: FastifyInstance) {
  // Exact scan: barcode first, then SKU. Returns the sellable product for POS.
  app.get("/scan/barcode/:code", { preHandler: authorize(...POS_ROLES) }, async (req, reply) => {
    const { code } = z.object({ code: z.string().min(1) }).parse(req.params);
    const product = await prisma.product.findFirst({
      where: { deletedAt: null, isActive: true, OR: [{ barcode: code }, { sku: code }] },
      select: productSelect,
    });
    if (!product) return reply.code(404).send({ error: "product_not_found", code });
    return { product, outOfStock: product.stockQty <= 0 };
  });

  // Fuzzy search for the POS "add product" box.
  app.get("/scan/search", { preHandler: authorize(...POS_ROLES) }, async (req) => {
    const { q, take = "20" } = z
      .object({ q: z.string().trim().min(1), take: z.string().optional() })
      .parse(req.query);
    const products = await prisma.product.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { sku: { contains: q, mode: "insensitive" } },
          { barcode: { contains: q } },
          { brand: { contains: q, mode: "insensitive" } },
        ],
      },
      orderBy: { name: "asc" },
      take: Math.min(50, Math.max(1, Number(take) || 20)),
      select: productSelect,
    });
    return { products };
  });
}
