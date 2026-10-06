import type { PrismaService } from '../../src/database/prisma.service';

/**
 * Empties every table an e2e test can create rows in directly (see test-env.ts for the safety
 * check that this only ever runs against a `*_test` database). `CASCADE` also empties everything
 * that references these tables (sessions, auth_tokens, organization_members, watchlist_items, …),
 * so they do not need to be listed individually.
 *
 * Deliberately NOT truncated: `states`, `districts`, `categories`, `tender_types`, `roles`,
 * `permissions` and `role_permissions` — reference/lookup data that `SeedService.run()` seeds once
 * per test file (in `beforeAll`) and that individual tests only read, never mutate.
 *
 * `procuring_entities` has no FK from `tenders`/`tender_sources` back to it (it's the other way
 * round), so truncating those does not cascade into it - it must be listed explicitly. Its own
 * dependents (`procuring_entity_aliases`, `source_entity_mappings` via `tender_sources`) cascade.
 */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      tender_source_records, tenders, crawl_runs, tender_sources, outbox_events, job_schedules,
      stored_files, organizations, users, procuring_entities
    RESTART IDENTITY CASCADE`);
}
