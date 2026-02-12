-- Flujo de pedidos: nuevo enum OrderStatus, campos confirmedAt/readyAt y confirmedQuantity
-- Paso 1: Crear nuevo tipo enum
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

-- Paso 2: Añadir columnas nuevas a Order
ALTER TABLE "Order" ADD COLUMN "confirmedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "readyAt" TIMESTAMP(3);

-- Paso 3: Añadir columna nueva a OrderItem
ALTER TABLE "OrderItem" ADD COLUMN "confirmedQuantity" INTEGER;

-- Paso 4: Añadir columna status con nuevo tipo
ALTER TABLE "Order" ADD COLUMN "status_new" "OrderStatus_new";

-- Paso 5: Migrar datos de status antiguo a nuevo (mapeo)
UPDATE "Order" SET "status_new" = CASE
  WHEN status::text = 'PENDIENTE' THEN 'UNDER_REVIEW'::"OrderStatus_new"
  WHEN status::text = 'CONFIRMADO' THEN 'IN_PREPARATION'::"OrderStatus_new"
  WHEN status::text = 'EN_PREPARACION' THEN 'IN_PREPARATION'::"OrderStatus_new"
  WHEN status::text = 'LISTO' THEN 'READY_FOR_PICKUP'::"OrderStatus_new"
  WHEN status::text = 'ENTREGADO' THEN 'COMPLETED'::"OrderStatus_new"
  WHEN status::text = 'CANCELADO' THEN 'CANCELLED'::"OrderStatus_new"
  ELSE 'UNDER_REVIEW'::"OrderStatus_new"
END;

-- Paso 6: Eliminar columna antigua y renombrar
ALTER TABLE "Order" DROP COLUMN "status";
ALTER TABLE "Order" RENAME COLUMN "status_new" TO "status";
ALTER TABLE "Order" ALTER COLUMN "status" SET DEFAULT 'UNDER_REVIEW'::"OrderStatus_new";
ALTER TABLE "Order" ALTER COLUMN "status" SET NOT NULL;

-- Paso 7: Eliminar tipo enum antiguo y renombrar el nuevo
DROP TYPE "OrderStatus";
ALTER TYPE "OrderStatus_new" RENAME TO "OrderStatus";
