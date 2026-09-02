import { CommonModule, CurrencyPipe, DatePipe, DecimalPipe, PercentPipe } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  Subject,
  Subscription,
  catchError,
  forkJoin,
  of,
  switchMap,
  takeUntil,
  timer,
} from 'rxjs';
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
  apiHealth: { ok: boolean; service: string; port: number } | null = null;
  statusError = '';
  loading = true;
  running = false;
  startingAutoresearch = false;
  savingPrompt = false;
  resettingPortfolio = false;
  runWithAutoresearch = false;
  forceRerun = false;
  error = '';
  success = '';
  lastRefresh = new Date();

  selectedAgent = 'macro';
  promptContent = '';
  promptVersion = 0;

  private readonly destroy$ = new Subject<void>();
  private pollSub?: Subscription;
  private refreshSub?: Subscription;
  private actionSub?: Subscription;
  private successTimer?: ReturnType<typeof setTimeout>;
  private readonly pollOnlineMs = 15_000;
  private readonly pollOfflineMs = 30_000;
  private refreshInFlight = false;

  constructor(private readonly api: ApiService) {}

  ngOnInit() {
    this.refresh();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    this.pollSub?.unsubscribe();
    this.refreshSub?.unsubscribe();
    this.actionSub?.unsubscribe();
    if (this.successTimer) clearTimeout(this.successTimer);
  }

  private schedulePoll() {
    this.pollSub?.unsubscribe();
    const delay = this.pollDelayMs();
    this.pollSub = timer(delay)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        if (this.refreshInFlight) {
          this.schedulePoll();
          return;
        }
        if (this.apiOnline) {
          this.refresh(false);
        } else {
          this.probeApi(false);
        }
        this.schedulePoll();
      });
  }

  private pollDelayMs(): number {
    if (!this.apiOnline) {
      return this.pollOfflineMs;
    }
    if (this.status?.market?.finnhubConfigured && !this.status.market.usingLiveData) {
      return this.status.market.mockTtlMs ?? 30_000;
    }
    return this.status?.market?.snapshotTtlMs ?? this.pollOnlineMs;
  }

  /** Single health request when API is known offline — avoids proxy spam. */
  private probeApi(showLoading = false) {
    this.refreshSub?.unsubscribe();
    if (showLoading) this.loading = true;

    this.refreshSub = this.api
      .health()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (health) => {
          if (health?.ok) {
            this.refresh(false);
            return;
          }
          this.setOffline();
          this.loading = false;
        },
        error: () => {
          this.setOffline();
          this.loading = false;
        },
      });
  }

  private setOffline() {
    this.apiOnline = false;
    this.apiHealth = null;
    this.status = null;
    this.statusError =
      'Could not reach API — run npm run start:dev on port 3001';
    this.error = '';
  }

  refresh(showLoading = true) {
    if (this.refreshInFlight) {
      return;
    }
    this.refreshInFlight = true;
    if (showLoading) this.loading = true;
    this.refreshSub?.unsubscribe();

    this.refreshSub = this.api
      .health()
      .pipe(
        catchError(() => of(null)),
        switchMap((health) => {
          if (!health?.ok) {
            return of({ offline: true as const });
          }
          return forkJoin({
            status: this.api.getStatus().pipe(catchError(() => of(null))),
            portfolio: this.api.getPortfolio().pipe(catchError(() => of(null))),
            agents: this.api.getAgents().pipe(catchError(() => of(null))),
            latestRun: this.api.getLatestRun().pipe(catchError(() => of(null))),
            experiments: this.api.getExperiments().pipe(catchError(() => of(null))),
            runs: this.api.getRuns().pipe(catchError(() => of(null))),
            prompt: this.api
              .getPrompt(this.selectedAgent)
              .pipe(catchError(() => of(null))),
          }).pipe(
            switchMap((data) => of({ offline: false as const, health, ...data })),
          );
        }),
        takeUntil(this.destroy$),
      )
      .subscribe({
        next: (data) => {
          this.refreshInFlight = false;
          if (data.offline) {
            this.setOffline();
            this.loading = false;
            this.lastRefresh = new Date();
            this.schedulePoll();
            return;
          }

          this.apiOnline = true;
          this.apiHealth = data.health;
          this.statusError = '';
          this.error = '';

          if (data.status) {
            this.status = data.status;
            this.apiHealth = data.status.api;
          }

          if (data.portfolio) this.portfolio = data.portfolio;
          if (data.agents) this.agents = data.agents;
          this.latestRun = data.latestRun ?? null;
          this.experiments = data.experiments ?? [];
          if (data.runs) this.runs = data.runs;

          if (data.prompt) {
            this.promptContent = data.prompt.prompt.content;
            this.promptVersion = data.prompt.prompt.version;
          }

          this.loading = false;
          this.lastRefresh = new Date();
          this.schedulePoll();
        },
        error: () => {
          this.refreshInFlight = false;
          this.setOffline();
          this.loading = false;
          this.schedulePoll();
        },
      });
  }

  confirmResetPortfolio() {
    const ok = confirm(
      'Reset paper portfolio to starting cash?\n\n' +
        'Clears: positions and trade history.\n' +
        'Keeps: prompts, Darwin weights, Sharpe, hit rate, run history, and autoresearch.',
    );
    if (!ok) return;
    this.resetPortfolio();
  }

  resetPortfolio() {
    this.resettingPortfolio = true;
    this.error = '';
    this.clearSuccess();
    this.actionSub?.unsubscribe();

    this.actionSub = this.api
      .resetPortfolio()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.resettingPortfolio = false;
          this.portfolio = res;
          this.apiOnline = true;
          this.showSuccess(
            res.message ?? 'Paper portfolio reset — learning data kept',
          );
          this.refresh(false);
        },
        error: (e) => {
          this.resettingPortfolio = false;
          this.error =
            e.error?.message ?? e.message ?? 'Failed to reset portfolio';
        },
      });
  }

  runCycle() {
    this.running = true;
    this.error = '';
    this.clearSuccess();
    this.actionSub?.unsubscribe();

    this.actionSub = this.api
      .runPipeline({
        autoresearch: this.runWithAutoresearch,
        force: this.forceRerun,
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: unknown) => {
          this.running = false;
          const result = res as { status?: string };
          if (result.status === 'already_completed') {
            this.error = "Today's run already completed — enable Force re-run";
          } else {
            this.showSuccess('Paper cycle completed');
          }
          this.refresh(false);
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
    this.actionSub?.unsubscribe();

    this.actionSub = this.api
      .startAutoresearch()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: unknown) => {
          this.startingAutoresearch = false;
          const result = res as { status?: string; message?: string; reason?: string };
          if (result.status === 'skipped') {
            this.error = result.reason ?? 'Autoresearch skipped';
          } else {
            this.showSuccess(result.message ?? 'Autoresearch experiment started');
          }
          this.refresh(false);
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

  readyLlmCount(): number {
    return this.status?.llmProviders.filter((p) => p.ready && p.name !== 'mock').length ?? 0;
  }

  marketStatusLabel(): string {
    if (!this.status?.market) return 'unknown';
    if (this.status.market.usingLiveData) return 'finnhub (live)';
    if (this.status.market.finnhubConfigured) return 'mock (finnhub failed)';
    return 'mock';
  }

  marketStatusClass(): string {
    if (!this.status?.market) return '';
    if (this.status.market.usingLiveData) return 'live';
    if (this.status.market.finnhubConfigured) return 'warn';
    return '';
  }

  latestSnapshot(agent: Agent) {
    return agent.scoreSnapshots[0] ?? null;
  }

  sharpeTrend(agent: Agent): string {
    const snaps = agent.scoreSnapshots;
    if (snaps.length < 2) return 'flat';
    return snaps[0].sharpe > snaps[1].sharpe ? 'up' : snaps[0].sharpe < snaps[1].sharpe ? 'down' : 'flat';
  }

  onAgentChange() {
    this.refresh(false);
  }

  savePrompt() {
    this.savingPrompt = true;
    this.actionSub?.unsubscribe();

    this.actionSub = this.api
      .updatePrompt(this.selectedAgent, this.promptContent, 'Dashboard edit')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
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
