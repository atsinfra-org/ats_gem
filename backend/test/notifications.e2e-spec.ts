import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { ApiModule } from '../src/api.module';
import { configureApp } from '../src/bootstrap/configure-app';
import { AuditModule } from '../src/audit/audit.module';
import { AppConfig } from '../src/config/app-config.service';
import { AppConfigModule } from '../src/config/config.module';
import { DatabaseModule } from '../src/database/database.module';
import { PrismaService } from '../src/database/prisma.service';
import { EmailTransport, PermanentEmailError, type EmailMessage, type SendResult } from '../src/email/email-transport';
import type { Prisma } from '../src/generated/prisma/client';
import { NotificationDeliveryService } from '../src/notifications/notification-delivery.service';
import { NotificationEmailHandler } from '../src/notifications/notification-email.handler';
import { NotificationEventProcessor } from '../src/notifications/notification-event-processor.service';
import { NotificationsWorkerModule } from '../src/notifications/notifications.module';
import { DeadlineSweepHandler, DigestHandler } from '../src/notifications/notification-scheduled.handlers';
import { NotificationsService } from '../src/notifications/notifications.service';
import { SavedSearchMatcherService } from '../src/notifications/saved-search-matcher.service';
import { OutboxModule } from '../src/outbox/outbox.module';
import { PermanentJobError } from '../src/queues/job-errors';
import type { JobName } from '../src/queues/job.registry';
import { QueueProducer } from '../src/queues/queue.producer';
import { QueuesModule } from '../src/queues/queues.module';
import { SearchService } from '../src/search/search.service';
import { CorrigendaService } from '../src/tenders/corrigenda/corrigenda.service';
import { ListTendersQueryDto } from '../src/tenders/dto/list-tenders.query.dto';
import { plainToInstance } from 'class-transformer';
import type { JobContext } from '../src/workers/job-handler';
import { withConfig } from './support/config';
import { resetDatabase } from './support/database';

class CapturingTransport extends EmailTransport {
  readonly driver = 'memory';
  sent: EmailMessage[] = [];
  failures: (() => Error)[] = [];
  send(message: EmailMessage): Promise<SendResult> {
    const next = this.failures.shift();
    if (next) return Promise.reject(next());
    this.sent.push(message);
    return Promise.resolve({ messageId: `mem-${this.sent.length}` });
  }
}

interface Enqueued {
  name: JobName;
  payload: Record<string, unknown>;
  jobId?: string;
  delay?: number;
}
class FakeQueue {
  jobs: Enqueued[] = [];
  failNext = false;
  enqueue(name: JobName, payload: Record<string, unknown>, opts: { jobId?: string; delay?: number } = {}) {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('redis unavailable'));
    }
    if (opts.jobId && this.jobs.some((j) => j.jobId === opts.jobId)) return Promise.resolve({ id: opts.jobId });
    this.jobs.push({ name, payload, jobId: opts.jobId, delay: opts.delay });
    return Promise.resolve({ id: opts.jobId ?? '' });
  }
}

const ctxOf = (attempt = 1, isFinalAttempt = false) => ({ attempt, isFinalAttempt, maxAttempts: 6, jobId: 'j', queue: 'email', jobName: 'notification.email', correlationId: 'c' }) as unknown as JobContext;
const H = 3_600_000;

