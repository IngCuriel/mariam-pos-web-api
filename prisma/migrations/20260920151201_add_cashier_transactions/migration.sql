-- CreateEnum
CREATE TYPE "CashierTransactionType" AS ENUM ('RECARGA', 'PAGO_SERVICIO', 'PIN_ELECTRONICO');

-- CreateTable
CREATE TABLE "CashierTransaction" (
    "id" SERIAL NOT NULL,
    "type" "CashierTransactionType" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "branchId" INTEGER NOT NULL,
    "cashierName" TEXT NOT NULL,
    "notes" TEXT,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashierTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CashierTransaction_branchId_idx" ON "CashierTransaction"("branchId");

-- CreateIndex
CREATE INDEX "CashierTransaction_type_idx" ON "CashierTransaction"("type");

-- CreateIndex
CREATE INDEX "CashierTransaction_registeredAt_idx" ON "CashierTransaction"("registeredAt");

-- CreateIndex
CREATE INDEX "CashierTransaction_userId_idx" ON "CashierTransaction"("userId");

-- AddForeignKey
ALTER TABLE "CashierTransaction" ADD CONSTRAINT "CashierTransaction_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashierTransaction" ADD CONSTRAINT "CashierTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
