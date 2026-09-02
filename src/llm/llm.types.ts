export type LlmProviderName = 'openai' | 'omniroute' | 'ollama' | 'mock';

export interface LlmProviderStatus {
  name: LlmProviderName | string;
  role: 'primary' | 'fallback';
  ready: boolean;
  model?: string;
  baseUrl?: string;
  note?: string;
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmCompletionOptions {
  temperature?: number;
  jsonMode?: boolean;
}

export interface LlmCompletionResult {
  content: string;
  provider: LlmProviderName;
  model: string;
}
