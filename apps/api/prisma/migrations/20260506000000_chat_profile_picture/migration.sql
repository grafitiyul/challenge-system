-- Capture WhatsApp profile / group picture URL on the chat record so
-- the admin link-chat modal can render real images instead of the
-- generated initial-letter bubble.
--
-- Nullable: existing rows stay null until they're either re-ingested
-- (new inbound message → upsertChat picks up the picture) or a future
-- admin "refresh missing pictures" backstop is added. The frontend
-- treats null as "use the initial-letter fallback" so legacy data is
-- visually unchanged until enriched.

ALTER TABLE "whatsapp_chats"
  ADD COLUMN "profilePictureUrl" TEXT;
