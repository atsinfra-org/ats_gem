# ATS Gem Backend — Architecture

Status: **Approved (2026-09-24)** — Phase 0 implemented · Scope: production backend for the ATS Gem tender aggregation & procurement intelligence platform.

Companion documents:
- [DATABASE.md](./DATABASE.md) — schema plan, constraints, indexes
- [API-CONTRACT.md](./API-CONTRACT.md) — endpoints, DTOs, errors, pagination
- [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md) — phased delivery and acceptance criteria

---

## 1. Repository findings (inputs to this design)

| Finding | Consequence |
|---|---|
| Frontend (Next.js 16) lives at the repo root on `dev`; `main` holds only an empty initial commit. | Backend goes in `backend/` on `main`. When the frontend and backend meet on one branch, the frontend `tsconfig.json`/ESLint must exclude `backend/` (two one-line changes, documented in §15). |
| Frontend data access is already isolated in `lib/api/*.ts` (mock implementations) and `lib/types.ts`. | The API contract is derived from those call sites; swapping mocks for `fetch` calls is a contained frontend task. |
| No `.env` files, no secrets, no existing backend. | Nothing to migrate; `.env.example` is created from scratch. |
| Local machine: Node 22, PostgreSQL 18 installed natively; **Docker not installed**. | Docker Compose is still the reference dev environment, but the backend must also run against native Postgres with Redis, a Postgres-backed search provider and local-disk storage (see §12). |
| Frontend features not in the original backend brief: Google sign-in, "My Bids" tracker, public market data (landing map, wire, closing board), support/contact forms, company KYC documents. | Added as modules: `auth/google`, `bids`, `market`, `support`, `organizations/documents`. |

---

## 2. Architecture decisions (ADR summary)

Each decision is final unless flagged **(needs approval)**.

