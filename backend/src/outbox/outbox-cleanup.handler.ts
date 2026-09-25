import { Injectable } from '@nestjs/common';
import { AppConfig } from '../config/app-config.service';
import { PrismaService } from '../database/prisma.service';
import { JobProcessor, type JobHandler, type JobResult } from '../workers/job-handler';

const BATCH = 5_000;

/** Deletes published outbox events older than OUTBOX_RETENTION_DAYS. Unpublished events are never deleted. */
@Injectable()
@JobProcessor('maintenance.outbox-cleanup')
export class OutboxCleanupHandler implements JobHandler<'maintenance.outbox-cleanup'> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  async handle(): Promise<JobResult> {
    const days = this.config.get('OUTBOX_RETENTION_DAYS');
    const cutoff = new Date(Date.now() - days * 86_400_000);
    let deleted = 0;
    for (;;) {
      const count = await this.prisma.$executeRaw`
        DELETE FROM outbox_events
        WHERE id IN (SELECT id FROM outbox_events WHERE published_at < ${cutoff} LIMIT ${BATCH})`;
      deleted += count;
      if (count < BATCH) break;
    }
    return { deleted, retentionDays: days };
  }
}
