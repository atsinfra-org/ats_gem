-- CreateEnum
CREATE TYPE "analytics_event_name" AS ENUM ('PAGE_VIEW', 'REGISTRATION_STARTED', 'REGISTRATION_COMPLETED', 'EMAIL_VERIFICATION_COMPLETED', 'LOGIN_SUCCESS', 'LOGIN_FAILURE', 'LOGOUT', 'TENDER_VIEWED', 'TENDER_SAVED', 'TENDER_UNSAVED', 'TENDER_SOURCE_OPENED', 'TENDER_CORRIGENDUM_VIEWED', 'TENDER_VERSION_VIEWED', 'DOCUMENT_VIEWED', 'DOCUMENT_DOWNLOADED', 'DOCUMENT_DOWNLOAD_FAILED', 'NOTIFICATION_VIEWED', 'NOTIFICATION_CLICKED', 'NOTIFICATION_PREFERENCES_UPDATED', 'PROFILE_VIEWED', 'PROFILE_UPDATED', 'ORGANIZATION_VIEWED', 'CLIENT_ERROR', 'API_ERROR');

-- CreateTable
CREATE TABLE "analytics_events" (
    "id" UUID NOT NULL,
    "event_name" "analytics_event_name" NOT NULL,
    "anonymous_id" TEXT,
    "session_id" UUID,
    "user_id" UUID,
    "organization_id" UUID,
    "entity_type" TEXT,
    "entity_id" UUID,
    "path" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "correlation_id" TEXT,

    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_sessions" (
    "id" UUID NOT NULL,
    "anonymous_id" TEXT NOT NULL,
    "user_id" UUID,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_activity_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(6),
    "landing_path" TEXT,
    "referrer_host" TEXT,
    "utm_source" TEXT,
    "utm_medium" TEXT,
    "utm_campaign" TEXT,
    "utm_term" TEXT,
    "utm_content" TEXT,
    "page_view_count" INTEGER NOT NULL DEFAULT 0,
    "event_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "analytics_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_daily_rollups" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "metric" TEXT NOT NULL,
    "dimension" TEXT NOT NULL DEFAULT 'global',
    "count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "analytics_daily_rollups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_processing_runs" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "processed" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "details" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "analytics_processing_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "analytics_events_name_time_idx" ON "analytics_events"("event_name", "occurred_at");

-- CreateIndex
CREATE INDEX "analytics_events_org_time_idx" ON "analytics_events"("organization_id", "occurred_at");

-- CreateIndex
CREATE INDEX "analytics_events_user_time_idx" ON "analytics_events"("user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "analytics_events_session_idx" ON "analytics_events"("session_id");

-- CreateIndex
CREATE INDEX "analytics_events_received_idx" ON "analytics_events"("received_at");

-- CreateIndex
CREATE INDEX "analytics_sessions_user_idx" ON "analytics_sessions"("user_id");

-- CreateIndex
CREATE INDEX "analytics_sessions_last_activity_idx" ON "analytics_sessions"("last_activity_at");

-- CreateIndex
CREATE INDEX "analytics_sessions_anon_activity_idx" ON "analytics_sessions"("anonymous_id", "last_activity_at" DESC);

-- CreateIndex
CREATE INDEX "analytics_daily_rollups_metric_date_idx" ON "analytics_daily_rollups"("metric", "date");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_daily_rollups_key" ON "analytics_daily_rollups"("date", "metric", "dimension");

-- CreateIndex
CREATE INDEX "analytics_processing_runs_started_idx" ON "analytics_processing_runs"("started_at" DESC);

-- AddForeignKey
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "analytics_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_sessions" ADD CONSTRAINT "analytics_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

