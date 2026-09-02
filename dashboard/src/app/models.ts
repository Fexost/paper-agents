export interface Agent {
  id: string;
  slug: string;
  name: string;
  layer: string;
  darwinWeight: number;
  rollingSharpe: number;
  prompts: Array<{ version: number; autoresearchNote: string | null; createdAt: string }>;
  scoreSnapshots: Array<{ sharpe: number; hitRate: number; snapshotDate: string }>;
}

export interface Portfolio {
  account: { cashBalance: number; startingCash: number };
  positions: Array<{ ticker: string; shares: number; avgCost: number }>;
  recentTrades: Array<{ id: string; ticker: string; action: string; shares: number; price: number; reason: string; createdAt: string }>;
  totals: { cash: number; positionValue: number; equity: number };
}

export interface DailyRun {
  id: string;
  runDate: string;
  status: string;
  regime: string | null;
  summary: string | null;
  recommendations?: Array<{ ticker: string; direction: string; conviction: number; rationale: string; agent: { slug: string; name: string } }>;
  trades?: Array<{ ticker: string; action: string; shares: number; price: number; reason: string }>;
  _count?: { recommendations: number; trades: number };
}

export interface AgentPromptResponse {
  agent: { slug: string; name: string; layer: string };
  prompt: { id: string; version: number; content: string; autoresearchNote: string | null; updatedAt: string };
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

export interface SystemStatus {
  marketDataSource: 'mock' | 'finnhub';
  llmPrimary: string;
  llmFallbacks: string;
  autoresearchEvalDays: number;
  activeExperiment: AutoresearchExperiment | null;
}
