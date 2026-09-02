-- AlterTable
ALTER TABLE "PaperTrade" ADD COLUMN "costBasis" DOUBLE PRECISION;
ALTER TABLE "PaperTrade" ADD COLUMN "realizedPnl" DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "PaperTrade_createdAt_idx" ON "PaperTrade"("createdAt");
