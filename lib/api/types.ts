/** Types matching the real backend response shapes (backend/docs/API-CONTRACT.md, DTOs as source of truth). */

export interface Money {
  amount: string;
  currency: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  designation: string | null;
  avatarUrl: string | null;
  isEmailVerified: boolean;
  status: string;
  createdAt: string;
}

export interface MeProfile extends AuthUser {
  staffRoles: string[];
  organization: { id: string; name: string; slug: string; isPersonal: boolean };
}

export interface AuthSessionResult {
  accessToken: string;
  expiresIn: number;
}

export interface SessionInfo {
  id: string;
  deviceLabel: string | null;
  ip: string | null;
  userAgent: string | null;
  lastUsedAt: string;
  createdAt: string;
  current: boolean;
}

export interface CategoryRef {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  industry: string | null;
}

export interface StateRef {
  code: string;
  name: string;
  type: string;
}

export interface TenderTypeRef {
  key: string;
  name: string;
}

export interface ProcuringEntityRef {
  id: string;
  name: string;
  entityType: string;
}

export type MatchReason = "REFERENCE_EXACT" | "REFERENCE_PREFIX" | "REFERENCE_PARTIAL" | "TITLE_PHRASE" | "TITLE_TERMS" | "ENTITY" | "OTHER_FIELDS" | "FUZZY";

export interface TenderSummary {
  id: string;
  referenceNumber: string | null;
  title: string;
  department: string | null;
  procuringEntity: ProcuringEntityRef | null;
  category: { id: string; name: string } | null;
  status: string;
  state: string | null;
  city: string | null;
  estimatedValue: Money | null;
  emdAmount: Money | null;
  publishedAt: string;
  closingAt: string | null;
  isSaved: boolean;
  /** Why this tender matched the keyword/reference (only present for ranked searches). */
  matchReason?: MatchReason | null;
}

export interface TenderQualityIssue {
  severity: "INFO" | "WARNING" | "ERROR";
  code: string;
  message: string;
  detectedAt: string;
}

export interface TenderVersionEntry {
  version: number;
  changeType: string;
  diff: Record<string, { from: unknown; to: unknown }>;
  detectedAt: string;
}

export interface TenderDocumentSummary {
  id: string;
  documentType: string;
  fileName: string;
  version: number;
  status: string;
  sourceUrl: string | null;
  createdAt: string;
}

export interface TenderRequirementSummary {
  id: string;
  type: string;
  title: string;
  description: string | null;
  value: string | null;
  unit: string | null;
  isMandatory: boolean;
}

export interface TenderTimelineEntry {
  id: string;
  eventType: string;
  eventAt: string | null;
  title: string | null;
  description: string | null;
  sourceReference?: string | null;
}

export interface TenderCorrigendumSummary {
  id: string;
  title: string;
  description: string | null;
  publishedAt: string;
  effectiveAt: string | null;
  sourceUrl: string | null;
  affectedFields: string[];
  /** Present only on the dedicated /corrigenda endpoint, not in the embedded detail preview. */
  documentId?: string | null;
}

export interface TenderProvenanceEntry {
  sourceId: string;
  sourceUrl: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  lastChangedAt: string;
}

export interface TenderDetail extends TenderSummary {
  description: string | null;
  subCategory: { id: string; name: string } | null;
  tenderType: TenderTypeRef | null;
  procurementType: string | null;
  locationText: string | null;
  tenderFee: Money | null;
  openingAt: string | null;
  primarySourceUrl: string | null;
  sourceStatusRaw: string | null;
  duplicateOfId: string | null;
  documents: TenderDocumentSummary[];
  requirements: TenderRequirementSummary[];
  timeline: TenderTimelineEntry[];
  corrigenda: TenderCorrigendumSummary[];
  versions: TenderVersionEntry[];
  qualityIssues: TenderQualityIssue[];
  provenance: TenderProvenanceEntry[];
  lastSyncedAt: string;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  /** True when more than `total` tenders match - `total` is then the pageable cap, not an exact count. */
  totalCapped?: boolean;
}

