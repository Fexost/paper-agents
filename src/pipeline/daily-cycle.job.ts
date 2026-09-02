import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { EodCycleService } from './eod-cycle.service';

@Injectable()
export class DailyCycleJob {
  private readonly logger = new Logger(DailyCycleJob.name);

  constructor(
    private readonly eod: EodCycleService,
    private readonly config: ConfigService,
  ) {}

  @Cron(process.env.DAILY_CYCLE_CRON ?? '0 7 * * 1-5')
  async handleCron() {
    const enabled =
      this.config.get<string>('AUTO_RUN_DAILY_CYCLE', 'false') === 'true';
    if (!enabled) {
      return;
    }

    this.logger.log('Running scheduled daily cycle');
    await this.eod.runDailyCycle();
  }
}
