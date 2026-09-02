import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ScorecardService {
  constructor(private readonly prisma: PrismaService) {}

  calculateSharpe(returns: number[]): number {
    if (returns.length < 2) {
      return 0;
    }

    const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
    const variance =
      returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
      (returns.length - 1);
    const stdDev = Math.sqrt(variance);
    if (stdDev === 0) {
      return 0;
    }
    return mean / stdDev;
  }

  async scoreOpenRecommendations(prices: Record<string, number>) {
    const unscored = await this.prisma.recommendation.findMany({
      where: {
        scoredAt: null,
        entryPrice: { not: null },
      },
      take: 200,
    });

    for (const rec of unscored) {
      const current = prices[rec.ticker];
      if (!current || !rec.entryPrice) {
        continue;
      }

      const rawReturn = (current - rec.entryPrice) / rec.entryPrice;
      const weighted =
        rec.direction === 'SHORT' ? -rawReturn : rawReturn;
      const isHit = weighted > 0;

      await this.prisma.recommendation.update({
        where: { id: rec.id },
        data: {
          forwardReturn1d: rawReturn,
          isHit,
          scoredAt: new Date(),
        },
      });
    }
  }

  async refreshAgentMetrics() {
    const agents = await this.prisma.agent.findMany();

    for (const agent of agents) {
      const recs = await this.prisma.recommendation.findMany({
        where: {
          agentId: agent.id,
          scoredAt: { not: null },
          forwardReturn1d: { not: null },
        },
        orderBy: { createdAt: 'desc' },
        take: 60,
      });

      const returns = recs.map((rec) => {
        const conviction = rec.conviction / 100;
        const directionMultiplier = rec.direction === 'SHORT' ? -1 : 1;
        return (rec.forwardReturn1d ?? 0) * conviction * directionMultiplier;
      });

      const sharpe = this.calculateSharpe(returns);
      const hitRate =
        recs.length === 0
          ? 0
          : recs.filter((rec) => rec.isHit).length / recs.length;

      await this.prisma.agent.update({
        where: { id: agent.id },
        data: { rollingSharpe: sharpe },
      });

      await this.prisma.scoreSnapshot.upsert({
        where: {
          agentId_snapshotDate: {
            agentId: agent.id,
            snapshotDate: new Date(),
          },
        },
        update: { sharpe, hitRate },
        create: {
          agentId: agent.id,
          snapshotDate: new Date(),
          sharpe,
          hitRate,
        },
      });
    }
  }
}
