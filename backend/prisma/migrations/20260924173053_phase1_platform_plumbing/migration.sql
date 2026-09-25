-- CreateEnum
CREATE TYPE "source_type" AS ENUM ('GOVT_PORTAL', 'PSU', 'STATE_PORTAL', 'PRIVATE', 'AGGREGATOR', 'MOCK');

-- CreateEnum
CREATE TYPE "source_health_status" AS ENUM ('UNKNOWN', 'HEALTHY', 'DEGRADED', 'AUTH_REQUIRED', 'NEEDS_MANUAL_ACTION', 'DISABLED');

-- CreateEnum
CREATE TYPE "crawl_trigger" AS ENUM ('SCHEDULE', 'MANUAL', 'RETRY');

-- CreateEnum
CREATE TYPE "crawl_run_status" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'RETRYING', 'CANCELLED');

-- CreateEnum
CREATE TYPE "tender_lifecycle" AS ENUM ('ACTIVE', 'CANCELLED', 'AWARDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "tender_status" AS ENUM ('UPCOMING', 'OPEN', 'CLOSING_SOON', 'CLOSED', 'CANCELLED', 'AWARDED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "correlation_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(6),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_schedules" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "job_name" TEXT NOT NULL,
    "cron" TEXT,
    "every_ms" INTEGER,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "job_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tender_sources" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "website_url" TEXT,
    "description" TEXT,
    "source_type" "source_type" NOT NULL,
    "adapter_key" TEXT NOT NULL,
    "authentication_required" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "crawl_enabled" BOOLEAN NOT NULL DEFAULT false,
    "crawl_schedule" TEXT,
    "crawl_timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "crawl_config" JSONB NOT NULL DEFAULT '{}',
    "health_status" "source_health_status" NOT NULL DEFAULT 'UNKNOWN',
    "health_checked_at" TIMESTAMPTZ(6),
    "last_successful_run_at" TIMESTAMPTZ(6),
    "last_failed_run_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" UUID,

    CONSTRAINT "tender_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crawl_runs" (
    "id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "trigger" "crawl_trigger" NOT NULL,
    "triggered_by" UUID,
    "status" "crawl_run_status" NOT NULL DEFAULT 'QUEUED',
    "job_id" TEXT,
    "correlation_id" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "duration_ms" INTEGER,
    "records_found" INTEGER NOT NULL DEFAULT 0,
    "records_created" INTEGER NOT NULL DEFAULT 0,
    "records_updated" INTEGER NOT NULL DEFAULT 0,
    "records_skipped" INTEGER NOT NULL DEFAULT 0,
    "documents_found" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "failure_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "crawl_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenders" (
    "id" UUID NOT NULL,
    "reference_number" TEXT,
    "reference_number_normalized" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "department" TEXT,
    "state_code" CHAR(2),
    "city" TEXT,
    "location_text" TEXT,
    "estimated_value" DECIMAL(18,2),
    "emd_amount" DECIMAL(18,2),
    "tender_fee" DECIMAL(18,2),
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "published_at" TIMESTAMPTZ(6) NOT NULL,
    "closing_at" TIMESTAMPTZ(6),
    "opening_at" TIMESTAMPTZ(6),
    "lifecycle" "tender_lifecycle" NOT NULL DEFAULT 'ACTIVE',
    "status" "tender_status" NOT NULL,
    "status_computed_at" TIMESTAMPTZ(6) NOT NULL,
    "primary_source_url" TEXT,
    "last_synced_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" UUID,

    CONSTRAINT "tenders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tender_source_records" (
    "id" UUID NOT NULL,
    "tender_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "external_tender_id" TEXT NOT NULL,
    "source_url" TEXT,
    "payload_hash" CHAR(64) NOT NULL,
    "raw_payload" JSONB NOT NULL,
    "normalized_payload" JSONB NOT NULL,
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL,
    "last_changed_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tender_source_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outbox_events_pending_idx" ON "outbox_events"("published_at", "available_at");

-- CreateIndex
CREATE INDEX "outbox_events_aggregate_type_aggregate_id_idx" ON "outbox_events"("aggregate_type", "aggregate_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_schedules_key_key" ON "job_schedules"("key");

-- CreateIndex
CREATE UNIQUE INDEX "tender_sources_slug_key" ON "tender_sources"("slug");

-- CreateIndex
CREATE INDEX "crawl_runs_source_id_created_at_idx" ON "crawl_runs"("source_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "crawl_runs_status_idx" ON "crawl_runs"("status");

-- CreateIndex
CREATE INDEX "tenders_status_closing_at_idx" ON "tenders"("status", "closing_at");

-- CreateIndex
CREATE INDEX "tenders_published_at_idx" ON "tenders"("published_at" DESC);

-- CreateIndex
CREATE INDEX "tenders_reference_number_normalized_idx" ON "tenders"("reference_number_normalized");

-- CreateIndex
CREATE INDEX "tender_source_records_tender_id_idx" ON "tender_source_records"("tender_id");

-- CreateIndex
CREATE UNIQUE INDEX "tender_source_records_source_id_external_tender_id_key" ON "tender_source_records"("source_id", "external_tender_id");

-- AddForeignKey
ALTER TABLE "crawl_runs" ADD CONSTRAINT "crawl_runs_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "tender_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_source_records" ADD CONSTRAINT "tender_source_records_tender_id_fkey" FOREIGN KEY ("tender_id") REFERENCES "tenders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_source_records" ADD CONSTRAINT "tender_source_records_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "tender_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Integrity constraints (hand-written; Prisma leaves CHECK constraints untouched) ───

-- A schedule is either cron-based or interval-based, never both or neither.
ALTER TABLE "job_schedules" ADD CONSTRAINT "job_schedules_trigger_chk"
  CHECK ((cron IS NOT NULL) <> (every_ms IS NOT NULL));
ALTER TABLE "job_schedules" ADD CONSTRAINT "job_schedules_every_ms_chk"
  CHECK (every_ms IS NULL OR every_ms >= 1000);

ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_attempts_chk" CHECK (attempts >= 0);

ALTER TABLE "crawl_runs" ADD CONSTRAINT "crawl_runs_counters_chk" CHECK (
  records_found >= 0 AND records_created >= 0 AND records_updated >= 0 AND
  records_skipped >= 0 AND documents_found >= 0 AND error_count >= 0 AND
  (duration_ms IS NULL OR duration_ms >= 0)
);

-- Money is exact and never negative; dates are coherent; codes are well-formed.
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_money_chk" CHECK (
  (estimated_value IS NULL OR estimated_value >= 0) AND
  (emd_amount IS NULL OR emd_amount >= 0) AND
  (tender_fee IS NULL OR tender_fee >= 0)
);
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_dates_chk"
  CHECK (closing_at IS NULL OR closing_at >= published_at);
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_currency_chk" CHECK (currency ~ '^[A-Z]{3}$');
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_state_code_chk"
  CHECK (state_code IS NULL OR state_code ~ '^[A-Z]{2}$');

ALTER TABLE "tender_source_records" ADD CONSTRAINT "tender_source_records_hash_chk"
  CHECK (payload_hash ~ '^[0-9a-f]{64}$');
