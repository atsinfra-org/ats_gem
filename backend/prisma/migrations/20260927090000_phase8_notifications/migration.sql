-- CreateEnum
CREATE TYPE "notification_priority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "saved_search_alert_frequency" AS ENUM ('OFF', 'IMMEDIATE', 'DAILY');

-- CreateEnum
CREATE TYPE "notification_category" AS ENUM ('SAVED_SEARCH_ALERTS', 'SAVED_TENDER_UPDATES', 'DEADLINE_REMINDERS', 'CORRIGENDA', 'STATUS_CHANGES', 'SYSTEM');

-- CreateEnum
CREATE TYPE "notification_channel" AS ENUM ('IN_APP', 'EMAIL');

-- CreateEnum
CREATE TYPE "delivery_status" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'RETRYING', 'FAILED', 'SKIPPED', 'DIGEST_PENDING', 'DIGESTED');

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "dedup_key" TEXT,
ADD COLUMN     "expires_at" TIMESTAMPTZ(6),
ADD COLUMN     "metadata" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "organization_id" UUID,
ADD COLUMN     "priority" "notification_priority" NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "source_event_id" TEXT,
ADD COLUMN     "template_key" TEXT,
ADD COLUMN     "template_version" INTEGER;

-- AlterTable
ALTER TABLE "saved_searches" ADD COLUMN     "alert_frequency" "saved_search_alert_frequency" NOT NULL DEFAULT 'OFF';

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "category" "notification_category" NOT NULL,
    "channel" "notification_channel" NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_settings" (
    "user_id" UUID NOT NULL,
    "deadline_offsets_hours" INTEGER[] DEFAULT ARRAY[24]::INTEGER[],
    "quiet_hours_enabled" BOOLEAN NOT NULL DEFAULT false,
    "quiet_start" VARCHAR(5),
    "quiet_end" VARCHAR(5),
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "notification_id" UUID,
    "digest_id" UUID,
    "channel" "notification_channel" NOT NULL DEFAULT 'EMAIL',
    "status" "delivery_status" NOT NULL,
    "template_key" TEXT NOT NULL,
    "template_version" INTEGER NOT NULL,
    "provider" TEXT,
    "provider_message_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "skip_reason" TEXT,
    "last_error" TEXT,
    "item_count" INTEGER,
    "queued_at" TIMESTAMPTZ(6),
    "sent_at" TIMESTAMPTZ(6),
    "failed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_user_id_category_channel_key" ON "notification_preferences"("user_id", "category", "channel");

-- CreateIndex
CREATE INDEX "notification_deliveries_status_idx" ON "notification_deliveries"("status", "created_at");

-- CreateIndex
CREATE INDEX "notification_deliveries_user_idx" ON "notification_deliveries"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notification_deliveries_user_status_idx" ON "notification_deliveries"("user_id", "status");

-- CreateIndex
CREATE INDEX "notification_deliveries_digest_idx" ON "notification_deliveries"("digest_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_notification_channel_key" ON "notification_deliveries"("notification_id", "channel");

-- CreateIndex
CREATE INDEX "notifications_user_type_idx" ON "notifications"("user_id", "type", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notifications_organization_idx" ON "notifications"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_user_dedup_key" ON "notifications"("user_id", "dedup_key");

-- CreateIndex
CREATE INDEX "saved_searches_alerting_idx" ON "saved_searches"("alert_frequency");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_digest_id_fkey" FOREIGN KEY ("digest_id") REFERENCES "notification_deliveries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

