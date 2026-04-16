-- Phase 4.4 — Required action-level text input
-- Additive. False default preserves existing behavior on every row.
ALTER TABLE "game_actions"
  ADD COLUMN "participantTextRequired" BOOLEAN NOT NULL DEFAULT false;
