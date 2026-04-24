-- Public registration Phase 3 — Product-centric architecture.
-- Product is the new parent entity for offers, waitlist, and communication
-- templates. Participant tokens move from ParticipantGroup to Participant
-- so /tg/:token remains stable across cohort moves.

-- ─── Product ────────────────────────────────────────────────────────────────
CREATE TABLE "products" (
  "id"          TEXT         NOT NULL PRIMARY KEY,
  "title"       TEXT         NOT NULL,
  "description" TEXT,
  "kind"        TEXT         NOT NULL DEFAULT 'game',
  "isActive"    BOOLEAN      NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL
);
CREATE INDEX "products_isActive_idx" ON "products"("isActive");

-- ─── Per-product waitlist ──────────────────────────────────────────────────
CREATE TABLE "product_waitlist_entries" (
  "id"            TEXT         NOT NULL PRIMARY KEY,
  "productId"     TEXT         NOT NULL,
  "participantId" TEXT         NOT NULL,
  "source"        TEXT,
  "notes"         TEXT,
  "isActive"      BOOLEAN      NOT NULL DEFAULT true,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "product_waitlist_entries_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "product_waitlist_entries_participantId_fkey"
    FOREIGN KEY ("participantId") REFERENCES "participants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "product_waitlist_entries_productId_participantId_key"
  ON "product_waitlist_entries"("productId", "participantId");
CREATE INDEX "product_waitlist_entries_productId_isActive_idx"
  ON "product_waitlist_entries"("productId", "isActive");

-- ─── Product-scoped communication templates ────────────────────────────────
CREATE TABLE "communication_templates" (
  "id"        TEXT         NOT NULL PRIMARY KEY,
  "productId" TEXT         NOT NULL,
  "channel"   TEXT         NOT NULL,       -- 'email' | 'whatsapp'
  "title"     TEXT         NOT NULL,
  "subject"   TEXT,
  "body"      TEXT         NOT NULL,
  "isActive"  BOOLEAN      NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "communication_templates_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "communication_templates_productId_channel_isActive_idx"
  ON "communication_templates"("productId", "channel", "isActive");

-- ─── PaymentOffer.productId + QuestionnaireTemplate.productId ──────────────
ALTER TABLE "payment_offers"
  ADD COLUMN "productId" TEXT,
  ADD CONSTRAINT "payment_offers_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "payment_offers_productId_idx" ON "payment_offers"("productId");

ALTER TABLE "questionnaire_templates"
  ADD COLUMN "productId" TEXT,
  ADD CONSTRAINT "questionnaire_templates_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "questionnaire_templates_productId_idx" ON "questionnaire_templates"("productId");

-- ─── Participant-scoped portal token ───────────────────────────────────────
-- The old ParticipantGroup.accessToken stays for backward-compat reads.
-- New writes go here; moves between groups no longer regenerate.
ALTER TABLE "participants"
  ADD COLUMN "accessToken" TEXT;
CREATE UNIQUE INDEX "participants_accessToken_key" ON "participants"("accessToken");

-- Backfill: copy the MOST RECENT per-group token to the participant row
-- so existing /tg/:token links keep working via the new resolver path.
-- Uses DISTINCT ON to pick one token per participant (latest joinedAt).
UPDATE "participants" p
   SET "accessToken" = sub."accessToken"
  FROM (
    SELECT DISTINCT ON ("participantId")
           "participantId", "accessToken"
      FROM "participant_groups"
     WHERE "accessToken" IS NOT NULL
  ORDER BY "participantId", "joinedAt" DESC
  ) AS sub
 WHERE p."id" = sub."participantId"
   AND p."accessToken" IS NULL;
