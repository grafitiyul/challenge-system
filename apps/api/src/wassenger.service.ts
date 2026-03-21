import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';

interface WassengerData {
  id?: string;
  type?: string;
  body?: string;
  timestamp?: number;
  from?: string;
  fromContact?: { name?: string; phone?: string };
  chat?: { id?: string; name?: string; type?: string };
  media?: { url?: string };
}

interface WassengerPayload {
  event?: string;
  type?: string;
  data?: WassengerData;
  [key: string]: unknown;
}

@Injectable()
export class WassengerService {
  constructor(private readonly prisma: PrismaService) {}

  // ──────────────────────────────────────────────────────────────
  // Ingestion
  // ──────────────────────────────────────────────────────────────

  async ingestWebhook(payload: WassengerPayload): Promise<void> {
    // 1. Always save the raw event — never skip even on error below
    await this.saveRawEvent(payload).catch(() => {});

    const data = payload.data ?? {};
    const fromContact = data.fromContact ?? {};
    const chatData = data.chat ?? {};
    const eventType = payload.event ?? payload.type ?? '';

    const externalChatId = chatData.id ?? data.from ?? null;
    if (!externalChatId) {
      console.warn('[Wassenger] no externalChatId found in payload, skipping chat/message creation. event:', eventType);
      return;
    }

    const messageTs = data.timestamp
      ? new Date(data.timestamp * 1000)
      : new Date();

    const direction = eventType.includes(':in:')
      ? 'incoming'
      : eventType.includes(':out:')
        ? 'outgoing'
        : null;

    // Guess chat type: Wassenger group chat IDs typically end in @g.us
    const chatType =
      chatData.type ??
      (externalChatId.endsWith('@g.us') ? 'group' : 'private');

    // 2. Upsert the chat record
    const chat = await this.prisma.whatsAppChat.upsert({
      where: { externalChatId },
      create: {
        externalChatId,
        type: chatType,
        name: chatData.name ?? fromContact.name ?? null,
        phoneNumber:
          chatType === 'private'
            ? (fromContact.phone ?? data.from ?? null)
            : null,
        lastMessageAt: messageTs,
      },
      update: {
        ...(chatData.name || fromContact.name
          ? { name: chatData.name ?? fromContact.name }
          : {}),
        lastMessageAt: messageTs,
      },
    });

    // 3. Create the message (upsert by externalMessageId when available)
    const msgPayload: Parameters<typeof this.prisma.whatsAppMessage.create>[0]['data'] =
      {
        chatId: chat.id,
        direction,
        senderName: fromContact.name ?? null,
        senderPhone: fromContact.phone ?? data.from ?? null,
        messageType: data.type ?? 'text',
        textContent: typeof data.body === 'string' ? data.body : null,
        mediaUrl: data.media?.url ?? null,
        timestampFromSource: messageTs,
        rawPayload: payload as object,
        ...(data.id ? { externalMessageId: data.id } : {}),
      };

    if (data.id) {
      await this.prisma.whatsAppMessage.upsert({
        where: { externalMessageId: data.id },
        create: msgPayload,
        update: {},
      });
    } else {
      await this.prisma.whatsAppMessage.create({ data: msgPayload });
    }
  }

  // ──────────────────────────────────────────────────────────────
  // Queries
  // ──────────────────────────────────────────────────────────────

  async getChats() {
    const chats = await this.prisma.whatsAppChat.findMany({
      orderBy: { lastMessageAt: 'desc' },
      include: {
        messages: {
          orderBy: { timestampFromSource: 'desc' },
          take: 1,
        },
      },
    });
    return chats;
  }

  async getChatWithMessages(chatId: string) {
    return this.prisma.whatsAppChat.findUnique({
      where: { id: chatId },
      include: {
        messages: {
          orderBy: { timestampFromSource: 'asc' },
        },
      },
    });
  }

  // ──────────────────────────────────────────────────────────────
  // Raw events (kept for debugging / audit)
  // ──────────────────────────────────────────────────────────────

  private async saveRawEvent(payload: WassengerPayload): Promise<void> {
    const data = payload.data ?? {};
    const fromContact = data.fromContact ?? {};
    const chatData = data.chat ?? {};
    const eventType = payload.event ?? payload.type ?? null;

    await this.prisma.whatsAppEvent.create({
      data: {
        eventType,
        rawPayload: payload as object,
        phoneNumber: fromContact.phone ?? data.from ?? null,
        senderName: fromContact.name ?? null,
        chatId: chatData.id ?? null,
        chatName: chatData.name ?? null,
        messageText: typeof data.body === 'string' ? data.body : null,
        messageType: data.type ?? null,
        mediaUrl: data.media?.url ?? null,
        timestampFromSource:
          typeof data.timestamp === 'number' ? BigInt(data.timestamp) : null,
      },
    });
  }

  async getLatestEvents(limit = 50) {
    const rows = await this.prisma.whatsAppEvent.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((row) => ({
      ...row,
      timestampFromSource:
        row.timestampFromSource != null
          ? Number(row.timestampFromSource)
          : null,
    }));
  }
}
