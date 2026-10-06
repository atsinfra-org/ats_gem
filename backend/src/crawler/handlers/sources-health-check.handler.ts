import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../database/prisma.service';
import { JobProcessor, type JobHandler, type JobResult } from '../../workers/job-handler';
import { AdapterRegistry } from '../adapters/adapter.registry';
import { CrawlRunsService } from '../crawl-runs.service';
import { crawlContext } from './discover-source.handler';

/**
 * Periodic adapter health probe for active sources. Only moves sources between UNKNOWN, HEALTHY
 * and DEGRADED; states that need a human (AUTH_REQUIRED, NEEDS_MANUAL_ACTION, DISABLED) are left alone.
 */
@Injectable()
@JobProcessor('maintenance.sources-health-check')
export class SourcesHealthCheckHandler implements JobHandler<'maintenance.sources-health-check'> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runs: CrawlRunsService,
    private readonly adapters: AdapterRegistry,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SourcesHealthCheckHandler.name);
  }

  async handle(): Promise<JobResult> {
    const sources = await this.prisma.tenderSource.findMany({
      where: { deletedAt: null, isActive: true, healthStatus: { in: ['UNKNOWN', 'HEALTHY', 'DEGRADED'] } },
      select: { id: true },
    });
    let healthy = 0;
    let degraded = 0;
    for (const { id } of sources) {
      const source = await this.runs.loadSource(id);
      if (!source) continue;
      let ok = false;
      try {
        const result = await this.adapters.get(source.adapterKey).healthCheck(crawlContext(source, 1));
        ok = result.healthy;
        if (!ok) this.logger.warn({ sourceId: id, detail: result.detail }, 'source health check failed');
      } catch (err) {
        this.logger.warn({ sourceId: id, err: { message: err instanceof Error ? err.message : String(err) } }, 'source health check errored');
      }
      await this.prisma.tenderSource.updateMany({
        where: { id, healthStatus: { in: ['UNKNOWN', 'HEALTHY', 'DEGRADED'] } },
        data: { healthStatus: ok ? 'HEALTHY' : 'DEGRADED', healthCheckedAt: new Date() },
      });
      if (ok) healthy += 1;
      else degraded += 1;
    }
    return { checked: sources.length, healthy, degraded };
  }
}
