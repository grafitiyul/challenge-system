-- Phase 4: collapse the standalone Product entity onto Program.
-- Program IS the product. Program.type is the discriminator, Program.id
-- is productRefId, Program.name is productTitle.
--
-- No production data in Product/ProductWaitlistEntry/CommunicationTemplate
-- (no seeder populated them), so these tables are dropped and recreated
-- with the new shape rather than migrated row-by-row.

-- ─── Drop columns that point at the soon-to-be-deleted products table ───────
ALTER TABLE "payment_offers"
  DROP CONSTRAINT IF EXISTS "payment_offers_productId_fkey",
  DROP COLUMN IF EXISTS "productId";
DROP INDEX IF EXISTS "payment_offers_productId_idx";

ALTER TABLE "questionnaire_templates"
  DROP CONSTRAINT IF EXISTS "questionnaire_templates_productId_fkey",
  DROP COLUMN IF EXISTS "productId";
DROP INDEX IF EXISTS "questionnaire_templates_productId_idx";

-- ─── Drop product-scoped tables ─────────────────────────────────────────────
DROP TABLE IF EXISTS "product_waitlist_entries" CASCADE;
DROP TABLE IF EXISTS "communication_templates"  CASCADE;
DROP TABLE IF EXISTS "products"                 CASCADE;

-- ─── Program-scoped waitlist ────────────────────────────────────────────────
CREATE TABLE "program_waitlist_entries" (
  "id"            TEXT         NOT NULL PRIMARY KEY,
  "programId"     TEXT         NOT NULL,
  "participantId" TEXT         NOT NULL,
  "source"        TEXT,
  "notes"         TEXT,
  "isActive"      BOOLEAN      NOT NULL DEFAULT true,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "program_waitlist_entries_programId_fkey"
    FOREIGN KEY ("programId") REFERENCES "programs"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "program_waitlist_entries_participantId_fkey"
    FOREIGN KEY ("participantId") REFERENCES "participants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "program_waitlist_entries_programId_participantId_key"
  ON "program_waitlist_entries"("programId", "participantId");
CREATE INDEX "program_waitlist_entries_programId_isActive_idx"
  ON "program_waitlist_entries"("programId", "isActive");

-- ─── Program-scoped communication templates ────────────────────────────────
CREATE TABLE "communication_templates" (
  "id"        TEXT         NOT NULL PRIMARY KEY,
  "programId" TEXT         NOT NULL,
  "channel"   TEXT         NOT NULL,   -- 'email' | 'whatsapp'
  "title"     TEXT         NOT NULL,
  "subject"   TEXT,
  "body"      TEXT         NOT NULL,
  "isActive"  BOOLEAN      NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "communication_templates_programId_fkey"
    FOREIGN KEY ("programId") REFERENCES "programs"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "communication_templates_programId_channel_isActive_idx"
  ON "communication_templates"("programId", "channel", "isActive");
