'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { BASE_URL, apiFetch } from '@lib/api';
import WhatsAppEditor from '@components/whatsapp-editor';
import { VariableButtonBar, type VariableEditorHandle } from '@components/variable-button-bar';
import { ChatMessage, ChatMessageList } from '@components/chat-messages';
import { WhatsAppIcon } from '@components/icons/whatsapp-icon';
import { ParticipantPrivateChatPopup } from '@components/participant-private-chat-popup';
import { MessageComposer, loadProgramTemplates } from '@components/message-composer';
import { StrongModal } from '@components/strong-modal';

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
  // Captured by the bridge on chat first-create from Baileys'
  // socket.profilePictureUrl. Null when WhatsApp didn't return one
  // (no picture set, restrictive privacy, transient failure).
  // Optional in this interface so older API responses (pre-migration)
  // don't TS-fail in strict mode.
  profilePictureUrl?: string | null;
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

// Stable hue from a string. The avatar bubble's background color is
// hash(name)-derived so two chats with similar names get distinct
// colors that survive across renders. Used inside the link-chat modal
// where we have no profile image to show — initial-letter bubbles are
// the next-best visual differentiator.
function colorFromKey(key: string): { bg: string; fg: string } {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return { bg: `hsl(${hue}, 65%, 88%)`, fg: `hsl(${hue}, 60%, 35%)` };
}

// First grapheme of the most informative field. Hebrew letters,
// emoji, latin all behave correctly under Array.from (which iterates
// codepoints, not surrogate pairs).
function chatInitial(chat: WhatsAppChat): string {
  const src = chat.name?.trim() || chat.phoneNumber || chat.externalChatId;
  return Array.from(src ?? '?')[0] ?? '?';
}

