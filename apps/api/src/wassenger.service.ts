import { BadRequestException, Injectable } from '@nestjs/common';
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
// Source: Wassenger OpenAPI spec at https://app.wassenger.com/docs/specification
//
// Key differences from webhook payload field names:
//   wid        → WhatsApp ID (chat or message), not "id"
//   kind       → chat/message type ("user"|"group"|"channel" for chats; "text"|"image"|... for messages)
//   flow       → "in" | "out" (not fromMe boolean)
//   date       → ISO date string (not unix timestamp)
//   chatWid    → chat WhatsApp ID on a message object

interface WassengerApiMessage {
  wid?: string;           // WhatsApp message ID
  chatWid?: string;       // WhatsApp ID of the chat this message belongs to
  flow?: string;          // "in" (incoming) | "out" (outgoing)
  body?: string;          // text content
  date?: string;          // ISO date string e.g. "2026-03-21T10:00:00.000Z"
  kind?: string;          // "text" | "image" | "audio" | "ptt" | "video" | "document" | ...
  from?: string;          // sender WID (group ID for group msgs — use author for actual sender)
  author?: string;        // actual sender WID in group messages
  meta?: { notifyName?: string };
  contact?: WassengerContact;
  fromContact?: WassengerContact;
  // chat sub-object may use wid OR id depending on API version
  chat?: { wid?: string; id?: string; name?: string; kind?: string; type?: string };
  media?: { url?: string; filename?: string; mimetype?: string; size?: number };
  [key: string]: unknown;
}

