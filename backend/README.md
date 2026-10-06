# ATS GeM — Backend

NestJS 12 · TypeScript 6 (strict) · Prisma 7 + PostgreSQL · Redis + BullMQ · Docker.
Architecture and contracts live in [`docs/`](./docs): [ARCHITECTURE](./docs/ARCHITECTURE.md) · [DATABASE](./docs/DATABASE.md) · [API-CONTRACT](./docs/API-CONTRACT.md) · [IMPLEMENTATION-PLAN](./docs/IMPLEMENTATION-PLAN.md).

## Requirements
- **Node.js 24 LTS** (≥ 24.11; pinned in [`.nvmrc`](./.nvmrc) — `nvm use` / `fnm use`), npm 11+
- **Either** Docker Desktop (full stack) **or** a local PostgreSQL 16+ and Redis 6.2+ (7 recommended)

The Docker image, CI and `engines` all use Node 24. Node 22 is no longer supported.

## Processes
One codebase, four entrypoints, deployed separately:

| Process | Entrypoint | Role | Health |
|---|---|---|---|
| API | `dist/main.api.js` | HTTP API; produces jobs and outbox events, never consumes queues | `:4000/health/{live,ready,queues}` |
| Worker | `dist/main.worker.js` | Consumes queues (filter with `WORKER_QUEUES`), runs the outbox relay | `:4001/health/{live,ready}` |
| Scheduler | `dist/main.scheduler.js` | Reconciles DB schedules into BullMQ job schedulers; runs no jobs itself | `:4002/health/{live,ready}` |
| CLI | `dist/main.cli.js <cmd>` | One-shot ops commands (`seed`, `crawl`, `schedules:sync`, `queues:status`, `search:reindex`, `search:verify`, `search:purge-events`, `analytics:rollup`, `analytics:purge-events`) | — |

`/health/live` = the process is up (no dependency checks). `/health/ready` = dependencies and
background loops are OK; **Redis down is a readiness failure (503)**, not a liveness failure.

## Quick start — Docker (full stack)
Verified end to end with Docker Desktop: the migrations apply, seeding is idempotent, and the api,
worker and scheduler report healthy. A mock crawl runs through scheduler/CLI → queue → ingestion →
outbox → search indexing.

```bash
cd backend
docker compose up -d --build                # postgres, redis, minio, mailpit, migrate, seed, api, worker, scheduler
docker compose --profile search up -d       # optional: OpenSearch (~1.5 GB RAM)
docker compose ps                           # api / worker / scheduler should become "healthy"
curl http://localhost:4000/health/ready
docker compose exec api node dist/main.cli.js crawl mock-portal   # run the mock crawl now
curl http://localhost:4000/health/queues
```

One-off tasks and partial stacks:
```bash
docker compose up -d postgres redis         # infrastructure only
docker compose run --rm migrate             # prisma migrate deploy (never runs on app boot)
docker compose run --rm seed                # default job schedules + mock source; safe to repeat
docker compose up -d api worker scheduler   # application processes
docker compose logs -f worker               # JSON logs, one object per line
docker compose down                         # stop; add -v ONLY if you mean to delete all data volumes
```
| Service | URL |
|---|---|
| API | http://localhost:4000 |
| Swagger UI | http://localhost:4000/api/docs (JSON: `/api/docs/openapi.json`) |
| Worker / scheduler health | http://localhost:4001/health/ready · http://localhost:4002/health/ready |
| Postgres | `localhost:5433` (user/db `ats_gem`) |
| Redis | `localhost:6379` |
| MinIO console | http://localhost:9001 |
| Mailpit | http://localhost:8025 (used from Phase 2; Phase 1 email is `EMAIL_DRIVER=log`) |

## Quick start — native (no Docker)
```bash
cd backend
nvm use                     # Node 24 from .nvmrc
cp .env.example .env        # then set DATABASE_URL / REDIS_URL
npm install                 # also generates the Prisma client
npm run db:migrate          # applies migrations to DATABASE_URL
npm run build && npm run db:seed    # default job schedules + the mock source (never in production)
npm run dev:api             # API on :4000 (watch mode)
npm run dev:worker          # worker (separate terminal)
npm run dev:scheduler       # scheduler (separate terminal)
npm run cli -- crawl mock-portal    # enqueue a mock crawl
```
You can also run only the infrastructure in Docker and the app natively:
`docker compose up -d postgres redis`, with `DATABASE_URL=...@localhost:5433/...`.

