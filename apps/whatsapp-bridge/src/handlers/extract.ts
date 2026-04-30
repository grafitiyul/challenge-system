// Pure helpers for turning a Baileys WAMessage into the columns we
// store on WhatsAppMessage. No I/O, no Prisma — keeps the message
// handler easy to reason about.
//
// Logging policy: this module is content-aware. The CALLER must not
// log anything returned from here at info/warn level (textContent and
// mediaInfo.fileName can contain message contents).

import type { WAMessage, WAMessageContent } from '@whiskeysockets/baileys';

export type WaMessageType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'sticker'
  | 'system';

export interface ExtractedContent {
  messageType: WaMessageType;
  textContent: string | null;
  // Present for image/video/audio/document/sticker. The handler uses
  // this to decide whether to call downloadMediaMessage.
  mediaInfo: {
    type: 'image' | 'video' | 'audio' | 'document' | 'sticker';
    mimeType: string | null;
    fileName: string | null;
    sizeBytes: number | null;
    // The extension we'll suffix onto the storage key. Falls back to
    // 'bin' if we can't infer one from mime/filename.
    extension: string;
  } | null;
  quotedExternalId: string | null;
  // True for messages we should silently drop (Baileys protocol
  // chatter, ephemeral receipts, etc) — not the same as 'system'
  // which IS stored.
  skip: boolean;
}

const EXT_BY_TYPE: Record<string, string> = {
  // Common WhatsApp mime types → extension. Falls back to splitting
  // the mime if not in the table.
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'video/quicktime': 'mov',
  'audio/ogg': 'ogg',
  'audio/ogg; codecs=opus': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'application/pdf': 'pdf',
};

function extensionFor(mime: string | null | undefined, fileName: string | null | undefined): string {
  if (mime && EXT_BY_TYPE[mime]) return EXT_BY_TYPE[mime];
  if (mime) {
    const after = mime.split(';')[0]?.split('/')[1];
    if (after) return after.replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin';
  }
  if (fileName) {
    const dot = fileName.lastIndexOf('.');
    if (dot > 0 && dot < fileName.length - 1) {
      return fileName.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin';
    }
  }
  return 'bin';
}

