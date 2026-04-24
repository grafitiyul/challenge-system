-- Public registration Phase 2 — configurable questionnaires + offers.
-- Replaces the hardcoded waitlist stamp with template-driven behavior,
-- and introduces PaymentOffer as the business context for payments.

-- ─── QuestionnaireTemplate post-submit configuration ────────────────────────
ALTER TABLE "questionnaire_templates"
  ADD COLUMN "submissionPurpose"         TEXT NOT NULL DEFAULT 'internal',
  ADD COLUMN "participantMatchingMode"   TEXT NOT NULL DEFAULT 'match_by_phone',
  ADD COLUMN "onSubmitParticipantStatus" TEXT,
  ADD COLUMN "onSubmitSource"            TEXT,
  ADD COLUMN "linkedChallengeId"         TEXT,
  ADD COLUMN "linkedGroupId"             TEXT;

-- Data migration — any existing template that is EXTERNAL-facing was
-- implicitly treated as a waitlist form by the prior hardcoded code. Carry
-- that intent forward so admin-filled reports preserve their existing
-- behavior, but admin can reconfigure freely afterwards.
UPDATE "questionnaire_templates"
   SET "submissionPurpose" = 'waitlist',
       "onSubmitSource"            = 'waitlist_form',
       "onSubmitParticipantStatus" = 'lead_waitlist'
 WHERE "usageType" IN ('external', 'both')
   AND "submitBehavior" IN ('attach_or_create', 'create_new_participant');

-- Map legacy submitBehavior → participantMatchingMode. These are the two
-- values the prior code treated as "allowed to create". 'none' falls back
-- to the default ('match_by_phone') — the service will skip creation
-- anyway when submissionPurpose='internal'.
UPDATE "questionnaire_templates"
   SET "participantMatchingMode" = 'always_create'
 WHERE "submitBehavior" = 'create_new_participant';
UPDATE "questionnaire_templates"
   SET "participantMatchingMode" = 'match_by_phone'
 WHERE "submitBehavior" = 'attach_or_create';
UPDATE "questionnaire_templates"
   SET "participantMatchingMode" = 'manual_review'
 WHERE "submitBehavior" = 'none';

ALTER TABLE "questionnaire_templates"
  ADD CONSTRAINT "questionnaire_templates_linkedChallengeId_fkey"
    FOREIGN KEY ("linkedChallengeId") REFERENCES "challenges"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "questionnaire_templates_linkedGroupId_fkey"
    FOREIGN KEY ("linkedGroupId") REFERENCES "groups"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── PaymentOffer ───────────────────────────────────────────────────────────
CREATE TABLE "payment_offers" (
  "id"                TEXT         NOT NULL PRIMARY KEY,
  "title"             TEXT         NOT NULL,
  "description"       TEXT,
  "amount"            DECIMAL(12,2) NOT NULL,
  "currency"          TEXT         NOT NULL DEFAULT 'ILS',
  "iCountPaymentUrl"  TEXT,
  "linkedChallengeId" TEXT,
  "linkedProgramId"   TEXT,
  "defaultGroupId"    TEXT,
  "isActive"          BOOLEAN      NOT NULL DEFAULT true,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_offers_linkedChallengeId_fkey"
    FOREIGN KEY ("linkedChallengeId") REFERENCES "challenges"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "payment_offers_linkedProgramId_fkey"
    FOREIGN KEY ("linkedProgramId") REFERENCES "programs"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "payment_offers_defaultGroupId_fkey"
    FOREIGN KEY ("defaultGroupId") REFERENCES "groups"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "payment_offers_isActive_idx" ON "payment_offers"("isActive");

-- ─── Payment business-context relations + verification ──────────────────────
ALTER TABLE "payments"
  ADD COLUMN "offerId"    TEXT,
  ADD COLUMN "groupId"    TEXT,
  ADD COLUMN "verifiedAt" TIMESTAMP(3);

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_offerId_fkey"
    FOREIGN KEY ("offerId") REFERENCES "payment_offers"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "payments_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "groups"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "payments_offerId_idx" ON "payments"("offerId");
CREATE INDEX "payments_groupId_idx" ON "payments"("groupId");
