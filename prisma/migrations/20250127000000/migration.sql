-- CreateEnum
CREATE TYPE "RegistrationSource" AS ENUM ('WEB', 'APP');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "registrationSource" "RegistrationSource";

-- CreateIndex
CREATE INDEX "User_registrationSource_idx" ON "User"("registrationSource");

