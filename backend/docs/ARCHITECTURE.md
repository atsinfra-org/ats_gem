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
**Superseded by Sec 20 (Phase 7).** The original design sketched here was an OpenSearch index with an alias-swap reindex, `multi_match` boosts and facet aggregations. It was evaluated against the Phase 7 audit evidence and not adopted: search is PostgreSQL-native (weighted `tsvector` + `pg_trgm`), and the reindex idea survives as the resumable `search:reindex` / `search:verify` commands. Revisit OpenSearch only on the measured thresholds in Sec 20.1 / 20.12 (or when document-text search arrives).

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

## 20. Search & discovery as built (Phase 7)

Phase 7 evolves the Phase 3 filter endpoint into the search system. `GET /search/tenders` keeps its path, envelope and every Phase 2-6 parameter (single values still work), and there is exactly one search implementation (`SearchService`).

### 20.1 Architecture decision: PostgreSQL-native, OpenSearch not required

Evidence (audit before design): `pg_trgm` was already installed; OpenSearch existed only as an unimplemented provider stub and an unused compose profile; the corpus is a single table (target scale here: hundreds of thousands of rows); every field to rank on lives in Postgres; and a second store would need a sync/reconciliation path and its own failure modes.

Decision: a weighted `tsvector` (`simple` config: no stemming or stop-words, so identifiers, Hindi/Indic tokens and names are never mangled) maintained by a trigger, plus `pg_trgm` GIN indexes for typo tolerance and reference matching. `SEARCH_PROVIDER=opensearch` still fails at boot ("not implemented") rather than silently degrading. Revisit OpenSearch when measured p95 for the Sec 20.12 scenarios exceeds their thresholds at the real corpus size, or when document-text (OCR) search arrives - not before.

Trade-offs accepted: no language stemming, no learned ranking, ranking is bounded (Sec 20.4), counts are capped (Sec 20.6). In exchange: transactional consistency (a tender is searchable in the same transaction that changes it), zero new infrastructure, and fully explainable ranking.

### 20.2 Index model and lifecycle

- `tenders.search_vector tsvector`, built by `tender_search_vector_build(tenders)` with weights **A** title + reference, **B** department + procuring-entity name, **C** category / sub-category and city / location / state name, **D** tender-type name. A `BEFORE INSERT OR UPDATE OF <indexed columns>` trigger keeps it current, so ingestion, dedup, admin corrections and entity re-linking need no extra step.
- The trigger cannot see changes in *other* tables (renaming a category or an entity). The existing `search.index-tender` job therefore calls `SearchIndexService.refreshTender(id)`, which recomputes the row (idempotent, retried by the queue).
- Deleted (`deleted_at`) and duplicate (`duplicate_of_id`) tenders are excluded at query time, so delete, archive and dedup never leave stale hits and nothing has to be removed from the index.
- Rebuild: `node dist/main.cli.js search:reindex [--batch N] [--resume]` recomputes every row in id-ordered batches (default 2 000, resumable from the last cursor of a FAILED run), records a `search_index_runs` row, and is safe to re-run. `search:verify` compares stored vectors with a fresh computation and reports missing / stale counts. `GET /search/health` returns counts and the last run only (no connection details).
- Migration `20260926090000_phase7_search` adds the column, function, trigger, backfill and indexes in one step. Large tables should run `search:reindex` after deploy rather than rely on the in-migration backfill.

### 20.3 Query normalization and safe construction

`normalizeQuery`: NFKC, control characters removed, whitespace collapsed, lower-cased for matching, tokens = Unicode letter/digit runs (so `road-construction`, `PWD/2026/0012` and `road,construction!` tokenize alike). Stop-words are **not** dropped (that would silently change intent). Max 200 characters after normalization (longer is a 400), 12 tokens, 40 characters per token. The `tsquery` string is assembled only from sanitized tokens (`token:*` joined by `&`) and passed as a bound parameter; user-typed `& | ! <-> ( ) :` are separators, never syntax. Every value reaches SQL as a bound parameter (`Prisma.sql`); the only interpolated SQL is a fixed constant map (sort order, tier weights). `LIKE` patterns are built from the alphanumeric reference key only.

### 20.4 Ranking (deterministic, explainable)

A match is classified into the first tier that applies. The tier is returned as `matchReason` and is the score's dominant term.

| Tier (`matchReason`) | Weight | Rule |
|---|---|---|
| `REFERENCE_EXACT` | 1000 | normalized reference equals the query key (>= 3 chars) |
| `REFERENCE_PREFIX` | 600 | reference starts with the key |
| `REFERENCE_PARTIAL` | 350 | reference contains the key (>= 4 chars) |
| `TITLE_PHRASE` | 300 | the whole query appears in the title as typed |
| `TITLE_TERMS` | 200 | every query term is a prefix of a title word |
| `ENTITY` | 120 | terms match the procuring entity / department |
| `OTHER_FIELDS` | 60 | terms match category, location or tender type |
| `FUZZY` | 10 | typo-tolerant only (plus `20 x word_similarity` inside the tier) |

Within a tier, results order by `published_at DESC, id DESC` (recency, then a unique tie-break), so the same query and data always give the same order. `ts_rank_cd` was evaluated and **removed**: with prefix queries it cost about 40 us per row (roughly 6x the rest of the query at 500 000 rows) for a marginal in-tier ordering gain. Without a keyword or reference, `sort=relevance` is reported as `newest` (`meta.sort`, `meta.ranked=false`).

Two bounded-cost rules, both measured (Sec 20.12):

1. **Fuzzy fallback.** Typo-tolerant matching (`<%` word similarity >= 0.55 on the title) is added only when strict matching returns fewer than 3 rows, so common queries never pay for the trigram scan.
2. **Rank window.** Relevance scores at most the 20 000 newest matches (2 000 in fuzzy mode) plus exact reference matches; a query matching more than that ranks within the window. Non-relevance sorts do not score at all, and `matchReason` is computed only for the rows of the returned page.

### 20.5 Filters, sorting and date semantics

Filters (list-valued ones take `a,b` or repeated params, max 20-40 values): `state`, `district`, `city` (case-insensitive exact), `category` (a parent also matches its children, expanded server-side), `procuringEntity`, `tenderType`, `status`, `source` (via `tender_source_records`), value / EMD / fee ranges, published / closing / opening date ranges, and `reference`. Only fields backed by real data exist; there is no fake facet. The UI offers every filter, including `district` and `city` (Sec 20.13). District data is only present where a source supplies it, so the district control explains an empty list rather than hiding.

Money is compared as `::numeric` in the database against exact decimal strings (`^\d{1,16}(\.\d{1,2})?$`), never as JS floats, inclusive at both ends. **Dates are IST calendar days**: a date-only `from` means 00:00 IST inclusive, a date-only `to` means the *next* day 00:00 IST exclusive (so `to=2026-10-31` includes all of 31 October IST); a full ISO-8601 instant is used as given, inclusive. Inverted ranges are a 400 (`VALIDATION_FAILED`). Sorts: `relevance | newest | closingSoonest | closingLatest | valueHigh | valueLow` (legacy `sortBy` / `sortOrder` still map onto them). Every sort ends in `published_at DESC, id DESC` so ties are stable.

