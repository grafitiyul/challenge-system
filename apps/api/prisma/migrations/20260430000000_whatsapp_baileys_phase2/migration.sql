-- WhatsApp Bridge Phase 2 — message ingestion + media storage.
--
-- The schema additions in Phase 1 (provider, media metadata columns,
-- WhatsAppMessageReaction, WhatsAppSession, WhatsAppConnection) are
-- already in place. Phase 2 only needs two columns on the
-- connection-lifecycle row to surface "last media download error"
-- to the admin UI without having to scrape Railway logs.

ALTER TABLE "whatsapp_connection"
  ADD COLUMN "lastMediaError"   TEXT,
  ADD COLUMN "lastMediaErrorAt" TIMESTAMPTZ;
