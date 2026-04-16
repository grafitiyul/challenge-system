-- Phase 6.7 — Explicit base scoring strategy layer
--
-- Replaces the previous "magic activation" model (infer unit-delta scoring
-- when optional fields happen to be present) with an explicit enum-like
-- discriminator. Existing rows are backfilled by mapping their current
-- (inputType, aggregationMode, unitSize, basePointsPerUnit) tuple to the
-- equivalent new strategy so behavior is preserved byte-for-byte.
--
-- Mapping:
--   number + latest_value + unitSize set + basePointsPerUnit set → latest_value_units_delta
--   number + latest_value                                         → latest_value_flat
--   number + incremental_sum                                      → quantity_multiplier
--   everything else                                               → flat
ALTER TABLE "game_actions"
  ADD COLUMN "baseScoringType" TEXT NOT NULL DEFAULT 'flat';

UPDATE "game_actions"
SET "baseScoringType" = CASE
    WHEN "inputType" = 'number'
         AND "aggregationMode" = 'latest_value'
         AND "unitSize" IS NOT NULL
         AND "basePointsPerUnit" IS NOT NULL
      THEN 'latest_value_units_delta'
    WHEN "inputType" = 'number' AND "aggregationMode" = 'latest_value'
      THEN 'latest_value_flat'
    WHEN "inputType" = 'number' AND "aggregationMode" = 'incremental_sum'
      THEN 'quantity_multiplier'
    ELSE 'flat'
  END;
