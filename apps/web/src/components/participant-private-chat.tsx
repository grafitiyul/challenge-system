'use client';

// Reusable private-chat surface for a single participant. Used in two
// places, both reading/writing the SAME PrivateScheduledMessage rows
// (single source of truth keyed on participantId):
//   1. Participant profile → "צ׳אט" tab (full-page embed)
//   2. Group page → participant row WA button → locked popup wrapper
//
// Edits/cancels propagate automatically because both surfaces hit the
// same /participants/:id/scheduled-messages endpoints. There is no
// per-screen storage and no per-group duplication.
//
// Send-now goes through the bridge directly. Outbound persistence
// happens on the bridge side (WhatsAppMessage with direction='outgoing'),
// which the chat-timeline endpoint also reads — so a sent message
// appears in this timeline without any explicit write here.

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch, BASE_URL } from '@lib/api';
import { VariableButtonBar, type VariableEditorHandle } from '@components/variable-button-bar';

const WhatsAppEditor = dynamic(() => import('@components/whatsapp-editor'), { ssr: false });

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

// ─── Date helpers — match group sched modal behavior ──────────────────────
// The browser's datetime-local input returns a wall-clock string in the
// user's locale. Admins are in Israel so we treat that as Asia/Jerusalem
// without explicit timezone conversion — same approach the group
// scheduled-messages modal uses. Display always uses he-IL locale.

function localInputToIso(local: string): string {
  return new Date(local).toISOString();
}

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

function defaultScheduleSlot(): string {
  // Default to "in 1 hour" rounded to next 5 minutes — a sensible
  // starting point for the schedule picker that's always in the future.
  const d = new Date(Date.now() + 60 * 60_000);
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ─── Status pill rendering ────────────────────────────────────────────────

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
  // When true the component takes its own scrolling container (used by
  // the popup wrapper). When false the outer page handles scroll.
  selfScroll?: boolean;
  // Reports dirty composer state up to the parent so the popup wrapper
  // can guard close. Optional — the embedded version doesn't need it.
  onDirtyChange?: (dirty: boolean) => void;
}

