-- Phase 6.6 — Bundled-unit base scoring (optional extension)
-- Additive. Nullable columns. Existing rows keep their flat-points behavior;
-- bundled-unit scoring activates per-action only when both columns are set.
ALTER TABLE "game_actions"
  ADD COLUMN "unitSize" INTEGER,
  ADD COLUMN "basePointsPerUnit" INTEGER;