// Avatar circle for a chat. Shows the WhatsApp profile / group
// picture when present (object-fit: cover keeps the circle clean
// regardless of source aspect ratio), and falls back to the
// initial-letter bubble when:
//   * the chat has no profilePictureUrl persisted (legacy rows
//     pre-bridge-hook, or chats where WhatsApp didn't expose one)
//   * the image fails to load at runtime (URL expired, network
//     error) — onError flips an internal flag and the fallback
//     paints in place without a layout shift, since the wrapper's
//     dimensions are fixed.
function ChatAvatar({ chat, size = 36 }: { chat: WhatsAppChat; size?: number }) {
  const [errored, setErrored] = useState(false);
  const initial = chatInitial(chat);
  const palette = colorFromKey(chat.id);
  const showImage = !!chat.profilePictureUrl && !errored;
  const fontSize = Math.round(size * 0.42);
  return (
    <span
      style={{
        width: size, height: size, flexShrink: 0,
        borderRadius: '50%',
        // The fallback palette is always set, so the placeholder shows
        // through during the brief moment between mount and image
        // decode. No flash-of-empty-circle.
        background: palette.bg,
        color: palette.fg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize, fontWeight: 700,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={chat.profilePictureUrl as string}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setErrored(true)}
          style={{
            width: '100%', height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
        />
      ) : (
        initial
      )}
    </span>
  );
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

type Tab = 'overview' | 'participants' | 'questionnaires' | 'tasks' | 'communication' | 'scheduled';

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
  // Phase 6.15: admin delete dispatches on type — 'action' voids the underlying
  // log via voidLog; 'rare'/'system' writes a compensating ScoreEvent. The
  // backend figures this out from the row; we just need the metadata exposed.
  type: string;
  logId: string | null;
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

  // Questionnaire completion tracking modal — opens with a template
  // when the admin clicks "מעקב מילוי" on a row in the שאלונים tab.
  // Holds the template metadata so the modal header can render before
  // the completion fetch resolves.
  const [trackingTemplate, setTrackingTemplate] = useState<QTemplate | null>(null);

  // Bulk move — selected participant IDs + destination picker visibility.
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Per-participant private-chat popup. Stores the participant id +
  // display name of the row that's currently open. Closed when null.
  // Reads/writes the same PrivateScheduledMessage rows the participant
  // profile chat tab does — single source of truth keyed on
  // participantId.
  const [chatPopup, setChatPopup] = useState<
    { participantId: string; participantName: string } | null
  >(null);
  // Per-participant pending-scheduled-message counts, used to render a
  // small clock badge on each row when there's at least one upcoming
  // private DM. Loaded from a single batched endpoint so adding a
  // participant doesn't fan out into N round trips.
  const [scheduledCounts, setScheduledCounts] = useState<Record<string, number>>({});

  // Tab
  const [tab, setTab] = useState<Tab>('participants');

  // Chat tab — selectedChatLinkId picks WHICH linked group_chat to
  // display when the group has multiple WhatsApp groups linked. Falls
  // back to the first group_chat link when null. Multi-chat support
  // is intentional: a single group can be tied to several WhatsApp
  // groups (different timezones, replacement chat after migration,
  // dual instructor channels, etc.) and the admin needs to switch
  // between them inside this tab without leaving the page.
  const [selectedChatLinkId, setSelectedChatLinkId] = useState<string | null>(null);
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
  // Confirm before feed delete — set to trigger modal, null when dismissed
  const [feedDeleteConfirm, setFeedDeleteConfirm] = useState<
    { type: 'single'; id: string } | { type: 'bulk'; ids: string[] } | null
  >(null);

  // Group message modal
  const [msgModalOpen, setMsgModalOpen] = useState(false);
  const [msgText, setMsgText] = useState('');
  const [msgSending, setMsgSending] = useState(false);
  const [msgError, setMsgError] = useState('');
  const [msgSuccess, setMsgSuccess] = useState(false);
  // In-app confirm: closing the composer with unsaved edits asks
  // "are you sure?" instead of dropping the text silently. Replaces
  // any window.confirm — none used in this surface.
  const [msgCloseConfirm, setMsgCloseConfirm] = useState(false);
  // Template picker
  const [templates, setTemplates] = useState<{ id: string; name: string; content: string }[]>([]);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [templateConfirm, setTemplateConfirm] = useState<{ content: string } | null>(null);

  // Composer close gate. Routes through the in-app confirm when the
  // textarea has unsent content; otherwise closes immediately. Used by
  // X / ביטול / Modal's onClose.
  const requestMsgClose = () => {
    if (msgSending) return;
    if (msgText.trim() && !msgSuccess) {
      setMsgCloseConfirm(true);
      return;
    }
    setMsgModalOpen(false);
  };

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
  // Search inside the link-chat modal. Cleared when the modal opens
  // and on type switch so each new flow starts with a clean list.
  const [chatSearch, setChatSearch] = useState('');
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
      router.replace(`/admin/groups/${id}`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, group]);

  // ─── Templates: fetch once when message modal first opens ────────────────

  // Phase 4 cleanup: templates now live in the unified CommunicationTemplate
  // model. The composer only cares about whatsapp templates, so filter
  // server-side. We adapt the response shape back to { name, content } so
  // the existing picker UI doesn't need changes.
  const templatesFetched = useRef(false);
  useEffect(() => {
    if (!msgModalOpen || templatesFetched.current || !group?.programId) return;
    templatesFetched.current = true;
    apiFetch<{ id: string; title: string; body: string }[]>(
      `${BASE_URL}/programs/${group.programId}/communication-templates?channel=whatsapp`,
      { cache: 'no-store' },
    )
      .then((rows) => setTemplates(rows.map((r) => ({ id: r.id, name: r.title, content: r.body }))))
      .catch(() => {});
  }, [msgModalOpen, group?.programId]);

  // ─── Chat thread: lazy-load when user opens the תקשורת tab ────────────────

  useEffect(() => {
    if (tab !== 'communication') return;
    // All group-type links available for switching. We don't include
    // private participant chats here — they have their own popup
    // surface from the participants list.
    const groupChatLinks = links.filter((l) => l.linkType === 'group_chat');
    if (groupChatLinks.length === 0) return;
    // Default the selection if none is set, or if the saved one is
    // no longer in the list (e.g. admin deleted a link).
    const activeLink =
      groupChatLinks.find((l) => l.id === selectedChatLinkId) ?? groupChatLinks[0];
    if (activeLink.id !== selectedChatLinkId) {
      setSelectedChatLinkId(activeLink.id);
    }
    setChatLoading(true);
    setChatError(false);
    apiFetch<ChatDetail>(`${BASE_URL}/wassenger/chats/${activeLink.whatsappChatId}`)
      .then((data) => setChatDetail(data))
      .catch(() => setChatError(true))
      .finally(() => setChatLoading(false));
  }, [tab, links, selectedChatLinkId]);

  useEffect(() => {
    if (tab === 'communication' && chatDetail && chatBottomRef.current) {
      chatBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [tab, chatDetail]);

  // ─── Leaderboard: lazy-load when user opens the ביצועים ודירוגים tab ──────

  useEffect(() => {
    if (tab !== 'overview' || !id) return;
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

  // ── Gate functions: open confirm modal instead of deleting directly ──────

  function handleDeleteFeedEvent(feedEventId: string) {
    setFeedDeleteConfirm({ type: 'single', id: feedEventId });
  }

  function handleBulkDelete() {
    const ids = Array.from(selectedFeedIds);
    if (ids.length === 0) return;
    setFeedDeleteConfirm({ type: 'bulk', ids });
  }

  // ── Actual delete — only called after modal confirmation ─────────────────

  async function doDeleteFeedEvent(feedEventId: string) {
    setDeletingFeedIds((prev) => new Set(prev).add(feedEventId));
    try {
      await apiFetch(`${BASE_URL}/game/admin/feed/${feedEventId}`, { method: 'DELETE' });
      setAdminFeed((prev) => prev.filter((e) => e.id !== feedEventId));
      setSelectedFeedIds((prev) => { const n = new Set(prev); n.delete(feedEventId); return n; });
      reloadAfterDelete();
    } catch (e) {
      // Phase 6.15: surface errors instead of swallowing them silently.
      // Silent catches masked the old 410 Gone from the disabled path and
      // made the feature look broken without any admin-visible signal.
      const msg =
        e && typeof e === 'object' && 'message' in e
          ? String((e as { message?: unknown }).message ?? '')
          : '';
      alert(msg || 'שגיאה במחיקה. נסי שוב.');
    } finally {
      setDeletingFeedIds((prev) => { const n = new Set(prev); n.delete(feedEventId); return n; });
    }
  }

  async function doBulkDelete(ids: string[]) {
    if (ids.length === 0) return;
    setBulkDeleting(true);
    try {
      const res = (await apiFetch(`${BASE_URL}/game/admin/feed/bulk-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })) as { results?: Array<{ feedEventId: string; ok: boolean; error?: string }> };
      // Phase 6.15: partial-failure aware. Only remove rows the server
      // confirmed. Surface any failures to the admin.
      const okIds = new Set((res.results ?? []).filter((r) => r.ok).map((r) => r.feedEventId));
      const failures = (res.results ?? []).filter((r) => !r.ok);
      setAdminFeed((prev) => prev.filter((e) => !okIds.has(e.id)));
      setSelectedFeedIds((prev) => {
        const n = new Set(prev);
        for (const id of okIds) n.delete(id);
        return n;
      });
      reloadAfterDelete();
      if (failures.length > 0) {
        alert(
          `חלק מהפריטים לא נמחקו (${failures.length} מתוך ${ids.length}). ` +
          `שגיאה ראשונה: ${failures[0].error ?? 'לא ידוע'}`,
        );
      }
    } catch (e) {
      const msg =
        e && typeof e === 'object' && 'message' in e
          ? String((e as { message?: unknown }).message ?? '')
          : '';
      alert(msg || 'שגיאה במחיקה מרובה.');
    } finally {
      setBulkDeleting(false);
    }
  }

  async function confirmFeedDelete() {
    if (!feedDeleteConfirm) return;
    const pending = feedDeleteConfirm;
    setFeedDeleteConfirm(null);
    if (pending.type === 'single') {
      await doDeleteFeedEvent(pending.id);
    } else {
      await doBulkDelete(pending.ids);
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
      router.push('/admin/groups');
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
      // Phase 3 — sends via the Baileys bridge proxy. Same payload
      // shape as the legacy /wassenger/send route the group page
      // used to call (phone OR group JID + message). The proxy
      // returns 503 with a Hebrew message when WhatsApp isn't
      // connected; we propagate it verbatim into the toast.
      await apiFetch(`${BASE_URL}/admin/whatsapp/send`, {
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
    setChatSearch('');
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

  // Per-row scheduled-DM count badge. Refetches whenever the list of
  // participant ids in this group changes OR after the popup closes
  // (so editing/cancelling inside the popup updates the badge here too,
  // since the popup is reading the same PrivateScheduledMessage rows
  // by participantId — single source of truth).
  const participantIdsKey = participants.map((pg) => pg.participantId).sort().join(',');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!id || participantIdsKey === '') {
        setScheduledCounts({});
        return;
      }
      try {
        const counts = await apiFetch<Record<string, number>>(
          `${BASE_URL}/groups/${id}/participant-scheduled-counts?participantIds=${encodeURIComponent(participantIdsKey)}`,
          { cache: 'no-store' },
        );
        if (!cancelled) setScheduledCounts(counts);
      } catch {
        // Badge is decorative — silent failure is fine, the row just
        // doesn't show a clock indicator.
        if (!cancelled) setScheduledCounts({});
      }
    })();
    return () => { cancelled = true; };
  }, [id, participantIdsKey, chatPopup]);
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
        <Link href="/admin/groups" style={{ color: '#2563eb', fontSize: 14 }}>← חזרה לרשימה</Link>
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 20px' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* ── Back ── */}
      <Link href="/admin/groups" style={{ color: '#64748b', fontSize: 14, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 20 }}>
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
                  <Link href={`/admin/programs/${group.program.id}`} style={{ textDecoration: 'none' }}>
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
              <WhatsAppIcon size={16} color="#fff" />
              הודעה
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
      <div
        style={{
          display: 'flex',
          gap: 4,
          marginBottom: 20,
          borderBottom: '2px solid #e2e8f0',
          paddingBottom: 0,
          overflowX: 'auto',          // mobile: tabs scroll horizontally if too many
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {([
          ['participants', 'משתתפות'],
          ['overview', 'ביצועים ודירוגים'],
          ['questionnaires', 'שאלונים'],
          ['tasks', 'משימות'],
          ['scheduled', 'הודעות מתוזמנות'],
          ['communication', 'צ׳אטים'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: '10px 18px', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600,
              background: 'none', borderBottom: tab === key ? '2px solid #2563eb' : '2px solid transparent',
              color: tab === key ? '#2563eb' : '#64748b',
              marginBottom: -2,
              whiteSpace: 'nowrap',     // keep each tab on one line
              flexShrink: 0,
            }}
          >
            {label}
            {key === 'communication' && !groupChatLink && (
              <span style={{ marginRight: 6, fontSize: 11, color: '#94a3b8', fontWeight: 400 }}>(אין קישור)</span>
            )}
          </button>
        ))}
      </div>

      {/* The "תוכנית משויכת" section that used to live here was moved
          into the משתתפות tab so it sits directly above the roster.
          The remaining content for the ביצועים ודירוגים tab — leaderboard
          + admin inspect panel — is rendered further down. */}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: QUESTIONNAIRES
      ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'questionnaires' && (
        <>
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                        <button
                          type="button"
                          onClick={() => setTrackingTemplate(q)}
                          style={{
                            fontSize: 12, color: '#1d4ed8', background: '#eff6ff',
                            border: '1px solid #bfdbfe', borderRadius: 6,
                            padding: '4px 10px', cursor: 'pointer', fontWeight: 600,
                          }}
                        >
                          מעקב מילוי
                        </button>
                        <Link href={`/admin/questionnaires/${q.id}`}
                          style={{ fontSize: 12, color: '#6b7280', padding: '3px 8px', textDecoration: 'none' }}>
                          ערוך ↗
                        </Link>
                      </div>
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
                        אין לינקים חיצוניים — <Link href={`/admin/questionnaires/${q.id}`} style={{ color: '#1d4ed8' }}>צור לינק בעורך</Link>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>

        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: TASKS
      ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'tasks' && (
        <>
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
                          <Link href={`/admin/participants/${p.id}?tab=goals`}
                            style={{ fontWeight: 600, fontSize: 14, color: '#0f172a', textDecoration: 'none' }}>
                            {displayName(p)}
                          </Link>
                        </div>
                        <Link href={`/admin/tasks/portal/${p.id}`}
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

        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: SCHEDULED MESSAGES
      ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'scheduled' && (
        <GroupScheduledMessagesTab groupId={id} hasProgram={!!group.programId} />
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: PARTICIPANTS
      ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'participants' && (
        <>
          {/* ── Section: linked program (moved here from former 'overview' tab) ── */}
          <Section title="תוכנית משויכת" icon="⚡">
            {group.program ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 15, color: '#0f172a' }}>{group.program.name}</div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                    {group.program.isActive ? 'פעילה' : 'לא פעילה'}
                  </div>
                </div>
                <Link href={`/admin/programs/${group.program.id}`}
                  style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid #bfdbfe', color: '#1d4ed8', fontSize: 13, fontWeight: 500, textDecoration: 'none', background: '#eff6ff' }}>
                  פתח תוכנית ↗
                </Link>
              </div>
            ) : (
              <p style={{ color: '#94a3b8', fontSize: 14, margin: 0 }}>לא שויכה תוכנית לקבוצה זו.</p>
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
                {/* Bulk selection toolbar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0 10px', borderBottom: '1px solid #f1f5f9', flexWrap: 'wrap' as const }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748b', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={bulkSelected.size === participants.length && participants.length > 0}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setBulkSelected(new Set(participants.map((pg) => pg.participantId)));
                        } else {
                          setBulkSelected(new Set());
                        }
                      }}
                    />
                    בחרי הכל
                  </label>
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    {bulkSelected.size > 0 ? `${bulkSelected.size} נבחרו` : ''}
                  </div>
                  {bulkSelected.size > 0 && (
                    <div style={{ display: 'flex', gap: 6, marginInlineStart: 'auto' }}>
                      <button
                        onClick={() => setBulkMoveOpen(true)}
                        style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, background: '#0891b2', color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer' }}
                      >📂 העבירי לקבוצה…</button>
                      <button
                        onClick={() => setBulkSelected(new Set())}
                        style={{ padding: '6px 10px', fontSize: 12, background: 'transparent', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: 7, cursor: 'pointer' }}
                      >נקה בחירה</button>
                    </div>
                  )}
                </div>
                {participants.map((pg, idx) => {
                  const p = pg.participant;
                  const privateChat = privateChatByParticipant.get(p.id);
                  const hasToken = !!pg.accessToken;
                  const isRemoving = removingParticipantId === p.id;
                  const isSelected = bulkSelected.has(pg.participantId);

                  return (
                    <div
                      key={pg.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0',
                        borderBottom: idx < participants.length - 1 ? '1px solid #f1f5f9' : 'none',
                        opacity: isRemoving ? 0.5 : 1,
                        background: isSelected ? '#eff6ff' : 'transparent',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          const next = new Set(bulkSelected);
                          if (e.target.checked) next.add(pg.participantId);
                          else next.delete(pg.participantId);
                          setBulkSelected(next);
                        }}
                        style={{ flexShrink: 0 }}
                      />

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
                        <Link href={`/admin/participants/${p.id}`}
                          style={{ fontWeight: 600, fontSize: 14, color: '#0f172a', textDecoration: 'none' }}>
                          {displayName(p)}
                        </Link>
                        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 1, direction: 'ltr', textAlign: 'right' }}>
                          {p.phoneNumber}
                        </div>
                      </div>

                      {/* Actions */}
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {/* Unified WhatsApp action — opens the locked
                            private-chat popup whether or not the
                            participant has a linked WA chat yet. The
                            popup itself fetches inbound + outbound
                            from WhatsAppMessage by phone, so the same
                            UX works in both cases. The clock badge
                            surfaces upcoming PrivateScheduledMessage
                            rows for this participant — same row data
                            the popup will show, fetched in one batched
                            call from /participant-scheduled-counts. */}
                        {(() => {
                          const pendingCount = scheduledCounts[p.id] ?? 0;
                          return (
                            <button
                              type="button"
                              onClick={() => setChatPopup({ participantId: p.id, participantName: displayName(p) })}
                              title={privateChat ? 'פתח צ׳אט פרטי' : 'פתח שיחה / שלח הודעה'}
                              style={{
                                padding: '5px 10px', borderRadius: 6,
                                border: '1px solid #bbf7d0',
                                color: '#16a34a', background: '#f0fdf4',
                                fontSize: 12, fontWeight: 500,
                                cursor: 'pointer',
                                display: 'flex', alignItems: 'center', gap: 6,
                                position: 'relative',
                              }}
                            >
                              <WhatsAppIcon size={14} color="#16a34a" />
                              <span>צ׳אט</span>
                              {pendingCount > 0 && (
                                <span
                                  title={`${pendingCount} הודעות מתוזמנות`}
                                  style={{
                                    background: '#f59e0b',
                                    color: '#fff',
                                    fontSize: 10,
                                    fontWeight: 700,
                                    borderRadius: 999,
                                    padding: '1px 6px',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 3,
                                  }}
                                >
                                  ⏰ {pendingCount}
                                </span>
                              )}
                            </button>
                          );
                        })()}

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

        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: COMMUNICATION (#1) — WhatsApp links section
          The chat thread block (further down) also renders under this tab.
      ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'communication' && (
        <>
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
                      <Link href={`/admin/chats/${link.whatsappChatId}`}
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
          TAB: COMMUNICATION (#2) — WhatsApp chat thread (multi-chat aware)
      ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'communication' && (() => {
        const groupChatLinks = links.filter((l) => l.linkType === 'group_chat');
        const activeLink = groupChatLinks.find((l) => l.id === selectedChatLinkId) ?? groupChatLinks[0] ?? null;
        return (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
          {/* Chat switcher — only rendered when multiple group chats are
              linked. Each pill switches the active link, which the
              chat-detail effect picks up to refetch. There's no DB or
              API limit on linked-chat count; we cap the visible row
              with horizontal scroll if it ever overflows. */}
          {groupChatLinks.length > 1 && (
            <div
              style={{
                display: 'flex', gap: 6, padding: '10px 12px',
                borderBottom: '1px solid #e2e8f0',
                background: '#f8fafc',
                overflowX: 'auto',
                whiteSpace: 'nowrap',
              }}
            >
              {groupChatLinks.map((l) => {
                const active = l.id === activeLink?.id;
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => setSelectedChatLinkId(l.id)}
                    style={{
                      padding: '6px 12px',
                      fontSize: 12,
                      fontWeight: 600,
                      borderRadius: 999,
                      border: `1px solid ${active ? '#2563eb' : '#cbd5e1'}`,
                      background: active ? '#eff6ff' : '#fff',
                      color: active ? '#1d4ed8' : '#475569',
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    👥 {chatDisplayName(l.whatsappChat)}
                  </button>
                );
              })}
            </div>
          )}
          {!activeLink ? (
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
                <Link href={`/admin/chats/${activeLink.whatsappChatId}`}
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
        );
      })()}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: ביצועים ודירוגים — leaderboard / key stats
      ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'overview' && (
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
                {/* Header row: title (right, first in DOM) · controls (left, last in DOM) */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid #f1f5f9', background: '#f8fafc', gap: 10 }}>
                  {/* Title — first in DOM = rightmost in RTL */}
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', flexShrink: 0 }}>מבזק פעילות</div>

                  {/* Controls — last in DOM = leftmost in RTL */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    {/* Select All / Deselect All */}
                    {adminFeed.length > 0 && (
                      <button
                        onClick={() => {
                          const allSelected = adminFeed.length > 0 && adminFeed.every((e) => selectedFeedIds.has(e.id));
                          setSelectedFeedIds(allSelected ? new Set() : new Set(adminFeed.map((e) => e.id)));
                        }}
                        style={{ background: 'none', border: 'none', fontSize: 12, color: '#64748b', cursor: 'pointer', padding: '5px 4px', whiteSpace: 'nowrap' as const }}
                      >
                        {adminFeed.length > 0 && adminFeed.every((e) => selectedFeedIds.has(e.id)) ? 'בטל בחירה' : 'סמן הכל'}
                      </button>
                    )}
                    {/* Bulk delete */}
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
                    {/* Divider before toggle when actions visible */}
                    {selectedFeedIds.size > 0 && (
                      <div style={{ width: 1, height: 16, background: '#e2e8f0', flexShrink: 0 }} />
                    )}
                    {/* Toggle — צפה בכולם יחד */}
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
          MODAL — FEED DELETE CONFIRMATION
      ══════════════════════════════════════════════════════════════════════ */}
      {feedDeleteConfirm && (
        <Modal onClose={() => setFeedDeleteConfirm(null)} disableBackdropClose>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🗑️</div>
            <h3 style={{ ...S.modalTitle, marginBottom: 8 }}>מחיקת פעילות</h3>
            <p style={{ fontSize: 14, color: '#374151', margin: '0 0 24px', lineHeight: 1.6 }}>
              {feedDeleteConfirm.type === 'single'
                ? 'האם למחוק את הפעילות הזו?'
                : `האם למחוק ${feedDeleteConfirm.ids.length} פעילויות?`}
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
              <button onClick={() => setFeedDeleteConfirm(null)} style={S.btnSecondary}>ביטול</button>
              <button
                onClick={confirmFeedDelete}
                style={{ padding: '9px 22px', borderRadius: 8, border: 'none', background: '#ef4444', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
              >
                מחק
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          MODAL — GROUP MESSAGE (one-time send-or-schedule)
      ══════════════════════════════════════════════════════════════════════ */}
      {msgModalOpen && (
        <GroupOneTimeMessageModal
          groupId={id}
          groupChatJid={groupChatLink?.whatsappChat?.externalChatId ?? null}
          groupChatName={groupChatLink ? chatDisplayName(groupChatLink.whatsappChat) : '(לא מקושר)'}
          programId={group?.programId ?? null}
          onClose={() => setMsgModalOpen(false)}
          onSaved={() => setMsgModalOpen(false)}
        />
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          MODAL — QUESTIONNAIRE COMPLETION TRACKING
      ══════════════════════════════════════════════════════════════════════ */}
      {trackingTemplate && (
        <CompletionTrackingModal
          groupId={id}
          template={trackingTemplate}
          onClose={() => setTrackingTemplate(null)}
        />
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          MODAL — ADD PARTICIPANT
      ══════════════════════════════════════════════════════════════════════ */}
      {bulkMoveOpen && (
        <BulkMoveModal
          fromGroupId={id}
          currentGroupName={group?.name ?? ''}
          selectedIds={Array.from(bulkSelected)}
          busy={bulkBusy}
          onClose={() => setBulkMoveOpen(false)}
          onMove={async (toGroupId) => {
            setBulkBusy(true);
            try {
              await apiFetch(`${BASE_URL}/groups/${toGroupId}/participants/bulk-move`, {
                method: 'POST',
                body: JSON.stringify({
                  participantIds: Array.from(bulkSelected),
                  fromGroupId: id,
                }),
              });
              setBulkSelected(new Set());
              setBulkMoveOpen(false);
              // Simple refresh — rebuilds participants list + counts.
              window.location.reload();
            } catch (e) {
              alert(e instanceof Error ? e.message : 'העברה נכשלה');
            } finally { setBulkBusy(false); }
          }}
        />
      )}

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
          MODAL — LINK CHAT  (redesigned, type-first → search → list)
      ══════════════════════════════════════════════════════════════════════ */}
      {linkModalOpen && (() => {
        // Filter the available chats by the selected link type FIRST.
        // selectedLinkType=='group_chat' → only c.type=='group'.
        // selectedLinkType=='private_participant_chat' → only c.type=='private'.
        // Then by the search term — case-insensitive match against
        // name + phoneNumber + externalChatId. Filtering is purely
        // client-side: the data is already in availableChats.
        const wantType = selectedLinkType === 'group_chat' ? 'group' : 'private';
        const lower = chatSearch.trim().toLowerCase();
        const matches = pickableChats
          .filter((c) => c.type === wantType)
          .filter((c) => {
            if (!lower) return true;
            const hay = `${c.name ?? ''} ${c.phoneNumber ?? ''} ${c.externalChatId}`.toLowerCase();
            return hay.includes(lower);
          });

        return (
          <Modal onClose={() => setLinkModalOpen(false)}>
            <h3 style={S.modalTitle}>קשרי צ׳אט קיים</h3>

            {/* Step 1 — type picker. Two big cards. Selecting one sets
                BOTH the link type AND filters the chat list. Resets
                the chat selection + search when the type changes so
                stale state from the previous type doesn't bleed through. */}
            <div style={{ marginBottom: 14 }}>
              <label style={S.fieldLabel}>סוג חיבור</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {([
                  ['group_chat', '👥', 'קבוצת וואטסאפ', 'צ׳אט קבוצתי משותף לכל המשתתפות'],
                  ['private_participant_chat', '👤', 'צ׳אט פרטי', 'צ׳אט אישי עם משתתפת אחת'],
                ] as const).map(([val, emoji, label, hint]) => {
                  const active = selectedLinkType === val;
                  return (
                    <button
                      key={val}
                      type="button"
                      onClick={() => {
                        if (selectedLinkType !== val) {
                          setSelectedLinkType(val);
                          setSelectedChatId('');
                          setSelectedParticipantId('');
                          setChatSearch('');
                        }
                      }}
                      style={{
                        textAlign: 'right',
                        display: 'flex', flexDirection: 'column', gap: 4,
                        padding: '14px 14px',
                        background: active ? '#eff6ff' : '#fff',
                        border: `2px solid ${active ? '#2563eb' : '#e2e8f0'}`,
                        borderRadius: 10,
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ fontSize: 22 }}>{emoji}</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: active ? '#1d4ed8' : '#0f172a' }}>{label}</div>
                      <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.45 }}>{hint}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Step 2 — search + filtered chat list. Only shown after a
                type is picked (technically selectedLinkType always has
                a value since it defaults to 'group_chat', but we still
                guard for clarity if someone changes the default). */}
            <div style={{ marginBottom: 14 }}>
              <label style={S.fieldLabel}>
                בחר/י {selectedLinkType === 'group_chat' ? 'קבוצת וואטסאפ' : 'צ׳אט פרטי'}
              </label>

              {chatsLoading ? (
                <div style={{ color: '#94a3b8', fontSize: 13, padding: '12px 0' }}>טוען צ׳אטים...</div>
              ) : pickableChats.length === 0 ? (
                <div style={{ color: '#94a3b8', fontSize: 13, padding: '12px 0' }}>
                  {availableChats.length === 0 ? 'אין צ׳אטים זמינים (הרץ backfill תחילה)' : 'כל הצ׳אטים כבר מקושרים.'}
                </div>
              ) : (
                <>
                  {/* Search input with magnifier glyph. Instant filtering.
                      Mobile-friendly: enough padding for tap, font-size
                      16+ to suppress iOS auto-zoom on focus. */}
                  <div style={{ position: 'relative', marginBottom: 8 }}>
                    <span style={{
                      position: 'absolute', insetInlineStart: 12, top: '50%', transform: 'translateY(-50%)',
                      color: '#94a3b8', fontSize: 14, pointerEvents: 'none',
                    }}>🔍</span>
                    <input
                      type="text"
                      value={chatSearch}
                      onChange={(e) => setChatSearch(e.target.value)}
                      placeholder={selectedLinkType === 'group_chat' ? 'חיפוש לפי שם קבוצה...' : 'חיפוש לפי שם או מספר...'}
                      style={{
                        width: '100%', padding: '10px 36px 10px 12px',
                        border: '1px solid #e2e8f0', borderRadius: 8,
                        fontSize: 15, fontFamily: 'inherit',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>

                  {/* Scrollable list. Max-height keeps a 50+ chat list
                      from pushing the modal buttons off-screen on
                      mobile. Each cell uses an avatar bubble derived
                      from the chat name (no profile image is stored on
                      WhatsAppChat) plus a secondary line: phone for
                      private, group JID for group (until participant
                      counts are wired through, which is not in scope
                      for this UI commit). */}
                  <div style={{
                    border: '1px solid #e2e8f0', borderRadius: 10,
                    maxHeight: 320, overflowY: 'auto',
                    background: '#fff',
                  }}>
                    {matches.length === 0 ? (
                      <div style={{ padding: '20px 14px', color: '#94a3b8', fontSize: 13, textAlign: 'center' }}>
                        {chatSearch
                          ? `לא נמצאו תוצאות עבור "${chatSearch}"`
                          : selectedLinkType === 'group_chat'
                            ? 'אין קבוצות וואטסאפ זמינות לקישור.'
                            : 'אין צ׳אטים פרטיים זמינים לקישור.'}
                      </div>
                    ) : matches.map((c) => {
                      const selected = selectedChatId === c.id;
                      const secondary = c.type === 'private'
                        ? (c.phoneNumber || c.externalChatId)
                        : 'צ׳אט קבוצתי';
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setSelectedChatId(c.id)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 12,
                            width: '100%', textAlign: 'right',
                            padding: '10px 12px',
                            background: selected ? '#eff6ff' : '#fff',
                            border: 'none',
                            borderBottom: '1px solid #f1f5f9',
                            cursor: 'pointer',
                          }}
                          onMouseEnter={(e) => {
                            if (!selected) (e.currentTarget as HTMLButtonElement).style.background = '#f8fafc';
                          }}
                          onMouseLeave={(e) => {
                            if (!selected) (e.currentTarget as HTMLButtonElement).style.background = '#fff';
                          }}
                        >
                          {/* Real WhatsApp picture when the bridge captured one;
                              otherwise the hash-of-id colored initial bubble.
                              ChatAvatar handles both, including runtime image
                              load failures (URL expired etc.) without layout
                              shift since the wrapper has fixed dimensions. */}
                          <ChatAvatar chat={c} size={36} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                              fontSize: 14, fontWeight: 700, color: '#0f172a',
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>
                              {chatDisplayName(c)}
                            </div>
                            <div style={{
                              fontSize: 12, color: '#64748b', marginTop: 2,
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              direction: c.type === 'private' && c.phoneNumber ? 'ltr' : 'rtl',
                            }}>
                              {secondary}
                            </div>
                          </div>
                          {selected && (
                            <span style={{ color: '#2563eb', fontSize: 18, fontWeight: 700, flexShrink: 0 }}>✓</span>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Result count strip — useful when there are 50+
                      chats and the user wants to see "did my search
                      narrow this down?" at a glance. */}
                  <div style={{ marginTop: 6, fontSize: 11, color: '#94a3b8', textAlign: 'end' }}>
                    {matches.length} {selectedLinkType === 'group_chat' ? 'קבוצות' : 'צ׳אטים'}
                    {chatSearch && ` (מסונן מתוך ${pickableChats.filter((c) => c.type === wantType).length})`}
                  </div>
                </>
              )}
            </div>

            {/* Step 3 — participant picker. Only meaningful for the
                private chat flow. Shown only after a chat is picked so
                the modal stays clean while the admin's still browsing. */}
            {selectedLinkType === 'private_participant_chat' && selectedChatId && (
              <div style={{ marginBottom: 14 }}>
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
              <button
                onClick={linkSubmitting ? undefined : submitLink}
                disabled={linkSubmitting || !selectedChatId}
                style={{
                  ...S.btnPrimary,
                  ...(linkSubmitting || !selectedChatId ? S.btnDisabled : {}),
                }}
              >
                {linkSubmitting ? 'שומר...' : 'קשרי'}
              </button>
            </div>
          </Modal>
        );
      })()}

      {/* Per-participant private-chat popup. Opened from the WA button
          on each participant row. Locked: no backdrop close, X +
          unsaved-changes guard. The popup reads/writes the same
          PrivateScheduledMessage rows the participant profile chat tab
          does (single source of truth keyed on participantId), so any
          edit/cancel made here propagates everywhere automatically.
          The chatPopup state is a dependency of the scheduled-counts
          useEffect, so closing the popup re-fetches the badges. */}
      {chatPopup && (
        <ParticipantPrivateChatPopup
          participantId={chatPopup.participantId}
          participantName={chatPopup.participantName}
          onClose={() => setChatPopup(null)}
        />
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

// ─── Questionnaire completion tracking modal ──────────────────────────────────
// Locked in-app modal: no backdrop close, explicit X. Read-only — never
// mutates submissions. Reuses existing routes:
//   - GET  /api/groups/:groupId/questionnaires/:templateId/completion
//   - link "פתחי תשובות"  → /admin/participants/:pid?tab=questionnaires
//   - link "מלאי עבור משתתפת" → /admin/questionnaires/:tid/fill?participantId=:pid

interface CompletionRow {
  participantId: string;
  firstName: string;
  lastName: string | null;
  phoneNumber: string;
  email: string | null;
  hasCompleted: boolean;
  submissionId: string | null;
  submittedAt: string | null;
  status: 'completed' | 'draft' | 'none';
  submittedByMode: 'internal' | 'external' | null;
}
interface CompletionResponse {
  templateId: string;
  templateInternalName: string;
  templatePublicTitle: string;
  totalParticipants: number;
  completedCount: number;
  missingCount: number;
  rows: CompletionRow[];
}

function CompletionTrackingModal(props: {
  groupId: string;
  template: QTemplate;
  onClose: () => void;
}) {
  const { groupId, template, onClose } = props;
  const [data, setData] = useState<CompletionResponse | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'completed' | 'missing'>('missing');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch<CompletionResponse>(
      `${BASE_URL}/groups/${groupId}/questionnaires/${template.id}/completion`,
      { cache: 'no-store' },
    )
      .then((r) => { if (!cancelled) { setData(r); setErr(''); } })
      .catch((e) => { if (!cancelled) setErr(e instanceof Error ? e.message : 'טעינה נכשלה'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [groupId, template.id]);

  const visibleRows: CompletionRow[] = data
    ? data.rows.filter((r) => tab === 'completed' ? r.hasCompleted : !r.hasCompleted)
    : [];

  const stat = (label: string, value: number, color: string): React.ReactNode => (
    <div style={{
      flex: 1, minWidth: 0, background: '#f8fafc', border: '1px solid #e2e8f0',
      borderRadius: 8, padding: '10px 12px', textAlign: 'center',
    }}>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{label}</div>
    </div>
  );

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 16 }}
      role="dialog"
      aria-modal="true"
    >
      <div style={{ background: '#fff', borderRadius: 12, padding: 22, width: '100%', maxWidth: 640, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: '#0f172a' }}>מעקב מילוי שאלון</h3>
            <div style={{ fontSize: 13, color: '#475569', marginTop: 4 }}>{template.internalName}</div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 1 }}>{template.publicTitle}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="סגור"
            style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 22, cursor: 'pointer', lineHeight: 1, flexShrink: 0 }}
          >×</button>
        </div>

        {loading && <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 14, padding: '24px 0' }}>טוען...</p>}
        {err && !loading && <p style={{ color: '#b91c1c', fontSize: 13 }}>{err}</p>}

        {data && !loading && !err && (
          <>
            {/* Summary stats */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              {stat('משתתפות בקבוצה', data.totalParticipants, '#0f172a')}
              {stat('מילאו', data.completedCount, '#15803d')}
              {stat('לא מילאו', data.missingCount, '#b45309')}
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 12, borderBottom: '1px solid #e2e8f0' }}>
              {(['missing', 'completed'] as const).map((key) => {
                const active = tab === key;
                const label = key === 'missing'
                  ? `לא מילאו (${data.missingCount})`
                  : `מילאו (${data.completedCount})`;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTab(key)}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      padding: '8px 14px', fontSize: 13, fontWeight: 600,
                      color: active ? '#1d4ed8' : '#64748b',
                      borderBottom: active ? '2px solid #1d4ed8' : '2px solid transparent',
                      marginBottom: -1,
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {/* Rows */}
            {visibleRows.length === 0 ? (
              <p style={{ color: '#94a3b8', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
                {tab === 'completed' ? 'אף משתתפת עוד לא מילאה' : 'כל המשתתפות מילאו ✓'}
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {visibleRows.map((row, idx) => (
                  <div
                    key={row.participantId}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 0',
                      borderBottom: idx < visibleRows.length - 1 ? '1px solid #f1f5f9' : 'none',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>
                        {displayName(row)}
                        {row.status === 'draft' && (
                          <span style={{
                            fontSize: 10, fontWeight: 600, color: '#92400e',
                            background: '#fef3c7', borderRadius: 999,
                            padding: '1px 7px', marginInlineStart: 6,
                          }}>טיוטה</span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: '#6b7280', direction: 'ltr', textAlign: 'right' }}>
                        {row.phoneNumber}{row.email ? `  ·  ${row.email}` : ''}
                      </div>
                      {row.hasCompleted && row.submittedAt && (
                        <div style={{ fontSize: 11, color: '#15803d', marginTop: 2 }}>
                          הוגש: {formatDate(row.submittedAt)}
                          {row.submittedByMode === 'external' && ' · חיצוני'}
                          {row.submittedByMode === 'internal' && ' · פנימי'}
                        </div>
                      )}
                    </div>
                    {row.hasCompleted ? (
                      <Link
                        href={`/admin/participants/${row.participantId}?tab=questionnaires`}
                        style={{
                          fontSize: 12, color: '#15803d', background: '#f0fdf4',
                          border: '1px solid #bbf7d0', borderRadius: 6,
                          padding: '5px 10px', textDecoration: 'none', fontWeight: 600,
                          flexShrink: 0,
                        }}
                      >
                        פתחי תשובות ↗
                      </Link>
                    ) : (
                      <Link
                        href={`/admin/questionnaires/${template.id}/fill?participantId=${row.participantId}`}
                        style={{
                          fontSize: 12, color: '#1d4ed8', background: '#eff6ff',
                          border: '1px solid #bfdbfe', borderRadius: 6,
                          padding: '5px 10px', textDecoration: 'none', fontWeight: 600,
                          flexShrink: 0,
                        }}
                      >
                        מלאי עבור משתתפת ↗
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
          <button
            type="button"
            onClick={onClose}
            style={{ padding: '8px 16px', background: '#f1f5f9', border: '1px solid #e2e8f0', color: '#374151', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}
          >
            סגור
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Bulk move modal ───────────────────────────────────────────────────────────

interface GroupLite { id: string; name: string; isActive: boolean; }

function BulkMoveModal(props: {
  fromGroupId: string;
  currentGroupName: string;
  selectedIds: string[];
  busy: boolean;
  onClose: () => void;
  onMove: (toGroupId: string) => void;
}) {
  const [groups, setGroups] = useState<GroupLite[] | null>(null);
  const [picked, setPicked] = useState<string>('');
  useEffect(() => {
    apiFetch<GroupLite[]>(`${BASE_URL}/groups`, { cache: 'no-store' })
      .then((rows) => setGroups(rows.filter((g) => g.isActive && g.id !== props.fromGroupId)))
      .catch(() => setGroups([]));
  }, [props.fromGroupId]);
  return (
    <Modal onClose={props.onClose}>
      <h3 style={{ fontSize: 17, fontWeight: 700, margin: '0 0 8px' }}>העברת משתתפות לקבוצה אחרת</h3>
      <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 16px' }}>
        מעבירי {props.selectedIds.length} משתתפות מ-{props.currentGroupName} לקבוצה אחרת.
        הקישור האישי שלהן נשאר זהה.
      </p>
      {!groups && <div style={{ color: '#94a3b8', fontSize: 13 }}>טוען קבוצות...</div>}
      {groups && groups.length === 0 && (
        <div style={{ color: '#64748b', fontSize: 13 }}>אין קבוצות אחרות זמינות.</div>
      )}
      {groups && groups.length > 0 && (
        <select
          value={picked}
          onChange={(e) => setPicked(e.target.value)}
          style={{ width: '100%', padding: '10px 12px', fontSize: 14, border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', marginBottom: 14, boxSizing: 'border-box' }}
        >
          <option value="">— בחרי קבוצת יעד —</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={props.onClose} disabled={props.busy} style={{ padding: '8px 18px', background: '#f1f5f9', border: '1px solid #e2e8f0', color: '#374151', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>ביטול</button>
        <button
          onClick={() => picked && props.onMove(picked)}
          disabled={!picked || props.busy}
          style={{ padding: '8px 22px', background: picked && !props.busy ? '#0891b2' : '#93c5fd', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: picked && !props.busy ? 'pointer' : 'not-allowed' }}
        >{props.busy ? 'מעביר...' : 'העברה'}</button>
      </div>
    </Modal>
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

// ─── Scheduled messages — group tab ─────────────────────────────────────────
// Admin-facing controller of actual sending. Three gates must ALL be
// true for a row to send: (1) group master toggle ON, (2) per-row
// enabled=true, (3) status='pending'. The cron worker on the API
// reads from this same data via /api/groups/:id/scheduled-messages.

interface SchedMsg {
  id: string;
  category: string;
  internalName: string;
  content: string;
  scheduledAt: string;
  targetType: string;
  enabled: boolean;
  status: 'draft' | 'pending' | 'sent' | 'failed' | 'cancelled' | 'skipped';
  attemptCount: number;
  lastAttemptAt: string | null;
  nextRetryAt: string | null;
  sentAt: string | null;
  failureReason: string | null;
  sourceTemplateId: string | null;
  // After the comm-templates merge, sourceTemplate is a CommunicationTemplate
  // (the field is now `title`, not `internalName`).
  sourceTemplate: { id: string; title: string; isActive: boolean } | null;
}

const SCHED_STATUS_LABEL: Record<SchedMsg['status'], { text: string; bg: string; fg: string }> = {
  draft:     { text: 'טיוטה',  bg: '#f1f5f9', fg: '#475569' },
  pending:   { text: 'מתוזמן', bg: '#dbeafe', fg: '#1d4ed8' },
  sent:      { text: 'נשלח ✓', bg: '#dcfce7', fg: '#15803d' },
  failed:    { text: 'נכשל',   bg: '#fee2e2', fg: '#b91c1c' },
  cancelled: { text: 'בוטל',   bg: '#f1f5f9', fg: '#94a3b8' },
  skipped:   { text: 'דולג',   bg: '#fef3c7', fg: '#92400e' },
};

function formatSchedTime(iso: string): string {
  return new Date(iso).toLocaleString('he-IL', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// Convert YYYY-MM-DDTHH:mm (datetime-local input value, interpreted
// as Asia/Jerusalem) → ISO UTC. The browser's datetime-local input
// returns a wall-clock string in the user's locale; for admins in
// Israel that's already what we want, so we just append the local
// offset and serialise. Acceptable because the admin enters dates
// from Israel; if not, the displayed time uses he-IL locale anyway.
function localInputToIso(local: string): string {
  return new Date(local).toISOString();
}
function isoToLocalInput(iso: string): string {
  // Keep only YYYY-MM-DDTHH:mm in user's locale wall-clock.
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function GroupScheduledMessagesTab({ groupId, hasProgram }: { groupId: string; hasProgram: boolean }) {
  const [rows, setRows] = useState<SchedMsg[] | null>(null);
  const [masterEnabled, setMasterEnabled] = useState<boolean | null>(null);
  const [err, setErr] = useState('');
  const [busyMaster, setBusyMaster] = useState(false);
  const [editing, setEditing] = useState<SchedMsg | null>(null);
  const [creating, setCreating] = useState(false);
  const [inheriting, setInheriting] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [list, group] = await Promise.all([
        apiFetch<SchedMsg[]>(`${BASE_URL}/groups/${groupId}/scheduled-messages`, { cache: 'no-store' }),
        apiFetch<{ scheduledMessagesEnabled: boolean }>(`${BASE_URL}/groups/${groupId}`, { cache: 'no-store' }),
      ]);
      setRows(list);
      setMasterEnabled(group.scheduledMessagesEnabled);
      setErr('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'טעינה נכשלה');
    }
  }, [groupId]);
  useEffect(() => { void reload(); }, [reload]);

  async function toggleMaster(next: boolean) {
    setBusyMaster(true);
    try {
      const updated = await apiFetch<{ scheduledMessagesEnabled: boolean }>(
        `${BASE_URL}/groups/${groupId}/scheduled-messages/master-toggle`,
        { method: 'PATCH', body: JSON.stringify({ scheduledMessagesEnabled: next }) },
      );
      setMasterEnabled(updated.scheduledMessagesEnabled);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'שמירה נכשלה');
    } finally {
      setBusyMaster(false);
    }
  }

  async function toggleRowEnabled(row: SchedMsg, next: boolean) {
    try {
      await apiFetch(`${BASE_URL}/groups/${groupId}/scheduled-messages/${row.id}`,
        { method: 'PATCH', body: JSON.stringify({ enabled: next }) });
      void reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message :
        (typeof e === 'object' && e !== null && typeof (e as { message?: unknown }).message === 'string')
          ? (e as { message: string }).message : 'שמירה נכשלה');
    }
  }

  async function cancelRow(row: SchedMsg) {
    if (!window.confirm(`לבטל את ההודעה "${row.internalName}"? ההודעה לא תישלח ולא תוכל לחזור למצב פעיל.`)) return;
    try {
      await apiFetch(`${BASE_URL}/groups/${groupId}/scheduled-messages/${row.id}/cancel`, { method: 'POST' });
      void reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'ביטול נכשל');
    }
  }

  // Group rows by category for clean visual scanning.
  const grouped: Array<{ category: string; items: SchedMsg[] }> = [];
  if (rows) {
    for (const r of rows) {
      const bucket = grouped.find((g) => g.category === r.category);
      if (bucket) bucket.items.push(r);
      else grouped.push({ category: r.category, items: [r] });
    }
  }

  return (
    <div>
      {/* Master toggle */}
      <div style={{ background: masterEnabled ? '#f0fdf4' : '#fef2f2', border: `1px solid ${masterEnabled ? '#bbf7d0' : '#fecaca'}`, borderRadius: 10, padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <input
            type="checkbox"
            checked={masterEnabled === true}
            disabled={busyMaster || masterEnabled === null}
            onChange={(e) => { void toggleMaster(e.target.checked); }}
            style={{ width: 18, height: 18, marginTop: 2, cursor: 'pointer', flexShrink: 0 }}
          />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>שליחת הודעות מתוזמנות לקבוצה זו</div>
            <div style={{ fontSize: 12, color: masterEnabled ? '#15803d' : '#b91c1c', marginTop: 4, lineHeight: 1.55 }}>
              {masterEnabled
                ? 'הודעות שסומנו כפעילות יישלחו אוטומטית בזמן שנקבע להן.'
                : 'כל ההודעות המתוזמנות מושבתות. אף הודעה לא תישלח אוטומטית, גם אם היא מסומנת כפעילה בנפרד.'}
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>הודעות מתוזמנות לקבוצה</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {hasProgram && (
            <button onClick={() => setInheriting(true)} style={{ background: '#fff', color: '#1d4ed8', border: '1px solid #bfdbfe', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              ↻ סנכרן תבניות חסרות
            </button>
          )}
          <button onClick={() => setCreating(true)} style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            + הודעה חדשה לקבוצה זו
          </button>
        </div>
      </div>

      {err && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{err}</div>}
      {!rows && <div style={{ color: '#94a3b8', textAlign: 'center', padding: 30 }}>טוען...</div>}
      {rows && rows.length === 0 && (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: '#94a3b8', border: '2px dashed #e2e8f0', borderRadius: 12 }}>
          {hasProgram
            ? 'אין הודעות מתוזמנות. תבניות עם תזמון בתוכנית נוצרות אוטומטית כטיוטה. אפשר ללחוץ "סנכרן" אם משהו חסר, או "הודעה חדשה" להוסיף הודעה לקבוצה זו בלבד.'
            : 'אין הודעות מתוזמנות. לחצי "הודעה חדשה" להתחיל.'}
        </div>
      )}

      {grouped.map((g) => (
        <div key={g.category} style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            {g.category}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {g.items.map((r) => {
              const pill = SCHED_STATUS_LABEL[r.status];
              const dimmed = !masterEnabled && r.enabled;
              return (
                <div key={r.id} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, opacity: dimmed ? 0.7 : 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <input
                        type="checkbox"
                        checked={r.enabled}
                        disabled={r.status === 'sent' || r.status === 'cancelled'}
                        onChange={(e) => { void toggleRowEnabled(r, e.target.checked); }}
                        style={{ width: 16, height: 16, cursor: r.status === 'sent' || r.status === 'cancelled' ? 'not-allowed' : 'pointer' }}
                      />
                      <span style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{r.internalName}</span>
                      <span style={{ background: pill.bg, color: pill.fg, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999 }}>{pill.text}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {r.status !== 'sent' && r.status !== 'cancelled' && (
                        <>
                          <button onClick={() => setEditing(r)} style={{ background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', borderRadius: 7, padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}>ערוך</button>
                          <button onClick={() => { void cancelRow(r); }} style={{ background: '#fff', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: 7, padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}>ביטול</button>
                        </>
                      )}
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>
                    📅 {formatSchedTime(r.scheduledAt)}
                    {r.sourceTemplate && (
                      <span style={{ marginInlineStart: 8, color: '#94a3b8' }}>· מתבנית: {r.sourceTemplate.title}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, color: '#334155', whiteSpace: 'pre-wrap', maxHeight: 80, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.content}</div>
                  {r.status === 'failed' && r.failureReason && (
                    <div style={{ marginTop: 8, padding: '6px 10px', background: '#fee2e2', color: '#991b1b', fontSize: 12, borderRadius: 6 }}>
                      ניסיונות: {r.attemptCount} · סיבה: {r.failureReason}
                    </div>
                  )}
                  {r.status === 'skipped' && r.failureReason && (
                    <div style={{ marginTop: 8, padding: '6px 10px', background: '#fef3c7', color: '#92400e', fontSize: 12, borderRadius: 6 }}>
                      דולג: {r.failureReason}
                    </div>
                  )}
                  {dimmed && (
                    <div style={{ marginTop: 8, padding: '6px 10px', background: '#fef3c7', color: '#92400e', fontSize: 12, borderRadius: 6 }}>
                      ⚠ המתג הראשי כבוי — ההודעה לא תישלח גם אם מסומנת כפעילה
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {(creating || editing) && (
        <GroupSchedMsgModal
          groupId={groupId}
          initial={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); void reload(); }}
        />
      )}
      {inheriting && (
        <InheritTemplatesModal
          groupId={groupId}
          onClose={() => setInheriting(false)}
          onDone={() => { setInheriting(false); void reload(); }}
        />
      )}
    </div>
  );
}

// One-time send-or-schedule modal opened from the group header's
// WhatsApp/הודעה button. Uses the same MessageComposer the
// participant private-chat popup uses (single composer rule), but
// wires send/schedule to group-level endpoints:
//   - שלח עכשיו → POST /admin/whatsapp/send (existing bridge proxy)
//   - תזמן       → POST /groups/:id/scheduled-messages (existing
//                 GroupScheduledMessage table; no parallel system)
//
// The schedule call defaults category=מותאם אישית and auto-builds
// internalName from the picked datetime so admin doesn't have to
// fill the schedule-tab editor's full form for an ad-hoc one-time
// send. enabled=true so the cron worker picks it up immediately.
function GroupOneTimeMessageModal(props: {
  groupId: string;
  groupChatJid: string | null;
  groupChatName: string;
  programId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [dirty, setDirty] = useState(false);

  async function sendNow(text: string): Promise<void> {
    if (!props.groupChatJid) {
      throw new Error('לא קושרה קבוצת וואטסאפ — קשרי קבוצה לפני שליחה');
    }
    await apiFetch(`${BASE_URL}/admin/whatsapp/send`, {
      method: 'POST',
      body: JSON.stringify({
        phone: props.groupChatJid,
        message: text,
      }),
    });
    // Slight delay before closing so the admin sees the "נשלח ✓"
    // flash from the composer's success banner.
    setTimeout(() => props.onSaved(), 800);
  }

  async function schedule(text: string, scheduledAtIso: string): Promise<void> {
    const when = new Date(scheduledAtIso);
    const human = when.toLocaleString('he-IL', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
    await apiFetch(`${BASE_URL}/groups/${props.groupId}/scheduled-messages`, {
      method: 'POST',
      body: JSON.stringify({
        category: 'מותאם אישית',
        internalName: `הודעה חד-פעמית · ${human}`,
        content: text,
        scheduledAt: scheduledAtIso,
        enabled: true,
      }),
    });
    setTimeout(() => props.onSaved(), 800);
  }

  return (
    <StrongModal
      title={`הודעה לקבוצה — ${props.groupChatName}`}
      isDirty={dirty}
      onClose={props.onClose}
      maxWidth={560}
    >
      {() => (
        <>
          {!props.groupChatJid && (
            <div
              style={{
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: 8,
                padding: '10px 14px',
                marginBottom: 14,
                fontSize: 13,
                color: '#dc2626',
              }}
            >
              לא קושרה קבוצת וואטסאפ. לחצי &ldquo;קשרי צ׳אט&rdquo; ובחרי קישור מסוג &ldquo;קבוצת וואטסאפ&rdquo; לפני שליחה.
            </div>
          )}
          <p style={{ fontSize: 13, color: '#475569', margin: '0 0 14px', lineHeight: 1.5 }}>
            כתבי הודעה אחת. בלחיצה על &ldquo;שלח עכשיו&rdquo; ההודעה תשלח לקבוצה כעת.
            בלחיצה על &ldquo;תזמן הודעה&rdquo; היא תישמר ותישלח אוטומטית בזמן שתבחרי.
            הודעות מתוזמנות נראות בלשונית &ldquo;הודעות מתוזמנות&rdquo; ואפשר לערוך / לבטל אותן עד הזמן שנבחר.
          </p>
          <div
            style={{
              border: '1px solid #e2e8f0',
              borderRadius: 12,
              overflow: 'hidden',
              background: '#fff',
            }}
          >
            {/* loadTemplates is wired to the group's program — the
                template picker shows whatsapp templates configured on
                that program. dirty state bubbles up via onDirtyChange
                so StrongModal's unsaved-changes confirm gates close. */}
            <MessageComposer
              onSendNow={sendNow}
              onSchedule={schedule}
              loadTemplates={props.programId ? loadProgramTemplates(props.programId) : undefined}
              onDirtyChange={setDirty}
              placeholder="כתבי את ההודעה לקבוצה..."
            />
          </div>
        </>
      )}
    </StrongModal>
  );
}

function GroupSchedMsgModal(props: {
  groupId: string;
  initial: SchedMsg | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!props.initial;
  const [category, setCategory] = useState(props.initial?.category ?? 'משחק שוטף');
  const [internalName, setInternalName] = useState(props.initial?.internalName ?? '');
  const [content, setContent] = useState(props.initial?.content ?? '');
  const [scheduledAt, setScheduledAt] = useState(
    props.initial ? isoToLocalInput(props.initial.scheduledAt) : '',
  );
  const [enabled, setEnabled] = useState(props.initial?.enabled ?? false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // Unsaved-changes guard. The modal is locked open — backdrop clicks do
  // nothing, and explicit close attempts (X / ביטול) route through
  // attemptClose, which checks dirty against the initial snapshot and
  // pops an in-app confirm before discarding. Successful save bypasses
  // the guard via props.onSaved.
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const initialCategory = props.initial?.category ?? 'משחק שוטף';
  const initialInternalName = props.initial?.internalName ?? '';
  const initialContent = props.initial?.content ?? '';
  const initialScheduledAt = props.initial ? isoToLocalInput(props.initial.scheduledAt) : '';
  const initialEnabled = props.initial?.enabled ?? false;
  const isDirty =
    category !== initialCategory ||
    internalName !== initialInternalName ||
    content !== initialContent ||
    scheduledAt !== initialScheduledAt ||
    enabled !== initialEnabled;
  function attemptClose() {
    if (busy) return;
    if (isDirty) { setConfirmDiscard(true); return; }
    props.onClose();
  }
  // Restore-to-template state. confirming = a confirm dialog is open;
  // restoring = the fetch is in flight. The template id is read off
  // the row that was passed in — only present when this group row was
  // cloned from a program template.
  const [restoreConfirm, setRestoreConfirm] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const sourceTemplateId = props.initial?.sourceTemplateId ?? null;
  // Shared imperative ref — same shape used by the template editor on
  // /admin/programs/[id], so the variable bar's insertAtCursor +
  // focus contract works identically across both surfaces.
  const editorHandleRef = useRef<VariableEditorHandle | null>(null);

  // Fetch the canonical template + reset content (and the related
  // snapshot fields) back to it. Timing fields are NOT touched —
  // group-level scheduling is intentional per spec, even when content
  // is reverted to the original. After restore, saving sends the
  // template-derived body so the row is no longer "manually edited".
  // The reload of the parent list will refresh contentSyncedAt etc.
  async function restoreToTemplate() {
    if (!sourceTemplateId) return;
    setRestoring(true);
    try {
      const tpl = await apiFetch<{
        id: string;
        title: string;
        body: string;
        category: string | null;
      }>(`${BASE_URL}/communication-templates/${sourceTemplateId}`, { cache: 'no-store' });
      // Reset the editable snapshot fields. We DO NOT touch
      // scheduledAt or enabled — admin's per-group timing + on/off
      // decisions are independent of the content-revert action.
      setContent(tpl.body);
      setInternalName(tpl.title);
      if (tpl.category) setCategory(tpl.category);
      setRestoreConfirm(false);
      setErr('');
    } catch (e) {
      const msg = e instanceof Error ? e.message :
        (typeof e === 'object' && e !== null && typeof (e as { message?: unknown }).message === 'string')
          ? (e as { message: string }).message : 'שחזור נכשל';
      setErr(msg);
    } finally {
      setRestoring(false);
    }
  }

  async function save() {
    if (!internalName.trim()) { setErr('שם פנימי הוא שדה חובה'); return; }
    if (!content.trim()) { setErr('תוכן ההודעה הוא שדה חובה'); return; }
    if (!scheduledAt) { setErr('יש לבחור תאריך ושעה'); return; }
    setBusy(true); setErr('');
    try {
      const body = {
        category: category.trim(),
        internalName: internalName.trim(),
        content,
        scheduledAt: localInputToIso(scheduledAt),
        enabled,
      };
      if (isEdit) {
        await apiFetch(`${BASE_URL}/groups/${props.groupId}/scheduled-messages/${props.initial!.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        await apiFetch(`${BASE_URL}/groups/${props.groupId}/scheduled-messages`, { method: 'POST', body: JSON.stringify(body) });
      }
      props.onSaved();
    } catch (e) {
      const msg = e instanceof Error ? e.message :
        (typeof e === 'object' && e !== null && typeof (e as { message?: unknown }).message === 'string')
          ? (e as { message: string }).message : 'שמירה נכשלה';
      setErr(msg);
    } finally { setBusy(false); }
  }

  // Style constants matching the template editor's CommTemplateModal
  // exactly — same paddings, borders, radii, font-sizes — so the two
  // editors look identical to the admin.
  const labelStyle: React.CSSProperties = {
    fontSize: 13, fontWeight: 600, color: '#374151',
    marginBottom: 6, display: 'block',
  };
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 14px',
    border: '1px solid #cbd5e1', borderRadius: 8,
    fontSize: 15, color: '#0f172a', background: '#fff',
    fontFamily: 'inherit', boxSizing: 'border-box',
    lineHeight: 1.5,
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 14, padding: 22, width: '100%', maxWidth: 560, maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>{isEdit ? 'עריכת הודעה מתוזמנת' : 'הודעה חדשה לקבוצה'}</div>
          <button onClick={attemptClose} disabled={busy} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 22, cursor: busy ? 'not-allowed' : 'pointer' }}>×</button>
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            <label style={labelStyle}>קטגוריה</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle}>
              <option value="משחק שוטף">משחק שוטף</option>
              <option value="לפני משחק">לפני משחק</option>
              <option value="פתיחה">פתיחה</option>
              <option value="סיום">סיום</option>
              <option value="תזכורת">תזכורת</option>
              <option value="מותאם אישית">מותאם אישית</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>שם פנימי *</label>
            <input style={inputStyle} value={internalName} onChange={(e) => setInternalName(e.target.value)} />
          </div>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 6 }}>
              <label style={{ ...labelStyle, marginBottom: 0 }}>תוכן *</label>
              {/* Restore-to-template button. Only shown when the row
                  has a sourceTemplate to restore from — group-only
                  ad-hoc messages (sourceTemplateId=null) have no
                  canonical version to revert to. */}
              {sourceTemplateId && (
                <button
                  type="button"
                  onClick={() => setRestoreConfirm(true)}
                  disabled={busy || restoring}
                  style={{
                    fontSize: 12, fontWeight: 600,
                    background: '#fff', color: '#1d4ed8',
                    border: '1px solid #bfdbfe', borderRadius: 7,
                    padding: '4px 10px',
                    cursor: (busy || restoring) ? 'not-allowed' : 'pointer',
                  }}
                  title="החזר את התוכן לגרסה המקורית מהתבנית"
                >⟲ החזר לתבנית המקור</button>
              )}
            </div>
            {/* Same VariableButtonBar + WhatsAppEditor stack the
                template editor uses on /admin/programs/[id]. Same
                font, same formatting behavior, same {variable}
                rendering — the two editors are now indistinguishable. */}
            <VariableButtonBar editorRef={editorHandleRef} />
            <WhatsAppEditor
              ref={editorHandleRef}
              value={content}
              onChange={setContent}
              placeholder="הקלידי את תוכן ההודעה..."
              minHeight={180}
            />
          </div>
          <div>
            <label style={labelStyle}>תאריך ושעה (זמן ישראל) *</label>
            <input type="datetime-local" style={{ ...inputStyle, direction: 'ltr' }} value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} style={{ width: 16, height: 16 }} />
            <span style={{ fontSize: 13, color: '#0f172a' }}>סמני כפעילה (תעבור למצב &ldquo;מתוזמן&rdquo;)</span>
          </label>
        </div>
        {err && <div style={{ color: '#dc2626', fontSize: 13, marginTop: 10 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={attemptClose} disabled={busy} style={{ background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 8, padding: '7px 14px', fontSize: 13, cursor: busy ? 'not-allowed' : 'pointer' }}>ביטול</button>
          <button onClick={() => { void save(); }} disabled={busy} style={{ background: busy ? '#93c5fd' : '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 18px', fontSize: 13, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer' }}>{busy ? 'שומר...' : 'שמור'}</button>
        </div>
      </div>

      {/* Restore-to-template confirm. Layered on top of the editor
          modal (zIndex 1100 vs 1000) and shaded backdrop so the admin
          sees the consequence before committing. Restoring updates
          local state only — the row isn't persisted until the admin
          hits שמור. That gives them an "undo via cancel" path even
          after restore. */}
      {restoreConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 22, maxWidth: 420, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>
              להחזיר לגרסת התבנית?
            </div>
            <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.6, margin: '0 0 14px' }}>
              האם להחזיר את ההודעה לגרסה המקורית מהתבנית?
              השינויים שעשית לתוכן בקבוצה יוחלפו בנוסח התבנית. תאריך/שעת
              השליחה והמתג הפעיל לא ישתנו. השמירה תתבצע רק לאחר לחיצה על
              &ldquo;שמור&rdquo;.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setRestoreConfirm(false)}
                disabled={restoring}
                style={{ background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 8, padding: '7px 14px', fontSize: 13, cursor: restoring ? 'not-allowed' : 'pointer' }}
              >ביטול</button>
              <button
                onClick={() => { void restoreToTemplate(); }}
                disabled={restoring}
                style={{ background: restoring ? '#93c5fd' : '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 16px', fontSize: 13, fontWeight: 700, cursor: restoring ? 'not-allowed' : 'pointer' }}
              >{restoring ? 'מחזיר...' : 'כן, החזר'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Unsaved-changes confirm. Layered above the editor (zIndex 1100)
          so the admin sees it without losing the underlying form
          context. Only shown when attemptClose detected a dirty
          state — clean closes skip this entirely. "המשך לערוך" just
          dismisses the confirm; "סגור בלי לשמור" abandons edits via
          props.onClose. */}
      {confirmDiscard && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 22, maxWidth: 420, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>
              לסגור בלי לשמור?
            </div>
            <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.6, margin: '0 0 14px' }}>
              יש שינויים שלא נשמרו. לסגור בלי לשמור?
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setConfirmDiscard(false)}
                style={{ background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 8, padding: '7px 14px', fontSize: 13, cursor: 'pointer' }}
              >המשך לערוך</button>
              <button
                onClick={() => { setConfirmDiscard(false); props.onClose(); }}
                style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
              >סגור בלי לשמור</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InheritTemplatesModal(props: { groupId: string; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ created: number; skipped: number; errors: { templateId: string; reason: string }[] } | null>(null);
  const [err, setErr] = useState('');

  async function run() {
    setBusy(true); setErr('');
    try {
      // Empty body / no templateIds = inherit ALL active templates of
      // the group's program. Backend returns counts for created /
      // skipped / errored so the admin sees the result inline.
      const r = await apiFetch<{ created: number; skipped: number; errors: { templateId: string; reason: string }[] }>(
        `${BASE_URL}/groups/${props.groupId}/scheduled-messages/sync-from-program`,
        { method: 'POST', body: JSON.stringify({}) },
      );
      setResult(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message :
        (typeof e === 'object' && e !== null && typeof (e as { message?: unknown }).message === 'string')
          ? (e as { message: string }).message : 'ייבוא נכשל');
    } finally { setBusy(false); }
  }

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget && !busy) props.onClose(); }} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 14, padding: 22, width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>סנכרון תבניות מהתוכנית</div>
          <button onClick={props.onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>
        {!result && (
          <>
            <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.6, margin: '0 0 14px' }}>
              ייווצרו הודעות מתוזמנות לקבוצה זו על בסיס כל התבניות הפעילות של התוכנית.
              ההודעות יתחילו במצב <strong>טיוטה</strong> ו<strong>מושבתות</strong> — תצטרכי לסקור ולסמן כל אחת
              כפעילה ידנית. תבניות שכבר יובאו (אותו זמן וקבוצה) יידלגו אוטומטית.
            </p>
            {err && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 10 }}>{err}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={props.onClose} disabled={busy} style={{ background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 8, padding: '7px 14px', fontSize: 13, cursor: busy ? 'not-allowed' : 'pointer' }}>ביטול</button>
              <button onClick={() => { void run(); }} disabled={busy} style={{ background: busy ? '#93c5fd' : '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 18px', fontSize: 13, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer' }}>{busy ? 'מייבא...' : 'ייבוא'}</button>
            </div>
          </>
        )}
        {result && (
          <>
            <div style={{ fontSize: 14, color: '#0f172a', marginBottom: 10 }}>
              נוצרו: <strong>{result.created}</strong> · דולגו (כפילות): {result.skipped} · שגיאות: {result.errors.length}
            </div>
            {result.errors.length > 0 && (
              <div style={{ marginBottom: 10, fontSize: 12, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', padding: 8, borderRadius: 6 }}>
                {result.errors.map((e, i) => <div key={i}>{e.reason}</div>)}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={props.onDone} style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>סגור</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