export function ParticipantPrivateChat({
  participantId,
  selfScroll = false,
  onDirtyChange,
}: ParticipantPrivateChatProps) {
  // ── Composer state ────────────────────────────────────────────────────
  const [content, setContent] = useState('');
  const [mode, setMode] = useState<'now' | 'schedule'>('now');
  const [scheduledAt, setScheduledAt] = useState(defaultScheduleSlot);
  const [composerBusy, setComposerBusy] = useState(false);
  const [composerErr, setComposerErr] = useState('');
  const [composerOk, setComposerOk] = useState('');
  const editorHandleRef = useRef<VariableEditorHandle | null>(null);

  // ── Data state ────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [scheduled, setScheduled] = useState<PrivateSched[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [showCancelled, setShowCancelled] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await apiFetch<ChatResponse>(
        `${BASE_URL}/participants/${participantId}/chat`,
        { cache: 'no-store' },
      );
      setMessages(r.messages);
      setScheduled(r.scheduled);
      setLoadErr('');
    } catch (e) {
      const m = e instanceof Error ? e.message :
        (typeof e === 'object' && e !== null && typeof (e as { message?: unknown }).message === 'string')
          ? (e as { message: string }).message : 'טעינה נכשלה';
      setLoadErr(m);
    } finally {
      setLoading(false);
    }
  }, [participantId]);

  useEffect(() => { void reload(); }, [reload]);

  // Bubble dirty state up so a popup wrapper can show the unsaved-changes
  // confirm. Dirty = composer has unsubmitted text.
  const isDirty = content.trim().length > 0;
  useEffect(() => { onDirtyChange?.(isDirty); }, [isDirty, onDirtyChange]);

  // ── Composer actions ──────────────────────────────────────────────────
  async function send() {
    const text = content.trim();
    if (!text) { setComposerErr('תוכן ההודעה הוא שדה חובה'); return; }
    setComposerBusy(true);
    setComposerErr('');
    setComposerOk('');
    try {
      if (mode === 'now') {
        await apiFetch(`${BASE_URL}/participants/${participantId}/messages/send-now`, {
          method: 'POST',
          body: JSON.stringify({ content: text }),
        });
        setComposerOk('נשלח ✓');
      } else {
        const iso = localInputToIso(scheduledAt);
        await apiFetch(`${BASE_URL}/participants/${participantId}/scheduled-messages`, {
          method: 'POST',
          body: JSON.stringify({ content: text, scheduledAt: iso }),
        });
        setComposerOk('תוזמן ✓');
      }
      setContent('');
      // Don't reset the picker — admin might queue another at the same time.
      void reload();
    } catch (e) {
      const m = e instanceof Error ? e.message :
        (typeof e === 'object' && e !== null && typeof (e as { message?: unknown }).message === 'string')
          ? (e as { message: string }).message : 'שליחה נכשלה';
      setComposerErr(m);
    } finally {
      setComposerBusy(false);
    }
  }

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

  // ── Derived: timeline ordering ────────────────────────────────────────
  // Inbound + outbound from WhatsAppMessage, oldest at top. Future
  // scheduled rows surface in their own pinned strip above the timeline,
  // not in the timeline itself — keeps "what was sent" separate from
  // "what is queued."
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

  // ── Layout ────────────────────────────────────────────────────────────
  const wrapperStyle: React.CSSProperties = selfScroll
    ? { display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }
    : { display: 'flex', flexDirection: 'column' };
  const timelineStyle: React.CSSProperties = selfScroll
    ? { flex: 1, overflowY: 'auto', padding: '12px 4px' }
    : { padding: '12px 4px' };

  return (
    <div style={wrapperStyle}>
      {/* ── Composer ───────────────────────────────────────────────── */}
      <div
        style={{
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 12,
          padding: 14,
          marginBottom: 12,
        }}
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <button
            type="button"
            onClick={() => setMode('now')}
            style={{
              padding: '6px 12px', fontSize: 12, fontWeight: 600,
              background: mode === 'now' ? '#16a34a' : '#fff',
              color: mode === 'now' ? '#fff' : '#475569',
              border: `1px solid ${mode === 'now' ? '#16a34a' : '#cbd5e1'}`,
              borderRadius: 999, cursor: 'pointer',
            }}
          >שלח עכשיו</button>
          <button
            type="button"
            onClick={() => setMode('schedule')}
            style={{
              padding: '6px 12px', fontSize: 12, fontWeight: 600,
              background: mode === 'schedule' ? '#2563eb' : '#fff',
              color: mode === 'schedule' ? '#fff' : '#475569',
              border: `1px solid ${mode === 'schedule' ? '#2563eb' : '#cbd5e1'}`,
              borderRadius: 999, cursor: 'pointer',
            }}
          >תזמן</button>
          {mode === 'schedule' && (
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              style={{
                padding: '6px 10px', fontSize: 13, direction: 'ltr',
                border: '1px solid #cbd5e1', borderRadius: 8,
                fontFamily: 'inherit',
              }}
            />
          )}
        </div>
        <VariableButtonBar editorRef={editorHandleRef} />
        <WhatsAppEditor
          ref={editorHandleRef}
          value={content}
          onChange={setContent}
          placeholder="הקלידי הודעה..."
          minHeight={120}
        />
        {composerErr && (
          <div style={{ color: '#dc2626', fontSize: 12, marginTop: 8 }}>{composerErr}</div>
        )}
        {composerOk && (
          <div style={{ color: '#15803d', fontSize: 12, marginTop: 8 }}>{composerOk}</div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
          <button
            type="button"
            onClick={() => { void send(); }}
            disabled={composerBusy || !content.trim()}
            style={{
              padding: '8px 18px', fontSize: 13, fontWeight: 700,
              background: composerBusy || !content.trim()
                ? '#cbd5e1'
                : (mode === 'now' ? '#16a34a' : '#2563eb'),
              color: '#fff', border: 'none', borderRadius: 8,
              cursor: composerBusy || !content.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            {composerBusy
              ? '...'
              : mode === 'now'
                ? 'שלח עכשיו'
                : 'תזמן הודעה'}
          </button>
        </div>
      </div>

      {/* ── Pending scheduled strip ─────────────────────────────────── */}
      {pendingScheduled.length > 0 && (
        <div
          style={{
            background: '#fefce8',
            border: '1px solid #fde68a',
            borderRadius: 12,
            padding: 12,
            marginBottom: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 16 }}>⏰</span>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#713f12' }}>
              הודעות מתוזמנות ({pendingScheduled.length})
            </div>
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {pendingScheduled.map((s) => (
              <div
                key={s.id}
                style={{
                  background: '#fff',
                  borderRadius: 8,
                  padding: '8px 10px',
                  display: 'flex',
                  gap: 10,
                  alignItems: 'flex-start',
                  border: '1px solid #fef3c7',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13, color: '#0f172a',
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      maxHeight: 60, overflow: 'hidden',
                    }}
                  >
                    {s.content}
                  </div>
                  <div style={{ fontSize: 11, color: '#92400e', marginTop: 4, fontWeight: 600 }}>
                    מתוזמן ל־{formatScheduledTime(s.scheduledAt)}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => setEditingId(s.id)}
                    style={{
                      padding: '4px 10px', fontSize: 11, fontWeight: 600,
                      background: '#fff', color: '#1d4ed8',
                      border: '1px solid #bfdbfe', borderRadius: 6, cursor: 'pointer',
                    }}
                  >ערוך</button>
                  <button
                    type="button"
                    onClick={() => { void cancelScheduled(s.id); }}
                    style={{
                      padding: '4px 10px', fontSize: 11, fontWeight: 600,
                      background: '#fff', color: '#b91c1c',
                      border: '1px solid #fecaca', borderRadius: 6, cursor: 'pointer',
                    }}
                  >בטל</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Timeline ───────────────────────────────────────────────── */}
      <div style={timelineStyle}>
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
        {!loading && !loadErr && orderedMessages.length === 0 && pendingScheduled.length === 0 && (
          <div
            style={{
              textAlign: 'center', color: '#94a3b8', fontSize: 13,
              padding: 30, background: '#f8fafc', borderRadius: 12,
            }}
          >
            אין עדיין הודעות בשיחה.
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
                  background: isOut ? '#dbeafe' : '#f1f5f9',
                  color: '#0f172a',
                  borderRadius: 12,
                  padding: '8px 12px',
                  fontSize: 14,
                  lineHeight: 1.4,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
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

        {/* Failed scheduled rows + (optionally) cancelled — shown after the
            timeline so admin can see what went wrong without losing the
            chat flow above. */}
        {otherScheduled.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6, fontWeight: 600 }}>
              {showCancelled ? 'הודעות שלא נשלחו / בוטלו' : 'הודעות שנכשלו'}
            </div>
            {otherScheduled.map((s) => (
              <div
                key={s.id}
                style={{
                  background: s.status === 'failed' ? '#fef2f2' : '#f1f5f9',
                  border: `1px solid ${s.status === 'failed' ? '#fecaca' : '#e2e8f0'}`,
                  borderRadius: 8, padding: '8px 10px', marginBottom: 6,
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
              fontSize: 11, color: '#64748b', background: 'transparent',
              border: 'none', cursor: 'pointer',
            }}
          >
            {showCancelled ? 'הסתר מבוטלות' : 'הצג מבוטלות'}
          </button>
        </div>
      </div>

      {/* ── Edit modal ─────────────────────────────────────────────── */}
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
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6, display: 'block' }}>תוכן *</label>
            <VariableButtonBar editorRef={editorHandleRef} />
            <WhatsAppEditor
              ref={editorHandleRef}
              value={content}
              onChange={setContent}
              placeholder="הקלידי תוכן..."
              minHeight={160}
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

      {/* Unsaved-changes confirm. Same pattern as the group sched
          modal — locked overlay, no backdrop close, only the two
          buttons close the confirm. */}
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
