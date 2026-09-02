import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DarwinService {
  private readonly floor = 0.3;
  private readonly ceiling = 2.5;

  constructor(private readonly prisma: PrismaService) {}

  async updateWeights() {
    const agents = await this.prisma.agent.findMany({
      orderBy: { rollingSharpe: 'desc' },
    });

    if (agents.length < 2) {
      return agents;
    }

    const top = new Set([agents[0].id]);
    const bottom = new Set([agents[agents.length - 1].id]);

    const updates = [];

    for (const agent of agents) {
      let weight = agent.darwinWeight;
      if (top.has(agent.id) && agents.length > 1) {
        weight = Math.min(this.ceiling, weight * 1.05);
      } else if (bottom.has(agent.id) && agents.length > 2) {
        weight = Math.max(this.floor, weight * 0.95);
      }

      if (weight !== agent.darwinWeight) {
        updates.push(
          this.prisma.agent.update({
            where: { id: agent.id },
            data: { darwinWeight: weight },
          }),
        );
      }
    }

    await Promise.all(updates);
    return this.prisma.agent.findMany({ orderBy: { darwinWeight: 'desc' } });
  }

  toWeightMap(
    agents: Array<{ slug: string; darwinWeight: number }>,
  ): Record<string, number> {
    return Object.fromEntries(
      agents.map((agent) => [agent.slug, agent.darwinWeight]),
    );
  }
}
