# ATS Gem Backend — Database Schema Plan

Engine: PostgreSQL 16+ (dev machine has 18) · ORM: Prisma · Extensions: `pg_trgm`, `citext`, `unaccent`.

Conventions:
- `id UUID` (v7) primary keys; `created_at`, `updated_at` as `TIMESTAMPTZ` on every table.
- Money: `NUMERIC(18,2)` + `currency CHAR(3) DEFAULT 'INR'`. Never float.
- Soft delete (`deleted_at TIMESTAMPTZ`, `deleted_by UUID`) on business entities where history matters (users, organizations, tenders, sources, saved searches, documents). Unique constraints on soft-deleted tables are **partial** (`WHERE deleted_at IS NULL`).
- Enums are Postgres enums for closed sets that rarely change (statuses); open-ended sets (categories, feature keys, permission keys) are lookup tables.
- Table names are `snake_case` plural; Prisma models are `PascalCase` with `@@map`.
- Timestamps are written in UTC: every connection sets `TimeZone=UTC` (see ARCHITECTURE §16.7).

---

## 0. Implemented so far

| Migration | Contents |
|---|---|
| `20260924165237_init_foundation` (Phase 0) | extensions `pg_trgm`, `citext`, `unaccent`; `app_settings` |
| `20260924173053_phase1_platform_plumbing` (Phase 1) | `outbox_events`, `job_schedules`, `tender_sources`, `crawl_runs`, `tenders` (ingestion subset), `tender_source_records`; enums `source_type`, `source_health_status`, `crawl_trigger`, `crawl_run_status`, `tender_lifecycle`, `tender_status`; CHECK constraints below |

Both migrations only add objects. CI applies them to an empty database and fails on any drift between
`schema.prisma` and the migrated database (`prisma migrate diff --exit-code`).

Phase 1 tables as built (full column lists in `prisma/schema.prisma`), and how they differ from the
target design in the sections below:

| Table | As built | Database constraints |
|---|---|---|
| `outbox_events` | as §9, plus `available_at` (retry backoff), `last_error`, `correlation_id` | index `(published_at, available_at)`; CHECK `attempts >= 0` |
| `job_schedules` | **new**: `key` UNIQUE, `queue`, `job_name`, `cron` or `every_ms`, `timezone` (default `Asia/Kolkata`), `payload JSONB`, `enabled`, `description` | CHECK exactly one of `cron` / `every_ms`; CHECK `every_ms >= 1000` |
| `tender_sources` | as §5 without credentials/sessions (Phase 5); adds `crawl_timezone`, `health_checked_at`; `health_status` gains the initial value `UNKNOWN` | `UNIQUE(slug)` (slugs are never reused, so not partial) |
| `crawl_runs` | as §5, plus `job_id` (retries resume the same run) and `correlation_id` | index `(source_id, created_at DESC)`, `(status)`; CHECK all counters `>= 0` |
| `tenders` | ingestion subset of §4: reference number (+ normalized), title, description, department, `state_code`, city, location text, `estimated_value`/`emd_amount`/`tender_fee` `NUMERIC(18,2)`, `currency`, published/closing/opening times, `lifecycle`, `status` + `status_computed_at`, `primary_source_url`, `last_synced_at`, soft delete | CHECK money `>= 0`; CHECK `closing_at >= published_at`; CHECK `currency ~ '^[A-Z]{3}$'`; CHECK `state_code ~ '^[A-Z]{2}$'`; indexes `(status, closing_at)`, `(published_at DESC)`, `(reference_number_normalized)` |
| `tender_source_records` | as §4 | `UNIQUE(source_id, external_tender_id)`; CHECK `payload_hash ~ '^[0-9a-f]{64}$'`; index `(tender_id)` |