### 20.6 Pagination

Offset pagination with a documented bound: results are counted up to **10 000** (`meta.pagination.totalCapped=true` when more match, `total` is then the cap) and offsets >= 10 000 return `400` with detail code `PAGE_TOO_DEEP`, so no request can force an unbounded scan. Ties are broken by id, so pages are stable and duplicate-free for unchanged data (verified in e2e). Cursor pagination is deliberately deferred (it is needed only for exports). Anonymous callers still get page 1 with at most 20 rows (unchanged Phase 6 behaviour).

### 20.7 Suggestions

`GET /search/suggestions?q=` returns, from real data only: the caller's own recent searches, reference-number prefix matches, procuring entities, categories, states and **popular** terms. Popular terms come from `search_history` aggregated over the last 30 days and are shown only when at least 3 *distinct users* searched them (k-anonymity), so one user's history is never exposed to another. Input under 2 characters returns only the caller's recents. `GET /search/entities?q=` is the server-side organization picker (min 2 characters, 10 results).

### 20.8 Search history and privacy decision

Only authenticated users' searches are stored (`search_history`); **anonymous searches are never stored**. One row per (user, hash of normalized query + filters) with a counter, so repeats do not create rows; capped at 200 per user (oldest dropped). Stored: the normalized query and the filter subset. Not stored: IP, user-agent, tokens, result contents. Users list, delete one and clear all of their own history (`GET` / `DELETE /search/history`, scoped by user id; another user's id returns 404). History is written best-effort and never blocks or fails a search; only page 1 of keyword / reference searches is recorded, so paging does not inflate counts.

### 20.9 Analytics foundation (events only)

`POST /search/events` (public, rate limited, 202) appends to `search_events`: `SEARCH_SUBMITTED, FILTER_APPLIED, FILTER_REMOVED, SORT_CHANGED, RESULT_OPENED, RESULT_SAVED, SEARCH_SAVED, SUGGESTION_SELECTED`. The DTO is a closed shape (type, normalized query, short name / value, tender id, position, result count): no free-form payload, so events cannot become an exfiltration or PII sink, and unknown properties are rejected. There is no FK to users (events outlive accounts) and no IP. Retention is enforced (Sec 20.13): events older than `SEARCH_EVENT_RETENTION_DAYS` (default 180) are purged daily. There is no dashboard. The UI emits every type except `RESULT_SAVED` (the save button lives inside `TenderCard` and is not wired to events yet).

### 20.10 Failure handling and security

Statement timeout 8 s per search transaction. Any database failure becomes `503 DEPENDENCY_UNAVAILABLE` with a generic message (no SQL, column or host text; verified by renaming the column in an e2e test), while browsing without a keyword keeps working. Search endpoints use the `search` rate-limit policy (`RATE_LIMIT_SEARCH_MAX` 240 / `RATE_LIMIT_SEARCH_WINDOW_SECONDS` 60, per IP and route). The UI degrades independently: a suggestion failure never blocks submitting, a history failure shows a retryable error, a search failure shows the shared retryable error view.

### 20.11 Frontend behaviour and the login-gated search decision

The Phase 6 decision stands: the tender search **page** sits inside the authenticated app shell, so anonymous visitors cannot reach it in the UI (they are redirected to the landing page). The API endpoint itself remains public (page 1, at most 20 rows), which is why anonymous behaviour is documented and tested but not exposed in the UI. Impact: there is no anonymous search history or personalization to consider, and a future public search page would need its own product decision on abuse limits and SEO.

Search state is URL-backed (`q`, list filters, ranges, dates, `sort`, `page`): back / forward, reload and shared links restore it. Invalid values are dropped, reported in an on-page notice and removed from the URL, and the pre-Phase-7 `?keyword=` link format is still accepted. The search box is an ARIA 1.2 combobox; results carry the API's `matchReason` as a badge; active filters are removable chips; organizations are searched server-side; on phones the filters open in a bottom sheet. Saved searches store the same criteria model and still read legacy single-string criteria.

### 20.12 Measured performance (synthetic dataset)

Method: `backend/scripts/search-benchmark.cjs` against a scratch database (`ats_gem_bench`, dropped afterwards; the script refuses any database whose name does not contain "bench"). Dataset: 500 000 clearly synthetic tenders (`BENCH/...` references, a 30-word vocabulary, 3 000 entities, 20 categories, 5 sources, 10 states) in Postgres 17 (Docker, developer machine). 60 timed iterations after 3 warm-ups per scenario, page size 20, timings are service-level (excluding HTTP). The vocabulary is small and repetitive, so common terms match a large share of the table: this is a **worst case for broad queries**, not typical data. Loading the data through the trigger took 196 s (about 2 550 rows/s); `search:reindex` re-indexed all 500 000 rows in 100.5 s (4 973 rows/s, 100 batches).

Final results (ms):

| Scenario | matches | p50 | p95 | p99 |
|---|---|---|---|---|
| browse, no query (newest) | 10 000+ | 6.4 | 9.7 | 12.2 |
| keyword "road construction" | 4 166 | 69.4 | 87.0 | 120.5 |
| keyword prefix "constr" | 10 000+ | 164.7 | 212.7 | 311.6 |
| keyword, rare multi-term (no strict result, fuzzy fallback) | 0 | 115.1 | 144.4 | 159.1 |
| typo "constructon" (fuzzy) | 10 000+ | 359.7 | 398.0 | 408.5 |
| reference exact, no match (fuzzy fallback) | 0 | 278.3 | 311.1 | 336.3 |
| reference partial | 0 | 3.5 | 4.6 | 4.7 |
| filter state | 10 000+ | 28.3 | 34.3 | 38.7 |
| state + status + value range | 10 000+ | 124.5 | 168.8 | 194.5 |
| category (parent expansion) | 10 000+ | 52.7 | 61.0 | 63.9 |
| procuring entity | 166 | 4.5 | 7.5 | 8.4 |
| source | 10 000+ | 32.8 | 35.1 | 38.6 |
| closing date range (IST) | 359 | 5.5 | 6.9 | 7.2 |
| keyword + state + status, sort closingSoonest | 10 000+ | 222.2 | 434.6 | 511.9 |
| keyword + sort valueHigh | 10 000+ | 164.9 | 189.0 | 201.0 |
| deep page (page 200) | 10 000+ | 193.9 | 260.3 | 336.3 |
| no match | 0 | 4.4 | 5.4 | 5.9 |

Throughput (query "road construction"): 10 concurrent clients 44.6 req/s (p50 210 ms, p95 301 ms, p99 356 ms); 25 concurrent 44.7 req/s (p50 550 ms, p95 667 ms, p99 730 ms), no errors. The mix saturates the database CPU at about 45 req/s on the test machine; the default per-IP API limit (240/min) is far below that.

