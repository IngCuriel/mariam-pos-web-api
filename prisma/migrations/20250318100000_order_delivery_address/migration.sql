-- Dirección de envío: se pide cuando el cliente confirma el pedido (envío a domicilio)
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "deliveryAddress" TEXT;
