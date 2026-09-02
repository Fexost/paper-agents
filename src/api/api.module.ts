import { Module } from '@nestjs/common';
import { ApiController } from './api.controller';
import { PipelineModule } from '../pipeline/pipeline.module';
import { PaperModule } from '../paper/paper.module';
import { MarketModule } from '../market/market.module';
import { LlmModule } from '../llm/llm.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PipelineModule, PaperModule, MarketModule, LlmModule, PrismaModule],
  controllers: [ApiController],
})
export class ApiModule {}
