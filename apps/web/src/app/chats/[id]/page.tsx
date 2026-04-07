'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { BASE_URL, apiFetch } from '@lib/api';

// ─── Types ───────────────────────────────────────────────────────────────────

interface RawPayloadData {
  author?: string;
  from?: string;
  meta?: { notifyName?: string };
  contact?: { name?: string; phone?: string };
  media?: { url?: string; filename?: string; mimetype?: string; size?: number };
}

interface Message {
  id: string;
  direction: string | null;
  senderName: string | null;
  senderPhone: string | null;
  messageType: string;
  textContent: string | null;
  mediaUrl: string | null;
  timestampFromSource: string;
  rawPayload: { data?: RawPayloadData } | null;
}

interface Chat {
  id: string;
  externalChatId: string;
  type: string;
  name: string | null;
  phoneNumber: string | null;
  messages: Message[];
}

// ─── Identity helpers ─────────────────────────────────────────────────────────

// Strip @c.us / @s.whatsapp.net / @g.us suffixes
function cleanPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return raw.replace(/@(c\.us|s\.whatsapp\.net|g\.us)$/i, '').trim() || null;
}

// A real phone has 7–15 digits. WhatsApp group IDs are 18+ digits — reject them.
function isLikelyPhone(s: string): boolean {
  const digits = s.replace(/[+\-\s()]/g, '');
  return /^\d{7,15}$/.test(digits);
}

// Derive sender label from stored fields + rawPayload fallback (fixes old rows too)
function resolveSenderLabel(msg: Message): string {
  // Name: stored senderName is reliable (from meta.notifyName)
  const name = msg.senderName?.trim() || null;

  // Phone: prefer rawPayload.data.author (actual sender in group chats) > stored senderPhone
  const rawAuthor = cleanPhone(msg.rawPayload?.data?.author);
  const storedPhone = msg.senderPhone?.trim() || null;
  const phone = (() => {
    if (rawAuthor && isLikelyPhone(rawAuthor)) return rawAuthor;
    if (storedPhone && isLikelyPhone(storedPhone)) return storedPhone;
    return null;
  })();

  if (name && phone) return `${name} · ${phone}`;
  if (name) return name;
  if (phone) return phone;
  return 'Unknown';
}

// ─── Text rendering ───────────────────────────────────────────────────────────

const URL_RE = /https?:\/\/[^\s\n]+/g;

function TextWithLinks({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  const re = new RegExp(URL_RE.source, 'g');
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const url = match[0];
    parts.push(
      <a
        key={match.index}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: '#1d4ed8', textDecoration: 'underline', wordBreak: 'break-all' }}
      >
        {url}
      </a>,
    );
    lastIndex = match.index + url.length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));

  return (
    <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5 }}>
      {parts}
    </span>
  );
}

// ─── Media card ───────────────────────────────────────────────────────────────

