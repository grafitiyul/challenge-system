-- Add rulesPublished field to programs table
ALTER TABLE "programs" ADD COLUMN IF NOT EXISTS "rulesPublished" BOOLEAN NOT NULL DEFAULT false;
