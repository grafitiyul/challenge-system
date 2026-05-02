// messages.upsert + messages.reaction + messaging-history.set handlers.
//
// All three converge on the same upsert path keyed by externalMessageId
// (= WAMessage.key.id), so dedup is automatic — Baileys can deliver
// the same message via the live event AND via history sync after a
// reconnect, and the second arrival is a no-op.
//
// Logging policy (strict): we never log textContent, captions, or
// media bytes. Allowed log fields: msgId, chatId (jid), mediaType,
// status string, summarised error message.

import {
  downloadMediaMessage,
  WAMessage,
  WASocket,
  proto,
} from '@whiskeysockets/baileys';
import type { Logger } from 'pino';
import type { PrismaClient } from '@prisma/client';
import { connState } from '../baileys/connection-state';
import { MediaStorage } from '../media/storage';
import {
  ExtractedContent,
  extractContent,
  isGroupJid,
  jidToPhone,
  sanitiseRawPayload,
} from './extract';

export interface IngestServices {
  prisma: PrismaClient;
  socket: WASocket;
  storage: MediaStorage;
  log: Logger;
}

// Top-level entry for messages.upsert. Iterates safely; one message's
// failure doesn't poison the rest of the batch.
export async function handleMessagesUpsert(
  services: IngestServices,
  payload: { type: 'notify' | 'append' | 'replace' | 'last'; messages: WAMessage[] },
): Promise<void> {
  for (const msg of payload.messages) {
    try {
      await ingestMessage(services, msg, payload.type);
    } catch (err) {
      services.log.error(
        {
          err: errSummary(err),
          msgId: msg.key?.id ?? null,
          chatId: msg.key?.remoteJid ?? null,
          batchType: payload.type,
        },
        'message ingest failed',
      );
    }
  }
}

// Top-level entry for messaging-history.set (post-reconnect history
// dump). Same upsert path; idempotent via externalMessageId @unique.
export async function handleHistorySync(
  services: IngestServices,
  history: { messages?: WAMessage[]; chats?: unknown[]; isLatest?: boolean },
): Promise<void> {
  const messages = history.messages ?? [];
  if (messages.length === 0) return;
  services.log.info(
    { count: messages.length, isLatest: history.isLatest },
    'history sync: ingesting messages',
  );
  for (const msg of messages) {
    try {
      await ingestMessage(services, msg, 'history');
    } catch (err) {
      services.log.error(
        {
          err: errSummary(err),
          msgId: msg.key?.id ?? null,
          chatId: msg.key?.remoteJid ?? null,
        },
        'history-sync ingest failed',
      );
    }
  }
}

// Top-level entry for messages.reaction. Reactions reference the
// target message by externalMessageId; we upsert the (target, reactor)
// pair. Empty emoji = removal; we keep the row with emoji=''.
export async function handleReactions(
  services: IngestServices,
  reactions: proto.IReaction[],
): Promise<void> {
  for (const r of reactions) {
    try {
      await ingestReaction(services, r);
    } catch (err) {
      services.log.error(
        {
          err: errSummary(err),
          targetMsgId: r.key?.id ?? null,
        },
        'reaction ingest failed',
      );
    }
  }
}

// ─── single-message ingest ──────────────────────────────────────────

