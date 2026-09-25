import { Controller, Get, HttpCode } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { AppError } from '../../common/errors/app-error';
import { AppConfig } from '../../config/app-config.service';
import { QueueHealthService, type QueueSnapshot } from '../../queues/queue-health.service';
import { HealthService, type ReadinessReport } from './health.service';

const QUEUE_SNAPSHOT_TIMEOUT_MS = 3_000;

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthService,
    private readonly queueHealth: QueueHealthService,
    private readonly config: AppConfig,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Service summary' })
  @ApiOkResponse({ description: 'Service is running' })
  summary() {
    return {
      status: 'ok',
      service: this.config.get('APP_NAME'),
      version: process.env.npm_package_version ?? '0.1.0',
      environment: this.config.get('NODE_ENV'),
      uptimeSeconds: this.health.uptimeSeconds(),
    };
  }

  @Get('live')
  @HttpCode(200)
  @ApiOperation({ summary: 'Liveness probe — the process is up (no dependency checks)' })
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe — PostgreSQL, Redis, search and storage are reachable' })
  @ApiOkResponse({ description: 'All dependencies reachable' })
  @ApiServiceUnavailableResponse({ description: 'At least one dependency is down' })
  async ready(): Promise<ReadinessReport> {
    const report = await this.health.readiness();
    if (!report.ready) {
      throw new AppError(
        'DEPENDENCY_UNAVAILABLE',
        'One or more dependencies are unavailable.',
        Object.entries(report.checks)
          .filter(([, check]) => check.status === 'down')
          .map(([name, check]) => ({ field: name, code: 'DEPENDENCY_DOWN', message: check.message ?? 'down', ...check })),
      );
    }
    return report;
  }

  /**
   * Queue depth, failures, consumers and latency per queue. Counts only — no job data. Intended for
   * internal monitoring; it moves behind staff authentication with the admin module in Phase 5.
   */
  @Get('queues')
  @ApiOperation({ summary: 'Queue health — depth, failures, consumers and oldest waiting job per queue' })
  @ApiOkResponse({ description: 'Queue snapshot' })
  @ApiServiceUnavailableResponse({ description: 'Redis (queue backend) is unavailable' })
  async queues(): Promise<{ queues: QueueSnapshot[] }> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const queues = await Promise.race([
        this.queueHealth.snapshot(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`timed out after ${QUEUE_SNAPSHOT_TIMEOUT_MS} ms`)), QUEUE_SNAPSHOT_TIMEOUT_MS);
        }),
      ]);
      return { queues };
    } catch (err) {
      const message = err instanceof Error ? err.message.split('\n')[0].slice(0, 200) : 'unavailable';
      throw new AppError('DEPENDENCY_UNAVAILABLE', 'Queue backend is unavailable.', [
        { field: 'redis', code: 'DEPENDENCY_DOWN', message },
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
