-- =============================================================================
-- Phase 4.3 — Centralize analytics groups
-- =============================================================================
-- Replaces the pair of free-text fields (analyticsGroupKey, analyticsGroupLabel)
-- on context_definitions with a proper AnalyticsGroup entity + FK.
--
-- Data migration:
--   1. Create analytics_groups table.
--   2. Add analyticsGroupId FK column on context_definitions.
--   3. For each DISTINCT (programId, analyticsGroupLabel) pair that's populated,
--      create one analytics_groups row.
--   4. Point context_definitions.analyticsGroupId at the matching row.
--   5. Drop the now-redundant analyticsGroupKey / analyticsGroupLabel columns.
--
-- Groups with no members become ownable-on-the-fly via admin UI; migration
-- never creates orphan groups (only groups that at least one context uses).
-- =============================================================================


-- ─── 1. analytics_groups table ────────────────────────────────────────────────
CREATE TABLE "analytics_groups" (
  "id"        TEXT         PRIMARY KEY,
  "programId" TEXT         NOT NULL,
  "label"     TEXT         NOT NULL,
  "sortOrder" INTEGER      NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ  NOT NULL,
  CONSTRAINT "analytics_groups_program_fkey"
    FOREIGN KEY ("programId") REFERENCES "programs"("id")
);

CREATE UNIQUE INDEX "analytics_groups_programId_label_key"
  ON "analytics_groups" ("programId", "label");

CREATE INDEX "analytics_groups_programId_idx"
  ON "analytics_groups" ("programId");


-- ─── 2. analyticsGroupId FK on context_definitions ───────────────────────────
ALTER TABLE "context_definitions"
  ADD COLUMN "analyticsGroupId" TEXT;

-- FK + supporting index.
ALTER TABLE "context_definitions"
  ADD CONSTRAINT "context_definitions_analyticsGroup_fkey"
    FOREIGN KEY ("analyticsGroupId") REFERENCES "analytics_groups"("id");

CREATE INDEX "context_definitions_analyticsGroupId_idx"
  ON "context_definitions" ("analyticsGroupId");


-- ─── 3. Promote existing labels to group rows ────────────────────────────────
-- Use gen_random_uuid() for the primary key; cuids aren't SQL-native and
-- migration-created rows don't need to match the cuid() default on new rows.
-- They just need a unique TEXT id.
INSERT INTO "analytics_groups" ("id", "programId", "label", "sortOrder", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  t."programId",
  t."analyticsGroupLabel",
  0,
  now(),
  now()
FROM (
  SELECT DISTINCT "programId", "analyticsGroupLabel"
  FROM "context_definitions"
  WHERE "analyticsGroupLabel" IS NOT NULL
    AND btrim("analyticsGroupLabel") <> ''
) t;


-- ─── 4. Link existing contexts to their freshly-created groups ───────────────
UPDATE "context_definitions" AS cd
SET    "analyticsGroupId" = ag."id"
FROM   "analytics_groups" AS ag
WHERE  cd."programId" = ag."programId"
  AND  cd."analyticsGroupLabel" = ag."label"
  AND  cd."analyticsGroupLabel" IS NOT NULL;


-- ─── 5. Drop the obsolete free-text columns ──────────────────────────────────
ALTER TABLE "context_definitions"
  DROP COLUMN "analyticsGroupKey",
  DROP COLUMN "analyticsGroupLabel";
