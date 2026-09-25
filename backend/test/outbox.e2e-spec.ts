import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import type { PinoLogger } from 'nestjs-pino';
import { runWithCorrelation } from '../src/common/context/correlation';
import { AppConfig } from '../src/config/app-config.service';
import { AppConfigModule } from '../src/config/config.module';
import { DatabaseModule } from '../src/database/database.module';
import { PrismaService } from '../src/database/prisma.service';
import { LoggingModule } from '../src/logging/logging.module';
import { OutboxCleanupHandler } from '../src/outbox/outbox-cleanup.handler';
import { OutboxModule } from '../src/outbox/outbox.module';
import { OutboxPublisher } from '../src/outbox/outbox.publisher';
import { OutboxRelay } from '../src/outbox/outbox.relay';
import type { RoutedJob } from '../src/outbox/outbox.routes';
import { OutboxService } from '../src/outbox/outbox.service';
import { resetDatabase } from './support/database';

class FakePublisher extends OutboxPublisher {
  readonly published: { jobId: string; job: RoutedJob; correlationId: string | null }[] = [];
  fail: ((jobId: string) => boolean) | undefined;
  delayMs = 0;

  async publish(job: RoutedJob, jobId: string, correlationId: string | null): Promise<void> {
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.fail?.(jobId)) throw new Error('redis unavailable');
    this.published.push({ jobId, job, correlationId });
  }
}

const silentLogger = { setContext: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined } as unknown as PinoLogger;

