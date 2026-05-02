-- Two-layer streak/score system.
--
-- Adds:
--   participant_groups.streakMode + override fields + audit
--   programs.continuationDays
--   participants.timezone
--   user_action_logs.timezoneSnapshot
--
-- All columns are additive with safe defaults so existing data
-- continues to behave exactly as before:
--   * streakMode defaults 'fresh' for every existing row → game
--     streak starts at 0, no override applied, portal still hides
--     personal streak/history (matches current "no carry-over"
--     behavior).
--   * continuationDays defaults 7 for every existing program →
--     opens a 7-day post-end logging window per spec sign-off.
--   * timezone defaults 'Asia/Jerusalem' for every existing
--     participant → personal streak math identical to current
--     UTC behavior since current code also uses Asia/Jerusalem
--     defaults elsewhere; participants who travel can update
--     individually.
--   * user_action_logs.timezoneSnapshot is nullable → legacy rows
--     read with Asia/Jerusalem fallback at calculation time. New
--     writes populate from participant.timezone at write time.
--
-- No data migration required. No backfill of historical buckets.

-- ── ParticipantGroup ────────────────────────────────────────────────────
ALTER TABLE "participant_groups"
  ADD COLUMN "streakMode"          TEXT         NOT NULL DEFAULT 'fresh',
  ADD COLUMN "streakStartOverride" INTEGER,
  ADD COLUMN "overrideReason"      TEXT,
  ADD COLUMN "overrideBy"          TEXT,
  ADD COLUMN "overrideAt"          TIMESTAMPTZ,
  ADD COLUMN "overrideTimezone"    TEXT,
  ADD COLUMN "streakModeUpdatedBy" TEXT,
  ADD COLUMN "streakModeUpdatedAt" TIMESTAMPTZ;

-- ── Program ─────────────────────────────────────────────────────────────
ALTER TABLE "programs"
  ADD COLUMN "continuationDays" INTEGER NOT NULL DEFAULT 7;

-- ── Participant ─────────────────────────────────────────────────────────
ALTER TABLE "participants"
  ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Asia/Jerusalem';

-- ── UserActionLog ──────────────────────────────────────────────────────
ALTER TABLE "user_action_logs"
  ADD COLUMN "timezoneSnapshot" TEXT;
