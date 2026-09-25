import type { NormalizedTender } from '../normalization/normalized-tender';

/** A tender listing entry discovered on a source. */
export interface TenderRef {
  externalId: string;
  url?: string;
}

export interface DiscoveryPage {
  refs: TenderRef[];
  /** Opaque cursor for the next page; undefined when discovery is complete. */
  nextCursor?: string;
}

export interface RawTender {
  externalId: string;
  url?: string;
  /** Source-shaped data exactly as fetched; stored for audit/debugging and hashed after normalization. */
  data: Record<string, unknown>;
}

export interface RawDocumentRef {
  url: string;
  fileName?: string;
}

export type AuthResult =
  | { status: 'NOT_REQUIRED' | 'OK' }
  | { status: 'NEEDS_MANUAL_ACTION' | 'FAILED'; reason: string };

export interface HealthResult {
  healthy: boolean;
  detail?: string;
}

export interface CrawlSource {
  id: string;
  slug: string;
  /** tender_sources.crawl_config — rate limits and adapter settings. Never credentials. */
  config: Record<string, unknown>;
}

export interface CrawlContext {
  source: CrawlSource;
  /** 1-based attempt of the current job, for adapters that must behave differently on retry. */
  attempt: number;
  signal: AbortSignal;
}

/**
 * Contract every tender source implements (docs/ARCHITECTURE.md §6.1). The crawler engine only
 * talks to this interface; nothing outside an adapter knows a portal's URLs, fields or quirks.
 * Adapters must never bypass CAPTCHA, MFA, robots restrictions or other access controls.
 */
export interface SourceAdapter {
  readonly key: string;
  initialize(ctx: CrawlContext): Promise<void>;
  authenticate(ctx: CrawlContext): Promise<AuthResult>;
  search(ctx: CrawlContext, cursor?: string): Promise<DiscoveryPage>;
  fetchTender(ctx: CrawlContext, ref: TenderRef): Promise<RawTender>;
  fetchDocuments(ctx: CrawlContext, raw: RawTender): Promise<RawDocumentRef[]>;
  /** Pure mapping from source fields to the platform's normalized shape; unit-tested with fixtures. */
  normalize(raw: RawTender): NormalizedTender;
  healthCheck(ctx: CrawlContext): Promise<HealthResult>;
}
