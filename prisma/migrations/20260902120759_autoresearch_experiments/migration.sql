-- CreateEnum
CREATE TYPE "AutoresearchStatus" AS ENUM ('EVALUATING', 'KEPT', 'REVERTED');

-- CreateTable
CREATE TABLE "AutoresearchExperiment" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "status" "AutoresearchStatus" NOT NULL DEFAULT 'EVALUATING',
    "baselineSharpe" DOUBLE PRECISION NOT NULL,
    "candidateSharpe" DOUBLE PRECISION,
    "evaluationDays" INTEGER NOT NULL DEFAULT 5,
    "daysCompleted" INTEGER NOT NULL DEFAULT 0,
    "changeSummary" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "baselinePromptId" TEXT NOT NULL,
    "candidatePromptId" TEXT NOT NULL,

    CONSTRAINT "AutoresearchExperiment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutoresearchExperiment_agentId_idx" ON "AutoresearchExperiment"("agentId");

-- CreateIndex
CREATE INDEX "AutoresearchExperiment_status_idx" ON "AutoresearchExperiment"("status");

-- CreateIndex
CREATE INDEX "AutoresearchExperiment_startedAt_idx" ON "AutoresearchExperiment"("startedAt");

-- AddForeignKey
ALTER TABLE "AutoresearchExperiment" ADD CONSTRAINT "AutoresearchExperiment_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
