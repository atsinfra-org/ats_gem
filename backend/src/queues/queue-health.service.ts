import { Injectable } from '@nestjs/common';
import { ALL_QUEUES, type QueueName } from './queue.constants';
import { QueueProducer } from './queue.producer';

export interface QueueSnapshot {
  queue: QueueName;
  paused: boolean;
  counts: Record<string, number>;
  /** Connected consumers; null when the Redis server disallows CLIENT LIST. */
  workers: number | null;
  /** Age of the oldest waiting job in ms (queue latency), or null when nothing is waiting. */
  oldestWaitingMs: number | null;
}

// A paused queue keeps its jobs in "waiting"; `paused` below says whether the queue is paused.
const COUNT_STATES = ['waiting', 'active', 'delayed', 'prioritized', 'waiting-children', 'failed', 'completed'] as const;

@Injectable()
export class QueueHealthService {
  constructor(private readonly producer: QueueProducer) {}

  async snapshot(): Promise<QueueSnapshot[]> {
    return Promise.all(ALL_QUEUES.map((name) => this.snapshotOf(name)));
  }

  private async snapshotOf(name: QueueName): Promise<QueueSnapshot> {
    const queue = this.producer.queue(name);
    const [counts, paused, workers, oldest] = await Promise.all([
      queue.getJobCounts(...COUNT_STATES),
      queue.isPaused(),
      queue.getWorkersCount().catch(() => null),
      queue.getWaiting(0, 0),
    ]);
    const oldestJob = oldest[0];
    return {
      queue: name,
      paused,
      counts,
      workers,
      oldestWaitingMs: oldestJob ? Date.now() - oldestJob.timestamp : null,
    };
  }
}
