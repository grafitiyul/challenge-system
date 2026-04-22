-- Phase 1 — Projects Tracking
-- Adds binary manage-projects permission to participants, plus the core
-- Phase 1 entities: Project, ProjectItem, ProjectItemLog, ProjectNote.
-- Manual-metric only (boolean/number/select). No task linkage yet.

-- Participant permission flag
ALTER TABLE "participants"
  ADD COLUMN "canManageProjects" BOOLEAN NOT NULL DEFAULT false;

-- Projects
CREATE TABLE "projects" (
  "id"            TEXT    NOT NULL PRIMARY KEY,
  "participantId" TEXT    NOT NULL,
  "title"         TEXT    NOT NULL,
  "description"   TEXT,
  "colorHex"      TEXT,
  "status"        TEXT    NOT NULL DEFAULT 'active',
  "createdByRole" TEXT    NOT NULL DEFAULT 'admin',
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "projects_participantId_fkey"
    FOREIGN KEY ("participantId") REFERENCES "participants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "projects_participantId_idx" ON "projects"("participantId");

-- Project items
CREATE TABLE "project_items" (
  "id"               TEXT    NOT NULL PRIMARY KEY,
  "projectId"        TEXT    NOT NULL,
  "title"            TEXT    NOT NULL,
  "itemType"         TEXT    NOT NULL,
  "unit"             TEXT,
  "targetValue"      DOUBLE PRECISION,
  "selectOptionsJson" JSONB,
  "sortOrder"        INTEGER NOT NULL DEFAULT 0,
  "isArchived"       BOOLEAN NOT NULL DEFAULT false,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "project_items_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "project_items_projectId_idx" ON "project_items"("projectId");

-- Project item logs (one row per (item, day))
CREATE TABLE "project_item_logs" (
  "id"            TEXT    NOT NULL PRIMARY KEY,
  "itemId"        TEXT    NOT NULL,
  "participantId" TEXT    NOT NULL,
  "logDate"       DATE    NOT NULL,
  "status"        TEXT    NOT NULL,
  "numericValue"  DOUBLE PRECISION,
  "selectValue"   TEXT,
  "skipNote"      TEXT,
  "commitNote"    TEXT,
  "editedAt"      TIMESTAMP(3),
  "editedByRole"  TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_item_logs_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "project_items"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "project_item_logs_participantId_fkey"
    FOREIGN KEY ("participantId") REFERENCES "participants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "project_item_logs_itemId_logDate_key"
  ON "project_item_logs"("itemId", "logDate");
CREATE INDEX "project_item_logs_participantId_logDate_idx"
  ON "project_item_logs"("participantId", "logDate");
CREATE INDEX "project_item_logs_itemId_idx"
  ON "project_item_logs"("itemId");

-- Project notes (chronological thread per project)
CREATE TABLE "project_notes" (
  "id"            TEXT    NOT NULL PRIMARY KEY,
  "projectId"     TEXT    NOT NULL,
  "participantId" TEXT    NOT NULL,
  "content"       TEXT    NOT NULL,
  "authorRole"    TEXT    NOT NULL DEFAULT 'participant',
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_notes_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "project_notes_participantId_fkey"
    FOREIGN KEY ("participantId") REFERENCES "participants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "project_notes_projectId_idx" ON "project_notes"("projectId");
