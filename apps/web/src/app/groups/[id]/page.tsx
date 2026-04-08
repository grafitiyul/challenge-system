'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { BASE_URL, apiFetch } from '@lib/api';
import WhatsAppEditor from '@/components/whatsapp-editor';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Participant {
  id: string;
  firstName: string;
  lastName?: string | null;
  phoneNumber: string;
}

interface ParticipantGroupRow {
  id: string;
  participantId: string;
  accessToken: string | null;
  participant: Participant;
}

interface Group {
  id: string;
  name: string;
  isActive: boolean;
  programId: string | null;
  program: { id: string; name: string; isActive: boolean } | null;
  startDate: string | null;
  endDate: string | null;
  challenge: { id: string; name: string };
  participantGroups: ParticipantGroupRow[];
}

interface ExternalLink {
  id: string;
  internalName: string;
  slugOrToken: string;
  isActive: boolean;
}

interface QTemplate {
  id: string;
  internalName: string;
  publicTitle: string;
  externalLinks: ExternalLink[];
}

interface WhatsAppChat {
  id: string;
  externalChatId: string;
  type: string;
  name: string | null;
  phoneNumber: string | null;
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

// ─── Chat tab types (inlined from chats page) ────────────────────────────────

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

interface ChatDetail {
  id: string;
  externalChatId: string;
  type: string;
  name: string | null;
  phoneNumber: string | null;
  messages: Message[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function displayName(p: { firstName: string; lastName?: string | null }): string {
  return [p.firstName, p.lastName].filter(Boolean).join(' ');
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' });
}

function chatDisplayName(chat: WhatsAppChat): string {
  return chat.name ?? chat.phoneNumber ?? chat.externalChatId;
}

// ─── Chat rendering helpers (ported from chats/[id]/page.tsx) ────────────────

function cleanPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return raw.replace(/@(c\.us|s\.whatsapp\.net|g\.us)$/i, '').trim() || null;
}

function isLikelyPhone(s: string): boolean {
  const digits = s.replace(/[+\-\s()]/g, '');
  return /^\d{7,15}$/.test(digits);
}

function resolveSenderLabel(msg: Message): string {
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
      <a key={match.index} href={url} target="_blank" rel="noopener noreferrer"
        style={{ color: '#1d4ed8', textDecoration: 'underline', wordBreak: 'break-all' }}>
        {url}
      </a>,
    );
    lastIndex = match.index + url.length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5 }}>{parts}</span>;
}

const MEDIA_META: Record<string, { icon: string; label: string }> = {
  image: { icon: '🖼', label: 'תמונה' },
  video: { icon: '🎬', label: 'וידאו' },
  audio: { icon: '🎵', label: 'הקלטה קולית' },
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
  const isImage = msg.messageType === 'image' || mimetype?.startsWith('image/');
  return (
    <div style={{ background: 'rgba(0,0,0,0.04)', borderRadius: 8, padding: '8px 10px', minWidth: 180 }}>
      {isImage && url && (
        <a href={url} target="_blank" rel="noopener noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={filename ?? 'תמונה'}
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
          <a href={url} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 12, color: '#2563eb', textDecoration: 'none', padding: '3px 8px', border: '1px solid #bfdbfe', borderRadius: 5, whiteSpace: 'nowrap', flexShrink: 0 }}>
            פתח ↗
          </a>
        ) : (
          <span style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic', flexShrink: 0 }}>אין קישור</span>
        )}
      </div>
      {msg.textContent && (
        <p style={{ fontSize: 13, color: '#374151', margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{msg.textContent}</p>
      )}
    </div>
  );
}

function formatMsgTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}

