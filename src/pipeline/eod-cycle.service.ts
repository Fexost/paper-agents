import { Injectable, Logger } from '@nestjs/common';
import {
  Direction,
  Prisma,
  RunStatus,
  TradeAction,
} from '../../generated/prisma/client';
import { AgentRunnerService, CioAction } from '../agents/agent-runner.service';
import { MarketDataService } from '../market/market-data.service';
import { PaperTradingService } from '../paper/paper-trading.service';
import { PrismaService } from '../prisma/prisma.service';
import { AutoresearchService } from './autoresearch.service';
import { DarwinService } from './darwin.service';
import { ScorecardService } from './scorecard.service';
import { PipelineProgressService } from './pipeline-progress.service';
import { calendarDateOnly } from '../common/date.util';

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
    private readonly progress: PipelineProgressService,
  ) {}

  async runDailyCycle(
    options: { runAutoresearch?: boolean; force?: boolean } = {},
  ) {
    const today = calendarDateOnly();

    const todaysRuns = await this.prisma.dailyRun.findMany({
      where: { runDate: today },
      orderBy: { cycleNumber: 'desc' },
    });
    const latestToday = todaysRuns[0];

    if (latestToday?.status === RunStatus.COMPLETED && !options.force) {
      return { status: 'already_completed', runId: latestToday.id };
    }

    const snapshot = await this.market.getSnapshot({ force: true });
    const prices = Object.fromEntries(
      [
        ...snapshot.indices,
        ...snapshot.watchlist,
        ...(snapshot.vix ? [snapshot.vix] : []),
      ].map((quote) => [quote.ticker, quote.price]),
    );

    await this.scorecard.scoreOpenRecommendations(prices);
    await this.scorecard.refreshAgentMetrics();

    let run;
    if (
      latestToday &&
      !options.force &&
      (latestToday.status === RunStatus.RUNNING ||
        latestToday.status === RunStatus.FAILED)
    ) {
      await this.prisma.recommendation.deleteMany({
        where: { runId: latestToday.id },
      });
      await this.prisma.paperTrade.deleteMany({
        where: { runId: latestToday.id },
      });
      run = await this.prisma.dailyRun.update({
        where: { id: latestToday.id },
        data: {
          status: RunStatus.RUNNING,
          startedAt: new Date(),
          summary: null,
          regime: null,
          skippedActions: Prisma.DbNull,
          completedAt: null,
        },
      });
    } else {
      const cycleNumber = latestToday ? latestToday.cycleNumber + 1 : 1;
      run = await this.prisma.dailyRun.create({
        data: {
          runDate: today,
          cycleNumber,
          status: RunStatus.RUNNING,
          startedAt: new Date(),
        },
      });
    }

    this.progress.start(run.id, run.cycleNumber);

    try {
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

      this.progress.setStep('macro', 'active');
      const macro = await this.agents.runMacro(snapshot, promptFor('macro'));
      this.progress.completeStep('macro');

      this.progress.setStep('sector', 'active');
      const sector = await this.agents.runSector(
        snapshot,
        macro,
        promptFor('sector'),
      );
      this.progress.completeStep('sector');

      const portfolio = await this.paper.getPortfolio(prices);
      const weightedAgents = await this.darwin.updateWeights();
      const portfolioContext = {
        account: portfolio.account,
        positions: portfolio.positions.map((p) => ({
          ticker: p.ticker,
          shares: p.shares,
          avgCost: p.avgCost,
          marketValue: p.marketValue,
        })),
        totals: portfolio.totals,
      };

      this.progress.setStep('cio', 'active');
      const cio = await this.agents.runCio(
        macro,
        sector,
        portfolioContext,
        this.darwin.toWeightMap(weightedAgents),
        promptFor('cio'),
        Number(process.env.MAX_POSITION_PCT ?? 0.1),
      );
      this.progress.completeStep('cio');
      this.progress.setStep('finalize', 'active');

      const heldShares = new Map(
        portfolio.positions.map((p) => [p.ticker.toUpperCase(), p.shares]),
      );
      const cioActions = this.sanitizeCioActions(cio.actions, heldShares);

      const macroAgent = agentRecords.find((a) => a.slug === 'macro');
      const sectorAgent = agentRecords.find((a) => a.slug === 'sector');
      const cioAgent = agentRecords.find((a) => a.slug === 'cio');

      const spyPrice = prices['SPY'];
      if (macroAgent && spyPrice) {
        await this.prisma.recommendation.create({
          data: {
            runId: run.id,
            agentId: macroAgent.id,
            ticker: 'SPY',
            direction: this.scorecard.regimeToDirection(macro.regime),
            conviction: macro.conviction,
            entryPrice: spyPrice,
            rationale: `[${macro.regime}] ${macro.rationale}`,
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

      const { executed: trades, skipped } = await this.paper.executeActions(
        cioActions,
        prices,
        run.id,
      );

      if (cioAgent) {
        for (const trade of trades) {
          const sourceAction = cioActions.find(
            (a) =>
              a.ticker.toUpperCase() === trade.ticker &&
              a.action === trade.action,
          );
          await this.prisma.recommendation.create({
            data: {
              runId: run.id,
              agentId: cioAgent.id,
              ticker: trade.ticker,
              direction:
                trade.action === TradeAction.SELL
                  ? Direction.SHORT
                  : Direction.LONG,
              conviction: sourceAction?.conviction ?? 50,
              entryPrice: trade.price,
              rationale: trade.reason,
            },
          });
        }
      }

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
          regime: macro.regime,
          summary: cio.market_view,
          skippedActions:
            skipped.length > 0
              ? (skipped as unknown as Prisma.InputJsonValue)
              : undefined,
        },
      });

      this.logger.log(
        `Daily run completed: ${completed.id} (cycle ${completed.cycleNumber})`,
      );

      this.progress.complete();

      return {
        status: 'completed',
        runId: completed.id,
        cycleNumber: completed.cycleNumber,
        regime: macro.regime,
        macro,
        sector,
        cio,
        trades,
        skipped,
        autoresearch: autoresearchResult,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.progress.fail(message);
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

  /** Drop invalid CIO orders before execution (e.g. SELL when flat). */
  private sanitizeCioActions(
    actions: CioAction[],
    heldShares: Map<string, number>,
  ): CioAction[] {
    const sanitized: CioAction[] = [];

    for (const action of actions) {
      const ticker = action.ticker.toUpperCase();
      const sharesHeld = heldShares.get(ticker) ?? 0;

      if (action.action === 'HOLD' || action.shares <= 0) {
        continue;
      }

      if (action.action === 'SELL' && sharesHeld <= 0) {
        this.logger.debug(
          `Dropped CIO SELL ${ticker}: not in portfolio (LLM hallucination)`,
        );
        continue;
      }

      sanitized.push({
        ...action,
        ticker,
        shares:
          action.action === 'SELL'
            ? Math.min(action.shares, sharesHeld)
            : action.shares,
      });
    }

    return sanitized;
  }
}
