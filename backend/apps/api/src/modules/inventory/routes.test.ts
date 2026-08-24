import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  productFindMany: vi.fn(),
  productFindUnique: vi.fn(),
  productUpdate: vi.fn(),
  transaction: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@cutz/db", () => ({
  prisma: {
    product: {
      findMany: mocks.productFindMany,
      findUnique: mocks.productFindUnique,
      update: mocks.productUpdate,
    },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@cutz/providers", () => ({ providers: { ai: () => ({ extractVendorBill: vi.fn() }) } }));
vi.mock("../../lib/audit.js", () => ({ audit: mocks.audit }));

import inventoryRoutes from "./routes.js";

async function testApp() {
  const app = Fastify();
  app.decorateRequest("user", undefined);
  app.addHook("onRequest", async (req) => {
    req.user = { id: "manager-1", role: "MANAGER", branchId: "dwarka", permissionKeys: [] };
  });
  await app.register(inventoryRoutes);
  return app;
}

describe("inventory branch isolation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("filters product lists to the manager's branch", async () => {
    mocks.productFindMany.mockResolvedValue([]);
    const app = await testApp();
    const response = await app.inject({ method: "GET", url: "/products" });
    expect(response.statusCode).toBe(200);
    expect(mocks.productFindMany).toHaveBeenCalledWith({ where: { branchId: "dwarka", deletedAt: null }, orderBy: { name: "asc" } });
    await app.close();
  });

  it("rejects a manager's cross-branch product list request", async () => {
    const app = await testApp();
    const response = await app.inject({ method: "GET", url: "/products?branchId=gurugram" });
    expect(response.statusCode).toBe(403);
    expect(mocks.productFindMany).not.toHaveBeenCalled();
    await app.close();
  });

  it("blocks updates to a product owned by another branch", async () => {
    mocks.productFindUnique.mockResolvedValue({ id: "product-1", branchId: "gurugram", name: "Shampoo" });
    const app = await testApp();
    const response = await app.inject({ method: "PATCH", url: "/products/product-1", payload: { name: "New name" } });
    expect(response.statusCode).toBe(403);
    expect(mocks.productUpdate).not.toHaveBeenCalled();
    await app.close();
  });
});

type TestBill = {
  id: string;
  branchId: string;
  confirmedAt: Date | null;
  items: Array<{ id: string; productId: string; qty: number }>;
};

function installPurchaseConfirmationHarness(options?: {
  branchId?: string;
  stockQty?: number;
  items?: TestBill["items"];
  existingMovement?: boolean;
}) {
  const branchId = options?.branchId ?? "dwarka";
  const bill: TestBill = {
    id: "bill-1",
    branchId,
    confirmedAt: null,
    items: options?.items ?? [
      { id: "line-1", productId: "product-1", qty: 2 },
      { id: "line-2", productId: "product-1", qty: 3 },
    ],
  };
  const products = new Map([["product-1", { id: "product-1", branchId, stockQty: options?.stockQty ?? 10 }]]);
  const movements: Array<{
    branchId: string;
    productId: string;
    qtyDelta: number;
    stockAfter: number;
    refType?: string;
    refId?: string;
    idempotencyKey?: string | null;
  }> = options?.existingMovement
    ? [{ branchId, productId: "product-1", qtyDelta: 5, stockAfter: 15, refType: "purchase", refId: bill.id, idempotencyKey: null }]
    : [];

  // PostgreSQL's SELECT ... FOR UPDATE is modelled as a FIFO mutex. Each
  // transaction starts concurrently; only the bill-row query serializes it.
  let lockTail = Promise.resolve();
  const queryRawCalls: unknown[][] = [];
  const productUpdates: Array<{ id: string; stockQty: number }> = [];
  mocks.transaction.mockImplementation(async (callback: (tx: any) => Promise<unknown>) => {
    let releaseRowLock: (() => void) | undefined;
    let rowLocked = false;
    const tx = {
      $queryRaw: async (...args: unknown[]) => {
        queryRawCalls.push(args);
        if (!rowLocked) {
          const waitForPrior = lockTail;
          let release!: () => void;
          lockTail = new Promise<void>((resolve) => {
            release = resolve;
          });
          await waitForPrior;
          releaseRowLock = release;
          rowLocked = true;
          return [{ id: bill.id, branchId: bill.branchId, confirmedAt: bill.confirmedAt }];
        }
        return [{ locked: true }];
      },
      purchaseBill: {
        findUnique: vi.fn(async () => ({ ...bill, items: bill.items.map((item) => ({ ...item })) })),
        update: vi.fn(async ({ data }: { data: { confirmedAt: Date } }) => {
          bill.confirmedAt = data.confirmedAt;
          return { ...bill };
        }),
      },
      inventoryMovement: {
        findFirst: vi.fn(async ({ where }: { where: { branchId: string; productId: string; refType: string; refId: string } }) =>
          movements.find(
            (movement) =>
              movement.branchId === where.branchId &&
              movement.productId === where.productId &&
              movement.refType === where.refType &&
              movement.refId === where.refId,
          ) ?? null,
        ),
        create: vi.fn(async ({ data }: { data: (typeof movements)[number] }) => {
          movements.push({ ...data });
          return data;
        }),
      },
      product: {
        findFirst: vi.fn(async ({ where }: { where: { id: string; branchId: string } }) => {
          const product = products.get(where.id);
          return product?.branchId === where.branchId ? { ...product } : null;
        }),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: { stockQty: number } }) => {
          const product = products.get(where.id)!;
          product.stockQty = data.stockQty;
          productUpdates.push({ id: where.id, stockQty: data.stockQty });
          return { ...product };
        }),
      },
    };

    try {
      return await callback(tx);
    } finally {
      releaseRowLock?.();
    }
  });

  return { bill, products, movements, productUpdates, queryRawCalls };
}

