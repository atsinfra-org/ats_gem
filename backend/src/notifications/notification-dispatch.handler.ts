import { Injectable } from '@nestjs/common';
import type { JobPayload } from '../queues/job.registry';
import { JobProcessor, type JobHandler, type JobResult } from '../workers/job-handler';
import { NotificationEventProcessor } from './notification-event-processor.service';

/** Consumes `notification.dispatch` (one per outbox domain event). Retried by the queue; idempotent by dedup key. */
@Injectable()
@JobProcessor('notification.dispatch')
export class NotificationDispatchHandler implements JobHandler<'notification.dispatch'> {
  constructor(private readonly processor: NotificationEventProcessor) {}

  async handle(payload: JobPayload<'notification.dispatch'>): Promise<JobResult> {
    return this.processor.process(payload.eventId);
  }
}
