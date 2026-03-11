-- Campo logo para sucursal (URL de imagen)
ALTER TABLE "Branch" ADD COLUMN IF NOT EXISTS "logo" TEXT;
