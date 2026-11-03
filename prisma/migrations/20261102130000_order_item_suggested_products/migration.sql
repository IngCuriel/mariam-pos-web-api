-- Productos sugeridos (alternativas) que el cajero propone cuando un ítem del pedido
-- no está disponible. Lista de ids de Product (máx. 3). Vacío por defecto, por lo que
-- los ítems existentes no cambian.
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "suggestedProductIds" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
