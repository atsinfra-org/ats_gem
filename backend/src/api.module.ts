import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { LoggingModule } from './logging/logging.module';
import { HealthModule } from './modules/health/health.module';
import { OutboxModule } from './outbox/outbox.module';
import { QueuesModule } from './queues/queues.module';
import { RedisModule } from './redis/redis.module';

/**
 * Composition root for the HTTP API process. The API produces jobs and outbox events but never
 * consumes queues — consumers live in the worker process. Feature modules are added phase by phase.
 */
@Module({
  imports: [AppConfigModule, LoggingModule, DatabaseModule, RedisModule, QueuesModule, OutboxModule, HealthModule],
})
export class ApiModule {}
