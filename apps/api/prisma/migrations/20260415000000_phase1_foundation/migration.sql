-- =============================================================================
-- Phase 1 Foundation — Challenge System v2
-- =============================================================================
-- This migration is ALL-OR-NOTHING. It runs inside a single implicit transaction
-- (Prisma migrate deploy wraps it). If ANY statement fails, the whole migration
-- is rolled back — no partial state is ever persisted.
--
-- Required preconditions:
--   - Every existing score_events row with source_type='action' has
--     metadata->>'logId' populated and pointing to a real user_action_logs.id.
--     If this is not the case, the backfill will fail and the migration aborts.
--     (Spec decision Q4: extract + abort on failure, no silent sentinels.)
-- =============================================================================


-- ─── 1. GameAction: context schema + version ───────────────────────────────────
ALTER TABLE "game_actions"
  ADD COLUMN "contextSchemaJson"    JSONB,
  ADD COLUMN "contextSchemaVersion" INTEGER NOT NULL DEFAULT 1;


-- ─── 2. UserActionLog: new columns ─────────────────────────────────────────────
ALTER TABLE "user_action_logs"
  ADD COLUMN "effectiveValue"     NUMERIC(20, 6),
  ADD COLUMN "contextJson"        JSONB,
  ADD COLUMN "status"             TEXT        NOT NULL DEFAULT 'active',
  ADD COLUMN "supersedesId"       TEXT,
  ADD COLUMN "clientSubmissionId" TEXT,
  ADD COLUMN "editedAt"           TIMESTAMPTZ,
  ADD COLUMN "editedByRole"       TEXT,
  ADD COLUMN "schemaVersion"      INTEGER,
  ADD COLUMN "chainRootId"        TEXT;

-- Convert createdAt to timestamptz (was plain timestamp).
-- Postgres reinterprets the existing value as if it were UTC; safe because the
-- app has always written UTC timestamps via `new Date()`.
ALTER TABLE "user_action_logs"
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ USING "createdAt" AT TIME ZONE 'UTC';

-- Backfill chainRootId for every historical row: each row is its own root.
UPDATE "user_action_logs" SET "chainRootId" = "id" WHERE "chainRootId" IS NULL;

-- Now enforce NOT NULL on chainRootId.
ALTER TABLE "user_action_logs" ALTER COLUMN "chainRootId" SET NOT NULL;

-- Unique constraints on optional idempotency/supersession columns.
-- Partial unique indexes (only enforce when value is non-null), consistent with Prisma's @unique
-- on nullable columns which Postgres treats as "multiple NULLs allowed" by default.
CREATE UNIQUE INDEX "user_action_logs_supersedesId_key"
  ON "user_action_logs" ("supersedesId")
  WHERE "supersedesId" IS NOT NULL;

CREATE UNIQUE INDEX "user_action_logs_clientSubmissionId_key"
  ON "user_action_logs" ("clientSubmissionId")
  WHERE "clientSubmissionId" IS NOT NULL;

-- Supporting indexes (Prisma @@index equivalents).
CREATE INDEX "user_action_logs_chainRootId_idx"
  ON "user_action_logs" ("chainRootId");

CREATE INDEX "user_action_logs_participantId_programId_createdAt_idx"
  ON "user_action_logs" ("participantId", "programId", "createdAt");


-- ─── 3. ScoreEvent: new columns ────────────────────────────────────────────────
ALTER TABLE "score_events"
  ADD COLUMN "logId"         TEXT,
  ADD COLUMN "parentEventId" TEXT,
  ADD COLUMN "bucketKey"     TEXT;

-- Convert createdAt to timestamptz.
ALTER TABLE "score_events"
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ USING "createdAt" AT TIME ZONE 'UTC';

