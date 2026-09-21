-- AlterTable: agregar el flag de visibilidad de la sucursal en la tienda en línea.
-- Por defecto false: las sucursales existentes quedan ocultas hasta activarse.
ALTER TABLE "Branch" ADD COLUMN "showInStore" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Branch_showInStore_idx" ON "Branch"("showInStore");
