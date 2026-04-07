-- AlterTable: add aggregationMode and unit to game_actions
-- aggregationMode: "none" (default) | "latest_value" | "incremental_sum"
-- Existing rows get "none" which preserves all previous behavior.

ALTER TABLE "game_actions"
  ADD COLUMN "aggregationMode" TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN "unit" TEXT;
