'use client';

/**
 * Admin portal view of a participant's task plan.
 *
 * Access model:
 * - Defaults to VIEW-ONLY — admin cannot accidentally edit.
 * - "Edit for participant" button → double-confirmation modal → enables editing.
 * - Refreshing/navigating away ALWAYS resets to view-only (state, not localStorage).
 * - Chat sends as "coach".
 *
 * This uses the same task engine endpoints as the participant portal but accessed
 * by participantId (admin auth) instead of token (participant auth).
 */

import { use, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BASE_URL, apiFetch } from '@lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Participant {
  id: string;
  firstName: string;
  lastName: string | null;
}

interface AssignmentShape {
  id: string;
  scheduledDate: string;
  startTime: string | null;
  endTime: string | null;
  isCompleted: boolean;
  status: string;
  carriedToId: string | null;
}

interface TaskShape {
  id: string;
  title: string;
  notes: string | null;
  sortOrder: number;
  isAbandoned: boolean;
  goalId: string | null;
  assignments: AssignmentShape[];
}

interface GoalShape {
  id: string;
  title: string;
  description: string | null;
  sortOrder: number;
  isAbandoned: boolean;
  tasks: TaskShape[];
}

interface WeekPlan {
  plan: { id: string; weekStart: string; status: string };
  goals: GoalShape[];
  ungroupedTasks: TaskShape[];
}

