import { Injectable } from '@nestjs/common';
import { QueueProducer } from '../queues/queue.producer';
import type { RoutedJob } from './outbox.routes';

/** Publishes one routed job. Abstracted so the relay can be tested without Redis. */
export abstract class OutboxPublisher {
  abstract publish(job: RoutedJob, jobId: string, correlationId: string | null): Promise<void>;
}

@Injectable()
export class QueueOutboxPublisher extends OutboxPublisher {
  constructor(private readonly producer: QueueProducer) {
    super();
  }

  async publish(job: RoutedJob, jobId: string, correlationId: string | null): Promise<void> {
    await this.producer.enqueue(job.name, job.payload, {
      jobId,
      origin: 'outbox',
      correlationId: correlationId ?? undefined,
    });
  }
}