Deliberately not yet built, arriving with their phases as additive migrations: taxonomy FKs,
`slug`, `procuring_entity_id` and the `(procuring_entity_id, reference_number_normalized)` partial
unique (Phase 3); the "closing_at required for ACTIVE" CHECK (Phase 3, once real-portal data rules
are settled — some portals publish without a deadline); `search_vector` (Phase 4); partial indexes
(`WHERE deleted_at IS NULL`, need raw SQL or Prisma's `partialIndexes` preview), `tender_versions`
and `duplicate_candidates` (Phase 3); `source_credentials`, `source_sessions`, `crawl_run_events`
(Phase 5).

---

## 1. Identity & access

| Table | Key columns | Constraints / indexes |
|---|---|---|
| `users` | `email CITEXT`, `name`, `phone`, `password_hash NULL` (null for Google-only accounts), `designation`, `avatar_file_id`, `is_email_verified`, `is_phone_verified`, `terms_accepted_at`, `terms_version`, `status ENUM(ACTIVE, SUSPENDED, PENDING)`, `last_login_at`, soft delete (staff roles via `user_roles`) | `UNIQUE(email) WHERE deleted_at IS NULL`; index `(status)` |
| `user_identities` | `user_id FK`, `provider ENUM(GOOGLE)`, `provider_user_id`, `email` | `UNIQUE(provider, provider_user_id)` |
| `sessions` | `user_id FK`, `family_id`, `refresh_token_hash CHAR(64)`, `expires_at`, `revoked_at`, `revoked_reason`, `replaced_by_id`, `ip INET`, `user_agent`, `device_label`, `last_used_at` | `UNIQUE(refresh_token_hash)`; index `(user_id, revoked_at)`; index `(family_id)` |
| `auth_tokens` | `user_id FK`, `type ENUM(EMAIL_VERIFY, PASSWORD_RESET, ORG_INVITE)`, `token_hash`, `expires_at`, `used_at` | `UNIQUE(token_hash)`; index `(user_id, type)` |
| `roles` | `key` — staff roles `SUPER_ADMIN, ADMIN, MODERATOR, CRAWLER_MANAGER, SUPPORT` (customers hold none), `name`, `is_system` | `UNIQUE(key)` |
| `permissions` | `key` (`tender.update`…), `description` | `UNIQUE(key)` |
| `role_permissions` | `role_id FK`, `permission_id FK` | PK `(role_id, permission_id)` |
| `user_roles` | `user_id FK`, `role_id FK`, `granted_by` | PK `(user_id, role_id)` |

Login-attempt counters and lockouts live in Redis (TTL-based), not Postgres.

## 2. Customer organizations

| Table | Key columns | Constraints / indexes |
|---|---|---|
| `organizations` | `name`, `slug`, `is_personal`, `gstin`, `pan`, `industry`, `company_size`, `address`, `state_code`, `city`, `website`, `contact_person`, soft delete | `UNIQUE(slug)`; `UNIQUE(gstin) WHERE gstin IS NOT NULL AND deleted_at IS NULL`; CHECK on GSTIN/PAN format |
| `organization_members` | `organization_id FK`, `user_id FK`, `role ENUM(OWNER, MEMBER, VIEWER)`, `joined_at` | PK `(organization_id, user_id)`; partial unique: one OWNER per org |
| `organization_invitations` | `organization_id`, `email CITEXT`, `role`, `token_hash`, `invited_by`, `expires_at`, `accepted_at` | `UNIQUE(organization_id, email) WHERE accepted_at IS NULL` |
| `organization_business_categories` | `organization_id`, `category_id` | PK both |
| `organization_documents` | `organization_id`, `type ENUM(GST_CERT, PAN, REGISTRATION, OTHER)`, `file_id FK stored_files`, `verification_status ENUM(PENDING, VERIFIED, REJECTED)`, `reviewed_by` | index `(organization_id)` |

## 3. Taxonomy & reference data

| Table | Key columns | Notes |
|---|---|---|
| `states` | `code CHAR(2)` PK (`MH`, `UP`, …), `name`, `type ENUM(STATE, UT)` | 28 states + 8 UTs; codes match the frontend map |
| `districts` | `state_code FK`, `name`, `lgd_code` | `UNIQUE(state_code, name)` |
| `categories` | `parent_id FK NULL`, `slug`, `name`, `industry`, `sort_order` | `UNIQUE(slug)`; two levels (category → sub-category) |
| `procuring_entities` | `name`, `name_normalized`, `type ENUM(CENTRAL_MINISTRY, STATE_DEPT, PSU, MUNICIPAL, PRIVATE, OTHER)`, `state_code NULL`, `parent_id NULL` | `UNIQUE(name_normalized, state_code)`; GIN trigram on `name_normalized` |
| `tender_types` | `key` (`OPEN`, `LIMITED`, `EOI`, `RFP`, `SINGLE`, `GLOBAL`), `name` | lookup |

## 4. Tender core

### `tenders` (canonical record)
| Column | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `slug` | TEXT | stable public identifier for URLs |
| `reference_number` / `reference_number_normalized` | TEXT | normalized = upper, stripped of spaces/punctuation |
| `title`, `title_normalized` | TEXT | normalized used for trigram dedupe |
| `description` | TEXT | |
| `procuring_entity_id` | UUID FK | issuer (ADR-05) |
| `department` | TEXT | free text as published |
| `category_id`, `sub_category_id` | UUID FK | |
| `tender_type_key` | TEXT FK | |
| `procurement_type` | ENUM(GOODS, WORKS, SERVICES, CONSULTANCY) | |
| `state_code`, `district_id`, `city`, `location_text` | | |
| `estimated_value`, `emd_amount`, `tender_fee`, `performance_security` | NUMERIC(18,2) NULL | + `currency` |
| `published_at`, `document_download_start_at`, `closing_at`, `opening_at` | TIMESTAMPTZ | `closing_at` required for ACTIVE tenders (CHECK) |
| `bid_validity_days`, `work_period_days` | INT | |
| `eligibility_criteria` | JSONB | structured list; also `terms`, `bidding_process` JSONB |
| `contact_name`, `contact_email`, `contact_phone` | TEXT | |
| `primary_source_url` | TEXT | |
| `lifecycle` | ENUM(ACTIVE, CANCELLED, AWARDED, ARCHIVED) | stored truth |
| `status` | ENUM(UPCOMING, OPEN, CLOSING_SOON, CLOSED, CANCELLED, AWARDED, ARCHIVED) | derived, denormalized by `TenderStatusService` |
| `status_computed_at` | TIMESTAMPTZ | |
| `is_flagged`, `flag_reason` | | moderation |
| `last_synced_at` | TIMESTAMPTZ | |
| `search_vector` | TSVECTOR (generated) | only used by `PostgresSearchProvider` |
| `deleted_at`, `deleted_by` | | soft delete |

Constraints: `UNIQUE(procuring_entity_id, reference_number_normalized) WHERE reference_number_normalized IS NOT NULL AND deleted_at IS NULL` (database-level duplicate prevention); CHECKs `closing_at >= published_at`, non-negative money.

Indexes (from real query patterns, all partial `WHERE deleted_at IS NULL`):
- `(status, closing_at)` — "closing soon", open lists
- `(state_code, status, closing_at)` — state filter + map drill-down
- `(category_id, published_at DESC)` — category browse
- `(procuring_entity_id, published_at DESC)` — entity pages, follows
- `(published_at DESC)` — latest first, market wire
- `(reference_number_normalized)`
- GIN `(title_normalized gin_trgm_ops)` — fuzzy dedupe
- GIN `(search_vector)` — Postgres search provider only

### Source linkage & versions
| Table | Key columns | Constraints / indexes |
|---|---|---|
| `tender_source_records` | `tender_id FK`, `source_id FK`, `external_tender_id`, `source_url`, `payload_hash CHAR(64)`, `raw_payload JSONB`, `normalized_payload JSONB`, `first_seen_at`, `last_seen_at`, `last_changed_at` | `UNIQUE(source_id, external_tender_id)`; index `(tender_id)` |
| `tender_versions` | `tender_id FK`, `version INT`, `change_type ENUM(INITIAL, UPDATE, CORRIGENDUM, CANCELLATION)`, `diff JSONB`, `source_record_id`, `detected_at` | `UNIQUE(tender_id, version)` |
| `duplicate_candidates` | `tender_id`, `candidate_tender_id`, `score NUMERIC(4,3)`, `signals JSONB`, `status ENUM(PENDING, MERGED, REJECTED)`, `reviewed_by` | `UNIQUE(tender_id, candidate_tender_id)`; CHECK `tender_id < candidate_tender_id` |

Scale note: `raw_payload` grows fastest. Past ~50 M rows or 500 GB, move raw payloads to object storage (keep the hash in Postgres) or partition `tender_source_records` by `first_seen_at` month.

## 5. Sources & crawling

| Table | Key columns | Constraints / indexes |
|---|---|---|
| `tender_sources` | `name`, `slug`, `website_url`, `description`, `source_type ENUM(GOVT_PORTAL, PSU, STATE_PORTAL, PRIVATE, AGGREGATOR, MOCK)`, `adapter_key`, `authentication_required`, `is_active`, `crawl_enabled`, `crawl_schedule` (cron string), `crawl_config JSONB` (`requestsPerMinute, maxConcurrency, minDelayMs, maxAttempts, backoffMs`), `health_status ENUM(HEALTHY, DEGRADED, AUTH_REQUIRED, NEEDS_MANUAL_ACTION, DISABLED)`, `last_successful_run_at`, `last_failed_run_at`, soft delete | `UNIQUE(slug)` |
| `source_credentials` | `source_id FK UNIQUE`, `username_ciphertext`, `password_ciphertext`, `data_key_wrapped`, `iv`, `auth_tag`, `key_version`, `rotated_at` | never selected by default; separate repository with explicit decrypt method |
| `source_sessions` | `source_id`, `cookies_ciphertext`, `expires_at`, `created_at` | latest valid session per source |
| `crawl_runs` | `source_id`, `trigger ENUM(SCHEDULE, MANUAL, RETRY)`, `triggered_by`, `status ENUM(QUEUED, RUNNING, COMPLETED, FAILED, RETRYING, CANCELLED)`, `job_id`, `correlation_id`, `started_at`, `completed_at`, `duration_ms`, `records_found`, `records_created`, `records_updated`, `records_skipped`, `documents_found`, `error_count`, `failure_reason` | index `(source_id, created_at DESC)`, `(status)`; invariant `found = created + updated + skipped + errors` (skipped = unchanged + invalid + suppressed) |
| `crawl_run_events` | `crawl_run_id`, `level`, `job_id`, `message`, `context JSONB`, `created_at` | index `(crawl_run_id, created_at)`; retention 90 days |

## 6. Documents

| Table | Key columns | Constraints / indexes |
|---|---|---|
| `stored_files` | `checksum_sha256 CHAR(64)`, `storage_provider`, `bucket`, `storage_key`, `mime_type`, `file_size BIGINT`, `original_name` | `UNIQUE(checksum_sha256)` — content-addressed dedupe |
| `tender_documents` | `tender_id FK`, `file_id FK`, `document_type ENUM(NIT, TENDER_DOCUMENT, BOQ, CORRIGENDUM, TECHNICAL_SPEC, ELIGIBILITY, ADDENDUM, TERMS, DRAWING, OTHER)`, `file_name`, `version INT`, `supersedes_id NULL`, `source_url`, `source_record_id`, `downloaded_at`, `processed_at`, `status ENUM(PENDING, DOWNLOADED, PROCESSING, PROCESSED, FAILED, QUARANTINED)`, `failure_reason`, soft delete | `UNIQUE(tender_id, file_id)`; index `(tender_id, document_type)`, `(status)` |
| `document_contents` | `file_id FK UNIQUE`, `text TEXT`, `page_count`, `language`, `ocr_used`, `extraction_ms` | keyed by file so identical PDFs are processed once |
| `document_archives` | `tender_id`, `requested_by`, `file_id NULL`, `status`, `expires_at` | "Download all" zip bundles |

## 7. User features

| Table | Key columns | Constraints / indexes |
|---|---|---|
| `watchlist_tenders` | `organization_id`, `user_id`, `tender_id`, `note` | `UNIQUE(organization_id, user_id, tender_id)`; index `(tender_id)` for closing-soon fan-out |
| `follows` | `organization_id`, `user_id`, `target_type ENUM(PROCURING_ENTITY, CATEGORY, STATE, DISTRICT, KEYWORD)`, `target_id NULL`, `target_value NULL` | `UNIQUE(user_id, target_type, COALESCE(target_id::text, target_value))` |
| `saved_searches` | `organization_id`, `created_by`, `name`, `criteria JSONB` (validated schema v1), `criteria_version`, `keywords` (indexed copy), `state_codes TEXT[]`, `category_ids UUID[]`, `is_shared`, `last_match_count`, `last_run_at`, soft delete | GIN `(state_codes)`, `(category_ids)` |
| `alerts` | `saved_search_id FK`, `user_id`, `frequency ENUM(INSTANT, DAILY, WEEKLY)`, `channels TEXT[]` (`EMAIL`, `IN_APP`, later `PUSH`, `SMS`, `WHATSAPP`), `status ENUM(ACTIVE, PAUSED)`, `last_triggered_at`, `percolator_doc_id` | index `(status, frequency)` |
| `alert_matches` | `alert_id`, `tender_id`, `event ENUM(NEW, UPDATED, CORRIGENDUM, CANCELLED, DOCUMENT_ADDED, CLOSING_SOON)`, `notified_at NULL`, `digest_id NULL` | `UNIQUE(alert_id, tender_id, event)` |
| `notifications` | `user_id`, `category ENUM(TENDER_ALERT, DEADLINE, SYSTEM, SUBSCRIPTION, ACCOUNT)`, `title`, `body`, `data JSONB` (deep link), `dedupe_key`, `read_at`, `created_at` | `UNIQUE(user_id, dedupe_key)`; index `(user_id, created_at DESC)`; partial index `(user_id) WHERE read_at IS NULL` |
| `notification_deliveries` | `notification_id`, `channel`, `status ENUM(QUEUED, SENT, FAILED, SKIPPED)`, `attempts`, `last_error`, `provider_message_id`, `sent_at` | index `(status, channel)` |
| `notification_preferences` | `user_id PK`, `email_enabled`, `in_app_enabled`, per-category toggles JSONB, `quiet_hours JSONB` | |
| `bids` | `organization_id`, `user_id`, `tender_id`, `stage ENUM(PREPARING, SUBMITTED, UNDER_EVALUATION, WON, LOST, WITHDRAWN)`, `bid_amount NUMERIC(18,2)`, `submitted_at`, `notes`, soft delete | `UNIQUE(organization_id, tender_id) WHERE deleted_at IS NULL` |

## 8. Billing

| Table | Key columns | Constraints / indexes |
|---|---|---|
| `plans` | `code` (`FREE, PRO, BUSINESS, ENTERPRISE`), `name`, `description`, `monthly_price`, `yearly_price` NUMERIC, `currency`, `is_public`, `is_active`, `sort_order`, `razorpay_plan_ids JSONB` | `UNIQUE(code)` |
| `plan_entitlements` | `plan_id`, `feature_key` (`tender_views`, `saved_searches`, `alerts`, `document_downloads`, `history_days`, `advanced_filters`, `api_access`, `team_seats`, `alert_channels`), `limit_value BIGINT NULL` (NULL = unlimited), `period ENUM(NONE, DAY, MONTH)`, `bool_value NULL` | `UNIQUE(plan_id, feature_key)` |
| `subscriptions` | `organization_id`, `plan_id`, `status ENUM(TRIALING, ACTIVE, PAST_DUE, CANCELLED, EXPIRED)`, `billing_cycle ENUM(MONTHLY, YEARLY)`, `current_period_start`, `current_period_end`, `cancel_at_period_end`, `provider`, `provider_subscription_id` | `UNIQUE(organization_id) WHERE status IN ('TRIALING','ACTIVE','PAST_DUE')`; `UNIQUE(provider, provider_subscription_id)` |
| `payments` | `organization_id`, `subscription_id`, `provider`, `provider_order_id`, `provider_payment_id`, `amount`, `currency`, `status ENUM(CREATED, AUTHORIZED, CAPTURED, FAILED, REFUNDED)`, `method`, `failure_reason` | `UNIQUE(provider, provider_payment_id)`; `UNIQUE(provider, provider_order_id)` |
| `invoices` | `organization_id`, `payment_id`, `number` (FY sequence e.g. `ATS/2026-27/000123`), `subtotal`, `gst_amount`, `total`, `currency`, `gstin_billed`, `status ENUM(DRAFT, ISSUED, PAID, VOID)`, `issued_at`, `pdf_file_id` | `UNIQUE(number)` |
| `webhook_events` | `provider`, `provider_event_id`, `event_type`, `payload JSONB`, `signature_valid`, `received_at`, `processed_at`, `processing_error` | `UNIQUE(provider, provider_event_id)` |
| `usage_counters` | `organization_id`, `feature_key`, `period_start DATE`, `count BIGINT` | `UNIQUE(organization_id, feature_key, period_start)`; increments via `INSERT … ON CONFLICT DO UPDATE` |

## 9. Platform

| Table | Key columns | Notes |
|---|---|---|
| `audit_logs` | `actor_user_id`, `organization_id`, `action` (`USER_SUSPENDED`, `TENDER_UPDATED`, …), `resource_type`, `resource_id`, `old_value JSONB`, `new_value JSONB` (redacted), `ip INET`, `user_agent`, `request_id`, `created_at` | append-only (no UPDATE/DELETE grants for the app role); index `(resource_type, resource_id)`, `(actor_user_id, created_at DESC)`, `(action, created_at DESC)`; monthly partitions once volume warrants |
| `outbox_events` | `aggregate_type`, `aggregate_id`, `event_type`, `payload JSONB`, `correlation_id`, `created_at`, `available_at`, `published_at NULL`, `attempts`, `last_error` | index `(published_at, available_at)`; relay claims rows with `FOR UPDATE SKIP LOCKED` and publishes to BullMQ; published rows deleted after `OUTBOX_RETENTION_DAYS` |
| `job_schedules` | `key`, `queue`, `job_name`, `cron` \| `every_ms`, `timezone`, `payload JSONB`, `enabled` | `UNIQUE(key)`; reconciled into BullMQ job schedulers by the scheduler process |
| `app_settings` | `key` PK, `value JSONB`, `updated_by` | admin-editable settings |
| `support_tickets` | `organization_id`, `user_id`, `subject`, `message`, `status ENUM(OPEN, PENDING, RESOLVED, CLOSED)`, `assigned_to` | |
| `contact_messages` | `name`, `email`, `subject`, `message`, `ip`, `handled_at` | public contact form; rate limited |
| `daily_tender_stats` | `date`, `state_code`, `category_id`, `source_id`, `tenders_published`, `tenders_closing`, `value_published NUMERIC` | rollup refreshed by the analytics job |
| `market_snapshots` | `computed_at`, `payload JSONB` | cached landing-page aggregates (map, value bands, top buyers) |
| `search_events` | `user_id NULL`, `query`, `filters JSONB`, `result_count`, `latency_ms`, `created_at` | search analytics; retention 180 days; partition monthly |

## 10. Migrations & data safety
- Every schema change is a reviewed Prisma migration; destructive changes go expand → migrate data → contract across releases.
- Raw SQL migrations for things Prisma can't express: partial unique indexes, CHECK constraints, generated `search_vector`, trigram indexes, append-only grants.
- Backups: managed PITR (≥7 days) + nightly logical dump to object storage; restore drill each quarter. Object storage versioning enabled on the documents bucket.
