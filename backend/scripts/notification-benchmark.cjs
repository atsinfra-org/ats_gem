/* Notification pipeline benchmark. Only runs against a database whose name contains "bench" (synthetic data). */
const { Test } = require('@nestjs/testing');
const { randomUUID } = require('node:crypto');
const { AppConfigModule } = require('../dist/config/config.module');
const { DatabaseModule } = require('../dist/database/database.module');
const { QueuesModule } = require('../dist/queues/queues.module');
const { AuditModule } = require('../dist/audit/audit.module');
const { OutboxModule } = require('../dist/outbox/outbox.module');
const { NotificationsWorkerModule } = require('../dist/notifications/notifications.module');
const { EmailTransport } = require('../dist/email/email-transport');
const { QueueProducer } = require('../dist/queues/queue.producer');
const { PrismaService } = require('../dist/database/prisma.service');
const { SavedSearchMatcherService } = require('../dist/notifications/saved-search-matcher.service');
const { NotificationEventProcessor } = require('../dist/notifications/notification-event-processor.service');
const { NotificationEmailHandler } = require('../dist/notifications/notification-email.handler');

if (!/bench/i.test(new URL(process.env.DATABASE_URL).pathname)) {
  console.error('Refusing to run: DATABASE_URL must point at a *bench* database.');
  process.exit(2);
}

const pct = (a, p) => a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))];
const stats = (times) => {
  const s = [...times].sort((a, b) => a - b);
  return { p50: +pct(s, 50).toFixed(1), p95: +pct(s, 95).toFixed(1), max: +s[s.length - 1].toFixed(1) };
};

const WORDS = ['road', 'bridge', 'solar', 'water', 'pipeline', 'hospital', 'school', 'drainage', 'canal', 'highway', 'software', 'vehicle', 'furniture', 'survey', 'laboratory'];
const STATES = ['MH', 'UP', 'DL', 'KA', 'TN', 'GJ', 'RJ', 'WB', 'AS', 'KL'];

