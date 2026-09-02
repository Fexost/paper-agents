import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { MarketModule } from '../market/market.module';
import { PaperModule } from '../paper/paper.module';
import { LlmModule } from '../llm/llm.module';
import { AutoresearchService } from './autoresearch.service';
import { DailyCycleJob } from './daily-cycle.job';
import { DarwinService } from './darwin.service';
import { EodCycleService } from './eod-cycle.service';
import { ScorecardService } from './scorecard.service';
import { PipelineProgressService } from './pipeline-progress.service';

@Module({
  imports: [AgentsModule, MarketModule, PaperModule, LlmModule],
  providers: [
    EodCycleService,
    ScorecardService,
    DarwinService,
    AutoresearchService,
    DailyCycleJob,
    PipelineProgressService,
  ],
  exports: [
    EodCycleService,
    AutoresearchService,
    ScorecardService,
    PipelineProgressService,
  ],
})
export class PipelineModule {}
