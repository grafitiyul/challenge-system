'use client';

// Reusable private-chat surface for a single participant.
//
// Used in two surfaces, both rendering this component INSIDE a
// fixed-height popup chrome (ParticipantPrivateChatPopup):
//   1. Participant profile header → WhatsApp button
//   2. Group page → participant-row WA button
//
// Single source of truth keyed on participantId — both surfaces hit
// the same /participants/:id/{chat,scheduled-messages} endpoints, so
// editing/cancelling on either propagates everywhere automatically.
//
// Layout (top → bottom, all inside the popup body):
//   1. Pending scheduled strip (only when there are pending rows;
//      capped at 32% of height with internal scroll if many)
//   2. Conversation area — the focal region. Auto-scrolls to newest.
//      Background #f8fafc, outbound bubbles green (matches WhatsApp).
//   3. Composer dock — MessageComposer component (auto-grow textarea
//      + variable popover + שלח עכשיו / תזמן toggle). Composer is
//      shared with the group-header "הודעה" surface.
//
// Send-now goes through the bridge directly (POST /messages/send-now);
// the bridge persists the outbound to WhatsAppMessage with
// direction='outgoing', which the chat-timeline endpoint then reads,
// so the message appears in this timeline without any explicit write
// here.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch, BASE_URL } from '@lib/api';
import { MessageComposer, localInputToIso, loadParticipantTemplates } from '@components/message-composer';
import {
  VariableInsertButton,
  type VariableEditorHandle,
} from '@components/variable-button-bar';

// ─── Types ─────────────────────────────────────────────────────────────────

