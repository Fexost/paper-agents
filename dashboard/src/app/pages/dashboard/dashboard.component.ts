import { CurrencyPipe, DatePipe, DecimalPipe, PercentPipe, SlicePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  inject,
  OnDestroy,
  OnInit,
  ViewChild,
  ElementRef,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  Subject,
  Subscription,
  catchError,
  forkJoin,
  interval,
  of,
  switchMap,
  takeUntil,
  timer,
} from 'rxjs';
import { ApiService } from '../../api.service';
import { AgentPipelineStepperComponent } from '../../components/agent-pipeline-stepper/agent-pipeline-stepper.component';
import { ScrollLoadBoxComponent } from '../../components/scroll-load-box/scroll-load-box.component';
import {
  Agent,
  AutoresearchExperiment,
  DailyRun,
  HistoryPage,
  PaperTrade,
  PipelineProgress,
  Portfolio,
  SystemStatus,
} from '../../models';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    FormsModule,
    CurrencyPipe,
    DatePipe,
    DecimalPipe,
    PercentPipe,
    SlicePipe,
    ScrollLoadBoxComponent,
    AgentPipelineStepperComponent,
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent implements OnInit, OnDestroy {
  @ViewChild('runDetail') runDetailRef?: ElementRef<HTMLElement>;

  agents: Agent[] = [];
  portfolio: Portfolio | null = null;
  latestRun: DailyRun | null = null;
  selectedRun: DailyRun | null = null;
  status: SystemStatus | null = null;

  runsPage: HistoryPage<DailyRun> = this.emptyPage();
  tradesPage: HistoryPage<PaperTrade> = this.emptyPage();
  experimentsPage: HistoryPage<AutoresearchExperiment> = this.emptyPage();

  apiOnline = false;
  apiHealth: { ok: boolean; service: string; port: number } | null = null;
  statusError = '';
  loading = true;
  running = false;
  pipelineProgress: PipelineProgress | null = null;
  startingAutoresearch = false;
  savingPrompt = false;
  resettingPortfolio = false;
  runWithAutoresearch = false;
  forceRerun = false;
  systemDetailsOpen = false;
  expandedRuns = new Set<string>();
  expandedExperiments = new Set<string>();
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
  private progressSub?: Subscription;
  private successTimer?: ReturnType<typeof setTimeout>;
  private readonly pollOnlineMs = 15_000;
  private readonly pollOfflineMs = 30_000;
  private refreshInFlight = false;

  private readonly api = inject(ApiService);
  private readonly cdr = inject(ChangeDetectorRef);

  ngOnInit(): void {
    this.loadInitialData();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.pollSub?.unsubscribe();
    this.refreshSub?.unsubscribe();
    this.actionSub?.unsubscribe();
    this.progressSub?.unsubscribe();
    if (this.successTimer) clearTimeout(this.successTimer);
  }

  private loadInitialData(): void {
    this.refresh();
  }

  private markViewDirty(): void {
    this.cdr.markForCheck();
  }

  private emptyPage<T>(): HistoryPage<T> {
    return { items: [], cursor: null, hasMore: false, loadingMore: false };
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
          this.markViewDirty();
        },
        error: () => {
          this.setOffline();
          this.loading = false;
          this.markViewDirty();
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

  protected refresh(showLoading = true): void {
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
            trades: this.api.getTrades().pipe(catchError(() => of(null))),
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
            this.markViewDirty();
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
          if (!this.selectedRun) {
            this.selectedRun = this.latestRun;
          }

          if (data.experiments) {
            this.mergeHistoryPage(this.experimentsPage, data.experiments, showLoading);
          }
          if (data.runs) {
            this.mergeHistoryPage(this.runsPage, data.runs, showLoading);
          }
          if (data.trades) {
            this.mergeHistoryPage(this.tradesPage, data.trades, showLoading);
          }

          if (data.prompt) {
            this.promptContent = data.prompt.prompt.content;
            this.promptVersion = data.prompt.prompt.version;
          }

          this.loading = false;
          this.lastRefresh = new Date();
          this.schedulePoll();
          this.markViewDirty();
        },
        error: () => {
          this.refreshInFlight = false;
          this.setOffline();
          this.loading = false;
          this.schedulePoll();
          this.markViewDirty();
        },
      });
  }

  private mergeHistoryPage<T extends { id: string }>(
    page: HistoryPage<T>,
    response: { items: T[]; nextCursor: string | null; hasMore: boolean },
    reset: boolean,
  ) {
    if (reset || page.items.length === 0) {
      page.items = response.items;
      page.cursor = response.nextCursor;
      page.hasMore = response.hasMore;
      return;
    }

    const newestId = response.items[0]?.id;
    if (newestId && page.items[0]?.id !== newestId) {
      const existingIds = new Set(page.items.map((i) => i.id));
      const prepend = response.items.filter((i) => !existingIds.has(i.id));
      if (prepend.length) {
        page.items = [...prepend, ...page.items];
      }
    }
  }

  protected loadMoreRuns(): void {
    if (!this.runsPage.hasMore || this.runsPage.loadingMore) return;
    this.runsPage.loadingMore = true;
    this.api.getRuns(5, this.runsPage.cursor).subscribe({
      next: (res) => {
        this.runsPage.items = [...this.runsPage.items, ...res.items];
        this.runsPage.cursor = res.nextCursor;
        this.runsPage.hasMore = res.hasMore;
        this.runsPage.loadingMore = false;
        this.markViewDirty();
      },
      error: () => {
        this.runsPage.loadingMore = false;
        this.markViewDirty();
      },
    });
  }

  protected loadMoreTrades(): void {
    if (!this.tradesPage.hasMore || this.tradesPage.loadingMore) return;
    this.tradesPage.loadingMore = true;
    this.api.getTrades(5, this.tradesPage.cursor).subscribe({
      next: (res) => {
        this.tradesPage.items = [...this.tradesPage.items, ...res.items];
        this.tradesPage.cursor = res.nextCursor;
        this.tradesPage.hasMore = res.hasMore;
        this.tradesPage.loadingMore = false;
        this.markViewDirty();
      },
      error: () => {
        this.tradesPage.loadingMore = false;
        this.markViewDirty();
      },
    });
  }

  protected loadMoreExperiments(): void {
    if (!this.experimentsPage.hasMore || this.experimentsPage.loadingMore) return;
    this.experimentsPage.loadingMore = true;
    this.api.getExperiments(5, this.experimentsPage.cursor).subscribe({
      next: (res) => {
        this.experimentsPage.items = [
          ...this.experimentsPage.items,
          ...res.items,
        ];
        this.experimentsPage.cursor = res.nextCursor;
        this.experimentsPage.hasMore = res.hasMore;
        this.experimentsPage.loadingMore = false;
        this.markViewDirty();
      },
      error: () => {
        this.experimentsPage.loadingMore = false;
        this.markViewDirty();
      },
    });
  }

  protected confirmResetPortfolio(): void {
    const ok = confirm(
      'Reset paper portfolio to starting cash?\n\n' +
        'Clears: positions and trade history.\n' +
        'Keeps: prompts, Darwin weights, Sharpe, hit rate, run history, and autoresearch.',
    );
    if (!ok) return;
    this.resetPortfolio();
  }

  private resetPortfolio(): void {
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
          this.markViewDirty();
        },
        error: (e) => {
          this.resettingPortfolio = false;
          this.error =
            e.error?.message ?? e.message ?? 'Failed to reset portfolio';
          this.markViewDirty();
        },
      });
  }

  protected runCycle(): void {
    this.running = true;
    this.pipelineProgress = null;
    this.error = '';
    this.clearSuccess();
    this.actionSub?.unsubscribe();
    this.startProgressPolling();

    this.actionSub = this.api
      .runPipeline({
        autoresearch: this.runWithAutoresearch,
        force: this.forceRerun,
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: unknown) => {
          this.running = false;
          this.stopProgressPolling();
          const result = res as { status?: string };
          if (result.status === 'already_completed') {
            this.error = "Today's run already completed — enable Force re-run";
          } else {
            this.showSuccess('Paper cycle completed');
          }
          this.refresh(false);
          this.markViewDirty();
        },
        error: (e) => {
          this.running = false;
          this.stopProgressPolling();
          this.error = e.error?.message ?? e.message ?? 'Pipeline failed';
          this.markViewDirty();
        },
      });
  }

  private startProgressPolling() {
    this.progressSub?.unsubscribe();
    this.progressSub = interval(400)
      .pipe(
        switchMap(() =>
          this.api.getPipelineProgress().pipe(catchError(() => of(null))),
        ),
        takeUntil(this.destroy$),
      )
      .subscribe((progress) => {
        if (progress) {
          this.pipelineProgress = progress;
          this.markViewDirty();
        }
      });
  }

  private stopProgressPolling() {
    this.progressSub?.unsubscribe();
    this.progressSub = undefined;
    this.pipelineProgress = null;
  }

  protected startAutoresearch(): void {
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
          this.markViewDirty();
        },
        error: (e) => {
          this.startingAutoresearch = false;
          this.error = e.error?.message ?? e.message ?? 'Autoresearch failed';
          this.markViewDirty();
        },
      });
  }

  protected selectRun(run: DailyRun): void {
    this.api.getRun(run.id).subscribe({
      next: (detail) => {
        this.selectedRun = detail;
        this.markViewDirty();
        setTimeout(() => {
          this.runDetailRef?.nativeElement.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
          });
        }, 50);
      },
      error: () => {
        this.selectedRun = run;
        this.markViewDirty();
      },
    });
  }

  protected toggleRunSummary(runId: string, event: Event): void {
    event.stopPropagation();
    if (this.expandedRuns.has(runId)) {
      this.expandedRuns.delete(runId);
    } else {
      this.expandedRuns.add(runId);
    }
  }

  protected isRunExpanded(runId: string): boolean {
    return this.expandedRuns.has(runId);
  }

  protected toggleExperimentChange(experimentId: string, event: Event): void {
    event.stopPropagation();
    if (this.expandedExperiments.has(experimentId)) {
      this.expandedExperiments.delete(experimentId);
    } else {
      this.expandedExperiments.add(experimentId);
    }
  }

  protected isExperimentChangeExpanded(experimentId: string): boolean {
    return this.expandedExperiments.has(experimentId);
  }

  protected experimentProgress(exp: AutoresearchExperiment): number {
    if (!exp.evaluationDays) return 0;
    return Math.min(100, (exp.daysCompleted / exp.evaluationDays) * 100);
  }

  protected candidateSharpe(exp: AutoresearchExperiment): number | null {
    if (exp.status === 'EVALUATING' && exp.runningCandidateSharpe != null) {
      return exp.runningCandidateSharpe;
    }
    return exp.candidateSharpe;
  }

  protected sharpeDelta(exp: AutoresearchExperiment): number | null {
    if (exp.status === 'EVALUATING' && exp.runningDelta != null) {
      return exp.runningDelta;
    }
    if (exp.candidateSharpe == null) return null;
    return exp.candidateSharpe - exp.baselineSharpe;
  }

  protected tradePnl(trade: PaperTrade): number | null {
    if (trade.action !== 'SELL' || trade.realizedPnl == null) {
      return null;
    }
    return trade.realizedPnl;
  }

  protected badgeStatusClasses(status: string): Record<string, boolean> {
    return { [status.toLowerCase()]: true };
  }

  protected readyLlmCount(): number {
    return this.status?.llmProviders.filter((p) => p.ready && p.name !== 'mock').length ?? 0;
  }

  protected marketStatusLabel(): string {
    if (!this.status?.market) return 'unknown';
    if (this.status.market.usingLiveData) return 'live';
    if (this.status.market.finnhubConfigured) return 'mock';
    return 'mock';
  }

  protected latestSnapshot(agent: Agent) {
    return agent.scoreSnapshots[0] ?? null;
  }

  protected sharpeTrend(agent: Agent): string {
    const snaps = agent.scoreSnapshots;
    if (snaps.length < 2) return 'flat';
    return snaps[0].sharpe > snaps[1].sharpe ? 'up' : snaps[0].sharpe < snaps[1].sharpe ? 'down' : 'flat';
  }

  protected onAgentChange(): void {
    this.refresh(false);
  }

  protected savePrompt(): void {
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
          this.markViewDirty();
        },
        error: (e) => {
          this.savingPrompt = false;
          this.error = e.error?.message ?? e.message ?? 'Failed to save prompt';
          this.markViewDirty();
        },
      });
  }

  protected pnl(): number {
    if (!this.portfolio) return 0;
    return this.portfolio.totals.equity - this.portfolio.account.startingCash;
  }

  protected pnlPct(): number {
    if (!this.portfolio?.account.startingCash) return 0;
    return this.pnl() / this.portfolio.account.startingCash;
  }

  protected keptCount(): number {
    return this.experimentsPage.items.filter((e) => e.status === 'KEPT').length;
  }

  protected revertedCount(): number {
    return this.experimentsPage.items.filter((e) => e.status === 'REVERTED').length;
  }

  protected detailRun(): DailyRun | null {
    return this.selectedRun ?? this.latestRun;
  }

  private showSuccess(message: string): void {
    this.success = message;
    if (this.successTimer) clearTimeout(this.successTimer);
    this.successTimer = setTimeout(() => (this.success = ''), 5000);
  }

  private clearSuccess(): void {
    this.success = '';
    if (this.successTimer) clearTimeout(this.successTimer);
  }
}
