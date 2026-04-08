-- Add participant visibility control and configurable block message to game actions
ALTER TABLE "game_actions"
  ADD COLUMN "showInPortal"   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "blockedMessage" TEXT;
