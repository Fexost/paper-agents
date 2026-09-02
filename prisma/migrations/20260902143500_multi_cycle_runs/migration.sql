-- DropIndex
DROP INDEX "DailyRun_runDate_key";

-- AlterTable
ALTER TABLE "DailyRun" ADD COLUMN "cycleNumber" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "DailyRun" ADD COLUMN "skippedActions" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "DailyRun_runDate_cycleNumber_key" ON "DailyRun"("runDate", "cycleNumber");
