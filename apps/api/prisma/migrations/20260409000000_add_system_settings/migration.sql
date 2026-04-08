-- System settings key-value store
CREATE TABLE "system_settings" (
  "key"       TEXT NOT NULL PRIMARY KEY,
  "value"     TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Seed default: mock participants feature is disabled by default
INSERT INTO "system_settings" ("key", "value", "updatedAt")
VALUES ('mockParticipantsEnabled', 'false', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