| # | Decision | Why |
|---|---|---|
| ADR-01 | **One NestJS codebase, multiple process entrypoints**: `main.api.ts` (HTTP), `main.worker.ts` (BullMQ consumers, selectable by `WORKER_QUEUES`), `main.scheduler.ts` (repeatable-job registrar), `main.crawler.ts` (Playwright workers, separate image). | Shared domain code without duplication; each process scales and deploys independently. Playwright's ~1 GB image stays out of the API image. |
| ADR-02 | **Repo layout: `backend/` folder, developed on `main`** (approved). Frontend stays on `dev` untouched; both remain independently deployable. | Least churn for the frontend; the backend has no build-time dependency on frontend files. |
| ADR-03 | **PostgreSQL is the source of truth; OpenSearch is a derived read model.** Writes go to Postgres; indexing flows through a transactional **outbox** → BullMQ `search.indexing`. | Search can be rebuilt from Postgres at any time; no dual-write inconsistency. |
| ADR-04 | **`SearchProvider` interface** with `OpenSearchProvider` (production) and `PostgresSearchProvider` (FTS + `pg_trgm`, used for local dev without Docker, tests and degraded mode). | Search is a core feature and must work on the current dev machine; the interface keeps business code provider-agnostic. |
| ADR-05 | **Two distinct "organization" concepts**: `procuring_entities` (who *issues* tenders — NHAI, PWD) vs `organizations` (customer company accounts). | The brief uses "organization" for both; conflating them corrupts both data models. |
| ADR-06 | **Every user has a workspace organization** (auto-created personal org on signup). Subscriptions, saved searches, watchlists and usage attach to the organization. | One billing/sharing model for individuals and teams; upgrading to a team is adding members, not migrating data. |
| ADR-07 | **Roles ≠ plan entitlements** (approved). `FREE_USER`/`PREMIUM_USER` are removed; paid-feature access comes only from the organization's subscription and usage via `EntitlementsService`. **Platform roles** (staff): `SUPER_ADMIN, ADMIN, MODERATOR, CRAWLER_MANAGER, SUPPORT` — ordinary customers hold none. **Organization roles**: `OWNER` (members, billing, settings), `MEMBER` (full product use), `VIEWER` (read-only). Authorization answers two independent questions: RBAC "may this user do this?" and entitlements "does this organization's plan include this?". | Tying billing to roles creates drift (role says premium, subscription says expired). Entitlements have one source of truth. |
| ADR-08 | **Tender status = stored lifecycle + derived timeline status.** `lifecycle` (`ACTIVE, CANCELLED, AWARDED, ARCHIVED`) is stored; `status` (`UPCOMING, OPEN, CLOSING_SOON, CLOSED`, or the lifecycle value when not ACTIVE) is computed by `TenderStatusService` and denormalized to a column by a periodic job for filtering/indexing. | Satisfies "don't rely only on stored status" while keeping status filterable and indexable. |
| ADR-09 | **Ingestion is layered and idempotent**: raw source record (hashed) → normalized record → dedupe decision → canonical `tenders` upsert. Canonical tenders link to N `tender_source_records`. | Same tender from several portals becomes one tender with multiple sources; re-running a job is a no-op when the payload hash is unchanged. |
| ADR-10 | **Documents are content-addressed** in object storage (`files/{sha256[0..1]}/{sha256}`); `stored_files` is unique by checksum, `tender_documents` references it. | Free cross-tender dedupe, immutable objects, safe retries. |
| ADR-11 | **Refresh tokens are opaque, hashed, rotated, with reuse detection** (token families). Access tokens are short-lived JWTs (15 min). Refresh token travels in an `HttpOnly; Secure; SameSite=Lax` cookie scoped to `/api/v1/auth`. | Stolen refresh tokens are detected on reuse and the whole family is revoked; XSS cannot read the refresh token. |
| ADR-12 | **Alert matching uses OpenSearch percolator** (saved-search queries stored as percolator docs; each new/updated tender is percolated). Postgres provider falls back to batch matching. | Scales to hundreds of thousands of saved searches without N×M query loops. |
| ADR-13 | **Per-source rate limiting in Redis** (token bucket + concurrency semaphore keyed by source), independent of BullMQ global limits. | A slow or strict portal can never starve other sources or be overloaded. |
| ADR-14 | **Money is `NUMERIC(18,2)` in Postgres, `Prisma.Decimal` in code, string in JSON** (`"12500000.00"`), always with `currency` (default `INR`). | No float rounding; JSON consumers cannot silently lose precision. |
| ADR-15 | **IDs are UUIDv7** (time-ordered). Human-facing references (invoice numbers, public tender slugs) are separate columns. | Index locality for high-volume tables; no enumerable integer IDs in URLs. |
| ADR-16 | **Toolchain**: **Node 24 LTS** baseline (`.nvmrc`, `engines >=24.11`, `node:24-alpine`, CI) since Phase 1; NestJS 12 (ESM packages consumed from a CommonJS app, as in the official template), build with `tsc`, tests with **Vitest + SWC**, Prisma 7 with the `@prisma/adapter-pg` driver adapter and `prisma7.config.ts`; database sessions pinned to `TimeZone=UTC`. | Phase 0 ran on Node 22.13, where the Nest 12 CLI and Jest could not load Nest's ESM; Node 24 removes those limits. `tsc` + Vitest were kept because they are simple and identical in Docker and CI. The UTC session pin fixes a real shift found in Phase 1 (see §16.7). |
| ADR-17 | **Initial production target: AWS** (approved) — ECS/Fargate for api/worker/scheduler/crawler services, RDS PostgreSQL, ElastiCache (Redis/Valkey), S3, Amazon OpenSearch Service, Secrets Manager injected as env vars, CloudFront for the frontend and signed document delivery where useful. Application code stays provider-agnostic behind the storage, search, queue, email and payment interfaces. | Managed services with PITR/backups and horizontal scaling; no AWS SDK calls outside the provider adapters. |

---

## 3. Process topology

```text
                ┌───────────────┐   HTTPS (REST /api/v1, SSE)
 Browser ──────►│  Next.js web  │───────────────┐
                └───────────────┘               ▼
                                   ┌──────────────────────────┐
                                   │  api  (main.api.ts)       │  stateless, N replicas
                                   │  auth · RBAC · validation │
                                   └──┬──────────┬──────────┬─┘
                     reads/writes     │          │ enqueue  │ query
                                      ▼          ▼          ▼
                               PostgreSQL     Redis      OpenSearch
                               (+outbox)    (BullMQ,     (tenders,
                                   ▲         cache,      percolator)
                                   │         limits)         ▲
            ┌──────────────────────┼────────────┬────────────┘
            │                      │            │
 ┌──────────┴─────────┐ ┌──────────┴───────┐ ┌──┴───────────────────┐
 │ scheduler           │ │ worker            │ │ crawler (Playwright) │
 │ repeatable jobs per │ │ documents, search │ │ discovery, tender,   │
 │ source schedule     │ │ indexing, alerts, │ │ documents, auth      │
 └─────────────────────┘ │ email, analytics  │ └──────────┬───────────┘
                         └────────┬──────────┘            │
                                  ▼                        ▼
                           Object storage (S3 / R2 / MinIO / local disk in dev)
```

