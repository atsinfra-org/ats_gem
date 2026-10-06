import type { ValidNormalizedTender } from '../normalization/normalized-tender';
import { changedFields, payloadHash } from './tender-ingestion.service';

const base: ValidNormalizedTender = {
  externalId: 'MOCK-0001',
  title: 'Construction of bypass road',
  currency: 'INR',
  publishedAt: '2026-09-20T05:00:00.000Z',
  closingAt: '2026-10-10T09:30:00.000Z',
  estimatedValue: '12345678.50',
  lifecycle: 'ACTIVE',
};

describe('payloadHash', () => {
  it('is a stable SHA-256 independent of key order', () => {
    const reordered = Object.fromEntries(Object.entries(base).reverse()) as ValidNormalizedTender;
    expect(payloadHash(base)).toMatch(/^[0-9a-f]{64}$/);
    expect(payloadHash(reordered)).toBe(payloadHash(base));
  });

  it('changes when any value changes', () => {
    expect(payloadHash({ ...base, estimatedValue: '12345678.51' })).not.toBe(payloadHash(base));
  });
});

describe('changedFields', () => {
  it('lists only the fields whose values differ', () => {
    const next = { ...base, closingAt: '2026-10-17T09:30:00.000Z', department: 'PWD' };
    expect(changedFields(base, next)).toEqual(['department', 'closingAt']);
  });

  it('treats a missing field and an undefined one as equal', () => {
    expect(changedFields({ ...base, description: undefined }, base)).toEqual([]);
  });
});