export interface WatchlistItem {
  userId: string;
  tenderId: string;
  note: string | null;
  createdAt: string;
}

/**
 * Current criteria are list-valued and include every search filter; pre-Phase-7 saved searches hold single
 * strings for state/category/status. `fromCriteria` (lib/search/search-state.ts) reads both.
 */
export type SavedSearchCriteria = Record<string, string | string[] | undefined>;

export interface SavedSearch {
  id: string;
  organizationId: string;
  createdBy: string;
  name: string;
  criteria: SavedSearchCriteria;
  /** Alerts are opt-in: OFF (default), IMMEDIATE or DAILY digest. */
  alertFrequency: SavedSearchAlertFrequency;
  createdAt: string;
  updatedAt: string;
}

export type NotificationType = "SAVED_SEARCH_MATCH" | "TENDER_UPDATED" | "TENDER_DEADLINE" | "TENDER_CORRIGENDUM" | "TENDER_CANCELLED" | "TENDER_STATUS_CHANGED" | "SECURITY" | "ACCOUNT";
export type NotificationPriority = "LOW" | "NORMAL" | "HIGH" | "CRITICAL";

export interface AppNotification {
  id: string;
  /** Known types are listed in NotificationType; older rows may carry other text. */
  type: string;
  title: string;
  message: string;
  entityType: string | null;
  entityId: string | null;
  /** False when the linked tender was removed: the UI must not render a link. */
  entityAvailable: boolean;
  priority: NotificationPriority;
  metadata: Record<string, unknown>;
  isRead: boolean;
  readAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export type NotificationCategory = "SAVED_SEARCH_ALERTS" | "SAVED_TENDER_UPDATES" | "DEADLINE_REMINDERS" | "CORRIGENDA" | "STATUS_CHANGES" | "SYSTEM";

export interface NotificationPreferences {
  categories: Record<NotificationCategory, { inApp: boolean; email: boolean; locked: boolean }>;
  deadlineOffsetsHours: number[];
  allowedDeadlineOffsetsHours: number[];
  quietHours: { enabled: boolean; start: string | null; end: string | null; timezone: string };
}

export type SavedSearchAlertFrequency = "OFF" | "IMMEDIATE" | "DAILY";

export interface OrganizationDetail {
  id: string;
  name: string;
  slug: string;
  isPersonal: boolean;
  gstin: string | null;
  pan: string | null;
  industry: string | null;
  companySize: string | null;
  address: string | null;
  stateCode: string | null;
  city: string | null;
  website: string | null;
  contactPerson: string | null;
  createdAt: string;
}

export interface OrganizationMember {
  userId: string;
  organizationId: string;
  role: "OWNER" | "MEMBER" | "VIEWER";
  createdAt: string;
  user: { id: string; name: string; email: string; avatarUrl: string | null };
}

export interface ProcuringEntity {
  id: string;
  name: string;
  nameNormalized: string;
  shortName: string | null;
  entityType: string;
  stateCode: string | null;
  city: string | null;
  status: "ACTIVE" | "MERGED" | "INACTIVE";
  mergedIntoId: string | null;
  createdAt: string;
}

export interface DuplicateCandidate {
  id: string;
  tenderId: string;
  candidateTenderId: string;
  score: string;
  signals: Record<string, unknown>;
  status: "PENDING" | "CONFIRMED" | "REJECTED" | "AUTO_CONFIRMED";
  reviewedBy: string | null;
  reviewedAt: string | null;
  notes: string | null;
  createdAt: string;
  tender: { id: string; title: string };
  candidateTender: { id: string; title: string };
}

export interface SourceRef {
  id: string;
  name: string;
  slug: string;
}

export interface DistrictRef {
  id: string;
  name: string;
  stateCode: string;
}
