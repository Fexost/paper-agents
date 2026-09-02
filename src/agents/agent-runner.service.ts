import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { AgentLayer, MarketRegime } from '../../generated/prisma/client';
import { LlmService } from '../llm/llm.service';
import { MarketSnapshot } from '../market/market-data.service';

export interface MacroOutput {
  regime: MarketRegime;
  conviction: number;
  themes: string[];
  sector_bias: string[];
  sector_avoid: string[];
  rationale: string;
}

export interface SectorPick {
  ticker: string;
  direction: 'LONG' | 'SHORT';
  conviction: number;
  thesis: string;
}

export interface SectorOutput {
  picks: SectorPick[];
  rationale: string;
}

export interface CioAction {
  ticker: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  shares: number;
  conviction: number;
  rationale: string;
}

export interface CioOutput {
  market_view: string;
  actions: CioAction[];
  risk_commentary: string;
}

@Injectable()
export class AgentRunnerService {
  constructor(private readonly llm: LlmService) {}

  async runMacro(
    snapshot: MarketSnapshot,
    prompt: string,
  ): Promise<MacroOutput> {
    const content = await this.llm.complete(
      [
        { role: 'system', content: prompt },
        {
          role: 'user',
          content: `Market snapshot:\n${JSON.stringify(snapshot, null, 2)}`,
        },
      ],
      { jsonMode: true },
    );

    return this.parseJson<MacroOutput>(content.content);
  }

  async runSector(
    snapshot: MarketSnapshot,
    macro: MacroOutput,
    prompt: string,
  ): Promise<SectorOutput> {
    const content = await this.llm.complete(
      [
        { role: 'system', content: prompt },
        {
          role: 'user',
          content: JSON.stringify({ snapshot, macro }, null, 2),
        },
      ],
      { jsonMode: true },
    );

    return this.parseJson<SectorOutput>(content.content);
  }

  async runCio(
    macro: MacroOutput,
    sector: SectorOutput,
    portfolio: unknown,
    agentWeights: Record<string, number>,
    prompt: string,
    maxPositionPct: number,
  ): Promise<CioOutput> {
    const content = await this.llm.complete(
      [
        { role: 'system', content: prompt },
        {
          role: 'user',
          content: JSON.stringify(
            {
              macro,
              sector,
              portfolio,
              agentWeights,
              maxPositionPct,
            },
            null,
            2,
          ),
        },
      ],
      { jsonMode: true },
    );

    return this.parseJson<CioOutput>(content.content);
  }

  async loadPromptFile(filename: string): Promise<string> {
    return readFile(join(process.cwd(), 'prompts', filename), 'utf8');
  }

  layerForSlug(slug: string): AgentLayer {
    if (slug === 'macro') return AgentLayer.MACRO;
    if (slug === 'sector') return AgentLayer.SECTOR;
    return AgentLayer.DECISION;
  }

  private parseJson<T>(raw: string): T {
    const cleaned = raw
      .replace(/^```json\s*/i, '')
      .replace(/```$/i, '')
      .trim();
    return JSON.parse(cleaned) as T;
  }
}
