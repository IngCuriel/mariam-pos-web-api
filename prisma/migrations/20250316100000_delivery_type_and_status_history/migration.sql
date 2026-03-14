-- Add IN_TRANSIT to OrderStatus (PostgreSQL). Run once; if already applied, comment out this line.
ALTER TYPE "OrderStatus" ADD VALUE 'IN_TRANSIT';

-- CreateTable DeliveryType
CREATE TABLE "DeliveryType" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DeliveryType_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeliveryType_code_key" ON "DeliveryType"("code");
CREATE INDEX "DeliveryType_isActive_idx" ON "DeliveryType"("isActive");

-- CreateTable OrderStatusHistory
CREATE TABLE "OrderStatusHistory" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "status" "OrderStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStatusHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrderStatusHistory_orderId_idx" ON "OrderStatusHistory"("orderId");
CREATE INDEX "OrderStatusHistory_orderId_createdAt_idx" ON "OrderStatusHistory"("orderId", "createdAt");

ALTER TABLE "OrderStatusHistory" ADD CONSTRAINT "OrderStatusHistory_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable Order: add delivery fields
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "deliveryTypeId" INTEGER;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "deliveryCost" DOUBLE PRECISION;

CREATE INDEX "Order_deliveryTypeId_idx" ON "Order"("deliveryTypeId");

ALTER TABLE "Order" ADD CONSTRAINT "Order_deliveryTypeId_fkey" FOREIGN KEY ("deliveryTypeId") REFERENCES "DeliveryType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed default delivery types (configurables)
INSERT INTO "DeliveryType" ("code", "name", "cost", "isActive", "displayOrder")
VALUES
  ('pickup', 'Recoger en sucursal', 0, true, 0),
  ('delivery', 'Envío a domicilio', 10, true, 1)
ON CONFLICT ("code") DO NOTHING;
