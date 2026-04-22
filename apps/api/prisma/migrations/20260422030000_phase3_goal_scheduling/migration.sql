-- Phase 3 — Scheduling intent on boolean Project goals.
-- Additive. Defaults keep existing goals identical to pre-Phase-3 behavior.
-- The columns drive a computed per-week status chip only; they never affect
-- completion counts (those still come from TaskAssignment rows exclusively).

ALTER TABLE "project_items"
  ADD COLUMN "scheduleFrequencyType" TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN "scheduleTimesPerWeek" INTEGER,
  ADD COLUMN "schedulePreferredWeekdays" TEXT;
