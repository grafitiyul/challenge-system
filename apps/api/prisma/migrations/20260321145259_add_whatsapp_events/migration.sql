-- CreateTable
CREATE TABLE "whatsapp_events" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eventType" TEXT,
    "rawPayload" JSONB NOT NULL,
    "phoneNumber" TEXT,
    "senderName" TEXT,
    "chatId" TEXT,
    "chatName" TEXT,
    "messageText" TEXT,
    "messageType" TEXT,
    "mediaUrl" TEXT,
    "timestampFromSource" BIGINT,

    CONSTRAINT "whatsapp_events_pkey" PRIMARY KEY ("id")
);
