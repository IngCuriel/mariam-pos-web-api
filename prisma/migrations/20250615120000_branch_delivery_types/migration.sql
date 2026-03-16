-- CreateTable BranchDeliveryType: cada sucursal puede tener configurados uno o varios tipos de entrega
CREATE TABLE "BranchDeliveryType" (
    "branchId" INTEGER NOT NULL,
    "deliveryTypeId" INTEGER NOT NULL,

    CONSTRAINT "BranchDeliveryType_pkey" PRIMARY KEY ("branchId","deliveryTypeId")
);

CREATE INDEX "BranchDeliveryType_branchId_idx" ON "BranchDeliveryType"("branchId");
CREATE INDEX "BranchDeliveryType_deliveryTypeId_idx" ON "BranchDeliveryType"("deliveryTypeId");

ALTER TABLE "BranchDeliveryType" ADD CONSTRAINT "BranchDeliveryType_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BranchDeliveryType" ADD CONSTRAINT "BranchDeliveryType_deliveryTypeId_fkey" FOREIGN KEY ("deliveryTypeId") REFERENCES "DeliveryType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Por defecto: todas las sucursales tienen ambos tipos de entrega (pickup=1, delivery=2)
INSERT INTO "BranchDeliveryType" ("branchId", "deliveryTypeId")
SELECT b.id, dt.id
FROM "Branch" b
CROSS JOIN "DeliveryType" dt
WHERE dt."isActive" = true
ON CONFLICT ("branchId", "deliveryTypeId") DO NOTHING;
