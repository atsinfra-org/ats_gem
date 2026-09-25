import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { JOB_DEFINITIONS, JOB_SCHEMAS, isJobName } from '../queues/job.registry';
import { QueueName } from '../queues/queue.constants';
import type { DesiredSchedule, RejectedSchedule } from './schedule.types';

/**
 * Reads the desired schedules from the database: platform schedules (job_schedules) plus one
 * crawl schedule per active, crawl-enabled source. Rows naming unknown jobs, a mismatched queue
 * or an invalid payload are rejected (and reported) rather than scheduled.
 */
@Injectable()
export class ScheduleCatalog {
  constructor(private readonly prisma: PrismaService) {}

  async load(): Promise<{ schedules: DesiredSchedule[]; rejected: RejectedSchedule[] }> {
    const [platform, sources] = await Promise.all([
      this.prisma.jobSchedule.findMany({ where: { enabled: true }, orderBy: { key: 'asc' } }),
      this.prisma.tenderSource.findMany({
        where: { isActive: true, crawlEnabled: true, crawlSchedule: { not: null }, deletedAt: null },
        select: { id: true, crawlSchedule: true, crawlTimezone: true },
        orderBy: { slug: 'asc' },
      }),
    ]);

    const schedules: DesiredSchedule[] = [];
    const rejected: RejectedSchedule[] = [];

    for (const row of platform) {
      if (!isJobName(row.jobName)) {
        rejected.push({ key: row.key, reason: `unknown job "${row.jobName}"` });
        continue;
      }
      const expectedQueue = JOB_DEFINITIONS[row.jobName].queue;
      if (row.queue !== expectedQueue) {
        rejected.push({ key: row.key, reason: `job "${row.jobName}" belongs to queue "${expectedQueue}", not "${row.queue}"` });
        continue;
      }
      const payload = JOB_SCHEMAS[row.jobName].safeParse(row.payload);
      if (!payload.success) {
        rejected.push({ key: row.key, reason: `invalid payload: ${payload.error.issues[0]?.message ?? 'unknown'}` });
        continue;
      }
      schedules.push({
        id: `sched.${row.key}`,
        queue: expectedQueue,
        jobName: row.jobName,
        pattern: row.cron ?? undefined,
        every: row.everyMs ?? undefined,
        tz: row.cron ? row.timezone : undefined,
        payload: payload.data,
        origin: 'platform',
      });
    }

    for (const source of sources) {
      schedules.push({
        id: `crawl.${source.id}`,
        queue: QueueName.CRAWLER_DISCOVERY,
        jobName: 'crawler.discover-source',
        pattern: source.crawlSchedule ?? undefined,
        tz: source.crawlTimezone,
        payload: { sourceId: source.id, trigger: 'SCHEDULE' },
        origin: 'source',
      });
    }

    return { schedules, rejected };
  }
}
