-- CreateTable
CREATE TABLE "group_chat_links" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "whatsappChatId" TEXT NOT NULL,
    "linkType" TEXT NOT NULL,
    "participantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_chat_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "group_chat_links_groupId_whatsappChatId_key" ON "group_chat_links"("groupId", "whatsappChatId");

-- AddForeignKey
ALTER TABLE "group_chat_links" ADD CONSTRAINT "group_chat_links_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_chat_links" ADD CONSTRAINT "group_chat_links_whatsappChatId_fkey" FOREIGN KEY ("whatsappChatId") REFERENCES "whatsapp_chats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_chat_links" ADD CONSTRAINT "group_chat_links_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "participants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
