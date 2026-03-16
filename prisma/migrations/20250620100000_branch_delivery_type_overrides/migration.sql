-- AlterTable BranchDeliveryType: isActive, costOverride, displayOrder por sucursal
ALTER TABLE "BranchDeliveryType" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "BranchDeliveryType" ADD COLUMN IF NOT EXISTS "costOverride" DOUBLE PRECISION;
ALTER TABLE "BranchDeliveryType" ADD COLUMN IF NOT EXISTS "displayOrder" INTEGER NOT NULL DEFAULT 0;
