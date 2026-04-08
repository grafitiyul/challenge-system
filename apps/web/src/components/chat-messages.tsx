'use client';

import React from 'react';

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface RawPayloadData {
  author?: string;
  from?: string;
  meta?: { notifyName?: string };
  contact?: { name?: string; phone?: string };
  media?: { url?: string; filename?: string; mimetype?: string; size?: number };
}

export interface ChatMessage {
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

// ─── Identity helpers ─────────────────────────────────────────────────────────

function cleanPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return raw.replace(/@(c\.us|s\.whatsapp\.net|g\.us)$/i, '').trim() || null;
}

function isLikelyPhone(s: string): boolean {
  const digits = s.replace(/[+\-\s()]/g, '');
  return /^\d{7,15}$/.test(digits);
}

export function resolveSenderLabel(msg: ChatMessage): string {
  const name = msg.senderName?.trim() || null;
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

// ─── Formatters ───────────────────────────────────────────────────────────────

export function formatMsgTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}

export function formatMsgDate(iso: string): string {
  return new Date(iso).toLocaleDateString('he-IL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

// ─── Text rendering ───────────────────────────────────────────────────────────

const URL_RE = /https?:\/\/[^\s\n]+/g;

function TextWithLinks({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  const re = new RegExp(URL_RE.source, 'g');
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
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

function MediaCard({ msg }: { msg: ChatMessage }) {
  const meta = MEDIA_META[msg.messageType] ?? { icon: '📎', label: msg.messageType };
  const url = msg.mediaUrl ?? msg.rawPayload?.data?.media?.url ?? null;
  const filename = msg.rawPayload?.data?.media?.filename ?? null;
  const mimetype = msg.rawPayload?.data?.media?.mimetype ?? null;
  const size = msg.rawPayload?.data?.media?.size ?? null;
  const isImage = msg.messageType === 'image' || mimetype?.startsWith('image/');

  return (
    <div style={{ background: 'rgba(0,0,0,0.04)', borderRadius: 8, padding: '8px 10px', minWidth: 180 }}>
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
          <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{filename ?? meta.label}</div>
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
              fontSize: 12, color: '#2563eb', textDecoration: 'none',
              padding: '3px 8px', border: '1px solid #bfdbfe', borderRadius: 5,
              whiteSpace: 'nowrap', flexShrink: 0,
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
      {msg.textContent && (
        <p style={{ fontSize: 13, color: '#374151', margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>
          {msg.textContent}
        </p>
      )}
    </div>
  );
}

// ─── ChatMessageList ──────────────────────────────────────────────────────────

interface ChatMessageListProps {
  messages: ChatMessage[];
  chatType: string;
  bottomRef?: React.RefObject<HTMLDivElement | null>;
  /** Container style overrides — defaults to WhatsApp-style scrolling pane */
  containerStyle?: React.CSSProperties;
}

export function ChatMessageList({
  messages,
  chatType,
  bottomRef,
  containerStyle,
}: ChatMessageListProps) {
  // Group consecutive messages by calendar date
  const grouped: { date: string; messages: ChatMessage[] }[] = [];
  for (const msg of messages) {
    const dateKey = formatMsgDate(msg.timestampFromSource);
    const last = grouped[grouped.length - 1];
    if (!last || last.date !== dateKey) {
      grouped.push({ date: dateKey, messages: [msg] });
    } else {
      last.messages.push(msg);
    }
  }

  const defaultContainerStyle: React.CSSProperties = {
    flex: 1,
    overflowY: 'auto',
    padding: '16px 12px',
    background: '#e5ddd5',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  };

  return (
    <div style={{ ...defaultContainerStyle, ...containerStyle }}>
      {messages.length === 0 && (
        <div style={{ textAlign: 'center', color: '#94a3b8', marginTop: 40, fontSize: 14 }}>
          אין הודעות בשיחה זו עדיין.
        </div>
      )}

      {grouped.map(({ date, messages: dayMsgs }) => (
        <div key={date}>
          {/* Date separator */}
          <div style={{ display: 'flex', justifyContent: 'center', margin: '10px 0 8px' }}>
            <span style={{
              background: 'rgba(255,255,255,0.8)',
              padding: '3px 14px',
              borderRadius: 12,
              fontSize: 12,
              color: '#64748b',
              fontWeight: 500,
            }}>
              {date}
            </span>
          </div>

          {dayMsgs.map((msg) => {
            const isOutgoing = msg.direction === 'outgoing';
            const isMedia = ['image', 'audio', 'video', 'document'].includes(msg.messageType);

            return (
              <div
                key={msg.id}
                style={{
                  display: 'flex',
                  justifyContent: isOutgoing ? 'flex-end' : 'flex-start',
                  marginBottom: 4,
                }}
              >
                <div style={{
                  maxWidth: '72%',
                  background: isOutgoing ? '#dcf8c6' : '#ffffff',
                  borderRadius: isOutgoing ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                  padding: '7px 11px 5px',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.12)',
                }}>
                  {/* Sender label — group incoming only */}
                  {chatType === 'group' && !isOutgoing && (
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#7c3aed', marginBottom: 4 }}>
                      {resolveSenderLabel(msg)}
                    </div>
                  )}

                  {msg.messageType === 'text' && msg.textContent && (
                    <p style={{ fontSize: 14, color: '#0f172a', margin: 0 }}>
                      <TextWithLinks text={msg.textContent} />
                    </p>
                  )}

                  {msg.messageType === 'system' && (
                    <p style={{ fontSize: 13, color: '#94a3b8', fontStyle: 'italic', margin: 0 }}>
                      {msg.textContent ?? 'הודעת מערכת'}
                    </p>
                  )}

                  {isMedia && <MediaCard msg={msg} />}

                  {!['text', 'system', 'image', 'video', 'audio', 'document'].includes(msg.messageType) && (
                    <p style={{ fontSize: 13, color: '#94a3b8', fontStyle: 'italic', margin: 0 }}>
                      [{msg.messageType}] {msg.textContent ?? ''}
                    </p>
                  )}

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

      {bottomRef && <div ref={bottomRef} />}
    </div>
  );
}
