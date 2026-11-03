-- Pedido "sobre pedido": fecha/hora estimada en que el pedido completo estará disponible.
-- La captura el cajero al confirmar disponibilidad. Opcional (NULL = sin fecha estimada),
-- por lo que los pedidos existentes no cambian.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "estimatedAvailableAt" TIMESTAMP(3);
