-- Phase 4.1 — Action-level free-text input (separate from context)
-- Additive only. NULL preserves existing behavior on every row.
ALTER TABLE "game_actions"      ADD COLUMN "participantTextPrompt" TEXT;
ALTER TABLE "user_action_logs"  ADD COLUMN "extraText"             TEXT;
