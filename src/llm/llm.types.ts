export type LlmProviderName = 'openai' | 'omniroute' | 'ollama' | 'mock';

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
