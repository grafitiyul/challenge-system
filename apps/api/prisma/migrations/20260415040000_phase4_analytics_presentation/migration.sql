-- Phase 4 — Context analytics presentation layer
-- Additive only. Three nullable columns on context_definitions.
-- Nothing in existing behavior changes when these columns stay NULL.
ALTER TABLE "context_definitions"
  ADD COLUMN "analyticsGroupKey"     TEXT,
  ADD COLUMN "analyticsGroupLabel"   TEXT,
  ADD COLUMN "analyticsDisplayLabel" TEXT;
