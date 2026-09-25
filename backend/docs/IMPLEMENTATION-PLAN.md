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

## Phase 2 — Backend foundation (auth, RBAC, organizations, taxonomy/documents/user-features foundation) ✅ implemented (awaiting review)
Delivered on `main` (uncommitted), detailed in [ARCHITECTURE §17](./ARCHITECTURE.md#17-backend-foundation-as-built-phase-2):
users + personal organizations (ADR-06), Argon2id, register/login/logout, refresh rotation with
reuse detection, sessions list/revoke, email verification, forgot/reset/change password, Redis-backed
login throttling, roles/permissions seed, `PermissionsGuard` + `@RequirePermissions`, organization
roles + `OrgRoleGuard` + `@RequireOrgRole`, organization CRUD/members/invitations/accept, an
organization-context switch endpoint, `GET/PATCH /me`, `/meta/{states,categories,tender-types}`,
`GET /search/tenders` + `GET /tenders/:id` (indexed-column filters, not the Phase 4/5 search
engine), saved searches, watchlist, in-app notifications, append-only audit logging, and the
document-metadata tables (`stored_files`, `tender_documents`) as pure foundation. Email delivery
reuses the Phase 1 `email.send` queue and log driver — no SMTP driver yet.

Moved here from later phases (the pasted brief for this phase asked for them explicitly): taxonomy
seed data and `tenders`' optional category/sub-category/district/tender-type/slug/procurement-type
columns (from Phase 3); `stored_files`/`tender_documents` (from Phase 6); saved searches, watchlist
and notification records (from Phase 7). Their remaining, more advanced work stays with those
phases (see the updated sections below). **Not done here**: Google OAuth (schema-ready, no route —
needs real credentials to verify, so it is a deferred stub, not a half-built feature); per-source
token bucket (already Phase 5's, unaffected); tiered rate limiting beyond login (Phase 10).

**Accept when:** e2e: register → verify → login → refresh → reuse of old refresh token revokes the
family → logout. Permission-guarded route returns 403 without the permission; org-role-guarded route
returns 403 below the required role. No password/token ever appears in logs (redaction already
covers `password`/`token`/`secret`/etc. — Phase 0/1's `REDACTED_PATHS`).
*Status:* all of the above covered by seven new e2e suites (auth, RBAC guard chain, organizations,
tenders/taxonomy/saved-searches/watchlist/notifications) plus unit tests for the pure services
(password hashing, RBAC constants, slugify, money, duration parsing); typecheck, lint, unit and e2e
all pass on Node 24. Docker verification pending, same as Phase 1.

## Phase 3 — Tender core ✅ implemented (awaiting review)
Procuring-entity resolution (5-tier, conservative fuzzy matching), cross-source deduplication engine
wired into ingestion, tender versioning (diff-based), status/lifecycle normalization
(`source_status_raw` alongside the existing `lifecycle`), non-blocking data-quality checks, entity
merge (never destructive) and duplicate-candidate review APIs, richer `GET /tenders` filters and
detail response, idempotent backfill CLI, lakh/crore money parsing. Full detail:
docs/ARCHITECTURE.md §18.

**Still open, deferred as isolated follow-ups (not blockers):** `users.email` /
`organizations.slug`/`gstin` partial unique indexes (needs 4 `findUnique` → `findFirst` call-site
rewrites first — see ARCHITECTURE.md §18.12); districts beyond the bare table (LGD dataset); the
periodic `TenderStatusService` refresh job (status is still recomputed correctly on every ingestion,
just not by a standalone scheduled job yet); admin tender CRUD/archive/flag/soft delete UI-facing
endpoints beyond what Phase 2 already exposes; market/rollup endpoints (Phase 4/9 territory).

**Accept when:** entity resolution never merges two different organizations without a human decision
(verified: ambiguous fuzzy matches resolve to `null`, not a guess); a duplicate insert of the same
`(procuring_entity, reference_number)` from a second source links to the existing tender rather than
creating a new one (verified via e2e); the backfill is idempotent against the real Docker database
(verified: second run reports `skipped: 25`, zero new writes).

## Phase 4 — Tender enrichment, documents & operational data ✅ implemented (awaiting review)
*(Fills the master brief's "Phase 4" slot, which does not correspond to this local roadmap's
pre-existing "Phase 4 — Search"/"Phase 6 — Documents" entries below — those remain future work,
renumbering avoided to keep their own history intact.)* Structured requirements (`tender_requirements`,
11-type enum), normalized timeline (`tender_events`, seeded on ingestion + backfilled), corrigenda
(`tender_corrigenda`, linked to a matching timeline event), a real `StorageProvider` abstraction +
`LocalStorageProvider` (streamed upload/download, path-traversal-safe), checksum-deduped and
version-chained document registration on top of Phase 2's `stored_files`/`tender_documents`, two new
data-quality checks (`MISSING_DEADLINE`, `MISSING_LOCATION`) plus `SUSPICIOUS_EMD_VALUE_RATIO`,
audited administrative corrections (`tender.correct` permission, required reason), richer `GET
/tenders/:id` (documents/requirements/timeline/corrigenda/provenance), idempotent `backfill:phase4`
CLI. **No AI/LLM/OCR/embeddings/vector search of any kind** - verified by grep across the entire
diff. Full detail: docs/ARCHITECTURE.md §19.

**Still open, deferred as isolated follow-ups (not blockers):** `S3StorageProvider` (interface ready,
no AWS SDK dependency added - nothing sets `STORAGE_DRIVER=s3` today); no document upload endpoint
(registration is internal-only until Phase 6's actual crawler document-fetch step exists); search
filters not extended for the new structured fields (only one crawl source exists and it has never
fetched a real document, so there was nothing real to filter on yet - Phase 4/5 below still owns
that).

**Accept when:** a document registered twice with identical bytes creates one `stored_files` row and
reuses the existing `tender_documents` row (verified via e2e); registering different bytes for the
same tender+documentType creates a new version chained via `supersedesId`, and the old version row is
never deleted (verified); an administrative correction without `tender.correct` is rejected with 403
and one with it is fully audited with old value, new value and reason (verified); the Phase 4 backfill
is idempotent against the real Docker database (verified: second run reports `skipped: 25`, zero new
writes).

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
*(`stored_files`/`tender_documents` tables landed in Phase 2, as metadata foundation only — nothing
writes to them yet.)* Remaining: `MediaStorageService` (s3-compatible + local drivers), the crawler's
actual document download (`fetchDocuments` is still a stub), streaming download with size/type
limits, PDF validation + text extraction, OCR worker (Tesseract, only for low-text PDFs), XLSX/DOCX/ZIP
handling, signed download URLs, "download all" archives, `document_contents`/`document_archives`
tables, `organization_documents` (KYC uploads), documents text into search, wiring `TenderDetail.documents`
to the real table instead of a hard-coded empty array.

**Accept when:** the same PDF attached to two tenders is stored once; a scanned PDF goes through OCR and becomes searchable; download URLs expire; oversized/incorrect-type files are rejected and marked `QUARANTINED`.

## Phase 7 — User features
*(Watchlist, saved searches and the base `notifications` table/CRUD landed in Phase 2 — see
ARCHITECTURE §17.5 for exactly what "foundation" means there.)* Remaining: follows, alerts +
matching engine (percolator + Postgres batch fallback), notification preferences, email/SMS/push
delivery channels, daily/weekly digests, SSE stream, closing-soon sweep, bids tracker.

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

## Decisions (resolved 2026-09-25)

6. **Role model for Phase 2** — the generic `SUPER_ADMIN/ADMIN/MEMBER/USER` role list from that
   phase's brief was not used; the already-approved ADR-07 model was kept instead (staff roles
   `SUPER_ADMIN, ADMIN, MODERATOR, CRAWLER_MANAGER, SUPPORT`, and separately, organization roles
   `OWNER, MEMBER, VIEWER`). Re-litigating an approved decision without a new technical reason would
   have made the platform's authorization model internally inconsistent.
7. **Scope pulled forward into Phase 2** — taxonomy (states/categories/tender types), document
   metadata tables, saved searches, watchlist and notification records, all as foundation only (no
   crawler/classification/search-engine/delivery work). Recorded in ARCHITECTURE §17.5 and reflected
   in Phases 3/6/7 above, which now list only what remains.
8. **Google OAuth deferred** — the schema is ready (`user_identities`, `AuthProvider.GOOGLE`) but no
   route was built, since it cannot be exercised end-to-end without real Google credentials. A
   half-implemented, unverifiable OAuth flow was judged worse than an honest gap.
