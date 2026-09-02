import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { MarketDataService } from '../market/market-data.service';
import { TradeAction } from '../../generated/prisma/client';
import { CioAction } from '../agents/agent-runner.service';
import { PaginatedResult, paginate, parseLimit } from '../common/pagination.util';

export interface ExecutedPaperTrade {
  id: string;
  runId: string | null;
  ticker: string;
  action: TradeAction;
  shares: number;
  price: number;
  reason: string;
  costBasis?: number | null;
  realizedPnl?: number | null;
}

export interface SkippedPaperAction {
  ticker: string;
  action: string;
  reason: string;
  requestedShares?: number;
}

export interface PaperExecutionResult {
  executed: ExecutedPaperTrade[];
  skipped: SkippedPaperAction[];
}

export interface EnrichedTrade {
  id: string;
  runId: string | null;
  ticker: string;
  action: string;
  shares: number;
  price: number;
  reason: string;
  createdAt: Date;
  costBasis: number | null;
  realizedPnl: number | null;
  unrealizedPnl: number | null;
  pnlLabel: 'realized' | 'unrealized' | null;
}

@Injectable()
export class PaperTradingService {
  private readonly logger = new Logger(PaperTradingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly market: MarketDataService,
  ) {}

  async ensureAccount() {
    const startingCash = Number(
      this.config.get<string>('PAPER_STARTING_CASH', '100000'),
    );

    return this.prisma.paperAccount.upsert({
      where: { id: 'default' },
      update: {},
      create: {
        id: 'default',
        cashBalance: startingCash,
        startingCash,
      },
    });
  }

  private async resolvePrices(
    prices?: Record<string, number>,
  ): Promise<Record<string, number>> {
    if (prices) {
      return prices;
    }

    try {
      const snapshot = await this.market.getSnapshot();
      return Object.fromEntries(
        [
          ...snapshot.indices,
          ...snapshot.watchlist,
          ...(snapshot.vix ? [snapshot.vix] : []),
        ].map((quote) => [quote.ticker, quote.price]),
      );
    } catch {
      return {};
    }
  }

  async getPortfolio(prices?: Record<string, number>) {
    const [account, positions, priceMap] = await Promise.all([
      this.ensureAccount(),
      this.prisma.paperPosition.findMany({ orderBy: { ticker: 'asc' } }),
      this.resolvePrices(prices),
    ]);

    const enrichedPositions = positions.map((position) => {
      const currentPrice = priceMap[position.ticker] ?? position.avgCost;
      const marketValue = position.shares * currentPrice;
      const costBasis = position.shares * position.avgCost;
      return {
        ...position,
        currentPrice,
        marketValue,
        unrealizedPnl: marketValue - costBasis,
        unrealizedPnlPct:
          costBasis > 0 ? (marketValue - costBasis) / costBasis : 0,
      };
    });

    const costBasis = enrichedPositions.reduce(
      (sum, position) => sum + position.shares * position.avgCost,
      0,
    );
    const positionValue = enrichedPositions.reduce(
      (sum, position) => sum + position.marketValue,
      0,
    );

    return {
      account,
      positions: enrichedPositions,
      totals: {
        cash: account.cashBalance,
        costBasis,
        positionValue,
        equity: account.cashBalance + positionValue,
        unrealizedPnl: positionValue - costBasis,
      },
    };
  }