Before / after: the first implementation measured 690 ms p50 for "road construction", 1 928 ms for "constr", 2 301 ms for page 200, and 11 req/s with 8 s statement timeouts (503s) at 10-25 concurrent clients. Changes that fixed it, each measured: the strict-first fuzzy fallback (removed a 16 000-row trigram bitmap from common queries), weight-restricted `tsquery` on the stored vector instead of re-parsing `to_tsvector(title)` per row, removing `ts_rank_cd`, the rank window, and computing `matchReason` only for the returned page. The statement-timeout 503 path was exercised for real by the pre-fix run.

Thresholds (per-scenario p95 at 500 000 rows on this hardware; rationale: interactive search should feel immediate, and slower-than-a-second queries must at least be bounded): browse / filter-only <= 250 ms, keyword <= 500 ms, fuzzy <= 750 ms, any scenario <= 1 s. All measured p95 values are within those thresholds (worst: 434.6 ms for keyword + filters + closing sort). The real corpus is expected to be smaller and less repetitive; re-run the script against production-sized data before relying on these numbers. Known cost centres: keyword + broad filter + non-relevance sort, and the fuzzy fallback on zero-result queries (both under 0.6 s here).

Index evidence (`EXPLAIN ANALYZE` on the same data): the strict keyword count uses a `Bitmap Index Scan on tenders_search_vector_gin_idx` (4 166 rows in 27 ms); reference `LIKE` and title similarity use `tenders_reference_norm_trgm_idx` and `tenders_title_trgm_idx`; browsing uses the partial `tenders_published_id_idx`.

### 20.13 Phase 7 gap closure (final sign-off pass)

**District and city filters (UI).** Both use the existing `FilterPanel` / URL-state architecture: list-valued, removable chips, "Clear all", URL + reload + back/forward persistence, saved-search criteria and history, desktop panel and mobile bottom sheet. Data availability was audited first: in the dev database `districts` is empty and no tender carries a `district_id` (the mock source supplies only a city), while `city` is populated. Therefore: the **district** control lists real rows from `GET /meta/districts` (narrowed to the selected states) and shows explicit loading / error / "no district data is available from the current sources" states instead of pretending; the **city** control is a server-side lookup, `GET /search/cities?q=&state=` (min 2 characters, 20 results, distinct case-insensitive names of live tenders with counts, optionally scoped to one state), so no city list is hardcoded or duplicated on the client. City values are matched exactly, case-insensitively (`lower(city)` index); a city name containing a comma cannot be expressed in the comma-separated form (documented limitation; none exist in current data). Up to 20 cities and 40 districts per query.

**Organization label for shared URLs.** `GET /search/entities?ids=<uuid,uuid>` resolves display names for at most 20 valid ids (junk ignored). The search view calls it once for ids that have no label yet, so a shared link or saved search now shows "Organization: <name>" instead of a generic label. No preload architecture was added.

**Search-event retention.** `maintenance.search-events-purge` follows the `maintenance.outbox-cleanup` convention: an empty-payload job on the `maintenance` queue, handled by `SearchEventsPurgeHandler` in the worker, scheduled by a seeded `job_schedules` row (`search-events-purge`, daily 04:15 IST, editable/disable-able like every platform schedule). `SearchEventsPurgeService.purge()` deletes `search_events` rows with `created_at < now - SEARCH_EVENT_RETENTION_DAYS` (default 180, range 1-3650) in batches of 5 000: each batch is a separate short statement using `FOR UPDATE SKIP LOCKED`, so it never holds a long lock, does not block the inserts search traffic produces, and concurrent or repeated runs are safe (a rerun deletes nothing). It logs a structured `search event purge completed` line (deleted, batches, retentionDays, cutoff, durationMs) or a structured error, and returns the same summary as the job result. Manual run: `node dist/main.cli.js search:purge-events`. Only `search_events` is touched; `search_history` is user-managed and unaffected.

**Retained as-is (evaluated, not expanded).**
- *20 000-match rank window* - a scalability bound, not a correctness bug: queries with at most 20 000 matches are ranked exactly; broader ones rank the newest 20 000 (plus exact reference matches), which is also what the 10 000-result pagination cap already exposes to users. Measured at 500 000 rows (Sec 20.12). Kept and documented.
- *Zero-result fuzzy fallback* (about 0.12-0.3 s at 500 000 rows, within the fuzzy threshold of 750 ms) - only runs when strict matching finds fewer than 3 rows; the trigram index is used; no low-risk optimization that preserves relevance behaviour was identified. Unchanged.
- *Cursor pagination* - not needed; the 10 000 cap is safe and documented (Sec 20.6). Deferred until exports need it.
- *`nest build` failure* - environmental: `engines` and `.nvmrc` require Node >= 24.11 while the failing shell runs Node 22.13, where the Nest CLI's ESM dependency (`ora`) hits `ERR_REQUIRE_CYCLE_MODULE`. The project's `npm run build` deliberately uses `tsc -p tsconfig.build.json` (README), which is what CI and Docker (Node 24) run. No repository change.

## 21. Notifications & alerts as built (Phase 8)

Phase 8 builds the alert pipeline on the infrastructure that already existed: the transactional outbox (Sec 16.3), the BullMQ queues/workers/scheduler, the `notification.dispatch` and `email.send` job definitions, the `EmailTransport` abstraction with its log driver, the `notifications` table, saved searches (Phase 2/7) and the watchlist. Nothing was duplicated: there is still exactly one event mechanism (the outbox), one queue layer, one scheduler and one search implementation.

### 21.1 Flow

```
domain change (same DB transaction) -> outbox_events row
  -> relay -> notification.dispatch job (queue "notifications")
  -> NotificationEventProcessor: load event, recipients (watchlist + saved-search matcher), plans
  -> NotificationDeliveryService.deliverMany: preferences -> existing-dedup -> in-app cap -> in-app records (unique per user+event)
       -> email decision (preference, verified address, digest, caps, quiet hours) -> notification_deliveries row
  -> notification.email job (queue "email")  -> NotificationEmailHandler -> EmailTransport (provider) -> status
  scheduled: notification.deadline-sweep (15 min) creates reminders; notification.send-digests (daily 08:00 IST) folds waiting alerts
```

