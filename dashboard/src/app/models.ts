export interface Agent {
  id: string;
  slug: string;
  name: string;
  layer: string;
  darwinWeight: number;
  rollingSharpe: number;
  hitRate?: number;
  scoredRecommendations?: number;
  prompts: Array<{ version: number; autoresearchNote: string | null; createdAt: string }>;
  scoreSnapshots: Array<{ sharpe: number; hitRate: number; snapshotDate: string }>;
}

export interface Portfolio {
  account: { cashBalance: number; startingCash: number };
  positions: Array<{
    ticker: string;
    shares: number;
    avgCost: number;
    currentPrice?: number;
    marketValue?: number;
    unrealizedPnl?: number;
    unrealizedPnlPct?: number;
  }>;
  recentTrades: Array<{
    id: string;
    ticker: string;
    action: string;
    shares: number;
    price: number;
    reason: string;
    createdAt: string;
  }>;
  totals: {
    cash: number;
    costBasis?: number;
    positionValue: number;
    equity: number;
    unrealizedPnl?: number;
  };
}

export interface SkippedAction {
  ticker: string;
  action: string;
  reason: string;
  requestedShares?: number;
}

export interface DailyRun {
  id: string;
  runDate: string;
  cycleNumber?: number;
  status: string;
  regime: string | null;
  summary: string | null;
  skippedActions?: SkippedAction[];
  recommendations?: Array<{
    ticker: string;
    direction: string;
    conviction: number;
    rationale: string;
    agent: { slug: string; name: string };
  }>;
  trades?: Array<{ ticker: string; action: string; shares: number; price: number; reason: string }>;
  _count?: { recommendations: number; trades: number };
}

export interface AgentPromptResponse {
  agent: { slug: string; name: string; layer: string };
  prompt: {
    id: string;
    version: number;
    content: string;
    autoresearchNote: string | null;
    updatedAt: string;
  };
}

export interface AutoresearchExperiment {
  id: string;
  agentId: string;
  status: 'EVALUATING' | 'KEPT' | 'REVERTED';
  baselineSharpe: number;
  candidateSharpe: number | null;
  evaluationDays: number;
  daysCompleted: number;
  changeSummary: string | null;
  startedAt: string;
  completedAt: string | null;
  agent?: { slug: string; name: string; rollingSharpe?: number };
}

export interface LlmProviderStatus {
  name: string;
  role: 'primary' | 'fallback';
  ready: boolean;
  model?: string;
  baseUrl?: string;
  note?: string;
}

export interface MarketStatus {
  source: 'mock' | 'finnhub';
  finnhubConfigured: boolean;
  finnhubError: string | null;
  usingLiveData: boolean;
  snapshotTtlMs?: number;
  mockTtlMs?: number;
  cacheTtlMs?: number;
  finnhubBackoffMs?: number;
}

export interface ApiHealth {
  ok: boolean;
  service: string;
  port: number;
}

export interface SystemStatus {
  api: ApiHealth;
  database: 'ok' | 'error';
  serverTime: string;
  marketDataSource: 'mock' | 'finnhub';
  market: MarketStatus;
  llmPrimary: string;
  llmFallbacks: string;
  llmProviders: LlmProviderStatus[];
  llmReady: boolean;
  autoresearchEvalDays: number;
  activeExperiment: AutoresearchExperiment | null;
}