export function extractContent(msg: WAMessage): ExtractedContent {
  const m = msg.message;
  if (!m) {
    return { messageType: 'system', textContent: null, mediaInfo: null, quotedExternalId: null, skip: true };
  }

  // Some messages are wrapped in ephemeralMessage / viewOnceMessage
  // / viewOnceMessageV2 envelopes — Baileys doesn't auto-unwrap
  // these for the typed accessors. Unwrap once so the type
  // discrimination below works.
  const unwrapped = unwrapEnvelope(m);

  if (unwrapped.protocolMessage) {
    return { messageType: 'system', textContent: null, mediaInfo: null, quotedExternalId: null, skip: true };
  }
  if (unwrapped.reactionMessage) {
    // Reactions are delivered as their own messages.reaction event
    // too; if we see one in messages.upsert we skip — the dedicated
    // handler is the source of truth.
    return { messageType: 'system', textContent: null, mediaInfo: null, quotedExternalId: null, skip: true };
  }

  // ── text ──────────────────────────────────────────────────────────
  if (typeof unwrapped.conversation === 'string' && unwrapped.conversation.length > 0) {
    return {
      messageType: 'text',
      textContent: unwrapped.conversation,
      mediaInfo: null,
      quotedExternalId: null,
      skip: false,
    };
  }
  if (unwrapped.extendedTextMessage) {
    const ext = unwrapped.extendedTextMessage;
    return {
      messageType: 'text',
      textContent: ext.text ?? null,
      mediaInfo: null,
      quotedExternalId: ext.contextInfo?.stanzaId ?? null,
      skip: false,
    };
  }

  // ── media ─────────────────────────────────────────────────────────
  if (unwrapped.imageMessage) {
    const im = unwrapped.imageMessage;
    return {
      messageType: 'image',
      textContent: im.caption ?? null,
      mediaInfo: {
        type: 'image',
        mimeType: im.mimetype ?? null,
        fileName: null,
        sizeBytes: im.fileLength ? Number(im.fileLength) : null,
        extension: extensionFor(im.mimetype, null),
      },
      quotedExternalId: im.contextInfo?.stanzaId ?? null,
      skip: false,
    };
  }
  if (unwrapped.videoMessage) {
    const vm = unwrapped.videoMessage;
    return {
      messageType: 'video',
      textContent: vm.caption ?? null,
      mediaInfo: {
        type: 'video',
        mimeType: vm.mimetype ?? null,
        fileName: null,
        sizeBytes: vm.fileLength ? Number(vm.fileLength) : null,
        extension: extensionFor(vm.mimetype, null),
      },
      quotedExternalId: vm.contextInfo?.stanzaId ?? null,
      skip: false,
    };
  }
  if (unwrapped.audioMessage) {
    const am = unwrapped.audioMessage;
    return {
      messageType: 'audio',
      textContent: null,
      mediaInfo: {
        type: 'audio',
        mimeType: am.mimetype ?? 'audio/ogg',
        fileName: null,
        sizeBytes: am.fileLength ? Number(am.fileLength) : null,
        extension: extensionFor(am.mimetype, null),
      },
      quotedExternalId: am.contextInfo?.stanzaId ?? null,
      skip: false,
    };
  }
  if (unwrapped.documentMessage) {
    const dm = unwrapped.documentMessage;
    return {
      messageType: 'document',
      textContent: dm.caption ?? null,
      mediaInfo: {
        type: 'document',
        mimeType: dm.mimetype ?? null,
        fileName: dm.fileName ?? null,
        sizeBytes: dm.fileLength ? Number(dm.fileLength) : null,
        extension: extensionFor(dm.mimetype, dm.fileName),
      },
      quotedExternalId: dm.contextInfo?.stanzaId ?? null,
      skip: false,
    };
  }
  if (unwrapped.stickerMessage) {
    const sm = unwrapped.stickerMessage;
    return {
      messageType: 'sticker',
      textContent: null,
      mediaInfo: {
        type: 'sticker',
        mimeType: sm.mimetype ?? 'image/webp',
        fileName: null,
        sizeBytes: sm.fileLength ? Number(sm.fileLength) : null,
        extension: 'webp',
      },
      quotedExternalId: sm.contextInfo?.stanzaId ?? null,
      skip: false,
    };
  }

  // Unknown shape — store as system row with no content. We keep the
  // row so the audit-trail is complete; sanitised rawPayload tells
  // the operator what type it actually was.
  return {
    messageType: 'system',
    textContent: null,
    mediaInfo: null,
    quotedExternalId: null,
    skip: false,
  };
}

function unwrapEnvelope(content: WAMessageContent): WAMessageContent {
  if (content.ephemeralMessage?.message) {
    return content.ephemeralMessage.message;
  }
  if (content.viewOnceMessage?.message) {
    return content.viewOnceMessage.message;
  }
  if (content.viewOnceMessageV2?.message) {
    return content.viewOnceMessageV2.message;
  }
  if (content.viewOnceMessageV2Extension?.message) {
    return content.viewOnceMessageV2Extension.message;
  }
  return content;
}

// Strip raw binary buffers from the WAMessage so the rawPayload column
// stays small + JSON-safe. The signal/encryption keys (mediaKey,
// fileEncSha256, etc.) are not useful for the audit archive — replace
// them with size markers. Pure JSON in/out.
export function sanitiseRawPayload(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, val) => {
      if (val instanceof Uint8Array) return `[binary:${val.length}b]`;
      // Long.js values (Baileys uses Long for some 64-bit timestamps);
      // their toJSON returns a string, so this path is just for the
      // raw type guard.
      if (val && typeof val === 'object' && 'low' in val && 'high' in val && 'unsigned' in val) {
        return Number(val as { toString(): string }).toString();
      }
      return val;
    }),
  );
}

// Derive a phone number string from a JID like "972501234567@s.whatsapp.net"
// or "972501234567:1@s.whatsapp.net". For group messages the
// participant JID is the same shape. Returns null for malformed input.
export function jidToPhone(jid: string | null | undefined): string | null {
  if (!jid) return null;
  const at = jid.indexOf('@');
  const before = at >= 0 ? jid.slice(0, at) : jid;
  const colon = before.indexOf(':');
  const phone = colon >= 0 ? before.slice(0, colon) : before;
  return /^\d+$/.test(phone) ? phone : null;
}

export function isGroupJid(jid: string): boolean {
  return jid.endsWith('@g.us');
}
