import { Test } from '@nestjs/testing';
import { ApiModule } from '../src/api.module';
import { AppConfigModule } from '../src/config/config.module';
import { DatabaseModule } from '../src/database/database.module';
import { AppConfig } from '../src/config/app-config.service';
import { PrismaService } from '../src/database/prisma.service';
import { SearchEventsPurgeHandler } from '../src/search/search-events-purge.handler';
import { SearchEventsPurgeService } from '../src/search/search-events-purge.service';
import { SeedService } from '../src/database/seed.service';
import { ScheduleCatalog } from '../src/scheduler/schedule-catalog.service';
import { resetDatabase } from './support/database';

const DAY = 86_400_000;

describe('Search event retention (e2e, PostgreSQL)', () => {
  let prisma: PrismaService;
  let config: AppConfig;
  let close: () => Promise<void>;
  const NOW = new Date('2026-09-26T12:00:00.000Z');
  const ago = (ms: number) => new Date(NOW.getTime() - ms);

  const event = (label: string, createdAt: Date, extra: { userId?: string; organizationId?: string } = {}) =>
    prisma.searchEvent.create({ data: { eventType: 'SEARCH_SUBMITTED', queryNormalized: label, createdAt, ...extra } });
  const labels = async () => (await prisma.searchEvent.findMany({ orderBy: { queryNormalized: 'asc' } })).map((e) => e.queryNormalized);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ApiModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    config = app.get(AppConfig);
    close = () => app.close();
  });
  afterAll(() => close?.());
  beforeEach(async () => {
    await resetDatabase(prisma);
    await prisma.$executeRawUnsafe('TRUNCATE TABLE search_events, search_history CASCADE');
  });

  it('defaults to 180 days of retention', () => {
    expect(config.get('SEARCH_EVENT_RETENTION_DAYS')).toBe(180);
  });

  it('removes expired events, keeps recent and boundary-inside events, and reports what it did', async () => {
    await event('recent-1h', ago(3_600_000));
    await event('recent-30d', ago(30 * DAY));
    await event('just-inside-179d23h', ago(180 * DAY - 3_600_000));
    await event('just-expired-180d1h', ago(180 * DAY + 3_600_000));
    await event('expired-181d', ago(181 * DAY));
    await event('expired-400d-a', ago(400 * DAY));
    await event('expired-400d-b', ago(400 * DAY + 1000));
    await event('expired-400d-c', ago(400 * DAY + 2000));

    const purger = new SearchEventsPurgeService(prisma, config);
    const report = await purger.purge({ now: NOW });
    expect(report).toMatchObject({ deleted: 5, retentionDays: 180, cutoff: ago(180 * DAY).toISOString() });
    expect(await labels()).toEqual(['just-inside-179d23h', 'recent-1h', 'recent-30d']);
  });

  it('is idempotent: a second run deletes nothing and does not fail', async () => {
    await event('old', ago(200 * DAY));
    await event('new', ago(DAY));
    const purger = new SearchEventsPurgeService(prisma, config);
    expect((await purger.purge({ now: NOW })).deleted).toBe(1);
    const again = await purger.purge({ now: NOW });
    expect(again).toMatchObject({ deleted: 0, batches: 0 });
    expect(await labels()).toEqual(['new']);
  });

  it('works through the backlog in bounded batches', async () => {
    for (let i = 0; i < 7; i++) await event(`old-${i}`, ago((200 + i) * DAY));
    await event('keep', ago(DAY));
    const purger = new SearchEventsPurgeService(prisma, config);
    const report = await purger.purge({ now: NOW, batchSize: 3 });
    expect(report).toMatchObject({ deleted: 7, batches: 3 });
    expect(await labels()).toEqual(['keep']);
  });

  it('is exact when the backlog is a multiple of the batch size', async () => {
    for (let i = 0; i < 4; i++) await event(`old-${i}`, ago((200 + i) * DAY));
    const report = await new SearchEventsPurgeService(prisma, config).purge({ now: NOW, batchSize: 2 });
    expect(report).toMatchObject({ deleted: 4, batches: 2 });
  });

  it('honours a configured retention period', async () => {
    await event('d10', ago(10 * DAY));
    await event('d40', ago(40 * DAY));
    const short = { get: (k: string) => (k === 'SEARCH_EVENT_RETENTION_DAYS' ? 30 : config.get(k as never)) } as unknown as AppConfig;
    const report = await new SearchEventsPurgeService(prisma, short).purge({ now: NOW });
    expect(report).toMatchObject({ deleted: 1, retentionDays: 30 });
    expect(await labels()).toEqual(['d10']);
  });

  it('touches only search_events: history, tenders and users are unaffected, and user/org attribution of kept events is preserved', async () => {
    const org = await prisma.organization.create({ data: { name: 'Retention Org', slug: `ret-${Date.now()}` } });
    const user = await prisma.user.create({ data: { name: 'Retention User', email: `ret-${Date.now()}@example.com`, passwordHash: 'x'.repeat(20) } });
    await prisma.searchHistory.create({ data: { userId: user.id, queryNormalized: 'ancient', filters: {}, dedupKey: 'k'.repeat(64), firstSearchedAt: ago(500 * DAY), lastSearchedAt: ago(500 * DAY) } });
    await event('expired-user', ago(300 * DAY), { userId: user.id, organizationId: org.id });
    await event('kept-user', ago(2 * DAY), { userId: user.id, organizationId: org.id });
    await event('kept-anon', ago(2 * DAY));

    const before = { users: await prisma.user.count(), orgs: await prisma.organization.count(), tenders: await prisma.tender.count(), history: await prisma.searchHistory.count() };
    await new SearchEventsPurgeService(prisma, config).purge({ now: NOW });
    expect({ users: await prisma.user.count(), orgs: await prisma.organization.count(), tenders: await prisma.tender.count(), history: await prisma.searchHistory.count() }).toEqual(before);

    const kept = await prisma.searchEvent.findMany({ orderBy: { queryNormalized: 'asc' } });
    expect(kept.map((e) => [e.queryNormalized, e.userId, e.organizationId])).toEqual([
      ['kept-anon', null, null],
      ['kept-user', user.id, org.id],
    ]);
  });

  it('the scheduled job handler runs the purge with the configured retention and returns a summary', async () => {
    await event('old', ago(365 * DAY));
    const handler = new SearchEventsPurgeHandler(new SearchEventsPurgeService(prisma, config));
    expect(await handler.handle()).toEqual({ deleted: 1, batches: 1, retentionDays: 180 });
  });
});

describe('search-events-purge schedule', () => {
  it('is accepted by the schedule catalog once seeded', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppConfigModule, DatabaseModule], providers: [SeedService] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    try {
      const prisma = app.get(PrismaService);
      await resetDatabase(prisma);
      await app.get(SeedService).run();
      await app.get(SeedService).run();
      const { schedules, rejected } = await new ScheduleCatalog(prisma).load();
      expect(rejected).toEqual([]);
      const purge = schedules.filter((s) => s.jobName === 'maintenance.search-events-purge');
      expect(purge).toHaveLength(1);
      expect(purge[0]).toMatchObject({ id: 'sched.search-events-purge', queue: 'maintenance', pattern: '15 4 * * *', tz: 'Asia/Kolkata' });
    } finally {
      await app.close();
    }
  });
});
