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

    if (agents.length < 4) {
      return agents;
    }

    const quartileSize = Math.max(1, Math.floor(agents.length / 4));
    const top = new Set(agents.slice(0, quartileSize).map((a) => a.id));
    const bottom = new Set(
      agents.slice(agents.length - quartileSize).map((a) => a.id),
    );

    const updates = [];

    for (const agent of agents) {
      let weight = agent.darwinWeight;
      if (top.has(agent.id)) {
        weight = Math.min(this.ceiling, weight * 1.05);
      } else if (bottom.has(agent.id)) {
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
