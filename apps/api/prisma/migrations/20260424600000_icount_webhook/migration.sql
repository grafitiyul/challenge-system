-- iCount webhook ingestion support.
--
-- Payments from iCount arrive via POST /api/webhooks/icount/:secret.
-- The webhook ALWAYS writes an audit row to icount_webhook_logs before
-- attempting to match, so nothing is ever lost. PaymentOffer gains
-- three optional iCount mapping fields so the matcher can resolve
-- which offer a given invoice line belongs to.

-- ─── PaymentOffer — iCount mapping columns ──────────────────────────────────
ALTER TABLE "payment_offers"
  ADD COLUMN "iCountPageId"     TEXT,
  ADD COLUMN "iCountItemName"   TEXT,
  ADD COLUMN "iCountExternalId" TEXT;

CREATE INDEX "payment_offers_iCountPageId_idx" ON "payment_offers"("iCountPageId");

-- ─── iCount webhook audit log ───────────────────────────────────────────────
CREATE TABLE "icount_webhook_logs" (
  "id"                   TEXT         NOT NULL PRIMARY KEY,
  "rawPayload"           JSONB        NOT NULL,
  "status"               TEXT         NOT NULL DEFAULT 'needs_review',
  "extDocNumber"         TEXT,
  "extTransactionId"     TEXT,
  "extAmount"            DECIMAL(12,2),
  "extCurrency"          TEXT,
  "extCustomerName"      TEXT,
  "extCustomerPhone"     TEXT,
  "extCustomerEmail"     TEXT,
  "extPageId"            TEXT,
  "extItemName"          TEXT,
  "matchedPaymentId"     TEXT,
  "matchedOfferId"       TEXT,
  "matchedParticipantId" TEXT,
  "errorMessage"         TEXT,
  "adminNotes"           TEXT,
  "processedAt"          TIMESTAMP(3),
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL,
  CONSTRAINT "icount_webhook_logs_matchedPaymentId_fkey"
    FOREIGN KEY ("matchedPaymentId") REFERENCES "payments"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "icount_webhook_logs_matchedOfferId_fkey"
    FOREIGN KEY ("matchedOfferId") REFERENCES "payment_offers"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "icount_webhook_logs_matchedParticipantId_fkey"
    FOREIGN KEY ("matchedParticipantId") REFERENCES "participants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "icount_webhook_logs_status_createdAt_idx"
  ON "icount_webhook_logs"("status", "createdAt");
CREATE INDEX "icount_webhook_logs_extTransactionId_idx"
  ON "icount_webhook_logs"("extTransactionId");