Without Redis every process still starts; readiness reports `redis: down` (503) and queue work
waits until Redis is back.

## Docker image
One multi-stage `Dockerfile` serves every process; Compose only changes the command.

| Target | Used by | Contents |
|---|---|---|
| `migrate` | `migrate` service / release task | full dependencies + Prisma CLI; runs `prisma migrate deploy` |
| `runtime` | `api`, `worker`, `scheduler`, `seed` | compiled `dist/` (includes the generated Prisma client) + production dependencies only, non-root `node` user |

- The Prisma client is generated during `npm ci` in the `deps` stage and compiled with the rest of `src/`.
  The runtime stage `require`s the compiled client during `docker build`, so a broken client fails the
  build rather than the first container start.
- Containers log JSON (`LOG_FORMAT=json` in Compose). `pino-pretty` is a devDependency and is not in the image.
- `/app/storage` (local document storage) is created owned by `node`, so the `storage-data` volume is writable.

## Configuration
All variables are validated at boot (`src/config/env.schema.ts`); see [`.env.example`](./.env.example)
for the full list. Notable ones:

| Variable | Default | Notes |
|---|---|---|
| `LOG_LEVEL` | `info` | `silent` in tests |
| `LOG_FORMAT` | `pretty` in development, `json` otherwise | `pretty` needs devDependencies — use `json` in containers |
| `QUEUE_PREFIX` | `ats` | BullMQ key prefix; isolates environments sharing one Redis |
| `WORKER_QUEUES` | `*` | comma-separated queues this worker consumes |
| `WORKER_SHUTDOWN_TIMEOUT_MS` | `30000` | how long a stopping worker waits for in-flight jobs |
| `OUTBOX_*` | see `.env.example` | relay on/off, poll interval, batch size, retention |
| `SCHEDULER_SYNC_INTERVAL_MS` | `60000` | how often schedules are reconciled into BullMQ |
| `HEALTH_PORT` | worker `4001`, scheduler `4002` | health server for non-API processes (`0` = any free port) |
| `EMAIL_DRIVER` | `log` | `smtp` arrives in Phase 7 |
| `SEARCH_PROVIDER` | `postgres` | `opensearch` indexing arrives in Phase 4 (the worker refuses to boot with it until then) |
| `JWT_SECRET` | *(required, no default)* | HS256 signing secret for access tokens, ≥32 chars — boot fails without it |
| `JWT_ACCESS_TTL` | `15m` | access token lifetime (`Ns`/`Nm`/`Nh`/`Nd`) |
| `REFRESH_TOKEN_TTL_DAYS` | `30` | opaque refresh token lifetime; the token itself lives only in a hashed `sessions` row |
| `REFRESH_COOKIE_NAME` | `atsgem_rt` | httpOnly cookie name, scoped to `/api/v1/auth` |
| `COOKIE_SECURE` | `true` in production, `false` otherwise | cookie `Secure` flag |
| `LOGIN_MAX_ATTEMPTS` / `LOGIN_LOCKOUT_WINDOW_MINUTES` | `10` / `15` | Redis-backed login lockout, per IP and per account |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | unset | Google OAuth is schema-ready but has no route yet (Phase 2 stub) — these are unused |

## Scripts
| Script | Purpose |
|---|---|
| `npm run build` | Compile to `dist/` with `tsc` |
| `npm run start:api` / `start:worker` / `start:scheduler` | Run compiled processes |
| `npm run dev:api` / `dev:worker` / `dev:scheduler` | Watch mode (tsc-watch) |
| `npm run cli -- <command>` | Ops commands (see Processes) |
| `npm run lint` / `typecheck` / `format` | Code quality |
| `npm test` | Unit tests (Vitest, `src/**/*.spec.ts`; no infrastructure) |
| `npm run test:e2e` | End-to-end tests (`test/**/*.e2e-spec.ts`) against PostgreSQL and Redis |
| `npm run db:migrate` | Create/apply migrations in development |
| `npm run db:deploy` | Apply migrations in CI/production (never on app boot) |
| `npm run db:seed` | Idempotent seed (needs a build) |
| `npm run db:generate` / `db:studio` | Regenerate client / browse data |

