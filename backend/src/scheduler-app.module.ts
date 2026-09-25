import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { LoggingModule } from './logging/logging.module';
import { HealthChecksModule } from './modules/health/health-checks.module';
import { HealthService } from './modules/health/health.service';
import { QueuesModule } from './queues/queues.module';
import { RedisModule } from './redis/redis.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { SchedulerService } from './scheduler/scheduler.service';
import { PROCESS_HEALTH, ProcessHealthServer, type ProcessHealthOptions } from './workers/process-health.server';

export const SCHEDULER_DEFAULT_HEALTH_PORT = 4002;

/**
 * Composition root for the scheduler process. It only registers job schedulers in BullMQ; it
 * never runs jobs. Several replicas may run — a Redis leader lock lets one of them reconcile.
 */
@Module({
  imports: [
    AppConfigModule,
    LoggingModule,
    DatabaseModule,
    RedisModule,
    QueuesModule,
    HealthChecksModule,
    SchedulerModule.forRoot({ runLoop: true }),
  ],
  providers: [
    {
      provide: PROCESS_HEALTH,
      inject: [HealthService, SchedulerService],
      useFactory: (health: HealthService, scheduler: SchedulerService): ProcessHealthOptions => ({
        defaultPort: SCHEDULER_DEFAULT_HEALTH_PORT,
        readiness: async () => {
          const [database, redis] = await Promise.all([health.checkDatabase(), health.checkRedis()]);
          const checks = {
            database,
            redis,
            scheduler: { status: scheduler.isHealthy() ? 'up' : 'down', leader: scheduler.isLeader() },
          };
          return { ready: Object.values(checks).every((c) => c.status !== 'down'), checks };
        },
      }),
    },
    ProcessHealthServer,
  ],
})
export class SchedulerAppModule {}
