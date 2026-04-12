'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { BASE_URL, apiFetch } from '@lib/api';
import WhatsAppEditor from '@components/whatsapp-editor';
import { ChatMessage, ChatMessageList } from '@components/chat-messages';

// ─── Types ───────────────────────────────────────────────────────────────────

type ProgramType = 'challenge' | 'game' | 'group_coaching' | 'personal_coaching';

const PROGRAM_TYPE_LABEL: Record<string, string> = {
  challenge:         'אתגר',
  game:              'משחק',
  group_coaching:    'ליווי קבוצתי',
  personal_coaching: 'ליווי אישי',
};

const PROGRAM_TYPE_ICON: Record<string, string> = {
  challenge:         '🏆',
  game:              '🎮',
  group_coaching:    '👥',
  personal_coaching: '👤',
};

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
  taskEngineEnabled: boolean;
  programId: string | null;
  program: { id: string; name: string; isActive: boolean; type: ProgramType } | null;
  startDate: string | null;
  endDate: string | null;
  portalCallTime: string | null;
  portalOpenTime: string | null;
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

interface ChatDetail {
  id: string;
  externalChatId: string;
  type: string;
  name: string | null;
  phoneNumber: string | null;
  messages: ChatMessage[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function displayName(p: { firstName: string; lastName?: string | null }): string {
  return [p.firstName, p.lastName].filter(Boolean).join(' ');
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateRange(start: string | null, end: string | null): string {
  if (!start && !end) return '';
  const heDate = (iso: string, opts: Intl.DateTimeFormatOptions) =>
    new Date(iso).toLocaleDateString('he-IL', opts);
  if (!start) return `עד ${heDate(end!, { day: 'numeric', month: 'long', year: 'numeric' })}`;
  if (!end) return `מ‑${heDate(start, { day: 'numeric', month: 'long', year: 'numeric' })}`;
  const s = new Date(start);
  const e = new Date(end);
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
    const month = e.toLocaleDateString('he-IL', { month: 'long' });
    return `${s.getDate()}–${e.getDate()} ב${month} ${e.getFullYear()}`;
  }
  return `${heDate(start, { day: 'numeric', month: 'short' })} – ${heDate(end, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

function isLegacyChallenge(name: string): boolean {
  return name.startsWith('__') && name.endsWith('__');
}

function chatDisplayName(chat: WhatsAppChat): string {
  return chat.name ?? chat.phoneNumber ?? chat.externalChatId;
}

// ─── SVG icon components ──────────────────────────────────────────────────────

function PencilIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" fill="#f97316"/>
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path fillRule="evenodd" clipRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm4 0a1 1 0 112 0v4a1 1 0 11-2 0V8z" fill="#ef4444"/>
    </svg>
  );
}

// ─── Icon button styles (header) ─────────────────────────────────────────────

const HDR_ICON_BTN: React.CSSProperties = {
  width: 36, height: 36, borderRadius: 8,
  border: '1px solid #e2e8f0', background: '#fff',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer', flexShrink: 0,
};
const HDR_ICON_BTN_HOVER: React.CSSProperties = { ...HDR_ICON_BTN, background: '#fff7ed', borderColor: '#fed7aa' };
const HDR_ICON_BTN_DANGER: React.CSSProperties = { ...HDR_ICON_BTN, border: '1px solid #fecaca' };
const HDR_ICON_BTN_DANGER_HOVER: React.CSSProperties = { ...HDR_ICON_BTN_DANGER, background: '#fef2f2', borderColor: '#fca5a5' };

// ─── Page ─────────────────────────────────────────────────────────────────────

type Tab = 'details' | 'chat' | 'leaderboard';

interface ParticipantRankRow {
  participantId: string;
  firstName: string;
  lastName: string | null;
  totalScore: number;
  todayScore: number;
  weekScore: number;
  currentStreak: number;
  rank: number;
}

interface AdminParticipantStats {
  todayScore: number;
  weekScore: number;
  totalScore: number;
  currentStreak: number;
  bestStreak: number;
  dailyTrend: { date: string; points: number }[];
}

interface AdminFeedEvent {
  id: string;
  participantId: string;
  groupId: string;
  points: number;
  message: string;
  createdAt: string;
  participant: { id: string; firstName: string; lastName: string | null };
}

export default function GroupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();

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

  // Leaderboard tab
  const [participantRanks, setParticipantRanks] = useState<ParticipantRankRow[]>([]);
  const [ranksLoading, setRanksLoading] = useState(false);
  const [ranksError, setRanksError] = useState(false);

  // Admin inspect panel (inside leaderboard tab)
  const [inspectedParticipantId, setInspectedParticipantId] = useState<string | null>(null);
  const [adminStats, setAdminStats] = useState<AdminParticipantStats | null>(null);
  const [adminStatsLoading, setAdminStatsLoading] = useState(false);
  const [adminFeed, setAdminFeed] = useState<AdminFeedEvent[]>([]);
  const [adminFeedLoading, setAdminFeedLoading] = useState(false);
  const [feedToggleLoading, setFeedToggleLoading] = useState(false);
  // Feed toggle: true = show all participants together (default ON), persisted in localStorage
  const [feedShowAll, setFeedShowAll] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const stored = localStorage.getItem('admin_feed_show_all');
    return stored === null ? true : stored === 'true';
  });
  const [selectedFeedIds, setSelectedFeedIds] = useState<Set<string>>(new Set());
  const [deletingFeedIds, setDeletingFeedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Group message modal
  const [msgModalOpen, setMsgModalOpen] = useState(false);
  const [msgText, setMsgText] = useState('');
  const [msgSending, setMsgSending] = useState(false);
  const [msgError, setMsgError] = useState('');
  const [msgSuccess, setMsgSuccess] = useState(false);
  // Template picker
  const [templates, setTemplates] = useState<{ id: string; name: string; content: string }[]>([]);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [templateConfirm, setTemplateConfirm] = useState<{ content: string } | null>(null);

  // Add participant modal
  const [addParticipantOpen, setAddParticipantOpen] = useState(false);
  const [allParticipants, setAllParticipants] = useState<Participant[]>([]);
  const [participantSearch, setParticipantSearch] = useState('');
  const [addingParticipantId, setAddingParticipantId] = useState('');
  const [participantsLoading, setParticipantsLoading] = useState(false);

  // Remove participant
  const [removingParticipantId, setRemovingParticipantId] = useState<string | null>(null);
  const [removeConfirm, setRemoveConfirm] = useState<{ id: string; name: string } | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

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

  // Bypass link — per-participant admin preview link that skips the opening gate
  const [bypassFetchingFor, setBypassFetchingFor] = useState<string | null>(null);

  // Edit group modal
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', startDate: '', endDate: '', isActive: true, portalCallTime: '', portalOpenTime: '' });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');

  // Delete group modal
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

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

  // Auto-open edit modal when arriving from list page with ?edit=1
  useEffect(() => {
    if (searchParams.get('edit') === '1' && !loading && group) {
      openEditModal();
      router.replace(`/groups/${id}`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, group]);

  // ─── Templates: fetch once when message modal first opens ────────────────

  const templatesFetched = useRef(false);
  useEffect(() => {
    if (!msgModalOpen || templatesFetched.current || !group?.programId) return;
    templatesFetched.current = true;
    apiFetch<{ id: string; name: string; content: string }[]>(
      `${BASE_URL}/programs/${group.programId}/templates`, { cache: 'no-store' },
    ).then(setTemplates).catch(() => {});
  }, [msgModalOpen, group?.programId]);

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

  // ─── Leaderboard tab: load when switching ─────────────────────────────────

  useEffect(() => {
    if (tab !== 'leaderboard' || !id) return;
    setRanksLoading(true);
    setRanksError(false);
    apiFetch<ParticipantRankRow[]>(`${BASE_URL}/game/leaderboard/group/${id}`, { cache: 'no-store' })
      .then((data) => {
        const rows = Array.isArray(data) ? data : [];
        setParticipantRanks(rows);
        // Auto-select rank 1 participant for the inspect panel
        if (rows.length > 0 && !inspectedParticipantId) {
          setInspectedParticipantId(rows[0].participantId);
        }
      })
      .catch(() => setRanksError(true))
      .finally(() => setRanksLoading(false));
  }, [tab, id]);

  // ─── Admin inspect panel: load stats + feed when participant or feed-mode changes ─

  // Builds the feed URL: omit participantId when feedShowAll=true to get all participants
  function buildFeedUrl(showAll: boolean) {
    const base = `${BASE_URL}/game/admin/feed?groupId=${id}&limit=50`;
    return showAll ? base : `${base}&participantId=${inspectedParticipantId}`;
  }

  useEffect(() => {
    if (!inspectedParticipantId || !id) return;
    setAdminStats(null);
    setAdminFeed([]);
    setSelectedFeedIds(new Set());

    setAdminStatsLoading(true);
    apiFetch<AdminParticipantStats>(
      `${BASE_URL}/game/admin/participant-stats?participantId=${inspectedParticipantId}&groupId=${id}`,
      { cache: 'no-store' },
    )
      .then((data) => setAdminStats(data))
      .catch(() => {})
      .finally(() => setAdminStatsLoading(false));

    setAdminFeedLoading(true);
    apiFetch<AdminFeedEvent[]>(buildFeedUrl(feedShowAll), { cache: 'no-store' })
      .then((data) => setAdminFeed(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setAdminFeedLoading(false));
  }, [inspectedParticipantId, id]);

  // Reload feed only when toggle changes — keep old data visible until new data arrives
  useEffect(() => {
    if (!inspectedParticipantId || !id) return;
    setSelectedFeedIds(new Set());
    setFeedToggleLoading(true);
    apiFetch<AdminFeedEvent[]>(buildFeedUrl(feedShowAll), { cache: 'no-store' })
      .then((data) => setAdminFeed(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setFeedToggleLoading(false));
  }, [feedShowAll]);

  // ─── Admin: reload leaderboard + feed after deletion ──────────────────────

  function reloadAfterDelete() {
    if (!id) return;
    // Reload ranks
    apiFetch<ParticipantRankRow[]>(`${BASE_URL}/game/leaderboard/group/${id}`, { cache: 'no-store' })
      .then((data) => setParticipantRanks(Array.isArray(data) ? data : []))
      .catch(() => {});
    if (!inspectedParticipantId) return;
    // Reload feed — respects current toggle state
    apiFetch<AdminFeedEvent[]>(buildFeedUrl(feedShowAll), { cache: 'no-store' })
      .then((data) => setAdminFeed(Array.isArray(data) ? data : []))
      .catch(() => {});
    // Reload stats — always scoped to selected participant
    apiFetch<AdminParticipantStats>(
      `${BASE_URL}/game/admin/participant-stats?participantId=${inspectedParticipantId}&groupId=${id}`,
      { cache: 'no-store' },
    )
      .then((data) => setAdminStats(data))
      .catch(() => {});
  }

  async function handleDeleteFeedEvent(feedEventId: string) {
    setDeletingFeedIds((prev) => new Set(prev).add(feedEventId));
    try {
      await apiFetch(`${BASE_URL}/game/admin/feed/${feedEventId}`, { method: 'DELETE' });
      setAdminFeed((prev) => prev.filter((e) => e.id !== feedEventId));
      setSelectedFeedIds((prev) => { const n = new Set(prev); n.delete(feedEventId); return n; });
      reloadAfterDelete();
    } catch {
      // silent — row stays, user can retry
    } finally {
      setDeletingFeedIds((prev) => { const n = new Set(prev); n.delete(feedEventId); return n; });
    }
  }

  async function handleBulkDelete() {
    const ids = Array.from(selectedFeedIds);
    if (ids.length === 0) return;
    setBulkDeleting(true);
    try {
      await apiFetch(`${BASE_URL}/game/admin/feed/bulk-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      setAdminFeed((prev) => prev.filter((e) => !selectedFeedIds.has(e.id)));
      setSelectedFeedIds(new Set());
      reloadAfterDelete();
    } catch {
      // silent
    } finally {
      setBulkDeleting(false);
    }
  }

