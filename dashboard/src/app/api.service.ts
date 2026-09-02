import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import {
  Agent,
  AgentPromptResponse,
  AutoresearchExperiment,
  DailyRun,
  PaginatedResponse,
  PaperTrade,
  PipelineProgress,
  Portfolio,
  SystemStatus,
} from './models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  constructor(private readonly http: HttpClient) {}

  health() {
    return this.http.get<{ ok: boolean; service: string; port: number }>(
      '/api/health',
    );
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

  resetPortfolio() {
    return this.http.post<Portfolio & { message?: string }>(
      '/api/portfolio/reset',
      {},
    );
  }

  getRuns(limit = 5, cursor?: string | null) {
    let params = new HttpParams().set('limit', String(limit));
    if (cursor) params = params.set('cursor', cursor);
    return this.http.get<PaginatedResponse<DailyRun>>('/api/runs', { params });
  }

  getRun(id: string) {
    return this.http.get<DailyRun>(`/api/runs/${id}`);
  }

  getLatestRun() {
    return this.http.get<DailyRun | null>('/api/runs/latest');
  }

  getTrades(limit = 5, cursor?: string | null) {
    let params = new HttpParams().set('limit', String(limit));
    if (cursor) params = params.set('cursor', cursor);
    return this.http.get<PaginatedResponse<PaperTrade>>('/api/trades', {
      params,
    });
  }

  getPipelineProgress() {
    return this.http.get<PipelineProgress>('/api/pipeline/progress');
  }

  runPipeline(options: { autoresearch?: boolean; force?: boolean } = {}) {
    return this.http.post('/api/pipeline/run', options);
  }

  startAutoresearch() {
    return this.http.post('/api/autoresearch/start', {});
  }

  getExperiments(limit = 5, cursor?: string | null) {
    let params = new HttpParams().set('limit', String(limit));
    if (cursor) params = params.set('cursor', cursor);
    return this.http.get<PaginatedResponse<AutoresearchExperiment>>(
      '/api/autoresearch/experiments',
      { params },
    );
  }

  getPrompt(slug: string) {
    return this.http.get<AgentPromptResponse>(`/api/agents/${slug}/prompt`);
  }

  updatePrompt(slug: string, content: string, note?: string) {
    return this.http.put<AgentPromptResponse>(`/api/agents/${slug}/prompt`, {
      content,
      note,
    });
  }
}