async function ingestMessage(
  services: IngestServices,
  msg: WAMessage,
  source: 'notify' | 'append' | 'replace' | 'last' | 'history',
): Promise<void> {
  const { prisma, socket, storage, log } = services;

  if (!msg.key?.id || !msg.key?.remoteJid) return;
  const externalMessageId = msg.key.id;
  const externalChatId = msg.key.remoteJid;

  const content = extractContent(msg);
  if (content.skip) return;

  // Idempotency short-circuit. Reading from the unique index is
  // O(log N); cheaper than building the full upsert payload (which
  // includes a media download for media messages) just to discard it.
  const existing = await prisma.whatsAppMessage.findUnique({
    where: { externalMessageId },
    select: { id: true },
  });
  if (existing) {
    log.debug({ msgId: externalMessageId, source }, 'message already ingested; skipping');
    return;
  }

  // ── chat upsert ──
  const isGroup = isGroupJid(externalChatId);
  const direction = msg.key.fromMe ? 'outgoing' : 'incoming';
  const senderJid = msg.key.fromMe
    ? socket.user?.id ?? null
    : (msg.key.participant ?? msg.key.remoteJid);
  const senderPhone = jidToPhone(senderJid);
  const senderName = msg.pushName ?? null;
  const timestampSec = typeof msg.messageTimestamp === 'number'
    ? msg.messageTimestamp
    : Number(msg.messageTimestamp ?? 0);
  const timestampFromSource = new Date(timestampSec * 1000);

  const chat = await upsertChat(services, externalChatId, isGroup, senderName, senderPhone, timestampFromSource);

  // ── media download (if applicable) ──
  let mediaUrl: string | null = null;
  let mediaSizeBytes: number | null = null;
  let mediaMimeType: string | null = content.mediaInfo?.mimeType ?? null;
  let mediaOriginalName: string | null = content.mediaInfo?.fileName ?? null;

  if (content.mediaInfo && storage.kind !== 'disabled') {
    try {
      const buffer = await downloadAsBuffer(socket, msg, log);
      const key = buildMediaKey(externalChatId, externalMessageId, content.mediaInfo.extension, timestampFromSource);
      const result = await storage.store({
        key,
        mimeType: content.mediaInfo.mimeType ?? 'application/octet-stream',
        data: buffer,
      });
      mediaUrl = result.url;
      mediaSizeBytes = result.size;
      log.info(
        {
          msgId: externalMessageId,
          chatId: externalChatId,
          mediaType: content.mediaInfo.type,
          sizeBytes: result.size,
          backend: storage.kind,
        },
        'media stored',
      );
      // Clear any prior error since the most recent attempt succeeded.
      await connState.clearMediaError(prisma);
    } catch (err) {
      const summary = errSummary(err);
      log.warn(
        {
          msgId: externalMessageId,
          chatId: externalChatId,
          mediaType: content.mediaInfo.type,
          err: summary,
        },
        'media download/store failed',
      );
      await connState.setMediaError(prisma, `${content.mediaInfo.type}: ${summary}`);
      // We still create the message row — text/caption/sender info is
      // independent of the media payload. mediaUrl stays null so the
      // admin UI can show the row with a "media missing" placeholder.
    }
  }

  // ── message upsert ──
  await prisma.whatsAppMessage.create({
    data: {
      externalMessageId,
      chatId: chat.id,
      direction,
      senderName,
      senderPhone,
      messageType: content.messageType,
      textContent: content.textContent,
      mediaUrl,
      mediaMimeType,
      mediaSizeBytes,
      mediaOriginalName,
      quotedExternalId: content.quotedExternalId,
      timestampFromSource,
      rawPayload: sanitiseRawPayload(msg) as never,
      provider: 'baileys',
    },
  });

  await prisma.whatsAppChat.update({
    where: { id: chat.id },
    data: { lastMessageAt: timestampFromSource },
  });

  await connState.heartbeat(prisma);
}

// Upsert a chat by externalChatId. For groups we lazily fetch the
// subject from socket.groupMetadata the first time we see the chat;
// subsequent messages reuse the cached name.
async function upsertChat(
  services: IngestServices,
  externalChatId: string,
  isGroup: boolean,
  senderName: string | null,
  senderPhone: string | null,
  lastMessageAt: Date,
): Promise<{ id: string; name: string | null }> {
  const { prisma, socket, log } = services;

  const existing = await prisma.whatsAppChat.findUnique({
    where: { externalChatId },
    select: { id: true, name: true },
  });

  // Resolve a display name only if we don't have one yet. For private
  // chats we use the sender's pushName as a friendly default; for
  // groups we ask Baileys for the subject (one network call per
  // first-encountered group).
  let resolvedName = existing?.name ?? null;
  if (!resolvedName) {
    if (isGroup) {
      try {
        const meta = await socket.groupMetadata(externalChatId);
        resolvedName = meta.subject ?? null;
      } catch (err) {
        log.warn(
          { chatId: externalChatId, err: errSummary(err) },
          'groupMetadata fetch failed; chat name left null',
        );
      }
    } else {
      resolvedName = senderName;
    }
  }

  if (existing) {
    return existing;
  }

  // Capture the WhatsApp profile / group picture URL on first-create
  // so the admin link-chat modal can render real avatars instead of
  // generated initial bubbles. Bounded by a 5s timeout — Baileys'
  // call is a synchronous protocol query, and a hung WhatsApp server
  // shouldn't block message ingest. Failures (no permission, group
  // has no picture, transient error) are logged at debug-level and
  // we fall back to null; the frontend treats null as "use the
  // initial bubble". Only run for newly-created chats — never re-fetch
  // for existing rows (would amplify ingest cost on every inbound).
  const profilePictureUrl = await fetchProfilePictureSafe(socket, externalChatId, log);

  return prisma.whatsAppChat.create({
    data: {
      externalChatId,
      type: isGroup ? 'group' : 'private',
      name: resolvedName,
      phoneNumber: isGroup ? null : senderPhone,
      profilePictureUrl,
      lastMessageAt,
      provider: 'baileys',
    },
    select: { id: true, name: true },
  });
}