Generation is always asynchronous: no HTTP request creates or sends a notification (the API only reads and updates the caller's own rows and preferences). A crash between commit and queue add cannot lose an event (outbox), a retried job cannot duplicate one (Sec 21.10), and a lost email queue message is re-queued by the sweep (Sec 21.9).

### 21.2 What existed vs what was added

Existing and reused: `outbox_events` + relay + routes, `OutboxService.record`, job registry/`QueueProducer`/worker host/retry policy per queue, `job_schedules` + scheduler + `SeedService` default schedules, `EmailTransport` + `LogEmailTransport`, `AuditLogService`, `SavedSearch`, `WatchlistItem`, `Notification`, the Phase 6 notification bell/page. Added: migration `20260927090000_phase8_notifications` (Sec 21.13), the notification domain code in `src/notifications/`, two domain events (`tender.corrigendum_created`, `user.security_event`), three jobs (`notification.email`, `notification.deadline-sweep`, `notification.send-digests`), routes from tender events to the already-declared `notification.dispatch` job, saved-search `alertFrequency`, and the frontend upgrades (Sec 21.12).

### 21.3 Event sources (what actually produces notifications)

Only events the current backend really emits are consumed:

| Domain event | Emitted by | Used for |
|---|---|---|
| `tender.created` | ingestion (mock crawl / any adapter through `TenderIngestionService`) | saved-search alerts |
| `tender.updated` (+ `tender_versions` diff) | ingestion change detection | saved-tender updates, cancellation |
| `tender.closed` | ingestion status transition | saved-tender status change |
| `tender.corrigendum_created` | `CorrigendaService.create` (staff API, same transaction) | corrigendum alerts |
| `user.security_event` | `AuthService` (password change/reset, email verification, same transaction) | security/account notifications |
| time (schedule) | `notification.deadline-sweep` | deadline reminders |

Because production crawlers are deferred (Phase 5), **alerts fire for tenders that enter the system through the ingestion pipeline or, in development/tests, through controlled fixtures that write the same outbox events. This phase does not claim that government-portal changes will generate alerts automatically.** Verified end to end against the Docker stack with tagged fixtures (Sec 21.15).

### 21.4 Notification types

Closed list in `notification-types.ts`; each has a real producer. `type` stays a text column (open set), but every writer validates against the list.

| Type | Category (preference) | Priority | Template | Emailed |
|---|---|---|---|---|
| `SAVED_SEARCH_MATCH` | SAVED_SEARCH_ALERTS | NORMAL | saved-search-match | yes |
| `TENDER_UPDATED` | SAVED_TENDER_UPDATES | NORMAL | tender-update | yes |
| `TENDER_DEADLINE` | DEADLINE_REMINDERS | HIGH | deadline-reminder | yes |
| `TENDER_CORRIGENDUM` | CORRIGENDA | HIGH | tender-corrigendum | yes |
| `TENDER_CANCELLED` | STATUS_CHANGES | HIGH | tender-update | yes |
| `TENDER_STATUS_CHANGED` (closed) | STATUS_CHANGES | NORMAL | tender-update | yes |
| `SECURITY` (password changed/reset) | SYSTEM (locked) | CRITICAL | system-security | yes, cannot be disabled |
| `ACCOUNT` (email verified) | SYSTEM (locked) | NORMAL | system-security | in-app only |

Not implemented because nothing produces them: `NEW_TENDER` (distinct from a saved-search match), `TENDER_CLOSING_SOON` (covered by deadline reminders), generic `SYSTEM` messages, `SAVED_TENDER_DEADLINE` (same as `TENDER_DEADLINE`). Priorities: CRITICAL bypasses quiet hours and email caps and cannot be turned off; HIGH is shown with an "Important" label; the list is ordered by time.

### 21.5 Saved-search alerts: matching architecture

Requirement: a saved search must match exactly what the same search lists in Phase 7, and matching must not run every search for every tender.

- **Same semantics, one implementation.** `SearchService.strictMatchWhere(criteria)` builds the very WHERE that `search()` applies (shared `prepare()` normalization/validation, `buildWhere`, category expansion, IST date bounds, exact-decimal money) - it is not a second matcher. The one deliberate difference: the typo-tolerant fallback is defined relative to a result set ("only when strict finds fewer than 3 rows") and therefore has no meaning for a single-tender match, so alerts match the strict semantics. This is verified by a test that compares "matcher says yes" with "strict search lists it" across 13 criteria shapes (state lists, status, category parent->child, value range, closing date range, keyword, reference, city, entity, combined) and 4 tenders.
- **Scale.** Per `tender.created` event: one query loads alert-enabled searches (active search, creator ACTIVE and still a member of the search's organization, `alert_frequency <> OFF`); searches with identical criteria (canonical hash) are evaluated once; each distinct criteria set becomes `EXISTS (SELECT 1 FROM tenders t WHERE t.id = <the tender> AND <strict where>)` - a primary-key lookup, never a table scan; up to 50 criteria sets are evaluated per statement (`UNION ALL`) and 4 statements run concurrently. Cost is O(distinct criteria) primary-key lookups per event.
- **Robustness.** A stored criteria set that no longer validates, or fails in the database, is skipped and logged; it cannot stop other users' alerts (tested).
- **Recipients.** The saved search's creator (searches are organization-shared, alerts are personal), one notification per user per tender even when several of their searches match (the first by name is cited, up to 3 names stored). Alerts are **opt-in per search** (`alert_frequency` default `OFF`), so existing searches never start emailing.
- **Updates.** Saved-search users are also eligible for corrigendum alerts on matching tenders (they are the users with a stated interest). They do not receive per-field update alerts; that is reserved for users who saved the tender.

### 21.6 Which tender changes notify

Worth notifying (saved-tender updates): `title`, `closingAt`, `openingAt`, `estimatedValue`, `emdAmount`, `tenderFee`, `lifecycle` (cancellation). Deliberately not: `description`, `city`, `locationText`, `sourceUrl`, `currency`, `publishedAt`, `referenceNumber`, `department`, `stateCode`, and internal metadata - they would train users to ignore alerts. A deadline change is described from the recorded `tender_versions` diff ("The closing date is now 20 Nov 2026, was 1 Oct 2026"). Cancelled tenders produce `TENDER_CANCELLED` instead of a generic update; a closed tender produces `TENDER_STATUS_CHANGED`.

### 21.7 Deadline reminders

A scheduled sweep (every 15 minutes) looks at saved tenders (watchlist) that are ACTIVE, not deleted/duplicate, not closed/cancelled/awarded/archived, and have a real `closing_at` in the future within 7 days. Each user chooses offsets from 7 days / 3 days / 1 day / 3 hours (default: **1 day only**; an empty list disables reminders). For each row the reminder that fires is the smallest offset that still covers the remaining time, so a tender with 3 days left triggers the "3 days" reminder once (not the passed "7 days"), and one saved with 5 hours left triggers only the smallest applicable offset. Dedup key = tender + exact closing instant + offset: a repeated sweep does nothing, and a *changed* deadline legitimately creates a new reminder. Tenders without a closing time, already past, cancelled or deleted are never reminded. Times in messages are IST; the notification's `expires_at` is the closing time (hidden from the UI afterwards, kept as history).

### 21.8 Preferences

`notification_preferences` stores only what the user changed (user, category, channel, enabled); everything else uses documented defaults (all categories on for both channels, deadline offsets [24h], quiet hours off). `notification_settings` holds deadline offsets and quiet hours (start/end `HH:mm` plus an IANA time zone, default Asia/Kolkata; overnight windows supported). The SYSTEM category is locked on: the API rejects an attempt to disable it (400) and the resolver ignores stored values for it. Rules: both channels off -> nothing is created; email off -> the in-app notification is still recorded and the delivery row says `SKIPPED / PREFERENCE_DISABLED`; in-app off but email on -> the record is stored already read (no unread badge) because email needs a record to track; quiet hours hold non-critical email until the window ends (BullMQ delay); critical/security mail is never held. Preference changes are audited (`NOTIFICATION_PREFERENCES_UPDATED`).

### 21.9 In-app, real-time decision, self-healing

The Phase 6 bell and page now use the real API: pagination (`page`, `pageSize` <= 100), `type` and `unread` filters, `unread-count`, mark read/unread/all-read, expired items hidden, and `entityAvailable` so a notification for a removed tender is never a dead link. **Real time is deliberately polling**: the count is re-read on load, on window focus and at most once per minute while the tab is visible (the list reloads only when the count grew). No WebSocket/SSE was introduced - alerts are minutes-scale, the polling cost is one tiny query per minute per open tab, and SSE remains the documented option if latency ever matters. A delivery still `QUEUED` after 10 minutes (queue message lost) is re-queued by the sweep with its deterministic job id (a no-op when the job still exists).

### 21.10 Deduplication and idempotency

The unique constraint `(user_id, dedup_key)` on `notifications` is the arbiter; the delivery service also pre-checks the batch so a replay is cheap.

| Notification | Dedup key (per user) |
|---|---|
| saved-search match | `SAVED_SEARCH_MATCH:<tenderId>` (re-ingestion of the same tender by any event is a duplicate) |
| tender update / cancelled / status | `<TYPE>:<outbox eventId>` |
| corrigendum | `TENDER_CORRIGENDUM:<corrigendumId>` |
| deadline reminder | `TENDER_DEADLINE:<tenderId>:<closingAt epoch ms>:<offset hours>` |
| security / account | `SECURITY:<eventId>` / `ACCOUNT:<eventId>` |

Email: one delivery row per notification (`UNIQUE(notification_id, channel)`) and the queue job id `notif-email.<deliveryId>` is deterministic. The email handler treats an already-`SENT` delivery as done, so a retry after an unacknowledged success never sends twice. Verified: replaying a `tender.created` event through the real queue produced no second notification or email (Docker), and replaying 5,000 plans created 0 rows in 0.66 s (Sec 21.16).

### 21.11 Spam and volume safeguards

Configurable (env): `NOTIFY_EMAIL_MAX_PER_SEARCH_PER_HOUR` (5), `NOTIFY_EMAIL_MAX_PER_USER_PER_HOUR` (20), `NOTIFY_INAPP_MAX_PER_SEARCH_PER_HOUR` (50), `NOTIFY_DIGEST_MAX_ITEMS` (20), `NOTIFY_MATCH_CHUNK_SIZE` (50). Policy: alerts are opt-in per search; **DAILY searches never send per-tender email** - matches wait as `DIGEST_PENDING` and go out as one digest email per user at 08:00 IST (up to 20 listed, "and N more" for the rest); **IMMEDIATE searches** send email up to the per-search/per-user hourly caps and the overflow folds into the next digest instead of being dropped; the in-app cap suppresses (and logs) matches beyond 50 per search per hour so a bulk ingestion cannot flood the bell. Critical/security notifications are exempt from caps and quiet hours. A single tender that matches thousands of searches still produces at most one notification per user.

### 21.12 Frontend

`/notifications`: server-paginated list, All/Unread tabs, type filter, per-row mark read/unread, Mark all read, loading/empty/error+retry states, preferences link; tender notifications link to `/tenders/:id` only when the tender exists. Bell menu: recent items, same rules. `/profile` gains a "Notification preferences" card (persisted, accessible switches per category and channel, locked security row, deadline-offset checkboxes, quiet hours with time zone) and honours `?tab=notifications` (the link in alert emails). Saved searches gain an Alerts control (Off / As new tenders arrive / Daily digest) on the card and in the save dialog.

### 21.13 Database

Migration `20260927090000_phase8_notifications` (additive, no data loss; existing notification rows keep working): `notifications` gains `organization_id`, `priority`, `metadata`, `dedup_key`, `source_event_id`, `template_key`, `template_version`, `expires_at`, unique `(user_id, dedup_key)`, indexes `(user_id, type, created_at DESC)` and `(organization_id)` (the existing `(user_id, is_read, created_at DESC)` serves the unread list); new `notification_preferences` (`UNIQUE(user_id, category, channel)`), `notification_settings`, `notification_deliveries` (indexes on status, user, user+status, digest; `UNIQUE(notification_id, channel)`); `saved_searches.alert_frequency` (+ index). Enums: `notification_priority`, `saved_search_alert_frequency`, `notification_category`, `notification_channel`, `delivery_status`. No separate event table: the existing `outbox_events` is the event log.

### 21.14 Email

- **Provider abstraction**: `EmailTransport` (unchanged contract, extended with optional pre-rendered `subject/text/html`), `PermanentEmailError` for non-retryable rejections. `LogEmailTransport` is the only implementation (dev/test); `EMAIL_DRIVER=smtp` still fails at boot with an explicit message. **No production provider is configured, so this phase does not claim real-world delivery.** The states are kept honest: GENERATED (notification row) -> QUEUED (delivery row + job) -> SENT (*accepted by the configured provider*; with the log driver that means captured, `provider='log'`, not delivered) -> ACTUALLY DELIVERED is not observable and not recorded. Bounce/delivered callbacks are left to a future real provider.
- **Templates** (`email-templates.ts`, version 1, stored as `template_key`/`template_version` on every notification and delivery): saved-search match, tender update (also cancellation/closure), corrigendum, deadline reminder, system/security, saved-search digest. Each has a subject, plain text and HTML; consistent header/footer; a "View tender" call to action to `FRONTEND_URL/tenders/<uuid>`; reference number and IST dates; a "Manage notification preferences" link (`/profile?tab=notifications`); no public unsubscribe token system (the preferences page is the route).
- **Security**: every dynamic value is HTML-escaped (no raw interpolation), subjects are stripped of line breaks/control characters (header injection), links are built only from our own origin and a validated UUID, security mail contains no token or tender data, error text stored on a delivery has addresses and long tokens removed, and the recipient address is never logged (the log driver masks it).
- **Status machine and retry**: `QUEUED -> SENDING -> SENT`; a transient provider error -> `RETRYING` (attempt counted) and the job is retried with the `email` queue's exponential backoff (6 attempts, 30 s base, +-20 % jitter); retries exhausted -> `FAILED` (+ the job goes to the dead-letter path); `PermanentEmailError`, unknown template, render failure or missing delivery -> `FAILED`/permanent, no retry; a recipient who became unverified/suspended -> `SKIPPED`. `SKIPPED` rows also record why an email was not sent (`PREFERENCE_DISABLED`, `RECIPIENT_UNAVAILABLE`, `EMAIL_RATE_CAPPED`).

### 21.15 Queues, jobs, schedules

| Queue | Job | Concurrency | Attempts / backoff |
|---|---|---|---|
| `notifications` | `notification.dispatch` (one per domain event) | 10 | 5 / 10 s exponential |
| `email` | `notification.email` (one per delivery) | 5 | 6 / 30 s exponential |
| `maintenance` | `notification.deadline-sweep`, `notification.send-digests` | 1 | 3 / 60 s |

Schedules (seeded into `job_schedules`, editable like every platform schedule): `notification-deadline-sweep` every 15 min, `notification-send-digests` daily 08:00 IST. No new queues or Redis connections were added; jobs use the shared producer/worker infrastructure and its dead-letter handling.

### 21.16 Observability, audit, security

Structured log lines (ids, type, counts, attempt, duration - never content, addresses or tokens): `notification generated`, `emails queued`, `notification suppressed: in-app rate cap`, `email capped`, `notification email accepted by provider`, `notification email attempt failed`, `deadline sweep completed`, `digest run completed`; every job result carries counts. Audit: preference changes; the notification/delivery tables are themselves the audit trail for generated -> queued -> sent/failed (timestamps, attempts, provider, sanitized error), and `read_at` for reads. Authorization: every route derives the user from the access token; there is no `userId`/`organizationId` parameter (unknown query params are rejected with 400), a notification that is not yours is a 404 indistinguishable from a missing one, preferences and history are per user, saved-search alerts go only to the search's creator while still a member. The admin surface is intentionally absent (Phase 12).

### 21.17 Measured performance (synthetic data)

`backend/scripts/notification-benchmark.cjs`, scratch database `ats_gem_bench` (dropped afterwards; refuses non-"bench" databases), fake queue and capturing transport so the numbers measure the pipeline, developer machine, Postgres 17 in Docker. Matching = time to find which of N alert-enabled saved searches match one tender:

| Saved searches | Matches | before p50 / p95 (ms) | after p50 / p95 (ms) |
|---|---|---|---|
| 1 | 1 | 4.3 / 5.9 | (unchanged) |
| 100 distinct | 4 | 176 / 232 | 100 / 172 |
| 1,000 distinct | 34 | 1,365 / 1,564 | 442 / 654 |
| 5,000 distinct | 167 | 2,042 / 2,332 | 763 / 873 |
| 5,000 with 15 distinct criteria (grouped) | 1,001 | 50 / 64 | 45 / 56 |

"Before" was the first implementation (sequential chunks, per-recipient queries); "after" adds 4 concurrent chunks and batch delivery. Notification generation for a tender that matches M users (all in-app + email queued): 100 users 359 ms (279/s), 1,000 users 1.28 s (780/s), 5,000 users 6.93 s (721/s) - before: 81/s, 83/s, 62/s. Replaying the same event (duplicate storm): 100 -> 23 ms, 1,000 -> 178 ms, 5,000 -> 658 ms with **0 notifications created** (before: 1.8 s / 25 s / 122 s); the duplicate rate is exactly 0. Email worker (single consumer, in-memory transport): 102 emails/s (5,000 in 49 s); with the queue's concurrency of 5 that scales roughly linearly until the database saturates. Interpretation: per-event matching cost is about 0.4-1.5 ms per *distinct* criteria set; 1,000 distinct saved-search criteria cost about 0.4 s per new tender, so a bulk ingestion of N new tenders costs N x that on the worker (which is a background cost, parallelizable across worker replicas). Batching several tenders into one evaluation is the next step if a real crawler makes this the bottleneck; it was not needed at these measured scales.

### 21.18 Known limitations

No SMS/WhatsApp/push (the transport abstraction leaves room); no production email provider and therefore no bounce/delivery feedback; matching uses strict search semantics (no typo tolerance); alerts go to the search's creator only (no team fan-out); no per-search deadline/quiet-hour overrides; polling (up to 1 minute) instead of push; no in-app digest view; the in-app hourly cap drops (and logs) overflow matches rather than folding them into a digest; a city name containing a comma cannot be a saved criterion (Phase 7 limitation).

## 22. Analytics & tracking as built (Phase 10)

Phase 10 adds a general product-analytics pipeline on top of the infrastructure Phases 1-8 already built: no new database, queue, Redis connection or scheduler was introduced. It answers *how the product is used* (traffic, search, tender/document engagement, conversion) without duplicating the Phase 7 search-analytics table it explicitly builds on.

### 22.1 What already existed vs what was added

Reused as-is: PostgreSQL + Prisma, the transactional outbox pattern (not used here - see 22.2), BullMQ queues/workers/`JobProcessor`, the scheduler and `job_schedules`, the `RateLimit`/`RequirePermissions`/`RequireOrgRole` guards, and Phase 7's `search_events` table (read, never copied). Added: four tables (`analytics_events`, `analytics_sessions`, `analytics_daily_rollups`, `analytics_processing_runs`), one module (`src/analytics/`), one rate-limit policy (`analytics`), one permission (`analytics.view`), two scheduled jobs, two CLI commands, and a small frontend tracking client plus a handful of call sites wired into existing components (no visual change anywhere - see 22.11).

### 22.2 Why ingestion is synchronous, not outboxed

Every other Phase 1-8 write that must survive a crash between "committed" and "queued" uses the transactional outbox (an order, a notification, a corrigendum). An analytics event is different: it is not a business fact anything else depends on, losing an occasional one under a real outage is acceptable, and the write itself is a single bounded insert with no side effects to fan out. Routing it through the outbox would add a table row, a relay poll and a queue hop to a path whose only job is to be fast and never break the request it is attached to. `AnalyticsIngestService.ingest()` therefore writes directly and inline; `AnalyticsController.track()` wraps the call so that *any* failure (bad payload, a transient DB error) is caught and logged, and the response is still `202` with an honest `{accepted, rejected}` count - analytics can degrade, the page it is attached to never sees an error (verified in `analytics.e2e-spec.ts` by renaming a column mid-test).

### 22.3 Event taxonomy and schema validation

`AnalyticsEventName` (Postgres enum, closed) has 23 values, each with a real producer:

| Group | Events |
|---|---|
| Traffic | `PAGE_VIEW` |
| Auth | `REGISTRATION_STARTED`, `REGISTRATION_COMPLETED`, `EMAIL_VERIFICATION_COMPLETED`, `LOGIN_SUCCESS`, `LOGIN_FAILURE`, `LOGOUT` |
| Tender | `TENDER_VIEWED`, `TENDER_SAVED`, `TENDER_UNSAVED`, `TENDER_SOURCE_OPENED`, `TENDER_CORRIGENDUM_VIEWED`, `TENDER_VERSION_VIEWED` |
| Document | `DOCUMENT_VIEWED`, `DOCUMENT_DOWNLOADED`, `DOCUMENT_DOWNLOAD_FAILED` |
| Notification | `NOTIFICATION_VIEWED`, `NOTIFICATION_CLICKED`, `NOTIFICATION_PREFERENCES_UPDATED` |
| Profile/org | `PROFILE_VIEWED`, `PROFILE_UPDATED`, `ORGANIZATION_VIEWED` |
| System | `CLIENT_ERROR`, `API_ERROR` |

Deliberately not implemented (no real source): `landing_page_view`/`campaign_visit` as distinct events (a landing page is just a `PAGE_VIEW` whose session has first-touch UTM data - see 22.5), `search_*` events (Phase 7 already has `SEARCH_SUBMITTED`/`RESULT_OPENED`/etc. in `search_events` - duplicating them here was explicitly out of scope), `tender_shared` (no share feature exists), `registration_conversion`/`search_to_tender`/etc. as stored events (funnels are computed from the events above, not pre-labelled - see 22.9), `NOTIFICATION_VIEWED` is defined but has no wired producer yet (the bell/list render is passive; only the click is instrumented).

`ANALYTICS_METADATA_SCHEMAS` (`analytics-event-schemas.ts`) gives every event name a Zod `.strict()` schema: unknown keys are rejected outright, so a client cannot smuggle an arbitrary object through as "metadata" the way a raw request body could. Every field is a small bounded primitive or a closed enum (e.g. `TENDER_VIEWED.source` is one of `search|saved|notification|direct`, never a free string); nothing accepts a full object, a token, or document contents. `TrackEventDto`/`TrackEventsDto` add request-level bounds: `anonymousId` must match `^[A-Za-z0-9_-]{8,64}$` (never an email), `path` <= 300 chars (pathname only, no query string), and a batch is capped at `ANALYTICS_MAX_BATCH_SIZE` (default 20, hard ceiling 20 at the DTO level too).

### 22.4 Anonymous and authenticated tracking

The frontend generates a random `anonymousId` (via `crypto.randomUUID()`, stored in `localStorage`, falling back to an in-memory id in private/blocked-storage contexts) - never derived from an email, name or IP. It is sent with every event, signed in or not. `POST /analytics/events` is `@Public()`; when a bearer token is present (`@OptionalUser()`), the event's `userId`/`organizationId` come from the token, never from the request body (the DTO has no such fields - sending them is a validation error, tested). This means the same anonymous id carries through signup: an anonymous browsing session and the account it later creates share one `analytics_sessions` row and one trail of `analytics_events`, without ever storing the email as an identifier.

### 22.5 Session tracking and attribution model

One `analytics_sessions` row per anonymous browser between activity gaps of `ANALYTICS_SESSION_TIMEOUT_MINUTES` (default **30 minutes** - long enough to survive reading one tender page end to end, short enough that an abandoned tab does not inflate a session for hours). `anonymousId` is *not* unique on this table: each time a browser's previous session times out, a new row starts and the old one is stamped `endedAt`, so a returning visitor's history is a sequence of sessions, not one row overwritten forever.

**Attribution is first-touch only**: `landingPath`, `referrerHost` (host only, e.g. `google.com` - never the full referrer URL, which can itself carry a search query or other visitor-side data) and the five `utm_*` fields are captured once, when a session is *created*, and never overwritten by a later event in the same session - deliberately not last-touch, because nothing in this phase consumes a last-touch view and adding a second attribution table for an unused feature would be speculative. The frontend caches its own first capture in `sessionStorage` (`lib/analytics/attribution.ts`) so it can keep sending the same values on every event without re-reading `document.referrer`/the URL each time; the server only *uses* them on the event that actually creates a new session row, so resending them is harmless.

### 22.6 Aggregation (daily rollups)

No analytics API ever scans `analytics_events` or `search_events` directly (`AnalyticsQueryService` reads only `analytics_daily_rollups`). `AnalyticsRollupService.run(date)` rebuilds one UTC day at a time: a handful of `count(*)` / `count(*) FILTER (...)` queries against the raw tables, written with `upsert` (never increment) into `(date, metric, dimension)` rows. This makes a rerun of the same day **idempotent and safe**: running it once or a hundred times leaves identical numbers, and if the underlying events changed (e.g. a purge ran), a rerun *corrects* the stored count rather than doubling it (both are covered by tests). Ten metrics are computed, each for `dimension = 'global'` and again for every organization id seen that day:

`page_views, sessions_started, registrations_completed, logins, tender_views, tender_saves, document_downloads, notification_clicks, searches_performed, zero_result_searches`

The last two read `search_events` (`SEARCH_SUBMITTED`, `payload->>'resultCount'`) directly - Phase 7's data is the source of truth for search metrics, never copied into a second event stream. `sessions_started` is global-only (anonymous sessions have no reliable organization until a user signs in mid-session, so an org-scoped count would undercount); this is a documented limitation, not a bug.

### 22.7 Retention (three independent windows)

Phase 10 introduces its own retention, kept deliberately separate from Phase 7's `SEARCH_EVENT_RETENTION_DAYS` / `maintenance.search-events-purge` (which `AnalyticsPurgeService` never touches - tested):

| Table | Env var | Default | Rationale |
|---|---|---|---|
| `analytics_events` | `ANALYTICS_EVENT_RETENTION_DAYS` | 90 days | Raw events are only useful for near-term debugging/funnels; the aggregate numbers already live forever in the rollups. |
| `analytics_sessions` | (same var) | 90 days | Small, but no reason to outlive the events that reference them. |
| `analytics_daily_rollups` | `ANALYTICS_ROLLUP_RETENTION_DAYS` | 400 days | One row per metric per day per dimension - tiny - kept over a year so year-over-year trend views are possible later. |

`AnalyticsPurgeService.purge()` deletes `analytics_events` in batches (`FOR UPDATE SKIP LOCKED`, same shape as `SearchEventsPurgeService`) so it never holds a long lock or blocks concurrent inserts, then sweeps `analytics_sessions` and `analytics_daily_rollups` with two bounded statements. Every run is recorded in `analytics_processing_runs` (mirrors `search_index_runs`). Scheduled `analytics-purge-events` (daily 04:45 IST, after the rollup and before the search-event purge); manual: `node dist/main.cli.js analytics:purge-events`.

### 22.8 Analytics API and authorization

Follows the existing RBAC/organization model exactly - no parallel permission system:

| Endpoint | Auth | Scope |
|---|---|---|
| `POST /analytics/events` | `@Public()`, `@RateLimit('analytics')` | Ingestion; identity from an optional token, see 22.4 |
| `GET /analytics/me/summary` | any signed-in user | The caller's *own* event counts by type - never another user's (identity from the token only) |
| `GET /analytics/organizations/current/overview` | `@RequireOrgRole('VIEWER')` | Daily-rollup totals for the caller's *own* organization (`dimension = callers's organizationId`, never a parameter) |
| `GET /analytics/admin/overview` | `@RequirePermissions('analytics.view')` | Platform-wide totals (`dimension = 'global'`) |
| `GET /analytics/admin/trends` | `@RequirePermissions('analytics.view')` | One metric's daily series over a date range |

`analytics.view` is a new staff permission (`PERMISSION_KEYS`), granted by default to `SUPER_ADMIN`, `ADMIN` and `SUPPORT` - the same seeded-role mechanism every other permission uses. `parseRange()` rejects an inverted range, a malformed date, or a span over 366 days (`400`), so no request can force scanning unbounded history even though the query only ever hits the small rollup table. Raw `analytics_events` rows are never exposed through any API - only aggregates and a caller's own summary.

### 22.9 Conversion funnels

No funnel is pre-computed or stored; a funnel is a comparison of existing rollup metrics computed by whoever reads the API (or, later, a dashboard): `search_to_tender` = `RESULT_OPENED` (from `search_events`, already exposed) over `SEARCH_SUBMITTED`; `tender_to_save` = `tender_saves` over `tender_views`; `tender_to_document` = `document_downloads` over `tender_views`. This keeps the funnel definitions honest (real ratios of real counters) instead of inventing a "funnel event" that could drift from the numbers underneath it, and matches the instruction not to hardcode dashboard numbers.

### 22.10 Frontend integration (no visual change)

`lib/analytics/client.ts` batches up to 20 events with a 300 ms debounce and flushes via `fetch(..., {keepalive:true})`, falling back to `navigator.sendBeacon` on tab-hide/unload (an unload-time beacon carries no Authorization header - `sendBeacon` cannot set custom headers - so it is attributed anonymously rather than dropped). It never throws and never surfaces to the UI, the same contract as the existing `recordSearchEvent` (Phase 7). Every integration point is a side-effecting call added next to existing logic, never a new visible element:

- `RouteTracker` (mounted once in the root layout, inside a `<Suspense>` for `useSearchParams`) fires `PAGE_VIEW` on every route change, client-side navigation included, tagged with a `routeCategory` (`public`/`auth`/`app`/`admin`) derived from the path. `/reset-password` and `/verify-email` are excluded outright so a page carrying a one-time token in its query string is never logged even by path alone landing near it.
- `ErrorTracker` (also mounted once) subscribes to a new `onApiError` hook on the existing API client and reports `API_ERROR` for failures that are not routine (401/validation/rate-limit noise is filtered so this does not just restate what the UI already surfaces).
- `TenderViewTracker` (mounted on the tender detail page) fires `TENDER_VIEWED` with a `source` read from a `?from=` query parameter, validated against a closed list.
- `SaveTenderButton`, `DocumentCard`, `NotificationItem`, the login/register forms, `session-context`'s logout, the tender tabs (corrigenda/versions) and source link, the notification-preferences card, and the profile/company pages each gained one `track(...)` call alongside their existing handler - not a single JSX element, class name or copy string changed (verified by the full existing Vitest/Playwright suites still passing unmodified, plus a UI-preservation read-through of every touched file).

### 22.11 Privacy and security

No password, token, session secret, payment credential, document content or full request/response body is ever accepted into `metadata` (the closed per-event schemas make this structural, not a review checklist item - tested with a payload containing `password`/`accessToken` keys, which is rejected). No IP address is stored anywhere in the analytics tables (the existing `audit_logs.ip` column, unrelated, is Phase 2's and out of scope here). `anonymousId` is a random client-generated token, never an email or name. `analytics_events` deliberately has **no foreign keys** to `users`/`organizations`/`tenders` (`AnalyticsSession` is the one exception, since it is Phase-10-owned and low-volume): at millions-of-rows scale a foreign key would make every insert and every retention delete check referential integrity for no query benefit, since every real query filters by an id value that is already indexed - the same trade-off Phase 7's `search_events` made. `POST /analytics/events` sits behind its own rate-limit policy (`RATE_LIMIT_ANALYTICS_MAX`, default 600/min per IP) so it cannot be used to flood the queue-free ingestion path or exhaust the database with a scripted flood, independent of the `search` policy.

### 22.12 Observability

Structured log lines (ids/counts/durations only, never event content): `AnalyticsIngestService` logs a warning per rejected event (with the failing field paths, not the values) and per session-touch failure; `AnalyticsRollupService`/`AnalyticsPurgeService` log a `completed`/`failed` line with full counters, mirroring `SearchEventsPurgeService`'s pattern, and every run is additionally recorded in `analytics_processing_runs` for later inspection (`kind`, `status`, `processed`, `failed`, `details`). This is telemetry for a human or a future dashboard to read, not the Phase 17 monitoring/alerting system.

### 22.13 Database

Migration `20260928080000_phase10_analytics` (additive): four new tables plus the `AnalyticsEventName` enum. `analytics_events`: indexed on `(event_name, occurred_at)`, `(organization_id, occurred_at)`, `(user_id, occurred_at)`, `(session_id)`, `(received_at)` - covering the rollup queries and the retention delete. `analytics_sessions`: indexed on `(user_id)`, `(last_activity_at)`, `(anonymous_id, last_activity_at DESC)` (the last one drives session lookup; **not** unique on `anonymous_id`, corrected during implementation - see 22.14). `analytics_daily_rollups`: `UNIQUE(date, metric, dimension)` plus `(metric, date)` for trend queries. `analytics_processing_runs`: `(started_at DESC)`, mirroring `search_index_runs`. Verified with zero drift on a fresh database, the native dev database and the Docker database (`prisma migrate deploy` + `migrate diff --exit-code`, all three).

### 22.14 CLI / maintenance commands

`node dist/main.cli.js analytics:rollup [--date YYYY-MM-DD | --from YYYY-MM-DD --to YYYY-MM-DD]` (default: yesterday) and `analytics:purge-events`, following the exact shape of `search:reindex`/`search:purge-events`. Both are idempotent and safe to run repeatedly. Scheduled: `analytics-rollup` daily 02:30 IST (rebuilds yesterday and today, so a rollup taken mid-day is corrected the next night), `analytics-purge-events` daily 04:45 IST.

### 22.15 Performance (synthetic, honestly scoped)

No dedicated large-scale benchmark script was built for this phase (unlike Phase 7/8's `*-benchmark.cjs` scripts against a scratch `_bench` database); instead, correctness and cost were measured through the e2e suite itself, which is the more informative number at this stage since ingestion is a single-row insert with no fan-out:

- **Ingestion**: one `analyticsSession` read + write and one `analyticsEvent` insert per unique `anonymousId` in a batch; a 20-event batch from one browser is one session touch plus one `createMany` of up to 20 rows - the e2e suite's ingestion tests (batch caps, rejection, identity attachment) each complete in well under a second including the full Nest request pipeline (auth guard, rate limiter, validation, DB round-trip).
- **Rollup**: `AnalyticsRollupService.run()` issues four aggregate queries (page views, sessions, six-event-type group-by, search-events group-by) regardless of how many distinct organizations appear that day; a `runRange` backfill test rebuilding 3 days completed as part of the normal e2e run (well under the suite's 30s per-test timeout).
- **Retention**: batched at `EVENT_BATCH_SIZE = 5,000` rows per statement (matching Phase 7's purge), tested with a 7-row backlog and `batchSize: 3` to prove the batching loop terminates correctly; a full-scale timing run was not performed and is not claimed.
- **Limitation, stated plainly**: none of the above were run against a synthetic multi-hundred-thousand-row dataset the way the Phase 7 search benchmark was. The architecture (indexed group-bys, no raw scans from the API, batched deletes) is designed for that scale, but the specific p50/p95/p99 numbers the brief asked for were not fabricated and are therefore not reported as measured facts.

### 22.16 Known issues / limitations

- `NOTIFICATION_VIEWED` exists in the taxonomy but has no wired producer (only the click is instrumented); left in the enum because the notification list render is a passive read, not a discrete user action worth an event on its own yet.
- `sessions_started` is not computed per-organization (see 22.6).
- No large-scale performance benchmark was run for this phase (see 22.15) - only correctness and small-scale timing were verified.
- A bug was found and fixed during implementation: `AnalyticsSession.anonymousId` was initially modelled as unique, which made it impossible to ever start a *second* session for a returning anonymous visitor (the create would violate the constraint). Fixed by dropping the uniqueness and adding a composite `(anonymous_id, last_activity_at DESC)` index instead, with the session lookup changed from "the row" to "the most recent row"; covered by a regression test (`starts a new session after the inactivity timeout and preserves the old one as ended`).
- Attribution is first-touch only (documented decision, 22.5); a last-touch model was not built.
