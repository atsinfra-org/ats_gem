import { z } from 'zod';

/**
 * Deterministic fake portal data. The same config always yields the same tenders, which is what
 * makes idempotency observable: re-running a crawl must create nothing new. Bumping `revision`
 * changes every fourth tender (a corrigendum-style deadline extension) to exercise the update path.
 */
export const MockConfigSchema = z.object({
  totalTenders: z.number().int().min(0).max(5_000).default(24),
  pageSize: z.number().int().min(1).max(500).default(10),
  /** Reference date the synthetic publish/closing dates are spread around. */
  anchorDate: z.iso.date().default('2026-09-21'),
  revision: z.number().int().min(0).default(0),
  /** Fetching these fails on the first attempt only (exercises retries). */
  flakyExternalIds: z.array(z.string()).default([]),
  /** These produce records that fail normalization (exercises skip handling). */
  invalidExternalIds: z.array(z.string()).default([]),
  /** Simulates the portal being down: discovery and health checks fail. */
  unavailable: z.boolean().default(false),
});

export type MockConfig = z.infer<typeof MockConfigSchema>;

export function parseMockConfig(crawlConfig: Record<string, unknown>): MockConfig {
  return MockConfigSchema.parse(crawlConfig.mock ?? {});
}

const WORKS = [
  'Construction of 4-lane bypass road',
  'Supply, installation and commissioning of medical equipment',
  'Annual maintenance of street lighting',
  'Laying of DI water supply pipeline',
  'Installation of grid-connected solar rooftop systems',
  'Upgrade of data centre and network infrastructure',
  'Provision of security services for government offices',
  'Desilting of storm water drains',
];

const BUYERS: [department: string, state: string, city: string][] = [
  ['Public Works Department, Maharashtra', 'Maharashtra', 'Pune'],
  ['Uttar Pradesh Power Corporation', 'Uttar Pradesh', 'Lucknow'],
  ['Delhi Jal Board', 'Delhi', 'New Delhi'],
  ['Greater Chennai Corporation', 'Tamil Nadu', 'Chennai'],
  ['Karnataka Rural Infrastructure Development', 'Karnataka', 'Bengaluru'],
  ['Gujarat Water Supply Board', 'Gujarat', 'Gandhinagar'],
  ['Kolkata Municipal Corporation', 'West Bengal', 'Kolkata'],
  ['Public Health Engineering Department, Rajasthan', 'Rajasthan', 'Jaipur'],
];

const TYPES = ['Open Tender', 'Limited Tender', 'Open Tender', 'EOI', 'Open Tender', 'RFP'];
const FEES = [500, 1_000, 2_000, 5_000];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** mulberry32 — tiny deterministic PRNG. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Formats a UTC instant as an IST portal string: "24-Sep-2026 03:00 PM". */
function istString(utcMs: number): string {
  const d = new Date(utcMs + 330 * 60_000);
  const hours24 = d.getUTCHours();
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getUTCDate())}-${MONTH_NAMES[d.getUTCMonth()]}-${d.getUTCFullYear()} ${pad(hours12)}:${pad(d.getUTCMinutes())} ${hours24 < 12 ? 'AM' : 'PM'}`;
}

/** Indian digit grouping: 12345678.5 → "1,23,45,678.50" (from integer paise; no float maths). */
function indianAmount(paise: number): string {
  const rupees = Math.floor(paise / 100);
  const fraction = String(paise % 100).padStart(2, '0');
  const digits = String(rupees);
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${rest ? `${rest},` : ''}${last3}.${fraction}`;
}

export function mockExternalIds(config: MockConfig): string[] {
  return Array.from({ length: config.totalTenders }, (_, i) => `MOCK-${String(i + 1).padStart(4, '0')}`);
}

export function mockTenderUrl(externalId: string): string {
  // `.invalid` is reserved (RFC 2606): the mock can never reach a real host.
  return `https://mock-portal.invalid/tenders/${externalId}`;
}

/** Source-shaped record, using field names the way Indian e-procurement portals label them. */
export function mockRawTender(config: MockConfig, externalId: string): Record<string, string> {
  const index = Number(externalId.slice(5)) - 1;
  const random = rng(index * 7_919 + 17);
  const [department, state, city] = BUYERS[index % BUYERS.length];
  const work = WORKS[Math.floor(random() * WORKS.length)];

  const anchor = Date.parse(`${config.anchorDate}T00:00:00Z`);
  const day = 86_400_000;
  const publishedAt = anchor - Math.floor(random() * 20) * day + (4 + Math.floor(random() * 7)) * 3_600_000;
  let closingAt = publishedAt + (7 + Math.floor(random() * 34)) * day;
  closingAt = closingAt - (closingAt % day) + 9.5 * 3_600_000; // 15:00 IST
  if (index % 4 === 0 && config.revision > 0) closingAt += config.revision * 7 * day;
  const openingAt = closingAt + day - 4 * 3_600_000; // next day 11:00 IST

  const valuePaise = (5_00_000 + Math.floor(random() * 49_95_00_000)) * 100 + Math.floor(random() * 100);
  const emdPaise = Math.round(valuePaise * 0.02);
  const seq = String(index + 1).padStart(4, '0');

  return {
    'Tender ID': `2026_${state.slice(0, 2).toUpperCase()}_${seq}_1`,
    'Tender Reference Number': `${department.split(',')[0].split(' ').map((w) => w[0]).join('')}/2026/${seq}`,
    Title: config.invalidExternalIds.includes(externalId) ? '' : `${work}, ${city}`,
    'Work Description': `${work} for ${department}, ${city}. Scope, specifications and BOQ as per tender documents.`,
    'Organisation Chain': department,
    State: state,
    Location: city,
    'Tender Type': TYPES[index % TYPES.length],
    'Tender Value in ₹': indianAmount(valuePaise),
    'EMD Amount in ₹': indianAmount(emdPaise),
    'Tender Fee in ₹': `${FEES[index % FEES.length].toLocaleString('en-IN')}/-`,
    'Published Date': istString(publishedAt),
    'Bid Submission End Date': istString(closingAt),
    'Bid Opening Date': istString(openingAt),
  };
}
