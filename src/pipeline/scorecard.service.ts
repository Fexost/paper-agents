import { Injectable } from '@nestjs/common';
import { Direction } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Daily move below this counts as "neutral" for macro NEUTRAL regime calls. */
const NEUTRAL_BAND = 0.004;

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

  regimeToDirection(regime: string): Direction {
    if (regime === 'RISK_ON') return Direction.LONG;
    if (regime === 'RISK_OFF') return Direction.SHORT;
    return Direction.NEUTRAL;
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
      const benchmarkTicker =
        rec.ticker === 'REGIME' ? 'SPY' : rec.ticker.toUpperCase();
      const current = prices[benchmarkTicker];
      if (!current || !rec.entryPrice) {
        continue;
      }

      const rawReturn = (current - rec.entryPrice) / rec.entryPrice;
      let weighted: number;
      let isHit: boolean;

      if (rec.direction === Direction.NEUTRAL) {
        isHit = Math.abs(rawReturn) <= NEUTRAL_BAND;
        weighted = isHit ? 0.002 : -Math.abs(rawReturn);
      } else if (rec.direction === Direction.SHORT) {
        weighted = -rawReturn;
        isHit = weighted > 0;
      } else {
        weighted = rawReturn;
        isHit = weighted > 0;
      }

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
        const raw = rec.forwardReturn1d ?? 0;
        if (rec.direction === Direction.NEUTRAL) {
          return (rec.isHit ? 0.002 : -Math.abs(raw)) * conviction;
        }
        const directionMultiplier = rec.direction === Direction.SHORT ? -1 : 1;
        return raw * conviction * directionMultiplier;
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

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      await this.prisma.scoreSnapshot.upsert({
        where: {
          agentId_snapshotDate: {
            agentId: agent.id,
            snapshotDate: today,
          },
        },
        update: { sharpe, hitRate },
        create: {
          agentId: agent.id,
          snapshotDate: today,
          sharpe,
          hitRate,
        },
      });
    }
  }
}
