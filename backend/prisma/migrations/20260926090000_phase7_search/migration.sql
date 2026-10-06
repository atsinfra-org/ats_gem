-- CreateEnum
CREATE TYPE "search_event_type" AS ENUM ('SEARCH_SUBMITTED', 'FILTER_APPLIED', 'FILTER_REMOVED', 'SORT_CHANGED', 'RESULT_OPENED', 'RESULT_SAVED', 'SEARCH_SAVED', 'SUGGESTION_SELECTED');

-- AlterTable
ALTER TABLE "tenders" ADD COLUMN     "search_vector" tsvector;

-- CreateTable
CREATE TABLE "search_history" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID,
    "query_normalized" TEXT NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "dedup_key" CHAR(64) NOT NULL,
    "search_count" INTEGER NOT NULL DEFAULT 1,
    "first_searched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_searched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_events" (
    "id" UUID NOT NULL,
    "event_type" "search_event_type" NOT NULL,
    "user_id" UUID,
    "organization_id" UUID,
    "query_normalized" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_index_runs" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "processed" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "details" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "search_index_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "search_history_user_id_last_searched_at_idx" ON "search_history"("user_id", "last_searched_at" DESC);

-- CreateIndex
CREATE INDEX "search_history_query_normalized_last_searched_at_idx" ON "search_history"("query_normalized", "last_searched_at");

-- CreateIndex
CREATE UNIQUE INDEX "search_history_user_id_dedup_key_key" ON "search_history"("user_id", "dedup_key");

-- CreateIndex
CREATE INDEX "search_events_event_type_created_at_idx" ON "search_events"("event_type", "created_at");

-- CreateIndex
CREATE INDEX "search_events_created_at_idx" ON "search_events"("created_at");

-- CreateIndex
CREATE INDEX "search_index_runs_started_at_idx" ON "search_index_runs"("started_at" DESC);

-- AddForeignKey
ALTER TABLE "search_history" ADD CONSTRAINT "search_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─── Phase 7 search: weighted full-text vector, trigger maintenance, filter/sort indexes ───
-- The vector is built by one function so the trigger, the backfill below and `search:reindex` cannot
-- diverge. Weights: A title + reference, B procuring entity/department, C category + location, D tender type.
-- The 'simple' configuration is deliberate: tender text is names, references and mixed-language
-- department strings, where English stemming/stop-words would hurt more than help.

CREATE OR REPLACE FUNCTION tender_search_vector_build(t tenders) RETURNS tsvector
LANGUAGE sql STABLE AS $$
  SELECT
    setweight(to_tsvector('simple', coalesce(t.title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(t.reference_number, '') || ' ' || coalesce(t.reference_number_normalized, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(t.department, '') || ' ' || coalesce((SELECT pe.name FROM procuring_entities pe WHERE pe.id = t.procuring_entity_id), '')), 'B') ||
    setweight(to_tsvector('simple', coalesce((SELECT c.name FROM categories c WHERE c.id = t.category_id), '') || ' ' || coalesce((SELECT c.name FROM categories c WHERE c.id = t.sub_category_id), '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(t.city, '') || ' ' || coalesce(t.location_text, '') || ' ' || coalesce((SELECT s.name FROM states s WHERE s.code = t.state_code), '')), 'C') ||
    setweight(to_tsvector('simple', coalesce((SELECT tt.name FROM tender_types tt WHERE tt.key = t.tender_type_key), '')), 'D')
$$;

CREATE OR REPLACE FUNCTION tenders_search_vector_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector := tender_search_vector_build(NEW);
  RETURN NEW;
END;
$$;

CREATE TRIGGER tenders_search_vector_trg
  BEFORE INSERT OR UPDATE OF title, reference_number, reference_number_normalized, department, procuring_entity_id,
    category_id, sub_category_id, state_code, city, location_text, tender_type_key
  ON tenders
  FOR EACH ROW EXECUTE FUNCTION tenders_search_vector_trigger();

-- Backfill existing rows (large tables use `search:reindex`, which batches the same function).
UPDATE tenders t SET search_vector = tender_search_vector_build(t);

CREATE INDEX "tenders_search_vector_gin_idx" ON "tenders" USING gin ("search_vector");
CREATE INDEX "tenders_reference_norm_trgm_idx" ON "tenders" USING gin ("reference_number_normalized" gin_trgm_ops);
CREATE INDEX "tenders_state_published_idx" ON "tenders" ("state_code", "published_at" DESC, "id" DESC);
CREATE INDEX "tenders_published_id_idx" ON "tenders" ("published_at" DESC, "id" DESC) WHERE "deleted_at" IS NULL AND "duplicate_of_id" IS NULL;
CREATE INDEX "tenders_closing_at_idx" ON "tenders" ("closing_at");
CREATE INDEX "tenders_opening_at_idx" ON "tenders" ("opening_at");
CREATE INDEX "tenders_estimated_value_idx" ON "tenders" ("estimated_value");
CREATE INDEX "tenders_emd_amount_idx" ON "tenders" ("emd_amount");
CREATE INDEX "tenders_tender_fee_idx" ON "tenders" ("tender_fee");
CREATE INDEX "tenders_tender_type_key_idx" ON "tenders" ("tender_type_key");
CREATE INDEX "tenders_city_lower_idx" ON "tenders" (lower("city"));
CREATE INDEX "tender_source_records_source_tender_idx" ON "tender_source_records" ("source_id", "tender_id");
