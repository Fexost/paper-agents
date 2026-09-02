import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EodCycleService } from '../pipeline/eod-cycle.service';
import { AutoresearchService } from '../pipeline/autoresearch.service';
import { PaperTradingService } from '../paper/paper-trading.service';
import { PrismaService } from '../prisma/prisma.service';
import { MarketDataService } from '../market/market-data.service';
import { LlmService } from '../llm/llm.service';
import { ScorecardService } from '../pipeline/scorecard.service';
import { PipelineProgressService } from '../pipeline/pipeline-progress.service';
import { paginate, parseLimit } from '../common/pagination.util';

@Controller('api')
export class ApiController {
  constructor(
    private readonly eod: EodCycleService,
    private readonly autoresearch: AutoresearchService,
    private readonly paper: PaperTradingService,
    private readonly prisma: PrismaService,
    private readonly market: MarketDataService,
    private readonly config: ConfigService,
    private readonly llm: LlmService,
    private readonly scorecard: ScorecardService,
    private readonly progress: PipelineProgressService,
  ) {}

  @Get('health')
  health() {
    return {
      ok: true,
      service: 'paper-agents',
      port: Number(this.config.get<string>('PORT', '3001')),
    };
  }

  @Get('status')
  async status() {
    const activeExperiment = await this.autoresearch.getActiveExperiment();
    await this.market.getSnapshot();

    let database: 'ok' | 'error' = 'error';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = 'ok';
    } catch {
      database = 'error';
    }

    const llmProviders = this.llm.getProviderStatus();
    const market = this.market.getMarketStatus();

    return {
      api: {
        ok: true,
        service: 'paper-agents',
        port: Number(this.config.get<string>('PORT', '3001')),
      },
      database,
      serverTime: new Date().toISOString(),
      marketDataSource: market.source,
      market,
      llmPrimary: this.config.get<string>('LLM_PRIMARY', 'mock'),
      llmFallbacks: this.config.get<string>(
        'LLM_FALLBACKS',
        'ollama,omniroute,openai',
      ),
      llmProviders,
      llmReady: llmProviders.some((p) => p.ready && p.name !== 'mock'),
      autoresearchEvalDays: this.autoresearch.getEvaluationDays(),
      activeExperiment,
    };
  }

  @Get('agents')
  async listAgents() {
    const agents = await this.prisma.agent.findMany({
      include: {
        prompts: {
          where: { isActive: true },
          select: { version: true, autoresearchNote: true, createdAt: true },
        },
        scoreSnapshots: {
          orderBy: { snapshotDate: 'desc' },
          take: 5,
        },
      },
      orderBy: { darwinWeight: 'desc' },
    });

    return Promise.all(
      agents.map(async (agent) => {
        const metrics = await this.scorecard.metricsForAgent(agent.id);
        return {
          ...agent,
          hitRate: metrics.hitRate,
          scoredRecommendations: metrics.scoredCount,
        };
      }),
    );
  }

  @Get('runs')
  async listRuns(
    @Query('limit') limitRaw?: string,
    @Query('cursor') cursor?: string,
  ) {
    const limit = parseLimit(limitRaw, 5, 200);
    const rows = await this.prisma.dailyRun.findMany({
      take: limit + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: [{ runDate: 'desc' }, { cycleNumber: 'desc' }, { id: 'desc' }],
      include: {
        _count: { select: { recommendations: true, trades: true } },
      },
    });

    return paginate(rows, limit);
  }

  @Get('runs/latest')
  async latestRun() {
    return this.prisma.dailyRun.findFirst({
      orderBy: [{ runDate: 'desc' }, { cycleNumber: 'desc' }],
      include: {
        recommendations: {
          include: { agent: { select: { slug: true, name: true } } },
        },
        trades: true,
      },
    });
  }

  @Get('runs/:id')
  async getRun(@Param('id') id: string) {
    const run = await this.prisma.dailyRun.findUnique({
      where: { id },
      include: {
        recommendations: {
          include: { agent: { select: { slug: true, name: true } } },
        },
        trades: true,
        _count: { select: { recommendations: true, trades: true } },
      },
    });

    if (!run) {
      throw new NotFoundException(`Run not found: ${id}`);
    }

    return run;
  }

  @Get('trades')
  listTrades(
    @Query('limit') limitRaw?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.paper.listTrades(limitRaw, cursor);
  }

  @Get('portfolio')
  getPortfolio() {
    return this.paper.getPortfolio();
  }

  @Post('portfolio/reset')
  async resetPortfolio() {
    const portfolio = await this.paper.resetPortfolio();
    return {
      ...portfolio,
      message:
        'Paper cash and positions reset. Agent prompts, Darwin weights, Sharpe, hit rate, run history, and autoresearch were kept.',
    };
  }

  @Get('autoresearch/experiments')
  listExperiments(
    @Query('limit') limitRaw?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.autoresearch.listExperiments(limitRaw, cursor);
  }

  @Get('autoresearch/active')
  getActiveExperiment() {
    return this.autoresearch.getActiveExperiment();
  }

  @Post('autoresearch/start')
  startAutoresearch() {
    return this.autoresearch.startExperiment();
  }

  @Get('pipeline/progress')
  getPipelineProgress() {
    return this.progress.getProgress();
  }

  @Post('pipeline/run')
  runPipeline(@Body() body: { autoresearch?: boolean; force?: boolean } = {}) {
    return this.eod.runDailyCycle({
      runAutoresearch: body.autoresearch ?? false,
      force: body.force ?? false,
    });
  }

  @Post('autoresearch/propose')
  proposeAutoresearch() {
    return this.autoresearch.startExperiment();
  }

  @Get('agents/:slug/prompt')
  async getAgentPrompt(@Param('slug') slug: string) {
    const agent = await this.prisma.agent.findUnique({
      where: { slug },
      include: {
        prompts: {
          where: { isActive: true },
          take: 1,
        },
      },
    });

    if (!agent || agent.prompts.length === 0) {
      throw new NotFoundException(`No active prompt for agent: ${slug}`);
    }

    const prompt = agent.prompts[0];
    return {
      agent: { slug: agent.slug, name: agent.name, layer: agent.layer },
      prompt: {
        id: prompt.id,
        version: prompt.version,
        content: prompt.content,
        autoresearchNote: prompt.autoresearchNote,
        updatedAt: prompt.createdAt,
      },
    };
  }

  @Put('agents/:slug/prompt')
  async updateAgentPrompt(
    @Param('slug') slug: string,
    @Body() body: { content: string; note?: string },
  ) {
    const agent = await this.prisma.agent.findUnique({ where: { slug } });
    if (!agent) {
      throw new NotFoundException(`Agent not found: ${slug}`);
    }

    const nextVersion =
      (
        await this.prisma.agentPrompt.aggregate({
          where: { agentId: agent.id },
          _max: { version: true },
        })
      )._max.version ?? 0;

    await this.prisma.$transaction([
      this.prisma.agentPrompt.updateMany({
        where: { agentId: agent.id, isActive: true },
        data: { isActive: false },
      }),
      this.prisma.agentPrompt.create({
        data: {
          agentId: agent.id,
          version: nextVersion + 1,
          content: body.content,
          isActive: true,
          autoresearchNote: body.note ?? 'Manual dashboard edit',
        },
      }),
    ]);

    return this.getAgentPrompt(slug);
  }
}
