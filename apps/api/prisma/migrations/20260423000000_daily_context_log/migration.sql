-- Daily Context Layer — participant self-report panel on /tg/:token.
-- One row per participant per civil day (Asia/Jerusalem). Upserted on
-- every chip toggle; cravings/states are free-form string arrays driven
-- by a UI vocabulary rather than a normalized tag table.

CREATE TABLE "daily_context_logs" (
  "id"            TEXT         NOT NULL PRIMARY KEY,
  "participantId" TEXT         NOT NULL,
  "logDate"       DATE         NOT NULL,
  "hasPeriod"     BOOLEAN      NOT NULL DEFAULT false,
  "cravings"      TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
  "states"        TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
  "note"          TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "daily_context_logs_participantId_fkey"
    FOREIGN KEY ("participantId") REFERENCES "participants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "daily_context_logs_participantId_logDate_key"
  ON "daily_context_logs"("participantId", "logDate");
CREATE INDEX "daily_context_logs_participantId_logDate_idx"
  ON "daily_context_logs"("participantId", "logDate");
