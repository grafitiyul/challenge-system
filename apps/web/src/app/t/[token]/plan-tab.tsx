'use client';

/**
 * PlanTab — participant task planner inside the personal portal (/t/[token])
 * and the dedicated task portal (/tg/[token]).
 *
 * Owns: token resolution, portal context loading, chat panel.
 * Delegates: header (TaskBoardHeader), all board rendering (TaskBoard).
 *
 * The top header is rendered by TaskBoard via TaskBoardHeader — same shared
 * component as the admin /tasks surface. No duplicate header here.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { BASE_URL, apiFetch } from '@lib/api';
import { TaskBoard } from '@components/task-board';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PortalCtx {
  participantId: string;
  participantName: string;
  participantFirstName: string;
  groupId: string;
  groupName: string;
  taskEngineEnabled: boolean;
  memberIsActive: boolean;
}

interface TaskNote {
  id: string;
  participantId: string;
  content: string;
  senderType: string;
  senderName: string | null;
  createdAt: string;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const inp: React.CSSProperties = {
  width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8,
  fontSize: 16, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
};
const btnP: React.CSSProperties = {
  background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 8,
  padding: '11px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
};

// ─── Main component ───────────────────────────────────────────────────────────

export function PlanTab({ token }: { token: string }) {
  const [ctx, setCtx] = useState<PortalCtx | null>(null);
  const [ctxLoading, setCtxLoading] = useState(true);
  const [ctxErr, setCtxErr] = useState('');

  // Chat
  const [notes, setNotes] = useState<TaskNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [sendingNote, setSendingNote] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ─── Load portal context ─────────────────────────────────────────────────

  useEffect(() => {
    apiFetch<PortalCtx>(`${BASE_URL}/task-engine/portal/${token}`, { cache: 'no-store' })
      .then(setCtx)
      .catch(() => setCtxErr('שגיאה בטעינת הנתונים'))
      .finally(() => setCtxLoading(false));
  }, [token]);

  // ─── Chat ────────────────────────────────────────────────────────────────

  const loadNotes = useCallback(() => {
    if (!ctx?.participantId) return;
    setNotesLoading(true);
    apiFetch<TaskNote[]>(
      `${BASE_URL}/task-engine/notes?participantId=${ctx.participantId}`,
      { cache: 'no-store' },
    ).then(setNotes).finally(() => setNotesLoading(false));
  }, [ctx]);

  useEffect(() => { if (chatOpen) loadNotes(); }, [chatOpen, loadNotes]);

  useEffect(() => {
    if (chatOpen) setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  }, [notes, chatOpen]);

  async function sendNote() {
    if (!newNote.trim() || !ctx) return;
    setSendingNote(true);
    try {
      await apiFetch(`${BASE_URL}/task-engine/notes`, {
        method: 'POST',
        body: JSON.stringify({
          participantId: ctx.participantId,
          content: newNote.trim(),
          senderType: 'participant',
          senderName: ctx.participantFirstName,
        }),
      });
      setNewNote('');
      loadNotes();
    } finally { setSendingNote(false); }
  }

  // ─── Loading / error / disabled screens ─────────────────────────────────

  const rootStyle: React.CSSProperties = {
    minHeight: '100vh',
    background: '#f9fafb',
    fontFamily: 'Arial, Helvetica, sans-serif',
    direction: 'rtl',
    position: 'relative',
    overflowX: 'hidden',
  };

  if (ctxLoading) return (
    <div style={{ ...rootStyle, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>טוען...</div>
    </div>
  );
  if (ctxErr || !ctx) return (
    <div style={{ ...rootStyle, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', padding: 40, color: '#ef4444', fontSize: 14 }}>{ctxErr || 'שגיאה'}</div>
    </div>
  );
  if (!ctx.taskEngineEnabled) return (
    <div style={{ ...rootStyle, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', padding: 40 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
        <div style={{ fontSize: 16, fontWeight: 600, color: '#374151', marginBottom: 8 }}>תוכנית אישית</div>
        <div style={{ fontSize: 14, color: '#9ca3af' }}>התכונה הזו עדיין לא פעילה עבורך</div>
      </div>
    </div>
  );

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div style={{ ...rootStyle, paddingBottom: 32 }}>

      {/* ── Task board (header is rendered internally by TaskBoard → TaskBoardHeader) */}
      <div style={{ padding: '16px 16px 0' }}>
        <TaskBoard
          participantId={ctx.participantId}
          participantName={ctx.participantName}
        />
      </div>

      {/* ── Chat panel ────────────────────────────────────────────────────── */}
      <div style={{ padding: '0 16px', marginBottom: 16, marginTop: 8 }}>
        <button
          onClick={() => setChatOpen(!chatOpen)}
          style={{
            width: '100%', background: chatOpen ? '#1d4ed8' : '#f3f4f6',
            color: chatOpen ? '#fff' : '#374151',
            border: 'none', borderRadius: 10, padding: '12px 16px',
            fontSize: 14, fontWeight: 600, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}
        >
          <span>💬 שיחה עם המאמנת</span>
          <span style={{ fontSize: 12 }}>{chatOpen ? '▲ סגור' : '▼ פתח'}</span>
        </button>

        {chatOpen && (
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '0 0 10px 10px', padding: 14 }}>
            <div style={{ minHeight: 120, maxHeight: 240, overflowY: 'auto', marginBottom: 12 }}>
              {notesLoading ? (
                <div style={{ color: '#9ca3af', textAlign: 'center', padding: 20, fontSize: 13 }}>טוען...</div>
              ) : notes.length === 0 ? (
                <div style={{ color: '#9ca3af', textAlign: 'center', padding: 20, fontSize: 13 }}>עדיין אין הודעות</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {notes.map((n) => {
                    const isMe = n.senderType === 'participant';
                    const msgDate = new Date(n.createdAt);
                    const isTodayMsg = msgDate.toDateString() === new Date().toDateString();
                    const timeStr = msgDate.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
                    const dateStr = isTodayMsg
                      ? timeStr
                      : msgDate.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' }) + ' ' + timeStr;
                    return (
                      <div key={n.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start', gap: 2 }}>
                        {!isMe && (
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#92400e', paddingRight: 4 }}>
                            👩‍💼 המאמנת
                          </div>
                        )}
                        <div style={{
                          maxWidth: '82%',
                          background: isMe ? '#1d4ed8' : '#fff7ed',
                          color: isMe ? '#fff' : '#1c1917',
                          border: isMe ? 'none' : '1px solid #fed7aa',
                          borderRadius: isMe ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                          padding: '9px 13px', fontSize: 14, lineHeight: 1.5,
                        }}>
                          {n.content}
                          <div style={{ fontSize: 10, marginTop: 5, opacity: isMe ? 0.65 : 0.55, textAlign: 'left' as const }}>
                            {dateStr}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={chatEndRef} />
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendNote(); } }}
                placeholder="כתבי הודעה..."
                style={{ ...inp, flex: 1, fontSize: 14, padding: '9px 12px' }}
              />
              <button
                onClick={sendNote}
                disabled={sendingNote || !newNote.trim()}
                style={{ ...btnP, padding: '9px 16px', fontSize: 13, opacity: sendingNote || !newNote.trim() ? 0.5 : 1 }}
              >שלח</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
