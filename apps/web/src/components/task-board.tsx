'use client';

/**
 * task-board.tsx — The unified responsive task planning board.
 *
 * Owns: week navigation, plan data, all modals, responsive layout.
 * Does NOT own: participant selection, token resolution, page header, chat.
 *
 * Used by:
 *   - apps/web/src/app/tasks/page.tsx            (admin planner)
 *   - apps/web/src/app/t/[token]/plan-tab.tsx    (participant portal)
 *
 * Desktop: 260px goals pool + 7-column kanban.
 * Mobile:  3-tab bar (היום / שבוע / יעדים).
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { BASE_URL, apiFetch } from '@lib/api';
import { TaskPoolRow, GoalSection } from '@components/task-engine-ui';
import { TaskBoardHeader } from '@components/task-board-header';
import WhatsAppEditor from '@components/whatsapp-editor';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AssignmentShape {
  id: string;
  scheduledDate: string;
  startTime: string | null;
  endTime: string | null;
  isCompleted: boolean;
  completedAt: string | null;
  status: string;
  carriedToId: string | null;
}

export interface TaskShape {
  id: string;
  title: string;
  notes: string | null;
  estimatedMinutes: number | null;
  sortOrder: number;
  isAbandoned: boolean;
  goalId: string | null;
  // Phase 6.16 recurrence. CSV of weekday indices (0..6). Null = not recurring.
  recurrenceWeekdays?: string | null;
  recurrenceStartTime?: string | null;
  recurrenceEndTime?: string | null;
  assignments: AssignmentShape[];
}

export interface GoalShape {
  id: string;
  title: string;
  description: string | null;
  sortOrder: number;
  isAbandoned: boolean;
  tasks: TaskShape[];
}

export interface WeekPlan {
  plan: { id: string; weekStart: string; status: string };
  goals: GoalShape[];
  ungroupedTasks: TaskShape[];
}

export interface BoardStats {
  dayDone: number;
  dayTotal: number;
  weekDone: number;
  weekTotal: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export const DAYS_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const DAYS_SHORT = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function weekSunday(d: Date): Date {
  const dt = new Date(d);
  dt.setHours(0, 0, 0, 0);
  dt.setDate(dt.getDate() - dt.getDay());
  return dt;
}

export function addDays(d: Date, n: number): Date {
  const dt = new Date(d);
  dt.setDate(dt.getDate() + n);
  return dt;
}

function formatDateHe(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${d.getFullYear()}`;
}

function formatShort(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function weekDays(sunday: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(sunday, i));
}

export function getAssignmentsForDay(
  plan: WeekPlan,
  dateStr: string,
): Array<{ task: TaskShape; assignment: AssignmentShape; goalTitle: string | null }> {
  const result: Array<{ task: TaskShape; assignment: AssignmentShape; goalTitle: string | null }> = [];
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
  return result.sort((a, b) =>
    (a.assignment.startTime ?? '99:99').localeCompare(b.assignment.startTime ?? '99:99'),
  );
}

// ─── Style constants ──────────────────────────────────────────────────────────

// Phase 6.16: input font-size must be ≥16px — below that, iOS Safari zooms
// on focus, which is the root cause of the reported "tap → page zooms"
// issue. Fix applies to text/date/select/textarea inputs uniformly; button
// labels, headings, and non-focusable text stay at their design sizes.
const inputSt: React.CSSProperties = {
  width: '100%', padding: '9px 12px', border: '1px solid #cbd5e1', borderRadius: 8,
  fontSize: 16, color: '#0f172a', background: '#fff', boxSizing: 'border-box',
  fontFamily: 'inherit', outline: 'none',
};
const labelSt: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5,
};
const btnPrimary: React.CSSProperties = {
  background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8,
  padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
};
const btnSecondary: React.CSSProperties = {
  background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 8,
  padding: '10px 20px', fontSize: 14, cursor: 'pointer',
};

// Phase 6.17: after the participant completes a valid HH:MM start-time, shift
// focus to the end-time input so they can keep typing without a manual tap.
// Used on every start/end time pair in the task module.
//
// <input type="time"> only emits a value that matches HH:MM when the native
// picker (mobile) or spinner (desktop) yields a complete time — partial
// keystrokes produce an empty string. So checking the regex in onChange is
// the right trigger; no timeouts or heuristics.
//
// Edge cases handled implicitly:
//   - User clears start (value = "")  → regex fails → no focus shift.
//   - End input unmounted / missing   → ref.current is null → no-op.
//   - End input already has a value   → still shift focus per spec
//     (user can overwrite) — we don't inspect end's value.
function handleStartTimeChange(
  nextValue: string,
  setStart: (s: string) => void,
  endRef: React.RefObject<HTMLInputElement | null>,
): void {
  setStart(nextValue);
  if (/^\d{2}:\d{2}$/.test(nextValue)) {
    endRef.current?.focus();
  }
}

// ─── Modal base ───────────────────────────────────────────────────────────────

function Modal({ onClose, title, children, width = 480 }: {
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  width?: number;
}) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
    }}>
      <div style={{
        background: '#fff', borderRadius: 14, width: '100%', maxWidth: width,
        maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '18px 22px', borderBottom: '1px solid #f1f5f9',
        }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>{title}</span>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', fontSize: 18, color: '#94a3b8',
            cursor: 'pointer', padding: 4, lineHeight: 1,
          }}>✕</button>
        </div>
        <div style={{ padding: '20px 22px' }}>{children}</div>
      </div>
    </div>
  );
}

// ─── Confirm Modal (no outside-click dismiss) ─────────────────────────────────

function ConfirmModal({
  title, description, confirmText = 'מחק', cancelText = 'ביטול', onConfirm, onCancel,
}: {
  title: string; description?: string; confirmText?: string; cancelText?: string;
  onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1100,
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div style={{
        background: '#fff', borderRadius: '16px 16px 0 0', width: '100%',
        maxWidth: 480, padding: '24px 20px 36px',
      }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#111827', marginBottom: description ? 8 : 20 }}>
          {title}
        </div>
        {description && (
          <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 20, lineHeight: 1.5 }}>{description}</div>
        )}
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onCancel} style={{
            flex: 1, padding: '12px', borderRadius: 10,
            background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb',
            fontSize: 15, fontWeight: 600, cursor: 'pointer',
          }}>{cancelText}</button>
          <button onClick={onConfirm} style={{
            flex: 1, padding: '12px', borderRadius: 10,
            background: '#dc2626', color: '#fff', border: 'none',
            fontSize: 15, fontWeight: 700, cursor: 'pointer',
          }}>{confirmText}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Carry Forward Modal ──────────────────────────────────────────────────────

function CarryModal({ assignment, task, onClose, onDone }: {
  assignment: AssignmentShape; task: TaskShape; onClose: () => void; onDone: () => void;
}) {
  const [toDate, setToDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function carry(dateStr: string) {
    setSaving(true);
    try {
      await apiFetch(`${BASE_URL}/task-engine/assignments/${assignment.id}/carry`, {
        method: 'POST', body: JSON.stringify({ toDate: dateStr }),
      });
      onDone();
    } catch (e: unknown) {
      setErr((e as { message?: string }).message ?? 'שגיאה');
    } finally { setSaving(false); }
  }

  function tomorrow() {
    const d = new Date(assignment.scheduledDate + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    return toDateStr(d);
  }

  function nextWeekSameDay() {
    const d = new Date(assignment.scheduledDate + 'T00:00:00');
    const day = d.getDay();
    const ns = weekSunday(addDays(d, 7));
    return toDateStr(addDays(ns, day));
  }

  return (
    <Modal onClose={onClose} title="העבר משימה" width={400}>
      <div style={{ fontSize: 14, color: '#0f172a', fontWeight: 600, marginBottom: 16 }}>{task.title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
        <button onClick={() => carry(tomorrow())} disabled={saving} style={{ ...btnSecondary, textAlign: 'right' as const }}>מחר</button>
        <button onClick={() => carry(nextWeekSameDay())} disabled={saving} style={{ ...btnSecondary, textAlign: 'right' as const }}>שבוע הבא (אותו יום)</button>
      </div>
      <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 16 }}>
        <label style={labelSt}>תאריך ספציפי</label>
        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={inputSt} />
        {err && <div style={{ color: '#dc2626', fontSize: 12, marginTop: 6 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 10, marginTop: 14, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btnSecondary}>ביטול</button>
          <button onClick={() => toDate && carry(toDate)} disabled={saving || !toDate} style={btnPrimary}>
            {saving ? '...' : 'העבר'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Time Edit Modal ──────────────────────────────────────────────────────────

function TimeModal({ assignment, task, onClose, onDone }: {
  assignment: AssignmentShape; task: TaskShape; onClose: () => void; onDone: () => void;
}) {
  const [startTime, setStartTime] = useState(assignment.startTime ?? '');
  const [endTime, setEndTime] = useState(assignment.endTime ?? '');
  const endTimeRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function handleSave() {
    setSaving(true);
    try {
      await apiFetch(`${BASE_URL}/task-engine/assignments/${assignment.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ startTime: startTime || null, endTime: endTime || null }),
      });
      onDone();
    } catch (e: unknown) {
      setErr((e as { message?: string }).message ?? 'שגיאה');
    } finally { setSaving(false); }
  }

  return (
    <Modal onClose={onClose} title="עדכן שעות" width={360}>
      <div style={{ fontSize: 14, color: '#0f172a', fontWeight: 600, marginBottom: 16 }}>{task.title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div>
          <label style={labelSt}>שעת התחלה</label>
          <input
            type="time"
            value={startTime}
            onChange={(e) => handleStartTimeChange(e.target.value, setStartTime, endTimeRef)}
            style={{ ...inputSt, fontSize: 16 }}
            dir="ltr"
          />
        </div>
        <div>
          <label style={labelSt}>שעת סיום</label>
          <input
            ref={endTimeRef}
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            style={{ ...inputSt, fontSize: 16 }}
            dir="ltr"
          />
        </div>
      </div>
      {err && <div style={{ color: '#dc2626', fontSize: 12, marginBottom: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={btnSecondary}>ביטול</button>
        <button onClick={handleSave} disabled={saving} style={btnPrimary}>{saving ? '...' : 'שמור'}</button>
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
        method: 'POST',
        body: JSON.stringify({ title: title.trim(), goalId: goalId || undefined, notes: notes.trim() || undefined }),
      });
      onDone();
    } catch (e: unknown) {
      setErr((e as { message?: string }).message ?? 'שגיאה');
    } finally { setSaving(false); }
  }

  return (
    <Modal onClose={onClose} title="משימה חדשה" width={440}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={labelSt}>שם המשימה <span style={{ color: '#dc2626' }}>*</span></label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} style={inputSt} placeholder="לדוגמה: לקרוא 20 עמודים" autoFocus />
        </div>
        <div>
          <label style={labelSt}>יעד (אופציונלי)</label>
          <select value={goalId} onChange={(e) => setGoalId(e.target.value)} style={inputSt}>
            <option value="">— ללא יעד —</option>
            {goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
          </select>
        </div>
        <div>
          <label style={labelSt}>הערות</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} style={{ ...inputSt, minHeight: 70, resize: 'vertical' }} placeholder="פרטים נוספים..." />
        </div>
        {err && <div style={{ color: '#dc2626', fontSize: 12 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btnSecondary}>ביטול</button>
          <button onClick={handleSave} disabled={saving || !title.trim()} style={btnPrimary}>{saving ? '...' : 'הוסף'}</button>
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
        method: 'POST',
        body: JSON.stringify({ title: title.trim(), description: description.trim() || undefined }),
      });
      onDone();
    } catch (e: unknown) {
      setErr((e as { message?: string }).message ?? 'שגיאה');
    } finally { setSaving(false); }
  }

  return (
    <Modal onClose={onClose} title="יעד שבועי חדש" width={420}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={labelSt}>שם היעד <span style={{ color: '#dc2626' }}>*</span></label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} style={inputSt} placeholder="לדוגמה: בריאות ותנועה" autoFocus />
        </div>
        <div>
          <label style={labelSt}>תיאור (אופציונלי)</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} style={inputSt} placeholder="מה כולל היעד הזה?" />
        </div>
        {err && <div style={{ color: '#dc2626', fontSize: 12 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btnSecondary}>ביטול</button>
          <button onClick={handleSave} disabled={saving || !title.trim()} style={btnPrimary}>{saving ? '...' : 'צור יעד'}</button>
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
    if (!title.trim()) return;
    setSaving(true);
    try {
      await apiFetch(`${BASE_URL}/task-engine/goals/${goal.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: title.trim(), description: description.trim() || null }),
      });
      onDone();
    } finally { setSaving(false); }
  }

  return (
    <Modal onClose={onClose} title="ערוך יעד" width={420}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={labelSt}>שם היעד</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} style={inputSt} autoFocus />
        </div>
        <div>
          <label style={labelSt}>תיאור</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} style={{ ...inputSt, minHeight: 70, resize: 'vertical' as const }} placeholder="תיאור אופציונלי..." />
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btnSecondary}>ביטול</button>
          <button onClick={handleSave} disabled={saving || !title.trim()} style={btnPrimary}>{saving ? '...' : 'שמור'}</button>
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
  // Phase 6.16 recurrence state. `recurringOn` is the toggle; weekdays is the
  // selected days (Set for O(1) add/remove). Times are optional.
  const initialDays = new Set<number>(
    (task.recurrenceWeekdays ?? '')
      .split(',')
      .map((x) => parseInt(x.trim(), 10))
      .filter((x) => Number.isFinite(x) && x >= 0 && x <= 6),
  );
  const [recurringOn, setRecurringOn] = useState<boolean>(initialDays.size > 0);
  const [weekdays, setWeekdays] = useState<Set<number>>(initialDays);
  const [recurrenceStart, setRecurrenceStart] = useState<string>(task.recurrenceStartTime ?? '');
  const [recurrenceEnd, setRecurrenceEnd] = useState<string>(task.recurrenceEndTime ?? '');
  const recurrenceEndRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);

  function toggleWeekday(d: number) {
    setWeekdays((prev) => {
      const n = new Set(prev);
      if (n.has(d)) n.delete(d); else n.add(d);
      return n;
    });
  }

  async function handleSave() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        title: title.trim(),
        goalId: goalId || null,
        notes: notes.trim() || null,
      };
      if (recurringOn && weekdays.size > 0) {
        // CSV of sorted weekday indices. Server normalizes again.
        body.recurrenceWeekdays = Array.from(weekdays).sort((a, b) => a - b).join(',');
        body.recurrenceStartTime = recurrenceStart || null;
        body.recurrenceEndTime = recurrenceEnd || null;
      } else {
        // Empty string tells the server to turn recurrence OFF.
        body.recurrenceWeekdays = '';
        body.recurrenceStartTime = null;
        body.recurrenceEndTime = null;
      }
      await apiFetch(`${BASE_URL}/task-engine/tasks/${task.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      onDone();
    } finally { setSaving(false); }
  }

  return (
    <Modal onClose={onClose} title="ערוך משימה" width={460}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={labelSt}>שם המשימה</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} style={inputSt} autoFocus />
        </div>
        <div>
          <label style={labelSt}>יעד</label>
          <select value={goalId} onChange={(e) => setGoalId(e.target.value)} style={inputSt}>
            <option value="">— ללא יעד —</option>
            {goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
          </select>
        </div>
        <div>
          <label style={labelSt}>הערות</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} style={{ ...inputSt, minHeight: 70, resize: 'vertical' as const }} placeholder="פרטים נוספים..." />
        </div>
        {/* Phase 6.16 recurrence controls */}
        <div style={{ border: '1px dashed #cbd5e1', borderRadius: 8, padding: 12, background: '#f8fafc' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600, color: '#0f172a' }}>
            <input
              type="checkbox"
              checked={recurringOn}
              onChange={(e) => setRecurringOn(e.target.checked)}
              style={{ width: 18, height: 18 }}
            />
            משימה חוזרת
          </label>
          {recurringOn && (
            <>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 8, marginBottom: 6 }}>
                בחרי ימים בשבוע שבהם המשימה תופיע אוטומטית:
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {DAYS_HE.map((label, idx) => {
                  const sel = weekdays.has(idx);
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => toggleWeekday(idx)}
                      style={{
                        background: sel ? '#eff6ff' : '#ffffff',
                        border: `1.5px solid ${sel ? '#2563eb' : '#e2e8f0'}`,
                        color: sel ? '#1d4ed8' : '#475569',
                        borderRadius: 999,
                        padding: '6px 14px',
                        fontSize: 13,
                        fontWeight: sel ? 700 : 500,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
                <div>
                  <label style={labelSt}>שעת התחלה (אופציונלי)</label>
                  <input
                    type="time"
                    value={recurrenceStart}
                    onChange={(e) => handleStartTimeChange(e.target.value, setRecurrenceStart, recurrenceEndRef)}
                    style={{ ...inputSt, fontSize: 16 }}
                    dir="ltr"
                  />
                </div>
                <div>
                  <label style={labelSt}>שעת סיום (אופציונלי)</label>
                  <input
                    ref={recurrenceEndRef}
                    type="time"
                    value={recurrenceEnd}
                    onChange={(e) => setRecurrenceEnd(e.target.value)}
                    style={{ ...inputSt, fontSize: 16 }}
                    dir="ltr"
                  />
                </div>
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8, lineHeight: 1.4 }}>
                המערכת תיצור אוטומטית את המשימות בכל שבוע. מחיקה או הזזה של מופע בודד לא תשפיע על השאר.
              </div>
            </>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btnSecondary}>ביטול</button>
          <button onClick={handleSave} disabled={saving || !title.trim()} style={btnPrimary}>{saving ? '...' : 'שמור'}</button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Assign-to-Day Modal ──────────────────────────────────────────────────────
// Handles both "שבץ" (new assignment) and "העבר יום" (move existing).

function AssignDayModal({ task, weekDateSet, currentWeekDays, onClose, onDone }: {
  task: TaskShape;
  weekDateSet: Set<string>;
  currentWeekDays: Date[];
  onClose: () => void;
  onDone: () => void;
}) {
  const existingAssignment = task.assignments.find(a => weekDateSet.has(a.scheduledDate)) ?? null;
  const isMove = existingAssignment !== null;

  const [selectedDate, setSelectedDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const endTimeRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const today = toDateStr(new Date());

  // Phase 6.16: for NEW assignments, show a rolling next-7-days window
  // starting from TODAY. Selecting "Monday" then always means "upcoming
  // Monday", never a past Monday earlier this week. For MOVE operations
  // we keep the calendar-week view so admins/participants can also move
  // a task backward to an earlier day within this week if they genuinely
  // need to.
  const dayButtons: Date[] = isMove
    ? currentWeekDays
    : Array.from({ length: 7 }, (_, i) => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() + i);
        return d;
      });

  async function handleAssign() {
    if (!selectedDate) { setErr('יש לבחור יום'); return; }
    setSaving(true);
    try {
      if (isMove) {
        await apiFetch(`${BASE_URL}/task-engine/assignments/${existingAssignment.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ scheduledDate: selectedDate, startTime: startTime || null, endTime: endTime || null }),
        });
      } else {
        await apiFetch(`${BASE_URL}/task-engine/tasks/${task.id}/assign`, {
          method: 'POST',
          body: JSON.stringify({ scheduledDate: selectedDate, startTime: startTime || undefined, endTime: endTime || undefined }),
        });
      }
      onDone();
    } catch (e: unknown) {
      setErr((e as { message?: string }).message ?? 'שגיאה');
    } finally { setSaving(false); }
  }

  return (
    <Modal onClose={onClose} title={isMove ? 'העברת משימה ליום אחר' : 'שבץ ליום'} width={400}>
      <div style={{ fontSize: 14, color: '#0f172a', fontWeight: 600, marginBottom: 16 }}>{task.title}</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        {dayButtons.map((d, idx) => {
          const str = toDateStr(d);
          const dayIdx = d.getDay();
          const isSel = selectedDate === str;
          const isTodayDate = str === today;
          // Phase 6.16 labels (new-assignment mode only): first rolling day
          // is tagged "(היום)" and the second "(מחר)" so the participant
          // immediately sees the forward interpretation.
          const suffix =
            isTodayDate ? ' (היום)'
            : (!isMove && idx === 1) ? ' (מחר)'
            : '';
          return (
            <button key={str} onClick={() => setSelectedDate(str)} style={{
              background: isSel ? '#eff6ff' : '#f8fafc',
              border: `1.5px solid ${isSel ? '#2563eb' : '#e2e8f0'}`,
              borderRadius: 8, padding: '10px 14px', textAlign: 'right' as const,
              cursor: 'pointer', color: isSel ? '#2563eb' : '#374151',
              fontWeight: isSel ? 600 : 400, fontSize: 14,
            }}>
              {DAYS_HE[dayIdx]} {formatDateHe(str)}{suffix}
            </button>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
        <div>
          <label style={labelSt}>שעת התחלה (אופציונלי)</label>
          <input
            type="time"
            value={startTime}
            onChange={(e) => handleStartTimeChange(e.target.value, setStartTime, endTimeRef)}
            style={{ ...inputSt, fontSize: 16 }}
            dir="ltr"
          />
        </div>
        <div>
          <label style={labelSt}>שעת סיום (אופציונלי)</label>
          <input
            ref={endTimeRef}
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            style={{ ...inputSt, fontSize: 16 }}
            dir="ltr"
          />
        </div>
      </div>

      {err && <div style={{ color: '#dc2626', fontSize: 12, marginBottom: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={btnSecondary}>ביטול</button>
        <button onClick={handleAssign} disabled={saving || !selectedDate} style={btnPrimary}>{saving ? '...' : isMove ? 'העבר' : 'שבץ'}</button>
      </div>
    </Modal>
  );
}

// ─── Summary Modal ────────────────────────────────────────────────────────────

function SummaryModal({ planId, participantId, mode, onClose }: {
  planId: string; participantId: string; mode: 'daily' | 'weekly'; onClose: () => void;
}) {
  const [data, setData] = useState<{ messagePreview: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (mode === 'daily') {
      apiFetch<{ messagePreview: string }>(
        `${BASE_URL}/task-engine/daily-summary?participantId=${participantId}&date=${toDateStr(new Date())}`,
        { cache: 'no-store' },
      ).then(setData).finally(() => setLoading(false));
    } else {
      apiFetch<{ messagePreview: string }>(
        `${BASE_URL}/task-engine/weekly-summary?planId=${planId}`,
        { cache: 'no-store' },
      ).then(setData).finally(() => setLoading(false));
    }
  }, [planId, participantId, mode]);

  function handleCopy() {
    if (data) {
      navigator.clipboard.writeText(data.messagePreview);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <Modal onClose={onClose} title={mode === 'daily' ? 'סיכום יומי' : 'סיכום שבועי'} width={480}>
      {loading ? (
        <div style={{ color: '#94a3b8', textAlign: 'center', padding: 32 }}>טוען...</div>
      ) : data ? (
        <div>
          <pre style={{
            background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8,
            padding: '14px 16px', fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap',
            fontFamily: 'inherit', color: '#0f172a', marginBottom: 16, direction: 'rtl',
          }}>
            {data.messagePreview}
          </pre>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={onClose} style={btnSecondary}>סגור</button>
            <button onClick={handleCopy} style={btnPrimary}>{copied ? '✓ הועתק' : 'העתק להדבקה'}</button>
          </div>
        </div>
      ) : (
        <div style={{ color: '#dc2626', fontSize: 14 }}>שגיאה בטעינת הסיכום</div>
      )}
    </Modal>
  );
}

// ─── Report message builder ───────────────────────────────────────────────────

type ReportTemplate = 'daily_summary';

function buildDayReportMessage(
  items: Array<{ task: TaskShape; assignment: AssignmentShape; goalTitle: string | null }>,
  dateStr: string,
): string {
  const d = new Date(dateStr + 'T00:00:00');
  const dayName = DAYS_HE[d.getDay()];
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const fullDate = `${day}/${month}/${d.getFullYear()}`;

  const relevant = items.filter(i => i.assignment.status !== 'carried_forward');
  const completed = relevant.filter(i => i.assignment.isCompleted);
  const incomplete = relevant.filter(i => !i.assignment.isCompleted);

  const lines: string[] = [];
  lines.push(`*סיכום ${dayName} ${fullDate}*`);
  lines.push('');

  if (completed.length > 0) {
    lines.push('בוצע:');
    completed.forEach(i => lines.push(`✅ ${i.task.title}`));
  } else {
    lines.push('בוצע:');
    lines.push('—');
  }

  lines.push('');

  if (incomplete.length > 0) {
    lines.push('לא בוצע:');
    incomplete.forEach(i => lines.push(`❌ ${i.task.title}`));
  } else {
    lines.push('לא בוצע:');
    lines.push('—');
  }

  return lines.join('\n');
}

// ─── Report Picker Modal ──────────────────────────────────────────────────────

const REPORT_TEMPLATES: { key: ReportTemplate; label: string; description: string }[] = [
  { key: 'daily_summary', label: 'הודעת סיכום יום', description: 'משימות שבוצעו ולא בוצעו ביום הנבחר' },
];

function ReportPickerModal({ onSelect, onClose }: {
  onSelect: (template: ReportTemplate) => void;
  onClose: () => void;
}) {
  return (
    <Modal onClose={onClose} title="שלח דיווח" width={420}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 13, color: '#64748b', marginBottom: 4 }}>בחרי סוג הודעה:</div>
        {REPORT_TEMPLATES.map(t => (
          <button
            key={t.key}
            onClick={() => onSelect(t.key)}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
              width: '100%', background: '#f8fafc', border: '1.5px solid #e2e8f0',
              borderRadius: 10, padding: '14px 16px', cursor: 'pointer',
              textAlign: 'right' as const, transition: 'border-color 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = '#93c5fd')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = '#e2e8f0')}
          >
            <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginBottom: 3 }}>{t.label}</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>{t.description}</div>
          </button>
        ))}
      </div>
    </Modal>
  );
}

// ─── Report Editor Modal ──────────────────────────────────────────────────────

function ReportEditorModal({ initialMessage, onClose }: {
  initialMessage: string;
  onClose: () => void;
}) {
  const [message, setMessage] = useState(initialMessage);
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(message);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleSend() {
    const encoded = encodeURIComponent(message);
    window.open(`https://wa.me/?text=${encoded}`, '_blank');
  }

  return (
    <Modal onClose={onClose} title="הודעת סיכום יום" width={520}>
      <div style={{ marginBottom: 16 }}>
        <WhatsAppEditor value={message} onChange={setMessage} minHeight={180} />
      </div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={btnSecondary}>סגור</button>
        <button onClick={handleCopy} style={{ ...btnSecondary, minWidth: 110 }}>
          {copied ? '✓ הועתק' : 'העתק'}
        </button>
        <button onClick={handleSend} style={{ ...btnPrimary, background: '#16a34a' }}>
          שלח WhatsApp
        </button>
      </div>
    </Modal>
  );
}

// ─── SVG icon buttons for AssignmentChip ─────────────────────────────────────

function ChipIconBtn({ onClick, title, color, children }: {
  onClick: () => void; title: string; color: string; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 32, height: 32, background: 'none', border: 'none',
        borderRadius: 6, cursor: 'pointer', color, flexShrink: 0,
        transition: 'background 0.1s',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#f1f5f9'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
    >
      {children}
    </button>
  );
}

const IconClock = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
  </svg>
);

const IconForward = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 17 20 12 15 7" /><path d="M4 18v-2a4 4 0 0 1 4-4h12" />
  </svg>
);

const IconRemove = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

// ─── Assignment Chip ──────────────────────────────────────────────────────────

function AssignmentChip({ item, onToggle, onCarry, onRemove, onEditTime, onDragStart, onDragEnd }: {
  item: { task: TaskShape; assignment: AssignmentShape; goalTitle: string | null };
  onToggle: () => void; onCarry: () => void; onRemove: () => void; onEditTime: () => void;
  onDragStart?: () => void; onDragEnd?: () => void;
}) {
  const { task, assignment } = item;
  const isCarried = assignment.status === 'carried_forward';
  const isDraggable = !isCarried && !assignment.isCompleted;

  return (
    <div
      draggable={isDraggable}
      onDragStart={isDraggable ? onDragStart : undefined}
      onDragEnd={isDraggable ? onDragEnd : undefined}
      style={{
        display: 'flex', flexDirection: 'column',
        background: isCarried ? '#fffbeb' : assignment.isCompleted ? '#f0fdf4' : '#fff',
        border: `1px solid ${isCarried ? '#fde68a' : assignment.isCompleted ? '#86efac' : '#e2e8f0'}`,
        borderLeft: `3px solid ${isCarried ? '#f59e0b' : assignment.isCompleted ? '#22c55e' : '#e2e8f0'}`,
        borderRadius: 8, padding: '10px 12px', opacity: isCarried ? 0.75 : 1,
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        cursor: isDraggable ? 'grab' : 'default',
      }}
    >

      {/* ── Row 1: checkbox + full-width text ─────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        {!isCarried && (
          <input
            type="checkbox"
            checked={assignment.isCompleted}
            onChange={onToggle}
            style={{ width: 16, height: 16, marginTop: 2, cursor: 'pointer', flexShrink: 0, accentColor: '#2563eb' }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13, fontWeight: 500,
            color: assignment.isCompleted ? '#94a3b8' : '#0f172a',
            textDecoration: assignment.isCompleted ? 'line-through' : 'none',
            lineHeight: 1.5, wordBreak: 'break-word',
          }}>
            {task.title}
          </div>
          {item.goalTitle && (
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{item.goalTitle}</div>
          )}
          {(assignment.startTime || isCarried) && (
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
              {isCarried
                ? 'הועבר'
                : `${assignment.startTime}${assignment.endTime ? ` — ${assignment.endTime}` : ''}`}
            </div>
          )}
        </div>
      </div>

      {/* ── Row 2: action icons (only for non-carried tasks) ──────────────── */}
      {!isCarried && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4,
          marginTop: 6,
          paddingRight: 26, /* align under text, past checkbox+gap */
        }}>
          <ChipIconBtn onClick={onEditTime} title="עדכן שעה" color="#94a3b8"><IconClock /></ChipIconBtn>
          <ChipIconBtn onClick={onRemove} title="הסר מיום זה" color="#f87171"><IconRemove /></ChipIconBtn>
        </div>
      )}
    </div>
  );
}

