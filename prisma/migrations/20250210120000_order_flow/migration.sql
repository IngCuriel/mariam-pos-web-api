-- Flujo de pedidos: nuevo enum OrderStatus + columnas nuevas (sin migrar datos viejos; no hay pedidos)
-- Paso 1: Nuevo tipo enum
CREATE TYPE "OrderStatus_new" AS ENUM (
  'CREATED',
  'UNDER_REVIEW',
  'PARTIALLY_AVAILABLE',
  'AVAILABLE',
  'IN_PREPARATION',
  'READY_FOR_PICKUP',
  'COMPLETED',
  'CANCELLED'
);

-- Paso 2: Columnas nuevas en Order
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "confirmedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "readyAt" TIMESTAMP(3);

-- Paso 3: Columna nueva en OrderItem
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "confirmedQuantity" INTEGER;

-- Paso 4: Columna temporal con el nuevo enum
ALTER TABLE "Order" ADD COLUMN "status_new" "OrderStatus_new";

-- Paso 5: Todas las filas (si hay) quedan en UNDER_REVIEW
UPDATE "Order" SET "status_new" = 'UNDER_REVIEW'::"OrderStatus_new";

-- Paso 6: Sustituir columna status
ALTER TABLE "Order" DROP COLUMN "status";
ALTER TABLE "Order" RENAME COLUMN "status_new" TO "status";
ALTER TABLE "Order" ALTER COLUMN "status" SET DEFAULT 'UNDER_REVIEW'::"OrderStatus_new";
ALTER TABLE "Order" ALTER COLUMN "status" SET NOT NULL;

-- Paso 7: Sustituir tipo enum
DROP TYPE "OrderStatus";
ALTER TYPE "OrderStatus_new" RENAME TO "OrderStatus";