const MEDIA_META: Record<string, { icon: string; label: string }> = {
  image:    { icon: '🖼',  label: 'תמונה' },
  video:    { icon: '🎬', label: 'וידאו' },
  audio:    { icon: '🎵', label: 'הקלטה קולית' },
  document: { icon: '📄', label: 'מסמך' },
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function MediaCard({ msg }: { msg: Message }) {
  const meta = MEDIA_META[msg.messageType] ?? { icon: '📎', label: msg.messageType };
  const url = msg.mediaUrl ?? msg.rawPayload?.data?.media?.url ?? null;
  const filename = msg.rawPayload?.data?.media?.filename ?? null;
  const mimetype = msg.rawPayload?.data?.media?.mimetype ?? null;
  const size = msg.rawPayload?.data?.media?.size ?? null;

  // For images: try to show an inline preview
  const isImage = msg.messageType === 'image' || mimetype?.startsWith('image/');

  return (
    <div
      style={{
        background: 'rgba(0,0,0,0.04)',
        borderRadius: 8,
        padding: '8px 10px',
        minWidth: 180,
      }}
    >
      {isImage && url && (
        <a href={url} target="_blank" rel="noopener noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={filename ?? 'תמונה'}
            style={{ maxWidth: '100%', maxHeight: 220, borderRadius: 6, display: 'block', marginBottom: 6 }}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
        </a>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 20 }}>{meta.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
            {filename ?? meta.label}
          </div>
          {(mimetype || size != null) && (
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>
              {[mimetype, size != null ? formatBytes(size) : null].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: 12,
              color: '#2563eb',
              textDecoration: 'none',
              padding: '3px 8px',
              border: '1px solid #bfdbfe',
              borderRadius: 5,
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            פתח ↗
          </a>
        ) : (
          <span style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic', flexShrink: 0 }}>
            אין קישור
          </span>
        )}
      </div>

      {/* Caption text below media */}
      {msg.textContent && (
        <p style={{ fontSize: 13, color: '#374151', margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>
          {msg.textContent}
        </p>
      )}
    </div>
  );
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatMsgTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}

function formatMsgDate(iso: string): string {
  return new Date(iso).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ChatDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [chat, setChat] = useState<Chat | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;
    apiFetch(`${BASE_URL}/wassenger/chats/${id}`)
      .then((data: unknown) => { setChat(data as Chat); })
      .catch((err: unknown) => {
        if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 404) {
          setNotFound(true);
        } else {
          setNotFound(true);
        }
      })
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (chat && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chat]);

  // Group consecutive messages by calendar date
  const grouped: { date: string; messages: Message[] }[] = [];
  if (chat) {
    for (const msg of chat.messages) {
      const dateKey = formatMsgDate(msg.timestampFromSource);
      const last = grouped[grouped.length - 1];
      if (!last || last.date !== dateKey) {
        grouped.push({ date: dateKey, messages: [msg] });
      } else {
        last.messages.push(msg);
      }
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh', color: '#94a3b8' }}>
        טוען שיחה...
      </div>
    );
  }

  if (notFound || !chat) {
    return (
      <div style={{ maxWidth: 600, margin: '60px auto', textAlign: 'center' }}>
        <p style={{ color: '#64748b' }}>השיחה לא נמצאה.</p>
        <Link href="/chats" style={{ color: '#2563eb', fontSize: 14 }}>← חזרה לרשימה</Link>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', maxWidth: 720, margin: '0 auto' }}>

      {/* ── Header ── */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: '#fff', borderBottom: '1px solid #e2e8f0',
        padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
      }}>
        <Link href="/chats" style={{ color: '#64748b', textDecoration: 'none', fontSize: 20, lineHeight: 1 }}>←</Link>
        <div style={{
          width: 40, height: 40, borderRadius: '50%',
          background: chat.type === 'group' ? '#dbeafe' : '#f0fdf4',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0,
        }}>
          {chat.type === 'group' ? '👥' : '👤'}
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>
            {chat.name ?? chat.phoneNumber ?? chat.externalChatId}
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>
            {chat.type === 'group' ? 'קבוצה' : 'שיחה פרטית'} · {chat.messages.length} הודעות
          </div>
        </div>
      </div>

      {/* ── Messages ── */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '16px 12px',
        background: '#e5ddd5', display: 'flex', flexDirection: 'column', gap: 2,
      }}>
        {chat.messages.length === 0 && (
          <div style={{ textAlign: 'center', color: '#94a3b8', marginTop: 40, fontSize: 14 }}>
            אין הודעות בשיחה זו עדיין.
          </div>
        )}

        {grouped.map(({ date, messages }) => (
          <div key={date}>
            {/* Date separator */}
            <div style={{ display: 'flex', justifyContent: 'center', margin: '10px 0 8px' }}>
              <span style={{ background: 'rgba(255,255,255,0.8)', padding: '3px 14px', borderRadius: 12, fontSize: 12, color: '#64748b', fontWeight: 500 }}>
                {date}
              </span>
            </div>

            {messages.map((msg) => {
              const isOutgoing = msg.direction === 'outgoing';
              const isMedia = ['image', 'audio', 'video', 'document'].includes(msg.messageType);

              return (
                <div
                  key={msg.id}
                  style={{ display: 'flex', justifyContent: isOutgoing ? 'flex-end' : 'flex-start', marginBottom: 4 }}
                >
                  <div style={{
                    maxWidth: '72%',
                    background: isOutgoing ? '#dcf8c6' : '#ffffff',
                    borderRadius: isOutgoing ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                    padding: '7px 11px 5px',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.12)',
                  }}>

                    {/* Sender identity — group incoming messages only */}
                    {chat.type === 'group' && !isOutgoing && (
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#7c3aed', marginBottom: 4 }}>
                        {resolveSenderLabel(msg)}
                      </div>
                    )}

                    {/* Text */}
                    {msg.messageType === 'text' && msg.textContent && (
                      <p style={{ fontSize: 14, color: '#0f172a', margin: 0 }}>
                        <TextWithLinks text={msg.textContent} />
                      </p>
                    )}

                    {/* System message */}
                    {msg.messageType === 'system' && (
                      <p style={{ fontSize: 13, color: '#94a3b8', fontStyle: 'italic', margin: 0 }}>
                        {msg.textContent ?? 'הודעת מערכת'}
                      </p>
                    )}

                    {/* Media */}
                    {isMedia && <MediaCard msg={msg} />}

                    {/* Unknown type fallback */}
                    {!['text', 'system', 'image', 'video', 'audio', 'document'].includes(msg.messageType) && (
                      <p style={{ fontSize: 13, color: '#94a3b8', fontStyle: 'italic', margin: 0 }}>
                        [{msg.messageType}] {msg.textContent ?? ''}
                      </p>
                    )}

                    {/* Timestamp */}
                    <div style={{ textAlign: 'left', marginTop: 4 }}>
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>
                        {isOutgoing && <span style={{ marginLeft: 4 }}>✓</span>}
                        {formatMsgTime(msg.timestampFromSource)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        <div ref={bottomRef} />
      </div>

      {/* ── Footer ── */}
      <div style={{
        flexShrink: 0, background: '#f0f0f0', borderTop: '1px solid #e2e8f0',
        padding: '10px 16px', textAlign: 'center', color: '#94a3b8', fontSize: 13,
      }}>
        שליחת הודעות תהיה זמינה בקרוב
      </div>
    </div>
  );
}
