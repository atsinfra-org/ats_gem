import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { CrawlDispatcher } from './crawler/crawl-dispatcher.service';
import { DatabaseModule } from './database/database.module';
import { SeedService } from './database/seed.service';
import { LoggingModule } from './logging/logging.module';
import { OutboxModule } from './outbox/outbox.module';
import { QueuesModule } from './queues/queues.module';
import { RedisModule } from './redis/redis.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { BackfillService } from './tenders/backfill.service';
import { ProcuringEntitiesModule } from './tenders/entities/procuring-entities.module';

/** Composition root for one-shot operational commands (see main.cli.ts). */
@Module({
  imports: [
    AppConfigModule,
    LoggingModule,
    DatabaseModule,
    RedisModule,
    QueuesModule,
    OutboxModule,
    SchedulerModule.forRoot({ runLoop: false }),
    ProcuringEntitiesModule,
  ],
  providers: [CrawlDispatcher, SeedService, BackfillService],
})
export class CliModule {}
