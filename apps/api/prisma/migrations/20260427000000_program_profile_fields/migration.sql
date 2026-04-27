-- Phase 7 — participant-portal "פרטים אישיים" tab.
--
-- Three new tables back the configurable per-Program profile system:
--
--   program_profile_fields
--     Admin-managed config: which fields appear in a program's profile
--     tab, in what order, required or not. fieldKey acts as the routing
--     key. When isSystemField=true, the same key matches a column on
--     the participants table (firstName, lastName, email, phoneNumber,
--     birthDate, city, profileImageUrl) and writes go directly there;
--     otherwise the value lives in participant_profile_values.
--
--   participant_profile_values
--     One row per (participant, program, fieldKey) for non-system
--     fields. value is JSONB so it can store text, numbers, file ids,
--     or arrays of file ids depending on field type. Server validates
--     shape against the field type before write.
--
--   participant_uploaded_files
--     Catalog row for every uploaded file owned by a participant.
--     Captures size + mimeType so admin can audit. Image / imageGallery
--     profile values reference these by id.

-- ─── program_profile_fields ─────────────────────────────────────────────────
CREATE TABLE "program_profile_fields" (
  "id"            TEXT         NOT NULL PRIMARY KEY,
  "programId"     TEXT         NOT NULL,
  "fieldKey"      TEXT         NOT NULL,
  "label"         TEXT         NOT NULL,
  "helperText"    TEXT,
  "fieldType"     TEXT         NOT NULL,
  "isRequired"    BOOLEAN      NOT NULL DEFAULT false,
  "sortOrder"     INTEGER      NOT NULL DEFAULT 0,
  "isSystemField" BOOLEAN      NOT NULL DEFAULT false,
  "isActive"      BOOLEAN      NOT NULL DEFAULT true,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "program_profile_fields_programId_fkey"
    FOREIGN KEY ("programId") REFERENCES "programs"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "program_profile_fields_programId_fieldKey_key"
  ON "program_profile_fields"("programId", "fieldKey");
CREATE INDEX "program_profile_fields_programId_isActive_idx"
  ON "program_profile_fields"("programId", "isActive");

-- ─── participant_profile_values ─────────────────────────────────────────────
CREATE TABLE "participant_profile_values" (
  "id"            TEXT         NOT NULL PRIMARY KEY,
  "participantId" TEXT         NOT NULL,
  "programId"     TEXT         NOT NULL,
  "fieldKey"      TEXT         NOT NULL,
  "value"         JSONB,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "participant_profile_values_participantId_fkey"
    FOREIGN KEY ("participantId") REFERENCES "participants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "participant_profile_values_programId_fkey"
    FOREIGN KEY ("programId") REFERENCES "programs"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "participant_profile_values_participantId_programId_fieldKey_key"
  ON "participant_profile_values"("participantId", "programId", "fieldKey");
CREATE INDEX "participant_profile_values_participantId_idx"
  ON "participant_profile_values"("participantId");
CREATE INDEX "participant_profile_values_programId_fieldKey_idx"
  ON "participant_profile_values"("programId", "fieldKey");

-- ─── participant_uploaded_files ─────────────────────────────────────────────
CREATE TABLE "participant_uploaded_files" (
  "id"            TEXT         NOT NULL PRIMARY KEY,
  "participantId" TEXT         NOT NULL,
  "category"      TEXT         NOT NULL,
  "url"           TEXT         NOT NULL,
  "mimeType"      TEXT         NOT NULL,
  "sizeBytes"     INTEGER      NOT NULL,
  "uploadedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "participant_uploaded_files_participantId_fkey"
    FOREIGN KEY ("participantId") REFERENCES "participants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "participant_uploaded_files_participantId_category_idx"
  ON "participant_uploaded_files"("participantId", "category");
