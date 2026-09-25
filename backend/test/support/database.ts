import type { PrismaService } from '../../src/database/prisma.service';

/** Empties every Phase 1 table in the *_test database (see test-env.ts for the safety check). */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE tender_source_records, tenders, crawl_runs, tender_sources, outbox_events, job_schedules
    RESTART IDENTITY CASCADE`);
}