describe('Notifications & alerts (e2e, PostgreSQL)', () => {
  let api: NestExpressApplication;
  let worker: TestingModule;
  let prisma: PrismaService;
  let transport: CapturingTransport;
  let queue: FakeQueue;
  let processor: NotificationEventProcessor;
  let emailHandler: NotificationEmailHandler;
  let sweep: DeadlineSweepHandler;
  let digest: DigestHandler;
  let matcher: SavedSearchMatcherService;
  let search: SearchService;
  let notifications: NotificationsService;
  let delivery: NotificationDeliveryService;
  let sourceId: string;
  let seq = 0;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (path: string, token: string) => request(api.getHttpServer()).get(`/api/v1${path}`).set(auth(token));
  const patch = (path: string, token: string, body?: object) => request(api.getHttpServer()).patch(`/api/v1${path}`).set(auth(token)).send(body ?? {});

  async function user(name: string, opts: { verified?: boolean } = {}) {
    const email = `${name}-${++seq}-${Date.now()}@example.com`;
    const res = await request(api.getHttpServer()).post('/api/v1/auth/register').send({ name: `User ${name}`, email, password: 'correct-horse-battery', acceptTerms: true }).expect(201);
    const u = await prisma.user.findUniqueOrThrow({ where: { email } });
    if (opts.verified !== false) await prisma.user.update({ where: { id: u.id }, data: { isEmailVerified: true } });
    const organizationId = (await prisma.organizationMember.findFirstOrThrow({ where: { userId: u.id } })).organizationId;
    return { id: u.id, email, organizationId, token: (res.body as { data: { accessToken: string } }).data.accessToken };
  }

  async function tender(over: Partial<Prisma.TenderUncheckedCreateInput> & { title: string }) {
    const t = await prisma.tender.create({
      data: { publishedAt: new Date('2026-01-02T00:00:00Z'), currency: 'INR', status: 'OPEN', statusComputedAt: new Date(), lastSyncedAt: new Date(), lifecycle: 'ACTIVE', ...over },
    });
    await prisma.tenderSourceRecord.create({
      data: { tenderId: t.id, sourceId, externalTenderId: `ext-${t.id}`, payloadHash: 'a'.repeat(64), rawPayload: {}, normalizedPayload: {}, firstSeenAt: new Date(), lastSeenAt: new Date(), lastChangedAt: new Date() },
    });
    return t;
  }

  async function savedSearch(u: { id: string; organizationId: string }, criteria: object, alertFrequency: 'OFF' | 'IMMEDIATE' | 'DAILY' = 'IMMEDIATE', name = 'My search') {
    return prisma.savedSearch.create({ data: { organizationId: u.organizationId, createdBy: u.id, name, criteria, alertFrequency } });
  }

  async function event(eventType: string, aggregateType: string, aggregateId: string, payload: object): Promise<string> {
    return (await prisma.outboxEvent.create({ data: { eventType, aggregateType, aggregateId, payload } })).id;
  }
  const created = (tenderId: string) => event('tender.created', 'tender', tenderId, { tenderId, sourceId: null });

  /** Runs every queued email job through the real handler (a worker would do this). */
  async function drainEmails(attempt = 1) {
    const out: { deliveryId: string; result?: unknown; error?: unknown }[] = [];
    for (const j of queue.jobs.filter((x) => x.name === 'notification.email')) {
      try {
        out.push({ deliveryId: j.payload.deliveryId as string, result: await emailHandler.handle({ deliveryId: j.payload.deliveryId as string }, ctxOf(attempt)) });
      } catch (error) {
        out.push({ deliveryId: j.payload.deliveryId as string, error });
      }
    }
    queue.jobs = queue.jobs.filter((x) => x.name !== 'notification.email');
    return out;
  }

  beforeAll(async () => {
    const apiRef = await Test.createTestingModule({ imports: [ApiModule] })
      .overrideProvider(AppConfig)
      .useFactory(withConfig({ RATE_LIMIT_AUTH_MAX: 100_000, RATE_LIMIT_SEARCH_MAX: 100_000 }))
      .compile();
    api = apiRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
    configureApp(api);
    await api.init();
    prisma = api.get(PrismaService);

    transport = new CapturingTransport();
    queue = new FakeQueue();
    worker = await Test.createTestingModule({ imports: [AppConfigModule, DatabaseModule, QueuesModule, AuditModule, OutboxModule, NotificationsWorkerModule] })
      .overrideProvider(AppConfig)
      .useFactory(withConfig({ NOTIFY_EMAIL_MAX_PER_SEARCH_PER_HOUR: 2, NOTIFY_EMAIL_MAX_PER_USER_PER_HOUR: 50, NOTIFY_INAPP_MAX_PER_SEARCH_PER_HOUR: 4, FRONTEND_URL: 'https://app.example.test' }))
      .overrideProvider(EmailTransport)
      .useValue(transport)
      .overrideProvider(QueueProducer)
      .useValue(queue)
      .compile();
    await worker.init();
    processor = worker.get(NotificationEventProcessor);
    emailHandler = worker.get(NotificationEmailHandler);
    sweep = worker.get(DeadlineSweepHandler);
    digest = worker.get(DigestHandler);
    matcher = worker.get(SavedSearchMatcherService);
    search = worker.get(SearchService);
    notifications = worker.get(NotificationsService);
    delivery = worker.get(NotificationDeliveryService);
  });

  afterAll(async () => {
    await api?.close();
    await worker?.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await prisma.$executeRawUnsafe('TRUNCATE TABLE notifications, notification_deliveries, notification_preferences, notification_settings, outbox_events, search_history, search_events, categories CASCADE');
    sourceId = (await prisma.tenderSource.create({ data: { name: 'Src', slug: `s-${Math.random().toString(36).slice(2, 8)}`, sourceType: 'MOCK', adapterKey: 'mock', crawlConfig: {} } })).id;
    transport.sent = [];
    transport.failures = [];
    queue.jobs = [];
    queue.failNext = false;
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  describe('saved-search alerts (new tender)', () => {
    it('notifies exactly the users whose alert-enabled saved search matches, in-app and by email', async () => {
      const a = await user('a');
      const b = await user('b');
      const c = await user('c');
      const d = await user('d');
      await savedSearch(a, { q: 'road', state: 'MH' }, 'IMMEDIATE', 'Roads MH');
      await savedSearch(b, { q: 'road', state: 'UP' }, 'IMMEDIATE'); // wrong state
      await savedSearch(c, { q: 'road', state: 'MH' }, 'OFF'); // alerts off
      await savedSearch(d, { q: 'road', state: 'MH' }, 'IMMEDIATE'); // identical criteria, other user

      const t = await tender({ title: 'Road repair works phase 2', stateCode: 'MH', referenceNumber: 'PWD/2026/9' });
      const summary = await processor.process(await created(t.id));
      expect(summary).toMatchObject({ recipients: 2, created: 2, emailQueued: 2, duplicates: 0 });

      const rows = await prisma.notification.findMany({ orderBy: { userId: 'asc' } });
      expect(rows.map((r) => r.userId).sort()).toEqual([a.id, d.id].sort());
      const mine = rows.find((r) => r.userId === a.id)!;
      expect(mine).toMatchObject({ type: 'SAVED_SEARCH_MATCH', entityType: 'tender', entityId: t.id, isRead: false, priority: 'NORMAL', templateKey: 'saved-search-match', templateVersion: 1, organizationId: a.organizationId });
      expect(mine.title).toContain('Roads MH');

      const emails = await drainEmails();
      expect(emails.every((e) => !e.error)).toBe(true);
      expect(transport.sent).toHaveLength(2);
      const toA = transport.sent.find((m) => m.to === a.email)!;
      expect(toA.subject).toContain('Road repair works phase 2');
      expect(toA.text).toContain(`https://app.example.test/tenders/${t.id}`);
      expect(toA.html).toContain(`https://app.example.test/tenders/${t.id}`);
      expect(toA.text).toContain('PWD/2026/9');
      expect(`${toA.text}${toA.html}${toA.subject}`).not.toMatch(/eyJ|bearer|refresh|password/i);
      expect(transport.sent.map((m) => m.to)).not.toContain(b.email);
      const del = await prisma.notificationDelivery.findMany({ where: { userId: a.id } });
      expect(del).toEqual([expect.objectContaining({ status: 'SENT', provider: 'memory', attempts: 1, templateKey: 'saved-search-match' })]);
    });

    it('is idempotent: replaying the same event (job retry, re-ingestion) creates nothing new', async () => {
      const a = await user('idem');
      await savedSearch(a, { q: 'bridge' });
      const t = await tender({ title: 'Bridge inspection' });
      const ev = await created(t.id);
      await processor.process(ev);
      const again = await processor.process(ev);
      expect(again).toMatchObject({ created: 0, duplicates: 1, emailQueued: 0 });
      // a *different* event for the same tender (crawler re-run) is also a duplicate: the key is per user + tender
      const other = await processor.process(await created(t.id));
      expect(other).toMatchObject({ created: 0, duplicates: 1 });
      expect(await prisma.notification.count()).toBe(1);
      expect(await prisma.notificationDelivery.count()).toBe(1);
      expect(queue.jobs.filter((j) => j.name === 'notification.email')).toHaveLength(1);
    });

    it('one notification per user per tender even when several of their searches match', async () => {
      const a = await user('multi');
      await savedSearch(a, { q: 'road' }, 'IMMEDIATE', 'Zeta roads');
      await savedSearch(a, { state: 'MH' }, 'IMMEDIATE', 'Alpha MH');
      const t = await tender({ title: 'Road works', stateCode: 'MH' });
      await processor.process(await created(t.id));
      const rows = await prisma.notification.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0].title).toContain('Alpha MH');
      expect((rows[0].metadata as { savedSearchNames: string[] }).savedSearchNames).toEqual(['Alpha MH', 'Zeta roads']);
    });

    it('never alerts for deleted or duplicate tenders, and ignores inactive searches or users who left the organization', async () => {
      const a = await user('skip');
      const left = await user('left');
      const ss = await savedSearch(a, { q: 'canal' });
      await savedSearch(left, { q: 'canal' });
      await prisma.organizationMember.delete({ where: { organizationId_userId: { organizationId: left.organizationId, userId: left.id } } });
      const dead = await tender({ title: 'Canal lining', deletedAt: new Date() });
      expect(await processor.process(await created(dead.id))).toMatchObject({ created: 0, skippedReason: 'TENDER_UNAVAILABLE' });
      await prisma.savedSearch.update({ where: { id: ss.id }, data: { isActive: false } });
      const live = await tender({ title: 'Canal desilting' });
      expect(await processor.process(await created(live.id))).toMatchObject({ recipients: 0 });
      expect(await prisma.notification.count()).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  describe('saved-search matching uses the Phase 7 search semantics', () => {
    it('a saved search matches a tender if and only if the strict search lists it', async () => {
      const u = await user('sem');
      const cat = await prisma.category.create({ data: { name: 'Roads', slug: `roads-${Date.now()}` } });
      const child = await prisma.category.create({ data: { name: 'Bridges', slug: `bridges-${Date.now()}`, parentId: cat.id } });
      const entity = await prisma.procuringEntity.create({ data: { name: 'Pune Municipal Corporation', nameNormalized: 'pune municipal corporation', entityType: 'OTHER', stateCode: 'MH' } });
      const tenders = [
        await tender({ title: 'Highway resurfacing Pune', stateCode: 'MH', status: 'OPEN', categoryId: child.id, estimatedValue: '5000000.00', closingAt: new Date('2026-10-20T10:00:00Z'), city: 'Pune', referenceNumber: 'PWD/2026/0001', referenceNumberNormalized: 'PWD20260001', procuringEntityId: entity.id }),
        await tender({ title: 'Solar rooftop installation', stateCode: 'UP', status: 'CLOSED', estimatedValue: '900000.00', closingAt: new Date('2026-09-01T10:00:00Z'), city: 'Lucknow', referenceNumber: 'UPPC/2026/7', referenceNumberNormalized: 'UPPC20267' }),
        await tender({ title: 'Data centre upgrade', stateCode: 'MH', status: 'OPEN', estimatedValue: '12000000.00', city: 'Nagpur' }),
        await tender({ title: 'Deleted highway', stateCode: 'MH', deletedAt: new Date() }),
      ];
      const criteriaSets: object[] = [
        { state: 'MH' },
        { state: ['MH', 'UP'], status: ['OPEN'] },
        { category: [cat.id] }, // parent expands to child
        { minValue: '1000000', maxValue: '6000000' },
        { closingFrom: '2026-10-01', closingTo: '2026-10-31' },
        { q: 'highway' },
        { q: 'solar rooftop' },
        { reference: 'PWD/2026' },
        { q: 'PWD/2026/0001' },
        { city: ['pune', 'nagpur'] },
        { procuringEntity: [entity.id] },
        { q: 'data', state: 'MH', minValue: '10000000' },
        { tenderType: ['NOPE'] },
      ];
      for (const criteria of criteriaSets) {
        const ss = await savedSearch(u, criteria);
        const dto = plainToInstance(ListTendersQueryDto, criteria);
        const listed = new Set((await search.search(dto, { page: 1, pageSize: 100 })).hits.map((h) => h.id));
        const ids = new Set<string>();
        for (const t of tenders) if ((await matcher.match(t.id)).some((m) => m.savedSearchId === ss.id)) ids.add(t.id);
        expect([...ids].sort(), JSON.stringify(criteria)).toEqual(tenders.filter((t) => listed.has(t.id)).map((t) => t.id).sort());
        await prisma.savedSearch.delete({ where: { id: ss.id } });
      }
    });

    it('legacy single-string criteria still match, and a stored criteria set that no longer validates does not block others', async () => {
      const u = await user('legacy');
      const v = await user('other');
      await savedSearch(u, { q: 'bridge', state: 'MH', status: 'OPEN' });
      await savedSearch(v, { minValue: 'lots' }); // invalid stored criteria
      await savedSearch(v, { q: 'bridge' });
      const t = await tender({ title: 'Bridge repair', stateCode: 'MH', status: 'OPEN' });
      const m = await matcher.match(t.id);
      expect(m.map((x) => x.userId).sort()).toEqual([u.id, v.id].sort());
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  describe('saved-tender alerts (updates, deadline changes, cancellation, status)', () => {
    it('notifies watchers about a changed closing date with the old and new dates, and about nothing else for cosmetic changes', async () => {
      const w = await user('watch');
      const stranger = await user('stranger');
      const t = await tender({ title: 'Water pipeline', closingAt: new Date('2026-10-20T10:00:00Z') });
      await prisma.watchlistItem.create({ data: { userId: w.id, tenderId: t.id } });
      await prisma.tenderVersion.create({ data: { tenderId: t.id, version: 2, changeType: 'CORRIGENDUM', diff: { closingAt: { from: '2026-10-10T10:00:00.000Z', to: '2026-10-20T10:00:00.000Z' } } } });
      const ev = await event('tender.updated', 'tender', t.id, { tenderId: t.id, changedFields: ['closingAt', 'description'] });
      expect(await processor.process(ev)).toMatchObject({ recipients: 1, created: 1 });
      const n = await prisma.notification.findFirstOrThrow({ where: { userId: w.id } });
      expect(n.type).toBe('TENDER_UPDATED');
      expect(n.message).toContain('closing date is now');
      expect(n.message).toContain('20 Oct 2026');
      expect(n.message).toContain('was 10 Oct 2026');
      expect(n.metadata).toMatchObject({ changedFields: ['closingAt'], previousClosingAt: '2026-10-10T10:00:00.000Z' });
      expect(await prisma.notification.count({ where: { userId: stranger.id } })).toBe(0);

      const cosmetic = await event('tender.updated', 'tender', t.id, { tenderId: t.id, changedFields: ['description', 'city', 'sourceUrl'] });
      expect(await processor.process(cosmetic)).toMatchObject({ created: 0, skippedReason: 'NOT_NOTIFY_WORTHY' });
      expect(await prisma.notification.count()).toBe(1);
    });

    it('cancellation and closure produce their own notification types', async () => {
      const w = await user('cancel');
      const t = await tender({ title: 'Cancelled works', lifecycle: 'CANCELLED', status: 'CANCELLED' });
      await prisma.watchlistItem.create({ data: { userId: w.id, tenderId: t.id } });
      await processor.process(await event('tender.updated', 'tender', t.id, { tenderId: t.id, changedFields: ['lifecycle'] }));
      expect((await prisma.notification.findFirstOrThrow({ where: { userId: w.id } })).type).toBe('TENDER_CANCELLED');

      const t2 = await tender({ title: 'Closed works', status: 'CLOSED' });
      await prisma.watchlistItem.create({ data: { userId: w.id, tenderId: t2.id } });
      await processor.process(await event('tender.closed', 'tender', t2.id, { tenderId: t2.id, closedAt: new Date().toISOString() }));
      const closed = await prisma.notification.findFirstOrThrow({ where: { userId: w.id, entityId: t2.id } });
      expect(closed).toMatchObject({ type: 'TENDER_STATUS_CHANGED', priority: 'NORMAL' });
    });

    it('a repeated tender.updated event does not notify twice, but a new one does', async () => {
      const w = await user('rep');
      const t = await tender({ title: 'Value change', estimatedValue: '2000.00' });
      await prisma.watchlistItem.create({ data: { userId: w.id, tenderId: t.id } });
      const ev = await event('tender.updated', 'tender', t.id, { tenderId: t.id, changedFields: ['estimatedValue'] });
      await processor.process(ev);
      await processor.process(ev);
      expect(await prisma.notification.count()).toBe(1);
      await processor.process(await event('tender.updated', 'tender', t.id, { tenderId: t.id, changedFields: ['estimatedValue'] }));
      expect(await prisma.notification.count()).toBe(2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  describe('corrigendum alerts', () => {
    it('reaches users who saved the tender and users whose alert-enabled search matches it, once each', async () => {
      const watcher = await user('cw');
      const searcher = await user('cs');
      const both = await user('cb');
      const outsider = await user('co');
      const t = await tender({ title: 'Culvert construction', stateCode: 'MH' });
      await prisma.watchlistItem.createMany({ data: [{ userId: watcher.id, tenderId: t.id }, { userId: both.id, tenderId: t.id }] });
      await savedSearch(searcher, { q: 'culvert' });
      await savedSearch(both, { q: 'culvert' });
      await savedSearch(outsider, { q: 'culvert' }, 'OFF');
      const corr = await prisma.tenderCorrigendum.create({ data: { tenderId: t.id, title: 'Extension of bid submission date', publishedAt: new Date() } });
      const ev = await event('tender.corrigendum_created', 'tender', t.id, { tenderId: t.id, corrigendumId: corr.id });
      expect(await processor.process(ev)).toMatchObject({ recipients: 3, created: 3 });
      const rows = await prisma.notification.findMany();
      expect(rows.map((r) => r.userId).sort()).toEqual([watcher.id, searcher.id, both.id].sort());
      expect(rows.every((r) => r.type === 'TENDER_CORRIGENDUM' && r.priority === 'HIGH' && r.message === 'Extension of bid submission date')).toBe(true);
      expect(await processor.process(ev)).toMatchObject({ created: 0, duplicates: 3 });
      await drainEmails();
      const mail = transport.sent.find((m) => m.to === watcher.email)!;
      expect(mail.subject).toBe('Corrigendum: Culvert construction');
      expect(mail.text).toContain('Extension of bid submission date');
    });

    it('a corrigendum recorded through the service emits the outbox event in the same transaction', async () => {
      const t = await tender({ title: 'Outbox corrigendum' });
      const svc = api.get(CorrigendaService, { strict: false });
      const actor = await user('actor');
      const c = await svc.create({ tenderId: t.id, title: 'Corrigendum 1', publishedAt: new Date() }, actor.id);
      const ev = await prisma.outboxEvent.findFirstOrThrow({ where: { eventType: 'tender.corrigendum_created' } });
      expect(ev.payload).toEqual({ tenderId: t.id, corrigendumId: c.id });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  describe('deadline reminders', () => {
    it('sends one reminder per configured offset, only for saved, open, dated tenders, and never twice', async () => {
      const w = await user('dl'); // default offsets: [24]
      const wide = await user('dlwide');
      const narrow = await user('dlnarrow');
      await prisma.notificationSettings.create({ data: { userId: wide.id, deadlineOffsetsHours: [72, 24, 3] } });
      await prisma.notificationSettings.create({ data: { userId: narrow.id, deadlineOffsetsHours: [3] } });

      const soon = await tender({ title: 'Closing soon', closingAt: new Date(Date.now() + 20 * H) });
      const far = await tender({ title: 'Closing far', closingAt: new Date(Date.now() + 100 * H) });
      const closed = await tender({ title: 'Already closed', status: 'CLOSED', closingAt: new Date(Date.now() + 5 * H) });
      const cancelled = await tender({ title: 'Cancelled', lifecycle: 'CANCELLED', status: 'CANCELLED', closingAt: new Date(Date.now() + 5 * H) });
      const gone = await tender({ title: 'Deleted', deletedAt: new Date(), closingAt: new Date(Date.now() + 5 * H) });
      const undated = await tender({ title: 'No deadline' });
      const past = await tender({ title: 'Past', closingAt: new Date(Date.now() - H) });
      for (const u of [w, wide, narrow]) for (const t of [soon, far, closed, cancelled, gone, undated, past]) await prisma.watchlistItem.create({ data: { userId: u.id, tenderId: t.id } });

      const first = await sweep.handle();
      expect(first).toMatchObject({ created: 2 });
      const rows = await prisma.notification.findMany({ orderBy: { createdAt: 'asc' } });
      expect(rows.map((r) => `${r.userId === w.id ? 'default' : 'wide'}:${r.entityId === soon.id ? 'soon' : 'other'}:${(r.metadata as { offsetHours: number }).offsetHours}`).sort()).toEqual(['default:soon:24', 'wide:soon:24']);
      expect(rows.every((r) => r.type === 'TENDER_DEADLINE' && r.priority === 'HIGH' && r.expiresAt !== null)).toBe(true);
      expect(await prisma.notification.count({ where: { userId: narrow.id } })).toBe(0); // 3h offset not reached yet

      expect(await sweep.handle()).toMatchObject({ created: 0 });
      expect(await prisma.notification.count()).toBe(2);
    });

    it('a changed deadline legitimately produces a new reminder; the old key stays deduplicated', async () => {
      const w = await user('dlchg');
      const t = await tender({ title: 'Moving deadline', closingAt: new Date(Date.now() + 20 * H) });
      await prisma.watchlistItem.create({ data: { userId: w.id, tenderId: t.id } });
      await sweep.handle();
      await sweep.handle();
      expect(await prisma.notification.count()).toBe(1);
      await prisma.tender.update({ where: { id: t.id }, data: { closingAt: new Date(Date.now() + 10 * H) } });
      await sweep.handle();
      expect(await prisma.notification.count()).toBe(2);
    });

    it('respects the deadline-reminder preference (in-app and email) and an empty offset list', async () => {
      const off = await user('dloff');
      const none = await user('dlnone');
      await prisma.notificationPreference.createMany({ data: [{ userId: off.id, category: 'DEADLINE_REMINDERS', channel: 'IN_APP', enabled: false }, { userId: off.id, category: 'DEADLINE_REMINDERS', channel: 'EMAIL', enabled: false }] });
      await prisma.notificationSettings.create({ data: { userId: none.id, deadlineOffsetsHours: [] } });
      const t = await tender({ title: 'Pref tender', closingAt: new Date(Date.now() + 5 * H) });
      await prisma.watchlistItem.createMany({ data: [{ userId: off.id, tenderId: t.id }, { userId: none.id, tenderId: t.id }] });
      expect(await sweep.handle()).toMatchObject({ created: 0, suppressed: 1 });
      expect(await prisma.notification.count()).toBe(0);
    });

    it('re-queues an email whose queue message was lost (self-heal), idempotently', async () => {
      const w = await user('heal');
      const t = await tender({ title: 'Heal me', closingAt: new Date(Date.now() + 5 * H) });
      await prisma.watchlistItem.create({ data: { userId: w.id, tenderId: t.id } });
      queue.failNext = true;
      await expect(sweep.handle()).rejects.toThrow('redis unavailable');
      const d = await prisma.notificationDelivery.findFirstOrThrow();
      expect(d.status).toBe('QUEUED');
      expect(queue.jobs).toHaveLength(0);
      await prisma.notificationDelivery.update({ where: { id: d.id }, data: { queuedAt: new Date(Date.now() - 30 * 60_000) } });
      expect(await sweep.handle()).toMatchObject({ requeued: 1 });
      expect(queue.jobs.filter((j) => j.name === 'notification.email')).toHaveLength(1);
      await sweep.handle();
      expect(queue.jobs.filter((j) => j.name === 'notification.email')).toHaveLength(1);
      await drainEmails();
      expect(transport.sent).toHaveLength(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  describe('preferences', () => {
    async function watcherOf(t: { id: string }, name: string) {
      const u = await user(name);
      await prisma.watchlistItem.create({ data: { userId: u.id, tenderId: t.id } });
      return u;
    }
    const upd = (id: string) => (t: string) => event('tender.updated', 'tender', id, { tenderId: id, changedFields: ['estimatedValue'] }).then(() => t);

    it('email off keeps the in-app record and records why no email was sent; both off creates nothing; in-app off stores it as read', async () => {
      const t = await tender({ title: 'Pref matrix', estimatedValue: '10.00' });
      const emailOff = await watcherOf(t, 'p1');
      const bothOff = await watcherOf(t, 'p2');
      const inAppOff = await watcherOf(t, 'p3');
      await prisma.notificationPreference.createMany({
        data: [
          { userId: emailOff.id, category: 'SAVED_TENDER_UPDATES', channel: 'EMAIL', enabled: false },
          { userId: bothOff.id, category: 'SAVED_TENDER_UPDATES', channel: 'EMAIL', enabled: false },
          { userId: bothOff.id, category: 'SAVED_TENDER_UPDATES', channel: 'IN_APP', enabled: false },
          { userId: inAppOff.id, category: 'SAVED_TENDER_UPDATES', channel: 'IN_APP', enabled: false },
        ],
      });
      void upd;
      const s = await processor.process(await event('tender.updated', 'tender', t.id, { tenderId: t.id, changedFields: ['estimatedValue'] }));
      expect(s).toMatchObject({ recipients: 3, created: 2, suppressed: 1, emailQueued: 1, skipped: 1 });
      expect(await prisma.notification.count({ where: { userId: bothOff.id } })).toBe(0);
      expect((await prisma.notification.findFirstOrThrow({ where: { userId: emailOff.id } })).isRead).toBe(false);
      expect(await prisma.notificationDelivery.findFirstOrThrow({ where: { userId: emailOff.id } })).toMatchObject({ status: 'SKIPPED', skipReason: 'PREFERENCE_DISABLED' });
      const quiet = await prisma.notification.findFirstOrThrow({ where: { userId: inAppOff.id } });
      expect(quiet.isRead).toBe(true);
      expect(await notifications.unreadCount(inAppOff.id)).toBe(0);
    });

    it('an unverified address is never emailed', async () => {
      const u = await user('unv', { verified: false });
      const t = await tender({ title: 'Unverified' });
      await prisma.watchlistItem.create({ data: { userId: u.id, tenderId: t.id } });
      await processor.process(await event('tender.updated', 'tender', t.id, { tenderId: t.id, changedFields: ['title'] }));
      expect(await prisma.notificationDelivery.findFirstOrThrow()).toMatchObject({ status: 'SKIPPED', skipReason: 'RECIPIENT_UNAVAILABLE' });
      expect(await prisma.notification.count()).toBe(1);
      expect(queue.jobs).toHaveLength(0);
    });

    it('the preferences API returns documented defaults, persists changes, locks security, and validates', async () => {
      const u = await user('prefs');
      const def = (await get('/notifications/preferences', u.token).expect(200)).body.data as { categories: Record<string, { inApp: boolean; email: boolean; locked: boolean }>; deadlineOffsetsHours: number[]; quietHours: { enabled: boolean } };
      expect(def.categories.CORRIGENDA).toEqual({ inApp: true, email: true, locked: false });
      expect(def.categories.SYSTEM).toEqual({ inApp: true, email: true, locked: true });
      expect(def.deadlineOffsetsHours).toEqual([24]);
      expect(def.quietHours.enabled).toBe(false);

      const res = await patch('/notifications/preferences', u.token, { categories: { CORRIGENDA: { email: false }, DEADLINE_REMINDERS: { inApp: false } }, deadlineOffsetsHours: [72, 3], quietHours: { enabled: true, start: '22:00', end: '07:00', timezone: 'Asia/Kolkata' } }).expect(200);
      expect(res.body.data.categories.CORRIGENDA).toMatchObject({ inApp: true, email: false });
      const reread = (await get('/notifications/preferences', u.token).expect(200)).body.data;
      expect(reread.categories.DEADLINE_REMINDERS).toMatchObject({ inApp: false, email: true });
      expect(reread.deadlineOffsetsHours).toEqual([3, 72]);
      expect(reread.quietHours).toMatchObject({ enabled: true, start: '22:00', end: '07:00' });

      await patch('/notifications/preferences', u.token, { categories: { SYSTEM: { email: false } } }).expect(400);
      await patch('/notifications/preferences', u.token, { categories: { SYSTEM: { inApp: false } } }).expect(400);
      await patch('/notifications/preferences', u.token, { categories: { MARKETING: { email: true } } }).expect(400);
      await patch('/notifications/preferences', u.token, { deadlineOffsetsHours: [5] }).expect(400);
      await patch('/notifications/preferences', u.token, { quietHours: { enabled: true, start: '25:00', end: '07:00' } }).expect(400);
      await patch('/notifications/preferences', u.token, { quietHours: { enabled: true, start: '22:00', end: '07:00', timezone: 'Mars/Base' } }).expect(400);
      await patch('/notifications/preferences', u.token, { userId: 'someone-else' }).expect(400);
      expect(await prisma.auditLog.count({ where: { action: 'NOTIFICATION_PREFERENCES_UPDATED', actorUserId: u.id } })).toBe(1);
    });

    it('preferences are per user: one user changing theirs does not affect another', async () => {
      const a = await user('pa');
      const b = await user('pb');
      await patch('/notifications/preferences', a.token, { categories: { CORRIGENDA: { email: false } } }).expect(200);
      expect((await get('/notifications/preferences', b.token).expect(200)).body.data.categories.CORRIGENDA.email).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  describe('spam safeguards: caps, daily digest, quiet hours', () => {
    it('caps immediate emails per saved search per hour (2 here) and folds the overflow into a single digest', async () => {
      const u = await user('cap');
      await savedSearch(u, { q: 'pipeline' }, 'IMMEDIATE', 'Pipelines');
      const outcomes: string[] = [];
      for (let i = 0; i < 4; i++) {
        const t = await tender({ title: `Pipeline works ${i}` });
        const s = await processor.process(await created(t.id));
        outcomes.push(s.emailQueued ? 'email' : s.digestPending ? 'digest' : 'other');
      }
      expect(outcomes).toEqual(['email', 'email', 'digest', 'digest']);
      expect(await prisma.notification.count()).toBe(4); // in-app is never dropped below its own (higher) cap
      expect(queue.jobs.filter((j) => j.name === 'notification.email')).toHaveLength(2);

      await drainEmails();
      expect(transport.sent).toHaveLength(2);
      expect(await digest.handle()).toMatchObject({ digests: 1, items: 2 });
      await drainEmails();
      expect(transport.sent).toHaveLength(3);
      const mail = transport.sent[2];
      expect(mail.subject).toContain('daily tender digest: 2 new matches');
      expect(mail.text).toContain('Pipeline works');
      expect(await digest.handle()).toMatchObject({ digests: 0 });
      expect(await prisma.notificationDelivery.count({ where: { status: 'DIGESTED' } })).toBe(2);
    });

    it('applies an in-app cap per search per hour (4 here), suppressing and logging the excess', async () => {
      const u = await user('inapp');
      await savedSearch(u, { q: 'flood' }, 'DAILY');
      let suppressed = 0;
      for (let i = 0; i < 6; i++) {
        const t = await tender({ title: `Flood barrier ${i}` });
        suppressed += (await processor.process(await created(t.id))).suppressed;
      }
      expect(await prisma.notification.count()).toBe(4);
      expect(suppressed).toBe(2);
    });

    it('DAILY-frequency searches never email per tender: everything waits for the digest', async () => {
      const u = await user('daily');
      await savedSearch(u, { q: 'drain' }, 'DAILY');
      for (let i = 0; i < 3; i++) await processor.process(await created((await tender({ title: `Drain cleaning ${i}` })).id));
      expect(queue.jobs).toHaveLength(0);
      expect(await prisma.notificationDelivery.count({ where: { status: 'DIGEST_PENDING' } })).toBe(3);
      expect(await digest.handle()).toMatchObject({ digests: 1, items: 3 });
    });

    it('holds non-critical email inside quiet hours, but security mail bypasses them', async () => {
      const u = await user('quiet');
      const now = new Date();
      const startHour = String((now.getUTCHours() + 24 - 1) % 24).padStart(2, '0');
      const endHour = String((now.getUTCHours() + 1) % 24).padStart(2, '0');
      await prisma.notificationSettings.create({ data: { userId: u.id, quietHoursEnabled: true, quietStart: `${startHour}:00`, quietEnd: `${endHour}:00`, timezone: 'UTC' } });
      const t = await tender({ title: 'Quiet tender', estimatedValue: '5.00' });
      await prisma.watchlistItem.create({ data: { userId: u.id, tenderId: t.id } });
      await processor.process(await event('tender.updated', 'tender', t.id, { tenderId: t.id, changedFields: ['estimatedValue'] }));
      const held = queue.jobs.find((j) => j.name === 'notification.email')!;
      expect(held.delay).toBeGreaterThan(0);
      expect(held.delay).toBeLessThanOrEqual(2 * H);

      queue.jobs = [];
      await processor.process(await event('user.security_event', 'user', u.id, { userId: u.id, kind: 'PASSWORD_CHANGED' }));
      const urgent = queue.jobs.find((j) => j.name === 'notification.email')!;
      expect(urgent.delay).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  describe('system & security notifications', () => {
    it('password events create a critical, non-disableable notification and email; email verification is in-app only', async () => {
      const u = await user('sec');
      await prisma.notificationPreference.createMany({ data: [{ userId: u.id, category: 'SYSTEM', channel: 'EMAIL', enabled: false }, { userId: u.id, category: 'SYSTEM', channel: 'IN_APP', enabled: false }] });
      await processor.process(await event('user.security_event', 'user', u.id, { userId: u.id, kind: 'PASSWORD_CHANGED' }));
      const n = await prisma.notification.findFirstOrThrow({ where: { userId: u.id, type: 'SECURITY' } });
      expect(n).toMatchObject({ priority: 'CRITICAL', isRead: false, title: 'Your password was changed' });
      const [res] = await drainEmails();
      expect(res.error).toBeUndefined();
      const mail = transport.sent[0];
      expect(mail.to).toBe(u.email);
      expect(mail.text).toContain('cannot be turned off');
      expect(mail.text).not.toContain('/tenders/');

      await processor.process(await event('user.security_event', 'user', u.id, { userId: u.id, kind: 'EMAIL_VERIFIED' }));
      expect((await prisma.notification.findFirstOrThrow({ where: { userId: u.id, type: 'ACCOUNT' } })).priority).toBe('NORMAL');
      expect(queue.jobs.filter((j) => j.name === 'notification.email')).toHaveLength(0);
    });

    it('changing a password through the API emits the event, and processing it yields the notification', async () => {
      const u = await user('apichange');
      await request(api.getHttpServer()).post('/api/v1/auth/change-password').set(auth(u.token)).send({ currentPassword: 'correct-horse-battery', newPassword: 'another-correct-horse-9' }).expect((r) => expect(r.status).toBeLessThan(300));
      const ev = await prisma.outboxEvent.findFirstOrThrow({ where: { eventType: 'user.security_event' } });
      expect(ev.payload).toEqual({ userId: u.id, kind: 'PASSWORD_CHANGED' });
      expect(JSON.stringify(ev.payload)).not.toMatch(/password"?:/i);
      await processor.process(ev.id);
      expect(await prisma.notification.count({ where: { userId: u.id, type: 'SECURITY' } })).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  describe('email delivery: status, retry and failure handling', () => {
    async function queuedDelivery() {
      const w = await user(`mail${++seq}`);
      const t = await tender({ title: `Mail tender ${seq}` });
      await prisma.watchlistItem.create({ data: { userId: w.id, tenderId: t.id } });
      await processor.process(await event('tender.updated', 'tender', t.id, { tenderId: t.id, changedFields: ['title'] }));
      return { w, t, delivery: await prisma.notificationDelivery.findFirstOrThrow({ where: { userId: w.id } }) };
    }

    it('transient provider errors retry (RETRYING, attempts counted) and then succeed', async () => {
      const { delivery: d } = await queuedDelivery();
      transport.failures.push(() => new Error('ETIMEDOUT connecting to smtp'));
      await expect(emailHandler.handle({ deliveryId: d.id }, ctxOf(1))).rejects.toThrow('ETIMEDOUT');
      expect(await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: d.id } })).toMatchObject({ status: 'RETRYING', attempts: 1 });
      await emailHandler.handle({ deliveryId: d.id }, ctxOf(2));
      expect(await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: d.id } })).toMatchObject({ status: 'SENT', attempts: 2, provider: 'memory', lastError: null });
      expect(transport.sent).toHaveLength(1);
    });

    it('exhausted retries end in FAILED with a sanitized reason (no address), and the job is not silently lost', async () => {
      const { delivery: d, w } = await queuedDelivery();
      transport.failures.push(() => new Error(`connection reset for ${w.email}`));
      await expect(emailHandler.handle({ deliveryId: d.id }, ctxOf(6, true))).rejects.toThrow();
      const row = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: d.id } });
      expect(row.status).toBe('FAILED');
      expect(row.failedAt).not.toBeNull();
      expect(row.lastError).toContain('RETRIES_EXHAUSTED');
      expect(row.lastError).not.toContain(w.email);
    });

    it('permanent errors fail immediately without retrying', async () => {
      const { delivery: d } = await queuedDelivery();
      transport.failures.push(() => new PermanentEmailError('550 mailbox unavailable', 'INVALID_RECIPIENT'));
      await expect(emailHandler.handle({ deliveryId: d.id }, ctxOf(1))).rejects.toBeInstanceOf(PermanentJobError);
      expect(await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: d.id } })).toMatchObject({ status: 'FAILED', attempts: 1 });
      expect((await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: d.id } })).lastError).toContain('PERMANENT');
    });

    it('an already-sent delivery is never sent twice (retry after an unacknowledged success)', async () => {
      const { delivery: d } = await queuedDelivery();
      await emailHandler.handle({ deliveryId: d.id }, ctxOf(1));
      expect(await emailHandler.handle({ deliveryId: d.id }, ctxOf(2))).toEqual({ status: 'already-sent' });
      expect(transport.sent).toHaveLength(1);
    });

    it('a recipient who became unavailable is skipped, and unknown deliveries / templates are permanent errors', async () => {
      const { delivery: d, w } = await queuedDelivery();
      await prisma.user.update({ where: { id: w.id }, data: { status: 'SUSPENDED' } });
      expect(await emailHandler.handle({ deliveryId: d.id }, ctxOf(1))).toMatchObject({ status: 'skipped' });
      expect(await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: d.id } })).toMatchObject({ status: 'SKIPPED', skipReason: 'RECIPIENT_UNAVAILABLE' });
      await expect(emailHandler.handle({ deliveryId: randomUUID() }, ctxOf(1))).rejects.toBeInstanceOf(PermanentJobError);
      const { delivery: d2 } = await queuedDelivery();
      await prisma.notificationDelivery.update({ where: { id: d2.id }, data: { templateKey: 'nonexistent' } });
      await expect(emailHandler.handle({ deliveryId: d2.id }, ctxOf(1))).rejects.toBeInstanceOf(PermanentJobError);
      expect((await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: d2.id } })).status).toBe('FAILED');
    });

    it('the dev "sent" state is honest: the delivery records the provider that accepted it', async () => {
      const { delivery: d } = await queuedDelivery();
      await emailHandler.handle({ deliveryId: d.id }, ctxOf(1));
      const row = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: d.id } });
      expect(row.provider).toBe('memory');
      expect(row.providerMessageId).toBe('mem-1');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  describe('malformed and unusual events', () => {
    it('unknown event, unsupported type and malformed payloads are permanent errors; duplicates/expired/missing data are safe', async () => {
      await expect(processor.process(randomUUID())).rejects.toBeInstanceOf(PermanentJobError);
      await expect(processor.process(await event('mystery.event', 'x', 'y', {}))).rejects.toBeInstanceOf(PermanentJobError);
      await expect(processor.process(await event('tender.created', 'tender', 'x', { tenderId: 'not-a-uuid' }))).rejects.toBeInstanceOf(PermanentJobError);
      expect(await processor.process(await event('tender.created', 'tender', randomUUID(), { tenderId: randomUUID(), sourceId: null }))).toMatchObject({ skippedReason: 'TENDER_UNAVAILABLE' });
      expect(await processor.process(await event('tender.source_linked', 'tender', randomUUID(), { tenderId: randomUUID(), sourceId: randomUUID(), outcome: 'exact' }))).toMatchObject({ created: 0 });
      const ghost = randomUUID();
      const t = await tender({ title: 'Corrigendum ghost' });
      await expect(processor.process(await event('tender.corrigendum_created', 'tender', t.id, { tenderId: t.id, corrigendumId: ghost }))).rejects.toBeInstanceOf(PermanentJobError);
      expect(await processor.process(await event('user.security_event', 'user', randomUUID(), { userId: randomUUID(), kind: 'PASSWORD_CHANGED' }))).toMatchObject({ created: 0, skipped: 1 });
    });

    it('a notification for a user with no watchers or searches is a quiet no-op', async () => {
      const t = await tender({ title: 'Nobody cares' });
      expect(await processor.process(await created(t.id))).toMatchObject({ recipients: 0, created: 0 });
      expect(await prisma.notification.count()).toBe(0);
    });

    it('a queue outage surfaces to the caller (so the dispatch job retries) and the record is not duplicated on retry', async () => {
      const u = await user('outage');
      await savedSearch(u, { q: 'outage' });
      const t = await tender({ title: 'Outage tender' });
      const ev = await created(t.id);
      queue.failNext = true;
      await expect(processor.process(ev)).rejects.toThrow('redis unavailable');
      expect(await prisma.notification.count()).toBe(1);
      expect(await processor.process(ev)).toMatchObject({ created: 0, duplicates: 1 });
      expect(await prisma.notification.count()).toBe(1);
    });

    it('delivery service is directly idempotent for the same plan', async () => {
      const u = await user('direct');
      const plan = { userId: u.id, type: 'ACCOUNT' as const, title: 'Hello', message: 'World', metadata: {}, dedupKey: 'direct:1' };
      const prefs = { inApp: { SYSTEM: true } as never, email: { SYSTEM: true } as never, deadlineOffsetsHours: [24], quiet: { enabled: false, start: null, end: null, timezone: 'UTC' } };
      const recipient = { userId: u.id, email: u.email, emailable: true };
      expect((await delivery.deliver(plan, prefs, recipient)).result).toBe('created');
      expect((await delivery.deliver(plan, prefs, recipient)).result).toBe('duplicate');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  describe('notification API: list, read state, isolation, expiry, deep links', () => {
    async function seed(userId: string, n: number, over: Partial<{ type: 'TENDER_UPDATED' | 'ACCOUNT'; entityId: string; expiresAt: Date }> = {}) {
      const ids: string[] = [];
      for (let i = 0; i < n; i++) {
        const r = await notifications.createIfNew({ userId, type: over.type ?? 'ACCOUNT', title: `N${i}`, message: `m${i}`, dedupKey: `seed:${randomUUID()}`, entityId: over.entityId, expiresAt: over.expiresAt });
        ids.push(r!.id);
      }
      return ids;
    }

    it('lists newest first with pagination, unread count, type and unread filters', async () => {
      const u = await user('list');
      const t = await tender({ title: 'Linked tender' });
      const ids = await seed(u.id, 5);
      await seed(u.id, 2, { type: 'TENDER_UPDATED', entityId: t.id });
      await notifications.setRead(u.id, ids[0], true);

      const p1 = (await get('/notifications?pageSize=3', u.token).expect(200)).body;
      expect(p1.data).toHaveLength(3);
      expect(p1.meta).toMatchObject({ unreadCount: 6, pagination: { page: 1, pageSize: 3, total: 7, totalPages: 3 } });
      const p3 = (await get('/notifications?pageSize=3&page=3', u.token).expect(200)).body;
      expect(p3.data).toHaveLength(1);
      const allIds = [...p1.data, ...(await get('/notifications?pageSize=3&page=2', u.token)).body.data, ...p3.data].map((n: { id: string }) => n.id);
      expect(new Set(allIds).size).toBe(7);

      expect((await get('/notifications?type=TENDER_UPDATED', u.token).expect(200)).body.data).toHaveLength(2);
      expect((await get('/notifications?unread=true', u.token).expect(200)).body.data).toHaveLength(6);
      await get('/notifications?type=BOGUS', u.token).expect(400);
      await get('/notifications?pageSize=1000', u.token).expect(400);
      const first = p1.data[0] as Record<string, unknown>;
      expect(Object.keys(first).sort()).toEqual(['createdAt', 'entityAvailable', 'entityId', 'entityType', 'expiresAt', 'id', 'isRead', 'message', 'metadata', 'priority', 'readAt', 'title', 'type']);
      expect((await get('/notifications/unread-count', u.token).expect(200)).body.data).toEqual({ unreadCount: 6 });
    });

    it('marks read, unread and all-read; only for the owner', async () => {
      const a = await user('ra');
      const b = await user('rb');
      const [id] = await seed(a.id, 3);
      await seed(b.id, 1);
      await patch(`/notifications/${id}/read`, b.token).expect(404);
      expect((await get('/notifications/unread-count', a.token)).body.data.unreadCount).toBe(3);
      await patch(`/notifications/${id}/read`, a.token).expect(200);
      expect((await get('/notifications/unread-count', a.token)).body.data.unreadCount).toBe(2);
      await patch(`/notifications/${id}/unread`, a.token).expect(200);
      expect((await get('/notifications/unread-count', a.token)).body.data.unreadCount).toBe(3);
      await patch(`/notifications/${randomUUID()}/read`, a.token).expect(404);
      await patch('/notifications/not-a-uuid/read', a.token).expect(400);
      expect((await patch('/notifications/read-all', a.token).expect(200)).body.data).toEqual({ updated: 3 });
      expect((await get('/notifications/unread-count', a.token)).body.data.unreadCount).toBe(0);
      expect((await get('/notifications/unread-count', b.token)).body.data.unreadCount).toBe(1); // untouched
    });

    it('never exposes another user’s notifications, whatever parameters are sent', async () => {
      const a = await user('iso-a');
      const b = await user('iso-b');
      await seed(a.id, 2);
      expect((await get('/notifications', b.token).expect(200)).body.data).toEqual([]);
      // identity is never a parameter: unknown query params are rejected outright, so they cannot widen access
      for (const qs of [`?userId=${a.id}`, `?user_id=${a.id}`, `?organizationId=${a.organizationId}`]) await get(`/notifications${qs}`, b.token).expect(400);
      await request(api.getHttpServer()).get('/api/v1/notifications').expect(401);
      await request(api.getHttpServer()).get('/api/v1/notifications/preferences').expect(401);
    });

    it('hides expired notifications from the list and the unread count, but keeps the record', async () => {
      const u = await user('exp');
      await seed(u.id, 1, { expiresAt: new Date(Date.now() - 1000) });
      await seed(u.id, 1, { expiresAt: new Date(Date.now() + H) });
      await seed(u.id, 1);
      expect((await get('/notifications', u.token)).body.data).toHaveLength(2);
      expect((await get('/notifications/unread-count', u.token)).body.data.unreadCount).toBe(2);
      expect(await prisma.notification.count({ where: { userId: u.id } })).toBe(3);
    });

    it('flags whether the linked tender still exists so the UI never renders a dead link', async () => {
      const u = await user('link');
      const live = await tender({ title: 'Live' });
      const dead = await tender({ title: 'Dead' });
      await seed(u.id, 1, { type: 'TENDER_UPDATED', entityId: live.id });
      await seed(u.id, 1, { type: 'TENDER_UPDATED', entityId: dead.id });
      await prisma.tender.update({ where: { id: dead.id }, data: { deletedAt: new Date() } });
      const data = (await get('/notifications', u.token)).body.data as { entityId: string; entityAvailable: boolean }[];
      expect(data.find((n) => n.entityId === live.id)?.entityAvailable).toBe(true);
      expect(data.find((n) => n.entityId === dead.id)?.entityAvailable).toBe(false);
    });

    it('saved-search alert frequency is opt-in (default OFF), settable on create and update, and validated', async () => {
      const u = await user('freq');
      const mk = (body: object) => request(api.getHttpServer()).post('/api/v1/saved-searches').set(auth(u.token)).send({ name: 'S', criteria: { q: 'road' }, ...body });
      const off = (await mk({}).expect(201)).body.data;
      expect(off.alertFrequency).toBe('OFF');
      const imm = (await mk({ alertFrequency: 'IMMEDIATE' }).expect(201)).body.data;
      expect(imm.alertFrequency).toBe('IMMEDIATE');
      await mk({ alertFrequency: 'HOURLY' }).expect(400);
      const upd = await request(api.getHttpServer()).patch(`/api/v1/saved-searches/${off.id}`).set(auth(u.token)).send({ alertFrequency: 'DAILY' }).expect(200);
      expect(upd.body.data.alertFrequency).toBe('DAILY');
      await request(api.getHttpServer()).patch(`/api/v1/saved-searches/${off.id}`).set(auth(u.token)).send({ alertFrequency: 'NOPE' }).expect(400);
    });

    it('a saved search from another organization cannot be altered by someone else', async () => {
      const a = await user('org-a');
      const b = await user('org-b');
      const ss = await savedSearch(a, { q: 'x' }, 'OFF');
      await request(api.getHttpServer()).patch(`/api/v1/saved-searches/${ss.id}`).set(auth(b.token)).send({ alertFrequency: 'IMMEDIATE' }).expect(404);
      expect((await prisma.savedSearch.findUniqueOrThrow({ where: { id: ss.id } })).alertFrequency).toBe('OFF');
    });
  });
});
