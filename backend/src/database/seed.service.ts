import { Injectable } from '@nestjs/common';
import { AppConfig } from '../config/app-config.service';
import type { Prisma } from '../generated/prisma/client';
import { QueueName } from '../queues/queue.constants';
import { PrismaService } from './prisma.service';

export interface SeedResult {
  schedulesCreated: string[];
  sourcesCreated: string[];
}

/** Platform schedules every environment needs. Admins may edit or disable them afterwards. */
const DEFAULT_SCHEDULES: Prisma.JobScheduleCreateInput[] = [
  {
    key: 'outbox-cleanup',
    queue: QueueName.MAINTENANCE,
    jobName: 'maintenance.outbox-cleanup',
    cron: '30 3 * * *',
    timezone: 'Asia/Kolkata',
    description: 'Delete relayed outbox events older than OUTBOX_RETENTION_DAYS (daily 03:30 IST).',
  },
  {
    key: 'sources-health-check',
    queue: QueueName.MAINTENANCE,
    jobName: 'maintenance.sources-health-check',
    everyMs: 15 * 60_000,
    description: 'Probe each active tender source adapter and update its health status (every 15 min).',
  },
];

/**
 * The deterministic mock portal used to demonstrate and test the crawl pipeline. Never seeded in
 * production; it cannot reach the network (its URLs use the reserved `.invalid` TLD).
 */
const MOCK_SOURCE: Prisma.TenderSourceCreateInput = {
  name: 'Mock Tender Portal',
  slug: 'mock-portal',
  description: 'Deterministic in-process test source. Contacts no external system.',
  sourceType: 'MOCK',
  adapterKey: 'mock',
  crawlEnabled: true,
  crawlSchedule: '*/30 * * * *',
  crawlTimezone: 'Asia/Kolkata',
  crawlConfig: { mock: { totalTenders: 24, pageSize: 10 } },
};

/** Idempotent: creates missing rows only and never overwrites values an admin has changed. */
@Injectable()
export class SeedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  async run(): Promise<SeedResult> {
    const result: SeedResult = { schedulesCreated: [], sourcesCreated: [] };

    for (const schedule of DEFAULT_SCHEDULES) {
      const existing = await this.prisma.jobSchedule.findUnique({ where: { key: schedule.key }, select: { id: true } });
      if (existing) continue;
      await this.prisma.jobSchedule.create({ data: schedule });
      result.schedulesCreated.push(schedule.key);
    }

    if (!this.config.isProduction) {
      const existing = await this.prisma.tenderSource.findUnique({ where: { slug: MOCK_SOURCE.slug }, select: { id: true } });
      if (!existing) {
        await this.prisma.tenderSource.create({ data: MOCK_SOURCE });
        result.sourcesCreated.push(MOCK_SOURCE.slug);
      }
    }
    return result;
  }
}
