-- Add presentation fields to OrderItem (presentation chosen by customer)
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "presentationName" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "presentationQuantity" INTEGER;
