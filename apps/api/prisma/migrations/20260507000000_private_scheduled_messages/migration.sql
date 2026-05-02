-- Private scheduled WhatsApp messages.
--
-- Single source of truth for admin-composed DMs that wait for a future
-- scheduledAt and are sent by a dedicated cron worker. The row is keyed
-- on participantId only — never groupId — so editing/cancelling
-- propagates to every surface that displays it (participant profile
-- chat tab + group-list WA popup).
--
-- Lifecycle: pending → sending (claimed) → sent | failed | cancelled.
-- Mirrors GroupScheduledMessage's claim/retry shape exactly: same
-- claimedAt TTL, same backoff schedule (1m / 5m / 15m), same MAX_ATTEMPTS=3.
-- This intentional duplication of column shape lets a separate worker
-- run side-by-side without sharing a table — see
-- apps/api/src/modules/scheduled-messages/scheduled-messages-shared.ts
-- for the constants both workers import.
--
-- Send-now does NOT create a row here. Send-now goes straight through
-- the bridge and lands in WhatsAppMessage with direction='outgoing'.

CREATE TABLE "private_scheduled_messages" (
  "id"                TEXT         NOT NULL,
  "participantId"     TEXT         NOT NULL,

  -- Snapshot fields. content + scheduledAt are editable while
  -- status='pending'; phoneSnapshot is captured at create time so a
  -- later phone change on the participant doesn't silently retarget
  -- an already-scheduled message.
  "content"           TEXT         NOT NULL,
  "scheduledAt"       TIMESTAMPTZ  NOT NULL,
  "phoneSnapshot"     TEXT         NOT NULL,

  -- Lifecycle
  "status"            TEXT         NOT NULL DEFAULT 'pending',
  "enabled"           BOOLEAN      NOT NULL DEFAULT true,

  -- Retry/backoff state
  "attemptCount"      INTEGER      NOT NULL DEFAULT 0,
  "lastAttemptAt"     TIMESTAMPTZ,
  "nextRetryAt"       TIMESTAMPTZ,

  -- Atomic claim
  "claimedAt"         TIMESTAMPTZ,
  "claimedBy"         TEXT,

  -- Outcome
  "sentAt"            TIMESTAMPTZ,
  "externalMessageId" TEXT,
  "failureReason"     TEXT,
  "cancelledAt"       TIMESTAMPTZ,
  "cancelledBy"       TEXT,

  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,

  CONSTRAINT "private_scheduled_messages_pkey" PRIMARY KEY ("id")
);

-- Cron worker's primary access path — pulls due rows by status + time.
CREATE INDEX "private_scheduled_messages_status_scheduledAt_idx"
  ON "private_scheduled_messages" ("status", "scheduledAt");

-- Per-participant lookups (chat tab + group popup) and badge counts.
CREATE INDEX "private_scheduled_messages_participantId_status_idx"
  ON "private_scheduled_messages" ("participantId", "status");

ALTER TABLE "private_scheduled_messages"
  ADD CONSTRAINT "private_scheduled_messages_participantId_fkey"
  FOREIGN KEY ("participantId") REFERENCES "participants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
