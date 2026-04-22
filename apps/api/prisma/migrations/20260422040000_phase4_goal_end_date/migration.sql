-- Phase 4 — Optional end date on project goals.
-- Additive. Null default keeps existing goals indefinite (no behavior change).

ALTER TABLE "project_items"
  ADD COLUMN "endDate" DATE;
