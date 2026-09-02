import { Module } from '@nestjs/common';
import { ApiController } from './api.controller';
import { PipelineModule } from '../pipeline/pipeline.module';
import { PaperModule } from '../paper/paper.module';
import { MarketModule } from '../market/market.module';

@Module({
  imports: [PipelineModule, PaperModule, MarketModule],
  controllers: [ApiController],
})
export class ApiModule {}
