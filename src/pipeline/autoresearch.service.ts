import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AutoresearchStatus } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import { ScorecardService } from './scorecard.service';
import { PaginatedResult, paginate, parseLimit } from '../common/pagination.util';

export interface ActiveExperimentView {
  id: string;
  agentId: string;
  status: AutoresearchStatus;
  baselineSharpe: number;
  candidateSharpe: number | null;
  runningCandidateSharpe: number | null;
  runningDelta: number | null;
  evaluationDays: number;
  daysCompleted: number;
  changeSummary: string | null;
  startedAt: Date;
  completedAt: Date | null;
  agent: { slug: string; name: string; rollingSharpe: number };
}

@Injectable()
export class AutoresearchService {
  private readonly logger = new Logger(AutoresearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly scorecard: ScorecardService,
    private readonly config: ConfigService,
  ) {}

  getEvaluationDays(): number {
    return Number(this.config.get<string>('AUTORESEARCH_EVAL_DAYS', '5'));
  }

  async getActiveExperiment(): Promise<ActiveExperimentView | null> {
    const experiment = await this.prisma.autoresearchExperiment.findFirst({
      where: { status: AutoresearchStatus.EVALUATING },
      include: {
        agent: { select: { slug: true, name: true, rollingSharpe: true } },
      },
      orderBy: { startedAt: 'desc' },
    });

    if (!experiment) {
      return null;
    }

    const runningCandidateSharpe = await this.computeSharpeSince(
      experiment.agentId,
      experiment.startedAt,
    );

    return {
      ...experiment,
      runningCandidateSharpe,
      runningDelta: runningCandidateSharpe - experiment.baselineSharpe,
    };
  }

  async listExperiments(
    limitRaw?: string,
    cursor?: string,
  ): Promise<PaginatedResult<ActiveExperimentView & { agent: { slug: string; name: string } }>> {
    const limit = parseLimit(limitRaw, 5, 100);

    const rows = await this.prisma.autoresearchExperiment.findMany({
      take: limit + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      include: {
        agent: { select: { slug: true, name: true, rollingSharpe: true } },
      },
    });

    const enriched = await Promise.all(
      rows.map(async (experiment) => {
        let runningCandidateSharpe: number | null = null;
        let runningDelta: number | null = null;

        if (experiment.status === AutoresearchStatus.EVALUATING) {
          runningCandidateSharpe = await this.computeSharpeSince(
            experiment.agentId,
            experiment.startedAt,
          );
          runningDelta = runningCandidateSharpe - experiment.baselineSharpe;
        }

        return {
          ...experiment,
          runningCandidateSharpe,
          runningDelta,
        };
      }),
    );

    return paginate(enriched, limit);
  }

