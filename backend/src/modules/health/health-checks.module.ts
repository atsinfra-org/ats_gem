import { Module } from '@nestjs/common';
import { HealthService } from './health.service';

/** Dependency checks shared by the API health endpoints and the worker/scheduler health servers. */
@Module({
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthChecksModule {}
