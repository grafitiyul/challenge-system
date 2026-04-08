-- Add ParticipantFormSubmission table for immutable form/import snapshots
CREATE TABLE "participant_form_submissions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "participantId" TEXT NOT NULL REFERENCES "participants"("id") ON DELETE RESTRICT,
  "source" TEXT NOT NULL DEFAULT 'import',
  "title" TEXT NOT NULL,
  "data" JSONB NOT NULL DEFAULT '{}',
  "importKey" TEXT UNIQUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "participant_form_submissions_participantId_idx"
  ON "participant_form_submissions"("participantId");
