-- Phase 6.16 — Task recurrence (participant-defined repeating tasks)
-- Additive. Null values preserve existing non-recurring behavior.
ALTER TABLE "plan_tasks"
  ADD COLUMN "recurrenceWeekdays" TEXT,
  ADD COLUMN "recurrenceStartTime" TEXT,
  ADD COLUMN "recurrenceEndTime" TEXT;
