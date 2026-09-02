import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface Quote {
  ticker: string;
  price: number;
  changePct: number;
  asOf: string;
}

export interface MarketSnapshot {
  asOf: string;
  watchlist: Quote[];
  indices: Quote[];
  vix?: Quote;
  notes: string[];
}

@Injectable()
export class MarketDataService {
  private readonly logger = new Logger(MarketDataService.name);
  private readonly watchlist = ['AAPL', 'MSFT', 'NVDA', 'SPY', 'QQQ', 'XLE', 'XLF'];
  private lastSource: 'mock' | 'finnhub' = 'mock';
  private lastFinnhubError: string | null = null;

  private snapshotCache: MarketSnapshot | null = null;
  private cacheExpiresAt = 0;
  private inflightSnapshot: Promise<MarketSnapshot> | null = null;
  private finnhubBlockedUntil = 0;
  private lastWarnAt = 0;

  constructor(private readonly config: ConfigService) {}

  private get liveTtlMs(): number {
    return Number(this.config.get<string>('MARKET_SNAPSHOT_TTL_MS', '15000'));
  }

  private get mockTtlMs(): number {
    return Number(this.config.get<string>('MARKET_MOCK_TTL_MS', '30000'));
  }

  private get finnhubBackoffMs(): number {
    return Number(this.config.get<string>('MARKET_FINNHUB_BACKOFF_MS', '60000'));
  }

  getMarketStatus() {
    const finnhubConfigured = Boolean(this.config.get<string>('FINNHUB_API_KEY'));
    const cacheAgeMs =
      this.snapshotCache && this.cacheExpiresAt > Date.now()
        ? this.cacheExpiresAt - Date.now()
        : 0;

    return {
      source: this.lastSource,
      finnhubConfigured,
      finnhubError: this.lastFinnhubError,
      usingLiveData: this.lastSource === 'finnhub',
      snapshotTtlMs: this.liveTtlMs,
      mockTtlMs: this.mockTtlMs,
      cacheTtlMs: cacheAgeMs,
      finnhubBackoffMs:
        finnhubConfigured && Date.now() < this.finnhubBlockedUntil
          ? this.finnhubBlockedUntil - Date.now()
          : 0,
    };
  }

  async getSnapshot(options: { force?: boolean } = {}): Promise<MarketSnapshot> {
    const now = Date.now();
    if (
      !options.force &&
      this.snapshotCache &&
      now < this.cacheExpiresAt
    ) {
      return this.snapshotCache;
    }

    if (this.inflightSnapshot) {
      return this.inflightSnapshot;
    }

    this.inflightSnapshot = this.resolveSnapshot(now, options.force ?? false)
      .finally(() => {
        this.inflightSnapshot = null;
      });

    return this.inflightSnapshot;
  }

  private cacheSnapshot(snapshot: MarketSnapshot, ttlMs: number) {
    this.snapshotCache = snapshot;
    this.cacheExpiresAt = Date.now() + ttlMs;
  }

  private warnThrottled(message: string) {
    const now = Date.now();
    if (now - this.lastWarnAt < this.finnhubBackoffMs) {
      return;
    }
    this.lastWarnAt = now;
    this.logger.warn(message);
  }

  private async resolveSnapshot(
    now: number,
    force: boolean,
  ): Promise<MarketSnapshot> {
    const apiKey = this.config.get<string>('FINNHUB_API_KEY');
    const finnhubInBackoff = Boolean(apiKey) && now < this.finnhubBlockedUntil;

    if (apiKey && !finnhubInBackoff) {
      try {
        const snapshot = await this.fetchFromFinnhub(apiKey);
        this.lastSource = 'finnhub';
        this.lastFinnhubError = null;
        this.cacheSnapshot(snapshot, this.liveTtlMs);
        return snapshot;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Finnhub fetch failed';
        this.lastFinnhubError = message;
        this.finnhubBlockedUntil = now + this.finnhubBackoffMs;
        this.warnThrottled(
          `Falling back to mock market data: ${message} (retrying Finnhub in ${this.finnhubBackoffMs / 1000}s)`,
        );
      }
    }

    this.lastSource = 'mock';
    const snapshot = this.mockSnapshot();
    const ttl =
      apiKey && (finnhubInBackoff || this.lastFinnhubError)
        ? this.mockTtlMs
        : apiKey
          ? this.liveTtlMs
          : this.mockTtlMs;
    this.cacheSnapshot(snapshot, force ? Math.min(ttl, this.liveTtlMs) : ttl);
    return snapshot;
  }

  async getPrice(ticker: string): Promise<number> {
    const snapshot = await this.getSnapshot();
    const quote = snapshot.watchlist
      .concat(snapshot.indices)
      .find((item) => item.ticker === ticker.toUpperCase());
    if (!quote) {
      throw new Error(`No quote available for ${ticker}`);
    }
    return quote.price;
  }

  private async fetchFromFinnhub(apiKey: string): Promise<MarketSnapshot> {
    const tickers = [...new Set([...this.watchlist, 'VIX'])];
    const quotes: Quote[] = [];

    for (const ticker of tickers) {
      const symbol = ticker === 'VIX' ? '^VIX' : ticker;
      const url = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${apiKey}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Finnhub error for ${ticker}`);
      }
      const data = (await response.json()) as {
        c?: number;
        dp?: number;
      };
      quotes.push({
        ticker,
        price: data.c ?? 0,
        changePct: data.dp ?? 0,
        asOf: new Date().toISOString(),
      });
      // Free tier ~60 calls/min — pace bursts when force re-running cycles.
      await new Promise((resolve) => setTimeout(resolve, 1100));
    }

    const indices = quotes.filter((q) => ['SPY', 'QQQ'].includes(q.ticker));
    const watchlist = quotes.filter((q) => !['SPY', 'QQQ', 'VIX'].includes(q.ticker));
    const vix = quotes.find((q) => q.ticker === 'VIX');

    return {
      asOf: new Date().toISOString(),
      indices,
      watchlist,
      vix,
      notes: ['Live quotes from Finnhub'],
    };
  }

  private mockSnapshot(): MarketSnapshot {
    const now = new Date().toISOString();
    const base = {
      AAPL: 190,
      MSFT: 420,
      NVDA: 880,
      SPY: 520,
      QQQ: 450,
      XLE: 90,
      XLF: 42,
      VIX: 16,
    };

    const toQuote = (ticker: string): Quote => {
      const jitter = 1 + (Math.random() * 0.06 - 0.03);
      return {
        ticker,
        price: Number((base[ticker as keyof typeof base] * jitter).toFixed(2)),
        changePct: Number((Math.random() * 2 - 1).toFixed(2)),
        asOf: now,
      };
    };

    return {
      asOf: now,
      indices: ['SPY', 'QQQ'].map(toQuote),
      watchlist: ['AAPL', 'MSFT', 'NVDA', 'XLE', 'XLF'].map(toQuote),
      vix: toQuote('VIX'),
      notes: [
        'Mock market data — set FINNHUB_API_KEY for live quotes',
        'Suitable for local learning and pipeline testing',
      ],
    };
  }
}
