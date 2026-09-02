import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { AgentRunnerService } from './agent-runner.service';

@Module({
  imports: [LlmModule],
  providers: [AgentRunnerService],
  exports: [AgentRunnerService],
})
export class AgentsModule {}
