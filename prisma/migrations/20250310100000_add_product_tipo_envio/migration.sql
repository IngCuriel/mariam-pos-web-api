-- Campo tipoEnvio: forma de entrega en tienda online (SOBRE_PEDIDO | SOLO_TIENDA | ENVIO_INMEDIATO).
-- Independiente de saleType (tipo de venta comercial).
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "tipoEnvio" TEXT;
