-- CreateEnum
CREATE TYPE "AgentLayer" AS ENUM ('MACRO', 'SECTOR', 'DECISION');

-- CreateEnum
CREATE TYPE "Direction" AS ENUM ('LONG', 'SHORT', 'NEUTRAL');

-- CreateEnum
CREATE TYPE "MarketRegime" AS ENUM ('RISK_ON', 'RISK_OFF', 'NEUTRAL');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "TradeAction" AS ENUM ('BUY', 'SELL', 'HOLD');

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "layer" "AgentLayer" NOT NULL,
    "darwinWeight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "rollingSharpe" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentPrompt" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "autoresearchNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentPrompt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyRun" (
    "id" TEXT NOT NULL,
    "runDate" DATE NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'PENDING',
    "regime" "MarketRegime",
    "summary" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "direction" "Direction" NOT NULL,
    "conviction" INTEGER NOT NULL,
    "entryPrice" DOUBLE PRECISION,
    "rationale" TEXT NOT NULL,
    "forwardReturn1d" DOUBLE PRECISION,
    "forwardReturn5d" DOUBLE PRECISION,
    "isHit" BOOLEAN,
    "scoredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreSnapshot" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "sharpe" DOUBLE PRECISION NOT NULL,
    "hitRate" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScoreSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperAccount" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "cashBalance" DOUBLE PRECISION NOT NULL DEFAULT 100000,
    "startingCash" DOUBLE PRECISION NOT NULL DEFAULT 100000,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaperAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperPosition" (
    "id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "shares" DOUBLE PRECISION NOT NULL,
    "avgCost" DOUBLE PRECISION NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaperPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperTrade" (
    "id" TEXT NOT NULL,
    "runId" TEXT,
    "ticker" TEXT NOT NULL,
    "action" "TradeAction" NOT NULL,
    "shares" DOUBLE PRECISION NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaperTrade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Agent_slug_key" ON "Agent"("slug");

-- CreateIndex
CREATE INDEX "Agent_layer_idx" ON "Agent"("layer");

-- CreateIndex
CREATE INDEX "AgentPrompt_agentId_isActive_idx" ON "AgentPrompt"("agentId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "AgentPrompt_agentId_version_key" ON "AgentPrompt"("agentId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "DailyRun_runDate_key" ON "DailyRun"("runDate");

-- CreateIndex
CREATE INDEX "DailyRun_runDate_idx" ON "DailyRun"("runDate");

-- CreateIndex
CREATE INDEX "Recommendation_runId_idx" ON "Recommendation"("runId");

-- CreateIndex
CREATE INDEX "Recommendation_agentId_idx" ON "Recommendation"("agentId");

-- CreateIndex
CREATE INDEX "Recommendation_ticker_idx" ON "Recommendation"("ticker");

-- CreateIndex
CREATE UNIQUE INDEX "ScoreSnapshot_agentId_snapshotDate_key" ON "ScoreSnapshot"("agentId", "snapshotDate");

-- CreateIndex
CREATE UNIQUE INDEX "PaperPosition_ticker_key" ON "PaperPosition"("ticker");

-- CreateIndex
CREATE INDEX "PaperTrade_ticker_idx" ON "PaperTrade"("ticker");

-- CreateIndex
CREATE INDEX "PaperTrade_runId_idx" ON "PaperTrade"("runId");

-- AddForeignKey
ALTER TABLE "AgentPrompt" ADD CONSTRAINT "AgentPrompt_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DailyRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreSnapshot" ADD CONSTRAINT "ScoreSnapshot_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperTrade" ADD CONSTRAINT "PaperTrade_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DailyRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
