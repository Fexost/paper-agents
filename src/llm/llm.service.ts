import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import {
  LlmCompletionOptions,
  LlmCompletionResult,
  LlmMessage,
  LlmProviderName,
  LlmProviderStatus,
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

  constructor(private readonly config: ConfigService) {
    this.providers = this.buildProviders();
  }

  async complete(
    messages: LlmMessage[],
    options: LlmCompletionOptions = {},
  ): Promise<LlmCompletionResult> {
    if (this.providers.length === 0) {
      throw new Error(
        'No LLM providers configured. Set OLLAMA_BASE_URL, OMNIROUTE_BASE_URL, or OPENAI_API_KEY.',
      );
    }

    const errors: string[] = [];

    for (const provider of this.providers) {
      try {
        const response = await provider.client.chat.completions.create({
          model: provider.model,
          messages,
          temperature: options.temperature ?? 0.2,
          response_format: options.jsonMode ? { type: 'json_object' } : undefined,
        });

        const content = response.choices[0]?.message?.content?.trim();
        if (!content) {
          throw new Error('Empty completion');
        }

        this.logger.log(`LLM response via ${provider.name} (${provider.model})`);
        return {
          content,
          provider: provider.name,
          model: provider.model,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown LLM error';
        errors.push(`${provider.name}: ${message}`);
        this.logger.warn(`LLM provider ${provider.name} failed: ${message}`);
      }
    }

    throw new Error(`All LLM providers failed:\n${errors.join('\n')}`);
  }

  getProviderStatus(): LlmProviderStatus[] {
    const primary = this.config.get<string>('LLM_PRIMARY', 'mock');
    const fallbacks = this.config
      .get<string>('LLM_FALLBACKS', 'ollama,omniroute,openai')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    const order = [...new Set([primary, ...fallbacks])];

    return order.map((name) => {
      const role = name === primary ? 'primary' : 'fallback';

      if (name === 'mock') {
        return {
          name,
          role,
          ready: true,
          model: 'builtin',
          note: 'No real LLM — ensure a fallback provider is ready',
        };
      }

      const built = this.buildProvider(name as LlmProviderName);
      if (!built) {
        return {
          name,
          role,
          ready: false,
          note:
            name === 'openai'
              ? 'Set OPENAI_API_KEY in .env'
              : `Provider "${name}" is not configured`,
        };
      }

      return {
        name,
        role,
        ready: true,
        model: built.model,
        baseUrl: this.getProviderBaseUrl(name as LlmProviderName),
      };
    });
  }

  private getProviderBaseUrl(name: LlmProviderName): string | undefined {
    switch (name) {
      case 'ollama':
        return this.config.get<string>(
          'OLLAMA_BASE_URL',
          'http://localhost:11434/v1',
        );
      case 'omniroute':
        return this.config.get<string>(
          'OMNIROUTE_BASE_URL',
          'http://localhost:20128/v1',
        );
      case 'openai':
        return this.config.get<string>(
          'OPENAI_BASE_URL',
          'https://api.openai.com/v1',
        );
      default:
        return undefined;
    }
  }

  private buildProviders(): ProviderConfig[] {
    const primary = this.config.get<string>('LLM_PRIMARY', 'ollama');
    const fallbacks = this.config
      .get<string>('LLM_FALLBACKS', 'omniroute,openai')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    const order = [...new Set([primary, ...fallbacks])] as LlmProviderName[];
    const providers: ProviderConfig[] = [];

    for (const name of order) {
      const built = this.buildProvider(name);
      if (built) {
        providers.push(built);
      }
    }

    return providers;
  }

  private buildProvider(name: LlmProviderName): ProviderConfig | null {
    switch (name) {
      case 'ollama': {
        const baseURL = this.config.get<string>(
          'OLLAMA_BASE_URL',
          'http://localhost:11434/v1',
        );
        const model = this.config.get<string>('OLLAMA_MODEL', 'llama3.2');
        return {
          name,
          model,
          client: new OpenAI({ apiKey: 'ollama', baseURL }),
        };
      }
      case 'omniroute': {
        const baseURL = this.config.get<string>(
          'OMNIROUTE_BASE_URL',
          'http://localhost:20128/v1',
        );
        const apiKey = this.config.get<string>('OMNIROUTE_API_KEY', 'omniroute');
        const model = this.config.get<string>(
          'OMNIROUTE_MODEL',
          'gpt-4o-mini',
        );
        return {
          name,
          model,
          client: new OpenAI({ apiKey, baseURL }),
        };
      }
      case 'openai': {
        const apiKey = this.config.get<string>('OPENAI_API_KEY');
        if (!apiKey) {
          return null;
        }
        const baseURL = this.config.get<string>(
          'OPENAI_BASE_URL',
          'https://api.openai.com/v1',
        );
        const model = this.config.get<string>('OPENAI_MODEL', 'gpt-4o-mini');
        return {
          name,
          model,
          client: new OpenAI({ apiKey, baseURL }),
        };
      }
      default:
        return null;
    }
  }
}
