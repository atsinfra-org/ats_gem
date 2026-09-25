import { Module } from '@nestjs/common';
import { HealthChecksModule } from './health-checks.module';
import { HealthController } from './health.controller';

@Module({
  imports: [HealthChecksModule],
  controllers: [HealthController],
})
export class HealthModule {}
