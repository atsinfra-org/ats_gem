import { Test, type TestingModule } from '@nestjs/testing';
import { AuditModule } from '../src/audit/audit.module';
import { AppConfigModule } from '../src/config/config.module';
import { CrawlerModule } from '../src/crawler/crawler.module';
import { TenderIngestionService } from '../src/crawler/ingestion/tender-ingestion.service';
import { NormalizedTenderSchema, type ValidNormalizedTender } from '../src/crawler/normalization/normalized-tender';
import { parseIndianAmount } from '../src/crawler/normalization/parsers';
import { DatabaseModule } from '../src/database/database.module';
import { PrismaService } from '../src/database/prisma.service';
import { LoggingModule } from '../src/logging/logging.module';
import { OutboxModule } from '../src/outbox/outbox.module';
import { QueuesModule } from '../src/queues/queues.module';
import { DuplicateCandidatesModule } from '../src/tenders/dedup/duplicate-candidates.module';
import { DuplicateCandidatesService } from '../src/tenders/dedup/duplicate-candidates.service';
import { ProcuringEntitiesModule } from '../src/tenders/entities/procuring-entities.module';
import { ProcuringEntitiesService } from '../src/tenders/entities/procuring-entities.service';
import { resetDatabase } from './support/database';

const ANCHOR = new Date('2026-09-21T06:00:00Z');

function tender(overrides: Partial<ValidNormalizedTender>): ValidNormalizedTender {
  return NormalizedTenderSchema.parse({
    externalId: overrides.externalId ?? 'EXT-1',
    title: 'Construction of 4-lane bypass road near city limits',
    department: 'Public Works Department, Maharashtra',
    stateCode: 'MH',
    estimatedValue: parseIndianAmount('1 Crore'),
    publishedAt: ANCHOR.toISOString(),
    closingAt: new Date(ANCHOR.getTime() + 20 * 86_400_000).toISOString(),
    ...overrides,
  });
}