  // ─── Edit group ────────────────────────────────────────────────────────────

  // Convert a UTC ISO string to a datetime-local input value in Israel time (Asia/Jerusalem).
  // Always shows the admin Israel clock time, regardless of what timezone the browser is in.
  function toIsraelDatetimeLocal(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    // Use Intl to extract the Israel wall-clock time components
    const fmt = new Intl.DateTimeFormat('sv', { // 'sv' gives ISO-like YYYY-MM-DD HH:MM format
      timeZone: 'Asia/Jerusalem',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
      hour12: false,
    });
    return fmt.format(d).replace(' ', 'T').slice(0, 16); // "2026-04-13T13:00"
  }

  // Convert a datetime-local string entered by admin (interpreted as Israel time) to UTC ISO.
  // new Date(localStr) would use the browser timezone — we must NOT do that.
  // Instead: treat the input as Israel wall-clock time and convert to UTC explicitly.
  function israelLocalToUTC(localStr: string): string {
    if (!localStr) return '';
    // Step 1: parse as UTC to get a reference point for offset calculation
    const utcRef = new Date(localStr + 'Z');
    // Step 2: find what Israel clock shows for this UTC reference
    const fmt = new Intl.DateTimeFormat('sv', {
      timeZone: 'Asia/Jerusalem',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });
    const israelStr = fmt.format(utcRef).replace(' ', 'T'); // "2026-04-13T16:00:00"
    // Step 3: offset in ms = Israel reading (as UTC) − reference
    const offsetMs = new Date(israelStr + 'Z').getTime() - utcRef.getTime();
    // Step 4: actual UTC = input read as UTC − offset
    return new Date(utcRef.getTime() - offsetMs).toISOString();
  }