// ─── TaskBoard ────────────────────────────────────────────────────────────────

export interface TaskBoardProps {
  participantId: string;
  participantName?: string;
  showSummaryButtons?: boolean;
  initialSunday?: Date;
  onWeekChange?: (sunday: Date) => void;
  onStats?: (stats: BoardStats) => void;
}

export function TaskBoard({
  participantId,
  participantName,
  showSummaryButtons = false,
  initialSunday,
  onWeekChange,
  onStats,
}: TaskBoardProps) {
  const [currentSunday, setCurrentSundayState] = useState<Date>(() => initialSunday ?? weekSunday(new Date()));
  const [plan, setPlan] = useState<WeekPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  // Mobile state
  const [mobileTab, setMobileTab] = useState<'goals' | 'week' | 'today'>('today');
  const [selectedMobileDay, setSelectedMobileDay] = useState<string>(() => toDateStr(new Date()));

  // Internal stats — fed to TaskBoardHeader for completion pills
  const [boardStats, setBoardStats] = useState<BoardStats | null>(null);

  // Modals
  const [addGoalOpen, setAddGoalOpen] = useState(false);
  const [addTaskModal, setAddTaskModal] = useState<{ open: boolean; goalId?: string } | null>(null);
  const [carryModal, setCarryModal] = useState<{ assignment: AssignmentShape; task: TaskShape } | null>(null);
  const [timeModal, setTimeModal] = useState<{ assignment: AssignmentShape; task: TaskShape } | null>(null);
  const [assignModal, setAssignModal] = useState<TaskShape | null>(null);
  const [summaryModal, setSummaryModal] = useState<'daily' | 'weekly' | null>(null);
  const [reportPickerOpen, setReportPickerOpen] = useState(false);
  const [reportEditorMessage, setReportEditorMessage] = useState<string | null>(null);
  const [editGoalModal, setEditGoalModal] = useState<GoalShape | null>(null);
  const [editTaskModal, setEditTaskModal] = useState<TaskShape | null>(null);
  const [confirmState, setConfirmState] = useState<{ type: 'goal' | 'task' | 'assignment'; id: string } | null>(null);

  // Drag and drop state
  const dragInfo = useRef<{ assignmentId: string; fromDate: string } | null>(null);
  const [dragOverDay, setDragOverDay] = useState<string | null>(null);

  const days = weekDays(currentSunday);
  const weekDateSet = new Set(days.map(d => toDateStr(d)));
  const today = toDateStr(new Date());

  function setCurrentSunday(d: Date) {
    setCurrentSundayState(d);
    onWeekChange?.(d);
  }

  // ─── Data loading ──────────────────────────────────────────────────────────

  const loadPlan = useCallback(() => {
    if (!participantId) return;
    setLoading(true);
    setErr('');
    apiFetch<WeekPlan>(
      `${BASE_URL}/task-engine/week?participantId=${participantId}&week=${toDateStr(currentSunday)}`,
      { cache: 'no-store' },
    )
      .then(setPlan)
      .catch((e: unknown) => setErr((e as { message?: string }).message ?? 'שגיאה בטעינה'))
      .finally(() => setLoading(false));
  }, [participantId, currentSunday]);

  useEffect(() => { loadPlan(); }, [loadPlan]);

  // Phase 6.16: duplicate task. POSTs to the duplicate endpoint, then
  // reloads the plan. No optimistic update — the server may mutate sortOrder
  // and we want the refreshed tree to be the source of truth.
  async function handleDuplicateTask(task: TaskShape) {
    try {
      await apiFetch(`${BASE_URL}/task-engine/tasks/${task.id}/duplicate`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      loadPlan();
    } catch (e: unknown) {
      alert((e as { message?: string }).message ?? 'שגיאה בשכפול המשימה');
    }
  }

  // Phase 6.16: duplicate goal into a target plan. Default target = NEXT
  // week's plan (the "plan forward" product rule) so the participant can
  // copy this week's goal into next week with one click. If no planId is
  // passed to the backend, it copies into the same plan. We lazily resolve
  // the target plan for the next Sunday via getOrCreateWeekPlan (the normal
  // week fetch) so recurrence materialization runs there too.
  async function handleDuplicateGoal(goal: GoalShape, options?: { intoNextWeek?: boolean; includeTasks?: boolean }) {
    if (!participantId) return;
    try {
      let targetPlanId: string | undefined;
      if (options?.intoNextWeek) {
        const nextSunday = new Date(currentSunday);
        nextSunday.setUTCDate(nextSunday.getUTCDate() + 7);
        const nextWeekResp = await apiFetch<WeekPlan>(
          `${BASE_URL}/task-engine/week?participantId=${participantId}&week=${toDateStr(nextSunday)}`,
          { cache: 'no-store' },
        );
        targetPlanId = nextWeekResp.plan.id;
      }
      await apiFetch(`${BASE_URL}/task-engine/goals/${goal.id}/duplicate`, {
        method: 'POST',
        body: JSON.stringify({
          ...(targetPlanId ? { planId: targetPlanId } : {}),
          includeTasks: options?.includeTasks ?? false,
        }),
      });
      loadPlan();
    } catch (e: unknown) {
      alert((e as { message?: string }).message ?? 'שגיאה בשכפול היעד');
    }
  }

  // Compute stats whenever plan loads/changes — used by TaskBoardHeader pills
  useEffect(() => {
    if (!plan) return;
    const todayItems = getAssignmentsForDay(plan, today).filter(i => i.assignment.status !== 'carried_forward');
    const dayDone = todayItems.filter(i => i.assignment.isCompleted).length;
    const allWeek = days.flatMap(d => getAssignmentsForDay(plan, toDateStr(d))).filter(i => i.assignment.status !== 'carried_forward');
    const weekDone = allWeek.filter(i => i.assignment.isCompleted).length;
    const s: BoardStats = { dayDone, dayTotal: todayItems.length, weekDone, weekTotal: allWeek.length };
    setBoardStats(s);
    onStats?.(s);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, today]);

  // ─── Actions ──────────────────────────────────────────────────────────────

  async function handleToggleComplete(a: AssignmentShape) {
    try {
      await apiFetch(`${BASE_URL}/task-engine/assignments/${a.id}`, {
        method: 'PATCH', body: JSON.stringify({ isCompleted: !a.isCompleted }),
      });
      loadPlan();
    } catch {}
  }

  async function handleRemoveAssignment(a: AssignmentShape) {
    try {
      await apiFetch(`${BASE_URL}/task-engine/assignments/${a.id}`, { method: 'DELETE' });
      loadPlan();
    } catch {}
  }

  async function executeConfirmedDelete() {
    if (!confirmState) return;
    const { type, id } = confirmState;
    setConfirmState(null);
    try {
      if (type === 'goal') await apiFetch(`${BASE_URL}/task-engine/goals/${id}`, { method: 'DELETE' });
      else if (type === 'task') await apiFetch(`${BASE_URL}/task-engine/tasks/${id}`, { method: 'DELETE' });
      else if (type === 'assignment') await apiFetch(`${BASE_URL}/task-engine/assignments/${id}`, { method: 'DELETE' });
    } catch {}
    loadPlan();
  }

  function handleReportSelect(template: ReportTemplate) {
    if (!plan) return;
    // Use selectedMobileDay when the user is reviewing a specific day on mobile,
    // otherwise fall back to today's date.
    const dayForReport = selectedMobileDay !== today
      ? selectedMobileDay
      : today;
    const items = getAssignmentsForDay(plan, dayForReport);
    const msg = template === 'daily_summary'
      ? buildDayReportMessage(items, dayForReport)
      : '';
    setReportPickerOpen(false);
    setReportEditorMessage(msg);
  }

  async function handleDrop(targetDate: string) {
    const info = dragInfo.current;
    dragInfo.current = null;
    setDragOverDay(null);
    if (!info || info.fromDate === targetDate) return;

    // Optimistic update — move the card instantly, no loading state change, no flicker
    setPlan(prev => {
      if (!prev) return prev;
      const patchTasks = (tasks: TaskShape[]) =>
        tasks.map(t => ({
          ...t,
          assignments: t.assignments.map(a =>
            a.id === info.assignmentId ? { ...a, scheduledDate: targetDate } : a,
          ),
        }));
      return {
        ...prev,
        goals: prev.goals.map(g => ({ ...g, tasks: patchTasks(g.tasks) })),
        ungroupedTasks: patchTasks(prev.ungroupedTasks),
      };
    });

    try {
      await apiFetch(`${BASE_URL}/task-engine/assignments/${info.assignmentId}`, {
        method: 'PATCH',
        body: JSON.stringify({ scheduledDate: targetDate }),
      });
      // Success — optimistic state is correct, no reload needed
    } catch {
      // Revert on error by reloading true state
      loadPlan();
    }
  }

  // ─── Week label ────────────────────────────────────────────────────────────

  const weekLabel = `${formatShort(toDateStr(currentSunday))} — ${formatShort(toDateStr(addDays(currentSunday, 6)))}`;

  // ─── Render helpers ────────────────────────────────────────────────────────

  function renderAssignmentChip(item: { task: TaskShape; assignment: AssignmentShape; goalTitle: string | null }) {
    return (
      <AssignmentChip
        key={item.assignment.id}
        item={item}
        onToggle={() => handleToggleComplete(item.assignment)}
        onCarry={() => setCarryModal({ assignment: item.assignment, task: item.task })}
        onRemove={() => setConfirmState({ type: 'assignment', id: item.assignment.id })}
        onEditTime={() => setTimeModal({ assignment: item.assignment, task: item.task })}
        onDragStart={() => { dragInfo.current = { assignmentId: item.assignment.id, fromDate: item.assignment.scheduledDate }; }}
        onDragEnd={() => { dragInfo.current = null; setDragOverDay(null); }}
      />
    );
  }

  function renderDayColumn(date: Date, compact = false) {
    const str = toDateStr(date);
    const isToday = str === today;
    const items = plan ? getAssignmentsForDay(plan, str) : [];
    const dayIdx = date.getDay();

    return (
      <div
        key={str}
        style={{
          display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: 1,
          borderRadius: 8,
          outline: dragOverDay === str ? '2px solid #2563eb' : '2px solid transparent',
          transition: 'outline 0.1s',
        }}
        onDragOver={(e) => { e.preventDefault(); if (dragOverDay !== str) setDragOverDay(str); }}
        onDrop={(e) => { e.preventDefault(); handleDrop(str); }}
        onDragLeave={(e) => {
          if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDragOverDay(null);
        }}
      >
        <div style={{
          background: isToday ? 'linear-gradient(135deg, #2563eb 0%, #0ea5e9 100%)' : '#f8fafc',
          border: `1.5px solid ${isToday ? '#2563eb' : '#e2e8f0'}`,
          borderRadius: 8, padding: compact ? '6px 10px' : '8px 6px',
          textAlign: 'center' as const,
          boxShadow: isToday ? '0 2px 8px rgba(37,99,235,0.25)' : 'none',
        }}>
          <div style={{ fontSize: compact ? 11 : 12, fontWeight: 700, color: isToday ? '#fff' : '#374151' }}>
            {compact ? DAYS_SHORT[dayIdx] : DAYS_HE[dayIdx]}
          </div>
          <div style={{ fontSize: compact ? 10 : 12, fontWeight: compact ? 400 : 600, color: isToday ? '#fff' : '#1e293b', marginTop: 2, whiteSpace: 'nowrap' }} dir="ltr">
            {formatDateHe(str)}
          </div>
          {isToday && !compact && (
            <div style={{ fontSize: 9, color: '#93c5fd', marginTop: 2, letterSpacing: '0.04em' }}>היום</div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
          {items.map(renderAssignmentChip)}
          {items.length === 0 && (
            <div style={{
              border: `1.5px dashed ${isToday ? '#bfdbfe' : '#e2e8f0'}`,
              borderRadius: 8, padding: '14px 0', textAlign: 'center' as const,
              color: isToday ? '#93c5fd' : '#cbd5e1', fontSize: 11,
            }}>
              {isToday ? 'פנוי!' : '—'}
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderGoalsPanel() {
    if (!plan) return null;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {plan.goals.map((goal, gIdx) => (
          <GoalSection
            key={goal.id}
            goal={goal}
            goalIndex={gIdx}
            onEditGoal={() => setEditGoalModal(goal)}
            onDeleteGoal={() => setConfirmState({ type: 'goal', id: goal.id })}
            onDuplicateGoal={() =>
              handleDuplicateGoal(goal, { intoNextWeek: true, includeTasks: true })
            }
            onAddTask={() => setAddTaskModal({ open: true, goalId: goal.id })}
            showInlineAddTask={false}
            renderTask={(t) => {
              const ts = t as unknown as TaskShape;
              return (
                <TaskPoolRow
                  key={t.id}
                  task={t}
                  isAssigned={t.assignments.some(a => weekDateSet.has(a.scheduledDate))}
                  onEdit={() => setEditTaskModal(ts)}
                  onSchedule={() => setAssignModal(ts)}
                  onDelete={() => setConfirmState({ type: 'task', id: t.id })}
                  onDuplicate={() => handleDuplicateTask(ts)}
                  compact
                />
              );
            }}
          />
        ))}

        {plan.ungroupedTasks.length > 0 && (
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#64748b' }}>משימות ללא יעד</span>
            </div>
            <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {plan.ungroupedTasks.map((t) => (
                <TaskPoolRow
                  key={t.id}
                  task={t}
                  isAssigned={t.assignments.some(a => weekDateSet.has(a.scheduledDate))}
                  onEdit={() => setEditTaskModal(t as unknown as TaskShape)}
                  onSchedule={() => setAssignModal(t as unknown as TaskShape)}
                  onDelete={() => setConfirmState({ type: 'task', id: t.id })}
                  onDuplicate={() => handleDuplicateTask(t as unknown as TaskShape)}
                  compact
                />
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => setAddGoalOpen(true)} style={{ ...btnSecondary, fontSize: 13, padding: '8px 14px' }}>
            + יעד שבועי
          </button>
          <button onClick={() => setAddTaskModal({ open: true })} style={{ ...btnSecondary, fontSize: 13, padding: '8px 14px' }}>
            + משימה
          </button>
        </div>
      </div>
    );
  }

  // ─── Desktop layout ────────────────────────────────────────────────────────

  function renderDesktop() {
    return (
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        <div style={{ width: 260, flexShrink: 0 }}>
          <div style={{
            fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 12,
            textTransform: 'uppercase' as const, letterSpacing: '0.05em',
          }}>
            יעדים ומשימות
          </div>
          {loading ? (
            <div style={{ color: '#94a3b8', fontSize: 13, textAlign: 'center', padding: 24 }}>טוען...</div>
          ) : renderGoalsPanel()}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 12,
            textTransform: 'uppercase' as const, letterSpacing: '0.05em',
          }}>
            לוח שבועי
          </div>
          {loading ? (
            <div style={{ color: '#94a3b8', fontSize: 13, textAlign: 'center', padding: 40 }}>טוען...</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(85px, 1fr))', gap: 8, minWidth: 643 }}>
                {days.map((d) => renderDayColumn(d))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── Mobile layout ─────────────────────────────────────────────────────────

  function renderMobile() {
    return (
      <div>
        <div style={{ display: 'flex', background: '#f1f5f9', borderRadius: 10, padding: 3, marginBottom: 16, gap: 2 }}>
          {(['today', 'week', 'goals'] as const).map((tab) => {
            const labels = { today: 'היום', week: 'שבוע', goals: 'יעדים' };
            return (
              <button key={tab} onClick={() => setMobileTab(tab)} style={{
                flex: 1, padding: '8px', fontSize: 13, fontWeight: mobileTab === tab ? 700 : 500,
                background: mobileTab === tab ? '#fff' : 'transparent',
                border: 'none', borderRadius: 8, cursor: 'pointer',
                color: mobileTab === tab ? '#2563eb' : '#64748b',
                boxShadow: mobileTab === tab ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              }}>
                {labels[tab]}
              </button>
            );
          })}
        </div>

        {mobileTab === 'today' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {loading ? (
              <div style={{ color: '#94a3b8', textAlign: 'center', padding: 32 }}>טוען...</div>
            ) : plan ? (
              getAssignmentsForDay(plan, today).length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontSize: 14 }}>
                  אין משימות מתוזמנות להיום
                </div>
              ) : (
                getAssignmentsForDay(plan, today).map(renderAssignmentChip)
              )
            ) : null}
          </div>
        )}

        {mobileTab === 'week' && (
          <div>
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 8, marginBottom: 12 }}>
              {days.map((d) => {
                const str = toDateStr(d);
                const isTodayDate = str === today;
                const isSel = str === selectedMobileDay;
                const dayIdx = d.getDay();
                return (
                  <button key={str} onClick={() => setSelectedMobileDay(str)} style={{
                    flexShrink: 0, width: 52, padding: '8px 4px', borderRadius: 10,
                    border: `1.5px solid ${isSel ? '#2563eb' : isTodayDate ? '#93c5fd' : '#e2e8f0'}`,
                    background: isSel ? '#2563eb' : isTodayDate ? '#eff6ff' : '#f8fafc',
                    cursor: 'pointer', textAlign: 'center' as const,
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: isSel ? '#fff' : '#64748b' }}>
                      {DAYS_SHORT[dayIdx]}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: isSel ? '#bfdbfe' : '#374151', marginTop: 2 }}>
                      {d.getDate()}
                    </div>
                  </button>
                );
              })}
            </div>
            {loading ? (
              <div style={{ color: '#94a3b8', textAlign: 'center', padding: 32 }}>טוען...</div>
            ) : plan ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {getAssignmentsForDay(plan, selectedMobileDay).length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 32, color: '#94a3b8', fontSize: 13 }}>אין משימות ביום זה</div>
                ) : (
                  getAssignmentsForDay(plan, selectedMobileDay).map(renderAssignmentChip)
                )}
                <button onClick={() => setMobileTab('goals')} style={{ ...btnSecondary, fontSize: 13, marginTop: 4 }}>
                  + הוסף משימה ליום זה
                </button>
              </div>
            ) : null}
          </div>
        )}

        {mobileTab === 'goals' && (
          loading ? (
            <div style={{ color: '#94a3b8', textAlign: 'center', padding: 32 }}>טוען...</div>
          ) : renderGoalsPanel()
        )}
      </div>
    );
  }

  // ─── JSX ──────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Header — shown whenever participantName is provided */}
      {participantName && (
        <TaskBoardHeader
          participantName={participantName}
          stats={boardStats ?? undefined}
          onDailySummary={showSummaryButtons ? () => setSummaryModal('daily') : undefined}
          onWeeklySummary={showSummaryButtons ? () => setSummaryModal('weekly') : undefined}
          onReport={plan ? () => setReportPickerOpen(true) : undefined}
        />
      )}

      {/* Week navigation */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20,
        background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12,
        padding: '10px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      }}>
        <button onClick={() => setCurrentSunday(addDays(currentSunday, -7))} style={{
          background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8,
          padding: '6px 14px', cursor: 'pointer', fontSize: 13, color: '#374151', fontWeight: 600,
        }}>‹ קודם</button>
        <div style={{ flex: 1, textAlign: 'center' as const }}>
          <span style={{
            display: 'inline-block', fontSize: 15, fontWeight: 700, color: '#1e293b',
            background: '#f1f5f9', borderRadius: 8, padding: '4px 16px',
          }}>{weekLabel}</span>
        </div>
        <button onClick={() => setCurrentSunday(weekSunday(new Date()))} style={{
          background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8,
          padding: '6px 12px', cursor: 'pointer', fontSize: 12, color: '#2563eb', fontWeight: 600,
        }}>השבוע</button>
        <button onClick={() => setCurrentSunday(addDays(currentSunday, 7))} style={{
          background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8,
          padding: '6px 14px', cursor: 'pointer', fontSize: 13, color: '#374151', fontWeight: 600,
        }}>הבא ›</button>
      </div>

      {err && (
        <div style={{
          background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8,
          padding: '12px 16px', color: '#dc2626', fontSize: 13, marginBottom: 16,
        }}>{err}</div>
      )}

      {/* Desktop vs mobile */}
      <div className="tb-desktop">{renderDesktop()}</div>
      <div className="tb-mobile">{renderMobile()}</div>

      <style>{`
        .tb-desktop { display: flex; flex-direction: column; }
        .tb-mobile { display: none; }
        @media (max-width: 767px) {
          .tb-desktop { display: none; }
          .tb-mobile { display: block; }
        }
      `}</style>

      {/* Modals */}
      {confirmState && (
        <ConfirmModal
          title={
            confirmState.type === 'goal' ? 'מחיקת יעד' :
            confirmState.type === 'task' ? 'מחיקת משימה' : 'הסרת שיבוץ'
          }
          description={
            confirmState.type === 'goal' ? 'האם למחוק את היעד הזה?' :
            confirmState.type === 'task' ? 'האם למחוק את המשימה?' :
            'האם להסיר את המשימה מהיום הזה?'
          }
          confirmText={confirmState.type === 'assignment' ? 'הסר' : 'מחק'}
          onConfirm={executeConfirmedDelete}
          onCancel={() => setConfirmState(null)}
        />
      )}
      {addGoalOpen && plan && (
        <AddGoalModal
          planId={plan.plan.id}
          onClose={() => setAddGoalOpen(false)}
          onDone={() => { setAddGoalOpen(false); loadPlan(); }}
        />
      )}
      {addTaskModal?.open && plan && (
        <AddTaskModal
          planId={plan.plan.id}
          participantId={participantId}
          goals={plan.goals}
          defaultGoalId={addTaskModal.goalId}
          onClose={() => setAddTaskModal(null)}
          onDone={() => { setAddTaskModal(null); loadPlan(); }}
        />
      )}
      {assignModal && (
        <AssignDayModal
          task={assignModal}
          weekDateSet={weekDateSet}
          currentWeekDays={days}
          onClose={() => setAssignModal(null)}
          onDone={() => { setAssignModal(null); loadPlan(); }}
        />
      )}
      {carryModal && (
        <CarryModal
          assignment={carryModal.assignment}
          task={carryModal.task}
          onClose={() => setCarryModal(null)}
          onDone={() => { setCarryModal(null); loadPlan(); }}
        />
      )}
      {timeModal && (
        <TimeModal
          assignment={timeModal.assignment}
          task={timeModal.task}
          onClose={() => setTimeModal(null)}
          onDone={() => { setTimeModal(null); loadPlan(); }}
        />
      )}
      {summaryModal && plan && (
        <SummaryModal
          planId={plan.plan.id}
          participantId={participantId}
          mode={summaryModal}
          onClose={() => setSummaryModal(null)}
        />
      )}
      {reportPickerOpen && (
        <ReportPickerModal
          onSelect={handleReportSelect}
          onClose={() => setReportPickerOpen(false)}
        />
      )}
      {reportEditorMessage !== null && (
        <ReportEditorModal
          initialMessage={reportEditorMessage}
          onClose={() => setReportEditorMessage(null)}
        />
      )}
      {editGoalModal && (
        <EditGoalModal
          goal={editGoalModal}
          onClose={() => setEditGoalModal(null)}
          onDone={() => { setEditGoalModal(null); loadPlan(); }}
        />
      )}
      {editTaskModal && plan && (
        <EditTaskModal
          task={editTaskModal}
          goals={plan.goals}
          onClose={() => setEditTaskModal(null)}
          onDone={() => { setEditTaskModal(null); loadPlan(); }}
        />
      )}
    </div>
  );
}
