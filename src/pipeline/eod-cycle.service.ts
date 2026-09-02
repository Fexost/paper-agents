import { Injectable, Logger } from '@nestjs/common';
import {
  Direction,
  MarketRegime,
  RunStatus,
} from '../../generated/prisma/client';
import { AgentRunnerService } from '../agents/agent-runner.service';
import { MarketDataService } from '../market/market-data.service';
import { PaperTradingService } from '../paper/paper-trading.service';
import { PrismaService } from '../prisma/prisma.service';
import { AutoresearchService } from './autoresearch.service';
import { DarwinService } from './darwin.service';
import { ScorecardService } from './scorecard.service';

@Injectable()
export class EodCycleService {
  private readonly logger = new Logger(EodCycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly market: MarketDataService,
    private readonly agents: AgentRunnerService,
    private readonly paper: PaperTradingService,
    private readonly scorecard: ScorecardService,
    private readonly darwin: DarwinService,
    private readonly autoresearch: AutoresearchService,
  ) {}

  async runDailyCycle(
    options: { runAutoresearch?: boolean; force?: boolean } = {},
  ) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existing = await this.prisma.dailyRun.findUnique({
      where: { runDate: today },
    });

    if (existing?.status === RunStatus.COMPLETED && !options.force) {
      return { status: 'already_completed', runId: existing.id };
    }

    if (options.force && existing) {
      await this.prisma.recommendation.deleteMany({
        where: { runId: existing.id },
      });
      await this.prisma.paperTrade.deleteMany({ where: { runId: existing.id } });
      await this.prisma.dailyRun.delete({ where: { id: existing.id } });
    }

    const run = await this.prisma.dailyRun.upsert({
      where: { runDate: today },
      update: { status: RunStatus.RUNNING, startedAt: new Date() },
      create: {
        runDate: today,
        status: RunStatus.RUNNING,
        startedAt: new Date(),
      },
    });

    try {
      const snapshot = await this.market.getSnapshot();
      const prices = Object.fromEntries(
        [...snapshot.indices, ...snapshot.watchlist, ...(snapshot.vix ? [snapshot.vix] : [])].map(
          (quote) => [quote.ticker, quote.price],
        ),
      );

      await this.scorecard.scoreOpenRecommendations(prices);

      const agentRecords = await this.prisma.agent.findMany({
        include: {
          prompts: { where: { isActive: true }, take: 1 },
        },
      });

      const promptFor = (slug: string) => {
        const agent = agentRecords.find((item) => item.slug === slug);
        const prompt = agent?.prompts[0]?.content;
        if (!prompt) {
          throw new Error(`Missing active prompt for agent: ${slug}`);
        }
        return prompt;
      };

      const macro = await this.agents.runMacro(snapshot, promptFor('macro'));
      const sector = await this.agents.runSector(
        snapshot,
        macro,
        promptFor('sector'),
      );

      const portfolio = await this.paper.getPortfolio();
      const weightedAgents = await this.darwin.updateWeights();
      const cio = await this.agents.runCio(
        macro,
        sector,
        portfolio,
        this.darwin.toWeightMap(weightedAgents),
        promptFor('cio'),
        Number(process.env.MAX_POSITION_PCT ?? 0.1),
      );

      const macroAgent = agentRecords.find((a) => a.slug === 'macro');
      const sectorAgent = agentRecords.find((a) => a.slug === 'sector');

      if (macroAgent) {
        await this.prisma.recommendation.create({
          data: {
            runId: run.id,
            agentId: macroAgent.id,
            ticker: 'REGIME',
            direction: Direction.NEUTRAL,
            conviction: macro.conviction,
            rationale: macro.rationale,
          },
        });
      }

      if (sectorAgent) {
        for (const pick of sector.picks) {
          await this.prisma.recommendation.create({
            data: {
              runId: run.id,
              agentId: sectorAgent.id,
              ticker: pick.ticker,
              direction:
                pick.direction === 'SHORT' ? Direction.SHORT : Direction.LONG,
              conviction: pick.conviction,
              entryPrice: prices[pick.ticker],
              rationale: pick.thesis,
            },
          });
        }
      }

      const trades = await this.paper.executeActions(
        cio.actions,
        prices,
        run.id,
      );

      await this.scorecard.refreshAgentMetrics();

      let autoresearchResult = null;
      if (options.runAutoresearch) {
        const active = await this.autoresearch.getActiveExperiment();
        if (!active) {
          autoresearchResult = await this.autoresearch.startExperiment();
        }
      }
      const tickResult = await this.autoresearch.tickAfterDailyRun();
      if (tickResult) {
        autoresearchResult = tickResult;
      }

      const completed = await this.prisma.dailyRun.update({
        where: { id: run.id },
        data: {
          status: RunStatus.COMPLETED,
          completedAt: new Date(),
          regime: macro.regime as MarketRegime,
          summary: cio.market_view,
        },
      });

      this.logger.log(`Daily run completed: ${completed.id}`);

      return {
        status: 'completed',
        runId: completed.id,
        regime: macro.regime,
        macro,
        sector,
        cio,
        trades,
        autoresearch: autoresearchResult,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await this.prisma.dailyRun.update({
        where: { id: run.id },
        data: {
          status: RunStatus.FAILED,
          summary: message,
          completedAt: new Date(),
        },
      });
      throw error;
    }
  }
}