- `api` never runs Playwright, PDF parsing or email sending inline.
- `worker` can be split further by queue (`WORKER_QUEUES=document.processing,search.indexing`) without code changes.
- `scheduler` may run as several replicas; a Redis leader lock picks one to reconcile, and BullMQ job schedulers are idempotent, so jobs are registered once (see §16.4).

---

## 4. Module map (NestJS)

```text
backend/
├── prisma/                      schema.prisma · migrations/ · seed.ts
├── src/
│   ├── main.api.ts · main.worker.ts · main.scheduler.ts · main.crawler.ts
│   ├── app.module.ts            composition per entrypoint (ApiModule, WorkerModule, …)
│   ├── config/                  typed config + zod env validation (fails fast on boot)
│   ├── common/                  envelope interceptor, exception filter, request-id, pagination, decorators
│   ├── database/                PrismaService, transaction helper, outbox writer
│   ├── queues/                  queue names, typed job payloads, producers, retry policies
│   ├── storage/                 MediaStorageService + s3 / r2 / minio / local-disk drivers
│   ├── security/                crypto (AES-256-GCM envelope), hashing, signed-url helpers
│   └── modules/
│       ├── auth/                register, login, refresh, sessions, email verify, reset, google oauth
│       ├── users/               profile, preferences, avatar
│       ├── rbac/                roles, permissions, PermissionsGuard, policy helpers
│       ├── organizations/       customer orgs, members, invitations, KYC documents
│       ├── entitlements/        plan limits, usage counters, EntitlementGuard
│       ├── tenders/             canonical tenders, lifecycle, status service, similar tenders
│       ├── procuring-entities/  buyers (NHAI, PWD…), name normalization
│       ├── taxonomy/            categories, states/districts, tender types
│       ├── sources/             tender sources, encrypted credentials, crawl config
│       ├── ingestion/           normalizers, dedupe engine, canonical upsert
│       ├── crawler/             engine, adapter registry, adapters/*, rate limiter, run history
│       ├── documents/           metadata, download pipeline, text extraction, OCR, archives
│       ├── search/              SearchProvider (opensearch | postgres), indexer, facets
│       ├── market/              public aggregates: snapshot, wire, closing board
│       ├── watchlists/          saved tenders, follows
│       ├── saved-searches/
│       ├── alerts/              alert rules, matching engine (percolator)
│       ├── notifications/       in-app, email channel, deliveries, SSE stream
│       ├── bids/                bid tracker (frontend "My Bids")
│       ├── billing/             plans, subscriptions, payments, invoices, razorpay, webhooks
│       ├── analytics/           rollups, dashboard aggregates
│       ├── support/             tickets, contact messages
│       ├── admin/               admin-only controllers composing the modules above
│       ├── audit/               audit log writer + query
│       └── health/              liveness/readiness, /metrics
├── test/                        unit (colocated *.spec.ts), integration, e2e, fixtures/
├── docker/                      Dockerfile.api, Dockerfile.crawler, opensearch templates
├── docker-compose.yml · .env.example · README.md
```

Layering inside a module: `controller` (HTTP only) → `service` (business rules, transactions) → `repository` (Prisma queries) with DTOs at the edge and mappers to response schemas. Controllers contain no business logic.

---

## 5. Cross-cutting concerns

### 5.1 Request pipeline
`helmet` → CORS allow-list → request-id (from `X-Request-Id` or generated; stored in AsyncLocalStorage) → rate limiter → auth guard (JWT) → `PermissionsGuard` → `EntitlementGuard` → `ValidationPipe` (whitelist, forbidNonWhitelisted, transform) → controller → response envelope interceptor → exception filter.

### 5.2 Response & error format
All responses use the envelope in [API-CONTRACT.md §1](./API-CONTRACT.md). The global exception filter maps domain errors (`AppError(code, httpStatus, message, details?)`) and Prisma errors (e.g. `P2002` → `CONFLICT`) to stable error codes. Stack traces are logged, never returned outside `NODE_ENV=development`.

### 5.3 Authentication
- Password hashing: **Argon2id** (memory 19 MiB, iterations 2, parallelism 1; tunable via config).
- Access JWT: 15 min, `HS256` with `JWT_SECRET` (rotatable via `kid`), claims `sub, org, roles, sid`.
- Refresh: 30 days sliding, opaque 256-bit token, SHA-256 hash stored in `sessions`; rotation on every use; presenting a revoked token revokes the whole family and forces re-login.
- Email verification / password reset: single-use hashed tokens (`auth_tokens`), 30 min / 24 h expiry.
- Google sign-in: server-side OAuth 2.0 authorization-code flow with PKCE and `state`; links to an existing account only when Google reports `email_verified`.
- Login protection: per-IP and per-account sliding windows in Redis; progressive delay, temporary lock after N failures; generic error messages (no user enumeration).

