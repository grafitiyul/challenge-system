-- AlterTable: add rulesContent to programs
ALTER TABLE "programs" ADD COLUMN IF NOT EXISTS "rulesContent" TEXT;

-- AlterTable: add explanationContent to game_actions
ALTER TABLE "game_actions" ADD COLUMN IF NOT EXISTS "explanationContent" TEXT;
