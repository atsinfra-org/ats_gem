-- CreateEnum
CREATE TYPE "procuring_entity_type" AS ENUM ('CENTRAL_MINISTRY', 'STATE_DEPT', 'PSU', 'MUNICIPAL', 'AUTONOMOUS_BODY', 'UNIVERSITY', 'HOSPITAL', 'RAILWAYS', 'DEFENCE', 'PRIVATE', 'OTHER');

-- CreateEnum
CREATE TYPE "procuring_entity_status" AS ENUM ('ACTIVE', 'INACTIVE', 'MERGED');

-- CreateEnum
CREATE TYPE "entity_mapping_method" AS ENUM ('EXACT_SOURCE_MAPPING', 'EXACT_NORMALIZED_NAME', 'ALIAS', 'FUZZY', 'MANUAL');

-- CreateEnum
CREATE TYPE "entity_verification_status" AS ENUM ('UNVERIFIED', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "tender_version_change_type" AS ENUM ('INITIAL', 'UPDATE', 'CORRIGENDUM', 'CANCELLATION');

-- CreateEnum
CREATE TYPE "duplicate_candidate_status" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED', 'AUTO_CONFIRMED');

-- CreateEnum
CREATE TYPE "data_quality_severity" AS ENUM ('INFO', 'WARNING', 'ERROR');

-- AlterTable
ALTER TABLE "tenders" ADD COLUMN     "duplicate_of_id" UUID,
ADD COLUMN     "procuring_entity_id" UUID,
ADD COLUMN     "source_status_raw" TEXT;

-- CreateTable
CREATE TABLE "procuring_entities" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "name_normalized" TEXT NOT NULL,
    "short_name" TEXT,
    "entity_type" "procuring_entity_type" NOT NULL,
    "parent_id" UUID,
    "state_code" CHAR(2),
    "district_id" UUID,
    "city" TEXT,
    "website" TEXT,
    "status" "procuring_entity_status" NOT NULL DEFAULT 'ACTIVE',
    "merged_into_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "procuring_entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procuring_entity_aliases" (
    "id" UUID NOT NULL,
    "procuring_entity_id" UUID NOT NULL,
    "alias" TEXT NOT NULL,
    "alias_normalized" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "procuring_entity_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_entity_mappings" (
    "id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "source_entity_name" TEXT NOT NULL,
    "source_entity_normalized" TEXT NOT NULL,
    "procuring_entity_id" UUID,
    "confidence" DECIMAL(4,3) NOT NULL,
    "method" "entity_mapping_method" NOT NULL,
    "verification_status" "entity_verification_status" NOT NULL DEFAULT 'UNVERIFIED',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "source_entity_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tender_versions" (
    "id" UUID NOT NULL,
    "tender_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "change_type" "tender_version_change_type" NOT NULL,
    "diff" JSONB NOT NULL,
    "source_record_id" UUID,
    "detected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tender_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "duplicate_candidates" (
    "id" UUID NOT NULL,
    "tender_id" UUID NOT NULL,
    "candidate_tender_id" UUID NOT NULL,
    "score" DECIMAL(4,3) NOT NULL,
    "signals" JSONB NOT NULL,
    "status" "duplicate_candidate_status" NOT NULL DEFAULT 'PENDING',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "duplicate_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tender_quality_issues" (
    "id" UUID NOT NULL,
    "tender_id" UUID NOT NULL,
    "source_record_id" UUID,
    "severity" "data_quality_severity" NOT NULL,
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "detected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),

    CONSTRAINT "tender_quality_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "procuring_entities_parent_id_idx" ON "procuring_entities"("parent_id");

-- CreateIndex
CREATE INDEX "procuring_entities_merged_into_id_idx" ON "procuring_entities"("merged_into_id");

-- CreateIndex
CREATE UNIQUE INDEX "procuring_entities_name_normalized_state_code_key" ON "procuring_entities"("name_normalized", "state_code");

-- CreateIndex
CREATE UNIQUE INDEX "procuring_entity_aliases_alias_normalized_key" ON "procuring_entity_aliases"("alias_normalized");

-- CreateIndex
CREATE INDEX "source_entity_mappings_procuring_entity_id_idx" ON "source_entity_mappings"("procuring_entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "source_entity_mappings_source_id_source_entity_normalized_key" ON "source_entity_mappings"("source_id", "source_entity_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "tender_versions_tender_id_version_key" ON "tender_versions"("tender_id", "version");

-- CreateIndex
CREATE INDEX "duplicate_candidates_status_idx" ON "duplicate_candidates"("status");

-- CreateIndex
CREATE UNIQUE INDEX "duplicate_candidates_tender_id_candidate_tender_id_key" ON "duplicate_candidates"("tender_id", "candidate_tender_id");

-- CreateIndex
CREATE INDEX "tender_quality_issues_tender_id_idx" ON "tender_quality_issues"("tender_id");

-- CreateIndex
CREATE INDEX "tender_quality_issues_severity_resolved_at_idx" ON "tender_quality_issues"("severity", "resolved_at");

-- CreateIndex
CREATE INDEX "tenders_procuring_entity_id_idx" ON "tenders"("procuring_entity_id");

-- AddForeignKey
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_procuring_entity_id_fkey" FOREIGN KEY ("procuring_entity_id") REFERENCES "procuring_entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_duplicate_of_id_fkey" FOREIGN KEY ("duplicate_of_id") REFERENCES "tenders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procuring_entities" ADD CONSTRAINT "procuring_entities_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "procuring_entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procuring_entities" ADD CONSTRAINT "procuring_entities_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "procuring_entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procuring_entities" ADD CONSTRAINT "procuring_entities_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procuring_entity_aliases" ADD CONSTRAINT "procuring_entity_aliases_procuring_entity_id_fkey" FOREIGN KEY ("procuring_entity_id") REFERENCES "procuring_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_entity_mappings" ADD CONSTRAINT "source_entity_mappings_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "tender_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_entity_mappings" ADD CONSTRAINT "source_entity_mappings_procuring_entity_id_fkey" FOREIGN KEY ("procuring_entity_id") REFERENCES "procuring_entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_versions" ADD CONSTRAINT "tender_versions_tender_id_fkey" FOREIGN KEY ("tender_id") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_tender_id_fkey" FOREIGN KEY ("tender_id") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_candidate_tender_id_fkey" FOREIGN KEY ("candidate_tender_id") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_quality_issues" ADD CONSTRAINT "tender_quality_issues_tender_id_fkey" FOREIGN KEY ("tender_id") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Data-integrity CHECK constraints (docs/DATABASE.md conventions).

ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_ordering_chk"
  CHECK ("tender_id" < "candidate_tender_id");

ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_score_chk"
  CHECK ("score" >= 0 AND "score" <= 1);

ALTER TABLE "source_entity_mappings" ADD CONSTRAINT "source_entity_mappings_confidence_chk"
  CHECK ("confidence" >= 0 AND "confidence" <= 1);

ALTER TABLE "tender_versions" ADD CONSTRAINT "tender_versions_version_chk"
  CHECK ("version" >= 1);

ALTER TABLE "procuring_entities" ADD CONSTRAINT "procuring_entities_not_own_parent_chk"
  CHECK ("parent_id" IS NULL OR "parent_id" <> "id");

ALTER TABLE "procuring_entities" ADD CONSTRAINT "procuring_entities_not_own_merge_chk"
  CHECK ("merged_into_id" IS NULL OR "merged_into_id" <> "id");

ALTER TABLE "tenders" ADD CONSTRAINT "tenders_not_own_duplicate_chk"
  CHECK ("duplicate_of_id" IS NULL OR "duplicate_of_id" <> "id");

-- Partial unique indexes closing two gaps Phase 2 documented as application-enforced only
-- (docs/DATABASE.md Sec 0). Verified against existing data before adding: every organization
-- already has exactly one OWNER, and no pending invitations exist yet, so neither index can
-- reject real rows. users.email / organizations.slug|gstin stay plain-unique (not partial) --
-- several call sites use Prisma findUnique() on them, which requires the column modeled as
-- @unique; making those partial would mean rewriting those call sites to findFirst(), deferred
-- as a separate, lower-risk change (docs/ARCHITECTURE.md Sec 19.7).

CREATE UNIQUE INDEX "organization_members_one_owner_per_org"
  ON "organization_members" ("organization_id") WHERE "role" = 'OWNER';

CREATE UNIQUE INDEX "organization_invitations_one_pending_per_email"
  ON "organization_invitations" ("organization_id", "email") WHERE "accepted_at" IS NULL;