### 5.4 Authorization
- Permissions are data (seeded `permissions`, `role_permissions`); a role's permission set is cached in Redis and invalidated on change.
- `@RequirePermissions('tender.update')` on handlers; `PermissionsGuard` evaluates. Resource-level checks (e.g. "member of this org") live in policy classes (`OrganizationPolicy.canManageMembers(user, org)`), not controllers.
- Plan limits: `@RequiresEntitlement('saved_searches')` + `EntitlementsService.consume()` inside services for counted features.

### 5.5 Configuration & secrets
Typed config validated with zod at boot; the process refuses to start with a missing or malformed variable. Secrets only from environment or a secret manager. Crawler credentials use envelope encryption: AES-256-GCM with a data key per record, wrapped by `CREDENTIALS_MASTER_KEY` (KMS-ready, `keyVersion` stored for rotation).

### 5.6 Idempotency
| Operation | Mechanism |
|---|---|
| Crawler ingestion | `UNIQUE(source_id, external_tender_id)` + payload hash; unchanged hash → skip |
| Document download | `UNIQUE(stored_files.checksum)`; `UNIQUE(tender_id, file_id)` |
| Search indexing | document `_id = tender.id`, version = `tender.updated_at` (external versioning) |
| Alert matching | `UNIQUE(alert_id, tender_id, event)` in `alert_matches` |
| Notifications | `dedupe_key` unique per user |
| Payment webhooks | `UNIQUE(provider, provider_event_id)` in `webhook_events`; processed in a transaction |
| BullMQ jobs | deterministic `jobId` (e.g. `doc:{tenderId}:{sourceUrlHash}`) |
| Client mutations | optional `Idempotency-Key` header on POSTs to billing endpoints, stored 24 h in Redis |

### 5.7 Caching (Redis)
Tender detail (5 min, busted by outbox event), filter/facet metadata (1 h), market snapshot (5 min), role permissions, source config, rate-limit counters, crawler session state. Redis is never the source of truth.

### 5.8 Observability
- Logging: `pino` via `nestjs-pino`, JSON, fields `timestamp level service requestId userId route statusCode durationMs`; crawler logs add `sourceSlug jobId crawler tenderRef`. A redaction list strips `password, token, authorization, cookie, credentials, secret` paths.
- Metrics: `prom-client` at `/metrics` (internal network only): HTTP latency/errors, queue depth/age, job duration/outcome per queue, crawler success/failure per source, DB/search/storage latency, email failures.
- Tracing: OpenTelemetry SDK wired but exporter disabled by default.
- Errors: Sentry-compatible hook behind `ERROR_TRACKING_DSN` (optional).
- Queue UI: Bull Board mounted under `/admin/queues`, `SUPER_ADMIN` only.

---

## 6. Crawler architecture

### 6.1 Adapter contract
```ts
interface SourceAdapter {
  readonly slug: string;                       // 'gem', 'cppp', 'mh-etender', 'mock'
  initialize(ctx: CrawlContext): Promise<void>;
  authenticate(ctx: CrawlContext): Promise<AuthResult>;          // NOT_REQUIRED | OK | NEEDS_MANUAL_ACTION | FAILED
  search(ctx: CrawlContext, cursor?: string): Promise<DiscoveryPage>; // listing refs + next cursor
  fetchTender(ctx: CrawlContext, ref: TenderRef): Promise<RawTender>;
  fetchDocuments(ctx: CrawlContext, raw: RawTender): Promise<RawDocumentRef[]>;
  normalize(raw: RawTender): NormalizedTender;                    // pure, unit-tested with fixtures
  healthCheck(ctx: CrawlContext): Promise<HealthResult>;
}
```
`CrawlContext` provides a rate-limited HTTP client and/or Playwright page, the source's decrypted credentials (in memory only), a logger bound to `{source, jobId}` and an abort signal. Adapters register via a decorator; the engine resolves by `source.slug` and knows nothing source-specific.

### 6.2 Queues and job flow
```text
scheduler ──(per-source repeatable job)──► crawler.discovery
crawler.discovery  → paginates search(), enqueues crawler.tender per new/changed ref
crawler.tender     → fetchTender → normalize → ingestion (dedupe + upsert, outbox) → enqueue crawler.documents
crawler.documents  → download → stored_files → enqueue document.processing
crawler.authentication → login/session refresh; on NEEDS_MANUAL_ACTION: pause source, alert admins
document.processing → validate → extract text → (OCR if needed) → outbox → search.indexing
search.indexing    → upsert/delete in OpenSearch, then percolate → alerts.matching
alerts.matching    → create alert_matches → notifications
notifications      → in-app record + fan-out to email queue per preferences
email              → provider send (SMTP / SES / Resend / SendGrid)
analytics          → rollup refresh
```
Every step is its own job and independently retryable (brief §49).

