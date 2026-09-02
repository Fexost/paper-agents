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

  constructor(private readonly config: ConfigService) {}

  getDataSource(): 'mock' | 'finnhub' {
    return this.lastSource;
  }

  async getSnapshot(): Promise<MarketSnapshot> {
    const apiKey = this.config.get<string>('FINNHUB_API_KEY');
    if (apiKey) {
      try {
        const snapshot = await this.fetchFromFinnhub(apiKey);
        this.lastSource = 'finnhub';
        return snapshot;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Finnhub fetch failed';
        this.logger.warn(`Falling back to mock market data: ${message}`);
      }
    }

    this.lastSource = 'mock';
    return this.mockSnapshot();
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
    const quotes = await Promise.all(
      tickers.map(async (ticker) => {
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
        return {
          ticker,
          price: data.c ?? 0,
          changePct: data.dp ?? 0,
          asOf: new Date().toISOString(),
        };
      }),
    );

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

    const toQuote = (ticker: string): Quote => ({
      ticker,
      price: base[ticker as keyof typeof base],
      changePct: Number((Math.random() * 2 - 1).toFixed(2)),
      asOf: now,
    });

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
