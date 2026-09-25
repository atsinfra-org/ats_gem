import { BeforeApplicationShutdown, Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import type Redis from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { AppConfig } from '../config/app-config.service';
import { describeError, LogThrottle } from '../common/errors/describe-error';
import { stableStringify } from '../common/stable-json';
import { ALL_QUEUES, QueueName } from '../queues/queue.constants';
import { REDIS } from '../redis/redis.module';
import { LeaderLock } from './leader-lock';
import { ScheduleCatalog } from './schedule-catalog.service';
import { SchedulerBackend } from './scheduler.backend';
import { isManagedSchedule, type DesiredSchedule, type ExistingSchedule, type ReconcileResult } from './schedule.types';

export const SCHEDULER_OPTIONS = Symbol('SCHEDULER_OPTIONS');
export interface SchedulerOptions {
  /** true in the scheduler process; false where reconcile() is only called on demand (CLI, tests). */
  runLoop: boolean;
}

function differs(existing: ExistingSchedule, desired: DesiredSchedule): boolean {
  return (
    existing.jobName !== desired.jobName ||
    (existing.pattern ?? null) !== (desired.pattern ?? null) ||
    (existing.every ?? null) !== (desired.every ?? null) ||
    (desired.pattern ? (existing.tz ?? null) !== (desired.tz ?? null) : false) ||
    stableStringify(existing.payload) !== stableStringify(desired.payload)
  );
}

/**
 * Keeps BullMQ job schedulers in sync with the database. The scheduler never performs work
 * itself: BullMQ enqueues each job at its scheduled time and workers process it.
 */
@Injectable()
export class SchedulerService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private running = false;
  private timer?: NodeJS.Timeout;
  private inFlight?: Promise<void>;
  private lock?: LeaderLock;
  private leader = false;
  private lastCycleAt = 0;
  private readonly failureLog = new LogThrottle();

  constructor(
    private readonly catalog: ScheduleCatalog,
    private readonly backend: SchedulerBackend,
    private readonly config: AppConfig,
    private readonly logger: PinoLogger,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(SCHEDULER_OPTIONS) private readonly options: SchedulerOptions,
  ) {
    this.logger.setContext(SchedulerService.name);
  }

  onApplicationBootstrap(): void {
    if (!this.options.runLoop) return;
    const interval = this.config.get('SCHEDULER_SYNC_INTERVAL_MS');
    this.lock = new LeaderLock(this.redis, `${this.config.get('QUEUE_PREFIX')}:scheduler:leader`, interval * 3);
    this.running = true;
    this.lastCycleAt = Date.now();
    this.scheduleNext(0);
    this.logger.info({ intervalMs: interval }, 'Scheduler started');
  }

  /** Brings BullMQ in line with the database. Idempotent; safe to run from several places. */
  async reconcile(): Promise<ReconcileResult> {
    const { schedules, rejected } = await this.catalog.load();
    const desired = new Map(schedules.map((s) => [s.id, s]));
    const result: ReconcileResult = { desired: schedules.length, upserted: [], removed: [], unchanged: 0, failed: [], rejected };

    const existingById = new Map<string, ExistingSchedule & { queue: QueueName }>();
    for (const queue of ALL_QUEUES.filter((q) => q !== QueueName.DEAD_LETTER)) {
      for (const existing of await this.backend.list(queue)) {
        if (!isManagedSchedule(existing.id)) continue;
        const wanted = desired.get(existing.id);
        if (!wanted || wanted.queue !== queue) {
          await this.backend.remove(queue, existing.id);
          result.removed.push(existing.id);
        } else {
          existingById.set(existing.id, { ...existing, queue });
        }
      }
    }

    for (const schedule of schedules) {
      const current = existingById.get(schedule.id);
      if (current && !differs(current, schedule)) {
        result.unchanged += 1;
        continue;
      }
      try {
        await this.backend.upsert(schedule);
        result.upserted.push(schedule.id);
      } catch (err) {
        // e.g. an invalid cron expression in a source row: report it, keep the others running.
        result.failed.push({ id: schedule.id, reason: describeError(err) });
      }
    }

    for (const r of rejected) this.logger.warn({ scheduleKey: r.key, reason: r.reason }, 'schedule rejected');
    for (const f of result.failed) this.logger.error({ scheduleId: f.id, reason: f.reason }, 'schedule registration failed');
    if (result.upserted.length || result.removed.length) {
      this.logger.info({ upserted: result.upserted, removed: result.removed, unchanged: result.unchanged }, 'schedules reconciled');
    }
    return result;
  }

  isLeader(): boolean {
    return this.leader;
  }

  isHealthy(): boolean {
    if (!this.options.runLoop) return true;
    return this.running && Date.now() - this.lastCycleAt < this.config.get('SCHEDULER_SYNC_INTERVAL_MS') * 3;
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.running = false;
    clearTimeout(this.timer);
    await this.inFlight;
    if (this.leader) await this.lock?.release().catch(() => undefined);
  }

  private scheduleNext(delayMs: number): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      this.inFlight = this.cycle();
    }, delayMs);
  }

  private async cycle(): Promise<void> {
    const interval = this.config.get('SCHEDULER_SYNC_INTERVAL_MS');
    let next = interval;
    try {
      const wasLeader = this.leader;
      this.leader = (await this.lock?.acquireOrRenew()) ?? false;
      if (this.leader !== wasLeader) this.logger.info({ leader: this.leader }, this.leader ? 'Became scheduler leader' : 'Lost scheduler leadership');
      if (this.leader) await this.reconcile();
      this.lastCycleAt = Date.now();
      this.failureLog.reset();
    } catch (err) {
      this.leader = false;
      // Usually Redis or Postgres is still starting: retry sooner than a full interval.
      next = Math.min(5_000, interval);
      if (this.failureLog.ready()) this.logger.warn({ error: describeError(err) }, 'scheduler cycle failed; retrying');
    }
    this.scheduleNext(next);
  }
}