### 6.3 Retry classification
| Error class | Policy |
|---|---|
| Network / timeout / 5xx | exponential backoff with jitter (base 30 s, factor 2, max 5 attempts) |
| 429 / explicit rate limit | delayed retry honoring `Retry-After`; also lowers the source's token rate for the run |
| Auth failure | no retry; mark run `FAILED(AUTH)`, set source `AUTH_REQUIRED`, notify `CRAWLER_MANAGER` |
| CAPTCHA / MFA detected | no retry, no bypass; source → `NEEDS_MANUAL_ACTION` |
| Parse / normalization failure | retry once (layout flake), then dead-letter with the raw payload stored for debugging |
| Invalid tender (fails validation) | skip, count `recordsSkipped`, log reason |

Max attempts and delays are per-source config with global defaults. Dead-lettered jobs are visible and retryable from the admin API.

### 6.4 Politeness & compliance
Per-source `requestsPerMinute`, `maxConcurrency`, `minDelayMs`, respect for `robots.txt` where applicable, identifiable User-Agent. The platform must not bypass CAPTCHA, MFA, paywalls or access controls; sources are added only after their terms of use are reviewed **(needs approval: which sources, and who reviews ToS)**. Phase 5 ships only a `MockSourceAdapter` backed by fixtures.

### 6.5 Duplicate detection
1. **Deterministic**: same `(source_id, external_tender_id)` → same source record. Same normalized `reference_number` + same `procuring_entity_id` → same canonical tender.
2. **Fuzzy candidates** (only when deterministic keys don't match): same procuring entity or state, `similarity(title_norm) ≥ 0.6` (pg_trgm), published within ±7 days, value within ±5 %. Score ≥ 0.9 → auto-link; 0.7–0.9 → `duplicate_candidates` for moderator review; below → new tender.
3. Merges never delete data: source records are re-pointed and the merge is audit-logged and reversible.

---

## 7. Document pipeline

```text
download (stream, size cap, content-type sniff) → sha256 → stored_files (dedupe) → tender_documents
  → validate (magic bytes, page count, encrypted?) → text extraction (pdf.js)
  → if chars/page below threshold: queue OCR (Tesseract worker, optional, lower priority)
  → document_contents (text, page count, language, ocr_used) → outbox → search.indexing
```
Formats: PDF (full pipeline); XLS/XLSX BOQs (cell text extraction); ZIP (entries listed, recursive processing capped by depth/size); DOC/DOCX (text extraction). Corrigenda create new `tender_documents` versions and emit `DocumentAdded`/`CorrigendumPublished` events.

## 8. Media storage abstraction
`MediaStorageService` with `upload(stream, key, meta)`, `download(key)`, `delete(key)`, `exists(key)`, `getSignedUrl(key, {expiresIn, disposition})`, `getMetadata(key)`. Drivers: `s3` (AWS S3, Cloudflare R2 and MinIO are all S3-API compatible and differ only in endpoint/region config) and `local` (dev only, signed URLs served by an HMAC-verified API route). Private bucket; downloads only via short-lived signed URLs (default 5 min) issued after authorization and entitlement checks (download counter).

## 9. Search
- Index `tenders_v{n}` behind alias `tenders`; zero-downtime reindex by building `v{n+1}` and swapping the alias.
- Fields: title/description/procuring entity (analyzed, English + Indic-friendly standard analyzer, `search_as_you_type` subfield), `reference_number` (keyword + normalized), category/state/district/city/source/type/status (keyword), values (scaled_float, paise precision), dates, `documents_text` (analyzed, excluded from `_source`).
- Relevance: `multi_match` with boosts (title^4, reference^6, entity^2, category^2, description^1, documents_text^0.5) + exact-phrase support via quotes + recency and closing-date decay functions for the "relevance" sort.
- Facets: terms aggregations for state, category, source, type, status; range aggregations for value and EMD.
- Pagination: page-based for the UI (capped at 10 000 hits), `search_after` cursor for deep pagination and exports.

## 10. Notifications
Domain events (`TenderCreated`, `TenderUpdated`, `CorrigendumPublished`, `TenderCancelled`, `DocumentAdded`, `ClosingSoon` from a daily sweep) → matching engine → `notifications` + per-channel `notification_deliveries`. Channels: in-app (persisted, pushed live over SSE `GET /notifications/stream`), email (queued, provider abstraction, digest batching for daily/weekly alerts), push (interface reserved). Never sent inside HTTP handlers.

## 11. Billing
Plans and entitlements are data (`plans`, `plan_entitlements`); no limits in code. Razorpay: server creates order/subscription, client completes checkout, server verifies the payment signature (`POST /payments/verify`) and treats the **webhook** as authoritative. Webhooks: raw-body HMAC verification, idempotent `webhook_events`, state machine on `subscriptions`. GST-compliant invoice numbering (per financial year sequence) and PDF generation in a worker. `PaymentProvider` interface for future providers.

---

## 12. Environments & deployment

| Env | Infra |
|---|---|
| **Local (Docker)** | `docker compose up`: postgres, redis, opensearch, opensearch-dashboards (optional profile), minio, mailpit (SMTP catcher), api, worker, scheduler, crawler |
| **Local (no Docker)** — fallback | Native PostgreSQL; Redis (or run only `postgres redis` from Compose); `SEARCH_PROVIDER=postgres`; `STORAGE_DRIVER=local`; `EMAIL_DRIVER=log`. Docker Desktop is the primary dev environment (approved), but no everyday task hard-requires it. |
| **Staging / Production** | AWS (ADR-17): container images (`api`, `worker`, `crawler`) on ECS/Fargate; RDS PostgreSQL with PITR backups, ElastiCache, Amazon OpenSearch Service, S3. Migrations run as a one-off release task using the image's `migrate` target (`prisma migrate deploy`), never on app boot. |

Horizontal scaling: API is stateless; workers scale per queue; crawler concurrency is bounded per source by Redis limits, not by replica count.

## 13. Security checklist (implemented across phases)
Helmet · strict CORS allow-list · DTO validation everywhere · Prisma parameterized queries (raw SQL only via tagged templates) · output encoding (JSON only; rich text sanitized) · rate limits per audience/endpoint class · Argon2id · encrypted crawler credentials, write-only in APIs · signed short-lived media URLs · upload MIME/size validation · audit log for admin actions (no secrets in old/new values) · secure cookies for refresh tokens with CSRF protection (SameSite + Origin check + custom header on `/auth/refresh`) · no stack traces in production responses · dependency and container scanning in CI.

## 14. Risks and open questions

| Item | Owner | Notes |
|---|---|---|
| Legal/access review of each tender portal before its adapter is built | Product/legal | Phase 5 ships the mock adapter only. Each real portal needs a completed review record (template below) first. |
| Google OAuth client, Razorpay test keys, SMTP account | You | Needed from Phase 2 / 8; placeholders in `.env.example`. |

### Portal onboarding review (required before any real adapter)
For every portal, record in `docs/sources/<slug>.md` and get sign-off before implementation:
authentication requirements · official APIs/feeds and their terms · website terms of use · robots.txt and other access restrictions · published or observed rate limits · CAPTCHA/MFA presence · whether automated access is permitted (and under what conditions) · document download restrictions · data retention/redistribution limits · contact/escalation for the portal operator. CAPTCHA, MFA and access-control bypasses are out of scope permanently.

## 15. Frontend requirements review (Phase 0)
Cross-check of the `dev` frontend against this design. Items marked *frontend change* are small, coordinated changes to make at integration time. The frontend is not modified during backend phases.

| # | Finding | Resolution |
|---|---|---|
| 1 | Register form has a terms checkbox that is not persisted anywhere. | `users.terms_accepted_at` + `terms_version`; `POST /auth/register` requires `acceptTerms: true`. *Frontend change:* send the flag. |
| 2 | Alert form offers SMS and WhatsApp channels. | Accepted values today: `EMAIL`, `IN_APP`. `SMS`, `WHATSAPP`, `PUSH` are reserved and return `422 CHANNEL_NOT_AVAILABLE` until implemented. *Frontend change:* disable or hide those options. |
| 3 | No frontend pages for email-verification links, password-reset links or the OAuth callback. | *Frontend change:* add `/verify-email?token=`, `/reset-password?token=` and `/auth/callback` routes. They are small forms or redirects that call the documented endpoints. |
| 4 | Frontend money fields are numbers; tender status values are lower-case; `state` is a string. | API uses `Money` objects, UPPER_SNAKE enums and `{code, name}` (API contract §14). *Frontend change:* adapt in `lib/api` mappers only; components keep their current shapes. |
| 5 | Org roles in the brief have no org-level "admin". | Org roles are `OWNER`/`MEMBER`/`VIEWER` (ADR-07); endpoints previously marked `org:ADMIN` require `org:OWNER`. |
| 6 | Saved tenders, saved searches, alerts and notifications are held only in client state. | Backed by `/watchlist`, `/saved-searches`, `/alerts` and `/notifications` (Phase 7). |
| 7 | Admin "Sources" page shows a success rate. | Derived from `crawl_runs` over a rolling 7-day window; no stored column. |
| 8 | Landing map needs 28 states + 8 UTs with codes matching the SVG geometry. | `states` table seeded with the same codes and a `type` column (`STATE`/`UT`). |

When frontend and backend share a branch: add `"backend"` to the frontend `tsconfig.json` `exclude` array and `"backend/**"` to `globalIgnores` in `eslint.config.mjs`.

---

## 16. Platform plumbing as built (Phase 1)

This section records what Phase 1 actually implemented. Where it refines an earlier section, this
section wins.

### 16.1 Processes
| Process | Composition root | Consumes queues | Background loops | Health |
|---|---|---|---|---|
| api | `ApiModule` | never | none | `:PORT/health/{live,ready,queues}` |
| worker | `WorkerModule` | handlers present in the process, filtered by `WORKER_QUEUES` | outbox relay | `:HEALTH_PORT (4001)/health/{live,ready}` |
| scheduler | `SchedulerAppModule` | never | schedule reconciliation (leader only) | `:HEALTH_PORT (4002)/health/{live,ready}` |
| cli | `CliModule` | never | none | — |

Handlers are Nest providers marked `@JobProcessor('<job name>')`. `WorkerHost` discovers them at
startup and starts one BullMQ `Worker` per queue that has handlers, so the API image can never
consume jobs by accident. Shutdown: on SIGTERM, `beforeApplicationShutdown` stops the relay and
workers, waiting up to `WORKER_SHUTDOWN_TIMEOUT_MS` for in-flight jobs; jobs still running after that
are released and retried (BullMQ stalled-job recovery, `maxStalledCount: 1`). Only then are Prisma,
Redis and queue connections closed (`onApplicationShutdown`).

### 16.2 Queues
| Queue | Jobs | Attempts | Backoff base | Concurrency / worker | Keep completed / failed |
|---|---|---|---|---|---|
| `crawler.discovery` | `crawler.discover-source`, `crawler.finalize-run` | 3 | 30 s | 2 | 1 d / 14 d |
| `crawler.tender` | `crawler.ingest-tender` | 5 | 10 s | 5 | 1 d / 14 d |
| `document.processing` | `document.process` (consumer in Phase 6) | 5 | 30 s | 2 | 1 d / 14 d |
| `search.indexing` | `search.index-tender` | 8 | 5 s | 10 | 1 d / 7 d |
| `notifications` | `notification.dispatch` (consumer in Phase 7) | 5 | 10 s | 10 | 1 d / 7 d |
| `email` | `email.send` | 6 | 30 s | 5 | 1 d / 7 d |
| `maintenance` | `maintenance.outbox-cleanup`, `maintenance.sources-health-check` | 3 | 60 s | 1 | 7 d / 30 d |
| `dead-letter` | `dead-letter.record` — never consumed | 1 | — | — | 30 d / 30 d |

- **Typed payloads**: one zod schema per job name (`queues/job.registry.ts`). The producer validates on
  enqueue and the runner validates again before a handler runs (payloads cross a process boundary
  and some are authored in the database). Payloads carry IDs and small facts, never secrets.
- **Envelope**: `{ payload, meta: { correlationId, origin } }`, origin ∈ api · worker · scheduler · outbox · cli · test.
- **Retries**: exponential backoff with ±20 % jitter from the queue's base. A `PermanentJobError`
  (bad payload, unknown job, missing source, unrecoverable data) skips remaining attempts.
- **Dead letter**: when a job fails for the last time, the runner adds a `dead-letter.record` job
  (`dlq.<queue>.<jobId>`) with queue, job name, id, attempts, reason, time, payload and correlation id.
  The original also stays in its queue's failed set. Records wait for inspection/replay from the
  admin API (Phase 5).
- **Idempotency**: deterministic job IDs wherever a job can be produced twice —
  `evt.<eventId>.<job>` (outbox), `ingest.<runId>.<sha256(externalId)[0..32]>`, `finalize.<runId>`,
  `dlq.<queue>.<jobId>`, `manual.<sourceId>.<uuid>`. BullMQ ignores an add whose ID exists within
  the retention window, and every handler is itself idempotent (hash-checked upserts, absolute counters).
- **Queue health**: `GET /health/queues` and `cli queues:status` report per queue: waiting, active,
  delayed, prioritized, waiting-children, failed, completed, paused, connected workers and the age of
  the oldest waiting job.

### 16.3 Transactional outbox
Services call `OutboxService.record(tx, type, payload)` inside the same Prisma transaction as the
business change, so an event exists if and only if the change committed. Event types:
`tender.created · tender.updated · tender.closed · document.created · user.created ·
organization.created · subscription.changed · payment.completed` (zod-validated payloads; IDs and
changed-field names only). The request/job correlation ID is stored with each event.

The relay runs in every worker replica: each tick locks up to `OUTBOX_BATCH_SIZE` due rows with
`FOR UPDATE SKIP LOCKED`, enqueues the routed jobs, and marks the rows published in the same
transaction. Failures increment `attempts`, store `last_error` and push `available_at` out
exponentially (1 s → 10 min, ±20 %); three consecutive failures end the batch early (the queue
backend is probably down). Delivery is at-least-once; the deterministic job ID makes duplicate
publication harmless. Events without a consumer yet are marked published and kept for audit and
replay; `maintenance.outbox-cleanup` deletes published rows after `OUTBOX_RETENTION_DAYS`.

### 16.4 Scheduler
The desired schedule set lives in PostgreSQL: `job_schedules` rows (platform jobs: cron **or**
interval, timezone, validated payload, enabled flag) plus one crawl schedule per active,
crawl-enabled `tender_sources` row with a `crawl_schedule`. Nothing about any portal is hard-coded.
Every `SCHEDULER_SYNC_INTERVAL_MS` the leader (Redis lock `<prefix>:scheduler:leader`, TTL 3 ×
interval) reconciles them into BullMQ job schedulers `sched.<key>` / `crawl.<sourceId>`: creates new
ones, updates changed ones, removes managed ones no longer wanted, and reports rows it rejects
(unknown job, wrong queue, invalid payload) or that BullMQ refuses (e.g. an invalid cron). BullMQ
then enqueues each job on time; the scheduler never runs work itself. Each firing gets correlation
ID `schedule.<schedulerId>.<jobId>`.

### 16.5 Mock crawl pipeline
```text
scheduler ─ crawl.<sourceId> ─► crawler.discovery: discover-source
   opens crawl_run (locks the source row: one active run per source) → adapter.search() pages
   └─► BullMQ flow:  crawler.tender: ingest-tender × N  ──►  crawler.discovery: finalize-run
         fetchTender → normalize → zod-validate            children tolerate failure; parent
         → TenderIngestionService (one transaction):       aggregates child results into the
             create | unchanged (hash) | update             run counters and source health
             + outbox tender.created / updated / closed
                          └─► relay ─► search.indexing: index-tender
```
Records that fail normalization are counted as skipped, not retried. Retries resume the same crawl
run (keyed by job ID). The `MockSourceAdapter` is deterministic, uses only the reserved `.invalid`
TLD, and can simulate flaky fetches, invalid records, revisions and an unavailable portal.

### 16.6 Observability
Every job log line carries `queue, jobName, jobId, attempt, maxAttempts, correlationId` plus entity
and source IDs from the job's `logContext` (the email recipient is deliberately excluded). The runner
logs `job started` (with queue latency), `job completed` (duration, small result summary),
`job failed; will retry` and `job failed permanently` (duration, error class and message). Crawl
runs persist status, timings, counters and the failure reason. Connection-error warnings are
throttled to one per 30 s per component. Redaction covers passwords, tokens, secrets, credentials,
API keys and authorization/cookie headers; email variable *values* are never logged.

### 16.7 Findings during Phase 1
- **Timestamp shift on non-UTC Postgres servers.** `@prisma/adapter-pg` sends offset-less UTC
  timestamps; a server whose `TimeZone` is `Asia/Calcutta` stored them 5 h 30 m early relative to
  SQL `now()` (Prisma round-trips hid it). Found by the outbox backoff test; fixed by opening every
  connection with `-c TimeZone=UTC`; covered by a regression test. RDS defaults to UTC, but the fix
  makes correctness independent of server configuration.
- **Prisma import extensions in Docker.** Without `importFileExtension`, the `prisma-client`
  generator infers it from a `tsconfig.json` and falls back to `.ts` when none is visible — as in the
  Docker `deps` stage, where `postinstall` generates before tsconfig is copied. Generated files are
  `@ts-nocheck`, so `tsc` emitted `require("./internal/class.ts")` and every container failed at the
  first Prisma import. Fixed by `importFileExtension = "js"`; the runtime stage now loads the
  compiled client during `docker build`, so a broken client fails the build.
- **Container logging / storage.** Containers log JSON (`LOG_FORMAT=json`; `pino-pretty` is a
  devDependency absent from the runtime image), and `/app/storage` is created owned by `node` so the
  `storage-data` volume is writable.