// Best-effort wrapper around socket.profilePictureUrl. Always
// resolves — never throws — so callers don't need their own
// try/catch. WhatsApp returns 401/403 for contacts that have
// restricted profile-picture privacy; we treat that as "no
// picture" identically to "no picture set".
async function fetchProfilePictureSafe(
  socket: IngestServices['socket'],
  jid: string,
  log: IngestServices['log'],
): Promise<string | null> {
  const FETCH_TIMEOUT_MS = 5_000;
  let timer: NodeJS.Timeout | null = null;
  try {
    const probe = socket.profilePictureUrl(jid, 'image');
    // Suppress late rejection — if the timeout wins, the underlying
    // promise's eventual rejection is irrelevant to this caller.
    probe.catch(() => undefined);
    const result = await Promise.race([
      probe,
      new Promise<null>((res) => {
        timer = setTimeout(() => res(null), FETCH_TIMEOUT_MS);
      }),
    ]);
    if (typeof result === 'string' && result) return result;
    return null;
  } catch (err) {
    log.debug(
      { jid, err: errSummary(err) },
      'profilePictureUrl fetch failed; falling back to no picture',
    );
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ─── reaction ingest ────────────────────────────────────────────────

async function ingestReaction(
  services: IngestServices,
  r: proto.IReaction,
): Promise<void> {
  const { prisma } = services;
  const targetId = r.key?.id;
  if (!targetId) return;
  const reactorJid = r.key?.participant ?? r.key?.remoteJid ?? null;
  const reactorPhone = jidToPhone(reactorJid);
  if (!reactorPhone) return;
  const emoji = r.text ?? '';
  const reactedAt = r.senderTimestampMs
    ? new Date(Number(r.senderTimestampMs))
    : new Date();

  await prisma.whatsAppMessageReaction.upsert({
    where: {
      externalMessageId_reactorPhone: {
        externalMessageId: targetId,
        reactorPhone,
      },
    },
    create: {
      externalMessageId: targetId,
      reactorPhone,
      reactorName: null,
      emoji,
      reactedAt,
    },
    update: {
      emoji,
      reactedAt,
    },
  });
}

// ─── helpers ────────────────────────────────────────────────────────

async function downloadAsBuffer(
  socket: WASocket,
  msg: WAMessage,
  log: Logger,
): Promise<Buffer> {
  // downloadMediaMessage handles WhatsApp's media decryption; the
  // 'reuploadRequest' path covers stale URLs by asking Baileys to
  // request a fresh reference from WhatsApp before retrying.
  return (await downloadMediaMessage(
    msg,
    'buffer',
    {},
    {
      logger: log as never,
      reuploadRequest: socket.updateMediaMessage,
    },
  )) as Buffer;
}

function buildMediaKey(
  chatJid: string,
  messageId: string,
  extension: string,
  ts: Date,
): string {
  // Chat JID may contain @g.us / @s.whatsapp.net — neutralise to keep
  // the storage key URL-safe.
  const safeChat = chatJid.replace(/[^a-z0-9_-]/gi, '_');
  const safeId = messageId.replace(/[^A-Za-z0-9_-]/g, '_');
  const yyyy = ts.getUTCFullYear();
  const mm = String(ts.getUTCMonth() + 1).padStart(2, '0');
  return `whatsapp/${yyyy}/${mm}/${safeChat}/${safeId}.${extension}`;
}

function errSummary(err: unknown): string {
  if (err instanceof Error) {
    // Take only the first line; downstream logs / DB columns shouldn't
    // get a multi-screen stack trace.
    return err.message.split('\n')[0]?.slice(0, 240) ?? 'unknown';
  }
  return String(err).slice(0, 240);
}