-- Backfill logId from metadata.logId for every action event.
-- This runs BEFORE the CHECK constraint is installed, so bad rows will later cause
-- the CHECK to reject and the whole migration to abort. That is the intended behavior.
UPDATE "score_events"
SET    "logId" = "metadata"->>'logId'
WHERE  "sourceType" = 'action'
  AND  "logId" IS NULL
  AND  "metadata" ? 'logId';

-- Assert backfill completeness: if any action-type row still has logId NULL, abort.
-- This is the production safety net for Q4 (extract + abort on failure).
DO $$
DECLARE
  orphan_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO orphan_count
  FROM "score_events"
  WHERE "sourceType" = 'action' AND "logId" IS NULL;

  IF orphan_count > 0 THEN
    RAISE EXCEPTION
      'Phase 1 migration aborted: % action-type score_events rows have no logId after backfill. Manual cleanup required before retrying.',
      orphan_count;
  END IF;
END $$;

-- Supporting indexes.
CREATE INDEX "score_events_participantId_programId_createdAt_idx"
  ON "score_events" ("participantId", "programId", "createdAt");

CREATE INDEX "score_events_logId_idx"
  ON "score_events" ("logId");

CREATE INDEX "score_events_parentEventId_idx"
  ON "score_events" ("parentEventId");

-- Partial unique index: rule duplication guard.
-- Enforces "one rule firing per (participant, rule, bucket)" at DB level, closing the
-- read-modify-write race in evaluateRules.
CREATE UNIQUE INDEX "score_events_rule_bucket_key"
  ON "score_events" ("participantId", "sourceId", "bucketKey")
  WHERE "sourceType" = 'rule' AND "bucketKey" IS NOT NULL;

-- CHECK: action-type ScoreEvents MUST link to a UserActionLog.
-- Installed AFTER backfill + orphan assertion, so it can never fire on historical rows.
ALTER TABLE "score_events"
  ADD CONSTRAINT "score_events_action_requires_log"
  CHECK (("sourceType" = 'action' AND "logId" IS NOT NULL) OR "sourceType" <> 'action');


-- ─── 4. FeedEvent: dedicated FK columns ────────────────────────────────────────
ALTER TABLE "feed_events"
  ADD COLUMN "logId"        TEXT,
  ADD COLUMN "scoreEventId" TEXT;

-- Convert createdAt to timestamptz.
ALTER TABLE "feed_events"
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ USING "createdAt" AT TIME ZONE 'UTC';

-- Backfill dedicated columns from legacy metadata JSON.
UPDATE "feed_events"
SET    "logId"        = "metadata"->>'logId',
       "scoreEventId" = "metadata"->>'scoreEventId'
WHERE  "metadata" IS NOT NULL
  AND  ("metadata" ? 'logId' OR "metadata" ? 'scoreEventId');

CREATE UNIQUE INDEX "feed_events_scoreEventId_key"
  ON "feed_events" ("scoreEventId")
  WHERE "scoreEventId" IS NOT NULL;

CREATE INDEX "feed_events_logId_idx"
  ON "feed_events" ("logId");


-- ─── 5. NEW: ScoreEventDependency ──────────────────────────────────────────────
CREATE TABLE "score_event_dependencies" (
  "id"               TEXT         PRIMARY KEY,
  "eventId"          TEXT         NOT NULL,
  "dependsOnEventId" TEXT         NOT NULL,
  "createdAt"        TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT "score_event_dependencies_event_fkey"
    FOREIGN KEY ("eventId")          REFERENCES "score_events"("id") ON DELETE CASCADE,
  CONSTRAINT "score_event_dependencies_dependsOn_fkey"
    FOREIGN KEY ("dependsOnEventId") REFERENCES "score_events"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "score_event_dependencies_event_dependsOn_key"
  ON "score_event_dependencies" ("eventId", "dependsOnEventId");

CREATE INDEX "score_event_dependencies_eventId_idx"
  ON "score_event_dependencies" ("eventId");

CREATE INDEX "score_event_dependencies_dependsOnEventId_idx"
  ON "score_event_dependencies" ("dependsOnEventId");
