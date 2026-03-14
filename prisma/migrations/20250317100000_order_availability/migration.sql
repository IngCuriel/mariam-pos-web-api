-- Add orderAvailability to Order (origin: local_delivery | online_pickup from cart group)
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "orderAvailability" TEXT;
