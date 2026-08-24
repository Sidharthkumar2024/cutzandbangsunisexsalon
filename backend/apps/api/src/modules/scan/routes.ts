// POS scanning & fast product lookup.
//   GET /scan/barcode/:code   -> single product by exact barcode (or SKU fallback)
//   GET /scan/search?q=        -> fuzzy product search by name / SKU / barcode
// Kept in its own module so it composes with the (concurrently-evolving)
// inventory routes without touching them.

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@cutz/db";
import { authorize } from "../../plugins/auth.js";
import { resolveBranchScope } from "../../lib/branch-scope.js";

const POS_ROLES = ["OWNER", "ADMIN", "MANAGER", "RECEPTION"] as const;

const productSelect = {
  id: true,
  branchId: true,
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
    const query = z.object({ branchId: z.string().trim().min(1).optional() }).parse(req.query);
    const scope = resolveBranchScope(req.user!, query.branchId);
    if (!scope.ok) return reply.code(scope.statusCode).send({ error: scope.error });
    const product = await prisma.product.findFirst({
      where: { branchId: scope.branchId, deletedAt: null, isActive: true, OR: [{ barcode: code }, { sku: code }] },
      select: productSelect,
    });
    if (!product) return reply.code(404).send({ error: "product_not_found", code });
    return { product, outOfStock: product.stockQty <= 0 };
  });

  // Fuzzy search for the POS "add product" box.
  app.get("/scan/search", { preHandler: authorize(...POS_ROLES) }, async (req, reply) => {
    const { q, take, branchId } = z
      .object({ q: z.string().trim().min(1), take: z.coerce.number().int().min(1).max(50).default(20), branchId: z.string().trim().min(1).optional() })
      .parse(req.query);
    const scope = resolveBranchScope(req.user!, branchId);
    if (!scope.ok) return reply.code(scope.statusCode).send({ error: scope.error });
    const products = await prisma.product.findMany({
      where: {
        branchId: scope.branchId,
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
      take,
      select: productSelect,
    });
    return { products };
  });
}