  function openEditModal() {
    if (!group) return;
    setEditForm({
      name: group.name,
      startDate: group.startDate ? group.startDate.slice(0, 10) : '',
      endDate: group.endDate ? group.endDate.slice(0, 10) : '',
      isActive: group.isActive,
      portalCallTime: toIsraelDatetimeLocal(group.portalCallTime),
      portalOpenTime: toIsraelDatetimeLocal(group.portalOpenTime),
    });
    setEditError('');
    setEditModalOpen(true);
  }

  async function handleEditSave() {
    if (!editForm.name.trim()) { setEditError('שם הקבוצה הוא שדה חובה'); return; }
    // Validate: if portalOpenTime is set, portalCallTime must also be set (or empty)
    // This is a UX guard, not a hard constraint — both are optional
    setEditSaving(true);
    try {
      // Convert datetime-local values — treated as Israel time (Asia/Jerusalem), not browser local.
      // israelLocalToUTC() uses Intl to find the Israel UTC offset and converts correctly
      // regardless of what timezone the admin's browser is in.
      const portalCallTime = editForm.portalCallTime ? israelLocalToUTC(editForm.portalCallTime) : null;
      const portalOpenTime = editForm.portalOpenTime ? israelLocalToUTC(editForm.portalOpenTime) : null;

      const updated = await apiFetch<Group>(
        `${BASE_URL}/groups/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: editForm.name.trim(),
            startDate: editForm.startDate || null,
            endDate: editForm.endDate || null,
            isActive: editForm.isActive,
            portalCallTime,
            portalOpenTime,
          }),
        },
      );
      setGroup((prev) => prev ? { ...prev, name: updated.name, startDate: updated.startDate, endDate: updated.endDate, isActive: updated.isActive, portalCallTime: updated.portalCallTime, portalOpenTime: updated.portalOpenTime } : prev);
      setEditModalOpen(false);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'שגיאה בשמירה');
    } finally {
      setEditSaving(false);
    }
  }

  // ─── Delete group ───────────────────────────────────────────────────────────

  async function handleDelete() {
    setDeleting(true);
    setDeleteError('');
    try {
      await apiFetch(`${BASE_URL}/groups/${id}`, { method: 'DELETE' });
      router.push('/groups');
    } catch (err) {
      setDeleteError(
        typeof err === 'object' && err !== null && 'message' in err
          ? String((err as { message: unknown }).message)
          : 'שגיאה במחיקה',
      );
      setDeleting(false);
    }
  }

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

  async function confirmRemoveParticipant() {
    if (!removeConfirm) return;
    const { id: participantId } = removeConfirm;
    setRemovingParticipantId(participantId);
    setRemoveError(null);
    try {
      await apiFetch(`${BASE_URL}/groups/${id}/participants/${participantId}`, { method: 'DELETE' });
      setGroup((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          participantGroups: prev.participantGroups.filter((pg) => pg.participantId !== participantId),
        };
      });
      setRemoveConfirm(null);
    } catch (err) {
      const msg = typeof err === 'object' && err !== null && 'message' in err
        ? String((err as { message: string }).message)
        : 'הסרת המשתתפת נכשלה. אנא נסי שוב.';
      setRemoveError(msg);
    } finally {
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

  // ─── Bypass portal link (admin preview, skips opening gate) ──────────────

  async function copyBypassLink(accessToken: string, pgId: string) {
    setBypassFetchingFor(pgId);
    try {
      const res = await apiFetch<{ sig: string }>(
        `${BASE_URL}/game/admin/bypass-link?accessToken=${encodeURIComponent(accessToken)}`,
      );
      const url = `${window.location.origin}/t/${accessToken}?_bypass=${res.sig}`;
      await navigator.clipboard.writeText(url);
      setCopiedId(`bypass-${pgId}`);
      setTimeout(() => setCopiedId(null), 2000);
    } catch { /* ignore */ } finally {
      setBypassFetchingFor(null);
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
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* ── Back ── */}
      <Link href="/groups" style={{ color: '#64748b', fontSize: 14, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 20 }}>
        ← חזרה לקבוצות
      </Link>

      {/* ══════════════════════════════════════════════════════════════════════
          HEADER
      ══════════════════════════════════════════════════════════════════════ */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '20px 24px', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>

          {/* Identity block */}
          <div>
            {/* Line 1: name + status */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
              <h1 style={{ fontSize: 26, fontWeight: 700, color: '#0f172a', margin: 0, fontFamily: "'Heebo', 'Segoe UI', sans-serif", letterSpacing: '-0.2px', lineHeight: 1.2 }}>
                {group.name}
              </h1>
              <span style={{
                background: group.isActive ? '#dcfce7' : '#f1f5f9',
                color: group.isActive ? '#16a34a' : '#94a3b8',
                padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600,
              }}>
                {group.isActive ? '🟢 פעילה' : '⚫ לא פעילה'}
              </span>
            </div>

            {/* Line 2: program type · program name · dates · participants */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {group.program && (
                <>
                  <Link href={`/programs/${group.program.id}`} style={{ textDecoration: 'none' }}>
                    <span style={{
                      background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe',
                      padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                    }}>
                      {PROGRAM_TYPE_ICON[group.program.type] ?? '⚡'} {PROGRAM_TYPE_LABEL[group.program.type] ?? group.program.type}
                    </span>
                  </Link>
                  <span style={{ color: '#6b7280', fontSize: 13, fontWeight: 500 }}>{group.program.name}</span>
                  <span style={{ color: '#cbd5e1' }}>·</span>
                </>
              )}
              {(group.startDate || group.endDate) && (() => {
                const range = formatDateRange(group.startDate, group.endDate);
                return range ? (
                  <>
                    <span style={{ fontSize: 13, color: '#374151' }}>📅 {range}</span>
                    <span style={{ color: '#cbd5e1' }}>·</span>
                  </>
                ) : null;
              })()}
              <span style={{ fontSize: 13, color: '#374151' }}>
                👥 {participants.length} {participants.length === 1 ? 'משתתפת' : 'משתתפות'}
              </span>
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {/* Primary: send message — prominent */}
            <button
              onClick={() => { setMsgModalOpen(true); setMsgError(''); setMsgSuccess(false); }}
              disabled={!groupChatLink}
              title={groupChatLink ? 'שלח הודעה לקבוצה' : 'אין קבוצת וואטסאפ מקושרת'}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: groupChatLink ? '#16a34a' : '#d1d5db',
                color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px',
                fontSize: 13, fontWeight: 600, cursor: groupChatLink ? 'pointer' : 'not-allowed',
              }}
            >
              💬 הודעה
            </button>

            {/* Secondary: link chat */}
            <button
              onClick={openLinkModal}
              title="קשר צ׳אט WhatsApp"
              style={HDR_ICON_BTN}
              onMouseEnter={(e) => Object.assign((e.currentTarget as HTMLButtonElement).style, { ...HDR_ICON_BTN, background: '#f8fafc', borderColor: '#cbd5e1' })}
              onMouseLeave={(e) => Object.assign((e.currentTarget as HTMLButtonElement).style, HDR_ICON_BTN)}
            >
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12.586 4.586a2 2 0 012.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z" fill="#6b7280"/>
              </svg>
            </button>

            {/* Secondary: edit — compact icon */}
            <button
              onClick={openEditModal}
              title="ערוך קבוצה"
              style={HDR_ICON_BTN}
              onMouseEnter={(e) => Object.assign((e.currentTarget as HTMLButtonElement).style, HDR_ICON_BTN_HOVER)}
              onMouseLeave={(e) => Object.assign((e.currentTarget as HTMLButtonElement).style, HDR_ICON_BTN)}
            >
              <PencilIcon />
            </button>

            {/* Danger: delete — compact icon */}
            <button
              onClick={() => { setDeleteError(''); setDeleteModalOpen(true); }}
              title="מחק קבוצה"
              style={HDR_ICON_BTN_DANGER}
              onMouseEnter={(e) => Object.assign((e.currentTarget as HTMLButtonElement).style, HDR_ICON_BTN_DANGER_HOVER)}
              onMouseLeave={(e) => Object.assign((e.currentTarget as HTMLButtonElement).style, HDR_ICON_BTN_DANGER)}
            >
              <TrashIcon />
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
          ['leaderboard', 'דירוגים'],
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

          {/* ── Section: task engine ── */}
          <Section
            title="מנוע משימות"
            icon="📅"
            action={
              <button
                onClick={async () => {
                  if (!group) return;
                  const updated = await apiFetch<Group>(
                    `${BASE_URL}/groups/${id}`,
                    { method: 'PATCH', body: JSON.stringify({ taskEngineEnabled: !group.taskEngineEnabled }), headers: { 'Content-Type': 'application/json' } },
                  ).catch(() => null);
                  if (updated) setGroup(updated);
                }}
                style={{
                  background: group?.taskEngineEnabled ? '#f0fdf4' : '#f8fafc',
                  color: group?.taskEngineEnabled ? '#16a34a' : '#64748b',
                  border: `1px solid ${group?.taskEngineEnabled ? '#bbf7d0' : '#e2e8f0'}`,
                  borderRadius: 7, padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}
              >
                {group?.taskEngineEnabled ? '✓ מופעל — כבה' : 'הפעל'}
              </button>
            }
          >
            {!group?.taskEngineEnabled ? (
              <p style={{ color: '#94a3b8', fontSize: 14, margin: 0 }}>
                מנוע המשימות כבוי לקבוצה זו. לחצי &ldquo;הפעל&rdquo; כדי לאפשר לחברות גישה לתוכנית האישית שלהן.
              </p>
            ) : participants.length === 0 ? (
              <p style={{ color: '#94a3b8', fontSize: 14, margin: 0 }}>
                אין משתתפות בקבוצה עדיין. הוסיפי משתתפות כדי לנהל תוכניות אישיות.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {/* Explanatory note */}
                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 12, color: '#15803d' }}>
                  📱 הקישור האישי הוא מה שיש לשלוח למשתתפת — זהו הכניסה שלה לפורטל התכנון האישי שלה
                </div>
                {participants.map((pg, idx) => {
                  const p = pg.participant;
                  const portalUrl = pg.accessToken
                    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/tg/${pg.accessToken}`
                    : null;
                  return (
                    <div key={pg.id} style={{
                      padding: '12px 0',
                      borderBottom: idx < participants.length - 1 ? '1px solid #f1f5f9' : 'none',
                    }}>
                      {/* Row 1: avatar + name + admin plan view */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: portalUrl ? 8 : 0 }}>
                        <div style={{
                          width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                          background: '#f0fdf4', color: '#16a34a',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontWeight: 700, fontSize: 13,
                        }}>
                          {p.firstName.charAt(0)}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Link href={`/participants/${p.id}?tab=goals`}
                            style={{ fontWeight: 600, fontSize: 14, color: '#0f172a', textDecoration: 'none' }}>
                            {displayName(p)}
                          </Link>
                        </div>
                        <Link href={`/tasks/portal/${p.id}`}
                          style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #bfdbfe', color: '#1d4ed8', background: '#eff6ff', fontSize: 11, fontWeight: 500, textDecoration: 'none', flexShrink: 0 }}>
                          📅 תוכנית (מנהל)
                        </Link>
                      </div>
                      {/* Row 2: participant link — prominent */}
                      {portalUrl ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 42 }}>
                          <div style={{ flex: 1, fontSize: 12, color: '#64748b', fontFamily: 'monospace', direction: 'ltr' as const, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                            {portalUrl}
                          </div>
                          <button
                            onClick={() => copyText(portalUrl, `portal-${pg.id}`)}
                            style={{
                              padding: '5px 12px', borderRadius: 6, flexShrink: 0,
                              border: `1px solid ${copiedId === `portal-${pg.id}` ? '#86efac' : '#16a34a'}`,
                              color: copiedId === `portal-${pg.id}` ? '#15803d' : '#fff',
                              background: copiedId === `portal-${pg.id}` ? '#f0fdf4' : '#16a34a',
                              fontSize: 12, fontWeight: 600, cursor: 'pointer',
                            }}
                          >
                            {copiedId === `portal-${pg.id}` ? '✓ הועתק' : '📋 שלחי לנייד'}
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 42 }}>
                          <div style={{ flex: 1, fontSize: 12, color: '#f59e0b' }}>טרם נוצר קישור אישי</div>
                          <button
                            onClick={() => generateToken(p.id, id)}
                            disabled={generatingTokenFor === p.id}
                            style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #e2e8f0', color: '#64748b', background: '#f8fafc', fontSize: 12, cursor: generatingTokenFor === p.id ? 'not-allowed' : 'pointer', flexShrink: 0 }}
                          >
                            {generatingTokenFor === p.id ? '...' : '+ צרי קישור אישי'}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
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

                        {/* Bypass link — admin-only, skips opening gate for this participant only */}
                        {hasToken && (
                          <button
                            onClick={() => copyBypassLink(pg.accessToken!, pg.id)}
                            disabled={bypassFetchingFor === pg.id}
                            title="עקוף מסך פתיחה"
                            style={{
                              padding: '5px 8px', borderRadius: 6, flexShrink: 0,
                              border: `1px solid ${copiedId === `bypass-${pg.id}` ? '#bbf7d0' : '#e2e8f0'}`,
                              color: copiedId === `bypass-${pg.id}` ? '#16a34a' : '#6b7280',
                              background: copiedId === `bypass-${pg.id}` ? '#f0fdf4' : 'none',
                              fontSize: 13, cursor: bypassFetchingFor === pg.id ? 'not-allowed' : 'pointer',
                              display: 'flex', alignItems: 'center',
                            }}
                          >
                            {copiedId === `bypass-${pg.id}` ? '✓' : bypassFetchingFor === pg.id ? '…' : '↻'}
                          </button>
                        )}

                        {/* Remove */}
                        <button
                          onClick={() => { setRemoveConfirm({ id: p.id, name: displayName(p) }); setRemoveError(null); }}
                          disabled={isRemoving}
                          style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #fecaca', color: '#ef4444', background: 'none', fontSize: 12, cursor: isRemoving ? 'not-allowed' : 'pointer' }}
                          title="הסר מהקבוצה"
                        >
                          {isRemoving ? '...' : 'הסר'}
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
              <ChatMessageList
                messages={chatDetail.messages}
                chatType={chatDetail.type}
                bottomRef={chatBottomRef}
              />
            </div>
          ) : null}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: LEADERBOARD
      ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'leaderboard' && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0 }}>דירוג משתתפות בקבוצה</h3>
            <button
              onClick={() => {
                setRanksLoading(true);
                setRanksError(false);
                apiFetch<ParticipantRankRow[]>(`${BASE_URL}/game/leaderboard/group/${id}`, { cache: 'no-store' })
                  .then((data) => setParticipantRanks(Array.isArray(data) ? data : []))
                  .catch(() => setRanksError(true))
                  .finally(() => setRanksLoading(false));
              }}
              style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 12px', fontSize: 12, color: '#374151', cursor: 'pointer' }}
            >
              ↻ רענן
            </button>
          </div>

          {ranksLoading && (
            <div style={{ color: '#94a3b8', fontSize: 13, paddingTop: 20, textAlign: 'center' }}>טוען דירוג...</div>
          )}
          {!ranksLoading && ranksError && (
            <div style={{ color: '#dc2626', fontSize: 13, textAlign: 'center', paddingTop: 20 }}>שגיאה בטעינת הדירוג</div>
          )}
          {!ranksLoading && !ranksError && participantRanks.length === 0 && (
            <div style={{ padding: '32px 24px', textAlign: 'center', border: '2px dashed #e2e8f0', borderRadius: 10, color: '#94a3b8', fontSize: 13 }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>🏆</div>
              אין נתוני ניקוד לקבוצה זו עדיין
            </div>
          )}
          {!ranksLoading && !ranksError && participantRanks.length > 0 && (
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#64748b', width: 40 }}>#</th>
                    <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#64748b' }}>שם</th>
                    <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#64748b' }}>סה״כ</th>
                    <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#64748b' }}>השבוע</th>
                    <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#64748b' }}>היום</th>
                    <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#64748b' }}>רצף</th>
                  </tr>
                </thead>
                <tbody>
                  {participantRanks.map((p) => {
                    const isInspected = inspectedParticipantId === p.participantId;
                    const medalColor = p.rank === 1 ? '#f59e0b' : p.rank === 2 ? '#94a3b8' : p.rank === 3 ? '#b45309' : '#e2e8f0';
                    const medalText = p.rank <= 3 ? '#fff' : '#64748b';
                    return (
                      <tr
                        key={p.participantId}
                        onClick={() => setInspectedParticipantId(p.participantId)}
                        style={{
                          borderBottom: '1px solid #f1f5f9',
                          cursor: 'pointer',
                          background: isInspected ? '#eff6ff' : undefined,
                          transition: 'background 0.1s',
                        }}
                      >
                        <td style={{ padding: '11px 14px' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: '50%', background: medalColor, color: medalText, fontSize: 12, fontWeight: 700 }}>
                            {p.rank}
                          </span>
                        </td>
                        <td style={{ padding: '11px 14px', fontWeight: 600, color: isInspected ? '#1d4ed8' : '#0f172a' }}>
                          {p.firstName}{p.lastName ? ' ' + p.lastName : ''}
                          {isInspected && <span style={{ fontSize: 10, marginRight: 6, color: '#2563eb' }}>▶</span>}
                        </td>
                        <td style={{ padding: '11px 14px', fontWeight: 700, color: '#2563eb' }}>{p.totalScore}</td>
                        <td style={{ padding: '11px 14px', color: '#374151' }}>{p.weekScore}</td>
                        <td style={{ padding: '11px 14px', color: '#374151' }}>{p.todayScore}</td>
                        <td style={{ padding: '11px 14px' }}>
                          {p.currentStreak > 0
                            ? <span style={{ background: '#fff7ed', color: '#c2410c', fontSize: 12, padding: '2px 8px', borderRadius: 20 }}>🔥 {p.currentStreak}</span>
                            : <span style={{ color: '#94a3b8' }}>—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Admin inspect panel ───────────────────────────────────────────── */}
          {inspectedParticipantId && (
            <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* Participant selector */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>פרטי משתתף:</span>
                <select
                  value={inspectedParticipantId}
                  onChange={(e) => setInspectedParticipantId(e.target.value)}
                  style={{ border: '1px solid #e2e8f0', borderRadius: 7, padding: '6px 10px', fontSize: 13, background: '#fff', color: '#0f172a', cursor: 'pointer' }}
                >
                  {participantRanks.map((p) => (
                    <option key={p.participantId} value={p.participantId}>
                      #{p.rank} {p.firstName}{p.lastName ? ' ' + p.lastName : ''} ({p.totalScore} נק׳)
                    </option>
                  ))}
                </select>
              </div>

              {/* נתונים — score cards */}
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 12 }}>נתונים</div>
                {adminStatsLoading ? (
                  <div style={{ color: '#94a3b8', fontSize: 13 }}>טוען...</div>
                ) : adminStats ? (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 10, marginBottom: 14 }}>
                      {[
                        { label: 'היום', value: adminStats.todayScore, color: '#2563eb', bg: '#eff6ff' },
                        { label: 'השבוע', value: adminStats.weekScore, color: '#7c3aed', bg: '#f5f3ff' },
                        { label: 'סה״כ', value: adminStats.totalScore, color: '#0f172a', bg: '#f1f5f9' },
                        { label: 'רצף נוכחי', value: adminStats.currentStreak, color: '#c2410c', bg: '#fff7ed', suffix: ' 🔥' },
                        { label: 'רצף שיא', value: adminStats.bestStreak, color: '#92400e', bg: '#fef3c7', suffix: ' ★' },
                      ].map(({ label, value, color, bg, suffix }) => (
                        <div key={label} style={{ background: bg, border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
                          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>{label}</div>
                          <div style={{ fontSize: 20, fontWeight: 800, color }}>{value}{suffix ?? ''}</div>
                        </div>
                      ))}
                    </div>
                    {/* 14-day trend bar chart */}
                    {adminStats.dailyTrend.length > 0 && (
                      <div>
                        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>14 ימים אחרונים</div>
                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 40 }}>
                          {adminStats.dailyTrend.map((d) => {
                            const maxPts = Math.max(...adminStats.dailyTrend.map((x) => x.points), 1);
                            const heightPct = (d.points / maxPts) * 100;
                            return (
                              <div
                                key={d.date}
                                title={`${d.date}: ${d.points} נק׳`}
                                style={{
                                  flex: 1, borderRadius: '2px 2px 0 0',
                                  background: d.points > 0 ? '#2563eb' : '#e2e8f0',
                                  height: `${Math.max(heightPct, d.points > 0 ? 8 : 3)}%`,
                                  minHeight: 3,
                                  transition: 'height 0.2s',
                                }}
                              />
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ color: '#94a3b8', fontSize: 13 }}>אין נתונים</div>
                )}
              </div>

              {/* מבזק — feed events */}
              <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
                {/* Header row: toggle (left) · title (center/right) · bulk actions (right) */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid #f1f5f9', background: '#f8fafc', gap: 10 }}>
                  {/* Toggle — LEFT side in RTL = appears leftmost visually */}
                  <button
                    onClick={() => setFeedShowAll((v) => { const next = !v; localStorage.setItem('admin_feed_show_all', String(next)); return next; })}
                    style={{
                      flexShrink: 0,
                      padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                      cursor: 'pointer', whiteSpace: 'nowrap' as const,
                      border: feedShowAll ? '1px solid #6366f1' : '1px solid #e2e8f0',
                      background: feedShowAll ? '#eef2ff' : '#f8fafc',
                      color: feedShowAll ? '#4338ca' : '#94a3b8',
                      transition: 'all 0.15s',
                    }}
                  >
                    {feedShowAll ? '✓ צפה בכולם יחד' : 'צפה בכולם יחד'}
                  </button>

                  <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', flex: 1, textAlign: 'right' }}>מבזק פעילות</div>

                  {/* Bulk actions */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    {selectedFeedIds.size > 0 && (
                      <button
                        onClick={handleBulkDelete}
                        disabled={bulkDeleting}
                        style={{
                          background: bulkDeleting ? '#fca5a5' : '#ef4444',
                          color: '#fff', border: 'none', borderRadius: 6,
                          padding: '5px 10px', fontSize: 12, fontWeight: 600,
                          cursor: bulkDeleting ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' as const,
                        }}
                      >
                        {bulkDeleting ? 'מוחק...' : `מחק ${selectedFeedIds.size}`}
                      </button>
                    )}
                    {selectedFeedIds.size > 0 && (
                      <button
                        onClick={() => setSelectedFeedIds(new Set())}
                        style={{ background: 'none', border: 'none', fontSize: 12, color: '#64748b', cursor: 'pointer', padding: '5px 4px' }}
                      >
                        בטל
                      </button>
                    )}
                  </div>
                </div>

                {adminFeedLoading && adminFeed.length === 0 ? (
                  <div style={{ padding: '20px 16px', color: '#94a3b8', fontSize: 13, textAlign: 'center' }}>טוען מבזק...</div>
                ) : !adminFeedLoading && !feedToggleLoading && adminFeed.length === 0 ? (
                  <div style={{ padding: '24px 16px', color: '#94a3b8', fontSize: 13, textAlign: 'center' }}>
                    אין פעולות להציג
                  </div>
                ) : (
                  <div style={{ maxHeight: 380, overflowY: 'auto', position: 'relative' }}>
                    {feedToggleLoading && (
                      <div style={{
                        position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.6)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        zIndex: 2, borderRadius: 4,
                      }}>
                        <div style={{
                          width: 18, height: 18, border: '2px solid #e2e8f0',
                          borderTopColor: '#6366f1', borderRadius: '50%',
                          animation: 'spin 0.7s linear infinite',
                        }} />
                      </div>
                    )}
                    {adminFeed.map((event) => {
                      const isSelected = selectedFeedIds.has(event.id);
                      const isDeleting = deletingFeedIds.has(event.id);
                      const dt = new Date(event.createdAt);
                      // Full date + time: "יום/חודש/שנה, HH:MM" in Israel timezone
                      const dateStr = dt.toLocaleDateString('he-IL', {
                        timeZone: 'Asia/Jerusalem',
                        day: '2-digit', month: '2-digit', year: 'numeric',
                      });
                      const timeStr = dt.toLocaleTimeString('he-IL', {
                        timeZone: 'Asia/Jerusalem',
                        hour: '2-digit', minute: '2-digit',
                      });
                      const fullDatetime = `${dateStr} ${timeStr}`;
                      const participantName = `${event.participant.firstName}${event.participant.lastName ? ' ' + event.participant.lastName : ''}`;
                      return (
                        <div
                          key={event.id}
                          style={{
                            display: 'flex', alignItems: 'flex-start', gap: 10,
                            padding: '9px 14px',
                            borderBottom: '1px solid #f8fafc',
                            background: isSelected ? '#fef2f2' : isDeleting ? '#fef9c3' : undefined,
                            opacity: isDeleting ? 0.5 : 1,
                            transition: 'background 0.1s, opacity 0.2s',
                          }}
                        >
                          {/* Checkbox */}
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={isDeleting}
                            onChange={(e) => {
                              setSelectedFeedIds((prev) => {
                                const n = new Set(prev);
                                if (e.target.checked) n.add(event.id); else n.delete(event.id);
                                return n;
                              });
                            }}
                            style={{ width: 16, height: 16, flexShrink: 0, cursor: 'pointer', marginTop: 2 }}
                          />

                          {/* Points badge */}
                          <span style={{
                            flexShrink: 0, minWidth: 36, textAlign: 'center',
                            background: '#eff6ff', color: '#1d4ed8',
                            border: '1px solid #bfdbfe', borderRadius: 6,
                            fontSize: 12, fontWeight: 700, padding: '2px 6px', marginTop: 1,
                          }}>
                            +{event.points}
                          </span>

                          {/* Main content: message + participant name (when all-together) + datetime */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            {/* Participant name — shown prominently in all-together mode */}
                            {feedShowAll && (
                              <div style={{
                                fontSize: 11, fontWeight: 700, color: '#6366f1',
                                marginBottom: 2, whiteSpace: 'nowrap' as const,
                                overflow: 'hidden', textOverflow: 'ellipsis',
                              }}>
                                {participantName}
                              </div>
                            )}
                            <div style={{ fontSize: 13, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                              {event.message}
                            </div>
                            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                              {fullDatetime}
                            </div>
                          </div>

                          {/* Delete */}
                          <button
                            onClick={() => handleDeleteFeedEvent(event.id)}
                            disabled={isDeleting}
                            title="מחק ונכה נקודות"
                            style={{
                              flexShrink: 0, background: 'none', border: 'none',
                              color: '#ef4444', cursor: isDeleting ? 'not-allowed' : 'pointer',
                              padding: '4px 6px', borderRadius: 5, fontSize: 14, lineHeight: 1,
                              opacity: isDeleting ? 0.4 : 1, marginTop: 1,
                            }}
                          >
                            🗑
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          MODAL — REMOVE PARTICIPANT CONFIRMATION
      ══════════════════════════════════════════════════════════════════════ */}
      {removeConfirm && (
        <Modal onClose={() => { setRemoveConfirm(null); setRemoveError(null); }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
            <h3 style={{ ...S.modalTitle, marginBottom: 8 }}>הסרת משתתפת</h3>
            <p style={{ fontSize: 15, color: '#374151', margin: '0 0 20px' }}>
              האם להסיר את <strong>{removeConfirm.name}</strong> מהקבוצה?
            </p>
            <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 20px' }}>
              הפעולה ניתנת לביטול — ניתן להוסיף את המשתתפת מחדש בכל עת.
            </p>
            {removeError && (
              <p style={{ fontSize: 13, color: '#ef4444', margin: '0 0 16px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '8px 12px' }}>
                {removeError}
              </p>
            )}
            <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
              <button
                onClick={() => { setRemoveConfirm(null); setRemoveError(null); }}
                disabled={!!removingParticipantId}
                style={S.btnSecondary}
              >
                ביטול
              </button>
              <button
                onClick={confirmRemoveParticipant}
                disabled={!!removingParticipantId}
                style={{
                  padding: '9px 22px', borderRadius: 8, border: 'none',
                  background: removingParticipantId ? '#fca5a5' : '#ef4444',
                  color: '#fff', fontSize: 14, fontWeight: 600,
                  cursor: removingParticipantId ? 'not-allowed' : 'pointer',
                }}
              >
                {removingParticipantId ? 'מסירה...' : 'הסר מהקבוצה'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          MODAL — EDIT GROUP
      ══════════════════════════════════════════════════════════════════════ */}
      {editModalOpen && (
        <Modal onClose={() => setEditModalOpen(false)} showCloseButton>
          <h2 style={S.modalTitle}>עריכת קבוצה</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={S.fieldLabel}>שם הקבוצה *</label>
              <input
                style={S.input}
                value={editForm.name}
                onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))}
                autoFocus
                placeholder="שם הקבוצה"
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={S.fieldLabel}>תאריך התחלה</label>
                <input
                  type="date"
                  style={{ ...S.input, direction: 'ltr' }}
                  value={editForm.startDate}
                  onChange={(e) => setEditForm((p) => ({ ...p, startDate: e.target.value }))}
                />
              </div>
              <div>
                <label style={S.fieldLabel}>תאריך סיום</label>
                <input
                  type="date"
                  style={{ ...S.input, direction: 'ltr' }}
                  value={editForm.endDate}
                  onChange={(e) => setEditForm((p) => ({ ...p, endDate: e.target.value }))}
                />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                type="checkbox"
                id="edit-isActive"
                checked={editForm.isActive}
                onChange={(e) => setEditForm((p) => ({ ...p, isActive: e.target.checked }))}
                style={{ width: 16, height: 16, cursor: 'pointer' }}
              />
              <label htmlFor="edit-isActive" style={{ fontSize: 14, color: '#374151', cursor: 'pointer' }}>קבוצה פעילה</label>
            </div>

            {/* ── Portal opening flow ──────────────────────────────────────── */}
            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 16, marginTop: 4 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>פתיחת הפורטל</div>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12, lineHeight: 1.5 }}>
                כשהשדות ריקים — הפורטל פתוח תמיד. כשמוגדרים — המשתתפות יראו מסך המתנה עד הזמן שנקבע.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <label style={{ ...S.fieldLabel, display: 'block', marginBottom: 4 }}>מועד שיחת הפתיחה</label>
                  <input
                    type="datetime-local"
                    style={{ ...S.input, direction: 'ltr', fontSize: 13 }}
                    value={editForm.portalCallTime}
                    onChange={(e) => setEditForm((p) => ({ ...p, portalCallTime: e.target.value }))}
                  />
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>
                    עד לזמן זה — ספירה לאחור. לאחריו — מסך ביניים.
                  </div>
                </div>
                <div>
                  <label style={{ ...S.fieldLabel, display: 'block', marginBottom: 4 }}>שעת פתיחה בפועל</label>
                  <input
                    type="datetime-local"
                    style={{ ...S.input, direction: 'ltr', fontSize: 13 }}
                    value={editForm.portalOpenTime}
                    onChange={(e) => setEditForm((p) => ({ ...p, portalOpenTime: e.target.value }))}
                  />
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>
                    מהזמן הזה — הפורטל נפתח לחלוטין.
                  </div>
                </div>
                {(editForm.portalCallTime || editForm.portalOpenTime) && (
                  <button
                    type="button"
                    onClick={() => setEditForm((p) => ({ ...p, portalCallTime: '', portalOpenTime: '' }))}
                    style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: 12, cursor: 'pointer', padding: 0, textAlign: 'right' }}
                  >
                    נקה זמני פתיחה ←
                  </button>
                )}
              </div>
            </div>

            {editError && <div style={{ color: '#dc2626', fontSize: 13 }}>{editError}</div>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
              <button onClick={() => setEditModalOpen(false)} style={S.btnSecondary}>ביטול</button>
              <button
                onClick={handleEditSave}
                disabled={editSaving}
                style={{ padding: '9px 22px', borderRadius: 8, border: 'none', background: editSaving ? '#93c5fd' : '#2563eb', color: '#fff', fontSize: 14, fontWeight: 600, cursor: editSaving ? 'not-allowed' : 'pointer' }}
              >
                {editSaving ? 'שומר...' : 'שמור'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          MODAL — DELETE GROUP
      ══════════════════════════════════════════════════════════════════════ */}
      {deleteModalOpen && (
        <Modal onClose={() => !deleting && setDeleteModalOpen(false)}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🗑️</div>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', margin: '0 0 10px' }}>מחיקת קבוצה</h2>
            <p style={{ fontSize: 14, color: '#374151', margin: '0 0 6px' }}>
              האם למחוק את הקבוצה <strong>&ldquo;{group.name}&rdquo;</strong>?
            </p>
            <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 20px', lineHeight: 1.5 }}>
              הקבוצה תסומן כלא פעילה ולא תופיע ברשימות. המשתתפות והנתונים נשמרים.
            </p>
            {deleteError && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{deleteError}</div>}
            <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
              <button
                onClick={() => setDeleteModalOpen(false)}
                disabled={deleting}
                style={S.btnSecondary}
              >
                ביטול
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                style={{ padding: '9px 22px', borderRadius: 8, border: 'none', background: deleting ? '#fca5a5' : '#ef4444', color: '#fff', fontSize: 14, fontWeight: 600, cursor: deleting ? 'not-allowed' : 'pointer' }}
              >
                {deleting ? 'מוחק...' : 'מחק קבוצה'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          MODAL — GROUP MESSAGE COMPOSER (WhatsAppEditor)
      ══════════════════════════════════════════════════════════════════════ */}
      {msgModalOpen && (
        <Modal onClose={() => setMsgModalOpen(false)} disableBackdropClose showCloseButton>
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

          {/* Template picker trigger */}
          {templates.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <button
                type="button"
                onClick={() => setTemplatePickerOpen((v) => !v)}
                style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 7, padding: '6px 14px', fontSize: 13, color: '#0369a1', cursor: 'pointer', fontWeight: 500 }}
              >
                📋 בחר נוסח {templatePickerOpen ? '▲' : '▼'}
              </button>
              {templatePickerOpen && (
                <div style={{ marginTop: 8, border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
                  {templates.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        setTemplatePickerOpen(false);
                        if (msgText.trim()) {
                          setTemplateConfirm({ content: t.content });
                        } else {
                          setMsgText(t.content);
                        }
                      }}
                      style={{
                        display: 'block', width: '100%', textAlign: 'right' as const,
                        padding: '10px 14px', background: 'none', border: 'none',
                        borderBottom: '1px solid #f1f5f9', cursor: 'pointer',
                        fontSize: 13,
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#f8fafc'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
                    >
                      <div style={{ fontWeight: 600, color: '#0f172a', marginBottom: 2 }}>{t.name}</div>
                      <div style={{ color: '#64748b', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.content}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

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

      {/* ── Template overwrite confirmation ── */}
      {templateConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, maxWidth: 320, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <p style={{ fontSize: 15, color: '#0f172a', margin: '0 0 20px', lineHeight: 1.5 }}>
              יש טקסט קיים. האם להחליף אותו בנוסח שנבחר?
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setTemplateConfirm(null)}
                style={{ background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 7, padding: '9px 18px', fontSize: 13, cursor: 'pointer' }}
              >
                בטל
              </button>
              <button
                onClick={() => { setMsgText(templateConfirm.content); setTemplateConfirm(null); }}
                style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 7, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
              >
                החלף
              </button>
            </div>
          </div>
        </div>
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

function Modal({
  children,
  onClose,
  disableBackdropClose = false,
  showCloseButton = false,
}: {
  children: React.ReactNode;
  onClose: () => void;
  disableBackdropClose?: boolean;
  showCloseButton?: boolean;
}) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={(e) => { if (!disableBackdropClose && e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ position: 'relative', background: '#fff', borderRadius: 14, width: '100%', maxWidth: 520, padding: 28, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', maxHeight: '90vh', overflowY: 'auto' }}>
        {showCloseButton && (
          <button
            onClick={onClose}
            aria-label="סגור"
            style={{
              position: 'absolute', top: 14, left: 14,
              width: 30, height: 30, borderRadius: '50%',
              border: '1px solid #e2e8f0', background: '#f8fafc',
              color: '#64748b', fontSize: 16, lineHeight: 1,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 0,
            }}
          >
            ✕
          </button>
        )}
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
