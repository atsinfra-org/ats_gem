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

## 17. Backend foundation as built (Phase 2)

Authentication, authorization, organizations, and the foundational tables for tenders' taxonomy,
documents and user features. Crawling itself, AI classification, the search engine, production
notification delivery and payments are explicitly out of scope here (later phases, as documented).

### 17.1 Authentication (ADR-11)
- **Passwords**: Argon2id via `@node-rs/argon2` (napi-rs — ships prebuilt musl binaries, so it
  works on the `node:24-alpine` runtime image without a build step), 19 MiB / 2 iterations / 1
  thread, matching §5.3 exactly (spelled out explicitly in `PasswordService` rather than relying on
  the library's own defaults, so an upstream default change can never silently change hashing
  parameters). Login compares against a fixed dummy hash when the account does not exist, so "no
  such account" and "wrong password" take the same time and return the same generic
  `INVALID_CREDENTIALS` error (no user enumeration).
- **Access tokens**: JWT (`@nestjs/jwt`), HS256, `JWT_SECRET` (required at boot, >=32 chars, no
  default), `JWT_ACCESS_TTL` (default 15 min). Claims: `sub`, `org`, `roles`, `sid` (§17.4 covers the
  `org` claim's scope). Verified on every request by the global `JwtAuthGuard` — no database lookup,
  so revocation/suspension propagates on the next refresh, not instantly (documented trade-off,
  bounded by the access token's short TTL).
- **Refresh tokens**: opaque 256-bit random values, SHA-256 hashed in `sessions.refresh_token_hash`
  (the raw value is never stored), rotated on every use, `REFRESH_TOKEN_TTL_DAYS` (default 30),
  delivered as an `httpOnly`, `SameSite=Lax` cookie scoped to `/api/v1/auth`. `POST /auth/refresh`
  additionally requires `X-Requested-With: XMLHttpRequest` — a cross-site form/link/image cannot set
  a custom header, and the CORS allow-list blocks a cross-origin script from doing it without the
  origin being trusted. **Reuse detection**: presenting a refresh token whose session row is already
  revoked (rotated, logged out, or otherwise) revokes the entire rotation family
  (`sessions.family_id`) and returns `REFRESH_TOKEN_REUSED` — including for the *legitimately*
  rotated token, since once a family is flagged every token in it is untrusted.
- **Login throttling**: `LoginThrottleService` — a fixed window in Redis (`LOGIN_LOCKOUT_WINDOW_MINUTES`,
  default 15 min) tracked per IP and per email; `LOGIN_MAX_ATTEMPTS` (default 10) failures in either
  locks out further attempts with `423 ACCOUNT_LOCKED`. This is a fixed-window lockout, not the
  "progressive delay" originally sketched in §5.3 — simpler, still effective, and easy to swap later.
  Fails open (never blocks login) if Redis is unreachable.
- **Email verification / password reset**: single-use, SHA-256-hashed, expiring tokens in
  `auth_tokens` (`AuthTokenService`). Lifetimes: `PASSWORD_RESET` 30 min (short — a live account
  takeover risk if intercepted), `EMAIL_VERIFY` 24 h (long — it only flips a flag). This corrects an
  ambiguous phrase in §5.3's original draft ("30 min / 24 h") to state the mapping explicitly.
  Delivery goes through the existing `email.send` queue (Phase 1) — the API never sends mail inline.
- **Google OAuth**: schema-ready (`user_identities`, `AuthProvider.GOOGLE`) but **not implemented**
  in Phase 2 — no route exists yet. Deferred rather than half-built, since it cannot be verified
  end-to-end without real Google credentials; see docs/IMPLEMENTATION-PLAN.md.

### 17.2 Authorization (ADR-07)
Two independent axes, exactly as decided in Phase 0:
- **Staff/platform roles** (`roles`, `permissions`, `role_permissions`, `user_roles` — all data, not
  code): `SUPER_ADMIN, ADMIN, MODERATOR, CRAWLER_MANAGER, SUPPORT`. `PermissionsGuard` +
  `@RequirePermissions('key')` re-reads the database on every check rather than trusting the JWT's
  `roles` claim, so a revoked role takes effect immediately — the target design's Redis cache
  (§5.4) is deferred; these routes are low-traffic enough that a direct, indexed read is fine for now.
- **Organization roles**: `OWNER > MEMBER > VIEWER` (`organization_members.role`).
  `OrgRoleGuard` + `@RequireOrgRole('MEMBER')` accepts that role or higher, checked against the
  caller's membership in their *current* organization (§17.4).
- **Guard chain**: `JwtAuthGuard` -> `PermissionsGuard` -> `OrgRoleGuard`, registered as global
  `APP_GUARD`s in that declared order in `ApiModule` (order matters: `req.user` must exist before
  the other two can read it). Authentication is fail-closed by default — every route requires a
  valid token unless marked `@Public()` — the opposite of the more common opt-in pattern, chosen
  because a route can then never end up unauthenticated by omission.

### 17.3 Organizations (ADR-06)
Every user gets exactly one personal organization (`is_personal = true`), created in the same
database transaction as the user row at registration, with the user as `OWNER`. Team organizations
work by inviting people into that same organization — "upgrading to a team" is adding members, not
migrating data, exactly as ADR-06 intends. Invitations (`organization_invitations`) carry their own
hashed, expiring, single-use token (independent of `auth_tokens`, since an invitee may not have an
account yet) and are delivered by email the same way as auth tokens. Accepting is idempotent
(re-accepting an already-accepted invitation with the same account succeeds without erroring) and
rejects a token accepted under a different signed-in account. "Exactly one OWNER per organization"
and "one pending invitation per (organization, email)" are enforced in `OrganizationsService`, not a
database constraint — the same partial-unique-index gap noted for `tender_sources.slug` in Phase 1
(docs/DATABASE.md §10).

### 17.4 The "current organization" and switching context
An access token's `org` claim is scoped to exactly one organization at a time. Every token-issuing
flow (register, login, refresh) resolves it to the user's **personal** organization — simple and
deterministic, but on its own it would make an accepted team-organization invitation useless: the
member could never act with that membership's role. `POST /auth/switch-organization/:organizationId`
closes that gap: given a valid membership, it mints a new access token scoped to that organization,
reusing the same session (no new login, no new refresh token). This is the full extent of
organization-context switching in Phase 2 — there is no "list my organizations" endpoint yet or
UI concept of a workspace switcher; that is a frontend/product decision for a later phase.

### 17.5 Tender taxonomy, foundation and pluggable-provider forward compatibility
Pulled forward from their originally-documented phases because this phase's brief asked for them
explicitly (docs/IMPLEMENTATION-PLAN.md records the moves):
- **Taxonomy** (`states`, `districts`, `categories`, `tender_types` — Phase 3 in the original plan):
  seeded once (28 states + 8 UTs matching the crawler's own state-code map; a representative
  category tree; the 6 documented tender types). `tenders` gained *optional* FK columns
  (`category_id`, `sub_category_id`, `district_id`, `tender_type_key`, plus `slug`,
  `procurement_type`, `is_flagged`, `flag_reason`) — nullable, so the Phase 1 crawler/ingestion
  pipeline needed no changes and continues to populate none of them. `tenders.state_code` still has
  no FK to `states` (documented Phase 1 decision, kept as-is: the crawler writes it, and wiring the
  FK now would require every existing/future crawled state code to already exist in `states` before
  ingestion, an ordering dependency not worth introducing here).
- **Document metadata** (`stored_files`, `tender_documents` — Phase 6 in the original plan): the
  content-addressed shape from ADR-10, built now as pure foundation. Nothing writes to these tables
  yet (the crawler's `fetchDocuments` remains a stub); `GET /tenders/:id` returns a hard-coded empty
  `documents: []` rather than querying a table nothing populates.
- **Saved searches / watchlist / notifications** (Phase 7 in the original plan): saved searches
  store criteria as a JSON blob validated against the same shape as `GET /search/tenders`'s filters,
  scoped to the organization (a team shares them); the watchlist is scoped to the user (a personal
  shortlist, matching the "my bids" framing). Notifications are in-app records only — nothing
  delivers them over email/SMS/push, and there is no preferences/digest system yet.
- **`GET /search/tenders`**: a plain indexed-column filter (state, category, status, date ranges) —
  explicitly not the relevance-ranked `SearchProvider` engine from §9, which is unaffected and
  arrives in Phase 4/5 behind the same response shape. Anonymous callers are capped to the first,
  small page, per the original API contract.

### 17.6 Findings during Phase 2
- **Invited members had no way to act on their membership.** Every token-issuing flow resolved
  `org` to the user's personal organization; a member who accepted an invitation into a team
  organization could never present a token scoped to it. Fixed by adding
  `POST /auth/switch-organization/:organizationId` (§17.4) — found while writing the organizations
  e2e suite, not by inspection, which is exactly the kind of gap that testing through the real HTTP
  layer (not mocked services) is meant to catch.
- **Idempotent invitation acceptance was not actually idempotent.** The original implementation
  checked "already accepted" before checking "already a member", so accepting the same invitation
  twice with the same account failed on the second call instead of succeeding — the opposite of the
  documented intent. Fixed by checking for an existing membership first.
- **A test helper's race, not application code.** `test/queues.e2e-spec.ts`'s job-polling helper
  could return a BullMQ `Job` instance whose own fields (`returnvalue`, `attemptsMade`) were a stale
  snapshot from before completion, even though `getState()` — a separate query — correctly reported
  `'completed'`. Fixed by re-fetching the job once the state check passes.
- **Two Prisma `$transaction([...])` batches (Postgres, not Redis) intermittently tripped a `pg`
  driver deprecation warning** ("client.query() while already executing a query") — harmless, but
  traced to `TendersService.list()`'s count+findMany batch, which had no real atomicity requirement
  (a search page's total and rows never need to be transactionally consistent with each other) and
  was changed to two sequential calls. The genuinely atomic batches elsewhere (invitation
  create/replace, membership creation with invitation acceptance) were left as `$transaction([...])`.

## 18. Tender normalization, entity resolution and deduplication as built (Phase 3)

Cross-source duplicate detection, canonical procuring-entity resolution, tender versioning,
lifecycle/status normalization and data-quality validation, plus the read APIs to expose them. Not
in scope (unchanged from Phase 0/1's exclusions): the real crawler/scraping engine, AI
summarization/classification, payments and production notification delivery.

### 18.1 Canonical tender identity — deliberately not title-based
A tender is never identified by title. The primary key stays the surrogate `id`; the practical
identity signal for matching across sources is `(referenceNumberNormalized, procuringEntityId)`
when both are present, falling back to the fuzzy composite score in §18.3. Title alone is used only
as one signal inside that composite score, never as a standalone key — two unrelated tenders can
share a title, and the same tender is often re-titled slightly between portals.

### 18.2 Procuring-entity resolution (`EntityResolutionService`)
Layered, most-confident-first, and conservative about guessing (`src/tenders/entities/`):

1. **EXACT_SOURCE_MAPPING** — reuse a `source_entity_mappings` row already recorded for this
   `(sourceId, normalized raw name)` pair. Deterministic and idempotent by construction.
2. **EXACT_NORMALIZED_NAME** — exact match on `procuring_entities.name_normalized` (+ `state_code`).
   `normalizeEntityName()` (`entity-normalization.ts`) lower-cases, strips diacritics/punctuation and
   common legal suffixes (Pvt Ltd, LLP, Corp, ...).
3. **ALIAS** — match against a curated `procuring_entity_aliases` row (populated by admin merges,
   §18.7, or manually).
4. **FUZZY** — trigram similarity (`pg_trgm`, GIN index on `name_normalized`) within the same state
   only (or both null), threshold `0.85` (deliberately higher than the tender-dedup threshold in
   §18.3, since an incorrect entity merge is more damaging than a missed one), and only when exactly
   one candidate clears it — two or more plausible matches resolve to `null` (`ambiguous: true`,
   surfaced as a `TenderQualityIssue`), never guessed.
5. **Auto-create** — nothing matched: create a new `ProcuringEntity` (`entityType: OTHER`, refined
   later by admins) and record the mapping as `EXACT_NORMALIZED_NAME` (the enum has no separate
   "auto-created" value; after creation the normalized name is, in fact, an exact match).

Every non-ambiguous resolution upserts a `source_entity_mappings` row, so the same raw name from the
same source always resolves the same way without recomputing — this is what makes the Phase 3
backfill (§18.9) idempotent.

### 18.3 Cross-source deduplication (`DeduplicationEngine`)
Runs once per brand-new `(sourceId, externalId)` pair, inside `TenderIngestionService.ingestInTx()`,
before a new canonical `Tender` row is created:

- **Level 1 (exact)**: same `referenceNumberNormalized` + same `procuringEntityId` -> reuse the
  existing tender outright (`outcome: 'linked'`); no new `Tender` row, a second `TenderSourceRecord`
  attaches to the same canonical tender.
- **Level 2/3 (fuzzy composite)**: candidates published within +/-7 days with trigram title
  similarity >= 0.3 and (same procuring entity OR same state) are scored: `0.6 x titleSimilarity +
  0.25 (same entity) or 0.10 (same state) + 0.15 (estimated value within +/-5%)`.
  - **>= 0.90** -> auto-link (reuse the tender) and record an `AUTO_CONFIRMED` `DuplicateCandidate`
    row — auto-linking is never silent; the decision is always inspectable.
  - **0.70-0.90** -> create the new tender anyway, and also record a `PENDING` `DuplicateCandidate`
    for admin review (§18.8).
  - **< 0.70** -> create the new tender, no candidate row.

`duplicate_candidates.tender_id < candidate_tender_id` is a DB CHECK constraint, so the same pair is
never recorded twice in either order; `signals` (jsonb) always records the method, matched fields and
component scores — "why are these considered duplicates" is answerable from the row alone.

### 18.4 Tender versioning
`TenderVersion` rows store only the changed fields as `{ field: { from, to } }` (`diff`, jsonb), never
a full snapshot — version 1 is written at creation (`changeType: INITIAL`); a later ingestion that
changes any `TRACKED_FIELDS` column writes the next version, classified as `CORRIGENDUM` when
`closingAt` changed, `CANCELLATION` when the new lifecycle is `CANCELLED`, else `UPDATE`.

### 18.5 Status/lifecycle normalization
Phase 1's two-tier model (`lifecycle`: ACTIVE/CANCELLED/AWARDED/ARCHIVED, driving a derived, indexed
`status`) is kept rather than replaced with a new competing enum — it was already built, tested and
in Phase 2's API contract. `tenders.source_status_raw` was added to preserve the portal's literal
status text (e.g. "Live", "Corrigendum Issued") alongside the derived `lifecycle`, satisfying "don't
discard the source signal" without fragmenting the existing status model.

### 18.6 Data-quality validation (non-blocking)
`TenderQualityIssue` rows (`INFO`/`WARNING`/`ERROR`) are recorded during ingestion and never reject a
record: `MISSING_REFERENCE_NUMBER` (WARNING), `MISSING_ESTIMATED_VALUE` (INFO),
`AMBIGUOUS_PROCURING_ENTITY` (WARNING, §18.2 case 4), `SHORT_BIDDING_WINDOW` (INFO, < 2 days between
publish and close).

### 18.7 Entity merges — never destructive
`ProcuringEntitiesService.merge()` (permission `entity.merge`): validates against self-merge and
walks both the `mergedIntoId` and `parentId` chains (20-hop bound) to reject any merge that would
create a cycle, then in one transaction re-points `source_entity_mappings`, `tenders` and
`procuring_entity_aliases` from the losing entity onto the survivor, adds the loser's own name as an
alias of the survivor (so future exact-name lookups still resolve), and marks the loser
`status: MERGED` with `mergedIntoId` set — the row is kept forever, never deleted. Audited via the
existing Phase 2 `AuditLogService` (`PROCURING_ENTITY_MERGED`), not a new audit mechanism.

### 18.8 Duplicate-candidate review queue
`DuplicateCandidatesService` (permission `duplicate.review`): `GET /duplicate-candidates` (filter by
status), `POST /duplicate-candidates/:id/resolve` (`CONFIRMED` re-points the loser's source records
onto the canonical tender and archives it — same "never delete" discipline as entity merges;
`REJECTED` just records the decision). Not a full admin UI, per the brief's own instruction — the
minimal API the architecture requires.

### 18.9 Backfill (`node dist/main.cli.js backfill:phase3`)
Idempotent: for every non-deleted tender missing a `procuringEntityId`, resolves one from its
`department` text via the tender's own source; for every tender with zero `TenderQualityIssue` rows,
runs the same non-blocking checks ingestion does. A tender already resolved/checked is skipped, so
re-running only picks up what changed since. Verified against the real, pre-Phase-3 seeded/crawled
Docker database (25 tenders): first run resolved 24 procuring entities (one dev-seeded tender has no
`TenderSourceRecord` to resolve a source-scoped mapping from, so it is left for a future ingestion or
manual assignment) and recorded 1 data-quality issue; a second run changed nothing (`skipped: 25`).

### 18.10 Money and date normalization
`parseIndianAmount()` (`src/crawler/normalization/parsers.ts`) now also accepts Indian word-based
notation — `"10 lakh"`, `"1.5 Cr"`, `"10L"`, `"2.5 lakhs"` — scaled by exact `BigInt` arithmetic
(half-up rounding beyond 2 decimal places), never floating-point, consistent with the existing
digit-only path. Date parsing (`parseIstDateTime`) is unchanged; it already refuses to guess on
ambiguous input (throws `ParseError`).

### 18.11 Richer read APIs
`GET /tenders` gained `procuringEntity`, `district`, `minValue`/`maxValue` (exact decimal strings) and
`sortBy`/`sortOrder` filters; both list and detail responses include the resolved `procuringEntity`
summary. `GET /tenders/:id` additionally returns `versions` (§18.4), `qualityIssues` (§18.6, open
issues only) and `sourceStatusRaw`/`duplicateOfId`.

### 18.12 Partial-unique-index review (brief §26)
Reviewed all four candidates against the real Docker database before deciding:
- `organization_members`: no existing constraint prevented more than one OWNER per organization —
  added `UNIQUE (organization_id) WHERE role = 'OWNER'` (verified: every existing organization has
  exactly one owner).
- `organization_invitations`: no existing constraint prevented more than one pending invitation per
  `(organization, email)` — added `UNIQUE (organization_id, email) WHERE accepted_at IS NULL`
  (verified: zero pending invitations exist).
- `users.email`, `organizations.slug`/`gstin`: left as plain (non-partial) unique, deliberately.
  Making them partial (to allow reuse after soft-delete) requires removing Prisma's `@unique`
  attribute, which would break four existing `findUnique({ where: { email/slug } })` call sites
  (`auth.service.ts`, `seed.service.ts`, `organizations.service.ts` x2) that would need rewriting to
  `findFirst`. That is a real, isolated follow-up, not a Phase 3 blocker — deferred rather than rushed
  into an already-tested authentication path; the current plain-unique constraint is stricter than
  necessary but never unsafe.
- `tender_sources.slug`: reviewed, unchanged — Phase 1's plain-unique design ("slugs are never
  reused, even after soft deletion") is a decision, not a gap.

### 18.13 New indexes
GIN trigram indexes on `tenders.title` and `procuring_entities.name_normalized` (`type: Gin`, `ops:
raw("gin_trgm_ops")` in `schema.prisma`) back the two `similarity()` queries above.

## 19. Tender enrichment, documents and operational data as built (Phase 4)

Structured requirements, a normalized timeline, corrigenda, a real document storage abstraction,
administrative corrections, and the richer tender detail this all feeds into. **No AI, LLM, OCR,
embeddings or vector search of any kind exists anywhere in this phase** - see Sec 19.9.

### 19.1 Requirements (`TenderRequirement`)
One row per structured requirement, typed by `RequirementType` (ELIGIBILITY, FINANCIAL, TECHNICAL,
EXPERIENCE, LEGAL, REGISTRATION, DOCUMENTATION, LOCATION, PERSONNEL, EQUIPMENT, OTHER). `value`
(`Decimal(18,2)`) + `unit` (free text: "INR", "years", "similar_projects", ...) cover both money and
non-money requirements without a second numeric column. Nothing is inferred from a tender's
title/category - every row either came from a source's own structured field or was entered by an
authorized admin (`tender.update` permission). CRUD API: `GET/POST /tenders/:id/requirements`,
`GET/PATCH/DELETE /tenders/:id/requirements/:reqId` - reads public, mutations audited via the
existing `AuditLogService`.

### 19.2 Timeline (`TenderEvent`)
Normalized event history, typed by `TenderEventType` (PUBLISHED, DOCUMENT_AVAILABLE,
CLARIFICATION_OPENED, PRE_BID_MEETING, CLARIFICATION_CLOSED, SUBMISSION_OPENED,
SUBMISSION_DEADLINE, OPENING, EXTENDED, CORRIGENDUM, CANCELLED, AWARDED, OTHER). Does not replace
`tenders.published_at`/`closing_at` as the authoritative, indexed/filterable values - a matching
event row is the human-readable historical entry (an extension shows as a new `closing_at` *and* an
`EXTENDED` event). `eventAt` is nullable: a source can state a pre-bid meeting happened without an
exact timestamp, and recording the event must not be blocked on that. `TenderIngestionService` seeds
`PUBLISHED`/`SUBMISSION_DEADLINE`/`OPENING` on tender creation and an `EXTENDED` event whenever
`closingAt` changes on update; `UNIQUE(tenderId, eventType, eventAt)` makes re-observing the same
event from a re-crawl a no-op rather than a duplicate. `GET /tenders/:id/timeline` sorts
chronologically with unknown timestamps last; `PATCH /tenders/:id/timeline/:eventId` is an audited
administrative correction (`tender.update`).

### 19.3 Corrigenda (`TenderCorrigendum`)
The source's own change *notice* (title, description, published/effective dates, source URL,
optional linked document, `affectedFields` only when the source structurally states them) - distinct
from `TenderVersion` (Phase 3), which records what actually changed on the canonical row
automatically. Creating a corrigendum also idempotently records a matching `CORRIGENDUM` timeline
event, so the timeline stays the single "everything that happened" view. `GET/POST
/tenders/:id/corrigenda`, `GET /tenders/:id/corrigenda/:id`.

### 19.4 Storage abstraction (`StorageProvider`)
`src/storage/`: a small interface (`upload`/`download`/`delete`/`exists`/`getMetadata`) so callers
never build filesystem/bucket paths themselves. `LocalStorageProvider` (backs `STORAGE_DRIVER=local`,
the default everywhere - dev, test, Docker) is fully implemented and streams both directions (never
buffers a whole file in memory). Every key is checked by `assertSafeKey()` before touching disk -
rejects `..`/absolute/null-byte segments - and `LocalStorageProvider` additionally verifies the
resolved path still lands inside its configured root, so a caller-controlled key can never cause a
path-traversal read/write. `STORAGE_DRIVER=s3` is validated at config load (Phase 0:
`S3_BUCKET`/`S3_REGION` required) and the interface is shaped so an `S3StorageProvider` slots in
without changing any caller, but **no S3 client is implemented this phase** - no AWS SDK dependency
exists in the project and nothing today sets `STORAGE_DRIVER=s3`; the factory throws a clear error
rather than silently falling back to local or pretending S3 works (Sec 19.10).

### 19.5 Documents (`DocumentsService`, extends Phase 2's `stored_files`/`tender_documents`)
`StoredFile` was already content-addressed by SHA-256 (Phase 2) - Phase 4 wires an actual upload
path through it: `DocumentsService.register()` computes the checksum, sniffs the real file type from
its magic bytes (`sniffMimeType()` - PDF/JPEG/PNG/ZIP signatures; a declared `Content-Type` that
contradicts a *recognised* signature is rejected, one that doesn't match an unrecognised signature is
trusted, matching "don't trust the client alone when inspection is possible" without rejecting
legitimate types the sniffer doesn't know), uploads to storage only if that checksum isn't already
stored, and upserts `StoredFile` by checksum - two tenders (or two versions) referencing
byte-identical content share one blob, never re-uploaded. Registering the exact same bytes for the
same tender+`documentType` again is a no-op (existing `@@unique(tenderId, fileId)` row is returned
unchanged). Registering *different* bytes for a `documentType` that already has a version creates a
new row chained via the existing `supersedesId` column, `version` incremented - the older row is kept
forever, never deleted (Sec 19 "versioning"). The new `sourceDocumentId` column preserves a source's
own document identifier independent of `sourceUrl`, so a future crawler document-fetch step (Phase 6)
can reprocess a document even if the source changes its URL scheme. `GET /tenders/:id/documents`
(list, paginated), `GET .../documents/:id` (metadata), `GET .../documents/:id/download` (streams the
file directly from storage - never returns a storage key/credential, never buffers the whole file).
There is no public upload endpoint: registration is an internal operation for a future crawler
document-fetch step, consistent with Phase 1's mock crawler still not fetching documents.

### 19.6 Provenance
No new per-field provenance table (avoiding "excessive complexity" the brief explicitly warns
against) - the tender detail API's `provenance` array is built from the tender's existing
`TenderSourceRecord` rows (`sourceId`, `sourceUrl`, `firstSeenAt`/`lastSeenAt`/`lastChangedAt`),
which already answer "where did this come from" for the whole record; field-level provenance for
*what changed* is already `TenderVersion.diff` (Phase 3). Together these answer the brief's question
without a second, competing mechanism.

### 19.7 Extended data-quality checks
Two new non-blocking `TenderQualityIssue` codes added to the same Phase 3 mechanism (no second
system): `MISSING_DEADLINE` (WARNING, no `closingAt`) and `MISSING_LOCATION` (INFO, no
`stateCode`/`city`/`locationText`), plus a genuinely new integrity check, `SUSPICIOUS_EMD_VALUE_RATIO`
(WARNING, EMD amount greater than the estimated value). All three are recorded, never rejected.

### 19.8 Administrative corrections (`TenderCorrectionsService`)
`PATCH /tenders/:id/correct` (permission `tender.correct`, new): a fixed, deliberately narrow set of
canonical fields an admin may overwrite directly (title, description, estimatedValue, emdAmount,
tenderFee, closingAt, openingAt, stateCode, city, locationText) - excludes anything an automated
engine owns (`lifecycle`/`status`, `procuringEntityId`, `duplicateOfId`, `referenceNumber*`), since
correcting those belongs to their own engine (entity merge, duplicate resolution), not a generic
field patch. A `reason` is required on every call and stored in the audit log alongside the old and
new value for every changed field - via the existing `AuditLogService`, no second audit mechanism.

### 19.9 Rich tender detail (extends Phase 3's `GET /tenders/:id`)
Now also returns `documents`, `requirements`, `timeline`, `corrigenda` (each capped to 20 rows - the
dedicated, fully paginated endpoints above are the source of truth beyond that, per Sec 19.11) and
`provenance`. `GET /tenders` search filters are unchanged from Phase 3 - Phase 4 did not find a
structured-field filter (requirement type, EMD, document availability) valuable enough to justify
extending the search architecture yet, since only one crawl source exists and no document has ever
actually been fetched by it.

### 19.10 AI verification
Grepped the entire diff for `openai`, `anthropic`, `gemini`, `embedding`, `vector`, `llm`, `rag`,
`gpt` (case-insensitive): zero matches outside this sentence. No new dependency was added except the
Phase 4 code itself (no AI SDK, no vector DB client). The `sniffMimeType()` magic-byte check (Sec
19.5) is deterministic byte-signature matching, not machine learning of any kind.

### 19.11 Pagination
Every new list endpoint (`documents`, `requirements`, `timeline`, `corrigenda`) takes `page`/
`pageSize` (capped at 100, or 200 for timeline) and returns the same `meta.pagination` shape Phase 2
established - no unbounded relation is ever returned outside the capped detail-page preview (Sec
19.9).
