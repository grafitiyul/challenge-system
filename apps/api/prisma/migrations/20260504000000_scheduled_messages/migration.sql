-- Scheduled-messages system. Two new tables + one nullable boolean
-- on the existing groups table. All defaults are safe:
--   * scheduledMessagesEnabled defaults false → no group sends until
--     the admin explicitly opts in
--   * GroupScheduledMessage.enabled defaults false → cloned templates
--     never auto-send; admin must approve each one
--   * status defaults 'draft' → the cron worker filters status='pending'
--     so draft rows are inert
--
-- targetType is stored as a string (V1: always 'group_whatsapp_chat')
-- so V2 per-participant fan-out doesn't require a migration.

-- ── Group master toggle ─────────────────────────────────────────────────────
ALTER TABLE "groups"
  ADD COLUMN "scheduledMessagesEnabled" BOOLEAN NOT NULL DEFAULT false;

-- ── Program-level templates ─────────────────────────────────────────────────
CREATE TABLE "program_scheduled_message_templates" (
  "id"           TEXT         NOT NULL,
  "programId"    TEXT         NOT NULL,
  "category"     TEXT         NOT NULL,
  "internalName" TEXT         NOT NULL,
  "content"      TEXT         NOT NULL,
  "timingType"   TEXT         NOT NULL,
  "exactAt"      TIMESTAMPTZ,
  "dayOfNumber"  INTEGER,
  "offsetDays"   INTEGER,
  "timeOfDay"    TEXT,
  "isActive"     BOOLEAN      NOT NULL DEFAULT true,
  "sortOrder"    INTEGER      NOT NULL DEFAULT 0,
  "createdAt"    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP    NOT NULL,

  CONSTRAINT "program_scheduled_message_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "program_scheduled_message_templates_programId_isActive_idx"
  ON "program_scheduled_message_templates"("programId", "isActive");

ALTER TABLE "program_scheduled_message_templates"
  ADD CONSTRAINT "program_scheduled_message_templates_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "programs"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Group-level schedule rows ───────────────────────────────────────────────
CREATE TABLE "group_scheduled_messages" (
  "id"               TEXT         NOT NULL,
  "groupId"          TEXT         NOT NULL,
  "sourceTemplateId" TEXT,
  "category"         TEXT         NOT NULL,
  "internalName"     TEXT         NOT NULL,
  "content"          TEXT         NOT NULL,
  "scheduledAt"      TIMESTAMPTZ  NOT NULL,
  "targetType"       TEXT         NOT NULL DEFAULT 'group_whatsapp_chat',
  "enabled"          BOOLEAN      NOT NULL DEFAULT false,
  "status"           TEXT         NOT NULL DEFAULT 'draft',
  "attemptCount"     INTEGER      NOT NULL DEFAULT 0,
  "lastAttemptAt"    TIMESTAMPTZ,
  "nextRetryAt"      TIMESTAMPTZ,
  "claimedAt"        TIMESTAMPTZ,
  "claimedBy"        TEXT,
  "sentAt"           TIMESTAMPTZ,
  "failureReason"    TEXT,
  "createdAt"        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP    NOT NULL,

  CONSTRAINT "group_scheduled_messages_pkey" PRIMARY KEY ("id")
);

-- Same template + same group + same resolved time = one row. Catches
-- inheritance double-click and concurrent "apply changes" runs.
CREATE UNIQUE INDEX "group_scheduled_messages_groupId_sourceTemplateId_scheduledAt_key"
  ON "group_scheduled_messages"("groupId", "sourceTemplateId", "scheduledAt");

-- Cron's primary access path: find pending rows ready for send.
CREATE INDEX "group_scheduled_messages_status_scheduledAt_idx"
  ON "group_scheduled_messages"("status", "scheduledAt");

-- Group-tab list view's primary access path.
CREATE INDEX "group_scheduled_messages_groupId_status_idx"
  ON "group_scheduled_messages"("groupId", "status");

ALTER TABLE "group_scheduled_messages"
  ADD CONSTRAINT "group_scheduled_messages_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "groups"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Template removal must not orphan group rows the admin approved.
-- ON DELETE SET NULL leaves the snapshot intact; the foreign-key
-- becomes null and the row continues to send / be tracked normally.
ALTER TABLE "group_scheduled_messages"
  ADD CONSTRAINT "group_scheduled_messages_sourceTemplateId_fkey"
  FOREIGN KEY ("sourceTemplateId") REFERENCES "program_scheduled_message_templates"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
