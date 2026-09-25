# ATS Gem Backend — Implementation Plan

Each phase ends in a working, tested, reviewable increment. A phase is **done** only when its acceptance criteria pass in CI (lint, typecheck, unit + integration tests) and its docs/OpenAPI are updated. Work proceeds one phase at a time, with a review checkpoint after each.

## Phase 0 — Foundation ✅ reviewed and approved
Delivered on `main` (uncommitted): `backend/` NestJS 12 app (TypeScript strict, ESLint type-aware, Prettier, Vitest + SWC); zod-validated config; pino structured logging with request IDs and secret redaction; response envelope, error codes and global exception filter; global validation pipe; Helmet and CORS; `/health`, `/health/live`, `/health/ready` (PostgreSQL, Redis, search, storage); Swagger (env-gated); Prisma 7 with pg driver adapter and the initial migration (extensions + `app_settings`); Redis client; `main.api.ts` + `main.worker.ts`; Dockerfile (runtime + migrate targets) and `docker-compose.yml` (postgres, redis, opensearch profile, minio, mailpit, migrate, api, worker); `.env.example`; root `.gitignore`; README.

This absorbed the original Phase 1 foundation items. **Accepted when:** unit and e2e tests pass; the API boots against PostgreSQL; readiness reports each dependency; an invalid env var aborts boot with a clear message; unknown routes and malformed JSON return the error envelope with a `requestId`. All of these are verified locally except the Docker stack, which needs Docker Desktop.