function formatMsgDate(iso: string): string {
  return new Date(iso).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type Tab = 'details' | 'chat';

export default function GroupDetailPage() {
  const { id } = useParams<{ id: string }>();

  // Core data
  const [group, setGroup] = useState<Group | null>(null);
  const [links, setLinks] = useState<ChatLink[]>([]);
  const [questionnaires, setQuestionnaires] = useState<QTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  // Tab
  const [tab, setTab] = useState<Tab>('details');

  // Chat tab
  const [chatDetail, setChatDetail] = useState<ChatDetail | null>(null);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Group message modal
  const [msgModalOpen, setMsgModalOpen] = useState(false);
  const [msgText, setMsgText] = useState('');
  const [msgSending, setMsgSending] = useState(false);
  const [msgError, setMsgError] = useState('');
  const [msgSuccess, setMsgSuccess] = useState(false);

  // Add participant modal
  const [addParticipantOpen, setAddParticipantOpen] = useState(false);
  const [allParticipants, setAllParticipants] = useState<Participant[]>([]);
  const [participantSearch, setParticipantSearch] = useState('');
  const [addingParticipantId, setAddingParticipantId] = useState('');
  const [participantsLoading, setParticipantsLoading] = useState(false);

  // Remove participant
  const [removingParticipantId, setRemovingParticipantId] = useState<string | null>(null);

  // Link chat modal
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [availableChats, setAvailableChats] = useState<WhatsAppChat[]>([]);
  const [chatsLoading, setChatsLoading] = useState(false);
  const [selectedChatId, setSelectedChatId] = useState('');
  const [selectedLinkType, setSelectedLinkType] = useState<'group_chat' | 'private_participant_chat'>('group_chat');
  const [selectedParticipantId, setSelectedParticipantId] = useState('');
  const [linkSubmitting, setLinkSubmitting] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  // Token generation
  const [generatingTokenFor, setGeneratingTokenFor] = useState<string | null>(null);

  // Copy feedback
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // ─── Initial load ──────────────────────────────────────────────────────────

  const loadGroup = useCallback(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      apiFetch<Group>(`${BASE_URL}/groups/${id}`, { cache: 'no-store' }),
      apiFetch<ChatLink[]>(`${BASE_URL}/groups/${id}/chat-links`, { cache: 'no-store' }),
      apiFetch<QTemplate[]>(`${BASE_URL}/groups/${id}/questionnaires`, { cache: 'no-store' }),
    ])
      .then(([groupData, linksData, qData]) => {
        setGroup(groupData);
        setLinks(Array.isArray(linksData) ? linksData : []);
        setQuestionnaires(Array.isArray(qData) ? qData : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { loadGroup(); }, [loadGroup]);

  // ─── Chat tab: load when switching to chat tab ────────────────────────────

  useEffect(() => {
    if (tab !== 'chat') return;
    const groupChatLink = links.find((l) => l.linkType === 'group_chat');
    if (!groupChatLink) return;
    setChatLoading(true);
    setChatError(false);
    apiFetch<ChatDetail>(`${BASE_URL}/wassenger/chats/${groupChatLink.whatsappChatId}`)
      .then((data) => setChatDetail(data))
      .catch(() => setChatError(true))
      .finally(() => setChatLoading(false));
  }, [tab, links]);

  useEffect(() => {
    if (tab === 'chat' && chatDetail && chatBottomRef.current) {
      chatBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [tab, chatDetail]);

  // ─── Copy helper ──────────────────────────────────────────────────────────

  function copyText(text: string, feedbackId: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(feedbackId);
      setTimeout(() => setCopiedId(null), 1800);
    });
  }

  function getAccessUrl(token: string): string {
    return `${window.location.origin}/t/${token}`;
  }

  // ─── Group message ─────────────────────────────────────────────────────────

  const groupChatLink = links.find((l) => l.linkType === 'group_chat');

  async function sendGroupMessage() {
    if (!msgText.trim()) return;
    if (!groupChatLink) { setMsgError('לא קושרה קבוצת וואטסאפ'); return; }
    setMsgSending(true);
    setMsgError('');
    try {
      await apiFetch(`${BASE_URL}/wassenger/send`, {
        method: 'POST',
        body: JSON.stringify({ phone: groupChatLink.whatsappChat.externalChatId, message: msgText.trim() }),
      });
      setMsgSuccess(true);
      setMsgText('');
      setTimeout(() => { setMsgSuccess(false); setMsgModalOpen(false); }, 1800);
    } catch (err) {
      const msg = typeof err === 'object' && err !== null && 'message' in err
        ? String((err as { message: string }).message) : 'שגיאה בשליחה';
      setMsgError(msg);
    } finally {
      setMsgSending(false);
    }
  }

  // ─── Add participant ───────────────────────────────────────────────────────

  function openAddParticipant() {
    setAddParticipantOpen(true);
    setParticipantSearch('');
    if (allParticipants.length > 0) return;
    setParticipantsLoading(true);
    apiFetch<Participant[]>(`${BASE_URL}/participants`)
      .then((data) => setAllParticipants(Array.isArray(data) ? data : []))
      .catch(() => setAllParticipants([]))
      .finally(() => setParticipantsLoading(false));
  }

  async function addParticipant(participantId: string) {
    if (addingParticipantId) return;
    setAddingParticipantId(participantId);
    try {
      await apiFetch(`${BASE_URL}/groups/${id}/participants`, {
        method: 'POST',
        body: JSON.stringify({ participantId }),
      });
      setAddParticipantOpen(false);
      loadGroup();
    } catch (err) {
      const msg = typeof err === 'object' && err !== null && 'message' in err
        ? String((err as { message: string }).message) : 'שגיאה';
      alert(msg);
    } finally {
      setAddingParticipantId('');
    }
  }

  // ─── Remove participant ────────────────────────────────────────────────────

  async function removeParticipant(participantId: string, name: string) {
    if (!confirm(`להסיר את ${name} מהקבוצה?`)) return;
    setRemovingParticipantId(participantId);
    try {
      await apiFetch(`${BASE_URL}/groups/${id}/participants/${participantId}`, { method: 'DELETE' });
      setGroup((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          participantGroups: prev.participantGroups.filter((pg) => pg.participantId !== participantId),
        };
      });
    } catch { /* ignore */ } finally {
      setRemovingParticipantId(null);
    }
  }

  // ─── Token generation ──────────────────────────────────────────────────────

  async function generateToken(participantId: string, groupId: string) {
    setGeneratingTokenFor(participantId);
    try {
      const res = await apiFetch<{ token: string }>(
        `${BASE_URL}/participants/${participantId}/groups/${groupId}/token`,
        { method: 'POST' },
      );
      setGroup((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          participantGroups: prev.participantGroups.map((pg) =>
            pg.participantId === participantId ? { ...pg, accessToken: res.token } : pg,
          ),
        };
      });
    } catch { /* ignore */ } finally {
      setGeneratingTokenFor(null);
    }
  }

  // ─── Link chat modal ───────────────────────────────────────────────────────

  function openLinkModal() {
    setLinkModalOpen(true);
    setSelectedChatId('');
    setSelectedLinkType('group_chat');
    setSelectedParticipantId('');
    setLinkError(null);
    if (availableChats.length > 0) return;
    setChatsLoading(true);
    apiFetch<WhatsAppChat[]>(`${BASE_URL}/wassenger/chats`)
      .then((data) => setAvailableChats(Array.isArray(data) ? data : []))
      .catch(() => setAvailableChats([]))
      .finally(() => setChatsLoading(false));
  }

  async function submitLink() {
    if (!selectedChatId) { setLinkError('בחר/י צ׳אט'); return; }
    if (selectedLinkType === 'private_participant_chat' && !selectedParticipantId) {
      setLinkError('בחר/י משתתף/ת לצ׳אט פרטי');
      return;
    }
    setLinkSubmitting(true);
    setLinkError(null);
    try {
      const body: Record<string, string> = { whatsappChatId: selectedChatId, linkType: selectedLinkType };
      if (selectedLinkType === 'private_participant_chat' && selectedParticipantId) {
        body['participantId'] = selectedParticipantId;
      }
      const newLink = await apiFetch<ChatLink>(`${BASE_URL}/groups/${id}/chat-links`, {
        method: 'POST', body: JSON.stringify(body),
      });
      setLinks((prev) => [...prev, newLink]);
      setLinkModalOpen(false);
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'שגיאה');
    } finally {
      setLinkSubmitting(false);
    }
  }

  async function deleteLink(linkId: string) {
    if (!confirm('למחוק קישור זה?')) return;
    await apiFetch(`${BASE_URL}/groups/${id}/chat-links/${linkId}`, { method: 'DELETE' });
    setLinks((prev) => prev.filter((l) => l.id !== linkId));
  }

  // ─── Derived ──────────────────────────────────────────────────────────────

  const participants = group?.participantGroups ?? [];
  const inGroupIds = new Set(participants.map((pg) => pg.participantId));
  const linkedChatIds = new Set(links.map((l) => l.whatsappChatId));
  const pickableChats = availableChats.filter((c) => !linkedChatIds.has(c.id));

  const searchTerm = participantSearch.trim().toLowerCase();
  const filteredAll = allParticipants.filter((p) => {
    if (inGroupIds.has(p.id)) return false;
    if (!searchTerm) return true;
    return (
      p.firstName.toLowerCase().includes(searchTerm) ||
      (p.lastName ?? '').toLowerCase().includes(searchTerm) ||
      p.phoneNumber.includes(searchTerm)
    );
  });

  const privateChatByParticipant = new Map<string, ChatLink>(
    links.filter((l) => l.linkType === 'private_participant_chat' && l.participantId)
      .map((l) => [l.participantId!, l]),
  );

  // Group chat messages by date
  const chatGrouped: { date: string; messages: Message[] }[] = [];
  if (chatDetail) {
    for (const msg of chatDetail.messages) {
      const dateKey = formatMsgDate(msg.timestampFromSource);
      const last = chatGrouped[chatGrouped.length - 1];
      if (!last || last.date !== dateKey) {
        chatGrouped.push({ date: dateKey, messages: [msg] });
      } else {
        last.messages.push(msg);
      }
    }
  }

  // ─── Loading / not found ───────────────────────────────────────────────────

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

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 20px' }}>

      {/* ── Back ── */}
      <Link href="/groups" style={{ color: '#64748b', fontSize: 14, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 20 }}>
        ← חזרה לקבוצות
      </Link>

      {/* ══════════════════════════════════════════════════════════════════════
          HEADER
      ══════════════════════════════════════════════════════════════════════ */}
      <div style={{
        background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14,
        padding: '20px 24px', marginBottom: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          {/* Left: identity */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
              <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0f172a', margin: 0, letterSpacing: '-0.3px' }}>{group.name}</h1>
              <span style={{
                background: group.isActive ? '#dcfce7' : '#f1f5f9',
                color: group.isActive ? '#16a34a' : '#64748b',
                padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600,
              }}>
                {group.isActive ? 'פעילה' : 'לא פעילה'}
              </span>
              {group.program && (
                <Link href={`/programs/${group.program.id}`} style={{ textDecoration: 'none' }}>
                  <span style={{
                    background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe',
                    padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                  }}>
                    ⚡ {group.program.name}
                  </span>
                </Link>
              )}
            </div>
            <p style={{ color: '#64748b', fontSize: 13, margin: 0 }}>
              {group.challenge.name}
              {(group.startDate || group.endDate) && (
                <> · {formatDate(group.startDate)} – {formatDate(group.endDate)}</>
              )}
              {' · '}
              <strong style={{ color: '#0f172a' }}>{participants.length}</strong> משתתפות
            </p>
          </div>

          {/* Right: primary actions */}
          <div style={{ display: 'flex', gap: 10, flexShrink: 0, flexWrap: 'wrap' }}>
            <button
              onClick={() => { setMsgModalOpen(true); setMsgText(''); setMsgError(''); setMsgSuccess(false); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: groupChatLink ? '#16a34a' : '#94a3b8',
                color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px',
                fontSize: 13, fontWeight: 600, cursor: groupChatLink ? 'pointer' : 'not-allowed',
              }}
              title={groupChatLink ? undefined : 'אין קבוצת וואטסאפ מקושרת'}
            >
              <span>💬</span> הודעה לקבוצה
            </button>
            <button
              onClick={openLinkModal}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: '#fff', color: '#374151', border: '1px solid #d1d5db',
                borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              <span>🔗</span> קשרי צ׳אט
            </button>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          TABS
      ══════════════════════════════════════════════════════════════════════ */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '2px solid #e2e8f0', paddingBottom: 0 }}>
        {([
          ['details', 'הגדרות ופרטים'],
          ['chat', 'צ׳אט קבוצתי'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: '10px 20px', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600,
              background: 'none', borderBottom: tab === key ? '2px solid #2563eb' : '2px solid transparent',
              color: tab === key ? '#2563eb' : '#64748b',
              marginBottom: -2,
            }}
          >
            {label}
            {key === 'chat' && !groupChatLink && (
              <span style={{ marginRight: 6, fontSize: 11, color: '#94a3b8', fontWeight: 400 }}>(אין קישור)</span>
            )}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: DETAILS
      ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'details' && (
        <>
          {/* ── Section: linked program ── */}
          <Section title="תוכנית משויכת" icon="⚡">
            {group.program ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 15, color: '#0f172a' }}>{group.program.name}</div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                    {group.program.isActive ? 'פעילה' : 'לא פעילה'}
                  </div>
                </div>
                <Link href={`/programs/${group.program.id}`}
                  style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid #bfdbfe', color: '#1d4ed8', fontSize: 13, fontWeight: 500, textDecoration: 'none', background: '#eff6ff' }}>
                  פתח תוכנית ↗
                </Link>
              </div>
            ) : (
              <p style={{ color: '#94a3b8', fontSize: 14, margin: 0 }}>לא שויכה תוכנית לקבוצה זו.</p>
            )}
          </Section>

          {/* ── Section: questionnaires ── */}
          <Section title="שאלונים רלוונטיים" icon="📋" count={questionnaires.length}>
            {!group.programId ? (
              <p style={{ color: '#94a3b8', fontSize: 14, margin: 0 }}>שייכי תוכנית לקבוצה כדי לראות שאלונים רלוונטיים.</p>
            ) : questionnaires.length === 0 ? (
              <p style={{ color: '#94a3b8', fontSize: 14, margin: 0 }}>
                אין שאלונים משויכים לתוכנית זו. שייכי שאלון לתוכנית <strong>{group.program?.name}</strong> בעורך השאלון.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {questionnaires.map((q, idx) => (
                  <div key={q.id} style={{ padding: '13px 0', borderBottom: idx < questionnaires.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 14, color: '#0f172a' }}>{q.internalName}</div>
                        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{q.publicTitle}</div>
                      </div>
                      <Link href={`/questionnaires/${q.id}`}
                        style={{ fontSize: 12, color: '#6b7280', padding: '3px 8px', flexShrink: 0, textDecoration: 'none' }}>
                        ערוך ↗
                      </Link>
                    </div>
                    {q.externalLinks.length > 0 && (
                      <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {q.externalLinks.map((link) => (
                          <div key={link.id} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '5px 10px', fontSize: 12 }}>
                            <span style={{ color: '#374151' }}>{link.internalName}</span>
                            <button
                              onClick={() => copyText(`${window.location.origin}/fill/${link.slugOrToken}`, `link-${link.id}`)}
                              style={{
                                background: copiedId === `link-${link.id}` ? '#dcfce7' : '#eff6ff',
                                color: copiedId === `link-${link.id}` ? '#16a34a' : '#1d4ed8',
                                border: 'none', borderRadius: 5, padding: '2px 8px',
                                fontSize: 11, cursor: 'pointer', fontWeight: 600,
                              }}
                            >
                              {copiedId === `link-${link.id}` ? '✓ הועתק' : 'העתק קישור'}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    {q.externalLinks.length === 0 && (
                      <div style={{ marginTop: 6, fontSize: 12, color: '#94a3b8' }}>
                        אין לינקים חיצוניים — <Link href={`/questionnaires/${q.id}`} style={{ color: '#1d4ed8' }}>צור לינק בעורך</Link>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* ── Section: participants ── */}
          <Section
            title="משתתפות"
            icon="👥"
            count={participants.length}
            action={
              <button
                onClick={openAddParticipant}
                style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 7, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
              >
                + הוסף משתתפת
              </button>
            }
          >
            {participants.length === 0 ? (
              <p style={{ color: '#94a3b8', fontSize: 14, margin: 0 }}>
                אין משתתפות בקבוצה זו. לחצי &ldquo;+ הוסף משתתפת&rdquo; כדי להתחיל.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {participants.map((pg, idx) => {
                  const p = pg.participant;
                  const privateChat = privateChatByParticipant.get(p.id);
                  const hasToken = !!pg.accessToken;
                  const isRemoving = removingParticipantId === p.id;

                  return (
                    <div
                      key={pg.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0',
                        borderBottom: idx < participants.length - 1 ? '1px solid #f1f5f9' : 'none',
                        opacity: isRemoving ? 0.5 : 1,
                      }}
                    >
                      {/* Avatar */}
                      <div style={{
                        width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                        background: '#eff6ff', color: '#1d4ed8', display: 'flex',
                        alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14,
                      }}>
                        {p.firstName.charAt(0)}
                      </div>

                      {/* Name + phone */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Link href={`/participants/${p.id}`}
                          style={{ fontWeight: 600, fontSize: 14, color: '#0f172a', textDecoration: 'none' }}>
                          {displayName(p)}
                        </Link>
                        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 1, direction: 'ltr', textAlign: 'right' }}>
                          {p.phoneNumber}
                        </div>
                      </div>

                      {/* Actions */}
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {/* Personal chat button */}
                        {privateChat ? (
                          <Link href={`/chats/${privateChat.whatsappChatId}`}
                            style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #bbf7d0', color: '#16a34a', fontSize: 12, fontWeight: 500, textDecoration: 'none', background: '#f0fdf4', display: 'flex', alignItems: 'center', gap: 4 }}>
                            💬 צ׳אט
                          </Link>
                        ) : (
                          <a href={`https://wa.me/${p.phoneNumber.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer"
                            style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #d1fae5', color: '#059669', fontSize: 12, fontWeight: 500, textDecoration: 'none', background: '#f0fdf4', display: 'flex', alignItems: 'center', gap: 4 }}
                            title="פתח בוואטסאפ">
                            WA
                          </a>
                        )}

                        {/* Access link */}
                        {hasToken ? (
                          <button
                            onClick={() => copyText(getAccessUrl(pg.accessToken!), `token-${pg.id}`)}
                            style={{
                              padding: '5px 10px', borderRadius: 6,
                              border: `1px solid ${copiedId === `token-${pg.id}` ? '#bbf7d0' : '#bfdbfe'}`,
                              color: copiedId === `token-${pg.id}` ? '#16a34a' : '#1d4ed8',
                              background: copiedId === `token-${pg.id}` ? '#f0fdf4' : '#eff6ff',
                              fontSize: 12, fontWeight: 500, cursor: 'pointer',
                            }}
                          >
                            {copiedId === `token-${pg.id}` ? '✓ הועתק' : '🔗 קישור אישי'}
                          </button>
                        ) : (
                          <button
                            onClick={() => generateToken(p.id, id)}
                            disabled={generatingTokenFor === p.id}
                            style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #e2e8f0', color: '#64748b', background: '#f8fafc', fontSize: 12, cursor: generatingTokenFor === p.id ? 'not-allowed' : 'pointer' }}
                          >
                            {generatingTokenFor === p.id ? '...' : 'צור קישור'}
                          </button>
                        )}

                        {/* Remove */}
                        <button
                          onClick={() => removeParticipant(p.id, displayName(p))}
                          disabled={isRemoving}
                          style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #fecaca', color: '#ef4444', background: 'none', fontSize: 12, cursor: isRemoving ? 'not-allowed' : 'pointer' }}
                          title="הסר מהקבוצה"
                        >
                          הסר
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          {/* ── Section: WhatsApp / chat links ── */}
          <Section title="קישורי WhatsApp" icon="💬" count={links.length}>
            {links.length === 0 ? (
              <p style={{ color: '#94a3b8', fontSize: 14, margin: 0 }}>
                לא קושרו צ׳אטים עדיין. לחצי &ldquo;קשרי צ׳אט&rdquo; למעלה כדי להוסיף.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {links.map((link, idx) => (
                  <div key={link.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0', borderBottom: idx < links.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                    <div style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0, background: link.linkType === 'group_chat' ? '#dbeafe' : '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>
                      {link.linkType === 'group_chat' ? '👥' : '👤'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {chatDisplayName(link.whatsappChat)}
                      </div>
                      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                        <span style={{ background: link.linkType === 'group_chat' ? '#dbeafe' : '#f0fdf4', color: link.linkType === 'group_chat' ? '#1d4ed8' : '#16a34a', padding: '1px 7px', borderRadius: 8, fontWeight: 600 }}>
                          {link.linkType === 'group_chat' ? 'קבוצת וואטסאפ' : 'צ׳אט פרטי'}
                        </span>
                        {link.participant && (
                          <span style={{ marginRight: 6, color: '#94a3b8' }}>— {displayName(link.participant)}</span>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <Link href={`/chats/${link.whatsappChatId}`}
                        style={{ fontSize: 12, color: '#2563eb', padding: '4px 10px', border: '1px solid #bfdbfe', borderRadius: 6, textDecoration: 'none' }}>
                        פתח ↗
                      </Link>
                      <button onClick={() => deleteLink(link.id)}
                        style={{ fontSize: 12, color: '#ef4444', padding: '4px 10px', border: '1px solid #fecaca', borderRadius: 6, background: 'none', cursor: 'pointer' }}>
                        הסר
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: CHAT
      ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'chat' && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
          {!groupChatLink ? (
            <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>💬</div>
              <p style={{ fontSize: 15, fontWeight: 600, color: '#374151', marginBottom: 8 }}>אין קבוצת WhatsApp מקושרת</p>
              <p style={{ fontSize: 13, marginBottom: 16, margin: '0 0 16px' }}>
                כדי לראות את השיחה, קשרי קבוצת WhatsApp דרך כפתור &ldquo;קשרי צ׳אט&rdquo;.
              </p>
              <button onClick={openLinkModal}
                style={{ padding: '9px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                🔗 קשרי צ׳אט
              </button>
            </div>
          ) : chatLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 200, color: '#94a3b8' }}>
              טוען שיחה...
            </div>
          ) : chatError ? (
            <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8' }}>
              <p>לא ניתן לטעון את השיחה.</p>
            </div>
          ) : chatDetail ? (
            <div style={{ display: 'flex', flexDirection: 'column', maxHeight: '70vh' }}>
              {/* Chat header */}
              <div style={{ padding: '12px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 10, background: '#f9fafb' }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
                  👥
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>
                    {chatDetail.name ?? chatDetail.phoneNumber ?? chatDetail.externalChatId}
                  </div>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>{chatDetail.messages.length} הודעות</div>
                </div>
                <Link href={`/chats/${groupChatLink.whatsappChatId}`}
                  style={{ marginRight: 'auto', fontSize: 12, color: '#2563eb', padding: '5px 12px', border: '1px solid #bfdbfe', borderRadius: 6, textDecoration: 'none' }}>
                  פתח מלא ↗
                </Link>
              </div>

              {/* Messages */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px 12px', background: '#e5ddd5', display: 'flex', flexDirection: 'column', gap: 2 }}>
                {chatDetail.messages.length === 0 && (
                  <div style={{ textAlign: 'center', color: '#94a3b8', marginTop: 40, fontSize: 14 }}>אין הודעות בשיחה זו עדיין.</div>
                )}
                {chatGrouped.map(({ date, messages }) => (
                  <div key={date}>
                    <div style={{ display: 'flex', justifyContent: 'center', margin: '10px 0 8px' }}>
                      <span style={{ background: 'rgba(255,255,255,0.8)', padding: '3px 14px', borderRadius: 12, fontSize: 12, color: '#64748b', fontWeight: 500 }}>
                        {date}
                      </span>
                    </div>
                    {messages.map((msg) => {
                      const isOutgoing = msg.direction === 'outgoing';
                      const isMedia = ['image', 'audio', 'video', 'document'].includes(msg.messageType);
                      return (
                        <div key={msg.id} style={{ display: 'flex', justifyContent: isOutgoing ? 'flex-end' : 'flex-start', marginBottom: 4 }}>
                          <div style={{
                            maxWidth: '72%',
                            background: isOutgoing ? '#dcf8c6' : '#ffffff',
                            borderRadius: isOutgoing ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                            padding: '7px 11px 5px',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.12)',
                          }}>
                            {chatDetail.type === 'group' && !isOutgoing && (
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
                <div ref={chatBottomRef} />
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          MODAL — GROUP MESSAGE COMPOSER (WhatsAppEditor)
      ══════════════════════════════════════════════════════════════════════ */}
      {msgModalOpen && (
        <Modal onClose={() => setMsgModalOpen(false)}>
          <h3 style={S.modalTitle}>הודעה לקבוצה</h3>
          {groupChatLink ? (
            <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 16px' }}>
              שולחת ל: <strong>{chatDisplayName(groupChatLink.whatsappChat)}</strong>
            </p>
          ) : (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#dc2626' }}>
              לא קושרה קבוצת וואטסאפ. לחצי &ldquo;קשרי צ׳אט&rdquo; ובחרי קישור מסוג &ldquo;קבוצת וואטסאפ&rdquo;.
            </div>
          )}

          {/* Quick template chips */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {[
              'שלום חברות! 👋',
              'תזכורת למשימה להיום 📌',
              'כל הכבוד לכולן! 🏆',
              'מחר יש מפגש — לא לשכוח! 📅',
            ].map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => setMsgText((prev) => (prev ? prev + '\n' + chip : chip))}
                disabled={!groupChatLink}
                style={{
                  padding: '4px 10px', borderRadius: 20, border: '1px solid #e2e8f0',
                  background: '#f8fafc', fontSize: 12, cursor: groupChatLink ? 'pointer' : 'not-allowed',
                  color: '#374151',
                }}
              >
                {chip}
              </button>
            ))}
          </div>

          <WhatsAppEditor
            value={msgText}
            onChange={setMsgText}
            placeholder="הקלידי את תוכן ההודעה..."
            minHeight={120}
          />

          {msgError && <p style={{ color: '#ef4444', fontSize: 13, margin: '8px 0 0' }}>{msgError}</p>}
          {msgSuccess && <p style={{ color: '#16a34a', fontSize: 13, margin: '8px 0 0', fontWeight: 600 }}>ההודעה נשלחה!</p>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
            <button onClick={() => setMsgModalOpen(false)} style={S.btnSecondary}>ביטול</button>
            <button
              onClick={sendGroupMessage}
              disabled={msgSending || !groupChatLink || !msgText.trim()}
              style={{ ...S.btnPrimary, ...(msgSending || !groupChatLink || !msgText.trim() ? S.btnDisabled : {}) }}
            >
              {msgSending ? 'שולח...' : 'שלח'}
            </button>
          </div>
        </Modal>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          MODAL — ADD PARTICIPANT
      ══════════════════════════════════════════════════════════════════════ */}
      {addParticipantOpen && (
        <Modal onClose={() => setAddParticipantOpen(false)}>
          <h3 style={S.modalTitle}>הוסף משתתפת לקבוצה</h3>
          <input
            type="text"
            placeholder="חיפוש לפי שם או טלפון..."
            value={participantSearch}
            onChange={(e) => setParticipantSearch(e.target.value)}
            style={{ ...S.input, marginBottom: 12 }}
            autoFocus
          />
          {participantsLoading ? (
            <p style={{ color: '#94a3b8', fontSize: 14 }}>טוען...</p>
          ) : filteredAll.length === 0 ? (
            <p style={{ color: '#94a3b8', fontSize: 14 }}>
              {searchTerm ? 'לא נמצאו משתתפות' : 'כל המשתתפות כבר בקבוצה'}
            </p>
          ) : (
            <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
              {filteredAll.slice(0, 50).map((p, idx) => (
                <button
                  key={p.id}
                  onClick={() => addParticipant(p.id)}
                  disabled={addingParticipantId === p.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, width: '100%',
                    padding: '11px 14px', background: 'none', border: 'none', cursor: 'pointer',
                    borderBottom: idx < Math.min(filteredAll.length, 50) - 1 ? '1px solid #f1f5f9' : 'none',
                    textAlign: 'right',
                  }}
                >
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#eff6ff', color: '#1d4ed8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
                    {p.firstName.charAt(0)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: '#0f172a' }}>{displayName(p)}</div>
                    <div style={{ fontSize: 12, color: '#6b7280', direction: 'ltr', textAlign: 'right' }}>{p.phoneNumber}</div>
                  </div>
                  <span style={{ fontSize: 12, color: '#2563eb', fontWeight: 600 }}>
                    {addingParticipantId === p.id ? '...' : '+ הוסף'}
                  </span>
                </button>
              ))}
            </div>
          )}
          <div style={{ marginTop: 14, textAlign: 'left' }}>
            <button onClick={() => setAddParticipantOpen(false)} style={S.btnSecondary}>סגור</button>
          </div>
        </Modal>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          MODAL — LINK CHAT
      ══════════════════════════════════════════════════════════════════════ */}
      {linkModalOpen && (
        <Modal onClose={() => setLinkModalOpen(false)}>
          <h3 style={S.modalTitle}>קשרי צ׳אט קיים</h3>

          <div style={{ marginBottom: 16 }}>
            <label style={S.fieldLabel}>בחר/י צ׳אט</label>
            {chatsLoading ? (
              <p style={{ color: '#94a3b8', fontSize: 13 }}>טוען צ׳אטים...</p>
            ) : pickableChats.length === 0 ? (
              <p style={{ color: '#94a3b8', fontSize: 13 }}>
                {availableChats.length === 0 ? 'אין צ׳אטים זמינים (הרץ backfill תחילה)' : 'כל הצ׳אטים כבר מקושרים.'}
              </p>
            ) : (
              <select value={selectedChatId} onChange={(e) => setSelectedChatId(e.target.value)} style={S.select}>
                <option value="">-- בחר/י צ׳אט --</option>
                {pickableChats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {chatDisplayName(c)} ({c.type === 'group' ? 'קבוצה' : 'פרטי'})
                  </option>
                ))}
              </select>
            )}
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={S.fieldLabel}>סוג קישור</label>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {([
                ['group_chat', '👥 קבוצת וואטסאפ'],
                ['private_participant_chat', '👤 צ׳אט פרטי'],
              ] as const).map(([val, label]) => (
                <label key={val} style={{
                  display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                  padding: '7px 12px', borderRadius: 8, border: '1px solid',
                  borderColor: selectedLinkType === val ? '#2563eb' : '#e2e8f0',
                  background: selectedLinkType === val ? '#eff6ff' : '#fff',
                  fontSize: 13, fontWeight: selectedLinkType === val ? 600 : 400,
                }}>
                  <input type="radio" name="linkType" value={val}
                    checked={selectedLinkType === val}
                    onChange={() => { setSelectedLinkType(val); setSelectedParticipantId(''); }}
                    style={{ display: 'none' }}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          {selectedLinkType === 'private_participant_chat' && (
            <div style={{ marginBottom: 16 }}>
              <label style={S.fieldLabel}>משתתף/ת</label>
              {participants.length === 0 ? (
                <p style={{ color: '#94a3b8', fontSize: 13 }}>אין משתתפות פעילות בקבוצה זו.</p>
              ) : (
                <select value={selectedParticipantId} onChange={(e) => setSelectedParticipantId(e.target.value)} style={S.select}>
                  <option value="">-- בחר/י משתתף/ת --</option>
                  {participants.map((pg) => (
                    <option key={pg.participant.id} value={pg.participant.id}>
                      {displayName(pg.participant)} · {pg.participant.phoneNumber}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {linkError && <p style={{ color: '#ef4444', fontSize: 13, marginBottom: 12 }}>{linkError}</p>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button onClick={() => setLinkModalOpen(false)} style={S.btnSecondary}>ביטול</button>
            <button onClick={linkSubmitting ? undefined : submitLink} disabled={linkSubmitting}
              style={{ ...S.btnPrimary, ...(linkSubmitting ? S.btnDisabled : {}) }}>
              {linkSubmitting ? 'שומר...' : 'קשרי'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Section wrapper ───────────────────────────────────────────────────────────

function Section({
  title, icon, count, children, action,
}: {
  title: string;
  icon: string;
  count?: number;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid #e2e8f0', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>{icon}</span>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', margin: 0 }}>{title}</h2>
          {count !== undefined && (
            <span style={{ background: '#f1f5f9', color: '#64748b', padding: '1px 8px', borderRadius: 10, fontSize: 12 }}>
              {count}
            </span>
          )}
        </div>
        {action}
      </div>
      <div style={{ padding: '16px 20px' }}>{children}</div>
    </div>
  );
}

// ─── Modal wrapper ─────────────────────────────────────────────────────────────

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 520, padding: 28, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', maxHeight: '90vh', overflowY: 'auto' }}>
        {children}
      </div>
    </div>
  );
}

// ─── Shared style tokens ───────────────────────────────────────────────────────

const S = {
  modalTitle: { fontSize: 16, fontWeight: 700, color: '#0f172a', margin: '0 0 18px' } as React.CSSProperties,
  fieldLabel: { display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 } as React.CSSProperties,
  input: {
    width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: 7,
    fontSize: 14, color: '#0f172a', background: '#fff', boxSizing: 'border-box' as const,
    outline: 'none', direction: 'rtl' as const,
  } as React.CSSProperties,
  select: {
    width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: 7,
    fontSize: 14, color: '#0f172a', background: '#fff',
  } as React.CSSProperties,
  btnPrimary: {
    padding: '8px 18px', borderRadius: 7, border: 'none',
    background: '#2563eb', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer',
  } as React.CSSProperties,
  btnSecondary: {
    padding: '8px 18px', borderRadius: 7, border: '1px solid #e2e8f0',
    background: '#fff', fontSize: 14, cursor: 'pointer', color: '#374151',
  } as React.CSSProperties,
  btnDisabled: { background: '#93c5fd', cursor: 'not-allowed' } as React.CSSProperties,
};
