-- AlterTable
ALTER TABLE "Notification" ADD COLUMN "hiddenAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Notification_hiddenAt_idx" ON "Notification"("hiddenAt");
