-- Purchase confirmation writes one deterministic movement per bill/product.
-- Existing rows remain nullable so this is safe on databases that already
-- contain historical movements.
ALTER TABLE "InventoryMovement" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "InventoryMovement_idempotencyKey_key"
ON "InventoryMovement"("idempotencyKey");
