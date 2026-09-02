import { Module } from '@nestjs/common';
import { PaperTradingService } from './paper-trading.service';

@Module({
  providers: [PaperTradingService],
  exports: [PaperTradingService],
})
export class PaperModule {}