  async startExperiment() {
    const active = await this.getActiveExperiment();
    if (active) {
      return {
        status: 'skipped',
        reason: `Experiment already running for ${active.agent.slug} (${active.daysCompleted}/${active.evaluationDays} days)`,
        experiment: active,
      };
    }

    const evalDays = this.getEvaluationDays();
    const cooldownSince = new Date();
    cooldownSince.setDate(cooldownSince.getDate() - evalDays);

    const recentAgentIds = (
      await this.prisma.autoresearchExperiment.findMany({
        where: { startedAt: { gte: cooldownSince } },
        select: { agentId: true },
      })
    ).map((e) => e.agentId);

    const worst = await this.prisma.agent.findFirst({
      where: recentAgentIds.length
        ? { id: { notIn: recentAgentIds } }
        : undefined,
      orderBy: { rollingSharpe: 'asc' },
      include: {
        prompts: { where: { isActive: true }, take: 1 },
      },
    });

    if (!worst || worst.prompts.length === 0) {
      return {
        status: 'skipped',
        reason: 'No eligible agent (all recently experimented or missing prompt)',
      };
    }

    const baselinePrompt = worst.prompts[0];
    const recentRecs = await this.prisma.recommendation.findMany({
      where: { agentId: worst.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const completion = await this.llm.complete(
      [
        {
          role: 'system',
          content:
            'You improve trading-agent prompts. Propose exactly one targeted change based on recent failures. Return JSON: { "summary": "...", "updatedPrompt": "full new prompt text" }',
        },
        {
          role: 'user',
          content: JSON.stringify(
            {
              agent: worst.slug,
              rollingSharpe: worst.rollingSharpe,
              currentPrompt: baselinePrompt.content,
              recentRecommendations: recentRecs,
            },
            null,
            2,
          ),
        },
      ],
      { jsonMode: true },
    );

    const parsed = JSON.parse(completion.content) as {
      summary?: string;
      updatedPrompt?: string;
    };

    if (!parsed.updatedPrompt) {
      return { status: 'skipped', reason: 'LLM did not return updatedPrompt' };
    }

    const nextVersion =
      (
        await this.prisma.agentPrompt.aggregate({
          where: { agentId: worst.id },
          _max: { version: true },
        })
      )._max.version ?? 0;

    const experiment = await this.prisma.$transaction(async (tx) => {
      await tx.agentPrompt.updateMany({
        where: { agentId: worst.id, isActive: true },
        data: { isActive: false },
      });

      const candidatePrompt = await tx.agentPrompt.create({
        data: {
          agentId: worst.id,
          version: nextVersion + 1,
          content: parsed.updatedPrompt!,
          isActive: true,
          autoresearchNote: parsed.summary ?? 'Autoresearch candidate',
        },
      });

      return tx.autoresearchExperiment.create({
        data: {
          agentId: worst.id,
          status: AutoresearchStatus.EVALUATING,
          baselineSharpe: worst.rollingSharpe,
          evaluationDays: evalDays,
          daysCompleted: 0,
          changeSummary: parsed.summary,
          baselinePromptId: baselinePrompt.id,
          candidatePromptId: candidatePrompt.id,
        },
        include: {
          agent: { select: { slug: true, name: true } },
        },
      });
    });

    this.logger.log(
      `Autoresearch experiment started for ${worst.slug} (v${nextVersion + 1}, ${evalDays}-day eval)`,
    );

    return {
      status: 'started',
      experiment,
      message: `Evaluating prompt change for ${worst.slug} over ${evalDays} paper runs`,
    };
  }

  async tickAfterDailyRun() {
    const experiment = await this.getActiveExperiment();
    if (!experiment) {
      return null;
    }

    const daysCompleted = experiment.daysCompleted + 1;
    const updated = await this.prisma.autoresearchExperiment.update({
      where: { id: experiment.id },
      data: { daysCompleted },
    });

    if (daysCompleted < experiment.evaluationDays) {
      return {
        status: 'evaluating',
        experiment: updated,
        message: `Day ${daysCompleted}/${experiment.evaluationDays}`,
      };
    }

    return this.finalizeExperiment(updated.id);
  }

  async finalizeExperiment(experimentId: string) {
    const experiment = await this.prisma.autoresearchExperiment.findUnique({
      where: { id: experimentId },
      include: { agent: true },
    });

    if (!experiment || experiment.status !== AutoresearchStatus.EVALUATING) {
      return { status: 'skipped', reason: 'Experiment not found or already finalized' };
    }

    const candidateSharpe = await this.computeSharpeSince(
      experiment.agentId,
      experiment.startedAt,
    );

    const improved = candidateSharpe > experiment.baselineSharpe;

    if (improved) {
      await this.prisma.autoresearchExperiment.update({
        where: { id: experiment.id },
        data: {
          status: AutoresearchStatus.KEPT,
          candidateSharpe,
          completedAt: new Date(),
        },
      });

      await this.scorecard.refreshAgentMetrics();

      await this.prisma.agent.update({
        where: { id: experiment.agentId },
        data: { rollingSharpe: candidateSharpe },
      });

      this.logger.log(
        `Autoresearch KEPT for ${experiment.agent.slug}: ${experiment.baselineSharpe.toFixed(3)} -> ${candidateSharpe.toFixed(3)}`,
      );

      return {
        status: 'kept',
        agent: experiment.agent.slug,
        baselineSharpe: experiment.baselineSharpe,
        candidateSharpe,
        experimentId: experiment.id,
      };
    }

    await this.revertExperiment(experiment, candidateSharpe);

    this.logger.log(
      `Autoresearch REVERTED for ${experiment.agent.slug}: ${experiment.baselineSharpe.toFixed(3)} -> ${candidateSharpe.toFixed(3)}`,
    );

    return {
      status: 'reverted',
      agent: experiment.agent.slug,
      baselineSharpe: experiment.baselineSharpe,
      candidateSharpe,
      experimentId: experiment.id,
    };
  }

  private async revertExperiment(
    experiment: {
      id: string;
      agentId: string;
      baselinePromptId: string;
      candidatePromptId: string;
      agent: { slug: string };
    },
    candidateSharpe: number,
  ) {
    await this.prisma.$transaction([
      this.prisma.agentPrompt.updateMany({
        where: { agentId: experiment.agentId, isActive: true },
        data: { isActive: false },
      }),
      this.prisma.agentPrompt.update({
        where: { id: experiment.baselinePromptId },
        data: { isActive: true },
      }),
      this.prisma.agentPrompt.update({
        where: { id: experiment.candidatePromptId },
        data: { isActive: false },
      }),
      this.prisma.autoresearchExperiment.update({
        where: { id: experiment.id },
        data: {
          status: AutoresearchStatus.REVERTED,
          candidateSharpe,
          completedAt: new Date(),
        },
      }),
    ]);
  }

  private async computeSharpeSince(agentId: string, since: Date): Promise<number> {
    const recs = await this.prisma.recommendation.findMany({
      where: {
        agentId,
        createdAt: { gte: since },
        scoredAt: { not: null },
        forwardReturn1d: { not: null },
      },
      orderBy: { createdAt: 'asc' },
    });

    const returns = recs.map((rec) => this.scorecard.weightedReturn(rec));

    return this.scorecard.calculateSharpe(returns);
  }

  async proposePromptTweak() {
    return this.startExperiment();
  }
}
