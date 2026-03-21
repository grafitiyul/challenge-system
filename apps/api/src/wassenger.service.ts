import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';

// ─── Webhook payload types ────────────────────────────────────────────────────

interface WassengerContact {
  name?: string;
  displayName?: string;
  phone?: string;
}

interface WassengerData {
  id?: string;
  type?: string;
  body?: string;
  timestamp?: number;
  // For private chats: sender's WhatsApp ID "972501234567@c.us"
  // For GROUP chats:   the GROUP's ID "120363406660919335@g.us" — NOT the sender!
  from?: string;
  // For GROUP chats: actual sender's WhatsApp ID "972501234567@c.us"
  author?: string;
  fromContact?: WassengerContact;
  contact?: WassengerContact;
  chat?: {
    id?: string;
    name?: string;
    type?: string;
    contact?: WassengerContact;
  };
  // meta.notifyName is the WhatsApp display name set by the sender — most reliable
  meta?: { notifyName?: string };
  media?: { url?: string; filename?: string; mimetype?: string; size?: number };
}

interface WassengerPayload {
  event?: string;
  type?: string;
  data?: WassengerData;
  [key: string]: unknown;
}

// ─── Wassenger REST API types (used by backfill) ──────────────────────────────

interface WassengerApiChat {
  id: string;
  type?: string;   // "group" | "private" | "channel"
  name?: string;
  phone?: string;  // clean phone for private chats
  timestamp?: number;
  [key: string]: unknown;
}

interface WassengerApiMessage {
  id?: string;
  type?: string;   // "chat"(text) | "image" | "audio" | "ptt" | "video" | "document" | ...
  body?: string;
  from?: string;
  author?: string;
  fromMe?: boolean;
  timestamp?: number;
  meta?: { notifyName?: string };
  contact?: WassengerContact;
  fromContact?: WassengerContact;
  chat?: { id?: string; name?: string; type?: string };
  media?: { url?: string; filename?: string; mimetype?: string; size?: number };
  [key: string]: unknown;
}

export interface BackfillStats {
  chatsScanned: number;
  messagesScanned: number;
  messagesImported: number;
  duplicatesSkipped: number;
  mediaFound: number;
  errors: number;
}

// ─── Extraction helpers (shared by webhook ingestion and backfill) ─────────────

// Strip WhatsApp ID suffixes: "972501234567@c.us" → "972501234567"
function cleanPhone(raw: string | undefined | null): string | null {
  if (!raw) return null;
  return raw.replace(/@(c\.us|s\.whatsapp\.net|g\.us)$/i, '').trim() || null;
}

// Best-effort sender name
function extractSenderName(data: WassengerData): string | null {
  return (
    data.meta?.notifyName ??
    data.contact?.name ??
    data.contact?.displayName ??
    data.chat?.contact?.name ??
    data.fromContact?.name ??
    null
  );
}

// Best-effort clean sender phone.
// KEY: in group chats data.from is the GROUP id — use data.author for the actual sender.
function extractSenderPhone(data: WassengerData): string | null {
  return (
    data.contact?.phone ??
    data.fromContact?.phone ??
    cleanPhone(data.author) ??
    (data.from && !data.from.endsWith('@g.us') ? cleanPhone(data.from) : null)
  );
}

// Normalise Wassenger API message type → our stored messageType
function normalizeMessageType(raw: string | undefined): string {
  if (!raw) return 'text';
  const MAP: Record<string, string> = {
    chat: 'text',
    ptt: 'audio',          // push-to-talk / voice note
    image: 'image',
    video: 'video',
    audio: 'audio',
    document: 'document',
    sticker: 'image',
  };
  return MAP[raw] ?? 'system';
}

// ─── Service ──────────────────────────────────────────────────────────────────

const WASSENGER_API = 'https://api.wassenger.com/v1';

