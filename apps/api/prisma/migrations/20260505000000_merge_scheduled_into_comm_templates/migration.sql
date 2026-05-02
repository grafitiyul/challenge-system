-- Merge: collapse the duplicate scheduled-message templates into the
-- existing communication_templates ("נוסחים להודעות") system.
--
-- Pre-conditions verified before running this migration:
--   * program_scheduled_message_templates: 0 rows
--   * group_scheduled_messages:            0 rows
-- so the FK retarget + table drop are safe with no data backfill.
--
-- After this migration:
--   * communication_templates carries optional scheduling metadata
--     (timingType + per-mode fields + category + sortOrder).
--     Email-channel rows leave timingType NULL — inert.
--   * group_scheduled_messages.sourceTemplateId references
--     communication_templates(id) instead of the dropped table.
--   * group_scheduled_messages gains contentSyncedAt + scheduledAtSyncedAt
--     so the future apply-to-groups flow can detect manual edits and
--     warn before overwriting them.
--   * program_scheduled_message_templates is dropped.

-- ── 1. Add scheduling columns to communication_templates ───────────────────
ALTER TABLE "communication_templates"
  ADD COLUMN "category"    TEXT,
  ADD COLUMN "timingType"  TEXT,
  ADD COLUMN "exactAt"     TIMESTAMPTZ,
  ADD COLUMN "dayOfNumber" INTEGER,
  ADD COLUMN "offsetDays"  INTEGER,
  ADD COLUMN "timeOfDay"   TEXT,
  ADD COLUMN "sortOrder"   INTEGER NOT NULL DEFAULT 0;

-- ── 2. Add sync-tracking columns to group_scheduled_messages ───────────────
ALTER TABLE "group_scheduled_messages"
  ADD COLUMN "contentSyncedAt"     TIMESTAMPTZ,
  ADD COLUMN "scheduledAtSyncedAt" TIMESTAMPTZ;

-- ── 3. Retarget the FK from the dropped table to communication_templates ──
ALTER TABLE "group_scheduled_messages"
  DROP CONSTRAINT "group_scheduled_messages_sourceTemplateId_fkey";

ALTER TABLE "group_scheduled_messages"
  ADD CONSTRAINT "group_scheduled_messages_sourceTemplateId_fkey"
  FOREIGN KEY ("sourceTemplateId") REFERENCES "communication_templates"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 4. Drop the duplicate table ────────────────────────────────────────────
DROP TABLE "program_scheduled_message_templates";