export interface BackfillStats {
  chatsScanned: number;
  messagesScanned: number;
  messagesImported: number;
  duplicatesSkipped: number;
  noChatSkipped: number;
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

// ─── Phone normalization ──────────────────────────────────────────────────────
//
// Input → Output examples:
//   "0524264020"              → "+972524264020"
//   "054-123-4567"            → "+972541234567"
//   "052 426 4020"            → "+972524264020"
//   "972524264020"            → "+972524264020"   (raw from webhook, missing +)
//   "+972524264020"           → "+972524264020"   (already correct)
//   "972524264020@c.us"       → "+972524264020"   (strip WA suffix)
//   "120363406660919335@g.us" → "120363406660919335@g.us"  (group JID, pass through)
//   "120363406660919335"      → "120363406660919335@g.us"  (group JID, suffix was stripped)
//
// Throws BadRequestException (Hebrew) for anything that can't be resolved.

export function normalizePhoneForWassenger(raw: string): string {
  const trimmed = raw.trim();

  // 1. Already a proper group JID (digits@g.us)
  if (/^\d+@g\.us$/.test(trimmed)) return trimmed;

  // 2. Strip any @-suffix (@c.us, @s.whatsapp.net, @g.us)
  let value = trimmed.replace(/@[\w.]+$/, '').trim();

  // 3. Looks like a stripped group JID: >15 digits cannot be a valid phone (E.164 max is 15 digits)
  if (/^\d{16,}$/.test(value)) return `${value}@g.us`;

  // 4. Phone normalization ────────────────────────────────────────────────────
  const hasPlus = value.startsWith('+');
  const digits = value.replace(/\D/g, ''); // keep only digits

  // Israeli mobile: 0XXXXXXXXX (10 digits, starts with 05–09)
  if (/^0[5-9]\d{8}$/.test(digits)) {
    return '+972' + digits.slice(1);
  }

  // International without +, starts with country code: 972XXXXXXXXX (12 digits)
  if (/^972\d{9}$/.test(digits)) {
    return '+' + digits;
  }

  // Had explicit + and valid E.164 length (8–15 digits)
  if (hasPlus && digits.length >= 8 && digits.length <= 15) {
    return '+' + digits;
  }

  // Generic international without + (common non-Israeli numbers)
  if (!hasPlus && /^[1-9]\d{7,14}$/.test(digits)) {
    return '+' + digits;
  }

  throw new BadRequestException('מספר הטלפון אינו תקין. אנא ודא שהמספר נכון ונסה שוב.');
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

  // ── Outbound message ──────────────────────────────────────────────────────

  async sendMessage(rawPhone: string, message: string): Promise<void> {
    const apiKey = process.env['WASSENGER_API_KEY'];
    const deviceId = process.env['WASSENGER_DEVICE_ID'];
    if (!apiKey || !deviceId) {
      throw new BadRequestException('שירות ההודעות אינו מוגדר. אנא פנה למנהל המערכת.');
    }

    // Group chat JIDs (e.g. "120363406660919335@g.us") must be sent as-is.
    // Personal chats and raw phone numbers go through normalization to reach E.164 format.
    const isGroupJid = rawPhone.trim().endsWith('@g.us');
    const phone = isGroupJid ? rawPhone.trim() : normalizePhoneForWassenger(rawPhone);

    // Wassenger /v1/messages uses mutually exclusive fields:
    //   phone: E.164 number   — for individual chats
    //   group: group JID      — for group chats (e.g. "972556638970-1593609853@g.us")
    // Sending a group JID in the `phone` field returns 400 phone:invalid.
    const requestPayload = isGroupJid
      ? { device: deviceId, group: phone, message }
      : { device: deviceId, phone, message };

    console.log('[Wassenger][sendMessage] === OUTBOUND REQUEST ===');
    console.log('[Wassenger][sendMessage] rawPhone (from caller):', JSON.stringify(rawPhone));
    console.log('[Wassenger][sendMessage] isGroupJid:', isGroupJid);
    console.log('[Wassenger][sendMessage] phone (after resolution):', JSON.stringify(phone));
    console.log('[Wassenger][sendMessage] deviceId:', deviceId);
    console.log('[Wassenger][sendMessage] message length:', message.length);
    console.log('[Wassenger][sendMessage] full payload:', JSON.stringify(requestPayload));

    const res = await fetch(`${WASSENGER_API}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Token': apiKey },
      body: JSON.stringify(requestPayload),
    });

    const responseBody = await res.text().catch(() => '');

    console.log('[Wassenger][sendMessage] === RESPONSE ===');
    console.log('[Wassenger][sendMessage] status:', res.status, res.statusText);
    console.log('[Wassenger][sendMessage] response body:', responseBody);

    if (!res.ok) {
      console.error('[Wassenger][sendMessage] FAILED — status:', res.status, '| phone:', phone, '| body:', responseBody);
      throw new BadRequestException('לא ניתן לשלוח את ההודעה כרגע. אנא נסה שוב.');
    }
  }

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
      noChatSkipped: 0,
      mediaFound: 0,
      errors: 0,
    };

    const deviceId = process.env['WASSENGER_DEVICE_ID'];
    if (!deviceId) {
      throw new Error('WASSENGER_DEVICE_ID environment variable is not set.');
    }

    const afterIso = new Date(Date.now() - daysBack * 86_400_000).toISOString();
    console.log(`[Backfill] Starting. daysBack=${daysBack}, after=${afterIso}, deviceId=${deviceId}`);

    // Strategy: messages-first.
    //   /chat/{deviceId}/chats → 404 on this account.
    //   Working endpoints confirmed from device response:
    //     GET /v1/messages?devices={deviceId}        — all messages (paginated)
    //     GET /v1/devices/{deviceId}/groups          — group metadata
    //   We fetch all messages, derive chats from each message's embedded chat object,
    //   upsert chats on the fly, then store the messages.

    // 1. Enrich group names from /devices/{deviceId}/groups (best-effort)
    const groupNameMap = await this.fetchGroupNames(apiKey, deviceId);
    console.log(`[Backfill] Group metadata loaded: ${groupNameMap.size} groups.`);

    // 2. Fetch all messages in the time window
    const messages = await this.fetchAllMessages(apiKey, deviceId, afterIso);
    stats.messagesScanned = messages.length;
    console.log(`[Backfill] ${messages.length} messages fetched. Processing...`);

    // 3. Process messages — upsert chats on the fly, store messages
    const chatCache = new Map<string, string>(); // externalChatId → internal DB id

    for (const msg of messages) {
      try {
        await this.processBackfillMessage(msg, groupNameMap, chatCache, stats);
      } catch (err) {
        console.error(`[Backfill] Error processing message:`, err);
        stats.errors++;
      }
    }

    stats.chatsScanned = chatCache.size;
    const durationMs = Date.now() - startedAt;
    console.log(`[Backfill] Done in ${durationMs}ms.`, stats);
    return { ...stats, durationMs };
  }

  // Fetch group name metadata from /v1/devices/{deviceId}/groups
  // Returns map of groupWid → name. Failures are non-fatal.
  private async fetchGroupNames(apiKey: string, deviceId: string): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    try {
      const url = `${WASSENGER_API}/devices/${deviceId}/groups`;
      console.log(`[Backfill] GET ${url}`);
      const res = await fetch(url, { headers: { Token: apiKey } });
      const rawText = await res.text();
      console.log(`[Backfill] groups → HTTP ${res.status}, count: ${rawText.slice(0, 120)}`);
      if (!res.ok) return map;
      const data = JSON.parse(rawText) as unknown;
      const rows = Array.isArray(data) ? data : [];
      for (const g of rows) {
        const rec = g as Record<string, unknown>;
        const gid = (rec['wid'] ?? rec['id'] ?? rec['_id']) as string | undefined;
        const name = rec['name'] as string | undefined;
        if (gid && name) map.set(gid, name);
      }
    } catch (err) {
      console.warn('[Backfill] fetchGroupNames failed (non-fatal):', err);
    }
    return map;
  }

  // Paginated fetch from /v1/messages?devices={deviceId}&createdAfter={iso}
  private async fetchAllMessages(
    apiKey: string,
    deviceId: string,
    afterIso: string,
  ): Promise<WassengerApiMessage[]> {
    const all: WassengerApiMessage[] = [];
    let page = 0;
    const SIZE = 100;

    while (true) {
      const url =
        `${WASSENGER_API}/messages` +
        `?devices=${deviceId}&createdAfter=${encodeURIComponent(afterIso)}` +
        `&page=${page}&size=${SIZE}`;

      console.log(`[Backfill] GET ${url}`);
      const res = await fetch(url, { headers: { Token: apiKey } });
      const rawText = await res.text();
      console.log(`[Backfill] messages page=${page} → HTTP ${res.status}, body[0..300]: ${rawText.slice(0, 300)}`);

      if (!res.ok) break;
      let data: unknown;
      try { data = JSON.parse(rawText); } catch { break; }

      // Response may be a root array OR { data: [...], total: N }
      let rows: WassengerApiMessage[];
      if (Array.isArray(data)) {
        rows = data as WassengerApiMessage[];
      } else if (data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>)['data'])) {
        rows = (data as Record<string, unknown>)['data'] as WassengerApiMessage[];
      } else {
        console.warn('[Backfill] Unexpected messages response shape:', JSON.stringify(data).slice(0, 200));
        break;
      }

      if (rows.length === 0) break;
      // Log first item on first page so we can see actual field names
      if (page === 0) {
        console.log('[Backfill] First message sample:', JSON.stringify(rows[0]).slice(0, 600));
      }
      all.push(...rows);
      if (rows.length < SIZE) break;
      page++;
    }
    return all;
  }

  // Upsert chat and store one message, derived entirely from the message object itself
  private async processBackfillMessage(
    msg: WassengerApiMessage,
    groupNameMap: Map<string, string>,
    chatCache: Map<string, string>,
    stats: BackfillStats,
  ): Promise<void> {
    if (msg.media?.url || msg.media?.filename) stats.mediaFound++;

    const raw = msg as Record<string, unknown>;

    // Diagnostic: log first 5 messages so we can see actual field names from the API
    if (stats.messagesScanned < 5) {
      console.log('[Backfill][diag] top-level keys:', Object.keys(raw).join(', '));
      console.log('[Backfill][diag] chat fields:', JSON.stringify(raw['chat']));
      console.log('[Backfill][diag] chatWid/chatId:', raw['chatWid'], '/', raw['chatId']);
      console.log('[Backfill][diag] from/to:', raw['from'], '/', raw['to']);
      console.log('[Backfill][diag] author:', raw['author']);
      console.log('[Backfill][diag] timestamp/date:', raw['timestamp'], '/', raw['date']);
      console.log('[Backfill][diag] wid/id/_id:', raw['wid'], '/', raw['id'], '/', raw['_id']);
      console.log('[Backfill][diag] flow/fromMe:', raw['flow'], '/', raw['fromMe']);
    }

    // Extract chat identity.
    // Priority: typed chatWid → chat sub-object → raw overrides → from/to fallback.
    // For group messages, msg.from == group@g.us == the chat ID.
    // For private outgoing, msg.to == contact@c.us == the chat ID.
    const isOutgoing =
      msg.flow === 'out' || (raw['fromMe'] as boolean | undefined) === true;

    // wid from the /v1/messages endpoint IS the chat JID (e.g. "972...@g.us" or "972...@c.us")
    const chatWid: string | null =
      (raw['wid'] as string | undefined) ??
      msg.chatWid ??
      msg.chat?.wid ??
      msg.chat?.id ??
      (raw['chatId'] as string | undefined) ??
      (raw['conversation'] as string | undefined) ??
      (isOutgoing
        ? ((raw['to'] as string | undefined) ?? null)
        : ((raw['from'] as string | undefined) ?? null)) ??
      null;

    if (!chatWid) {
      console.warn('[Backfill] no chat identifier found, skipping. Raw:', JSON.stringify(msg).slice(0, 300));
      stats.noChatSkipped++;
      return;
    }

    // Upsert chat (use cache to avoid DB round-trips for repeated chat IDs)
    let dbChatId = chatCache.get(chatWid);
    if (!dbChatId) {
      const isGroup = chatWid.endsWith('@g.us');
      const chatType = isGroup ? 'group' : 'private';
      const chatName =
        msg.chat?.name ??
        (isGroup ? groupNameMap.get(chatWid) : null) ??
        null;
      const senderPhone = extractSenderPhone(msg as unknown as WassengerData);

      const dbChat = await this.prisma.whatsAppChat.upsert({
        where: { externalChatId: chatWid },
        create: {
          externalChatId: chatWid,
          type: chatType,
          name: chatName,
          phoneNumber: chatType === 'private' ? senderPhone : null,
          lastMessageAt: msg.date ? new Date(msg.date) : null,
        },
        update: {
          ...(chatName ? { name: chatName } : {}),
          ...(msg.date ? { lastMessageAt: new Date(msg.date) } : {}),
        },
      });
      dbChatId = dbChat.id;
      chatCache.set(chatWid, dbChatId);
    }

    // Deduplicate by message ID — NOT wid (wid = chat JID, not message ID)
    const externalMsgId: string | null =
      (raw['id'] as string | undefined) ??
      (raw['_id'] as string | undefined) ??
      null;

    if (externalMsgId) {
      const exists = await this.prisma.whatsAppMessage.findUnique({
        where: { externalMessageId: externalMsgId },
        select: { id: true },
      });
      if (exists) { stats.duplicatesSkipped++; return; }
    }

    const direction = isOutgoing ? 'outgoing' : 'incoming';

    // timestamp: date (ISO), timestamp (unix seconds), createdAt (ISO)
    const msgTs =
      msg.date              ? new Date(msg.date) :
      msg.wid               ? new Date() :
      (raw['timestamp'] as number | undefined) ? new Date((raw['timestamp'] as number) * 1000) :
      (raw['createdAt'] as string | undefined)  ? new Date(raw['createdAt'] as string) :
      new Date();

    // type: kind, type (chat=text, ptt=audio)
    const msgType = normalizeMessageType(
      msg.kind ?? (raw['type'] as string | undefined),
    );

    const dataLike: WassengerData = {
      from:        msg.from        ?? (raw['from'] as string | undefined),
      author:      msg.author      ?? (raw['author'] as string | undefined),
      meta:        msg.meta        ?? (raw['meta'] as WassengerData['meta'] | undefined),
      contact:     msg.contact,
      fromContact: msg.fromContact,
      chat:        msg.chat ? { id: msg.chat.wid ?? msg.chat.id, name: msg.chat.name } : { id: chatWid },
    };

    await this.prisma.whatsAppMessage.create({
      data: {
        externalMessageId: externalMsgId ?? undefined,
        chatId: dbChatId,
        direction,
        senderName:  extractSenderName(dataLike),
        senderPhone: extractSenderPhone(dataLike),
        messageType: msgType,
        textContent: msg.body ?? (raw['body'] as string | undefined) ?? null,
        mediaUrl:    msg.media?.url ?? null,
        timestampFromSource: msgTs,
        rawPayload:  msg as object,
      },
    });
    stats.messagesImported++;
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