describe("purchase bill confirmation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("serializes concurrent confirmations and posts stock exactly once", async () => {
    const state = installPurchaseConfirmationHarness();
    const app = await testApp();

    const responses = await Promise.all([
      app.inject({ method: "POST", url: "/purchase-bills/bill-1/confirm" }),
      app.inject({ method: "POST", url: "/purchase-bills/bill-1/confirm" }),
    ]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    expect(responses.find((response) => response.statusCode === 409)?.json()).toEqual({ error: "already_confirmed" });
    expect(state.products.get("product-1")?.stockQty).toBe(15);
    expect(state.movements).toHaveLength(1);
    expect(state.movements[0]).toMatchObject({
      branchId: "dwarka",
      productId: "product-1",
      qtyDelta: 5,
      refType: "purchase",
      refId: "bill-1",
      idempotencyKey: "purchase:dwarka:bill-1:product-1",
    });
    expect(state.productUpdates).toEqual([{ id: "product-1", stockQty: 15 }]);
    expect(state.queryRawCalls).toHaveLength(3); // two bill locks + one product lock
    expect((state.queryRawCalls[0][0] as readonly string[]).join(" ")).toContain("FOR UPDATE");
    expect(mocks.audit).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("recognises a legacy purchase movement and does not repost its stock", async () => {
    const state = installPurchaseConfirmationHarness({ stockQty: 15, existingMovement: true });
    const app = await testApp();

    const response = await app.inject({ method: "POST", url: "/purchase-bills/bill-1/confirm" });

    expect(response.statusCode).toBe(200);
    expect(state.bill.confirmedAt).toBeInstanceOf(Date);
    expect(state.products.get("product-1")?.stockQty).toBe(15);
    expect(state.movements).toHaveLength(1);
    expect(state.productUpdates).toHaveLength(0);
    await app.close();
  });

  it("keeps a cross-branch bill read-only after acquiring the row lock", async () => {
    const state = installPurchaseConfirmationHarness({ branchId: "gurugram" });
    const app = await testApp();

    const response = await app.inject({ method: "POST", url: "/purchase-bills/bill-1/confirm" });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "forbidden" });
    expect(state.bill.confirmedAt).toBeNull();
    expect(state.movements).toHaveLength(0);
    expect(state.productUpdates).toHaveLength(0);
    expect(mocks.audit).not.toHaveBeenCalled();
    await app.close();
  });
});
