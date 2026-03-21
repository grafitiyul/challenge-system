-- CreateTable
CREATE TABLE "whatsapp_chats" (
    "id" TEXT NOT NULL,
    "externalChatId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'private',
    "name" TEXT,
    "phoneNumber" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_chats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_messages" (
    "id" TEXT NOT NULL,
    "externalMessageId" TEXT,
    "chatId" TEXT NOT NULL,
    "direction" TEXT,
    "senderName" TEXT,
    "senderPhone" TEXT,
    "messageType" TEXT NOT NULL DEFAULT 'text',
    "textContent" TEXT,
    "mediaUrl" TEXT,
    "timestampFromSource" TIMESTAMP(3) NOT NULL,
    "rawPayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_chats_externalChatId_key" ON "whatsapp_chats"("externalChatId");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_messages_externalMessageId_key" ON "whatsapp_messages"("externalMessageId");

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "whatsapp_chats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
