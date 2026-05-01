-- Per-action and per-program weekday + extra-date availability schedule.
--
-- Three additive columns; defaults preserve every existing row's behavior:
--   * GameAction.allowedWeekdays    — JS weekday numbers (0=Sun..6=Sat),
--                                     Asia/Jerusalem. Empty = no restriction.
--   * GameAction.extraAllowedDates  — YYYY-MM-DD (Asia/Jerusalem) strings,
--                                     manual exceptions. Empty = no extras.
--   * Program.catchUpAllowedWeekdays — same idea for catch-up mode (מצב השלמה),
--                                      composes with the existing catchUpAvailableDates.
--
-- Backward-compat:
--   GameAction with both arrays empty → available every day (matches today).
--   Program with empty allowedWeekdays AND empty catchUpAvailableDates →
--     catch-up button never appears (matches the existing pre-weekday default).
--
-- No backfill, no recompute, no historical row touch. Pure schema add.

ALTER TABLE "game_actions"
  ADD COLUMN "allowedWeekdays"   INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN "extraAllowedDates" TEXT[]    NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "programs"
  ADD COLUMN "catchUpAllowedWeekdays" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
