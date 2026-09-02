import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import {
  LlmCompletionOptions,
  LlmCompletionResult,
  LlmMessage,
  LlmProviderName,
} from './llm.types';

interface ProviderConfig {
  name: LlmProviderName;
  client: OpenAI;
  model: string;
}

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly providers: ProviderConfig[] = [];
  private readonly providerOrder: LlmProviderName[] = [];

  constructor(private readonly config: ConfigService) {
    const built = this.buildProviders();
    this.providerOrder = built.order;
    this.providers = built.providers;
  }

  async complete(
    messages: LlmMessage[],
    options: LlmCompletionOptions = {},
  ): Promise<LlmCompletionResult> {
    if (this.providerOrder.length === 0) {
      throw new Error('No LLM providers configured.');
    }

    const errors: string[] = [];

    for (const name of this.providerOrder) {
      if (name === 'mock') {
        const content = this.mockCompletion(messages);
        this.logger.log('LLM response via mock (demo)');
        return { content, provider: 'mock', model: 'demo' };
      }

      const provider = this.providers.find((p) => p.name === name);
      if (!provider) continue;

      try {
        const response = await provider.client.chat.completions.create({
          model: provider.model,
          messages,
          temperature: options.temperature ?? 0.2,
          response_format: options.jsonMode ? { type: 'json_object' } : undefined,
        });

        const content = response.choices[0]?.message?.content?.trim();
        if (!content) throw new Error('Empty completion');

        this.logger.log(`LLM response via ${provider.name} (${provider.model})`);
        return { content, provider: provider.name, model: provider.model };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown LLM error';
        errors.push(`${provider.name}: ${message}`);
        this.logger.warn(`LLM provider ${provider.name} failed: ${message}`);
      }
    }

    throw new Error(`All LLM providers failed:\n${errors.join('\n')}`);
  }

  private mockCompletion(messages: LlmMessage[]): string {
    const system = messages.find((m) => m.role === 'system')?.content ?? '';
    if (system.includes('Macro Agent')) {
      return JSON.stringify({ regime: 'RISK_ON', conviction: 72, themes: ['AI capex'], sector_bias: ['Technology'], sector_avoid: ['Utilities'], rationale: 'Mock macro: risk-on.' });
    }
    if (system.includes('Sector Agent')) {
      return JSON.stringify({ picks: [{ ticker: 'NVDA', direction: 'LONG', conviction: 78, thesis: 'Mock NVDA long.' }, { ticker: 'MSFT', direction: 'LONG', conviction: 65, thesis: 'Mock MSFT long.' }], rationale: 'Mock sector picks.' });
    }
    if (system.includes('CIO')) {
      return JSON.stringify({ market_view: 'Mock CIO constructive.', actions: [{ ticker: 'NVDA', action: 'BUY', shares: 10, conviction: 75, rationale: 'Mock buy NVDA.' }], risk_commentary: 'Paper mock trade.' });
    }
    return JSON.stringify({ ok: true });
  }

  private buildProviders(): { order: LlmProviderName[]; providers: ProviderConfig[] } {
    const primary = this.config.get<string>('LLM_PRIMARY', 'mock');
    const fallbacks = this.config.get<string>('LLM_FALLBACKS', 'ollama,omniroute,openai').split(',').map((v) => v.trim()).filter(Boolean);
    const order = [...new Set([primary, ...fallbacks])] as LlmProviderName[];
    const providers: ProviderConfig[] = [];

    if (order.includes('mock')) return { order, providers };

    for (const name of order) {
      const built = this.buildProvider(name);
      if (built) providers.push(built);
    }
    return { order, providers };
  }

  private buildProvider(name: LlmProviderName): ProviderConfig | null {
    switch (name) {
      case 'ollama':
        return { name, model: this.config.get('OLLAMA_MODEL', 'llama3.2'), client: new OpenAI({ apiKey: 'ollama', baseURL: this.config.get('OLLAMA_BASE_URL', 'http://localhost:11434/v1') }) };
      case 'omniroute':
        return { name, model: this.config.get('OMNIROUTE_MODEL', 'gpt-4o-mini'), client: new OpenAI({ apiKey: this.config.get('OMNIROUTE_API_KEY', 'omniroute'), baseURL: this.config.get('OMNIROUTE_BASE_URL', 'http://localhost:20128/v1') }) };
      case 'openai': {
        const apiKey = this.config.get<string>('OPENAI_API_KEY');
        if (!apiKey) return null;
        return { name, model: this.config.get('OPENAI_MODEL', 'gpt-4o-mini'), client: new OpenAI({ apiKey, baseURL: this.config.get('OPENAI_BASE_URL', 'https://api.openai.com/v1') }) };
      }
      default:
        return null;
    }
  }
}