interface PrivateSched {
  id: string;
  participantId: string;
  content: string;
  scheduledAt: string;
  phoneSnapshot: string;
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'cancelled';
  enabled: boolean;
  attemptCount: number;
  lastAttemptAt: string | null;
  nextRetryAt: string | null;
  claimedAt: string | null;
  claimedBy: string | null;
  sentAt: string | null;
  externalMessageId: string | null;
  failureReason: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ChatMessage {
  id: string;
  externalMessageId: string | null;
  chatId: string;
  direction: 'incoming' | 'outgoing' | null;
  senderName: string | null;
  senderPhone: string | null;
  messageType: string;
  textContent: string | null;
  mediaUrl: string | null;
  timestampFromSource: string;
  createdAt: string;
}

interface ChatResponse {
  messages: ChatMessage[];
  scheduled: PrivateSched[];
}

// ─── Date helpers ──────────────────────────────────────────────────────────

function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('he-IL', {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatScheduledTime(iso: string): string {
  return new Date(iso).toLocaleString('he-IL', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ─── Status pill rendering (used by failed/cancelled rows in timeline) ───

function statusPill(status: PrivateSched['status']): React.ReactElement {
  const base: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, padding: '2px 8px',
    borderRadius: 999, whiteSpace: 'nowrap',
  };
  switch (status) {
    case 'pending':
      return <span style={{ ...base, background: '#fef3c7', color: '#92400e' }}>ממתין</span>;
    case 'sending':
      return <span style={{ ...base, background: '#dbeafe', color: '#1e40af' }}>נשלח כעת</span>;
    case 'sent':
      return <span style={{ ...base, background: '#dcfce7', color: '#166534' }}>נשלח</span>;
    case 'failed':
      return <span style={{ ...base, background: '#fee2e2', color: '#991b1b' }}>נכשל</span>;
    case 'cancelled':
      return <span style={{ ...base, background: '#e2e8f0', color: '#475569' }}>בוטל</span>;
  }
}

// ─── Main component ───────────────────────────────────────────────────────

export interface ParticipantPrivateChatProps {
  participantId: string;
  // Reports dirty composer state up to the parent so the popup
  // wrapper can guard close. Ignored when not provided.
  onDirtyChange?: (dirty: boolean) => void;
}

export function ParticipantPrivateChat({
  participantId,
  onDirtyChange,
}: ParticipantPrivateChatProps) {
  // ── Data state ────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [scheduled, setScheduled] = useState<PrivateSched[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [showCancelled, setShowCancelled] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Composer dirty state — bubbled up from MessageComposer's
  // onDirtyChange so the popup wrapper can show the unsaved-changes
  // confirm. The composer is the single owner of its text state; we
  // just mirror the boolean.
  const [composerHasText, setComposerHasText] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  // Smart auto-scroll: if the user is near the bottom we pin to the
  // newest message on every poll. If they've scrolled up, we leave
  // them alone and surface a "↓ N הודעות חדשות" pill instead.
  const isAtBottomRef = useRef(true);
  const [unseenCount, setUnseenCount] = useState(0);

  // Reload chat data. Two modes:
  //   - silent=false (initial load + post-action) → toggles loading
  //     state and surfaces errors. Used when admin clicks something.
  //   - silent=true (poll tick) → never flips loading; swallows
  //     transient errors so a flaky network doesn't blink the UI.
  // Polling never resets composer state because the composer owns
  // its own state separately.
  const reload = useCallback(async (silent = false) => {
    try {
      const r = await apiFetch<ChatResponse>(
        `${BASE_URL}/participants/${participantId}/chat`,
        { cache: 'no-store' },
      );
      setMessages((prev) => {
        // Detect new inbound to drive unseen-count when scrolled up.
        if (silent && prev.length > 0) {
          const prevIds = new Set(prev.map((m) => m.id));
          const newCount = r.messages.filter((m) => !prevIds.has(m.id)).length;
          if (newCount > 0 && !isAtBottomRef.current) {
            setUnseenCount((c) => c + newCount);
          }
        }
        return r.messages;
      });
      setScheduled(r.scheduled);
      if (!silent) setLoadErr('');
    } catch (e) {
      if (silent) return; // swallow on poll
      const m = e instanceof Error ? e.message :
        (typeof e === 'object' && e !== null && typeof (e as { message?: unknown }).message === 'string')
          ? (e as { message: string }).message : 'טעינה נכשלה';
      setLoadErr(m);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [participantId]);

  useEffect(() => { void reload(); }, [reload]);

  // Background polling. 5s cadence — quiet enough to feel live without
  // hammering the API. Cleared on unmount (popup close). The poll never
  // touches the composer; MessageComposer owns its own text/mode/picker
  // state, so refreshing chat data leaves what the admin is typing,
  // which template they picked, and the schedule mode untouched.
  useEffect(() => {
    const t = setInterval(() => { void reload(true); }, 5000);
    return () => clearInterval(t);
  }, [reload]);

  // Bubble dirty state up to the popup wrapper.
  useEffect(() => { onDirtyChange?.(composerHasText); }, [composerHasText, onDirtyChange]);

  // ── Composer callbacks ─────────────────────────────────────────────────
  // These wrap the actual API calls. The composer passes us only the
  // text (and ISO time for schedule); we know the participantId from
  // props and pick the right endpoint. Throwing on failure keeps the
  // composer's error UI working — it surfaces e.message inline.
  const sendNow = useCallback(async (text: string) => {
    setComposerHasText(false);
    await apiFetch(`${BASE_URL}/participants/${participantId}/messages/send-now`, {
      method: 'POST',
      body: JSON.stringify({ content: text }),
    });
    void reload();
  }, [participantId, reload]);

  const scheduleNew = useCallback(async (text: string, iso: string) => {
    setComposerHasText(false);
    await apiFetch(`${BASE_URL}/participants/${participantId}/scheduled-messages`, {
      method: 'POST',
      body: JSON.stringify({ content: text, scheduledAt: iso }),
    });
    void reload();
  }, [participantId, reload]);

  async function cancelScheduled(msgId: string) {
    try {
      await apiFetch(`${BASE_URL}/participants/${participantId}/scheduled-messages/${msgId}/cancel`, {
        method: 'POST',
      });
      void reload();
    } catch (e) {
      const m = e instanceof Error ? e.message :
        (typeof e === 'object' && e !== null && typeof (e as { message?: unknown }).message === 'string')
          ? (e as { message: string }).message : 'ביטול נכשל';
      setLoadErr(m);
    }
  }

  // ── Derived ────────────────────────────────────────────────────────────
  const orderedMessages = useMemo(() => {
    return [...messages].sort(
      (a, b) =>
        new Date(a.timestampFromSource).getTime() -
        new Date(b.timestampFromSource).getTime(),
    );
  }, [messages]);

  const pendingScheduled = useMemo(
    () => scheduled.filter((s) => s.status === 'pending'),
    [scheduled],
  );
  const otherScheduled = useMemo(
    () =>
      scheduled.filter((s) =>
        showCancelled ? s.status !== 'pending' : s.status === 'failed',
      ),
    [scheduled, showCancelled],
  );

  const editingRow = useMemo(
    () => scheduled.find((s) => s.id === editingId) ?? null,
    [scheduled, editingId],
  );

  // ── Smart auto-scroll ─────────────────────────────────────────────────
  // Pin to bottom only when the user is already there. If they've
  // scrolled up to read older history, leave them put and let the
  // unseen-count pill below tell them new messages arrived.
  // The "near bottom" threshold is generous (96px) so a small drift
  // mid-read still keeps auto-scroll engaged.
  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    if (isAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      setUnseenCount(0);
    }
  }, [messages, otherScheduled.length, loading]);

  // Track the user's scroll position so the auto-scroll effect knows
  // whether they're "at the bottom" for the next poll. Updated on
  // every scroll event but only the boolean is stored — no rerender
  // cost during scroll.
  function handleChatScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isAtBottomRef.current = distanceFromBottom < 96;
    if (isAtBottomRef.current && unseenCount > 0) setUnseenCount(0);
  }

  function jumpToBottom() {
    const el = chatScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    isAtBottomRef.current = true;
    setUnseenCount(0);
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        background: '#fff',
        position: 'relative',
      }}
    >
      {/* ── 1. Pending scheduled strip ──────────────────────────────── */}
      {pendingScheduled.length > 0 && (
        <div
          style={{
            background: '#fefce8',
            borderBottom: '1px solid #fde68a',
            padding: 10,
            flexShrink: 0,
            maxHeight: '32%',
            overflowY: 'auto',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 14 }}>⏰</span>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#713f12' }}>
              {pendingScheduled.length === 1
                ? '1 הודעה מתוזמנת'
                : `${pendingScheduled.length} הודעות מתוזמנות`}
            </div>
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            {pendingScheduled.map((s) => (
              <div
                key={s.id}
                style={{
                  background: '#fff',
                  borderRadius: 6,
                  padding: '6px 8px',
                  display: 'flex',
                  gap: 8,
                  alignItems: 'flex-start',
                  border: '1px solid #fef3c7',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12, color: '#0f172a',
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      maxHeight: 38, overflow: 'hidden',
                    }}
                  >
                    {s.content}
                  </div>
                  <div style={{ fontSize: 10, color: '#92400e', marginTop: 2, fontWeight: 600 }}>
                    מתוזמן ל־{formatScheduledTime(s.scheduledAt)}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => setEditingId(s.id)}
                    style={{
                      padding: '3px 8px', fontSize: 10, fontWeight: 600,
                      background: '#fff', color: '#1d4ed8',
                      border: '1px solid #bfdbfe', borderRadius: 5, cursor: 'pointer',
                    }}
                  >ערוך</button>
                  <button
                    type="button"
                    onClick={() => { void cancelScheduled(s.id); }}
                    style={{
                      padding: '3px 8px', fontSize: 10, fontWeight: 600,
                      background: '#fff', color: '#b91c1c',
                      border: '1px solid #fecaca', borderRadius: 5, cursor: 'pointer',
                    }}
                  >בטל</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 2. Chat conversation area ───────────────────────────────── */}
      <div
        ref={chatScrollRef}
        onScroll={handleChatScroll}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 12,
          background: '#f8fafc',
          minHeight: 0, // critical for flex+overflow in Firefox
          position: 'relative',
        }}
      >
        {loading && (
          <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, padding: 20 }}>
            טוען שיחה...
          </div>
        )}
        {loadErr && !loading && (
          <div style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: 8, padding: 10, fontSize: 13 }}>
            {loadErr}
          </div>
        )}
        {!loading && !loadErr && orderedMessages.length === 0 && (
          <div
            style={{
              textAlign: 'center', color: '#94a3b8', fontSize: 13,
              padding: 30,
            }}
          >
            אין עדיין הודעות בשיחה. כתבי הודעה למטה כדי להתחיל.
          </div>
        )}
        {orderedMessages.map((m) => {
          const isOut = m.direction === 'outgoing';
          return (
            <div
              key={m.id}
              style={{
                display: 'flex',
                justifyContent: isOut ? 'flex-start' : 'flex-end',
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  maxWidth: '75%',
                  background: isOut ? '#dcfce7' : '#fff',
                  color: '#0f172a',
                  borderRadius: 12,
                  padding: '8px 12px',
                  fontSize: 14,
                  lineHeight: 1.4,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  boxShadow: '0 1px 1px rgba(0,0,0,0.05)',
                }}
              >
                {m.textContent ?? (
                  m.messageType !== 'text'
                    ? <em style={{ color: '#64748b' }}>[{m.messageType}]</em>
                    : ''
                )}
                <div
                  style={{
                    fontSize: 10,
                    color: '#64748b',
                    marginTop: 4,
                    textAlign: isOut ? 'left' : 'right',
                  }}
                >
                  {formatTimestamp(m.timestampFromSource)}
                </div>
              </div>
            </div>
          );
        })}

        {otherScheduled.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4, fontWeight: 600, textAlign: 'center' }}>
              {showCancelled ? 'הודעות שלא נשלחו / בוטלו' : 'הודעות שנכשלו'}
            </div>
            {otherScheduled.map((s) => (
              <div
                key={s.id}
                style={{
                  background: s.status === 'failed' ? '#fef2f2' : '#f1f5f9',
                  border: `1px solid ${s.status === 'failed' ? '#fecaca' : '#e2e8f0'}`,
                  borderRadius: 8, padding: '6px 10px', marginBottom: 6,
                  fontSize: 12, color: '#475569',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  {statusPill(s.status)}
                  <span style={{ fontSize: 10, color: '#64748b' }}>{formatScheduledTime(s.scheduledAt)}</span>
                </div>
                <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', textDecoration: s.status === 'cancelled' ? 'line-through' : undefined }}>
                  {s.content}
                </div>
                {s.status === 'failed' && s.failureReason && (
                  <div style={{ marginTop: 4, fontSize: 11, color: '#b91c1c' }}>
                    סיבה: {s.failureReason}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
          <button
            type="button"
            onClick={() => setShowCancelled((v) => !v)}
            style={{
              fontSize: 10, color: '#94a3b8', background: 'transparent',
              border: 'none', cursor: 'pointer',
            }}
          >
            {showCancelled ? 'הסתר מבוטלות' : 'הצג מבוטלות'}
          </button>
        </div>
      </div>

      {/* ── Floating "new messages" pill ────────────────────────────── */}
      {/* Surfaces only when polling brought in new messages while the
          user is scrolled up. Click jumps to the bottom (resetting the
          unseen counter); otherwise it disappears the moment the user
          scrolls back into the bottom band themselves. */}
      {unseenCount > 0 && (
        <button
          type="button"
          onClick={jumpToBottom}
          style={{
            position: 'absolute',
            insetInlineStart: '50%',
            transform: 'translateX(-50%)',
            // Stack just above the composer dock. The composer itself
            // sets its own height; this offset tracks the typical
            // collapsed dock so the pill never sits on top of it.
            bottom: 132,
            background: '#16a34a',
            color: '#fff',
            border: 'none',
            borderRadius: 999,
            padding: '6px 14px',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: '0 6px 18px rgba(22,163,74,0.35)',
            zIndex: 5,
          }}
        >
          ↓ {unseenCount === 1 ? 'הודעה חדשה' : `${unseenCount} הודעות חדשות`}
        </button>
      )}

      {/* ── 3. Composer dock — shared component ─────────────────────── */}
      {/* MessageComposer owns its own text/mode/template state. Polling
          above doesn't touch it. The composer reports dirty (typed-but-
          not-sent) up via onDirtyChange so the popup wrapper can guard
          close. loadTemplates is wired to the participant-scoped
          endpoint that returns templates from every program the
          participant is currently active in. */}
      <MessageComposer
        onSendNow={sendNow}
        onSchedule={scheduleNew}
        loadTemplates={loadParticipantTemplates(participantId)}
        onDirtyChange={setComposerHasText}
        placeholder="הקלידי הודעה..."
      />

      {/* ── Edit modal for pending scheduled rows ───────────────────── */}
      {editingRow && (
        <EditScheduledModal
          row={editingRow}
          participantId={participantId}
          onClose={() => setEditingId(null)}
          onSaved={() => {
            setEditingId(null);
            void reload();
          }}
        />
      )}
    </div>
  );
}

// ─── Edit modal — locked, unsaved-changes confirm ─────────────────────────

function EditScheduledModal(props: {
  row: PrivateSched;
  participantId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const initialContent = props.row.content;
  const initialScheduledAt = isoToLocalInput(props.row.scheduledAt);
  const [content, setContent] = useState(initialContent);
  const [scheduledAt, setScheduledAt] = useState(initialScheduledAt);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const editorHandleRef = useRef<VariableEditorHandle | null>(null);

  // Wire VariableInsertButton to the textarea via an imperative
  // handle. Same insertion-at-caret pattern MessageComposer uses.
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    editorHandleRef.current = {
      insertAtCursor(token: string) {
        const el = taRef.current;
        if (!el) return;
        const start = el.selectionStart ?? content.length;
        const end = el.selectionEnd ?? content.length;
        const next = content.slice(0, start) + token + content.slice(end);
        setContent(next);
        requestAnimationFrame(() => {
          if (!el) return;
          const pos = start + token.length;
          el.focus();
          el.setSelectionRange(pos, pos);
        });
      },
      focus() { taRef.current?.focus(); },
    };
  }, [content]);

  const isDirty = content !== initialContent || scheduledAt !== initialScheduledAt;

  function attemptClose() {
    if (busy) return;
    if (isDirty) { setConfirmDiscard(true); return; }
    props.onClose();
  }

  async function save() {
    if (!content.trim()) { setErr('תוכן ההודעה הוא שדה חובה'); return; }
    if (!scheduledAt) { setErr('יש לבחור תאריך ושעה'); return; }
    setBusy(true);
    setErr('');
    try {
      await apiFetch(
        `${BASE_URL}/participants/${props.participantId}/scheduled-messages/${props.row.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            content: content.trim(),
            scheduledAt: localInputToIso(scheduledAt),
          }),
        },
      );
      props.onSaved();
    } catch (e) {
      const m = e instanceof Error ? e.message :
        (typeof e === 'object' && e !== null && typeof (e as { message?: unknown }).message === 'string')
          ? (e as { message: string }).message : 'שמירה נכשלה';
      setErr(m);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(15,23,42,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1200, padding: 16,
      }}
    >
      <div
        style={{
          background: '#fff', borderRadius: 14, padding: 22,
          width: '100%', maxWidth: 560, maxHeight: '92vh', overflowY: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>עריכת הודעה מתוזמנת</div>
          <button
            onClick={attemptClose}
            disabled={busy}
            style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 22, cursor: busy ? 'not-allowed' : 'pointer' }}
          >×</button>
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>תוכן *</label>
              <VariableInsertButton editorRef={editorHandleRef} />
            </div>
            <textarea
              ref={taRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={6}
              style={{
                width: '100%', padding: '10px 14px',
                border: '1px solid #cbd5e1', borderRadius: 8,
                fontSize: 14, lineHeight: 1.5, fontFamily: 'inherit',
                resize: 'vertical', boxSizing: 'border-box',
                minHeight: 120,
              }}
              placeholder="הקלידי תוכן..."
            />
          </div>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6, display: 'block' }}>תאריך ושעה (זמן ישראל) *</label>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              style={{
                width: '100%', padding: '10px 14px', direction: 'ltr',
                border: '1px solid #cbd5e1', borderRadius: 8,
                fontSize: 15, fontFamily: 'inherit', boxSizing: 'border-box',
              }}
            />
          </div>
        </div>
        {err && <div style={{ color: '#dc2626', fontSize: 13, marginTop: 10 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button
            onClick={attemptClose}
            disabled={busy}
            style={{
              background: '#f1f5f9', color: '#374151',
              border: '1px solid #e2e8f0', borderRadius: 8,
              padding: '7px 14px', fontSize: 13,
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >ביטול</button>
          <button
            onClick={() => { void save(); }}
            disabled={busy || !isDirty}
            style={{
              background: busy || !isDirty ? '#93c5fd' : '#2563eb',
              color: '#fff', border: 'none', borderRadius: 8,
              padding: '7px 18px', fontSize: 13, fontWeight: 600,
              cursor: busy || !isDirty ? 'not-allowed' : 'pointer',
            }}
          >{busy ? 'שומר...' : 'שמור'}</button>
        </div>
      </div>

      {confirmDiscard && (
        <div
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(15,23,42,0.55)',
            zIndex: 1300,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16,
          }}
        >
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
