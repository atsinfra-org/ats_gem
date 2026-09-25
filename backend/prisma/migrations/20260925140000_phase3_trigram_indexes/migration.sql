-- Trigram indexes backing DeduplicationEngine/EntityResolutionService similarity() queries.

CREATE INDEX "tenders_title_trgm_idx" ON "tenders" USING gin ("title" gin_trgm_ops);
CREATE INDEX "procuring_entities_name_normalized_trgm_idx" ON "procuring_entities" USING gin ("name_normalized" gin_trgm_ops);
