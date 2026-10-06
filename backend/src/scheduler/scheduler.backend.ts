import { Injectable } from '@nestjs/common';
import type { JobEnvelope } from '../queues/job-envelope';
import { jobOptionsFor } from '../queues/job-options';
import type { QueueName } from '../queues/queue.constants';
import { QueueProducer } from '../queues/queue.producer';
import type { DesiredSchedule, ExistingSchedule } from './schedule.types';

/** Where schedules are registered. Abstract so reconciliation logic is testable without Redis. */
export abstract class SchedulerBackend {
  abstract list(queue: QueueName): Promise<ExistingSchedule[]>;
  abstract upsert(schedule: DesiredSchedule): Promise<void>;
  abstract remove(queue: QueueName, id: string): Promise<void>;
}

/** BullMQ job schedulers: Redis-persisted, idempotent upserts, jobs created on time by BullMQ itself. */
@Injectable()
export class BullmqSchedulerBackend extends SchedulerBackend {
  constructor(private readonly producer: QueueProducer) {
    super();
  }

  async list(queue: QueueName): Promise<ExistingSchedule[]> {
    const schedulers = await this.producer.queue(queue).getJobSchedulers(0, -1, true);
    return schedulers.map((s) => ({
      id: s.key,
      jobName: s.name,
      pattern: s.pattern ?? undefined,
      every: s.every ?? undefined,
      tz: s.tz ?? undefined,
      payload: (s.template?.data as JobEnvelope | undefined)?.payload,
    }));
  }

  async upsert(schedule: DesiredSchedule): Promise<void> {
    const { attempts, backoff, removeOnComplete, removeOnFail } = jobOptionsFor(schedule.jobName);
    const data: JobEnvelope = {
      payload: schedule.payload as JobEnvelope['payload'],
      meta: { origin: 'scheduler', correlationId: `schedule.${schedule.id}` },
    };
    await this.producer.queue(schedule.queue).upsertJobScheduler(
      schedule.id,
      schedule.pattern ? { pattern: schedule.pattern, tz: schedule.tz } : { every: schedule.every },
      { name: schedule.jobName, data, opts: { attempts, backoff, removeOnComplete, removeOnFail } },
    );
  }

  async remove(queue: QueueName, id: string): Promise<void> {
    await this.producer.queue(queue).removeJobScheduler(id);
  }
}
