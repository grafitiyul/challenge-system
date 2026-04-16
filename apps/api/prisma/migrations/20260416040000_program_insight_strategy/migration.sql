-- Phase 6.8 — Scoped insight selection strategy (per program)
--
-- Replaces the global in-memory typeUsageCounter with a per-program
-- persisted counter. Each Program gets its own strategy + tuning knob;
-- cross-program interference is eliminated.

ALTER TABLE "programs"
  ADD COLUMN "insightSelectionStrategy" TEXT NOT NULL DEFAULT 'score_with_diversity',
  ADD COLUMN "insightDiversityStrength" DOUBLE PRECISION NOT NULL DEFAULT 0.3;

CREATE TABLE "program_insight_type_usages" (
  "id" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "insightType" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "program_insight_type_usages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "program_insight_type_usages_programId_insightType_key"
  ON "program_insight_type_usages"("programId", "insightType");

CREATE INDEX "program_insight_type_usages_programId_idx"
  ON "program_insight_type_usages"("programId");

ALTER TABLE "program_insight_type_usages"
  ADD CONSTRAINT "program_insight_type_usages_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "programs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
