-- Link questionnaire templates to programs (optional FK)
-- Allows the group screen to show only questionnaires relevant to the group's program
ALTER TABLE "questionnaire_templates"
  ADD COLUMN "programId" TEXT,
  ADD CONSTRAINT "questionnaire_templates_programId_fkey"
    FOREIGN KEY ("programId") REFERENCES "programs"("id") ON DELETE SET NULL;
