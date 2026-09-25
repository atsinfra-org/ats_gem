import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import type { JobOrigin } from '../queues/job-envelope';
import { QueueProducer } from '../queues/queue.producer';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SourceNotFoundError extends Error {
  constructor(ref: string) {
    super(`No active tender source matches "${ref}"`);
    this.name = 'SourceNotFoundError';
  }
}

/**
 * Requests an on-demand crawl. Used by the CLI now and by the admin "run crawl" action in Phase 5.
 * Scheduled crawls do not come through here — the scheduler owns those.
 */
@Injectable()
export class CrawlDispatcher {
  constructor(
    private readonly prisma: PrismaService,
    private readonly producer: QueueProducer,
  ) {}

  async requestCrawl(slugOrId: string, options: { requestedBy?: string; origin?: JobOrigin } = {}) {
    const source = await this.prisma.tenderSource.findFirst({
      where: { deletedAt: null, isActive: true, ...(UUID.test(slugOrId) ? { id: slugOrId } : { slug: slugOrId }) },
      select: { id: true, slug: true },
    });
    if (!source) throw new SourceNotFoundError(slugOrId);
    // Unique per request, so a crawl run can be tied back to exactly one job execution.
    const jobId = `manual.${source.id}.${randomUUID()}`;
    await this.producer.enqueue(
      'crawler.discover-source',
      { sourceId: source.id, trigger: 'MANUAL', requestedBy: options.requestedBy },
      { jobId, origin: options.origin ?? 'api' },
    );
    return { sourceId: source.id, slug: source.slug, jobId };
  }
}
