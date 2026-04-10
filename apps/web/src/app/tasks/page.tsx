'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { BASE_URL, apiFetch } from '@lib/api';
import { TaskPoolRow, GoalSection } from '@components/task-engine-ui';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Participant {
  id: string;
  firstName: string;
  lastName: string | null;
}

interface AssignmentShape {
  id: string;
  scheduledDate: string; // "YYYY-MM-DD"
  startTime: string | null;
  endTime: string | null;
  isCompleted: boolean;
  completedAt: string | null;
  status: string; // "scheduled" | "completed" | "carried_forward" | "abandoned"
  carriedToId: string | null;
}

interface TaskShape {
  id: string;
  title: string;
  notes: string | null;
  estimatedMinutes: number | null;
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DAYS_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const DAYS_SHORT = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

function toDateStr(d: Date): string {
  // Use LOCAL date methods — toISOString() returns UTC which is off-by-one for UTC+ timezones
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

function weekDays(sunday: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(sunday, i));
}

function formatDateHe(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getDate()}/${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function getAssignmentsForDay(plan: WeekPlan, dateStr: string): Array<{ task: TaskShape; assignment: AssignmentShape; goalTitle: string | null }> {
  const result: Array<{ task: TaskShape; assignment: AssignmentShape; goalTitle: string | null }> = [];

  for (const goal of plan.goals) {
    for (const task of goal.tasks) {
      for (const a of task.assignments) {
        if (a.scheduledDate === dateStr) {
          result.push({ task, assignment: a, goalTitle: goal.title });
        }
      }
    }
  }
  for (const task of plan.ungroupedTasks) {
    for (const a of task.assignments) {
      if (a.scheduledDate === dateStr) {
        result.push({ task, assignment: a, goalTitle: null });
      }
    }
  }

  result.sort((a, b) => {
    const ta = a.assignment.startTime ?? '99:99';
    const tb = b.assignment.startTime ?? '99:99';
    return ta.localeCompare(tb);
  });

  return result;
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

const inputSt: React.CSSProperties = {
  width: '100%', padding: '9px 12px', border: '1px solid #cbd5e1', borderRadius: 8,
  fontSize: 14, color: '#0f172a', background: '#fff', boxSizing: 'border-box',
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

// ─── Carry Forward Modal ──────────────────────────────────────────────────────

function CarryModal({
  assignment, task, onClose, onDone,
}: {
  assignment: AssignmentShape;
  task: TaskShape;
  onClose: () => void;
  onDone: () => void;
}) {
  const [toDate, setToDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function handleCarry() {
    if (!toDate) { setErr('יש לבחור תאריך יעד'); return; }
    setSaving(true);
    try {
      await apiFetch(`${BASE_URL}/task-engine/assignments/${assignment.id}/carry`, {
        method: 'POST',
        body: JSON.stringify({ toDate }),
      });
      onDone();
    } catch (e: unknown) {
      setErr((e as { message?: string }).message ?? 'שגיאה');
    } finally { setSaving(false); }
  }

  // Quick: tomorrow
  async function handleTomorrow() {
    const d = new Date(assignment.scheduledDate + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    const str = toDateStr(d);
    setSaving(true);
    try {
      await apiFetch(`${BASE_URL}/task-engine/assignments/${assignment.id}/carry`, {
        method: 'POST',
        body: JSON.stringify({ toDate: str }),
      });
      onDone();
    } catch (e: unknown) {
      setErr((e as { message?: string }).message ?? 'שגיאה');
    } finally { setSaving(false); }
  }

  // Quick: next week (same weekday)
  async function handleNextWeek() {
    const d = new Date(assignment.scheduledDate + 'T00:00:00');
    // Move to Sunday of next week, then same weekday
    const day = d.getDay();
    const nextSunday = addDays(weekSunday(addDays(d, 7)), 0);
    const target = addDays(nextSunday, day);
    setSaving(true);
    try {
      await apiFetch(`${BASE_URL}/task-engine/assignments/${assignment.id}/carry`, {
        method: 'POST',
        body: JSON.stringify({ toDate: toDateStr(target) }),
      });
      onDone();
    } catch (e: unknown) {
      setErr((e as { message?: string }).message ?? 'שגיאה');
    } finally { setSaving(false); }
  }

  return (
    <Modal onClose={onClose} title="העבר משימה" width={400}>
      <div style={{ fontSize: 14, color: '#0f172a', fontWeight: 600, marginBottom: 16 }}>{task.title}</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
        <button onClick={handleTomorrow} disabled={saving} style={{
          ...btnSecondary, textAlign: 'right' as const, fontSize: 14,
        }}>
          מחר
        </button>
        <button onClick={handleNextWeek} disabled={saving} style={{
          ...btnSecondary, textAlign: 'right' as const, fontSize: 14,
        }}>
          שבוע הבא (אותו יום)
        </button>
      </div>

      <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 16 }}>
        <label style={labelSt}>תאריך ספציפי</label>
        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={inputSt} />
        {err && <div style={{ color: '#dc2626', fontSize: 12, marginTop: 6 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 10, marginTop: 14, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btnSecondary}>ביטול</button>
          <button onClick={handleCarry} disabled={saving || !toDate} style={btnPrimary}>
            {saving ? '...' : 'העבר'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Time Edit Modal ──────────────────────────────────────────────────────────

function TimeModal({
  assignment, task, onClose, onDone,
}: {
  assignment: AssignmentShape;
  task: TaskShape;
  onClose: () => void;
  onDone: () => void;
}) {
  const [startTime, setStartTime] = useState(assignment.startTime ?? '');
  const [endTime, setEndTime] = useState(assignment.endTime ?? '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function handleSave() {
    setSaving(true);
    try {
      await apiFetch(`${BASE_URL}/task-engine/assignments/${assignment.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          startTime: startTime || null,
          endTime: endTime || null,
        }),
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
          <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} style={{ ...inputSt, fontSize: 16 }} dir="ltr" />
        </div>
        <div>
          <label style={labelSt}>שעת סיום</label>
          <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} style={{ ...inputSt, fontSize: 16 }} dir="ltr" />
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

function AddTaskModal({
  planId, participantId, goals, defaultGoalId, onClose, onDone,
}: {
  planId: string;
  participantId: string;
  goals: GoalShape[];
  defaultGoalId?: string;
  onClose: () => void;
  onDone: () => void;
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
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await apiFetch(`${BASE_URL}/task-engine/tasks/${task.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: title.trim(), goalId: goalId || null, notes: notes.trim() || null }),
      });
      onDone();
    } finally { setSaving(false); }
  }

  return (
    <Modal onClose={onClose} title="ערוך משימה" width={420}>
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
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btnSecondary}>ביטול</button>
          <button onClick={handleSave} disabled={saving || !title.trim()} style={btnPrimary}>{saving ? '...' : 'שמור'}</button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Assign-to-Day Modal ──────────────────────────────────────────────────────

function AssignDayModal({
  task, currentWeekDays, onClose, onDone,
}: {
  task: TaskShape;
  currentWeekDays: Date[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [selectedDate, setSelectedDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function handleAssign() {
    if (!selectedDate) { setErr('יש לבחור יום'); return; }
    setSaving(true);
    try {
      await apiFetch(`${BASE_URL}/task-engine/tasks/${task.id}/assign`, {
        method: 'POST',
        body: JSON.stringify({
          scheduledDate: selectedDate,
          startTime: startTime || undefined,
          endTime: endTime || undefined,
        }),
      });
      onDone();
    } catch (e: unknown) {
      setErr((e as { message?: string }).message ?? 'שגיאה');
    } finally { setSaving(false); }
  }

  return (
    <Modal onClose={onClose} title="שבץ ליום" width={400}>
      <div style={{ fontSize: 14, color: '#0f172a', fontWeight: 600, marginBottom: 16 }}>{task.title}</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        {currentWeekDays.map((d) => {
          const str = toDateStr(d);
          const day = d.getDay();
          const isSelected = selectedDate === str;
          const isToday = isSameDay(d, new Date());
          return (
            <button key={str} onClick={() => setSelectedDate(str)} style={{
              background: isSelected ? '#eff6ff' : '#f8fafc',
              border: `1.5px solid ${isSelected ? '#2563eb' : '#e2e8f0'}`,
              borderRadius: 8, padding: '10px 14px', textAlign: 'right' as const,
              cursor: 'pointer', color: isSelected ? '#2563eb' : '#374151',
              fontWeight: isSelected ? 600 : 400, fontSize: 14,
            }}>
              {DAYS_HE[day]} {formatDateHe(str)}{isToday ? ' (היום)' : ''}
            </button>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
        <div>
          <label style={labelSt}>שעת התחלה (אופציונלי)</label>
          <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} style={{ ...inputSt, fontSize: 16 }} dir="ltr" />
        </div>
        <div>
          <label style={labelSt}>שעת סיום (אופציונלי)</label>
          <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} style={{ ...inputSt, fontSize: 16 }} dir="ltr" />
        </div>
      </div>

      {err && <div style={{ color: '#dc2626', fontSize: 12, marginBottom: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={btnSecondary}>ביטול</button>
        <button onClick={handleAssign} disabled={saving || !selectedDate} style={btnPrimary}>{saving ? '...' : 'שבץ'}</button>
      </div>
    </Modal>
  );
}

// ─── Summary Modal ────────────────────────────────────────────────────────────

function SummaryModal({ planId, participantId, mode, onClose }: {
  planId: string;
  participantId: string;
  mode: 'daily' | 'weekly';
  onClose: () => void;
}) {
  const [data, setData] = useState<{ messagePreview: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (mode === 'daily') {
      const today = toDateStr(new Date());
      apiFetch<{ messagePreview: string }>(
        `${BASE_URL}/task-engine/daily-summary?participantId=${participantId}&date=${today}`,
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
            <button onClick={handleCopy} style={btnPrimary}>
              {copied ? '✓ הועתק' : 'העתק להדבקה'}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ color: '#dc2626', fontSize: 14 }}>שגיאה בטעינת הסיכום</div>
      )}
    </Modal>
  );
}

// ─── SVG icon buttons for assignment chip ────────────────────────────────────

// Consistent 32×32 tap target, no emoji, cross-platform rendering
function ChipIconBtn({
  onClick, title, color, children,
}: {
  onClick: () => void;
  title: string;
  color: string;
  children: React.ReactNode;
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

// Clock icon (set time)
const IconClock = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

// Arrow forward icon (carry forward)
const IconForward = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 17 20 12 15 7" />
    <path d="M4 18v-2a4 4 0 0 1 4-4h12" />
  </svg>
);

// X / remove icon
const IconRemove = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

// ─── Assignment chip ──────────────────────────────────────────────────────────

function AssignmentChip({
  item, onToggle, onCarry, onRemove, onEditTime,
}: {
  item: { task: TaskShape; assignment: AssignmentShape; goalTitle: string | null };
  onToggle: () => void;
  onCarry: () => void;
  onRemove: () => void;
  onEditTime: () => void;
}) {
  const { task, assignment } = item;
  const isCarried = assignment.status === 'carried_forward';

  return (
    <div style={{
      background: isCarried ? '#fffbeb' : assignment.isCompleted ? '#f0fdf4' : '#fff',
      border: `1px solid ${isCarried ? '#fde68a' : assignment.isCompleted ? '#86efac' : '#e2e8f0'}`,
      borderLeft: `3px solid ${isCarried ? '#f59e0b' : assignment.isCompleted ? '#22c55e' : '#e2e8f0'}`,
      borderRadius: 8, padding: '8px 10px', opacity: isCarried ? 0.75 : 1,
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {!isCarried && (
          <input
            type="checkbox"
            checked={assignment.isCompleted}
            onChange={onToggle}
            style={{ width: 16, height: 16, cursor: 'pointer', flexShrink: 0, accentColor: '#2563eb' }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13, fontWeight: 500, color: assignment.isCompleted ? '#94a3b8' : '#0f172a',
            textDecoration: assignment.isCompleted ? 'line-through' : 'none',
            wordBreak: 'break-word', lineHeight: 1.4,
          }}>
            {task.title}
          </div>
          {item.goalTitle && (
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>{item.goalTitle}</div>
          )}
          {(assignment.startTime || isCarried) && (
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 1 }}>
              {isCarried
                ? 'הועבר'
                : `${assignment.startTime}${assignment.endTime ? ` — ${assignment.endTime}` : ''}`}
            </div>
          )}
        </div>
        {!isCarried && (
          <div style={{ display: 'flex', gap: 0, flexShrink: 0 }}>
            <ChipIconBtn onClick={onEditTime} title="עדכן שעה" color="#94a3b8">
              <IconClock />
            </ChipIconBtn>
            <ChipIconBtn onClick={onCarry} title="העבר ליום אחר" color="#64748b">
              <IconForward />
            </ChipIconBtn>
            <ChipIconBtn onClick={onRemove} title="הסר מיום זה" color="#f87171">
              <IconRemove />
            </ChipIconBtn>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

function TasksPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Derive initial state from URL — makes refresh deterministic
  const participantIdParam = searchParams.get('participantId') ?? '';
  const weekParam = searchParams.get('week') ?? '';

  const [participants, setParticipants] = useState<Participant[]>([]);
  const [participantId, setParticipantId] = useState<string>(() => {
    // Priority: URL param → localStorage → empty
    if (participantIdParam) return participantIdParam;
    if (typeof window !== 'undefined') {
      return localStorage.getItem('tasks_participantId') ?? '';
    }
    return '';
  });
  const [currentSunday, setCurrentSunday] = useState<Date>(() => {
    if (weekParam) {
      // Parse the URL week param and snap to Sunday
      const d = new Date(weekParam + 'T00:00:00');
      return weekSunday(d);
    }
    return weekSunday(new Date());
  });
  const [plan, setPlan] = useState<WeekPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  // Mobile state
  const [mobileTab, setMobileTab] = useState<'goals' | 'week' | 'today'>('today');
  const [selectedMobileDay, setSelectedMobileDay] = useState<string>(() => toDateStr(new Date()));

  // Modals
  const [addGoalOpen, setAddGoalOpen] = useState(false);
  const [addTaskModal, setAddTaskModal] = useState<{ open: boolean; goalId?: string } | null>(null);
  const [carryModal, setCarryModal] = useState<{ assignment: AssignmentShape; task: TaskShape } | null>(null);
  const [timeModal, setTimeModal] = useState<{ assignment: AssignmentShape; task: TaskShape } | null>(null);
  const [assignModal, setAssignModal] = useState<TaskShape | null>(null);
  const [summaryModal, setSubmmaryModal] = useState<'daily' | 'weekly' | null>(null);
  const [editGoalModal, setEditGoalModal] = useState<GoalShape | null>(null);
  const [editTaskModal, setEditTaskModal] = useState<TaskShape | null>(null);

  const days = weekDays(currentSunday);
  const weekDateSet = new Set(days.map(d => toDateStr(d)));
  const today = toDateStr(new Date());

  // Load participants
  useEffect(() => {
    apiFetch<Participant[]>(`${BASE_URL}/participants?limit=200`, { cache: 'no-store' })
      .then((data) => { setParticipants(data); })
      .catch(() => {});
  }, []);

  // Load plan
  const loadPlan = useCallback(() => {
    if (!participantId) return;
    setLoading(true);
    setErr('');
    const weekStr = toDateStr(currentSunday);
    apiFetch<WeekPlan>(
      `${BASE_URL}/task-engine/week?participantId=${participantId}&week=${weekStr}`,
      { cache: 'no-store' },
    )
      .then(setPlan)
      .catch((e: unknown) => setErr((e as { message?: string }).message ?? 'שגיאה בטעינה'))
      .finally(() => setLoading(false));
  }, [participantId, currentSunday]);

  useEffect(() => { loadPlan(); }, [loadPlan]);

  // Keep URL + localStorage in sync with participantId and currentSunday.
  useEffect(() => {
    const params = new URLSearchParams();
    if (participantId) {
      params.set('participantId', participantId);
      localStorage.setItem('tasks_participantId', participantId);
    }
    params.set('week', toDateStr(currentSunday));
    router.replace(`/tasks?${params.toString()}`, { scroll: false });
  }, [participantId, currentSunday, router]);

  function handleChangeParticipant(id: string) {
    setParticipantId(id);
    if (id) localStorage.setItem('tasks_participantId', id);
    else localStorage.removeItem('tasks_participantId');
  }

  async function handleToggleComplete(a: AssignmentShape) {
    try {
      await apiFetch(`${BASE_URL}/task-engine/assignments/${a.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isCompleted: !a.isCompleted }),
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

  async function handleDeleteGoal(goalId: string) {
    try {
      await apiFetch(`${BASE_URL}/task-engine/goals/${goalId}`, { method: 'DELETE' });
      loadPlan();
    } catch {}
  }

  async function handleDeleteTask(taskId: string) {
    try {
      await apiFetch(`${BASE_URL}/task-engine/tasks/${taskId}`, { method: 'DELETE' });
      loadPlan();
    } catch {}
  }

  // ─── Derived ──────────────────────────────────────────────────────────────

  const selectedParticipant = participants.find((p) => p.id === participantId);
  const participantName = selectedParticipant
    ? `${selectedParticipant.firstName} ${selectedParticipant.lastName ?? ''}`.trim()
    : '';

  // ─── Week nav ──────────────────────────────────────────────────────────────

  const weekLabel = (() => {
    const end = addDays(currentSunday, 6);
    return `${formatDateHe(toDateStr(currentSunday))} — ${formatDateHe(toDateStr(end))}`;
  })();

  // ─── Render helpers ────────────────────────────────────────────────────────

  function renderAssignmentChip(item: { task: TaskShape; assignment: AssignmentShape; goalTitle: string | null }) {
    return (
      <AssignmentChip
        key={item.assignment.id}
        item={item}
        onToggle={() => handleToggleComplete(item.assignment)}
        onCarry={() => setCarryModal({ assignment: item.assignment, task: item.task })}
        onRemove={() => handleRemoveAssignment(item.assignment)}
        onEditTime={() => setTimeModal({ assignment: item.assignment, task: item.task })}
      />
    );
  }

  function renderDayColumn(date: Date, compact = false) {
    const str = toDateStr(date);
    const isToday = str === today;
    const items = plan ? getAssignmentsForDay(plan, str) : [];
    const dayIdx = date.getDay();

    return (
      <div key={str} style={{
        display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: 1,
      }}>
        {/* Day header */}
        <div style={{
          background: isToday
            ? 'linear-gradient(135deg, #2563eb 0%, #0ea5e9 100%)'
            : '#f8fafc',
          border: `1.5px solid ${isToday ? '#2563eb' : '#e2e8f0'}`,
          borderRadius: 8, padding: compact ? '6px 10px' : '8px 12px',
          textAlign: 'center' as const,
          boxShadow: isToday ? '0 2px 8px rgba(37,99,235,0.25)' : 'none',
        }}>
          <div style={{
            fontSize: compact ? 11 : 12, fontWeight: 700,
            color: isToday ? '#fff' : '#374151',
          }}>
            {compact ? DAYS_SHORT[dayIdx] : DAYS_HE[dayIdx]}
          </div>
          <div style={{
            fontSize: compact ? 10 : 11,
            color: isToday ? '#bfdbfe' : '#94a3b8', marginTop: 1,
          }}>
            {formatDateHe(str)}
          </div>
          {isToday && !compact && (
            <div style={{ fontSize: 9, color: '#93c5fd', marginTop: 2, letterSpacing: '0.04em' }}>היום</div>
          )}
        </div>

        {/* Assignments */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
          {items.map(renderAssignmentChip)}
          {items.length === 0 && (
            <div style={{
              border: `1.5px dashed ${isToday ? '#bfdbfe' : '#e2e8f0'}`,
              borderRadius: 8,
              padding: '14px 0', textAlign: 'center' as const,
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
        {/* Goals list */}
        {plan.goals.map((goal, gIdx) => (
          <GoalSection
            key={goal.id}
            goal={goal}
            goalIndex={gIdx}
            onEditGoal={() => setEditGoalModal(goal)}
            onDeleteGoal={() => handleDeleteGoal(goal.id)}
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
                  onDelete={() => handleDeleteTask(t.id)}
                  compact
                />
              );
            }}
          />
        ))}

        {/* Ungrouped tasks */}
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
                  onDelete={() => handleDeleteTask(t.id)}
                  compact
                />
              ))}
            </div>
          </div>
        )}

        {/* Add buttons */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => setAddGoalOpen(true)} style={{
            ...btnSecondary, fontSize: 13, padding: '8px 14px',
          }}>+ יעד שבועי</button>
          <button onClick={() => setAddTaskModal({ open: true })} style={{
            ...btnSecondary, fontSize: 13, padding: '8px 14px',
          }}>+ משימה</button>
        </div>
      </div>
    );
  }

  // ─── Desktop layout ────────────────────────────────────────────────────────

  function renderDesktop() {
    return (
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        {/* Left panel: goals + task pool */}
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

        {/* Right: week board */}
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 }}>
              {days.map((d) => renderDayColumn(d))}
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
        {/* Tab bar */}
        <div style={{
          display: 'flex', background: '#f1f5f9', borderRadius: 10, padding: 3, marginBottom: 16, gap: 2,
        }}>
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

        {/* Today tab */}
        {mobileTab === 'today' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {loading ? (
              <div style={{ color: '#94a3b8', textAlign: 'center', padding: 32 }}>טוען...</div>
            ) : plan ? (
              <>
                {getAssignmentsForDay(plan, today).length === 0 ? (
                  <div style={{
                    textAlign: 'center', padding: 40, color: '#94a3b8', fontSize: 14,
                  }}>
                    אין משימות מתוזמנות להיום
                  </div>
                ) : (
                  getAssignmentsForDay(plan, today).map(renderAssignmentChip)
                )}
              </>
            ) : null}
          </div>
        )}

        {/* Week tab — horizontal day switcher */}
        {mobileTab === 'week' && (
          <div>
            {/* Day selector row */}
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 8, marginBottom: 12 }}>
              {days.map((d) => {
                const str = toDateStr(d);
                const isToday = str === today;
                const isSel = str === selectedMobileDay;
                const dayIdx = d.getDay();
                return (
                  <button key={str} onClick={() => setSelectedMobileDay(str)} style={{
                    flexShrink: 0, width: 52, padding: '8px 4px', borderRadius: 10,
                    border: `1.5px solid ${isSel ? '#2563eb' : isToday ? '#93c5fd' : '#e2e8f0'}`,
                    background: isSel ? '#2563eb' : isToday ? '#eff6ff' : '#f8fafc',
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

            {/* Selected day tasks */}
            {loading ? (
              <div style={{ color: '#94a3b8', textAlign: 'center', padding: 32 }}>טוען...</div>
            ) : plan ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {getAssignmentsForDay(plan, selectedMobileDay).length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 32, color: '#94a3b8', fontSize: 13 }}>
                    אין משימות ביום זה
                  </div>
                ) : (
                  getAssignmentsForDay(plan, selectedMobileDay).map(renderAssignmentChip)
                )}
                <button onClick={() => {
                  // Open task list to pick and assign to selectedMobileDay
                  if (plan && plan.ungroupedTasks.length + plan.goals.flatMap((g) => g.tasks).length > 0) {
                    setMobileTab('goals');
                  } else {
                    setAddTaskModal({ open: true });
                  }
                }} style={{
                  ...btnSecondary, fontSize: 13, marginTop: 4,
                }}>+ הוסף משימה ליום זה</button>
              </div>
            ) : null}
          </div>
        )}

        {/* Goals tab */}
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
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>
      {/* Page header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0f172a', margin: 0, letterSpacing: '-0.3px' }}>תכנון שבועי</h1>
          {plan && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button onClick={() => setSubmmaryModal('daily')} style={{ ...btnSecondary, fontSize: 12, padding: '7px 12px' }}>
                סיכום יומי
              </button>
              <button onClick={() => setSubmmaryModal('weekly')} style={{ ...btnSecondary, fontSize: 12, padding: '7px 12px' }}>
                סיכום שבועי
              </button>
            </div>
          )}
        </div>

        {/* Participant context strip */}
        {participantId && selectedParticipant ? (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            background: 'linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%)',
            border: '1px solid #bfdbfe', borderRadius: 10,
            padding: '10px 16px',
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: '50%',
              background: 'linear-gradient(135deg, #2563eb, #0ea5e9)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: 15, fontWeight: 700, flexShrink: 0,
            }}>
              {selectedParticipant.firstName.charAt(0)}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1e40af' }}>{participantName}</div>
              <div style={{ fontSize: 11, color: '#60a5fa', marginTop: 1 }}>מתכנן שבועי פעיל</div>
            </div>
            <select
              value={participantId}
              onChange={(e) => handleChangeParticipant(e.target.value)}
              style={{ ...inputSt, width: 'auto', minWidth: 100, fontSize: 12, padding: '5px 8px', background: 'transparent', border: '1px solid #93c5fd', color: '#1d4ed8' }}
            >
              {participants.map((p) => (
                <option key={p.id} value={p.id}>{p.firstName} {p.lastName ?? ''}</option>
              ))}
            </select>
          </div>
        ) : (
          <div style={{
            background: '#fafafa', border: '2px dashed #cbd5e1', borderRadius: 12,
            padding: '20px 24px', textAlign: 'center' as const,
          }}>
            <div style={{ fontSize: 14, color: '#64748b', marginBottom: 12 }}>בחרי משתתפת כדי להתחיל את התכנון השבועי</div>
            <select
              value={participantId}
              onChange={(e) => handleChangeParticipant(e.target.value)}
              style={{ ...inputSt, width: 'auto', minWidth: 220, fontSize: 14, padding: '9px 12px', margin: '0 auto' }}
            >
              <option value="">— בחר משתתפת —</option>
              {participants.map((p) => (
                <option key={p.id} value={p.id}>{p.firstName} {p.lastName ?? ''}</option>
              ))}
            </select>
          </div>
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
        }}>‹ הבא</button>
      </div>

      {err && (
        <div style={{
          background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8,
          padding: '12px 16px', color: '#dc2626', fontSize: 13, marginBottom: 16,
        }}>{err}</div>
      )}

      {participantId && (
        <>
          {/* Desktop vs mobile */}
          <div className="tasks-desktop">{renderDesktop()}</div>
          <div className="tasks-mobile">{renderMobile()}</div>
        </>
      )}

      {/* Responsive style */}
      <style>{`
        .tasks-desktop { display: flex; flex-direction: column; }
        .tasks-mobile { display: none; }
        @media (max-width: 767px) {
          .tasks-desktop { display: none; }
          .tasks-mobile { display: block; }
        }
      `}</style>

      {/* Modals */}
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
      {assignModal && plan && (
        <AssignDayModal
          task={assignModal}
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
          onClose={() => setSubmmaryModal(null)}
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

export default function TasksPage() {
  return (
    <Suspense fallback={<div style={{ color: '#94a3b8', padding: 40, textAlign: 'center' }}>טוען...</div>}>
      <TasksPageInner />
    </Suspense>
  );
}
