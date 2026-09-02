import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EodCycleService } from '../pipeline/eod-cycle.service';
import { AutoresearchService } from '../pipeline/autoresearch.service';
import { PaperTradingService } from '../paper/paper-trading.service';
import { PrismaService } from '../prisma/prisma.service';
import { MarketDataService } from '../market/market-data.service';

@Controller('api')
export class ApiController {
  constructor(
    private readonly eod: EodCycleService,
    private readonly autoresearch: AutoresearchService,
    private readonly paper: PaperTradingService,
    private readonly prisma: PrismaService,
    private readonly market: MarketDataService,
    private readonly config: ConfigService,
  ) {}

  @Get('health')
  health() {
    return { ok: true, service: 'paper-agents' };
  }

  @Get('status')
  async status() {
    const activeExperiment = await this.autoresearch.getActiveExperiment();
    await this.market.getSnapshot();

    return {
      marketDataSource: this.market.getDataSource(),
      llmPrimary: this.config.get<string>('LLM_PRIMARY', 'mock'),
      llmFallbacks: this.config.get<string>('LLM_FALLBACKS', 'ollama,omniroute,openai'),
      autoresearchEvalDays: this.autoresearch.getEvaluationDays(),
      activeExperiment,
    };
  }

  @Get('agents')
  async listAgents() {
    return this.prisma.agent.findMany({
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
  }

  @Get('runs')
  async listRuns() {
    return this.prisma.dailyRun.findMany({
      orderBy: { runDate: 'desc' },
      take: 20,
      include: {
        _count: { select: { recommendations: true, trades: true } },
      },
    });
  }

  @Get('runs/latest')
  async latestRun() {
    return this.prisma.dailyRun.findFirst({
      orderBy: { runDate: 'desc' },
      include: {
        recommendations: {
          include: { agent: { select: { slug: true, name: true } } },
        },
        trades: true,
      },
    });
  }

  @Get('portfolio')
  getPortfolio() {
    return this.paper.getPortfolio();
  }

  @Get('autoresearch/experiments')
  listExperiments() {
    return this.autoresearch.listExperiments();
  }

  @Get('autoresearch/active')
  getActiveExperiment() {
    return this.autoresearch.getActiveExperiment();
  }

  @Post('autoresearch/start')
  startAutoresearch() {
    return this.autoresearch.startExperiment();
  }

  @Post('pipeline/run')
  runPipeline(
    @Body() body: { autoresearch?: boolean; force?: boolean } = {},
  ) {
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
