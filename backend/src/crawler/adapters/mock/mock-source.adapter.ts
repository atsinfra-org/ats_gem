import { Injectable } from '@nestjs/common';
import { PermanentJobError } from '../../../queues/job-errors';
import type { NormalizedTender } from '../../normalization/normalized-tender';
import { cleanText, parseIndianAmount, parseIstDateTime } from '../../normalization/parsers';
import { stateCodeFor } from '../../normalization/india-states';
import type {
  AuthResult,
  CrawlContext,
  DiscoveryPage,
  HealthResult,
  RawDocumentRef,
  RawTender,
  SourceAdapter,
  TenderRef,
} from '../source-adapter';
import { mockExternalIds, mockRawTender, mockTenderUrl, parseMockConfig } from './mock-dataset';

/** Runs the synchronous mock logic as a promise, so config errors surface as rejections like real I/O. */
function settle<T>(fn: () => T): Promise<T> {
  return new Promise((resolve) => resolve(fn()));
}

/**
 * Deterministic in-process source used to exercise the whole ingestion pipeline without
 * touching any real portal. Also the reference implementation for future adapters.
 */
@Injectable()
export class MockSourceAdapter implements SourceAdapter {
  readonly key = 'mock';

  initialize(): Promise<void> {
    return Promise.resolve();
  }

  authenticate(): Promise<AuthResult> {
    return Promise.resolve({ status: 'NOT_REQUIRED' });
  }

  search(ctx: CrawlContext, cursor?: string): Promise<DiscoveryPage> {
    return settle(() => {
      const config = parseMockConfig(ctx.source.config);
      if (config.unavailable) throw new Error('Mock portal unavailable (simulated 503)');
      const ids = mockExternalIds(config);
      const offset = cursor ? Number(cursor) : 0;
      const next = offset + config.pageSize;
      return {
        refs: ids.slice(offset, next).map((externalId) => ({ externalId, url: mockTenderUrl(externalId) })),
        nextCursor: next < ids.length ? String(next) : undefined,
      };
    });
  }

  fetchTender(ctx: CrawlContext, ref: TenderRef): Promise<RawTender> {
    return settle(() => {
      const config = parseMockConfig(ctx.source.config);
      if (!mockExternalIds(config).includes(ref.externalId)) {
        throw new PermanentJobError(`Tender ${ref.externalId} no longer listed on source`);
      }
      if (config.flakyExternalIds.includes(ref.externalId) && ctx.attempt === 1) {
        throw new Error('Simulated upstream timeout');
      }
      return {
        externalId: ref.externalId,
        url: ref.url ?? mockTenderUrl(ref.externalId),
        data: mockRawTender(config, ref.externalId),
      };
    });
  }

  fetchDocuments(): Promise<RawDocumentRef[]> {
    // Document downloads arrive with the document pipeline in Phase 6.
    return Promise.resolve([]);
  }

  /** Source-specific mapper: portal labels → normalized fields. */
  normalize(raw: RawTender): NormalizedTender {
    const text = (field: string) => cleanText(raw.data[field]);
    return {
      externalId: raw.externalId,
      sourceUrl: raw.url,
      referenceNumber: text('Tender Reference Number'),
      title: text('Title') ?? '',
      description: text('Work Description'),
      department: text('Organisation Chain'),
      stateCode: stateCodeFor(text('State')),
      city: text('Location'),
      locationText: [text('Location'), text('State')].filter(Boolean).join(', ') || undefined,
      estimatedValue: parseIndianAmount(text('Tender Value in ₹')),
      emdAmount: parseIndianAmount(text('EMD Amount in ₹')),
      tenderFee: parseIndianAmount(text('Tender Fee in ₹')),
      currency: 'INR',
      publishedAt: parseIstDateTime(text('Published Date')) ?? '',
      closingAt: parseIstDateTime(text('Bid Submission End Date')),
      openingAt: parseIstDateTime(text('Bid Opening Date')),
      lifecycle: 'ACTIVE',
    };
  }

  healthCheck(ctx: CrawlContext): Promise<HealthResult> {
    return settle(() =>
      parseMockConfig(ctx.source.config).unavailable
        ? { healthy: false, detail: 'mock portal configured as unavailable' }
        : { healthy: true },
    );
  }
}
