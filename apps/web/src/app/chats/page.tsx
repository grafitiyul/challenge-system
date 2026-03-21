'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BASE_URL } from '@lib/api';

interface LastMessage {
  textContent: string | null;
  messageType: string;
  direction: string | null;
  timestampFromSource: string;
}

interface Chat {
  id: string;
  externalChatId: string;
  type: string;
  name: string | null;
  phoneNumber: string | null;
  lastMessageAt: string | null;
  messages: LastMessage[];
}

function formatTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'אתמול';
  if (diffDays < 7) return d.toLocaleDateString('he-IL', { weekday: 'short' });
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });
}

function messagePreview(msg: LastMessage | undefined): string {
  if (!msg) return '';
  if (msg.messageType === 'text') return msg.textContent ?? '';
  const icons: Record<string, string> = {
    image: '🖼 תמונה',
    audio: '🎵 הקלטה',
    video: '🎬 וידאו',
    document: '📄 מסמך',
    system: '⚙️ הודעת מערכת',
  };
  return icons[msg.messageType] ?? msg.messageType;
}

export default function ChatsPage() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch(`${BASE_URL}/wassenger/chats`)
      .then((r) => r.json())
      .then((data: unknown) => setChats(Array.isArray(data) ? (data as Chat[]) : []))
      .catch(() => setChats([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = chats.filter((c) => {
    const q = search.toLowerCase();
    return (
      (c.name ?? '').toLowerCase().includes(q) ||
      (c.phoneNumber ?? '').includes(q) ||
      (c.externalChatId ?? '').toLowerCase().includes(q)
    );
  });

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '28px 20px' }}>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', margin: 0 }}>
          צ׳אטים
        </h1>
        {!loading && (
          <p style={{ color: '#64748b', fontSize: 14, marginTop: 4, marginBottom: 0 }}>
            {chats.length} שיחות פעילות
          </p>
        )}
      </div>

      <input
        style={{ width: '100%', padding: '9px 14px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14, marginBottom: 16, background: '#fff', color: '#0f172a', boxSizing: 'border-box' }}
        placeholder="חיפוש לפי שם או טלפון..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
        {loading && (
          <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8' }}>טוען שיחות...</div>
        )}

        {!loading && filtered.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>💬</div>
            <p style={{ color: '#64748b', fontSize: 14, margin: 0 }}>
              {search ? 'לא נמצאו שיחות.' : 'אין שיחות עדיין. ממתין לwehooks מ-Wassenger.'}
            </p>
          </div>
        )}

        {filtered.map((chat, idx) => {
          const lastMsg = chat.messages[0];
          const preview = messagePreview(lastMsg);
          return (
            <Link
              key={chat.id}
              href={`/chats/${chat.id}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: '14px 18px',
                borderBottom: idx < filtered.length - 1 ? '1px solid #f1f5f9' : 'none',
                textDecoration: 'none',
                color: 'inherit',
                background: 'transparent',
              }}
            >
              {/* Avatar */}
              <div
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: '50%',
                  background: chat.type === 'group' ? '#dbeafe' : '#f0fdf4',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 20,
                  flexShrink: 0,
                }}
              >
                {chat.type === 'group' ? '👥' : '👤'}
              </div>

              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 14, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {chat.name ?? chat.phoneNumber ?? chat.externalChatId}
                  </span>
                  <span style={{ fontSize: 12, color: '#94a3b8', flexShrink: 0 }}>
                    {formatTime(chat.lastMessageAt)}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 3 }}>
                  <span style={{ fontSize: 13, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {preview || <span style={{ color: '#cbd5e1', fontStyle: 'italic' }}>אין הודעות</span>}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      padding: '2px 8px',
                      borderRadius: 10,
                      marginRight: 8,
                      background: chat.type === 'group' ? '#dbeafe' : '#f0fdf4',
                      color: chat.type === 'group' ? '#1d4ed8' : '#16a34a',
                      fontWeight: 500,
                      flexShrink: 0,
                    }}
                  >
                    {chat.type === 'group' ? 'קבוצה' : 'פרטי'}
                  </span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
