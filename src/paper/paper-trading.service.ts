import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { TradeAction } from '../../generated/prisma/client';
import { CioAction } from '../agents/agent-runner.service';

@Injectable()
export class PaperTradingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
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

  async getPortfolio() {
    const [account, positions, recentTrades] = await Promise.all([
      this.ensureAccount(),
      this.prisma.paperPosition.findMany({ orderBy: { ticker: 'asc' } }),
      this.prisma.paperTrade.findMany({
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    const positionValue = positions.reduce(
      (sum, position) => sum + position.shares * position.avgCost,
      0,
    );

    return {
      account,
      positions,
      recentTrades,
      totals: {
        cash: account.cashBalance,
        positionValue,
        equity: account.cashBalance + positionValue,
      },
    };
  }

  async executeActions(
    actions: CioAction[],
    prices: Record<string, number>,
    runId: string,
  ) {
    const account = await this.ensureAccount();
    const maxPositionPct = Number(
      this.config.get<string>('MAX_POSITION_PCT', '0.1'),
    );
    const portfolio = await this.getPortfolio();
    const maxPositionValue = portfolio.totals.equity * maxPositionPct;
    const trades = [];

    for (const action of actions) {
      if (action.action === 'HOLD' || action.shares <= 0) {
        continue;
      }

      const ticker = action.ticker.toUpperCase();
      const price = prices[ticker];
      if (!price) {
        continue;
      }

      if (action.action === 'BUY') {
        const notional = action.shares * price;
        if (notional > maxPositionValue) {
          continue;
        }
        if (notional > account.cashBalance) {
          continue;
        }

        const existing = await this.prisma.paperPosition.findUnique({
          where: { ticker },
        });

        if (existing) {
          const totalShares = existing.shares + action.shares;
          const avgCost =
            (existing.avgCost * existing.shares + price * action.shares) /
            totalShares;
          await this.prisma.paperPosition.update({
            where: { ticker },
            data: { shares: totalShares, avgCost },
          });
        } else {
          await this.prisma.paperPosition.create({
            data: {
              ticker,
              shares: action.shares,
              avgCost: price,
            },
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
          continue;
        }

        const sharesToSell = Math.min(action.shares, existing.shares);
        const proceeds = sharesToSell * price;

        if (existing.shares === sharesToSell) {
          await this.prisma.paperPosition.delete({ where: { ticker } });
        } else {
          await this.prisma.paperPosition.update({
            where: { ticker },
            data: { shares: existing.shares - sharesToSell },
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
          shares: action.shares,
          price,
          reason: action.rationale,
        },
      });
      trades.push(trade);
    }

    return trades;
  }
}
