-- Recuperación de contraseña
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordResetToken" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordResetExpires" TIMESTAMP(3);
