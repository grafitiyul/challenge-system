-- Public registration Phase 1 — Payments.
-- Manual-entry only for now; `provider` and `status` are free-form strings
-- so an iCount webhook (next phase) can write "icount" rows alongside
-- existing "manual" rows without a schema change. `rawPayload` holds the
-- full webhook body when that lands.

CREATE TABLE "payments" (
  "id"                TEXT         NOT NULL PRIMARY KEY,
  "participantId"     TEXT         NOT NULL,
  "provider"          TEXT         NOT NULL DEFAULT 'manual',
  "externalPaymentId" TEXT,
  "amount"            DECIMAL(12,2) NOT NULL,
  "currency"          TEXT         NOT NULL DEFAULT 'ILS',
  "paidAt"            TIMESTAMP(3) NOT NULL,
  "status"            TEXT         NOT NULL DEFAULT 'paid',
  "itemName"          TEXT         NOT NULL,
  "invoiceNumber"     TEXT,
  "invoiceUrl"        TEXT,
  "rawPayload"        JSONB,
  "notes"             TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payments_participantId_fkey"
    FOREIGN KEY ("participantId") REFERENCES "participants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "payments_participantId_idx" ON "payments"("participantId");
CREATE INDEX "payments_provider_externalPaymentId_idx"
  ON "payments"("provider", "externalPaymentId");
