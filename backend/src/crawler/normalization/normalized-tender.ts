import { z } from 'zod';

/** Exact decimal as a string with two places ("12345678.00") — money never touches floats. */
export const DecimalString = z.string().regex(/^\d{1,16}\.\d{2}$/, 'expected a decimal amount with 2 places');

/**
 * The platform's source-independent tender shape. Every adapter maps into this, and ingestion
 * validates it before touching the database. Dates are ISO-8601 UTC strings so the structure is
 * JSON-stable and hashable.
 */
export const NormalizedTenderSchema = z
  .object({
    externalId: z.string().min(1).max(256),
    sourceUrl: z.url().max(2048).optional(),
    referenceNumber: z.string().min(1).max(256).optional(),
    title: z.string().trim().min(3).max(1000),
    description: z.string().max(20_000).optional(),
    department: z.string().max(500).optional(),
    stateCode: z.string().regex(/^[A-Z]{2}$/).optional(),
    city: z.string().max(200).optional(),
    locationText: z.string().max(500).optional(),
    estimatedValue: DecimalString.optional(),
    emdAmount: DecimalString.optional(),
    tenderFee: DecimalString.optional(),
    currency: z.string().regex(/^[A-Z]{3}$/).default('INR'),
    publishedAt: z.iso.datetime(),
    closingAt: z.iso.datetime().optional(),
    openingAt: z.iso.datetime().optional(),
    lifecycle: z.enum(['ACTIVE', 'CANCELLED', 'AWARDED', 'ARCHIVED']).default('ACTIVE'),
  })
  .refine((t) => !t.closingAt || t.closingAt >= t.publishedAt, {
    message: 'closingAt must not be before publishedAt',
    path: ['closingAt'],
  });

export type NormalizedTender = z.input<typeof NormalizedTenderSchema>;
export type ValidNormalizedTender = z.output<typeof NormalizedTenderSchema>;
