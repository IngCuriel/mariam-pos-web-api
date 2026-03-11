-- Add features column to Product (list of characteristics for online store)
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "features" JSONB;
