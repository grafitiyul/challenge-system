-- Catch-up mode — admin-configurable per-program backdated reporting.
--
-- Adds 8 program-level config columns, an `occurredAt` audit column on
-- the three event tables (UserActionLog / ScoreEvent / FeedEvent), and
-- a new catch_up_sessions table that gates "one activation per
-- participant per program per available date" at the database layer.
--
-- occurredAt semantics: always wall-clock submission time. For
-- non-catch-up rows it's effectively equal to createdAt; for backdated
-- catch-up rows createdAt is the credited day (12:00 Asia/Jerusalem)
-- while occurredAt remains the moment the participant tapped submit.
-- Backfill below sets occurredAt = createdAt on existing rows so the
-- non-null constraint can be added without losing the truthful audit
-- value for legacy data.

-- ── Program config ──────────────────────────────────────────────────────────
ALTER TABLE "programs"
  ADD COLUMN "catchUpEnabled"          BOOLEAN  NOT NULL DEFAULT false,
  ADD COLUMN "catchUpButtonLabel"      TEXT     NOT NULL DEFAULT 'דיווח השלמה',
  ADD COLUMN "catchUpConfirmTitle"     TEXT,
  ADD COLUMN "catchUpConfirmBody"      TEXT,
  ADD COLUMN "catchUpDurationMinutes"  INTEGER  NOT NULL DEFAULT 10,
  ADD COLUMN "catchUpAllowedDaysBack"  INTEGER  NOT NULL DEFAULT 2,
  ADD COLUMN "catchUpBannerText"       TEXT,
  ADD COLUMN "catchUpAvailableDates"   TEXT[]   NOT NULL DEFAULT ARRAY[]::TEXT[];

-- ── occurredAt audit column on the three event tables ──────────────────────
-- Two-step: nullable add + backfill from createdAt + lock down with NOT NULL
-- and DEFAULT now(). Existing rows get the truthful "occurred when created"
-- value rather than the migration-run timestamp.

ALTER TABLE "user_action_logs"
  ADD COLUMN "occurredAt" TIMESTAMPTZ;
UPDATE "user_action_logs" SET "occurredAt" = "createdAt";
ALTER TABLE "user_action_logs"
  ALTER COLUMN "occurredAt" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "occurredAt" SET NOT NULL;

ALTER TABLE "score_events"
  ADD COLUMN "occurredAt" TIMESTAMPTZ;
UPDATE "score_events" SET "occurredAt" = "createdAt";
ALTER TABLE "score_events"
  ALTER COLUMN "occurredAt" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "occurredAt" SET NOT NULL;

ALTER TABLE "feed_events"
  ADD COLUMN "occurredAt" TIMESTAMPTZ;
UPDATE "feed_events" SET "occurredAt" = "createdAt";
ALTER TABLE "feed_events"
  ALTER COLUMN "occurredAt" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "occurredAt" SET NOT NULL;

-- ── catch_up_sessions ──────────────────────────────────────────────────────
CREATE TABLE "catch_up_sessions" (
  "id"               TEXT         NOT NULL,
  "participantId"    TEXT         NOT NULL,
  "programId"        TEXT         NOT NULL,
  "availabilityDate" TEXT         NOT NULL,
  "startedAt"        TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"        TIMESTAMPTZ  NOT NULL,
  "durationMinutes"  INTEGER      NOT NULL,
  "allowedDaysBack"  INTEGER      NOT NULL,
  "bannerText"       TEXT,
  "endedAt"          TIMESTAMPTZ,
  "createdAt"        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "catch_up_sessions_pkey" PRIMARY KEY ("id")
);

-- One activation per participant per program per available date.
-- This is the database-layer guarantee for the "can't activate twice
-- on the same availability date" rule. Application code looks up
-- conflicts via this same key.
CREATE UNIQUE INDEX "catch_up_sessions_participantId_programId_availabilityDate_key"
  ON "catch_up_sessions"("participantId", "programId", "availabilityDate");

CREATE INDEX "catch_up_sessions_programId_idx"
  ON "catch_up_sessions"("programId");

ALTER TABLE "catch_up_sessions"
  ADD CONSTRAINT "catch_up_sessions_participantId_fkey"
  FOREIGN KEY ("participantId") REFERENCES "participants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "catch_up_sessions"
  ADD CONSTRAINT "catch_up_sessions_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "programs"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
