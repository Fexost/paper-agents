import { Module } from '@nestjs/common';
import { MarketModule } from '../market/market.module';
import { PaperTradingService } from './paper-trading.service';

@Module({
  imports: [MarketModule],
  providers: [PaperTradingService],
  exports: [PaperTradingService],
})
export class PaperModule {}
