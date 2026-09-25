import { BeforeApplicationShutdown, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { describeError, LogThrottle } from '../common/errors/describe-error';
import { AppConfig } from '../config/app-config.service';
import { PrismaService } from '../database/prisma.service';
import { DOMAIN_EVENT_SCHEMAS, isDomainEventType } from './domain-events';
import { OutboxPublisher } from './outbox.publisher';
import { outboxJobId, routeEvent, type OutboxEventRecord } from './outbox.routes';

export interface RelayTickResult {
  claimed: number;
  published: number;
  failed: number;
}

interface PendingRow {
  id: string;
  eventType: string;
  payload: unknown;
  correlationId: string | null;
  attempts: number;
}

const MAX_BACKOFF_MS = 10 * 60_000;
/** Stop a batch after this many consecutive failures — usually Redis is down, not the events. */
const MAX_CONSECUTIVE_FAILURES = 3;

export function relayBackoffMs(attempts: number, random: () => number = Math.random): number {
  const base = Math.min(1_000 * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS);
  return Math.round(base * (0.8 + random() * 0.4));
}

/**
 * Moves committed outbox events onto BullMQ queues.
 *
 * Guarantees:
 * - **At-least-once**: an event is marked published only after every routed job was enqueued, in the
 *   same transaction that holds the row lock. A crash in between leaves it pending for retry.
 * - **No duplicates downstream**: jobs use deterministic IDs (`evt.<eventId>.<job>`), so a second
 *   publication of the same event is ignored by BullMQ within the queue's retention window.
 * - **Safe concurrency**: rows are claimed with FOR UPDATE SKIP LOCKED, so several relays (one per
 *   worker replica) never process the same event at the same time.
 * - **Never drops events**: failures back off exponentially (capped at 10 min) and keep retrying.
 */
@Injectable()
export class OutboxRelay implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private running = false;
  private timer?: NodeJS.Timeout;
  private inFlight?: Promise<void>;
  private lastTickCompletedAt = 0;
  private readonly failureLog = new LogThrottle();

  constructor(
    private readonly prisma: PrismaService,
    private readonly publisher: OutboxPublisher,
    private readonly config: AppConfig,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OutboxRelay.name);
  }

  onApplicationBootstrap(): void {
    if (!this.config.get('OUTBOX_RELAY_ENABLED')) {
      this.logger.info({}, 'Outbox relay disabled (OUTBOX_RELAY_ENABLED=false)');
      return;
    }
    this.running = true;
    this.lastTickCompletedAt = Date.now();
    this.scheduleNext(0);
    this.logger.info({ intervalMs: this.config.get('OUTBOX_POLL_INTERVAL_MS') }, 'Outbox relay started');
  }

  /** Processes one batch. Public for tests and for a manual "drain now" command. */
  async tick(): Promise<RelayTickResult> {
    const batchSize = this.config.get('OUTBOX_BATCH_SIZE');
    const result = await this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<PendingRow[]>`
          SELECT id, event_type AS "eventType", payload, correlation_id AS "correlationId", attempts
          FROM outbox_events
          WHERE published_at IS NULL AND available_at <= now()
          ORDER BY created_at, id
          LIMIT ${batchSize}
          FOR UPDATE SKIP LOCKED`;

        const published: string[] = [];
        let failed = 0;
        let consecutiveFailures = 0;

        for (const row of rows) {
          try {
            const event = this.toRecord(row);
            for (const job of routeEvent(event)) {
              await this.publisher.publish(job, outboxJobId(event.id, job.name), event.correlationId);
            }
            published.push(row.id);
            consecutiveFailures = 0;
          } catch (err) {
            failed += 1;
            consecutiveFailures += 1;
            const attempts = row.attempts + 1;
            const message = describeError(err);
            await tx.outboxEvent.update({
              where: { id: row.id },
              data: {
                attempts,
                lastError: message.slice(0, 1000),
                availableAt: new Date(Date.now() + relayBackoffMs(attempts)),
              },
            });
            const level = attempts >= 10 ? 'error' : 'warn';
            this.logger[level]({ eventId: row.id, eventType: row.eventType, attempts, err: { message } }, 'outbox publish failed');
            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) break;
          }
        }

        if (published.length > 0) {
          await tx.outboxEvent.updateMany({
            where: { id: { in: published } },
            data: { publishedAt: new Date(), lastError: null, attempts: { increment: 1 } },
          });
        }
        return { claimed: rows.length, published: published.length, failed };
      },
      { timeout: 30_000, maxWait: 5_000 },
    );

    if (result.claimed > 0) this.logger.info({ ...result }, 'outbox batch relayed');
    return result;
  }

  async pendingCount(): Promise<number> {
    return this.prisma.outboxEvent.count({ where: { publishedAt: null } });
  }

  isHealthy(): boolean {
    if (!this.config.get('OUTBOX_RELAY_ENABLED')) return true;
    const staleAfter = Math.max(30_000, this.config.get('OUTBOX_POLL_INTERVAL_MS') * 10);
    return this.running && Date.now() - this.lastTickCompletedAt < staleAfter;
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.running = false;
    clearTimeout(this.timer);
    await this.inFlight;
  }

  private scheduleNext(delayMs: number): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      this.inFlight = this.loop();
    }, delayMs);
  }

  private async loop(): Promise<void> {
    const interval = this.config.get('OUTBOX_POLL_INTERVAL_MS');
    let next = interval;
    try {
      const { claimed } = await this.tick();
      this.lastTickCompletedAt = Date.now();
      this.failureLog.reset();
      // A full batch means more is waiting: drain immediately.
      if (claimed === this.config.get('OUTBOX_BATCH_SIZE')) next = 0;
    } catch (err) {
      // Database unavailable: keep the loop alive and back off.
      next = Math.min(interval * 5, 30_000);
      if (this.failureLog.ready()) this.logger.warn({ error: describeError(err) }, 'outbox relay tick failed; backing off');
    }
    this.scheduleNext(next);
  }

  private toRecord(row: PendingRow): OutboxEventRecord {
    if (!isDomainEventType(row.eventType)) throw new Error(`Unknown event type "${row.eventType}"`);
    const payload = DOMAIN_EVENT_SCHEMAS[row.eventType].parse(row.payload);
    return { id: row.id, eventType: row.eventType, payload, correlationId: row.correlationId };
  }
}
