-- Phase 4 cleanup: unify message templates.
-- ProgramMessageTemplate (whatsapp-only, plain content) is collapsed into
-- CommunicationTemplate (channel-aware). Existing rows — created through
-- the old "נוסחים" tab — are migrated to channel='whatsapp' so the admin
-- sees them under the new unified "נוסחים להודעות" tab without data loss.
--
-- We reuse the source ids so any future reports keyed by the old template
-- id still resolve. No consumer currently depends on the id stability but
-- it costs nothing to preserve.

INSERT INTO "communication_templates"
  ("id", "programId", "channel", "title", "subject", "body", "isActive", "createdAt", "updatedAt")
SELECT
  "id", "programId", 'whatsapp', "name", NULL, "content", true, "createdAt", "updatedAt"
FROM "program_message_templates"
ON CONFLICT ("id") DO NOTHING;

DROP TABLE "program_message_templates" CASCADE;
