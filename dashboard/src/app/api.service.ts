import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import {
  Agent,
  AgentPromptResponse,
  AutoresearchExperiment,
  DailyRun,
  Portfolio,
  SystemStatus,
} from './models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  constructor(private readonly http: HttpClient) {}

  health() {
    return this.http.get<{ ok: boolean }>('/api/health');
  }

  getStatus() {
    return this.http.get<SystemStatus>('/api/status');
  }

  getAgents() {
    return this.http.get<Agent[]>('/api/agents');
  }

  getPortfolio() {
    return this.http.get<Portfolio>('/api/portfolio');
  }

  getRuns() {
    return this.http.get<DailyRun[]>('/api/runs');
  }

  getLatestRun() {
    return this.http.get<DailyRun | null>('/api/runs/latest');
  }

  runPipeline(options: { autoresearch?: boolean; force?: boolean } = {}) {
    return this.http.post('/api/pipeline/run', options);
  }

  startAutoresearch() {
    return this.http.post('/api/autoresearch/start', {});
  }

  getExperiments() {
    return this.http.get<AutoresearchExperiment[]>('/api/autoresearch/experiments');
  }

  getPrompt(slug: string) {
    return this.http.get<AgentPromptResponse>(`/api/agents/${slug}/prompt`);
  }

  updatePrompt(slug: string, content: string, note?: string) {
    return this.http.put<AgentPromptResponse>(`/api/agents/${slug}/prompt`, { content, note });
  }
}
