import { CommonModule, CurrencyPipe, DatePipe, DecimalPipe, PercentPipe } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { interval, Subscription } from 'rxjs';
import { ApiService } from '../../api.service';
import {
  Agent,
  AutoresearchExperiment,
  DailyRun,
  Portfolio,
  SystemStatus,
} from '../../models';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, CurrencyPipe, DatePipe, DecimalPipe, PercentPipe],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
})
export class DashboardComponent implements OnInit, OnDestroy {
  agents: Agent[] = [];
  portfolio: Portfolio | null = null;
  latestRun: DailyRun | null = null;
  runs: DailyRun[] = [];
  experiments: AutoresearchExperiment[] = [];
  status: SystemStatus | null = null;

  apiOnline = false;
  loading = true;
  running = false;
  startingAutoresearch = false;
  savingPrompt = false;
  runWithAutoresearch = false;
  forceRerun = false;
  error = '';
  success = '';
  lastRefresh = new Date();

  selectedAgent = 'macro';
  promptContent = '';
  promptVersion = 0;

  private sub?: Subscription;
  private successTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly api: ApiService) {}

  ngOnInit() {
    this.refresh();
    this.sub = interval(15000).subscribe(() => this.refresh(false));
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
    if (this.successTimer) clearTimeout(this.successTimer);
  }

  refresh(showLoading = true) {
    if (showLoading) this.loading = true;
    this.error = '';

    this.api.health().subscribe({
      next: () => (this.apiOnline = true),
      error: () => (this.apiOnline = false),
    });

    this.api.getStatus().subscribe({
      next: (s) => (this.status = s),
      error: () => (this.status = null),
    });

    this.api.getPortfolio().subscribe({
      next: (p) => (this.portfolio = p),
      error: (e) => (this.error = e.message ?? 'Failed to load portfolio'),
    });

    this.api.getAgents().subscribe({
      next: (a) => (this.agents = a),
      error: (e) => (this.error = e.message ?? 'Failed to load agents'),
    });

    this.api.getLatestRun().subscribe({
      next: (r) => (this.latestRun = r),
      error: () => (this.latestRun = null),
    });

    this.api.getExperiments().subscribe({
      next: (e) => (this.experiments = e),
      error: () => (this.experiments = []),
    });

    this.api.getRuns().subscribe({
      next: (r) => {
        this.runs = r;
        this.loading = false;
        this.lastRefresh = new Date();
      },
      error: (e) => {
        this.error = e.message ?? 'Failed to load runs';
        this.loading = false;
      },
    });

    this.loadPrompt();
  }

  runCycle() {
    this.running = true;
    this.error = '';
    this.clearSuccess();
    this.api
      .runPipeline({
        autoresearch: this.runWithAutoresearch,
        force: this.forceRerun,
      })
      .subscribe({
        next: (res: unknown) => {
          this.running = false;
          const result = res as { status?: string };
          if (result.status === 'already_completed') {
            this.error = "Today's run already completed — enable Force re-run";
          } else {
            this.showSuccess('Paper cycle completed');
          }
          this.refresh();
        },
        error: (e) => {
          this.running = false;
          this.error = e.error?.message ?? e.message ?? 'Pipeline failed';
        },
      });
  }

  startAutoresearch() {
    this.startingAutoresearch = true;
    this.error = '';
    this.clearSuccess();
    this.api.startAutoresearch().subscribe({
      next: (res: unknown) => {
        this.startingAutoresearch = false;
        const result = res as { status?: string; message?: string; reason?: string };
        if (result.status === 'skipped') {
          this.error = result.reason ?? 'Autoresearch skipped';
        } else {
          this.showSuccess(result.message ?? 'Autoresearch experiment started');
        }
        this.refresh();
      },
      error: (e) => {
        this.startingAutoresearch = false;
        this.error = e.error?.message ?? e.message ?? 'Autoresearch failed';
      },
    });
  }

  experimentProgress(exp: AutoresearchExperiment): number {
    if (!exp.evaluationDays) return 0;
    return Math.min(100, (exp.daysCompleted / exp.evaluationDays) * 100);
  }

  sharpeDelta(exp: AutoresearchExperiment): number | null {
    if (exp.candidateSharpe == null) return null;
    return exp.candidateSharpe - exp.baselineSharpe;
  }

  statusClass(status: string): string {
    return status.toLowerCase();
  }

  latestSnapshot(agent: Agent) {
    return agent.scoreSnapshots[0] ?? null;
  }

  sharpeTrend(agent: Agent): string {
    const snaps = agent.scoreSnapshots;
    if (snaps.length < 2) return 'flat';
    return snaps[0].sharpe > snaps[1].sharpe ? 'up' : snaps[0].sharpe < snaps[1].sharpe ? 'down' : 'flat';
  }

  loadPrompt() {
    this.api.getPrompt(this.selectedAgent).subscribe({
      next: (res) => {
        this.promptContent = res.prompt.content;
        this.promptVersion = res.prompt.version;
      },
      error: () => {
        this.promptContent = '';
        this.promptVersion = 0;
      },
    });
  }

  onAgentChange() {
    this.loadPrompt();
  }

  savePrompt() {
    this.savingPrompt = true;
    this.api.updatePrompt(this.selectedAgent, this.promptContent, 'Dashboard edit').subscribe({
      next: (res) => {
        this.promptVersion = res.prompt.version;
        this.savingPrompt = false;
        this.showSuccess(`Prompt saved (v${res.prompt.version})`);
        this.refresh(false);
      },
      error: (e) => {
        this.savingPrompt = false;
        this.error = e.error?.message ?? e.message ?? 'Failed to save prompt';
      },
    });
  }

  pnl(): number {
    if (!this.portfolio) return 0;
    return this.portfolio.totals.equity - this.portfolio.account.startingCash;
  }

  pnlPct(): number {
    if (!this.portfolio?.account.startingCash) return 0;
    return this.pnl() / this.portfolio.account.startingCash;
  }

  keptCount(): number {
    return this.experiments.filter((e) => e.status === 'KEPT').length;
  }

  revertedCount(): number {
    return this.experiments.filter((e) => e.status === 'REVERTED').length;
  }

  private showSuccess(message: string) {
    this.success = message;
    if (this.successTimer) clearTimeout(this.successTimer);
    this.successTimer = setTimeout(() => (this.success = ''), 5000);
  }

  private clearSuccess() {
    this.success = '';
    if (this.successTimer) clearTimeout(this.successTimer);
  }
}
