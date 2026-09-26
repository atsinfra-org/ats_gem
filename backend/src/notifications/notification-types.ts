import { z } from 'zod';

export const NOTIFICATION_CATEGORIES = ['SAVED_SEARCH_ALERTS', 'SAVED_TENDER_UPDATES', 'DEADLINE_REMINDERS', 'CORRIGENDA', 'STATUS_CHANGES', 'SYSTEM'] as const;
export type NotificationCategoryKey = (typeof NOTIFICATION_CATEGORIES)[number];

export type NotificationPriorityKey = 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';

export type TemplateKey = 'saved-search-match' | 'tender-update' | 'deadline-reminder' | 'tender-corrigendum' | 'system-security' | 'saved-search-digest';

export interface NotificationTypeDefinition {
  category: NotificationCategoryKey;
  priority: NotificationPriorityKey;
  template: TemplateKey;
  /** Whether this type is emailed at all (in-app is always the record). */
  emailed: boolean;
}

/**
 * The closed list of notification types. Every type here has a real producer (docs/ARCHITECTURE.md Sec 21.4);
 * nothing is declared "for completeness". Priorities drive UI ordering hints and delivery behaviour: CRITICAL bypasses
 * quiet hours and email caps and cannot be switched off (the SYSTEM category is locked).
 */
export const NOTIFICATION_TYPES = {
  SAVED_SEARCH_MATCH: { category: 'SAVED_SEARCH_ALERTS', priority: 'NORMAL', template: 'saved-search-match', emailed: true },
  TENDER_UPDATED: { category: 'SAVED_TENDER_UPDATES', priority: 'NORMAL', template: 'tender-update', emailed: true },
  TENDER_DEADLINE: { category: 'DEADLINE_REMINDERS', priority: 'HIGH', template: 'deadline-reminder', emailed: true },
  TENDER_CORRIGENDUM: { category: 'CORRIGENDA', priority: 'HIGH', template: 'tender-corrigendum', emailed: true },
  TENDER_CANCELLED: { category: 'STATUS_CHANGES', priority: 'HIGH', template: 'tender-update', emailed: true },
  TENDER_STATUS_CHANGED: { category: 'STATUS_CHANGES', priority: 'NORMAL', template: 'tender-update', emailed: true },
  SECURITY: { category: 'SYSTEM', priority: 'CRITICAL', template: 'system-security', emailed: true },
  ACCOUNT: { category: 'SYSTEM', priority: 'NORMAL', template: 'system-security', emailed: false },
} as const satisfies Record<string, NotificationTypeDefinition>;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;
export const NOTIFICATION_TYPE_KEYS = Object.keys(NOTIFICATION_TYPES) as NotificationType[];

export function isNotificationType(value: string): value is NotificationType {
  return Object.hasOwn(NOTIFICATION_TYPES, value);
}

/** Bumped when a template's wording/structure changes; stored on every notification and delivery. */
export const TEMPLATE_VERSION = 1;

/** Categories the user may not switch off (security policy). */
export const LOCKED_CATEGORIES: readonly NotificationCategoryKey[] = ['SYSTEM'];

/** Defaults when a user has never touched a preference. Deadline reminders default to a single 24h reminder. */
export const DEFAULT_CHANNEL_PREFERENCE: Record<NotificationCategoryKey, { inApp: boolean; email: boolean }> = {
  SAVED_SEARCH_ALERTS: { inApp: true, email: true },
  SAVED_TENDER_UPDATES: { inApp: true, email: true },
  DEADLINE_REMINDERS: { inApp: true, email: true },
  CORRIGENDA: { inApp: true, email: true },
  STATUS_CHANGES: { inApp: true, email: true },
  SYSTEM: { inApp: true, email: true },
};

export const ALLOWED_DEADLINE_OFFSETS_HOURS = [168, 72, 24, 3] as const;
export const DEFAULT_DEADLINE_OFFSETS_HOURS: number[] = [24];

/**
 * Tender fields whose change is worth telling a user who saved the tender about. Everything else in the tracked set
 * (description, city, location text, source URL, currency, published date...) is bookkeeping or cosmetic and is
 * deliberately NOT notified: it would train users to ignore alerts.
 */
export const NOTIFY_WORTHY_TENDER_FIELDS = ['title', 'closingAt', 'openingAt', 'estimatedValue', 'emdAmount', 'tenderFee', 'lifecycle'] as const;

export const FIELD_LABELS: Record<string, string> = {
  title: 'title',
  closingAt: 'closing date',
  openingAt: 'opening date',
  estimatedValue: 'estimated value',
  emdAmount: 'EMD amount',
  tenderFee: 'tender fee',
  lifecycle: 'status',
};

/** Validated snapshot stored on each notification: small, closed, no free-form payloads. */
export const NotificationMetadataSchema = z
  .object({
    tenderId: z.uuid().optional(),
    tenderTitle: z.string().max(300).optional(),
    referenceNumber: z.string().max(120).optional(),
    closingAt: z.iso.datetime().optional(),
    previousClosingAt: z.iso.datetime().optional(),
    changedFields: z.array(z.string().max(40)).max(12).optional(),
    savedSearchId: z.uuid().optional(),
    savedSearchNames: z.array(z.string().max(200)).max(3).optional(),
    corrigendumId: z.uuid().optional(),
    corrigendumTitle: z.string().max(300).optional(),
    offsetHours: z.number().int().min(1).max(720).optional(),
    securityKind: z.enum(['PASSWORD_CHANGED', 'PASSWORD_RESET', 'EMAIL_VERIFIED']).optional(),
  })
  .strict();

export type NotificationMetadata = z.infer<typeof NotificationMetadataSchema>;

/** Deterministic deduplication keys: one per underlying event (unique with the user id). */
export const dedupKeys = {
  savedSearchMatch: (tenderId: string) => `SAVED_SEARCH_MATCH:${tenderId}`,
  tenderEvent: (type: NotificationType, eventId: string) => `${type}:${eventId}`,
  corrigendum: (corrigendumId: string) => `TENDER_CORRIGENDUM:${corrigendumId}`,
  deadline: (tenderId: string, closingAt: Date, offsetHours: number) => `TENDER_DEADLINE:${tenderId}:${closingAt.getTime()}:${offsetHours}`,
  security: (eventId: string) => `SECURITY:${eventId}`,
  account: (eventId: string) => `ACCOUNT:${eventId}`,
};