(async () => {
  const jobs = [];
  const sent = [];
  const moduleRef = await Test.createTestingModule({ imports: [AppConfigModule, DatabaseModule, QueuesModule, AuditModule, OutboxModule, NotificationsWorkerModule] })
    .overrideProvider(EmailTransport)
    .useValue({ driver: 'memory', send: async (m) => (sent.push(m), { messageId: String(sent.length) }) })
    .overrideProvider(QueueProducer)
    .useValue({ enqueue: async (name, payload, opts) => (jobs.push({ name, payload, opts }), { id: opts?.jobId ?? '' }) })
    .compile();
  await moduleRef.init();
  const prisma = moduleRef.get(PrismaService);
  const matcher = moduleRef.get(SavedSearchMatcherService);
  const processor = moduleRef.get(NotificationEventProcessor);
  const emailHandler = moduleRef.get(NotificationEmailHandler);

  await prisma.$executeRawUnsafe('TRUNCATE TABLE notification_deliveries, notifications, saved_searches, organization_members, organizations, users, outbox_events CASCADE');
  const source = (await prisma.tenderSource.findFirst()) ?? (await prisma.tenderSource.create({ data: { name: 'Bench', slug: 'bench-notify', sourceType: 'MOCK', adapterKey: 'mock', crawlConfig: {} } }));
  const tenderCount = await prisma.tender.count();
  console.log(JSON.stringify({ dataset: 'synthetic', tendersInDb: tenderCount }));

  const USERS = 5000;
  // Users + orgs + memberships in bulk (verified, active).
  await prisma.$executeRawUnsafe(`
    INSERT INTO users (id, email, name, password_hash, is_email_verified, status, updated_at)
    SELECT gen_random_uuid(), 'bench-user-' || g || '@example.test', 'Bench ' || g, 'x', true, 'ACTIVE', now() FROM generate_series(1, ${USERS}) g`);
  await prisma.$executeRawUnsafe(`INSERT INTO organizations (id, name, slug, updated_at) SELECT gen_random_uuid(), 'Bench Org ' || g, 'bench-org-' || g, now() FROM generate_series(1, ${USERS}) g`);
  await prisma.$executeRawUnsafe(`
    INSERT INTO organization_members (organization_id, user_id, role)
    SELECT o.id, u.id, 'OWNER' FROM (SELECT id, row_number() OVER (ORDER BY slug) rn FROM organizations) o
    JOIN (SELECT id, row_number() OVER (ORDER BY email) rn FROM users) u ON u.rn = o.rn`);
  const pairs = await prisma.$queryRawUnsafe(`SELECT u.id::text AS uid, o.id::text AS oid FROM (SELECT id, row_number() OVER (ORDER BY email) rn FROM users) u JOIN (SELECT id, row_number() OVER (ORDER BY slug) rn FROM organizations) o ON o.rn = u.rn`);

  const insertSearches = async (n, criteriaFor) => {
    await prisma.$executeRawUnsafe('DELETE FROM saved_searches');
    const rows = [];
    for (let i = 0; i < n; i++) {
      const p = pairs[i % pairs.length];
      rows.push({ organizationId: p.oid, createdBy: p.uid, name: `Bench search ${i}`, criteria: criteriaFor(i), alertFrequency: 'IMMEDIATE' });
    }
    await prisma.savedSearch.createMany({ data: rows });
  };
  const distinct = (i) => ({ q: WORDS[i % WORDS.length], state: STATES[(i * 7) % STATES.length], minValue: String(1000 * (i % 500)) });
  const grouped = (i) => ({ q: WORDS[i % 5], state: STATES[i % 3] }); // only 15 distinct criteria sets
  const matchAll = () => ({});

  const mkTender = async (title, over = {}) =>
    prisma.tender.create({ data: { title, publishedAt: new Date('2026-01-02T00:00:00Z'), currency: 'INR', status: 'OPEN', statusComputedAt: new Date(), lastSyncedAt: new Date(), lifecycle: 'ACTIVE', stateCode: 'MH', estimatedValue: '900000.00', ...over } });

  const results = { matching: [], processing: [], email: null, dedup: null };
  const probe = await mkTender('Road bridge water works benchmark tender', { stateCode: 'MH' });

  for (const [label, n, fn] of [['1 search', 1, distinct], ['100 distinct', 100, distinct], ['1,000 distinct', 1000, distinct], ['5,000 distinct', 5000, distinct], ['5,000 with 15 distinct criteria (grouped)', 5000, grouped]]) {
    await insertSearches(n, fn);
    await matcher.match(probe.id);
    const times = [];
    let matched = 0;
    for (let i = 0; i < 15; i++) {
      const t0 = process.hrtime.bigint();
      matched = (await matcher.match(probe.id)).length;
      times.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    results.matching.push({ savedSearches: label, matched, ...stats(times) });
  }

  // Full event processing: tender.created with M matching users (all criteria match) - notification creation + email queue.
  for (const m of [100, 1000, 5000]) {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE notification_deliveries, notifications CASCADE');
    jobs.length = 0;
    await insertSearches(m, matchAll);
    const t = await mkTender(`Everyone matches ${m}`);
    const ev = (await prisma.outboxEvent.create({ data: { eventType: 'tender.created', aggregateType: 'tender', aggregateId: t.id, payload: { tenderId: t.id, sourceId: null } } })).id;
    const t0 = process.hrtime.bigint();
    const summary = await processor.process(ev);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const created = await prisma.notification.count();
    // replay = duplicate storm
    const t1 = process.hrtime.bigint();
    const replay = await processor.process(ev);
    const replayMs = Number(process.hrtime.bigint() - t1) / 1e6;
    results.processing.push({
      matchingUsers: m,
      firstRunMs: +ms.toFixed(0),
      notificationsPerSec: Math.round((created * 1000) / ms),
      emailsQueued: summary.emailQueued,
      digestPending: summary.digestPending,
      inAppRows: created,
      replayMs: +replayMs.toFixed(0),
      replayDuplicates: replay.duplicates,
      replayCreated: replay.created,
      duplicateRate: +((await prisma.notification.count()) / created).toFixed(3),
    });
  }

  // Email worker throughput over the queued deliveries from the last run.
  const queued = jobs.filter((j) => j.name === 'notification.email');
  const t0 = process.hrtime.bigint();
  let ok = 0;
  for (const j of queued) {
    await emailHandler.handle(j.payload, { attempt: 1, isFinalAttempt: false });
    ok++;
  }
  const emailMs = Number(process.hrtime.bigint() - t0) / 1e6;
  results.email = { emailJobs: queued.length, sent: sent.length, ms: +emailMs.toFixed(0), perSec: Math.round((ok * 1000) / emailMs) };

  console.log(JSON.stringify(results, null, 1));
  await moduleRef.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
