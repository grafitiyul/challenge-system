'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { BASE_URL } from '@lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Participant {
  id: string;
  fullName: string;
  phoneNumber: string;
}

interface Group {
  id: string;
  name: string;
  challenge: { id: string; name: string };
  startDate: string;
  endDate: string;
  isActive: boolean;
  participantGroups: { participant: Participant }[];
}

interface WhatsAppChat {
  id: string;
  externalChatId: string;
  type: string;
  name: string | null;
  phoneNumber: string | null;
  lastMessageAt: string | null;
  messages?: { textContent: string | null; messageType: string }[];
}

interface ChatLink {
  id: string;
  groupId: string;
  whatsappChatId: string;
  linkType: 'group_chat' | 'private_participant_chat';
  participantId: string | null;
  whatsappChat: WhatsAppChat;
  participant: Participant | null;
  createdAt: string;
}

type FilterType = 'all' | 'group_chat' | 'private_participant_chat';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('he-IL');
}

function chatDisplayName(chat: WhatsAppChat): string {
  return chat.name ?? chat.phoneNumber ?? chat.externalChatId;
}

// ─── Link type labels ─────────────────────────────────────────────────────────

const LINK_TYPE_LABEL: Record<string, string> = {
  group_chat: 'קבוצת וואטסאפ',
  private_participant_chat: 'צ׳אט פרטי',
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function GroupDetailPage() {
  const { id } = useParams<{ id: string }>();

  const [group, setGroup] = useState<Group | null>(null);
  const [links, setLinks] = useState<ChatLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>('all');

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [availableChats, setAvailableChats] = useState<WhatsAppChat[]>([]);
  const [chatsLoading, setChatsLoading] = useState(false);
  const [selectedChatId, setSelectedChatId] = useState('');
  const [selectedLinkType, setSelectedLinkType] = useState<'group_chat' | 'private_participant_chat'>('group_chat');
  const [selectedParticipantId, setSelectedParticipantId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Initial load
  useEffect(() => {
    if (!id) return;
    Promise.all([
      fetch(`${BASE_URL}/groups/${id}`).then((r) => r.json()),
      fetch(`${BASE_URL}/groups/${id}/chat-links`).then((r) => r.json()),
    ])
      .then(([groupData, linksData]: [unknown, unknown]) => {
        setGroup(groupData as Group);
        setLinks(Array.isArray(linksData) ? (linksData as ChatLink[]) : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  // Load available chats when modal opens
  function openModal() {
    setModalOpen(true);
    setSelectedChatId('');
    setSelectedLinkType('group_chat');
    setSelectedParticipantId('');
    setSubmitError(null);
    if (availableChats.length > 0) return;
    setChatsLoading(true);
    fetch(`${BASE_URL}/wassenger/chats`)
      .then((r) => r.json())
      .then((data: unknown) => setAvailableChats(Array.isArray(data) ? (data as WhatsAppChat[]) : []))
      .catch(() => setAvailableChats([]))
      .finally(() => setChatsLoading(false));
  }

  async function submitLink() {
    if (!selectedChatId) { setSubmitError('בחר/י צ׳אט'); return; }
    if (selectedLinkType === 'private_participant_chat' && !selectedParticipantId) {
      setSubmitError('בחר/י משתתף/ת לצ׳אט פרטי');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const body: Record<string, string> = {
        whatsappChatId: selectedChatId,
        linkType: selectedLinkType,
      };
      if (selectedLinkType === 'private_participant_chat' && selectedParticipantId) {
        body['participantId'] = selectedParticipantId;
      }
      const res = await fetch(`${BASE_URL}/groups/${id}/chat-links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as Record<string, unknown>;
        throw new Error((err['message'] as string | undefined) ?? 'שגיאה בקישור');
      }
      const newLink = await res.json() as ChatLink;
      setLinks((prev) => [...prev, newLink]);
      setModalOpen(false);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'שגיאה');
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteLink(linkId: string) {
    if (!confirm('למחוק קישור זה?')) return;
    await fetch(`${BASE_URL}/groups/${id}/chat-links/${linkId}`, { method: 'DELETE' });
    setLinks((prev) => prev.filter((l) => l.id !== linkId));
  }

  // Filtered links
  const filteredLinks = links.filter((l) => filter === 'all' || l.linkType === filter);

  // Chats already linked (exclude from picker)
  const linkedChatIds = new Set(links.map((l) => l.whatsappChatId));
  const pickableChats = availableChats.filter((c) => !linkedChatIds.has(c.id));

  const participants = group?.participantGroups.map((pg) => pg.participant) ?? [];

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh', color: '#94a3b8' }}>
        טוען...
      </div>
    );
  }

  if (!group) {
    return (
      <div style={{ maxWidth: 600, margin: '60px auto', textAlign: 'center' }}>
        <p style={{ color: '#64748b' }}>הקבוצה לא נמצאה.</p>
        <Link href="/groups" style={{ color: '#2563eb', fontSize: 14 }}>← חזרה לרשימה</Link>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 840, margin: '0 auto', padding: '28px 20px' }}>

      {/* ── Back ── */}
      <Link href="/groups" style={{ color: '#64748b', fontSize: 14, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 20 }}>
        ← חזרה לקבוצות
      </Link>

      {/* ── Header ── */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', margin: 0 }}>{group.name}</h1>
          <span style={{
            background: group.isActive ? '#dcfce7' : '#f1f5f9',
            color: group.isActive ? '#16a34a' : '#64748b',
            padding: '2px 10px', borderRadius: 20, fontSize: 12, fontWeight: 500,
          }}>
            {group.isActive ? 'פעילה' : 'לא פעילה'}
          </span>
        </div>
        <p style={{ color: '#64748b', fontSize: 14, marginTop: 6, marginBottom: 0 }}>
          {group.challenge.name} · {formatDate(group.startDate)} – {formatDate(group.endDate)} · {participants.length} משתתפים
        </p>
      </div>

      {/* ── WhatsApp Section ── */}
      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>

        {/* Section header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid #e2e8f0', flexWrap: 'wrap', gap: 10,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 18 }}>💬</span>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0 }}>WhatsApp / צ׳אטים</h2>
            <span style={{ background: '#f1f5f9', color: '#64748b', padding: '1px 8px', borderRadius: 10, fontSize: 12 }}>
              {links.length}
            </span>
          </div>
          <button
            onClick={openModal}
            style={{
              background: '#2563eb', color: '#fff', border: 'none', borderRadius: 7,
              padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            + קשרי צ׳אט קיים
          </button>
        </div>

        {/* Filter tabs */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #e2e8f0', padding: '0 20px' }}>
          {([
            ['all', 'הכל'],
            ['group_chat', 'קבוצת וואטסאפ'],
            ['private_participant_chat', 'פרטיים'],
          ] as const).map(([val, label]) => (
            <button
              key={val}
              onClick={() => setFilter(val)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '10px 14px', fontSize: 13, fontWeight: filter === val ? 700 : 400,
                color: filter === val ? '#2563eb' : '#64748b',
                borderBottom: filter === val ? '2px solid #2563eb' : '2px solid transparent',
                marginBottom: -1,
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Links list */}
        {filteredLinks.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>📭</div>
            <p style={{ color: '#64748b', fontSize: 14, margin: 0 }}>
              {links.length === 0
                ? 'לא קושרו צ׳אטים עדיין. לחץ על "קשרי צ׳אט קיים" כדי להתחיל.'
                : 'אין צ׳אטים בקטגוריה זו.'}
            </p>
          </div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {filteredLinks.map((link, idx) => (
              <li
                key={link.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  padding: '14px 20px',
                  borderBottom: idx < filteredLinks.length - 1 ? '1px solid #f1f5f9' : 'none',
                }}
              >
                {/* Avatar */}
                <div style={{
                  width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
                  background: link.linkType === 'group_chat' ? '#dbeafe' : '#f0fdf4',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
                }}>
                  {link.linkType === 'group_chat' ? '👥' : '👤'}
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {chatDisplayName(link.whatsappChat)}
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                    <span style={{
                      background: link.linkType === 'group_chat' ? '#dbeafe' : '#f0fdf4',
                      color: link.linkType === 'group_chat' ? '#1d4ed8' : '#16a34a',
                      padding: '1px 7px', borderRadius: 8, fontWeight: 500, marginLeft: 6,
                    }}>
                      {LINK_TYPE_LABEL[link.linkType]}
                    </span>
                    {link.participant && (
                      <span style={{ color: '#94a3b8' }}>משתתף/ת: {link.participant.fullName}</span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <Link
                    href={`/chats/${link.whatsappChatId}`}
                    style={{ fontSize: 12, color: '#2563eb', padding: '4px 10px', border: '1px solid #bfdbfe', borderRadius: 6, textDecoration: 'none', whiteSpace: 'nowrap' }}
                  >
                    פתח ↗
                  </Link>
                  <button
                    onClick={() => deleteLink(link.id)}
                    style={{ fontSize: 12, color: '#ef4444', padding: '4px 10px', border: '1px solid #fecaca', borderRadius: 6, background: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    הסר
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Modal ── */}
      {modalOpen && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={(e) => { if (e.target === e.currentTarget) setModalOpen(false); }}
        >
          <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 480, padding: 28, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: '0 0 20px' }}>קשרי צ׳אט קיים</h3>

            {/* Chat picker */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                בחר/י צ׳אט
              </label>
              {chatsLoading ? (
                <p style={{ color: '#94a3b8', fontSize: 13 }}>טוען צ׳אטים...</p>
              ) : pickableChats.length === 0 ? (
                <p style={{ color: '#94a3b8', fontSize: 13 }}>
                  {availableChats.length === 0 ? 'אין צ׳אטים זמינים (הרץ backfill תחילה)' : 'כל הצ׳אטים כבר מקושרים לקבוצה זו.'}
                </p>
              ) : (
                <select
                  value={selectedChatId}
                  onChange={(e) => setSelectedChatId(e.target.value)}
                  style={{ width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 14, color: '#0f172a', background: '#fff' }}
                >
                  <option value="">-- בחר/י צ׳אט --</option>
                  {pickableChats.map((c) => (
                    <option key={c.id} value={c.id}>
                      {chatDisplayName(c)} ({c.type === 'group' ? 'קבוצה' : 'פרטי'})
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Link type */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 8 }}>
                סוג קישור
              </label>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {([
                  ['group_chat', '👥 קבוצת וואטסאפ'],
                  ['private_participant_chat', '👤 צ׳אט פרטי'],
                ] as const).map(([val, label]) => (
                  <label
                    key={val}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                      padding: '7px 12px', borderRadius: 8, border: '1px solid',
                      borderColor: selectedLinkType === val ? '#2563eb' : '#e2e8f0',
                      background: selectedLinkType === val ? '#eff6ff' : '#fff',
                      fontSize: 13, fontWeight: selectedLinkType === val ? 600 : 400,
                    }}
                  >
                    <input
                      type="radio"
                      name="linkType"
                      value={val}
                      checked={selectedLinkType === val}
                      onChange={() => { setSelectedLinkType(val); setSelectedParticipantId(''); }}
                      style={{ display: 'none' }}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            {/* Participant picker — only for private chats */}
            {selectedLinkType === 'private_participant_chat' && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                  משתתף/ת
                </label>
                {participants.length === 0 ? (
                  <p style={{ color: '#94a3b8', fontSize: 13 }}>אין משתתפים פעילים בקבוצה זו.</p>
                ) : (
                  <select
                    value={selectedParticipantId}
                    onChange={(e) => setSelectedParticipantId(e.target.value)}
                    style={{ width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 14, color: '#0f172a', background: '#fff' }}
                  >
                    <option value="">-- בחר/י משתתף/ת --</option>
                    {participants.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.fullName} · {p.phoneNumber}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {/* Error */}
            {submitError && (
              <p style={{ color: '#ef4444', fontSize: 13, marginBottom: 12 }}>{submitError}</p>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
              <button
                onClick={() => setModalOpen(false)}
                style={{ padding: '8px 18px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', fontSize: 14, cursor: 'pointer', color: '#374151' }}
              >
                ביטול
              </button>
              <button
                onClick={submitting ? undefined : submitLink}
                disabled={submitting}
                style={{
                  padding: '8px 18px', borderRadius: 7, border: 'none',
                  background: submitting ? '#93c5fd' : '#2563eb',
                  color: '#fff', fontSize: 14, fontWeight: 600, cursor: submitting ? 'default' : 'pointer',
                }}
              >
                {submitting ? 'שומר...' : 'קשרי'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
