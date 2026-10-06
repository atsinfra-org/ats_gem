import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { CrawlerModule } from './crawler/crawler.module';
import { DatabaseModule } from './database/database.module';
import { EmailModule } from './email/email.module';
import { LoggingModule } from './logging/logging.module';
import { HealthChecksModule } from './modules/health/health-checks.module';
import { HealthService } from './modules/health/health.service';
import { OutboxModule, OutboxRelayModule } from './outbox/outbox.module';
import { OutboxRelay } from './outbox/outbox.relay';
import { QueuesModule } from './queues/queues.module';
import { RedisModule } from './redis/redis.module';
import { AnalyticsWorkerModule } from './analytics/analytics.module';
import { NotificationsWorkerModule } from './notifications/notifications.module';
import { SearchIndexingModule } from './search/search-indexing.module';
import { PROCESS_HEALTH, ProcessHealthServer, type ProcessHealthOptions } from './workers/process-health.server';
import { WorkerHost } from './workers/worker-host.service';
import { WorkerRuntimeModule } from './workers/worker-runtime.module';

export const WORKER_DEFAULT_HEALTH_PORT = 4001;

/**
 * Composition root for background worker processes: queue consumers (filtered by WORKER_QUEUES so
 * each deployment can run a subset) and the outbox relay. No HTTP API is served from here.
 */
@Module({
  imports: [
    AppConfigModule,
    LoggingModule,
    DatabaseModule,
    RedisModule,
    QueuesModule,
    OutboxModule,
    OutboxRelayModule,
    WorkerRuntimeModule,
    HealthChecksModule,
    CrawlerModule,
    SearchIndexingModule,
    EmailModule,
    NotificationsWorkerModule,
    AnalyticsWorkerModule,
  ],
  providers: [
    {
      provide: PROCESS_HEALTH,
      inject: [HealthService, WorkerHost, OutboxRelay],
      useFactory: (health: HealthService, workers: WorkerHost, relay: OutboxRelay): ProcessHealthOptions => ({
        defaultPort: WORKER_DEFAULT_HEALTH_PORT,
        readiness: async () => {
          const [database, redis] = await Promise.all([health.checkDatabase(), health.checkRedis()]);
          const checks = {
            database,
            redis,
            workers: { status: workers.isHealthy() ? 'up' : 'down', queues: workers.status() },
            outboxRelay: { status: relay.isHealthy() ? 'up' : 'down' },
          };
          return { ready: Object.values(checks).every((c) => c.status !== 'down'), checks };
        },
      }),
    },
    ProcessHealthServer,
  ],
})
export class WorkerModule {}
