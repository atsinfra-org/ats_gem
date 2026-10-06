import { z } from 'zod';
import type { AnalyticsEventName } from '../generated/prisma/enums';

const uuid = z.uuid();
const path = z.string().max(300);
const shortText = z.string().max(120);

/**
 * Per-event metadata schemas (docs/ARCHITECTURE.md Sec 22.3). Every schema is `.strict()`: unknown keys are
 * rejected, so a client can never smuggle an arbitrary object through as "metadata". No schema accepts a full
 * request/response body, a token, or free document/tender content - only small, named, bounded facts.
 */
export const ANALYTICS_METADATA_SCHEMAS = {
  PAGE_VIEW: z.object({ routeCategory: z.enum(['public', 'auth', 'app', 'admin']).optional() }).strict(),
  REGISTRATION_STARTED: z.object({}).strict(),
  REGISTRATION_COMPLETED: z.object({}).strict(),
  EMAIL_VERIFICATION_COMPLETED: z.object({}).strict(),
  LOGIN_SUCCESS: z.object({}).strict(),
  LOGIN_FAILURE: z.object({ reason: z.enum(['invalid_credentials', 'account_locked', 'account_suspended']).optional() }).strict(),
  LOGOUT: z.object({}).strict(),
  TENDER_VIEWED: z.object({ tenderId: uuid, source: z.enum(['search', 'saved', 'notification', 'direct']).optional(), query: shortText.optional() }).strict(),
  TENDER_SAVED: z.object({ tenderId: uuid, source: z.enum(['search', 'detail']).optional() }).strict(),
  TENDER_UNSAVED: z.object({ tenderId: uuid }).strict(),
  TENDER_SOURCE_OPENED: z.object({ tenderId: uuid }).strict(),
  TENDER_CORRIGENDUM_VIEWED: z.object({ tenderId: uuid, corrigendumId: uuid }).strict(),
  TENDER_VERSION_VIEWED: z.object({ tenderId: uuid, version: z.number().int().min(1).max(100_000).optional() }).strict(),
  DOCUMENT_VIEWED: z.object({ tenderId: uuid, documentId: uuid, documentType: shortText.optional() }).strict(),
  DOCUMENT_DOWNLOADED: z.object({ tenderId: uuid, documentId: uuid, documentType: shortText.optional() }).strict(),
  DOCUMENT_DOWNLOAD_FAILED: z.object({ tenderId: uuid, documentId: uuid, reason: shortText.optional() }).strict(),
  NOTIFICATION_VIEWED: z.object({ notificationId: uuid, type: shortText.optional() }).strict(),
  NOTIFICATION_CLICKED: z.object({ notificationId: uuid, type: shortText.optional() }).strict(),
  NOTIFICATION_PREFERENCES_UPDATED: z.object({}).strict(),
  PROFILE_VIEWED: z.object({}).strict(),
  PROFILE_UPDATED: z.object({}).strict(),
  ORGANIZATION_VIEWED: z.object({}).strict(),
  CLIENT_ERROR: z.object({ message: shortText, path: path.optional() }).strict(),
  API_ERROR: z.object({ code: shortText, status: z.number().int().min(100).max(599), path: path.optional() }).strict(),
} as const satisfies Record<AnalyticsEventName, z.ZodTypeAny>;

export type AnalyticsMetadataFor<N extends AnalyticsEventName> = z.infer<(typeof ANALYTICS_METADATA_SCHEMAS)[N]>;

/** Events that carry no user/session identity worth keeping across an auth boundary (safe to fire pre-login). */
export const PUBLIC_SAFE_EVENTS: readonly AnalyticsEventName[] = ['PAGE_VIEW', 'REGISTRATION_STARTED', 'LOGIN_FAILURE', 'CLIENT_ERROR'];
