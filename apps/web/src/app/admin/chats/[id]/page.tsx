'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { BASE_URL, apiFetch } from '@lib/api';
import { ChatMessage, ChatMessageList } from '@components/chat-messages';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Chat {
  id: string;
  externalChatId: string;
  type: string;
  name: string | null;
  phoneNumber: string | null;
  messages: ChatMessage[];
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
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (chat && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chat]);

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
        <Link href="/admin/chats" style={{ color: '#2563eb', fontSize: 14 }}>← חזרה לרשימה</Link>
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
        <Link href="/admin/chats" style={{ color: '#64748b', textDecoration: 'none', fontSize: 20, lineHeight: 1 }}>←</Link>
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
      <ChatMessageList
        messages={chat.messages}
        chatType={chat.type}
        bottomRef={bottomRef}
      />

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
