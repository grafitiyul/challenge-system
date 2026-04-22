-- Phase 2 — Bidirectional link between a boolean Project goal and a PlanTask.
-- Additive. Both new columns default cleanly; no backfill needed.

-- 1:1 link column on ProjectItem. Unique so a given task is linked to at most
-- one goal. Nullable — most items are not linked.
ALTER TABLE "project_items"
  ADD COLUMN "linkedPlanTaskId" TEXT;

ALTER TABLE "project_items"
  ADD CONSTRAINT "project_items_linkedPlanTaskId_fkey"
    FOREIGN KEY ("linkedPlanTaskId") REFERENCES "plan_tasks"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "project_items_linkedPlanTaskId_key"
  ON "project_items"("linkedPlanTaskId");

-- Audit/presentation field on ProjectItemLog — never a correctness branch.
-- Defaults "direct" so every existing row is tagged as user-authored.
ALTER TABLE "project_item_logs"
  ADD COLUMN "syncSource" TEXT NOT NULL DEFAULT 'direct';
