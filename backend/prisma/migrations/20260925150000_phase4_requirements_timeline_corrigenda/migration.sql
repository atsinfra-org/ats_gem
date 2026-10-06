-- CreateEnum
CREATE TYPE "requirement_type" AS ENUM ('ELIGIBILITY', 'FINANCIAL', 'TECHNICAL', 'EXPERIENCE', 'LEGAL', 'REGISTRATION', 'DOCUMENTATION', 'LOCATION', 'PERSONNEL', 'EQUIPMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "tender_event_type" AS ENUM ('PUBLISHED', 'DOCUMENT_AVAILABLE', 'CLARIFICATION_OPENED', 'PRE_BID_MEETING', 'CLARIFICATION_CLOSED', 'SUBMISSION_OPENED', 'SUBMISSION_DEADLINE', 'OPENING', 'EXTENDED', 'CORRIGENDUM', 'CANCELLED', 'AWARDED', 'OTHER');

-- AlterTable
ALTER TABLE "tender_documents" ADD COLUMN     "source_document_id" TEXT;

-- CreateTable
CREATE TABLE "tender_requirements" (
    "id" UUID NOT NULL,
    "tender_id" UUID NOT NULL,
    "type" "requirement_type" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "value" DECIMAL(18,2),
    "unit" TEXT,
    "is_mandatory" BOOLEAN NOT NULL DEFAULT true,
    "source_reference" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tender_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tender_events" (
    "id" UUID NOT NULL,
    "tender_id" UUID NOT NULL,
    "event_type" "tender_event_type" NOT NULL,
    "event_at" TIMESTAMPTZ(6),
    "title" TEXT,
    "description" TEXT,
    "source_reference" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tender_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tender_corrigenda" (
    "id" UUID NOT NULL,
    "tender_id" UUID NOT NULL,
    "source_id" UUID,
    "source_reference" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "published_at" TIMESTAMPTZ(6) NOT NULL,
    "effective_at" TIMESTAMPTZ(6),
    "source_url" TEXT,
    "document_id" UUID,
    "affected_fields" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tender_corrigenda_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tender_requirements_tender_id_type_idx" ON "tender_requirements"("tender_id", "type");

-- CreateIndex
CREATE INDEX "tender_events_tender_id_event_at_idx" ON "tender_events"("tender_id", "event_at");

-- CreateIndex
CREATE UNIQUE INDEX "tender_events_tender_id_event_type_event_at_key" ON "tender_events"("tender_id", "event_type", "event_at");

-- CreateIndex
CREATE INDEX "tender_corrigenda_tender_id_published_at_idx" ON "tender_corrigenda"("tender_id", "published_at");

-- AddForeignKey
ALTER TABLE "tender_requirements" ADD CONSTRAINT "tender_requirements_tender_id_fkey" FOREIGN KEY ("tender_id") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_events" ADD CONSTRAINT "tender_events_tender_id_fkey" FOREIGN KEY ("tender_id") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_corrigenda" ADD CONSTRAINT "tender_corrigenda_tender_id_fkey" FOREIGN KEY ("tender_id") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_corrigenda" ADD CONSTRAINT "tender_corrigenda_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "tender_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_corrigenda" ADD CONSTRAINT "tender_corrigenda_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "tender_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Data-integrity CHECK constraints (docs/DATABASE.md conventions).

ALTER TABLE "tender_requirements" ADD CONSTRAINT "tender_requirements_value_non_negative_chk"
  CHECK ("value" IS NULL OR "value" >= 0);

ALTER TABLE "tender_corrigenda" ADD CONSTRAINT "tender_corrigenda_effective_after_published_chk"
  CHECK ("effective_at" IS NULL OR "effective_at" >= "published_at");
