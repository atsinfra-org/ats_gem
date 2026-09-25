import { NormalizedTenderSchema } from '../../normalization/normalized-tender';
import { PermanentJobError } from '../../../queues/job-errors';
import type { CrawlContext, TenderRef } from '../source-adapter';
import { MockSourceAdapter } from './mock-source.adapter';

function ctx(mock: Record<string, unknown> = {}, attempt = 1): CrawlContext {
  return { source: { id: 'src', slug: 'mock-portal', config: { mock } }, attempt, signal: new AbortController().signal };
}

async function discoverAll(adapter: MockSourceAdapter, c: CrawlContext): Promise<TenderRef[]> {
  const refs: TenderRef[] = [];
  let cursor: string | undefined;
  do {
    const page = await adapter.search(c, cursor);
    refs.push(...page.refs);
    cursor = page.nextCursor;
  } while (cursor);
  return refs;
}

describe('MockSourceAdapter', () => {
  const adapter = new MockSourceAdapter();

  it('paginates through every tender', async () => {
    const refs = await discoverAll(adapter, ctx({ totalTenders: 23, pageSize: 10 }));
    expect(refs).toHaveLength(23);
    expect(new Set(refs.map((r) => r.externalId)).size).toBe(23);
    expect(refs[0]).toEqual({ externalId: 'MOCK-0001', url: 'https://mock-portal.invalid/tenders/MOCK-0001' });
  });

  it('only ever points at the reserved .invalid TLD', async () => {
    const refs = await discoverAll(adapter, ctx());
    expect(refs.every((r) => new URL(r.url!).hostname.endsWith('.invalid'))).toBe(true);
  });

  it('is deterministic: the same config yields identical records', async () => {
    const a = await adapter.fetchTender(ctx(), { externalId: 'MOCK-0007' });
    const b = await adapter.fetchTender(ctx(), { externalId: 'MOCK-0007' });
    expect(a).toEqual(b);
  });

  it('normalizes into a valid tender with exact decimals and UTC dates', async () => {
    for (const ref of await discoverAll(adapter, ctx())) {
      const normalized = NormalizedTenderSchema.parse(adapter.normalize(await adapter.fetchTender(ctx(), ref)));
      expect(normalized.estimatedValue).toMatch(/^\d+\.\d{2}$/);
      expect(normalized.publishedAt).toMatch(/Z$/);
      expect(normalized.stateCode).toMatch(/^[A-Z]{2}$/);
      expect(normalized.currency).toBe('INR');
    }
  });

  it('a new revision changes every fourth tender only', async () => {
    const before = await Promise.all(['MOCK-0001', 'MOCK-0002'].map((id) => adapter.fetchTender(ctx(), { externalId: id })));
    const after = await Promise.all(['MOCK-0001', 'MOCK-0002'].map((id) => adapter.fetchTender(ctx({ revision: 1 }), { externalId: id })));
    expect(after[0].data['Bid Submission End Date']).not.toBe(before[0].data['Bid Submission End Date']);
    expect(after[1]).toEqual(before[1]);
  });

  it('simulates a transient failure on the first attempt of flaky tenders', async () => {
    const config = { flakyExternalIds: ['MOCK-0002'] };
    await expect(adapter.fetchTender(ctx(config, 1), { externalId: 'MOCK-0002' })).rejects.toThrow('Simulated upstream timeout');
    await expect(adapter.fetchTender(ctx(config, 2), { externalId: 'MOCK-0002' })).resolves.toBeDefined();
  });

  it('produces records that fail validation for configured invalid ids', async () => {
    const raw = await adapter.fetchTender(ctx({ invalidExternalIds: ['MOCK-0003'] }), { externalId: 'MOCK-0003' });
    expect(NormalizedTenderSchema.safeParse(adapter.normalize(raw)).success).toBe(false);
  });

  it('treats tenders no longer listed as a permanent failure', async () => {
    await expect(adapter.fetchTender(ctx({ totalTenders: 2 }), { externalId: 'MOCK-0099' })).rejects.toBeInstanceOf(PermanentJobError);
  });

  it('reports an unavailable portal on discovery and health checks', async () => {
    await expect(adapter.search(ctx({ unavailable: true }))).rejects.toThrow('unavailable');
    await expect(adapter.healthCheck(ctx({ unavailable: true }))).resolves.toMatchObject({ healthy: false });
    await expect(adapter.healthCheck(ctx())).resolves.toEqual({ healthy: true });
  });

  it('rejects malformed mock configuration', async () => {
    await expect(adapter.search(ctx({ pageSize: 0 }))).rejects.toThrow();
  });
});