## Seed data
`npm run db:seed` (or `docker compose run --rm seed`) is idempotent — it only creates what is missing
and never overwrites something an admin changed. It seeds:
- **Every environment**: staff roles + permissions and their default grants, the 28 states + 8 UTs,
  the tender types, a starter category tree, and the platform job schedules.
- **Non-production**: the deterministic mock crawl source (`mock-portal`).
- **`NODE_ENV=development` only**: demo accounts `admin@dev.atsgem.local` (SUPER_ADMIN) and
  `member@dev.atsgem.local`, a shared organization, one clearly labelled `[DEV SEED]` tender, a saved
  search and a bookmark. Their passwords are **randomly generated on the run that creates them and
  printed once** in the command output (stored only as Argon2id hashes) — there is no default
  credential. Lose one? Use `/auth/forgot-password`, or wipe the dev database and re-seed.

## Testing
- **Unit** tests need nothing running.
- **E2E** tests use a separate database: `DATABASE_URL`'s name + `_test` (e.g. `ats_gem_test`), or
  `TEST_DATABASE_URL`. The suite creates it if missing and applies migrations first; it refuses to
  run against any database whose name does not end in `_test`, because tests truncate tables.
- Queue, scheduler and full-pipeline suites need Redis. Without it they are **skipped** with a
  warning; set `REQUIRE_REDIS=true` (as CI does) to make a missing Redis fail the run instead.
- Every e2e file gets its own BullMQ `QUEUE_PREFIX`, so suites never see each other's jobs (and
  never touch the `ats` keys of a running Compose stack).

Running the whole suite against the Compose infrastructure:
```bash
docker compose up -d postgres redis
# PowerShell: $env:TEST_DATABASE_URL="postgresql://ats_gem:ats_gem_dev@localhost:5433/ats_gem_test?schema=public"
export TEST_DATABASE_URL="postgresql://ats_gem:ats_gem_dev@localhost:5433/ats_gem_test?schema=public"
REQUIRE_REDIS=true npm run test:e2e         # REDIS_URL defaults to redis://localhost:6379 via .env
```

CI (`.github/workflows/backend-ci.yml`) runs: install → type-check → lint → unit → migrate a fresh
database + schema-drift check → e2e (PostgreSQL + Redis service containers) → build. It never deploys.

## Endpoints available now
| Method | Path | Notes |
|---|---|---|
| GET | `/health` | service name, version, environment, uptime |
| GET | `/health/live` | liveness; no dependency checks |
| GET | `/health/ready` | PostgreSQL, Redis, search provider, storage → 200 or 503 `DEPENDENCY_UNAVAILABLE` |
| GET | `/health/queues` | per-queue counts, paused, consumers, oldest waiting job → 200 or 503 (internal; moves behind staff auth in Phase 5) |
| GET | `/api/docs` | Swagger UI (when `SWAGGER_ENABLED=true`) |

Every other route lives under `/api/v1`, uses the response envelope from the API contract, and
requires a bearer access token unless documented as public — see
[docs/API-CONTRACT.md](./docs/API-CONTRACT.md) for the full, up-to-date list (auth, `/me`,
organizations, `/meta`, tender search/detail, saved searches, watchlist, notifications) and which
rows are still Phase 3+ only.