## Phase 1 — Platform plumbing ✅ implemented (awaiting review; Docker verification pending)
Delivered on `main` (uncommitted), detailed in [ARCHITECTURE §16](./ARCHITECTURE.md#16-platform-plumbing-as-built-phase-1):
Node 24 LTS baseline; BullMQ queue topology with typed (zod) job registry, per-queue retry/backoff/
retention, dead-letter queue, correlation IDs and structured job logs; worker host with
`WORKER_QUEUES` filtering and graceful drain; transactional outbox (8 domain events) + multi-replica
relay + cleanup; database-driven scheduler (`job_schedules` + source crawl schedules) reconciled into
BullMQ job schedulers under a Redis leader lock; separate api / worker / scheduler / cli entrypoints
with per-process health servers; `/health/queues`; mock crawl pipeline (adapter contract + registry,
deterministic `MockSourceAdapter`, Indian amount/IST date normalization, idempotent ingestion,
crawl runs, flow-based fan-out/finalize); Postgres search indexer (no-op until Phase 4) and log email
transport; Phase 1 migration with CHECK constraints; idempotent seed; Compose (seed, scheduler,
healthchecks); CI workflow (no deploy).

Moved here from Phase 5: adapter contract/registry, mock adapter, ingestion pipeline, crawl runs,
dead-letter handling, DB-driven source schedules. Not done here (unchanged owners): Redis rate-limit
guard (Phase 2, with login throttling), per-source token bucket (Phase 5).

**Accept when:** a sample job round-trips producer → queue → worker with retries and a dead-letter;
an outbox row written in a transaction is published exactly once; the mock pipeline runs
Scheduler → BullMQ → MockCrawler → DB → Outbox → Queue; `docker compose up` brings everything to ready.
*Status:* covered by the e2e suites; the Redis-dependent suites (queues, scheduler, pipeline) and the
Compose stack run once Docker is available — until then they are skipped locally and enforced in CI.

## Phase 2 — Authentication & RBAC
Users, personal organizations (ADR-06), Argon2id, register/login/logout, refresh rotation with reuse detection, sessions list/revoke, email verification, forgot/reset/change password, Google OAuth, login throttling, roles/permissions seed, `PermissionsGuard`, `@RequirePermissions`, org policies, email provider abstraction (SMTP + log driver) via the `email` queue, audit logging for auth events.

**Accept when:** e2e: register → verify → login → refresh → reuse of old refresh token revokes the family → logout. Permission-guarded route returns 403 without the permission. No password/token ever appears in logs (log redaction test).

## Phase 3 — Tender core
Taxonomy seed (28 states + 8 UTs, districts, categories, tender types), procuring entities, tenders with lifecycle + `TenderStatusService` + status refresh job, source records, versions, raw-SQL migrations (partial uniques, CHECKs, trigram/GIN indexes), tender read APIs (`GET /tenders/:id`, similar), admin tender CRUD/archive/flag/soft delete, market endpoints backed by rollups + cache, seed of realistic sample tenders.

**Accept when:** status service unit tests cover every date boundary; duplicate insert of the same `(procuring_entity, reference_number)` is rejected by the database; `/market/snapshot` serves the landing page shape from cache.

## Phase 4 — Search
`SearchProvider` interface; `PostgresSearchProvider` (FTS + trigram) and `OpenSearchProvider` (index template, alias, analyzers); outbox relay → `search.indexing`; full reindex command; `GET /search/tenders` with filters, sorts, facets, page + cursor pagination; suggestions; search analytics events.

**Accept when:** the same integration suite passes against both providers; reindex is zero-downtime (alias swap); p95 search latency < 300 ms on 1 M seeded tenders (OpenSearch provider, load test).

## Phase 5 — Crawler infrastructure
*(Queues, typed jobs, DB-driven schedules, adapter interface/registry, the mock adapter, ingestion,
dead-lettering and `crawl_runs` landed in Phase 1.)* Remaining: Redis per-source token bucket +
concurrency semaphore, fixture-based mock variants (auth-required, 429/Retry-After), full retry
classification, cross-source dedupe hooks, `crawl_run_events`, encrypted `source_credentials`,
admin source/crawler APIs (run now, pause, replay dead letters), Bull Board.

**Accept when:** a mock source run creates tenders; re-running creates zero duplicates and zero updates; a simulated 5xx retries with backoff; simulated auth failure stops the run and marks the source `AUTH_REQUIRED`; credentials never appear in API responses or logs (tests).

## Phase 6 — Documents
`MediaStorageService` (s3-compatible + local drivers), streaming download with size/type limits, content-addressed `stored_files`, `tender_documents` versions, PDF validation + text extraction, OCR worker (Tesseract, only for low-text PDFs), XLSX/DOCX/ZIP handling, signed download URLs, "download all" archives, documents text into search.

**Accept when:** the same PDF attached to two tenders is stored once; a scanned PDF goes through OCR and becomes searchable; download URLs expire; oversized/incorrect-type files are rejected and marked `QUARANTINED`.

## Phase 7 — User features
Watchlist (save/unsave, follows), saved searches (validated criteria schema), alerts, matching engine (percolator + Postgres batch fallback), notifications (in-app + email channels, preferences, digests for daily/weekly), SSE stream, closing-soon sweep, bids tracker.

**Accept when:** creating a tender that matches a saved search produces exactly one notification per user even if the pipeline runs twice; daily digests batch correctly; SSE delivers a new notification within 2 s.

## Phase 8 — Business system
Organizations & teams (invitations, roles), plans + entitlements from the database, usage counters, `EntitlementGuard`, Razorpay checkout/subscription, signature verification, idempotent webhooks, subscription state machine, GST invoices + PDF, `PaymentProvider` interface.

**Accept when:** replaying the same webhook is a no-op; a forged signature is rejected; hitting a plan limit returns `402 PLAN_LIMIT_REACHED` with usage details; changing a plan limit in the database takes effect without a deploy.

## Phase 9 — Admin & analytics
Remaining admin APIs (users, orgs/KYC review, duplicates review, documents, notification deliveries, broadcast, plans, settings), analytics rollups and dashboard endpoints, audit log query API.

**Accept when:** every admin mutation writes an audit log entry with redacted values; dashboard endpoints read only rollups/caches (verified by query logging in tests).

## Phase 10 — Production hardening
Tiered rate limits, Prometheus metrics and dashboards, error tracking, OpenTelemetry, load tests (k6) for search/detail/auth, DB query review and index tuning, backup/restore runbook, security review (OWASP ASVS L2 checklist), container scanning, runbooks for crawler incidents. (Graceful worker shutdown landed in Phase 1.)

**Accept when:** load test targets met (search p95 < 300 ms at 200 RPS; detail p95 < 150 ms cached); restore drill documented; no high-severity findings open.

## Parallel track — frontend integration (starts after Phase 3)
Replace `lib/api/*` mocks with a typed fetch client generated from OpenAPI, token refresh interceptor, SSE for the notification bell, and the type adjustments listed in [API-CONTRACT.md §14](./API-CONTRACT.md). Delivered module by module as backend phases land.

---

## Decisions (resolved 2026-09-24)

1. **Repo layout and branch** — `backend/` folder on `main`; frontend untouched on `dev` (ADR-02).
2. **Roles vs plan entitlements** — `FREE_USER`/`PREMIUM_USER` removed; staff roles plus org roles `OWNER`/`MEMBER`/`VIEWER`; paid access from subscription entitlements only (ADR-07).
3. **Local infrastructure** — Docker Desktop is primary; native Postgres/Redis with Postgres search and local storage stays supported.
4. **Real sources** — mock adapter only in Phase 5; each real portal requires the onboarding review in ARCHITECTURE §14 before an adapter is written.
5. **Hosting** — AWS-compatible first target (ADR-17), provider-agnostic application code.
