-- Reemplazo de tipoEnvio por productAvailability (modelo de disponibilidad)
-- Valores: online_pickup (compra en línea, recoger en sucursal) | local_delivery (inmediato, domicilio/sucursal) | in_store_only (solo sucursal/servicios)

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "productAvailability" TEXT;

UPDATE "Product"
SET "productAvailability" = CASE
  WHEN "tipoEnvio" = 'SOLO_TIENDA' THEN 'in_store_only'
  WHEN "tipoEnvio" = 'ENVIO_INMEDIATO' THEN 'local_delivery'
  WHEN "tipoEnvio" = 'SOBRE_PEDIDO' THEN 'online_pickup'
  ELSE NULL
END
WHERE "tipoEnvio" IS NOT NULL;

ALTER TABLE "Product" DROP COLUMN IF EXISTS "tipoEnvio";

CREATE INDEX IF NOT EXISTS "Product_productAvailability_idx" ON "Product"("productAvailability");