interface TaskNote {
  id: string;
  content: string;
  senderType: string;
  senderName: string | null;
  createdAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DAYS_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const DAYS_SHORT = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function weekSunday(d: Date): Date {
  const dt = new Date(d);
  dt.setHours(0, 0, 0, 0);
  const day = dt.getDay();
  dt.setDate(dt.getDate() - day);
  return dt;
}

function addDays(d: Date, n: number): Date {
  const dt = new Date(d);
  dt.setDate(dt.getDate() + n);
  return dt;
}

function formatShort(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getDate()}/${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`;
}

function weekDays(sunday: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(sunday, i));
}

function getAssignmentsForDay(plan: WeekPlan, dateStr: string) {
  const result: { task: TaskShape; assignment: AssignmentShape; goalTitle: string | null }[] = [];
  for (const goal of plan.goals) {
    for (const task of goal.tasks) {
      for (const a of task.assignments) {
        if (a.scheduledDate === dateStr) result.push({ task, assignment: a, goalTitle: goal.title });
      }
    }
  }
  for (const task of plan.ungroupedTasks) {
    for (const a of task.assignments) {
      if (a.scheduledDate === dateStr) result.push({ task, assignment: a, goalTitle: null });
    }
  }
  return result.sort((a, b) => (a.assignment.startTime ?? '99:99').localeCompare(b.assignment.startTime ?? '99:99'));
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const inp: React.CSSProperties = {
  width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: 8,
  fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', color: '#0f172a',
};
const btnP: React.CSSProperties = {
  background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8,
  padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
};
const btnS: React.CSSProperties = {
  background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 8,
  padding: '10px 18px', fontSize: 14, cursor: 'pointer',
};
const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 };

// ─── Modal ────────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children, width = 440 }: {
  title: string; onClose: () => void; children: React.ReactNode; width?: number;
}) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: width, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid #f1f5f9' }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{title}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#94a3b8' }}>✕</button>
        </div>
        <div style={{ padding: '18px 20px' }}>{children}</div>
      </div>
    </div>
  );
}

// ─── Edit Confirmation Modal ──────────────────────────────────────────────────

function EditConfirmModal({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <Modal title="אישור מעבר למצב עריכה" onClose={onCancel} width={400}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{
          background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '12px 14px',
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#b45309', marginBottom: 6 }}>⚠️ שים לב</div>
          <div style={{ fontSize: 13, color: '#78350f', lineHeight: 1.6 }}>
            אתה עומד לערוך את התכנון השבועי <strong>עבור המשתתפת</strong>.
            שינויים שתבצע ישפיעו על התכנית האישית שלה.
            מצב עריכה מתאפס אוטומטית בעת רענון הדף.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={btnS}>ביטול</button>
          <button onClick={onConfirm} style={{ ...btnP, background: '#d97706' }}>אשר — ערוך עבור משתתפת</button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Add Goal Modal ───────────────────────────────────────────────────────────

function AddGoalModal({ planId, onClose, onDone }: { planId: string; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function handleSave() {
    if (!title.trim()) { setErr('שם היעד נדרש'); return; }
    setSaving(true);
    try {
      await apiFetch(`${BASE_URL}/task-engine/plans/${planId}/goals`, {
        method: 'POST', body: JSON.stringify({ title: title.trim(), description: description.trim() || undefined }),
      });
      onDone();
    } catch { setErr('שגיאה'); } finally { setSaving(false); }
  }

  return (
    <Modal title="יעד שבועי חדש" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div><label style={lbl}>שם היעד <span style={{ color: '#dc2626' }}>*</span></label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} style={inp} autoFocus placeholder="לדוגמה: בריאות ותנועה" />
        </div>
        <div><label style={lbl}>תיאור (אופציונלי)</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} style={{ ...inp, minHeight: 70, resize: 'vertical' as const }} placeholder="מה כולל היעד הזה?" />
        </div>
        {err && <div style={{ color: '#dc2626', fontSize: 12 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btnS}>ביטול</button>
          <button onClick={handleSave} disabled={saving || !title.trim()} style={{ ...btnP, opacity: saving ? 0.6 : 1 }}>{saving ? '...' : 'צור יעד'}</button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Edit Goal Modal ──────────────────────────────────────────────────────────

function EditGoalModal({ goal, onClose, onDone }: { goal: GoalShape; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState(goal.title);
  const [description, setDescription] = useState(goal.description ?? '');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await apiFetch(`${BASE_URL}/task-engine/goals/${goal.id}`, {
        method: 'PATCH', body: JSON.stringify({ title: title.trim(), description: description.trim() || null }),
      });
      onDone();
    } finally { setSaving(false); }
  }

  return (
    <Modal title="ערוך יעד" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div><label style={lbl}>שם היעד</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} style={inp} autoFocus />
        </div>
        <div><label style={lbl}>תיאור</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} style={{ ...inp, minHeight: 70, resize: 'vertical' as const }} placeholder="תיאור אופציונלי..." />
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btnS}>ביטול</button>
          <button onClick={handleSave} disabled={saving || !title.trim()} style={{ ...btnP, opacity: saving ? 0.6 : 1 }}>{saving ? '...' : 'שמור'}</button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Add Task Modal ───────────────────────────────────────────────────────────

function AddTaskModal({ planId, participantId, goals, defaultGoalId, onClose, onDone }: {
  planId: string; participantId: string; goals: GoalShape[]; defaultGoalId?: string;
  onClose: () => void; onDone: () => void;
}) {
  const [title, setTitle] = useState('');
  const [goalId, setGoalId] = useState(defaultGoalId ?? '');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function handleSave() {
    if (!title.trim()) { setErr('שם המשימה נדרש'); return; }
    setSaving(true);
    try {
      await apiFetch(`${BASE_URL}/task-engine/plans/${planId}/tasks?participantId=${participantId}`, {
        method: 'POST', body: JSON.stringify({ title: title.trim(), goalId: goalId || undefined, notes: notes.trim() || undefined }),
      });
      onDone();
    } catch { setErr('שגיאה'); } finally { setSaving(false); }
  }

  return (
    <Modal title="משימה חדשה" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div><label style={lbl}>שם המשימה <span style={{ color: '#dc2626' }}>*</span></label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} style={inp} autoFocus placeholder="לדוגמה: לקרוא 20 עמודים" />
        </div>
        <div><label style={lbl}>יעד</label>
          <select value={goalId} onChange={(e) => setGoalId(e.target.value)} style={{ ...inp, appearance: 'auto' as const }}>
            <option value="">— ללא יעד —</option>
            {goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
          </select>
        </div>
        <div><label style={lbl}>הערות</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} style={{ ...inp, minHeight: 60, resize: 'vertical' as const }} placeholder="פרטים נוספים..." />
        </div>
        {err && <div style={{ color: '#dc2626', fontSize: 12 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btnS}>ביטול</button>
          <button onClick={handleSave} disabled={saving || !title.trim()} style={{ ...btnP, opacity: saving ? 0.6 : 1 }}>{saving ? '...' : 'הוסף'}</button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Edit Task Modal ──────────────────────────────────────────────────────────

function EditTaskModal({ task, goals, onClose, onDone }: { task: TaskShape; goals: GoalShape[]; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState(task.title);
  const [goalId, setGoalId] = useState(task.goalId ?? '');
  const [notes, setNotes] = useState(task.notes ?? '');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await apiFetch(`${BASE_URL}/task-engine/tasks/${task.id}`, {
        method: 'PATCH', body: JSON.stringify({ title: title.trim(), goalId: goalId || null, notes: notes.trim() || null }),
      });
      onDone();
    } finally { setSaving(false); }
  }

  return (
    <Modal title="ערוך משימה" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div><label style={lbl}>שם המשימה</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} style={inp} autoFocus />
        </div>
        <div><label style={lbl}>יעד</label>
          <select value={goalId} onChange={(e) => setGoalId(e.target.value)} style={{ ...inp, appearance: 'auto' as const }}>
            <option value="">— ללא יעד —</option>
            {goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
          </select>
        </div>
        <div><label style={lbl}>הערות</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} style={{ ...inp, minHeight: 60, resize: 'vertical' as const }} placeholder="פרטים נוספים..." />
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btnS}>ביטול</button>
          <button onClick={handleSave} disabled={saving || !title.trim()} style={{ ...btnP, opacity: saving ? 0.6 : 1 }}>{saving ? '...' : 'שמור'}</button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Assign Day Modal ─────────────────────────────────────────────────────────

function AssignDayModal({ task, weekDaysList, today, onClose, onDone }: {
  task: TaskShape; weekDaysList: Date[]; today: string; onClose: () => void; onDone: () => void;
}) {
  const [selectedDate, setSelectedDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function handleAssign() {
    if (!selectedDate) { setErr('יש לבחור יום'); return; }
    setSaving(true);
    try {
      await apiFetch(`${BASE_URL}/task-engine/tasks/${task.id}/assign`, {
        method: 'POST', body: JSON.stringify({ scheduledDate: selectedDate }),
      });
      onDone();
    } catch { setErr('שגיאה'); } finally { setSaving(false); }
  }

  return (
    <Modal title="שבץ ליום" onClose={onClose} width={380}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{task.title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
        {weekDaysList.map((d) => {
          const str = toDateStr(d);
          const dayIdx = d.getDay();
          const isToday = str === today;
          const isSel = str === selectedDate;
          return (
            <button key={str} onClick={() => setSelectedDate(str)} style={{
              background: isSel ? '#eff6ff' : '#f8fafc', border: `1.5px solid ${isSel ? '#2563eb' : '#e2e8f0'}`,
              borderRadius: 8, padding: '10px 14px', textAlign: 'right' as const, cursor: 'pointer',
              color: isSel ? '#2563eb' : '#374151', fontWeight: isSel ? 600 : 400, fontSize: 14,
            }}>
              {DAYS_HE[dayIdx]} {formatShort(str)}{isToday ? ' (היום)' : ''}
            </button>
          );
        })}
      </div>
      {err && <div style={{ color: '#dc2626', fontSize: 12, marginBottom: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={btnS}>ביטול</button>
        <button onClick={handleAssign} disabled={saving || !selectedDate} style={{ ...btnP, opacity: saving ? 0.6 : 1 }}>{saving ? '...' : 'שבץ'}</button>
      </div>
    </Modal>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminPortalView({ params }: { params: Promise<{ id: string }> }) {
  const { id: participantId } = use(params);

  // Participant info
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [pLoading, setPLoading] = useState(true);

  // Plan data
  const [plan, setPlan] = useState<WeekPlan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [currentSunday, setCurrentSunday] = useState<Date>(() => weekSunday(new Date()));
  const [selectedDay, setSelectedDay] = useState<string>(() => toDateStr(new Date()));

  // Admin access control — NEVER persisted, always resets to view-only on load
  const [viewOnly, setViewOnly] = useState(true);
  const [showEditConfirm, setShowEditConfirm] = useState(false);

  // Chat
  const [notes, setNotes] = useState<TaskNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [sendingNote, setSendingNote] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Modals
  const [addGoalOpen, setAddGoalOpen] = useState(false);
  const [addTaskModal, setAddTaskModal] = useState<{ goalId?: string } | null>(null);
  const [editGoal, setEditGoal] = useState<GoalShape | null>(null);
  const [editTask, setEditTask] = useState<TaskShape | null>(null);
  const [assignModal, setAssignModal] = useState<TaskShape | null>(null);

  const today = toDateStr(new Date());
  const days = weekDays(currentSunday);
  const weekLabel = `${formatShort(toDateStr(currentSunday))} — ${formatShort(toDateStr(addDays(currentSunday, 6)))}`;
  const participantName = participant ? `${participant.firstName} ${participant.lastName ?? ''}`.trim() : '';

  // ─── Load participant ──────────────────────────────────────────────────────

  useEffect(() => {
    apiFetch<Participant>(`${BASE_URL}/participants/${participantId}`, { cache: 'no-store' })
      .then(setParticipant)
      .catch(() => {})
      .finally(() => setPLoading(false));
  }, [participantId]);

  // ─── Load plan ─────────────────────────────────────────────────────────────

  const loadPlan = useCallback(() => {
    setPlanLoading(true);
    apiFetch<WeekPlan>(
      `${BASE_URL}/task-engine/week?participantId=${participantId}&week=${toDateStr(currentSunday)}`,
      { cache: 'no-store' },
    ).then(setPlan).finally(() => setPlanLoading(false));
  }, [participantId, currentSunday]);

  useEffect(() => { loadPlan(); }, [loadPlan]);

  // ─── Load notes ────────────────────────────────────────────────────────────

  const loadNotes = useCallback(() => {
    setNotesLoading(true);
    apiFetch<TaskNote[]>(`${BASE_URL}/task-engine/notes?participantId=${participantId}`, { cache: 'no-store' })
      .then(setNotes)
      .finally(() => setNotesLoading(false));
  }, [participantId]);

  useEffect(() => {
    if (chatOpen) loadNotes();
  }, [chatOpen, loadNotes]);

  useEffect(() => {
    if (chatOpen) setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  }, [notes, chatOpen]);

  // ─── Actions ───────────────────────────────────────────────────────────────

  async function toggleComplete(a: AssignmentShape) {
    if (viewOnly) return;
    await apiFetch(`${BASE_URL}/task-engine/assignments/${a.id}`, {
      method: 'PATCH', body: JSON.stringify({ isCompleted: !a.isCompleted }),
    }).catch(() => {});
    loadPlan();
  }

  async function handleDeleteGoal(goalId: string) {
    if (viewOnly) return;
    if (!confirm('מחוק יעד זה?')) return;
    await apiFetch(`${BASE_URL}/task-engine/goals/${goalId}`, { method: 'DELETE' }).catch(() => {});
    loadPlan();
  }

  async function handleDeleteTask(taskId: string) {
    if (viewOnly) return;
    if (!confirm('מחוק משימה זו?')) return;
    await apiFetch(`${BASE_URL}/task-engine/tasks/${taskId}`, { method: 'DELETE' }).catch(() => {});
    loadPlan();
  }

  async function handleRemoveAssignment(assignmentId: string) {
    if (viewOnly) return;
    await apiFetch(`${BASE_URL}/task-engine/assignments/${assignmentId}`, { method: 'DELETE' }).catch(() => {});
    loadPlan();
  }

  async function sendNote() {
    if (!newNote.trim()) return;
    setSendingNote(true);
    try {
      await apiFetch(`${BASE_URL}/task-engine/notes`, {
        method: 'POST',
        body: JSON.stringify({
          participantId,
          content: newNote.trim(),
          senderType: 'coach',
          senderName: 'מאמנת',
        }),
      });
      setNewNote('');
      loadNotes();
    } finally { setSendingNote(false); }
  }

  // ─── Selected day items ────────────────────────────────────────────────────

  const selectedItems = plan ? getAssignmentsForDay(plan, selectedDay) : [];

  // ─── Render ────────────────────────────────────────────────────────────────

  if (pLoading) return <div className="page-wrapper" style={{ textAlign: 'center', paddingTop: 60, color: '#94a3b8' }}>טוען...</div>;

  return (
    <div className="page-wrapper" style={{ maxWidth: 1200, margin: '0 auto' }}>

      {/* Back link */}
      <div style={{ marginBottom: 16 }}>
        <Link href={`/participants/${participantId}?tab=goals`} style={{ fontSize: 13, color: '#2563eb' }}>
          ← חזרה לפרופיל
        </Link>
      </div>

      {/* Admin banner */}
      <div style={{
        background: viewOnly ? '#f8fafc' : '#fffbeb',
        border: `1px solid ${viewOnly ? '#e2e8f0' : '#fde68a'}`,
        borderRadius: 12, padding: '12px 18px', marginBottom: 20,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10,
      }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
            תוכנית שבועית — {participantName}
          </div>
          <div style={{ fontSize: 12, color: viewOnly ? '#94a3b8' : '#d97706', marginTop: 2 }}>
            {viewOnly ? '👁 מצב צפייה — לא ניתן לבצע שינויים' : '✏️ מצב עריכה פעיל — שינויים ישפיעו על תוכנית המשתתפת'}
          </div>
        </div>
        {viewOnly ? (
          <button
            onClick={() => setShowEditConfirm(true)}
            style={{ ...btnS, fontSize: 13, borderColor: '#fde68a', color: '#d97706' }}
          >
            ✏️ ערוך עבור משתתפת
          </button>
        ) : (
          <button
            onClick={() => setViewOnly(true)}
            style={{ ...btnS, fontSize: 13, borderColor: '#bfdbfe', color: '#1d4ed8' }}
          >
            👁 עבור לצפייה בלבד
          </button>
        )}
      </div>

      {/* Week navigation */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20,
        background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12,
        padding: '10px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      }}>
        <button onClick={() => setCurrentSunday(addDays(currentSunday, -7))} style={{
          background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8,
          padding: '6px 14px', cursor: 'pointer', fontSize: 13, color: '#374151', fontWeight: 600,
        }}>קודם ›</button>
        <div style={{ flex: 1, textAlign: 'center' as const }}>
          <span style={{ display: 'inline-block', fontSize: 14, fontWeight: 700, color: '#1e293b', background: '#f1f5f9', borderRadius: 8, padding: '4px 16px' }}>
            {weekLabel}
          </span>
        </div>
        <button onClick={() => { setCurrentSunday(weekSunday(new Date())); setSelectedDay(today); }} style={{
          background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8,
          padding: '6px 12px', cursor: 'pointer', fontSize: 12, color: '#2563eb', fontWeight: 600,
        }}>השבוע</button>
        <button onClick={() => setCurrentSunday(addDays(currentSunday, 7))} style={{
          background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8,
          padding: '6px 14px', cursor: 'pointer', fontSize: 13, color: '#374151', fontWeight: 600,
        }}>‹ הבא</button>
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>

        {/* Left: Goals + task pool */}
        <div style={{ width: 280, flexShrink: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 10, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
            יעדים ומשימות
          </div>
          {planLoading ? (
            <div style={{ color: '#94a3b8', textAlign: 'center', padding: 24 }}>טוען...</div>
          ) : plan ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {plan.goals.map((goal, gIdx) => {
                const colors = [
                  { bg: 'linear-gradient(90deg,#eff6ff,#f8fafc)', border: '#bfdbfe', title: '#1d4ed8' },
                  { bg: 'linear-gradient(90deg,#f0fdf4,#f8fafc)', border: '#86efac', title: '#15803d' },
                  { bg: 'linear-gradient(90deg,#fdf4ff,#f8fafc)', border: '#e9d5ff', title: '#7e22ce' },
                  { bg: 'linear-gradient(90deg,#fff7ed,#f8fafc)', border: '#fed7aa', title: '#c2410c' },
                ];
                const gc = colors[gIdx % colors.length];
                return (
                  <div key={goal.id} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
                    <div style={{ background: gc.bg, borderBottom: `1px solid ${gc.border}`, padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: gc.title }}>{goal.title}</div>
                        {goal.description && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{goal.description}</div>}
                      </div>
                      {!viewOnly && (
                        <div style={{ display: 'flex', gap: 4, flexShrink: 0, marginRight: 6 }}>
                          <button onClick={() => setEditGoal(goal)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 12 }} title="ערוך">✏️</button>
                          <button onClick={() => setAddTaskModal({ goalId: goal.id })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2563eb', fontSize: 12 }}>+ משימה</button>
                          <button onClick={() => handleDeleteGoal(goal.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fca5a5', fontSize: 12 }}>✕</button>
                        </div>
                      )}
                    </div>
                    <div style={{ padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {goal.tasks.map((t) => (
                        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', background: '#f8fafc', borderRadius: 6 }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 12, color: '#374151' }}>{t.title}</div>
                            {t.notes && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>{t.notes}</div>}
                          </div>
                          {!viewOnly && (
                            <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                              <button onClick={() => setEditTask(t)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 11 }}>✏️</button>
                              <button onClick={() => setAssignModal(t)} style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: 5, cursor: 'pointer', color: '#2563eb', fontSize: 11, padding: '1px 6px' }}>שבץ</button>
                              <button onClick={() => handleDeleteTask(t.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fca5a5', fontSize: 11 }}>✕</button>
                            </div>
                          )}
                        </div>
                      ))}
                      {goal.tasks.length === 0 && <div style={{ fontSize: 11, color: '#cbd5e1', padding: '3px 6px' }}>אין משימות עדיין</div>}
                    </div>
                  </div>
                );
              })}

              {plan.ungroupedTasks.length > 0 && (
                <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{ padding: '8px 12px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b' }}>משימות ללא יעד</span>
                  </div>
                  <div style={{ padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {plan.ungroupedTasks.map((t) => (
                      <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', background: '#f8fafc', borderRadius: 6 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12, color: '#374151' }}>{t.title}</div>
                          {t.notes && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>{t.notes}</div>}
                        </div>
                        {!viewOnly && (
                          <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                            <button onClick={() => setEditTask(t)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 11 }}>✏️</button>
                            <button onClick={() => setAssignModal(t)} style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: 5, cursor: 'pointer', color: '#2563eb', fontSize: 11, padding: '1px 6px' }}>שבץ</button>
                            <button onClick={() => handleDeleteTask(t.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fca5a5', fontSize: 11 }}>✕</button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!viewOnly && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setAddGoalOpen(true)} style={{ ...btnS, fontSize: 12, padding: '7px 12px', flex: 1 }}>+ יעד</button>
                  <button onClick={() => setAddTaskModal({})} style={{ ...btnS, fontSize: 12, padding: '7px 12px', flex: 1 }}>+ משימה</button>
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Right: Week board + day view */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 10, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
            לוח שבועי
          </div>

          {/* Day selector */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, overflowX: 'auto', paddingBottom: 4 }}>
            {days.map((d) => {
              const str = toDateStr(d);
              const isToday = str === today;
              const isSel = str === selectedDay;
              const dayIdx = d.getDay();
              const count = plan ? getAssignmentsForDay(plan, str).length : 0;
              return (
                <button key={str} onClick={() => setSelectedDay(str)} style={{
                  flexShrink: 0, minWidth: 60, padding: '7px 6px', borderRadius: 8, cursor: 'pointer',
                  textAlign: 'center' as const,
                  border: `1.5px solid ${isSel ? '#2563eb' : isToday ? '#93c5fd' : '#e2e8f0'}`,
                  background: isSel
                    ? 'linear-gradient(135deg,#2563eb,#0ea5e9)'
                    : isToday ? '#eff6ff' : '#f8fafc',
                  boxShadow: isSel ? '0 2px 8px rgba(37,99,235,0.2)' : 'none',
                }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: isSel ? '#fff' : '#64748b' }}>{DAYS_SHORT[dayIdx]}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: isSel ? '#bfdbfe' : '#374151', marginTop: 1 }}>{d.getDate()}</div>
                  {count > 0 && <div style={{ fontSize: 10, color: isSel ? '#93c5fd' : '#2563eb', marginTop: 2 }}>{count}</div>}
                </button>
              );
            })}
          </div>

          {/* Selected day tasks */}
          <div style={{
            background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 14,
            boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 10 }}>
              {DAYS_HE[new Date(selectedDay + 'T00:00:00').getDay()]} {formatShort(selectedDay)}
              {selectedDay === today ? ' (היום)' : ''}
            </div>
            {planLoading ? (
              <div style={{ color: '#94a3b8', textAlign: 'center', padding: 20 }}>טוען...</div>
            ) : selectedItems.length === 0 ? (
              <div style={{ border: '1.5px dashed #e2e8f0', borderRadius: 8, padding: 16, textAlign: 'center' as const, color: '#cbd5e1', fontSize: 12 }}>
                {selectedDay === today ? 'פנוי!' : '—'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {selectedItems.map(({ task, assignment, goalTitle }) => {
                  const isCarried = assignment.status === 'carried_forward';
                  return (
                    <div key={assignment.id} style={{
                      background: isCarried ? '#fffbeb' : assignment.isCompleted ? '#f0fdf4' : '#fff',
                      border: `1px solid ${isCarried ? '#fde68a' : assignment.isCompleted ? '#86efac' : '#e2e8f0'}`,
                      borderLeft: `3px solid ${isCarried ? '#f59e0b' : assignment.isCompleted ? '#22c55e' : '#e2e8f0'}`,
                      borderRadius: 8, padding: '8px 10px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {!isCarried && (
                          <input
                            type="checkbox"
                            checked={assignment.isCompleted}
                            onChange={() => toggleComplete(assignment)}
                            disabled={viewOnly}
                            style={{ width: 16, height: 16, cursor: viewOnly ? 'not-allowed' : 'pointer', accentColor: '#2563eb', flexShrink: 0 }}
                          />
                        )}
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, color: assignment.isCompleted ? '#94a3b8' : '#0f172a', textDecoration: assignment.isCompleted ? 'line-through' : 'none' }}>
                            {task.title}
                          </div>
                          {goalTitle && <div style={{ fontSize: 11, color: '#94a3b8' }}>{goalTitle}</div>}
                          {task.notes && <div style={{ fontSize: 11, color: '#64748b', fontStyle: 'italic', marginTop: 1 }}>{task.notes}</div>}
                          {isCarried && <div style={{ fontSize: 11, color: '#d97706' }}>הועבר</div>}
                        </div>
                        {!viewOnly && !isCarried && (
                          <button onClick={() => handleRemoveAssignment(assignment.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fca5a5', fontSize: 14 }}>✕</button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Chat */}
          <div style={{ marginTop: 16 }}>
            <button
              onClick={() => setChatOpen(!chatOpen)}
              style={{
                width: '100%', background: chatOpen ? '#1e40af' : '#f1f5f9',
                color: chatOpen ? '#fff' : '#374151', border: 'none', borderRadius: 10,
                padding: '11px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}
            >
              <span>💬 שיחה עם המשתתפת</span>
              <span style={{ fontSize: 11 }}>{chatOpen ? '▲ סגור' : '▼ פתח'}</span>
            </button>

            {chatOpen && (
              <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '0 0 10px 10px', padding: 14 }}>
                <div style={{ minHeight: 120, maxHeight: 300, overflowY: 'auto', marginBottom: 12 }}>
                  {notesLoading ? (
                    <div style={{ color: '#94a3b8', textAlign: 'center', padding: 20, fontSize: 13 }}>טוען...</div>
                  ) : notes.length === 0 ? (
                    <div style={{ color: '#94a3b8', textAlign: 'center', padding: 20, fontSize: 13 }}>עדיין אין הודעות</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {notes.map((n) => {
                        const isCoach = n.senderType === 'coach';
                        const msgDate = new Date(n.createdAt);
                        const isToday = msgDate.toDateString() === new Date().toDateString();
                        const timeStr = msgDate.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
                        const dateStr = isToday ? timeStr : msgDate.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' }) + ' ' + timeStr;
                        return (
                          <div key={n.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isCoach ? 'flex-end' : 'flex-start', gap: 2 }}>
                            {/* Sender label — only on incoming (participant) messages */}
                            {!isCoach && (
                              <div style={{ fontSize: 11, fontWeight: 700, color: '#15803d', paddingLeft: 4 }}>
                                👤 {n.senderName || 'משתתפת'}
                              </div>
                            )}
                            <div style={{
                              maxWidth: '78%',
                              background: isCoach ? '#1d4ed8' : '#f0fdf4',
                              color: isCoach ? '#fff' : '#14532d',
                              border: isCoach ? 'none' : '1px solid #bbf7d0',
                              borderRadius: isCoach ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                              padding: '9px 13px', fontSize: 13, lineHeight: 1.5,
                            }}>
                              {n.content}
                              <div style={{ fontSize: 10, marginTop: 5, opacity: isCoach ? 0.65 : 0.55, textAlign: 'left' as const }}>
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
                    placeholder="כתוב הודעה כמאמנת..."
                    style={{ ...inp, flex: 1 }}
                  />
                  <button
                    onClick={sendNote}
                    disabled={sendingNote || !newNote.trim()}
                    style={{ ...btnP, opacity: sendingNote || !newNote.trim() ? 0.5 : 1 }}
                  >שלח</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── Modals ─────────────────────────────────────────────────────────── */}

      {showEditConfirm && (
        <EditConfirmModal
          onConfirm={() => { setViewOnly(false); setShowEditConfirm(false); }}
          onCancel={() => setShowEditConfirm(false)}
        />
      )}

      {addGoalOpen && plan && (
        <AddGoalModal planId={plan.plan.id} onClose={() => setAddGoalOpen(false)} onDone={() => { setAddGoalOpen(false); loadPlan(); }} />
      )}

      {addTaskModal && plan && (
        <AddTaskModal
          planId={plan.plan.id}
          participantId={participantId}
          goals={plan.goals}
          defaultGoalId={addTaskModal.goalId}
          onClose={() => setAddTaskModal(null)}
          onDone={() => { setAddTaskModal(null); loadPlan(); }}
        />
      )}

      {editGoal && (
        <EditGoalModal goal={editGoal} onClose={() => setEditGoal(null)} onDone={() => { setEditGoal(null); loadPlan(); }} />
      )}

      {editTask && plan && (
        <EditTaskModal task={editTask} goals={plan.goals} onClose={() => setEditTask(null)} onDone={() => { setEditTask(null); loadPlan(); }} />
      )}

      {assignModal && (
        <AssignDayModal
          task={assignModal}
          weekDaysList={days}
          today={today}
          onClose={() => setAssignModal(null)}
          onDone={() => { setAssignModal(null); loadPlan(); }}
        />
      )}
    </div>
  );
}