describe('Phase 3 normalization, entity resolution and deduplication (e2e, PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let ingestion: TenderIngestionService;
  let entities: ProcuringEntitiesService;
  let duplicates: DuplicateCandidatesService;
  let sourceA: string;
  let sourceB: string;
  let actorUserId: string;

  async function createSource(name: string) {
    const source = await prisma.tenderSource.create({
      data: { name, slug: `${name.toLowerCase().replace(/\s+/g, '-')}-${Math.random().toString(36).slice(2, 8)}`, sourceType: 'MOCK', adapterKey: 'mock', crawlConfig: {} },
    });
    return source.id;
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, LoggingModule, DatabaseModule, QueuesModule, OutboxModule, AuditModule, CrawlerModule, ProcuringEntitiesModule, DuplicateCandidatesModule],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    ingestion = moduleRef.get(TenderIngestionService);
    entities = moduleRef.get(ProcuringEntitiesService);
    duplicates = moduleRef.get(DuplicateCandidatesService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    sourceA = await createSource('Source A');
    sourceB = await createSource('Source B');
    const actor = await prisma.user.create({ data: { email: `actor-${Math.random().toString(36).slice(2, 8)}@example.com`, name: 'Test Actor' } });
    actorUserId = actor.id;
  });

  afterAll(() => moduleRef.close());

  describe('entity resolution', () => {
    it('auto-creates a procuring entity on first sight, then reuses it via the source mapping', async () => {
      const first = await ingestion.ingest({ sourceId: sourceA, raw: { externalId: 'E1', data: {} }, normalized: tender({ externalId: 'E1' }) }, ANCHOR);
      const second = await ingestion.ingest({ sourceId: sourceA, raw: { externalId: 'E2', data: {} }, normalized: tender({ externalId: 'E2', title: 'A completely unrelated desilting contract' }) }, ANCHOR);

      const t1 = await prisma.tender.findUniqueOrThrow({ where: { id: first.tenderId } });
      const t2 = await prisma.tender.findUniqueOrThrow({ where: { id: second.tenderId } });
      expect(t1.procuringEntityId).not.toBeNull();
      expect(t1.procuringEntityId).toBe(t2.procuringEntityId);

      const entityCount = await prisma.procuringEntity.count();
      expect(entityCount).toBe(1);
      const mapping = await prisma.sourceEntityMapping.findFirst({ where: { sourceId: sourceA } });
      expect(mapping?.method).toBe('EXACT_NORMALIZED_NAME');
    });

    it('resolves an alias to the same entity as the canonical name it points to', async () => {
      const created = await ingestion.ingest({ sourceId: sourceA, raw: { externalId: 'E1', data: {} }, normalized: tender({ externalId: 'E1' }) }, ANCHOR);
      const canonical = await prisma.tender.findUniqueOrThrow({ where: { id: created.tenderId } });

      await prisma.procuringEntityAlias.create({
        data: { procuringEntityId: canonical.procuringEntityId!, alias: 'PWD Maharashtra', aliasNormalized: 'pwd maharashtra' },
      });

      const viaAlias = await ingestion.ingest(
        { sourceId: sourceB, raw: { externalId: 'F1', data: {} }, normalized: tender({ externalId: 'F1', department: 'PWD Maharashtra', title: 'Unrelated street lighting maintenance work' }) },
        ANCHOR,
      );
      const t = await prisma.tender.findUniqueOrThrow({ where: { id: viaAlias.tenderId } });
      expect(t.procuringEntityId).toBe(canonical.procuringEntityId);
      const mapping = await prisma.sourceEntityMapping.findFirst({ where: { sourceId: sourceB, sourceEntityNormalized: 'pwd maharashtra' } });
      expect(mapping?.method).toBe('ALIAS');
    });

    it('merges two entities without deleting either row, and re-points dependent tenders', async () => {
      const t1 = await ingestion.ingest({ sourceId: sourceA, raw: { externalId: 'E1', data: {} }, normalized: tender({ externalId: 'E1', department: 'Delhi Jal Board' }) }, ANCHOR);
      const t2 = await ingestion.ingest({ sourceId: sourceB, raw: { externalId: 'F1', data: {} }, normalized: tender({ externalId: 'F1', department: 'DJB Delhi', title: 'Something else entirely different' }) }, ANCHOR);

      const e1 = (await prisma.tender.findUniqueOrThrow({ where: { id: t1.tenderId } })).procuringEntityId!;
      const e2 = (await prisma.tender.findUniqueOrThrow({ where: { id: t2.tenderId } })).procuringEntityId!;
      expect(e1).not.toBe(e2);

      await entities.merge({ sourceEntityId: e2, targetEntityId: e1, actorUserId });

      const merged = await prisma.procuringEntity.findUniqueOrThrow({ where: { id: e2 } });
      expect(merged.status).toBe('MERGED');
      expect(merged.mergedIntoId).toBe(e1);
      const survivingEntity = await prisma.procuringEntity.findUniqueOrThrow({ where: { id: e1 } });
      expect(survivingEntity.status).toBe('ACTIVE');

      const t2After = await prisma.tender.findUniqueOrThrow({ where: { id: t2.tenderId } });
      expect(t2After.procuringEntityId).toBe(e1);
    });

    it('refuses a merge that would create a cycle', async () => {
      const a = await prisma.procuringEntity.create({ data: { name: 'A', nameNormalized: 'a', entityType: 'OTHER' } });
      const b = await prisma.procuringEntity.create({ data: { name: 'B', nameNormalized: 'b', entityType: 'OTHER' } });
      await entities.merge({ sourceEntityId: b.id, targetEntityId: a.id, actorUserId });
      await expect(entities.merge({ sourceEntityId: a.id, targetEntityId: b.id, actorUserId })).rejects.toThrow();
    });
  });

  describe('tender versioning', () => {
    it('writes an INITIAL version on creation and an UPDATE version on a later change', async () => {
      const created = await ingestion.ingest({ sourceId: sourceA, raw: { externalId: 'E1', data: {} }, normalized: tender({ externalId: 'E1' }) }, ANCHOR);
      const laterDate = new Date(ANCHOR.getTime() + 3600_000);
      await ingestion.ingest({ sourceId: sourceA, raw: { externalId: 'E1', data: {} }, normalized: tender({ externalId: 'E1', description: 'Now with a description' }) }, laterDate);

      const versions = await prisma.tenderVersion.findMany({ where: { tenderId: created.tenderId }, orderBy: { version: 'asc' } });
      expect(versions.map((v) => [v.version, v.changeType])).toEqual([
        [1, 'INITIAL'],
        [2, 'UPDATE'],
      ]);
    });

    it('classifies a closing-date change as a CORRIGENDUM', async () => {
      const created = await ingestion.ingest({ sourceId: sourceA, raw: { externalId: 'E1', data: {} }, normalized: tender({ externalId: 'E1' }) }, ANCHOR);
      const extended = new Date(ANCHOR.getTime() + 30 * 86_400_000).toISOString();
      await ingestion.ingest({ sourceId: sourceA, raw: { externalId: 'E1', data: {} }, normalized: tender({ externalId: 'E1', closingAt: extended }) }, new Date(ANCHOR.getTime() + 3600_000));

      const v2 = await prisma.tenderVersion.findFirstOrThrow({ where: { tenderId: created.tenderId, version: 2 } });
      expect(v2.changeType).toBe('CORRIGENDUM');
    });
  });

  describe('data quality issues', () => {
    it('flags a missing reference number without rejecting the tender', async () => {
      const created = await ingestion.ingest({ sourceId: sourceA, raw: { externalId: 'E1', data: {} }, normalized: tender({ externalId: 'E1' }) }, ANCHOR);
      const issues = await prisma.tenderQualityIssue.findMany({ where: { tenderId: created.tenderId } });
      expect(issues.some((i) => i.code === 'MISSING_REFERENCE_NUMBER')).toBe(true);
    });
  });

  describe('cross-source deduplication', () => {
    it('links a second source to the same canonical tender on an exact reference-number + entity match', async () => {
      const created = await ingestion.ingest(
        { sourceId: sourceA, raw: { externalId: 'E1', data: {} }, normalized: tender({ externalId: 'E1', referenceNumber: 'PWD/2026/0099' }) },
        ANCHOR,
      );
      const linked = await ingestion.ingest(
        { sourceId: sourceB, raw: { externalId: 'F1', data: {} }, normalized: tender({ externalId: 'F1', referenceNumber: 'pwd-2026-0099', title: 'Completely different wording for the same work' }) },
        ANCHOR,
      );

      expect(linked.outcome).toBe('linked');
      expect(linked.tenderId).toBe(created.tenderId);
      const tenderCount = await prisma.tender.count();
      expect(tenderCount).toBe(1);
      const records = await prisma.tenderSourceRecord.findMany({ where: { tenderId: created.tenderId } });
      expect(records).toHaveLength(2);
    });

    it('records a PENDING duplicate candidate for a plausible but unconfirmed cross-source match', async () => {
      const created = await ingestion.ingest(
        { sourceId: sourceA, raw: { externalId: 'E1', data: {} }, normalized: tender({ externalId: 'E1', title: 'Construction of 4-lane bypass road near city limits' }) },
        ANCHOR,
      );
      await ingestion.ingest(
        {
          sourceId: sourceB,
          raw: { externalId: 'F1', data: {} },
          normalized: tender({ externalId: 'F1', title: 'Construction of 4 lane bypass road near the city limits', department: 'Unrelated Other Department' }),
        },
        ANCHOR,
      );

      const candidates = await prisma.duplicateCandidate.findMany();
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0].status).toBe('PENDING');

      await duplicates.resolve({ candidateId: candidates[0].id, resolution: 'CONFIRMED', actorUserId });
      const resolved = await prisma.duplicateCandidate.findUniqueOrThrow({ where: { id: candidates[0].id } });
      expect(resolved.status).toBe('CONFIRMED');

      const loserId = resolved.candidateTenderId === created.tenderId ? resolved.tenderId : resolved.candidateTenderId;
      const loser = await prisma.tender.findUniqueOrThrow({ where: { id: loserId } });
      expect(loser.duplicateOfId).not.toBeNull();
      expect(loser.lifecycle).toBe('ARCHIVED');
    });
  });

  describe('money normalization (Indian lakh/crore notation)', () => {
    it.each([
      ['10 lakh', '1000000.00'],
      ['1.5 Cr', '15000000.00'],
      ['₹1 Crore', '10000000.00'],
    ])('%s -> %s', (input, expected) => {
      expect(parseIndianAmount(input)).toBe(expected);
    });
  });
});
