-- =============================================================================
-- Phase 3.3 — Context behavior model
-- =============================================================================
-- Additive migration. Three new columns on context_definitions; all with safe
-- defaults that preserve the pre-3.3 semantics:
--   - inputMode            defaults to 'participant' → old rows behave as
--                          participant-filled dimensions (unchanged behavior).
--   - analyticsVisible     defaults to true → old rows continue to appear in
--                          analytics toggles (unchanged behavior).
--   - fixedValue           null → no system injection for old rows.
-- =============================================================================

ALTER TABLE "context_definitions"
  ADD COLUMN "inputMode"        TEXT    NOT NULL DEFAULT 'participant',
  ADD COLUMN "analyticsVisible" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "fixedValue"       TEXT;
