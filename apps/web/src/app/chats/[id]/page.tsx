'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { BASE_URL } from '@lib/api';

interface Message {
  id: string;
  direction: string | null;
  senderName: string | null;
  senderPhone: string | null;
  messageType: string;
  textContent: string | null;
  mediaUrl: string | null;
  timestampFromSource: string;
}

interface Chat {
  id: string;
  externalChatId: string;
  type: string;
  name: string | null;
  phoneNumber: string | null;
  messages: Message[];
}

function formatMsgTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}

function formatMsgDate(iso: string): string {
  return new Date(iso).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
}

function MediaPlaceholder({ type, url }: { type: string; url: string | null }) {
  const label: Record<string, string> = {
    image: '🖼 תמונה',
    audio: '🎵 הקלטה קולית',
    video: '🎬 וידאו',
    document: '📄 מסמך',
  };
  if (url) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', fontSize: 13 }}>
        {label[type] ?? type} ↗
      </a>
    );
  }
  return <span style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: 13 }}>{label[type] ?? type}</span>;
}

export default function ChatDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [chat, setChat] = useState<Chat | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;
    fetch(`${BASE_URL}/wassenger/chats/${id}`)
      .then((r) => {
        if (r.status === 404) { setNotFound(true); return null; }
        return r.json();
      })
      .then((data: unknown) => {
        if (data) setChat(data as Chat);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  // Scroll to bottom once messages load
  useEffect(() => {
    if (chat && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chat]);

  // Group messages by date for date separators
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
        position: 'sticky',
        top: 0,
        zIndex: 10,
        background: '#fff',
        borderBottom: '1px solid #e2e8f0',
        padding: '12px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexShrink: 0,
      }}>
        <Link href="/chats" style={{ color: '#64748b', textDecoration: 'none', fontSize: 20, lineHeight: 1 }}>
          ←
        </Link>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: chat.type === 'group' ? '#dbeafe' : '#f0fdf4',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 18,
            flexShrink: 0,
          }}
        >
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
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px 12px',
          background: '#e5ddd5',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        {chat.messages.length === 0 && (
          <div style={{ textAlign: 'center', color: '#94a3b8', marginTop: 40, fontSize: 14 }}>
            אין הודעות בשיחה זו עדיין.
          </div>
        )}

        {grouped.map(({ date, messages }) => (
          <div key={date}>
            {/* Date separator */}
            <div style={{ display: 'flex', justifyContent: 'center', margin: '10px 0 8px' }}>
              <span style={{ background: 'rgba(255,255,255,0.75)', padding: '3px 12px', borderRadius: 12, fontSize: 12, color: '#64748b', fontWeight: 500 }}>
                {date}
              </span>
            </div>

            {messages.map((msg) => {
              const isOutgoing = msg.direction === 'outgoing';
              return (
                <div
                  key={msg.id}
                  style={{
                    display: 'flex',
                    justifyContent: isOutgoing ? 'flex-end' : 'flex-start',
                    marginBottom: 4,
                  }}
                >
                  <div
                    style={{
                      maxWidth: '72%',
                      background: isOutgoing ? '#dcf8c6' : '#ffffff',
                      borderRadius: isOutgoing ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                      padding: '7px 11px 5px',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.12)',
                      position: 'relative',
                    }}
                  >
                    {/* Sender name (group chats, incoming only) */}
                    {chat.type === 'group' && !isOutgoing && msg.senderName && (
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#7c3aed', marginBottom: 3 }}>
                        {msg.senderName}
                      </div>
                    )}

                    {/* Content */}
                    {msg.messageType === 'text' && (
                      <p style={{ fontSize: 14, color: '#0f172a', margin: 0, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {msg.textContent ?? ''}
                      </p>
                    )}
                    {msg.messageType === 'system' && (
                      <p style={{ fontSize: 13, color: '#94a3b8', fontStyle: 'italic', margin: 0 }}>
                        {msg.textContent ?? 'הודעת מערכת'}
                      </p>
                    )}
                    {['image', 'audio', 'video', 'document'].includes(msg.messageType) && (
                      <div style={{ marginBottom: 2 }}>
                        <MediaPlaceholder type={msg.messageType} url={msg.mediaUrl} />
                        {msg.textContent && (
                          <p style={{ fontSize: 13, color: '#374151', margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>
                            {msg.textContent}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Timestamp */}
                    <div style={{ textAlign: 'left', marginTop: 3 }}>
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>
                        {formatMsgTime(msg.timestampFromSource)}
                        {isOutgoing && <span style={{ marginRight: 4 }}>✓</span>}
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

      {/* ── Footer placeholder (no sending yet) ── */}
      <div style={{
        flexShrink: 0,
        background: '#f0f0f0',
        borderTop: '1px solid #e2e8f0',
        padding: '10px 16px',
        textAlign: 'center',
        color: '#94a3b8',
        fontSize: 13,
      }}>
        שליחת הודעות תהיה זמינה בקרוב
      </div>
    </div>
  );
}
