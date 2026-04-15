-- Additive: per-action participant-facing question.
-- Null preserves existing behavior (portal derives default from aggregation mode).
ALTER TABLE "game_actions" ADD COLUMN "participantPrompt" TEXT;
