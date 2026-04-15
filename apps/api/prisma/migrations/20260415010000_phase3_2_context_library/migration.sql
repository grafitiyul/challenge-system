-- =============================================================================
-- Phase 3.2 — Reusable context library
-- =============================================================================
-- Additive migration. Creates two new tables; no existing tables or columns
-- are modified. Old actions with local context schemas (GameAction.contextSchemaJson)
-- keep working identically — the resolver merges local dimensions with attached
-- reusable dimensions at read time.
-- =============================================================================


CREATE TABLE "context_definitions" (
  "id"                              TEXT         PRIMARY KEY,
  "programId"                       TEXT         NOT NULL,
  "label"                           TEXT         NOT NULL,
  "key"                             TEXT         NOT NULL,
  "type"                            TEXT         NOT NULL,
  "requiredByDefault"               BOOLEAN      NOT NULL DEFAULT false,
  "visibleToParticipantByDefault"   BOOLEAN      NOT NULL DEFAULT true,
  "optionsJson"                     JSONB,
  "isActive"                        BOOLEAN      NOT NULL DEFAULT true,
  "sortOrder"                       INTEGER      NOT NULL DEFAULT 0,
  "createdAt"                       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "updatedAt"                       TIMESTAMPTZ  NOT NULL,

  CONSTRAINT "context_definitions_program_fkey"
    FOREIGN KEY ("programId") REFERENCES "programs"("id")
);

CREATE UNIQUE INDEX "context_definitions_programId_key_key"
  ON "context_definitions" ("programId", "key");

CREATE INDEX "context_definitions_programId_idx"
  ON "context_definitions" ("programId");


CREATE TABLE "game_action_context_uses" (
  "id"                           TEXT         PRIMARY KEY,
  "actionId"                     TEXT         NOT NULL,
  "definitionId"                 TEXT         NOT NULL,
  "requiredOverride"             BOOLEAN,
  "visibleToParticipantOverride" BOOLEAN,
  "sortOrder"                    INTEGER      NOT NULL DEFAULT 0,
  "createdAt"                    TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT "game_action_context_uses_action_fkey"
    FOREIGN KEY ("actionId") REFERENCES "game_actions"("id") ON DELETE CASCADE,
  CONSTRAINT "game_action_context_uses_definition_fkey"
    FOREIGN KEY ("definitionId") REFERENCES "context_definitions"("id")
);

CREATE UNIQUE INDEX "game_action_context_uses_actionId_definitionId_key"
  ON "game_action_context_uses" ("actionId", "definitionId");

CREATE INDEX "game_action_context_uses_definitionId_idx"
  ON "game_action_context_uses" ("definitionId");