## Project layout
```text
src/
  main.{api,worker,scheduler,cli}.ts  process entrypoints (same codebase, separate deployables)
  api.module.ts · worker.module.ts · scheduler-app.module.ts · cli.module.ts   composition roots
  bootstrap/configure-app.ts          helmet, CORS, prefix, validation, errors, envelope, Swagger
  config/                             zod-validated environment → typed AppConfig
  common/                             errors, HTTP envelope/filter, request id, correlation context
  logging/                            pino structured logs, request correlation, secret redaction
  database/                           PrismaService (pg driver adapter, UTC sessions), seed
  redis/                              shared ioredis client
  queues/                             queue topology, typed job registry, producer, queue health
  workers/                            worker host (BullMQ consumers), job runner, process health server
  outbox/                             domain events, transactional outbox, relay, cleanup
  scheduler/                          schedule catalog (DB), BullMQ backend, reconciler, leader lock
  crawler/                            adapter contract, mock adapter, normalization, ingestion, handlers
  search/ · email/                    indexing and email job handlers (pluggable providers)
  modules/health/                     liveness, readiness, queue health
  auth/                               JWT + opaque refresh tokens, sessions, Argon2id, login throttle
  rbac/                               staff permissions guard, organization-role guard, constants
  audit/                              append-only audit log service (global)
  users/ · organizations/             /me, personal + team organizations, invitations, org switch
  taxonomy/                           /meta states, categories, tender types (seeded reference data)
  tenders/                            /search/tenders + /tenders/:id (indexed filters, not the search engine)
  saved-searches/ · watchlist/        organization-scoped saved searches, per-user bookmarks
  notifications/                      in-app notification records (no delivery yet)
  generated/prisma/                   Prisma client (generated, git-ignored)
prisma/  schema.prisma · migrations/  (prisma7.config.ts at the root)
test/    e2e tests + support (test DB, Redis gating, config overrides)
```

## Toolchain notes
- **Node 24 LTS** is the baseline (`.nvmrc`, `engines`, Docker `node:24-alpine`, CI `node-version-file`).
- **Build uses `tsc`, not the Nest CLI.** The Nest 12 CLI works on Node 24, but the `tsc` build is
  kept: it is simpler, has no extra loader, and behaves identically in Docker and CI.
- **Tests use Vitest + SWC.** SWC emits the decorator metadata Nest's dependency injection needs.
- **Prisma 7** needs a driver adapter (`@prisma/adapter-pg`) and reads its settings from
  `prisma7.config.ts`. Sessions are pinned to `TimeZone=UTC`: the adapter sends offset-less UTC
  timestamps, which a Postgres server configured for a local zone (e.g. IST) would otherwise shift.
- **Prisma generator** (`prisma-client`, CommonJS, output `src/generated/prisma`) sets
  `importFileExtension = "js"` explicitly. Otherwise Prisma infers it from a `tsconfig.json` and
  falls back to `.ts` when none is visible (as in the Docker `deps` stage), producing requires that
  do not exist in `dist/`.
- **BullMQ 6** supports Redis ≥ 5 (6.2+ recommended; Compose and CI use 7) and requires
  `maxmemory-policy noeviction` so queue keys are never evicted (set in `docker-compose.yml`; set
  the same parameter group value on ElastiCache).
- **Password hashing** uses `@node-rs/argon2` (napi-rs), not the more common `argon2` (node-pre-gyp)
  package: it ships a prebuilt `linux-x64-musl` binary, so it installs and runs on `node:24-alpine`
  without a C++ build step in the image.

## Troubleshooting
| Symptom | Cause | Fix |
|---|---|---|
| `Cannot find module './internal/class.ts'` from `dist/generated/prisma/client.js` | Prisma client generated without `importFileExtension = "js"` (it falls back to `.ts` when no tsconfig is visible) | Keep `importFileExtension = "js"` in `prisma/schema.prisma`, then `npm run db:generate && npm run build` or `docker compose build` |
| `unable to determine transport target for "pino-pretty"` in a container | `LOG_FORMAT` resolved to `pretty` (e.g. `NODE_ENV=development`) but the runtime image has no devDependencies | Set `LOG_FORMAT=json` for containers (Compose already does) |
| API readiness 503, `storage … EACCES: permission denied, access '/app/storage'` | `storage-data` volume created before `/app/storage` existed in the image, so its root is owned by `root` | Rebuild the image; a volume that already holds files keeps its old owner — fix once with `docker run --rm -v ats-gem_storage-data:/data alpine chown 1000:1000 /data` |
| Readiness 503 with `redis: down` | Redis unreachable | Start Redis (`docker compose up -d redis`); processes recover automatically |
| E2E queue/scheduler/pipeline suites "skipped" | Redis not reachable from the test run | Start Redis, or set `REQUIRE_REDIS=true` to make this an error |
| E2E refuses to start: database name must end in `_test` | Safety check — tests truncate tables | Point `TEST_DATABASE_URL` at a `*_test` database |
