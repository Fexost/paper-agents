import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-scroll-load-box',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="scroll-box" #scrollHost (scroll)="onScroll()">
      <ng-content></ng-content>
      <div class="sentinel" #sentinel></div>
      <p class="loading-more muted" *ngIf="loadingMore">Loading more…</p>
      <p class="end muted" *ngIf="!hasMore && !loadingMore">End of list</p>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .scroll-box {
        height: 220px;
        overflow-y: auto;
        overflow-x: hidden;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--panel-2);
      }

      .sentinel {
        height: 1px;
        width: 100%;
      }

      .loading-more,
      .end {
        text-align: center;
        font-size: 0.8rem;
        padding: 0.5rem;
        margin: 0;
      }

      :host ::ng-deep table {
        width: 100%;
      }

      :host ::ng-deep thead th {
        position: sticky;
        top: 0;
        background: var(--panel-2);
        z-index: 1;
        box-shadow: 0 1px 0 var(--border);
      }
    `,
  ],
})
export class ScrollLoadBoxComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() hasMore = false;
  @Input() loadingMore = false;
  @Output() loadMore = new EventEmitter<void>();

  @ViewChild('scrollHost') scrollHost?: ElementRef<HTMLElement>;
  @ViewChild('sentinel') sentinel?: ElementRef<HTMLElement>;

  private observer?: IntersectionObserver;
  private loadScheduled = false;

  ngAfterViewInit() {
    this.bindObserver();
    this.scheduleLoadCheck();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['hasMore'] || changes['loadingMore']) {
      this.scheduleLoadCheck();
    }
  }

  ngOnDestroy() {
    this.observer?.disconnect();
  }

  onScroll() {
    this.scheduleLoadCheck();
  }

  private bindObserver() {
    const root = this.scrollHost?.nativeElement;
    const sentinel = this.sentinel?.nativeElement;
    if (!root || !sentinel) return;

    this.observer?.disconnect();
    this.observer = new IntersectionObserver(
      () => this.scheduleLoadCheck(),
      { root, threshold: 0, rootMargin: '48px' },
    );
    this.observer.observe(sentinel);
  }

  private scheduleLoadCheck() {
    if (this.loadScheduled) return;
    this.loadScheduled = true;
    requestAnimationFrame(() => {
      this.loadScheduled = false;
      this.tryLoadMore();
    });
  }

  private tryLoadMore() {
    if (!this.hasMore || this.loadingMore) return;

    const root = this.scrollHost?.nativeElement;
    const sentinel = this.sentinel?.nativeElement;
    if (!root || !sentinel) return;

    const rootRect = root.getBoundingClientRect();
    const sentinelRect = sentinel.getBoundingClientRect();

    if (sentinelRect.top <= rootRect.bottom + 48) {
      this.loadMore.emit();
    }
  }
}