  async listTrades(
    limitRaw?: string,
    cursor?: string,
  ): Promise<PaginatedResult<EnrichedTrade>> {
    const limit = parseLimit(limitRaw, 5, 500);

    const rows = await this.prisma.paperTrade.findMany({
      take: limit + 1,
      ...(cursor
        ? { skip: 1, cursor: { id: cursor } }
        : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    const items = rows.map((trade) => ({
      ...trade,
      unrealizedPnl: null,
      pnlLabel:
        trade.action === TradeAction.SELL && trade.realizedPnl != null
          ? ('realized' as const)
          : null,
    }));

    return paginate(items, limit);
  }

  async executeActions(
    actions: CioAction[],
    prices: Record<string, number>,
    runId: string,
  ): Promise<PaperExecutionResult> {
    const account = await this.ensureAccount();
    const maxPositionPct = Number(
      this.config.get<string>('MAX_POSITION_PCT', '0.1'),
    );
    const portfolio = await this.getPortfolio(prices);
    const maxPositionValue = portfolio.totals.equity * maxPositionPct;
    const executed: ExecutedPaperTrade[] = [];
    const skipped: SkippedPaperAction[] = [];

    for (const action of actions) {
      if (action.action === 'HOLD' || action.shares <= 0) {
        continue;
      }

      const ticker = action.ticker.toUpperCase();
      const price = prices[ticker];
      if (!price) {
        const reason = `No market price for ${ticker}`;
        this.logger.warn(`Skipping ${action.action} ${ticker}: no price`);
        skipped.push({
          ticker,
          action: action.action,
          reason,
          requestedShares: action.shares,
        });
        continue;
      }

      let shares = action.shares;
      let costBasis: number | null = null;
      let realizedPnl: number | null = null;

      if (action.action === 'BUY') {
        const existing = await this.prisma.paperPosition.findUnique({
          where: { ticker },
        });
        const currentValue = existing ? existing.shares * price : 0;
        const room = maxPositionValue - currentValue;
        if (room <= 0) {
          const reason = `Position at max ${maxPositionPct * 100}% of equity`;
          this.logger.warn(`Skipping BUY ${ticker}: ${reason}`);
          skipped.push({
            ticker,
            action: 'BUY',
            reason,
            requestedShares: action.shares,
          });
          continue;
        }

        const maxAffordableShares = Math.floor(account.cashBalance / price);
        const maxRoomShares = Math.floor(room / price);
        shares = Math.min(shares, maxAffordableShares, maxRoomShares);

        if (shares <= 0) {
          skipped.push({
            ticker,
            action: 'BUY',
            reason: 'Insufficient cash or position room',
            requestedShares: action.shares,
          });
          continue;
        }

        costBasis = price;
        const notional = shares * price;

        if (existing) {
          const totalShares = existing.shares + shares;
          const avgCost =
            (existing.avgCost * existing.shares + price * shares) /
            totalShares;
          await this.prisma.paperPosition.update({
            where: { ticker },
            data: { shares: totalShares, avgCost },
          });
        } else {
          await this.prisma.paperPosition.create({
            data: { ticker, shares, avgCost: price },
          });
        }

        await this.prisma.paperAccount.update({
          where: { id: 'default' },
          data: { cashBalance: { decrement: notional } },
        });
        account.cashBalance -= notional;
      }

      if (action.action === 'SELL') {
        const existing = await this.prisma.paperPosition.findUnique({
          where: { ticker },
        });
        if (!existing || existing.shares <= 0) {
          const reason = 'No open position';
          this.logger.warn(`Skipping SELL ${ticker}: ${reason}`);
          skipped.push({
            ticker,
            action: 'SELL',
            reason,
            requestedShares: action.shares,
          });
          continue;
        }

        shares = Math.min(shares, existing.shares);
        if (shares <= 0) {
          skipped.push({
            ticker,
            action: 'SELL',
            reason: 'No shares available to sell',
            requestedShares: action.shares,
          });
          continue;
        }

        costBasis = existing.avgCost;
        realizedPnl = (price - existing.avgCost) * shares;
        const proceeds = shares * price;

        if (existing.shares === shares) {
          await this.prisma.paperPosition.delete({ where: { ticker } });
        } else {
          await this.prisma.paperPosition.update({
            where: { ticker },
            data: { shares: existing.shares - shares },
          });
        }

        await this.prisma.paperAccount.update({
          where: { id: 'default' },
          data: { cashBalance: { increment: proceeds } },
        });
        account.cashBalance += proceeds;
      }

      const trade = await this.prisma.paperTrade.create({
        data: {
          runId,
          ticker,
          action: action.action as TradeAction,
          shares,
          price,
          costBasis,
          realizedPnl,
          reason: action.rationale,
        },
      });
      executed.push(trade);
    }

    return { executed, skipped };
  }

  async resetPortfolio() {
    const startingCash = Number(
      this.config.get<string>('PAPER_STARTING_CASH', '100000'),
    );

    await this.prisma.$transaction([
      this.prisma.paperTrade.deleteMany(),
      this.prisma.paperPosition.deleteMany(),
      this.prisma.paperAccount.update({
        where: { id: 'default' },
        data: { cashBalance: startingCash, startingCash },
      }),
    ]);

    this.logger.log(`Paper portfolio reset to $${startingCash}`);
    return this.getPortfolio();
  }
}
