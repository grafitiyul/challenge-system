-- Add city and profileImageUrl to participants
ALTER TABLE "participants" ADD COLUMN IF NOT EXISTS "city" TEXT;
ALTER TABLE "participants" ADD COLUMN IF NOT EXISTS "profileImageUrl" TEXT;

-- Add isSystemField to questionnaire_questions
ALTER TABLE "questionnaire_questions" ADD COLUMN IF NOT EXISTS "isSystemField" BOOLEAN NOT NULL DEFAULT false;
