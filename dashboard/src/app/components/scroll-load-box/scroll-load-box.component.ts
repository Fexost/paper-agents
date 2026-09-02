import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  OnChanges,
  OnDestroy,
  output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';

@Component({
  selector: 'app-scroll-load-box',
  standalone: true,
  templateUrl: './scroll-load-box.component.html',
  styleUrl: './scroll-load-box.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScrollLoadBoxComponent implements AfterViewInit, OnChanges, OnDestroy {
  readonly hasMore = input(false);
  readonly loadingMore = input(false);
  readonly loadMore = output<void>();

  @ViewChild('scrollHost') private scrollHost?: ElementRef<HTMLElement>;
  @ViewChild('sentinel') private sentinel?: ElementRef<HTMLElement>;

  private observer?: IntersectionObserver;
  private loadScheduled = false;

  ngAfterViewInit(): void {
    this.bindObserver();
    this.scheduleLoadCheck();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['hasMore'] || changes['loadingMore']) {
      this.scheduleLoadCheck();
    }
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  protected onScroll(): void {
    this.scheduleLoadCheck();
  }

  private bindObserver(): void {
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

  private scheduleLoadCheck(): void {
    if (this.loadScheduled) return;
    this.loadScheduled = true;
    requestAnimationFrame(() => {
      this.loadScheduled = false;
      this.tryLoadMore();
    });
  }

  private tryLoadMore(): void {
    if (!this.hasMore() || this.loadingMore()) return;

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
