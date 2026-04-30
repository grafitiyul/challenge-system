-- WhatsApp Bridge Phase 1 — schema foundation for Baileys replacement.
--
-- Additive only: the existing Wassenger flow keeps working while the
-- bridge is being built. New rows from the bridge tag themselves with
-- provider='baileys'; legacy Wassenger rows default to 'wassenger'.
--
-- Tables added:
--   whatsapp_sessions          — Postgres-backed Baileys auth state.
--   whatsapp_connection        — singleton connection-lifecycle row.
--   whatsapp_message_reactions — reactions delivered as separate events.
--
-- Columns added to existing tables (all nullable / defaulted so the
-- migration is non-destructive and backwards-compatible):
--   whatsapp_chats.provider
--   whatsapp_messages.provider
--   whatsapp_messages.quotedExternalId
--   whatsapp_messages.mediaMimeType
--   whatsapp_messages.mediaSizeBytes
--   whatsapp_messages.mediaOriginalName

-- ── Existing tables: provider column + Baileys-specific message metadata ──
ALTER TABLE "whatsapp_chats"
  ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'wassenger';

ALTER TABLE "whatsapp_messages"
  ADD COLUMN "provider"           TEXT    NOT NULL DEFAULT 'wassenger',
  ADD COLUMN "quotedExternalId"   TEXT,
  ADD COLUMN "mediaMimeType"      TEXT,
  ADD COLUMN "mediaSizeBytes"     INTEGER,
  ADD COLUMN "mediaOriginalName"  TEXT;

-- ── whatsapp_sessions ────────────────────────────────────────────────────
-- Custom AuthenticationState backing store. data is JSONB; serialisation
-- uses Baileys' BufferJSON replacer so binary keys survive the round-trip.
CREATE TABLE "whatsapp_sessions" (
  "id"        TEXT         NOT NULL,
  "kind"      TEXT         NOT NULL,
  "keyId"     TEXT         NOT NULL,
  "data"      JSONB        NOT NULL,
  "updatedAt" TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "whatsapp_sessions_kind_keyId_key"
  ON "whatsapp_sessions" ("kind", "keyId");

CREATE INDEX "whatsapp_sessions_kind_idx"
  ON "whatsapp_sessions" ("kind");

-- ── whatsapp_connection ──────────────────────────────────────────────────
-- Single-row table (id='singleton') maintained by the bridge. The default
-- on `id` is hard-pinned via the application code (Prisma `@default("singleton")`),
-- not the database, so we don't enforce CHECK here — the bridge upserts on
-- the literal id 'singleton' on every state change.
CREATE TABLE "whatsapp_connection" (
  "id"                   TEXT         NOT NULL,
  "status"               TEXT         NOT NULL DEFAULT 'disconnected',
  "qr"                   TEXT,
  "phoneJid"             TEXT,
  "deviceName"           TEXT,
  "lastQrAt"             TIMESTAMP(3),
  "lastConnectedAt"      TIMESTAMP(3),
  "lastDisconnectAt"     TIMESTAMP(3),
  "lastDisconnectReason" TEXT,
  "lastMessageAt"        TIMESTAMP(3),
  "reconnectAttempts"    INTEGER      NOT NULL DEFAULT 0,
  "updatedAt"            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_connection_pkey" PRIMARY KEY ("id")
);

-- ── whatsapp_message_reactions ───────────────────────────────────────────
-- Reactions reference messages by externalMessageId, not by FK on
-- whatsapp_messages.id, because Baileys can deliver a reaction before
-- the target message has finished being upserted (rare, but possible
-- under history-sync replay). A reactor can react then unreact then
-- react again — same unique tuple, emoji column flips. emoji='' means
-- the reaction was removed.
CREATE TABLE "whatsapp_message_reactions" (
  "id"                TEXT         NOT NULL,
  "externalMessageId" TEXT         NOT NULL,
  "reactorPhone"      TEXT         NOT NULL,
  "reactorName"       TEXT,
  "emoji"             TEXT         NOT NULL,
  "reactedAt"         TIMESTAMP(3) NOT NULL,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_message_reactions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "whatsapp_message_reactions_externalMessageId_reactorPhone_key"
  ON "whatsapp_message_reactions" ("externalMessageId", "reactorPhone");

CREATE INDEX "whatsapp_message_reactions_externalMessageId_idx"
  ON "whatsapp_message_reactions" ("externalMessageId");