describe('Transactional outbox (e2e, PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let outbox: OutboxService;
  let config: AppConfig;

  /** A relay with its own batch size and publisher, as a separate worker replica would have. */
  function relay(publisher: OutboxPublisher, batchSize = 100): OutboxRelay {
    const relayConfig = {
      get: (key: string) => (key === 'OUTBOX_BATCH_SIZE' ? batchSize : config.get(key as never)),
    } as unknown as AppConfig;
    return new OutboxRelay(prisma, publisher, relayConfig, silentLogger);
  }

  async function tenderEvent(): Promise<string> {
    return prisma.$transaction((tx) => outbox.record(tx, 'tender.created', { tenderId: randomUUID(), sourceId: null }));
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppConfigModule, LoggingModule, DatabaseModule, OutboxModule] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    outbox = moduleRef.get(OutboxService);
    config = moduleRef.get(AppConfig);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  describe('event creation', () => {
    it('writes the event in the caller transaction with aggregate and correlation id', async () => {
      const organizationId = randomUUID();
      await runWithCorrelation('req-outbox-0001', () =>
        prisma.$transaction((tx) => outbox.record(tx, 'organization.created', { organizationId, ownerUserId: randomUUID() })),
      );
      const event = await prisma.outboxEvent.findFirstOrThrow();
      expect(event).toMatchObject({
        eventType: 'organization.created',
        aggregateType: 'organization',
        aggregateId: organizationId,
        correlationId: 'req-outbox-0001',
        publishedAt: null,
        attempts: 0,
      });
    });

    it('leaves no event behind when the business transaction rolls back', async () => {
      await expect(
        prisma.$transaction(async (tx) => {
          await outbox.record(tx, 'user.created', { userId: randomUUID() });
          throw new Error('business rule failed');
        }),
      ).rejects.toThrow('business rule failed');
      expect(await prisma.outboxEvent.count()).toBe(0);
    });

    it('stores Prisma-written timestamps consistently with SQL now(), whatever the server time zone', async () => {
      // Regression: without a UTC session time zone, the driver adapter's offset-less timestamps were
      // shifted by the server zone (5h30m on an IST-configured Postgres) relative to now().
      await prisma.outboxEvent.create({
        data: { eventType: 'user.created', aggregateType: 'user', aggregateId: 'tz', payload: {}, availableAt: new Date() },
      });
      const [row] = await prisma.$queryRaw<{ skew: number }[]>`
        SELECT abs(extract(epoch FROM available_at - clock_timestamp()))::float8 AS skew FROM outbox_events`;
      expect(row.skew).toBeLessThan(5);
    });

    it('rejects payloads that do not match the event schema', async () => {
      await expect(
        prisma.$transaction((tx) => outbox.record(tx, 'tender.updated', { tenderId: randomUUID(), changedFields: [] })),
      ).rejects.toThrow();
      expect(await prisma.outboxEvent.count()).toBe(0);
    });
  });

  describe('relay', () => {
    it('publishes routed jobs with deterministic ids and marks events published', async () => {
      const eventId = await runWithCorrelation('req-outbox-0002', () => tenderEvent());
      await prisma.$transaction((tx) => outbox.record(tx, 'user.created', { userId: randomUUID() }));
      const publisher = new FakePublisher();

      await expect(relay(publisher).tick()).resolves.toEqual({ claimed: 2, published: 2, failed: 0 });

      expect(publisher.published).toEqual([
        {
          jobId: `evt.${eventId}.search.index-tender`,
          job: { name: 'search.index-tender', payload: expect.objectContaining({ eventId, eventType: 'tender.created' }) },
          correlationId: 'req-outbox-0002',
        },
      ]);
      const events = await prisma.outboxEvent.findMany();
      expect(events.every((e) => e.publishedAt !== null && e.attempts === 1)).toBe(true);
      await expect(relay(publisher).tick()).resolves.toMatchObject({ claimed: 0 });
    });

    it('keeps a failed event pending with exponential backoff, then retries it', async () => {
      const eventId = await tenderEvent();
      const publisher = new FakePublisher();
      publisher.fail = () => true;

      await expect(relay(publisher).tick()).resolves.toEqual({ claimed: 1, published: 0, failed: 1 });
      const failed = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: eventId } });
      expect(failed).toMatchObject({ publishedAt: null, attempts: 1, lastError: 'redis unavailable' });
      expect(failed.availableAt.getTime()).toBeGreaterThan(Date.now());

      // Not yet due: the next tick leaves it alone.
      publisher.fail = undefined;
      await expect(relay(publisher).tick()).resolves.toMatchObject({ claimed: 0 });

      await prisma.outboxEvent.update({ where: { id: eventId }, data: { availableAt: new Date() } });
      await expect(relay(publisher).tick()).resolves.toMatchObject({ claimed: 1, published: 1 });
      await expect(prisma.outboxEvent.findUniqueOrThrow({ where: { id: eventId } })).resolves.toMatchObject({
        attempts: 2,
        lastError: null,
        publishedAt: expect.any(Date),
      });
    });

    it('stops a batch after consecutive failures (queue backend down) instead of churning through it', async () => {
      for (let i = 0; i < 5; i++) await tenderEvent();
      const publisher = new FakePublisher();
      publisher.fail = () => true;
      await expect(relay(publisher).tick()).resolves.toEqual({ claimed: 5, published: 0, failed: 3 });
      const attempts = (await prisma.outboxEvent.findMany({ orderBy: { createdAt: 'asc' } })).map((e) => e.attempts);
      expect(attempts).toEqual([1, 1, 1, 0, 0]);
    });

    it('publishes each event exactly once when relays run concurrently (FOR UPDATE SKIP LOCKED)', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 30; i++) ids.push(await tenderEvent());
      const publisher = new FakePublisher();
      publisher.delayMs = 5;
      const replicas = [relay(publisher, 7), relay(publisher, 7), relay(publisher, 7)];

      const drain = async (r: OutboxRelay) => {
        for (let guard = 0; guard < 20; guard++) if ((await r.tick()).claimed === 0) return;
      };
      await Promise.all(replicas.map(drain));

      const jobIds = publisher.published.map((p) => p.jobId);
      expect(jobIds).toHaveLength(30);
      expect(new Set(jobIds).size).toBe(30);
      expect(await prisma.outboxEvent.count({ where: { publishedAt: null } })).toBe(0);
    });

    it('does not lose an event when publishing succeeds but the transaction cannot commit', async () => {
      // Simulates a crash between enqueue and commit: the event stays pending and is re-published
      // later under the same deterministic job id, which BullMQ ignores as a duplicate.
      const eventId = await tenderEvent();
      const publisher = new FakePublisher();
      await prisma
        .$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM outbox_events WHERE id = ${eventId}::uuid FOR UPDATE`;
          await publisher.publish({ name: 'search.index-tender', payload: { tenderId: randomUUID(), eventId, eventType: 'tender.created' } }, `evt.${eventId}.search.index-tender`, null);
          throw new Error('crash before commit');
        })
        .catch(() => undefined);
      await relay(publisher).tick();
      expect(publisher.published.map((p) => p.jobId)).toEqual([`evt.${eventId}.search.index-tender`, `evt.${eventId}.search.index-tender`]);
      expect(await prisma.outboxEvent.count({ where: { publishedAt: null } })).toBe(0);
    });
  });

  describe('cleanup', () => {
    it('deletes old published events only', async () => {
      const old = new Date(Date.now() - 30 * 86_400_000);
      const base = { eventType: 'user.created', aggregateType: 'user', payload: {} };
      await prisma.outboxEvent.createMany({
        data: [
          { ...base, aggregateId: 'old-published', createdAt: old, publishedAt: old },
          { ...base, aggregateId: 'recent-published', publishedAt: new Date() },
          { ...base, aggregateId: 'old-pending', createdAt: old },
        ],
      });
      const handler = new OutboxCleanupHandler(prisma, config);
      await expect(handler.handle()).resolves.toMatchObject({ deleted: 1 });
      const left = (await prisma.outboxEvent.findMany()).map((e) => e.aggregateId).sort();
      expect(left).toEqual(['old-pending', 'recent-published']);
    });
  });
});