@Injectable()
export class WassengerService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Webhook ingestion ──────────────────────────────────────────────────────

  async ingestWebhook(payload: WassengerPayload): Promise<void> {
    // 1. Always save raw event first — never skip even on error below
    await this.saveRawEvent(payload).catch(() => {});

    const data = payload.data ?? {};
    const chatData = data.chat ?? {};
    const eventType = payload.event ?? payload.type ?? '';

    const externalChatId = chatData.id ?? cleanPhone(data.from) ?? data.from ?? null;
    if (!externalChatId) {
      console.warn('[Wassenger] no externalChatId found in payload, skipping. event:', eventType);
      return;
    }

    const messageTs = data.timestamp ? new Date(data.timestamp * 1000) : new Date();

    const direction = eventType.includes(':in:')
      ? 'incoming'
      : eventType.includes(':out:')
        ? 'outgoing'
        : null;

    const chatType =
      chatData.type ?? (externalChatId.endsWith('@g.us') ? 'group' : 'private');

    const senderName = extractSenderName(data);
    const senderPhone = extractSenderPhone(data);

    // 2. Upsert chat
    const chat = await this.prisma.whatsAppChat.upsert({
      where: { externalChatId },
      create: {
        externalChatId,
        type: chatType,
        name: chatData.name ?? senderName ?? null,
        phoneNumber: chatType === 'private' ? (senderPhone ?? null) : null,
        lastMessageAt: messageTs,
      },
      update: {
        ...(chatData.name ? { name: chatData.name } : {}),
        lastMessageAt: messageTs,
      },
    });

    // 3. Create / deduplicate message
    const msgPayload: Parameters<typeof this.prisma.whatsAppMessage.create>[0]['data'] = {
      chatId: chat.id,
      direction,
      senderName,
      senderPhone,
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

  // ── Queries ────────────────────────────────────────────────────────────────

  async getChats() {
    return this.prisma.whatsAppChat.findMany({
      orderBy: { lastMessageAt: 'desc' },
      include: {
        messages: { orderBy: { timestampFromSource: 'desc' }, take: 1 },
      },
    });
  }

  async getChatWithMessages(chatId: string) {
    return this.prisma.whatsAppChat.findUnique({
      where: { id: chatId },
      include: { messages: { orderBy: { timestampFromSource: 'asc' } } },
    });
  }

  // ── Backfill ───────────────────────────────────────────────────────────────

  async runBackfill(daysBack = 30): Promise<BackfillStats & { durationMs: number }> {
    const apiKey = process.env['WASSENGER_API_KEY'];
    if (!apiKey) {
      throw new Error('WASSENGER_API_KEY environment variable is not set.');
    }

    const startedAt = Date.now();
    const stats: BackfillStats = {
      chatsScanned: 0,
      messagesScanned: 0,
      messagesImported: 0,
      duplicatesSkipped: 0,
      mediaFound: 0,
      errors: 0,
    };

    const fromTs = Math.floor(Date.now() / 1000) - daysBack * 86_400;
    console.log(`[Backfill] Starting. daysBack=${daysBack}, fromTs=${fromTs} (${new Date(fromTs * 1000).toISOString()})`);

    // 1. Fetch all chats
    const chats = await this.fetchAllChats(apiKey);
    stats.chatsScanned = chats.length;
    console.log(`[Backfill] ${chats.length} chats found.`);

    // 2. Process each chat sequentially to avoid DB contention
    for (const apiChat of chats) {
      try {
        await this.backfillOneChat(apiKey, apiChat, fromTs, stats);
      } catch (err) {
        console.error(`[Backfill] Error on chat ${apiChat.id}:`, err);
        stats.errors++;
      }
    }

    const durationMs = Date.now() - startedAt;
    console.log(`[Backfill] Done in ${durationMs}ms.`, stats);
    return { ...stats, durationMs };
  }

  private async fetchAllChats(apiKey: string): Promise<WassengerApiChat[]> {
    const all: WassengerApiChat[] = [];
    let page = 0;
    const LIMIT = 100;

    while (true) {
      const url = `${WASSENGER_API}/chats?limit=${LIMIT}&page=${page}&order=desc`;
      const res = await fetch(url, { headers: { token: apiKey } });
      if (!res.ok) {
        console.error(`[Backfill] GET /chats page=${page} → HTTP ${res.status}`);
        break;
      }
      const data = (await res.json()) as unknown;
      const rows = Array.isArray(data) ? (data as WassengerApiChat[]) : [];
      if (rows.length === 0) break;
      all.push(...rows);
      if (rows.length < LIMIT) break;
      page++;
    }
    return all;
  }

  private async backfillOneChat(
    apiKey: string,
    apiChat: WassengerApiChat,
    fromTs: number,
    stats: BackfillStats,
  ): Promise<void> {
    const chatType = apiChat.type ?? (apiChat.id.endsWith('@g.us') ? 'group' : 'private');

    // Upsert chat record
    const chat = await this.prisma.whatsAppChat.upsert({
      where: { externalChatId: apiChat.id },
      create: {
        externalChatId: apiChat.id,
        type: chatType,
        name: apiChat.name ?? null,
        phoneNumber: chatType === 'private' ? (apiChat.phone ?? null) : null,
        lastMessageAt: apiChat.timestamp ? new Date(apiChat.timestamp * 1000) : null,
      },
      update: {
        ...(apiChat.name ? { name: apiChat.name } : {}),
        ...(apiChat.timestamp ? { lastMessageAt: new Date(apiChat.timestamp * 1000) } : {}),
      },
    });

    // Fetch messages for this chat from daysBack ago
    const messages = await this.fetchChatMessages(apiKey, apiChat.id, fromTs);
    stats.messagesScanned += messages.length;

    for (const msg of messages) {
      if (msg.media?.url || msg.media?.filename) stats.mediaFound++;

      // Deduplicate by externalMessageId
      if (msg.id) {
        const exists = await this.prisma.whatsAppMessage.findUnique({
          where: { externalMessageId: msg.id },
          select: { id: true },
        });
        if (exists) {
          stats.duplicatesSkipped++;
          continue;
        }
      }

      const msgTs = msg.timestamp ? new Date(msg.timestamp * 1000) : new Date();
      const direction = msg.fromMe === true ? 'outgoing' : 'incoming';
      const msgType = normalizeMessageType(msg.type);

      // Build a WassengerData-shaped object to reuse the extraction helpers
      const dataLike: WassengerData = {
        id: msg.id,
        from: msg.from,
        author: msg.author,
        meta: msg.meta,
        contact: msg.contact,
        fromContact: msg.fromContact,
        chat: msg.chat ?? { id: apiChat.id, name: apiChat.name, type: apiChat.type },
      };

      try {
        await this.prisma.whatsAppMessage.create({
          data: {
            ...(msg.id ? { externalMessageId: msg.id } : {}),
            chatId: chat.id,
            direction,
            senderName: extractSenderName(dataLike),
            senderPhone: extractSenderPhone(dataLike),
            messageType: msgType,
            textContent: msg.body ?? null,
            mediaUrl: msg.media?.url ?? null,
            timestampFromSource: msgTs,
            // Store full API message object as raw payload
            rawPayload: msg as object,
          },
        });
        stats.messagesImported++;
      } catch (err) {
        console.error(`[Backfill] Failed to insert message ${msg.id ?? '(no id)'}:`, err);
        stats.errors++;
      }
    }
  }

  private async fetchChatMessages(
    apiKey: string,
    chatId: string,
    fromTs: number,
  ): Promise<WassengerApiMessage[]> {
    const all: WassengerApiMessage[] = [];
    let page = 0;
    const LIMIT = 100;

    while (true) {
      // Wassenger uses 'from' (unix seconds) to filter messages after a timestamp
      const url =
        `${WASSENGER_API}/chats/${encodeURIComponent(chatId)}/messages` +
        `?limit=${LIMIT}&page=${page}&order=asc&from=${fromTs}`;

      const res = await fetch(url, { headers: { token: apiKey } });
      if (!res.ok) {
        if (res.status !== 404) {
          console.warn(`[Backfill] messages for ${chatId} page=${page} → HTTP ${res.status}`);
        }
        break;
      }
      const data = (await res.json()) as unknown;
      const rows = Array.isArray(data) ? (data as WassengerApiMessage[]) : [];
      if (rows.length === 0) break;
      all.push(...rows);
      if (rows.length < LIMIT) break;
      page++;
    }
    return all;
  }

  // ── Raw events (audit trail) ───────────────────────────────────────────────

  private async saveRawEvent(payload: WassengerPayload): Promise<void> {
    const data = payload.data ?? {};
    const chatData = data.chat ?? {};
    const eventType = payload.event ?? payload.type ?? null;

    await this.prisma.whatsAppEvent.create({
      data: {
        eventType,
        rawPayload: payload as object,
        phoneNumber: extractSenderPhone(data),
        senderName: extractSenderName(data),
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
        row.timestampFromSource != null ? Number(row.timestampFromSource) : null,
    }));
  }
}
