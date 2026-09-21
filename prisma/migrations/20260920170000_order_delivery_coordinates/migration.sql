-- Snapshot de la ubicación (lat/lng) del cliente al confirmar el pedido con envío a domicilio.
-- Se copian desde UserAddress y se congelan en el pedido para preservar el histórico.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "deliveryLatitude" DOUBLE PRECISION;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "deliveryLongitude" DOUBLE PRECISION;
