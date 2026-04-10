'use client';

/**
 * PlanTab — participant task planner inside the personal portal.
 * Loaded lazily when the participant opens the "תוכנית" tab.
 * Full edit access: participant can add/edit/delete goals and tasks, check off assignments.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { BASE_URL, apiFetch } from '@lib/api';

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

interface AssignmentShape {
  id: string;
  scheduledDate: string;
  startTime: string | null;
  isCompleted: boolean;
  status: string;
}

interface TaskShape {
  id: string;
  title: string;
  notes: string | null;
  startTime?: string | null;
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
  participantId: string;
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
  return `${d.getDate()}/${d.getMonth() + 1}`;
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
  width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8,
  fontSize: 16, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
};
const btnP: React.CSSProperties = {
  background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 8,
  padding: '11px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
};
const btnS: React.CSSProperties = {
  background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb', borderRadius: 8,
  padding: '11px 18px', fontSize: 14, cursor: 'pointer',
};

// ─── Simple modal ─────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200,
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div style={{
        background: '#fff', borderRadius: '16px 16px 0 0', width: '100%',
        maxWidth: 480, maxHeight: '85vh', overflowY: 'auto', padding: '20px 20px 32px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 16, fontWeight: 700 }}>{title}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#9ca3af' }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function PlanTab({ token }: { token: string }) {
  // Portal context
  const [ctx, setCtx] = useState<PortalCtx | null>(null);
  const [ctxLoading, setCtxLoading] = useState(true);
  const [ctxErr, setCtxErr] = useState('');

  // Plan data
  const [plan, setPlan] = useState<WeekPlan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [currentSunday, setCurrentSunday] = useState<Date>(() => weekSunday(new Date()));
  const [selectedDay, setSelectedDay] = useState<string>(() => toDateStr(new Date()));

  // Chat
  const [notes, setNotes] = useState<TaskNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [sendingNote, setSendingNote] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Modals
  const [addGoalOpen, setAddGoalOpen] = useState(false);
  const [addTaskGoalId, setAddTaskGoalId] = useState<string | undefined>(undefined);
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const [scheduleTarget, setScheduleTarget] = useState<{ task: TaskShape; activeAssignment: AssignmentShape | null } | null>(null);
  const [editGoal, setEditGoal] = useState<GoalShape | null>(null);
  const [editTask, setEditTask] = useState<TaskShape | null>(null);
  const [confirmState, setConfirmState] = useState<{
    type: 'goal' | 'task' | 'assignment';
    id: string;
  } | null>(null);

  const today = toDateStr(new Date());
  const days = weekDays(currentSunday);
  const weekDateSet = new Set(days.map(d => toDateStr(d)));

  // ─── Load context ───────────────────────────────────────────────────────────

  useEffect(() => {
    apiFetch<PortalCtx>(`${BASE_URL}/task-engine/portal/${token}`, { cache: 'no-store' })
      .then(setCtx)
      .catch(() => setCtxErr('שגיאה בטעינת הנתונים'))
      .finally(() => setCtxLoading(false));
  }, [token]);

  // ─── Load plan ──────────────────────────────────────────────────────────────

  const loadPlan = useCallback(() => {
    if (!ctx?.participantId) return;
    setPlanLoading(true);
    apiFetch<WeekPlan>(
      `${BASE_URL}/task-engine/week?participantId=${ctx.participantId}&week=${toDateStr(currentSunday)}`,
      { cache: 'no-store' },
    ).then(setPlan).finally(() => setPlanLoading(false));
  }, [ctx, currentSunday]);

  useEffect(() => { loadPlan(); }, [loadPlan]);

  // ─── Load notes ─────────────────────────────────────────────────────────────

  const loadNotes = useCallback(() => {
    if (!ctx?.participantId) return;
    setNotesLoading(true);
    apiFetch<TaskNote[]>(
      `${BASE_URL}/task-engine/notes?participantId=${ctx.participantId}`,
      { cache: 'no-store' },
    ).then(setNotes).finally(() => setNotesLoading(false));
  }, [ctx]);

  useEffect(() => {
    if (chatOpen) loadNotes();
  }, [chatOpen, loadNotes]);

  useEffect(() => {
    if (chatOpen) setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  }, [notes, chatOpen]);

  // ─── Actions ────────────────────────────────────────────────────────────────

  async function toggleComplete(a: AssignmentShape) {
    await apiFetch(`${BASE_URL}/task-engine/assignments/${a.id}`, {
      method: 'PATCH', body: JSON.stringify({ isCompleted: !a.isCompleted }),
    }).catch(() => {});
    loadPlan();
  }

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

  function handleDeleteGoal(goalId: string) {
    setConfirmState({ type: 'goal', id: goalId });
  }

  function handleDeleteTask(taskId: string) {
    setConfirmState({ type: 'task', id: taskId });
  }

  function handleRemoveAssignment(assignmentId: string) {
    setConfirmState({ type: 'assignment', id: assignmentId });
  }

  async function executeConfirmedDelete() {
    if (!confirmState) return;
    const { type, id } = confirmState;
    setConfirmState(null);
    if (type === 'goal') {
      await apiFetch(`${BASE_URL}/task-engine/goals/${id}`, { method: 'DELETE' }).catch(() => {});
    } else if (type === 'task') {
      await apiFetch(`${BASE_URL}/task-engine/tasks/${id}`, { method: 'DELETE' }).catch(() => {});
    } else if (type === 'assignment') {
      await apiFetch(`${BASE_URL}/task-engine/assignments/${id}`, { method: 'DELETE' }).catch(() => {});
    }
    loadPlan();
  }

  // ─── Render: loading / error / disabled ─────────────────────────────────────

  const rootStyle: React.CSSProperties = {
    minHeight: '100vh',
    background: '#f9fafb',
    fontFamily: 'Arial, Helvetica, sans-serif',
    direction: 'rtl',
    maxWidth: 480,
    margin: '0 auto',
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

  const todayItems = plan ? getAssignmentsForDay(plan, today) : [];
  const selectedItems = plan ? getAssignmentsForDay(plan, selectedDay) : [];
  const weekLabel = `${formatShort(toDateStr(currentSunday))} — ${formatShort(toDateStr(addDays(currentSunday, 6)))}`;

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ ...rootStyle, paddingBottom: 16 }}>
    <div style={{ padding: '0 0 16px' }}>

      {/* Week navigation */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: '#fff', borderBottom: '1px solid #f3f4f6', padding: '10px 16px',
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <button onClick={() => setCurrentSunday(addDays(currentSunday, -7))} style={{
          background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#374151', padding: '2px 6px',
        }}>›</button>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 13, fontWeight: 600, color: '#374151' }}>{weekLabel}</div>
        <button onClick={() => { setCurrentSunday(weekSunday(new Date())); setSelectedDay(today); }} style={{
          fontSize: 11, color: '#1d4ed8', background: '#eff6ff', border: 'none', borderRadius: 6,
          padding: '3px 8px', cursor: 'pointer',
        }}>השבוע</button>
        <button onClick={() => setCurrentSunday(addDays(currentSunday, 7))} style={{
          background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#374151', padding: '2px 6px',
        }}>‹</button>
      </div>

      {/* Day selector strip */}
      <div style={{ display: 'flex', overflowX: 'auto', padding: '10px 12px', gap: 6, background: '#fff' }}>
        {days.map((d) => {
          const str = toDateStr(d);
          const isToday = str === today;
          const isSel = str === selectedDay;
          const dayIdx = d.getDay();
          const assignCount = plan ? getAssignmentsForDay(plan, str).filter(i => !i.assignment.isCompleted && i.assignment.status !== 'carried_forward').length : 0;
          return (
            <button key={str} data-day={str} onClick={() => setSelectedDay(str)} style={{
              flexShrink: 0, minWidth: 48, padding: '8px 4px', borderRadius: 10, cursor: 'pointer',
              textAlign: 'center' as const, border: `1.5px solid ${isSel ? '#1d4ed8' : isToday ? '#93c5fd' : '#e5e7eb'}`,
              background: isSel ? '#1d4ed8' : isToday ? '#eff6ff' : '#f9fafb',
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: isSel ? '#fff' : '#6b7280' }}>{DAYS_SHORT[dayIdx]}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: isSel ? '#bfdbfe' : '#111827', marginTop: 2 }}>{d.getDate()}</div>
              {assignCount > 0 && (
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: isSel ? '#93c5fd' : '#1d4ed8', margin: '3px auto 0' }} />
              )}
            </button>
          );
        })}
      </div>

      {/* Day's tasks */}
      <div style={{ padding: '12px 16px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', marginBottom: 8, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
          {selectedDay === today ? 'היום' : `${DAYS_HE[new Date(selectedDay + 'T00:00:00').getDay()]} ${formatShort(selectedDay)}`}
        </div>

        {planLoading ? (
          <div style={{ color: '#9ca3af', textAlign: 'center', padding: 24, fontSize: 13 }}>טוען...</div>
        ) : selectedItems.length === 0 ? (
          <div style={{
            border: '1.5px dashed #e5e7eb', borderRadius: 10, padding: 20,
            textAlign: 'center' as const, color: '#9ca3af', fontSize: 13,
          }}>
            {selectedDay === today ? '🎉 אין משימות להיום' : 'אין משימות ביום זה'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {selectedItems.map(({ task, assignment, goalTitle }) => {
              const isCarried = assignment.status === 'carried_forward';
              return (
                <div key={assignment.id} style={{
                  background: isCarried ? '#fffbeb' : assignment.isCompleted ? '#f0fdf4' : '#fff',
                  border: `1px solid ${isCarried ? '#fde68a' : assignment.isCompleted ? '#86efac' : '#e5e7eb'}`,
                  borderLeft: `3px solid ${isCarried ? '#f59e0b' : assignment.isCompleted ? '#22c55e' : '#d1d5db'}`,
                  borderRadius: 10, padding: '12px 14px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    {!isCarried && (
                      <input
                        type="checkbox"
                        checked={assignment.isCompleted}
                        onChange={() => toggleComplete(assignment)}
                        style={{ marginTop: 2, width: 18, height: 18, cursor: 'pointer', accentColor: '#1d4ed8', flexShrink: 0 }}
                      />
                    )}
                    <div style={{ flex: 1 }}>
                      <div style={{
                        fontSize: 15, fontWeight: 500,
                        color: assignment.isCompleted ? '#9ca3af' : '#111827',
                        textDecoration: assignment.isCompleted ? 'line-through' : 'none',
                      }}>{task.title}</div>
                      {goalTitle && <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>{goalTitle}</div>}
                      {task.notes && !assignment.isCompleted && (
                        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4, fontStyle: 'italic' }}>{task.notes}</div>
                      )}
                      {isCarried && <div style={{ fontSize: 11, color: '#d97706', marginTop: 2 }}>הועבר</div>}
                      {assignment.startTime && !isCarried && (
                        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{assignment.startTime}</div>
                      )}
                    </div>
                    {!isCarried && !assignment.isCompleted && (
                      <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                        <button
                          onClick={() => handleRemoveAssignment(assignment.id)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fca5a5', padding: '2px 4px', fontSize: 16 }}
                          title="הסר מהיום"
                        >✕</button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Goals + task pool */}
      {plan && (
        <div style={{ padding: '0 16px 16px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', marginBottom: 10, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
            יעדים ומשימות השבוע
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {plan.goals.map((goal, gIdx) => {
              const colors = [
                { bg: '#eff6ff', border: '#bfdbfe', title: '#1d4ed8' },
                { bg: '#f0fdf4', border: '#86efac', title: '#15803d' },
                { bg: '#fdf4ff', border: '#e9d5ff', title: '#7e22ce' },
                { bg: '#fff7ed', border: '#fed7aa', title: '#c2410c' },
              ];
              const gc = colors[gIdx % colors.length];
              return (
                <div key={goal.id} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{ background: gc.bg, borderBottom: `1px solid ${gc.border}`, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: gc.title }}>{goal.title}</div>
                      {goal.description && (
                        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3 }}>{goal.description}</div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 2, flexShrink: 0, marginRight: 8 }}>
                      <button onClick={() => setEditGoal(goal)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, padding: '2px 4px', lineHeight: 1 }} title="ערוך יעד">✏️</button>
                      <button onClick={() => { setAddTaskGoalId(goal.id); setAddTaskOpen(true); }} style={{ background: 'none', border: 'none', color: '#1d4ed8', fontSize: 12, cursor: 'pointer', padding: '2px 6px', fontWeight: 600 }}>+ משימה</button>
                      <button onClick={() => handleDeleteGoal(goal.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fca5a5', fontSize: 16, padding: '2px 4px', lineHeight: 1 }} title="מחק יעד">✕</button>
                    </div>
                  </div>
                  <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {goal.tasks.map((t) => {
                      const activeAssignment = t.assignments.find(a => weekDateSet.has(a.scheduledDate)) ?? null;
                      return (
                      <div key={t.id} data-task-id={t.id} style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '8px 10px', background: '#f9fafb', borderRadius: 8,
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, color: '#374151' }}>{t.title}</div>
                          {t.notes && <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{t.notes}</div>}
                        </div>
                        <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                          <button
                            onClick={() => setEditTask(t)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: '2px 3px', lineHeight: 1 }}
                            title="ערוך משימה"
                          >✏️</button>
                          <button
                            onClick={() => setScheduleTarget({ task: t, activeAssignment })}
                            style={{ background: 'none', border: '1px solid #bfdbfe', borderRadius: 6, cursor: 'pointer', color: '#1d4ed8', fontSize: 11, padding: '3px 8px', fontWeight: 600 }}
                          >{activeAssignment ? '📅 העבר יום' : '📅 שבץ'}</button>
                          <button
                            onClick={() => handleDeleteTask(t.id)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fca5a5', fontSize: 16, padding: '2px 3px', lineHeight: 1 }}
                            title="מחק משימה"
                          >✕</button>
                        </div>
                      </div>
                    );})}
                    {goal.tasks.length === 0 && (
                      <div style={{ fontSize: 12, color: '#d1d5db', padding: '4px 8px' }}>אין משימות עדיין</div>
                    )}
                    <button
                      onClick={() => { setAddTaskGoalId(goal.id); setAddTaskOpen(true); }}
                      style={{ background: 'none', border: 'none', color: '#1d4ed8', fontSize: 12, cursor: 'pointer', textAlign: 'right' as const, padding: '4px 8px' }}
                    >+ הוסף משימה</button>
                  </div>
                </div>
              );
            })}

            {/* Ungrouped */}
            {plan.ungroupedTasks.length > 0 && (
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ background: '#f9fafb', borderBottom: '1px solid #f3f4f6', padding: '10px 14px' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#6b7280' }}>משימות ללא יעד</div>
                </div>
                <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {plan.ungroupedTasks.map((t) => {
                    const activeAssignment = t.assignments.find(a => weekDateSet.has(a.scheduledDate)) ?? null;
                    return (
                    <div key={t.id} data-task-id={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', background: '#f9fafb', borderRadius: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: '#374151' }}>{t.title}</div>
                        {t.notes && <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{t.notes}</div>}
                      </div>
                      <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                        <button
                          onClick={() => setEditTask(t)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: '2px 3px', lineHeight: 1 }}
                          title="ערוך משימה"
                        >✏️</button>
                        <button
                          onClick={() => setScheduleTarget({ task: t, activeAssignment })}
                          style={{ background: 'none', border: '1px solid #bfdbfe', borderRadius: 6, cursor: 'pointer', color: '#1d4ed8', fontSize: 11, padding: '3px 8px', fontWeight: 600 }}
                        >{activeAssignment ? '📅 העבר יום' : '📅 שבץ'}</button>
                        <button
                          onClick={() => handleDeleteTask(t.id)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fca5a5', fontSize: 16, padding: '2px 3px', lineHeight: 1 }}
                          title="מחק משימה"
                        >✕</button>
                      </div>
                    </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Add buttons */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setAddGoalOpen(true)} style={{
                flex: 1, background: '#f9fafb', border: '1.5px dashed #d1d5db', borderRadius: 10,
                padding: '10px', fontSize: 13, color: '#6b7280', cursor: 'pointer',
              }}>+ יעד חדש</button>
              <button onClick={() => { setAddTaskGoalId(undefined); setAddTaskOpen(true); }} style={{
                flex: 1, background: '#f9fafb', border: '1.5px dashed #d1d5db', borderRadius: 10,
                padding: '10px', fontSize: 13, color: '#6b7280', cursor: 'pointer',
              }}>+ משימה חדשה</button>
            </div>
          </div>
        </div>
      )}

      {/* Chat panel */}
      <div style={{ padding: '0 16px', marginBottom: 16 }}>
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
            {/* Messages */}
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
                    const isToday = msgDate.toDateString() === new Date().toDateString();
                    const timeStr = msgDate.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
                    const dateStr = isToday ? timeStr : msgDate.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' }) + ' ' + timeStr;
                    return (
                      <div key={n.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start', gap: 2 }}>
                        {/* Sender label — only on incoming (coach) messages */}
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
            {/* Input */}
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

      {/* ─── Modals ──────────────────────────────────────────────────────────── */}

      {/* Confirm delete */}
      {confirmState && (
        <ConfirmModal
          title={
            confirmState.type === 'goal' ? 'מחיקת יעד' :
            confirmState.type === 'task' ? 'מחיקת משימה' :
            'הסרת שיבוץ'
          }
          description={
            confirmState.type === 'goal' ? 'האם את בטוחה שתרצי למחוק את היעד הזה?' :
            confirmState.type === 'task' ? 'האם את בטוחה שתרצי למחוק את המשימה?' :
            'האם להסיר את המשימה מהיום הזה?'
          }
          confirmText={confirmState.type === 'assignment' ? 'הסר' : 'מחק'}
          onConfirm={executeConfirmedDelete}
          onCancel={() => setConfirmState(null)}
        />
      )}

      {/* Add Goal */}
      {addGoalOpen && plan && (
        <AddGoalModal
          planId={plan.plan.id}
          onClose={() => setAddGoalOpen(false)}
          onDone={() => { setAddGoalOpen(false); loadPlan(); }}
        />
      )}

      {/* Edit Goal */}
      {editGoal && (
        <EditGoalModal
          goal={editGoal}
          onClose={() => setEditGoal(null)}
          onDone={() => { setEditGoal(null); loadPlan(); }}
        />
      )}

      {/* Add Task */}
      {addTaskOpen && plan && (
        <AddTaskModal
          planId={plan.plan.id}
          participantId={ctx.participantId}
          goals={plan.goals}
          defaultGoalId={addTaskGoalId}
          onClose={() => setAddTaskOpen(false)}
          onDone={() => { setAddTaskOpen(false); loadPlan(); }}
        />
      )}

      {/* Edit Task */}
      {editTask && plan && (
        <EditTaskModal
          task={editTask}
          goals={plan.goals}
          onClose={() => setEditTask(null)}
          onDone={() => { setEditTask(null); loadPlan(); }}
        />
      )}

      {/* Schedule / Move */}
      {scheduleTarget && (
        <ScheduleModal
          task={scheduleTarget.task}
          activeAssignment={scheduleTarget.activeAssignment}
          days={days}
          today={today}
          onClose={() => setScheduleTarget(null)}
          onDone={() => { setScheduleTarget(null); loadPlan(); }}
        />
      )}
    </div>
    </div>
  );
}

// ─── Confirm Modal ────────────────────────────────────────────────────────────
// No ✕ button, no outside-click dismiss — closes ONLY via buttons.

function ConfirmModal({
  title,
  description,
  confirmText = 'מחק',
  cancelText = 'ביטול',
  onConfirm,
  onCancel,
}: {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 300,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
      // No onClick on backdrop — intentionally does NOT close on outside click
    >
      <div style={{
        background: '#fff', borderRadius: '16px 16px 0 0', width: '100%',
        maxWidth: 480, padding: '24px 20px 36px',
      }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#111827', marginBottom: description ? 8 : 20 }}>
          {title}
        </div>
        {description && (
          <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 20, lineHeight: 1.5 }}>
            {description}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1, padding: '12px', borderRadius: 10,
              background: '#f3f4f6', color: '#374151',
              border: '1px solid #e5e7eb', fontSize: 15, fontWeight: 600, cursor: 'pointer',
            }}
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            style={{
              flex: 1, padding: '12px', borderRadius: 10,
              background: '#dc2626', color: '#fff',
              border: 'none', fontSize: 15, fontWeight: 700, cursor: 'pointer',
            }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
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
    } catch { setErr('שגיאה, נסי שוב'); }
    finally { setSaving(false); }
  }

  return (
    <Modal title="יעד חדש" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="שם היעד *" style={inp} autoFocus />
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="תיאור (אופציונלי)" style={{ ...inp, minHeight: 70, resize: 'vertical' as const }} />
        {err && <div style={{ color: '#ef4444', fontSize: 13 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{ ...btnS, flex: 1 }}>ביטול</button>
          <button onClick={handleSave} disabled={saving || !title.trim()} style={{ ...btnP, flex: 1, opacity: saving || !title.trim() ? 0.6 : 1 }}>{saving ? '...' : 'שמור'}</button>
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
        method: 'POST',
        body: JSON.stringify({ title: title.trim(), goalId: goalId || undefined, notes: notes.trim() || undefined }),
      });
      onDone();
    } catch { setErr('שגיאה, נסי שוב'); }
    finally { setSaving(false); }
  }

  return (
    <Modal title="משימה חדשה" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="שם המשימה *" style={inp} autoFocus />
        <select value={goalId} onChange={(e) => setGoalId(e.target.value)} style={{ ...inp, appearance: 'auto' as const }}>
          <option value="">— ללא יעד —</option>
          {goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
        </select>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="הערות (אופציונלי)" style={{ ...inp, minHeight: 60, resize: 'vertical' as const }} />
        {err && <div style={{ color: '#ef4444', fontSize: 13 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{ ...btnS, flex: 1 }}>ביטול</button>
          <button onClick={handleSave} disabled={saving || !title.trim()} style={{ ...btnP, flex: 1, opacity: saving || !title.trim() ? 0.6 : 1 }}>{saving ? '...' : 'שמור'}</button>
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
    <Modal title="ערוך יעד" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="שם היעד *" style={inp} autoFocus />
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="תיאור (אופציונלי)" style={{ ...inp, minHeight: 70, resize: 'vertical' as const }} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{ ...btnS, flex: 1 }}>ביטול</button>
          <button onClick={handleSave} disabled={saving || !title.trim()} style={{ ...btnP, flex: 1, opacity: saving || !title.trim() ? 0.6 : 1 }}>{saving ? '...' : 'שמור'}</button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Edit Task Modal ───────────────────────────────────────────────────────────

function EditTaskModal({ task, goals, onClose, onDone }: { task: TaskShape; goals: GoalShape[]; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState(task.title);
  const [goalId, setGoalId] = useState(task.goalId ?? '');
  const [notes, setNotes] = useState(task.notes ?? '');
  const [startTime, setStartTime] = useState(task.startTime ?? '');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await apiFetch(`${BASE_URL}/task-engine/tasks/${task.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: title.trim(),
          goalId: goalId || null,
          notes: notes.trim() || null,
          startTime: startTime || null,
        }),
      });
      onDone();
    } finally { setSaving(false); }
  }

  return (
    <Modal title="ערוך משימה" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="שם המשימה *" style={inp} autoFocus />
        <select value={goalId} onChange={(e) => setGoalId(e.target.value)} style={{ ...inp, appearance: 'auto' as const }}>
          <option value="">— ללא יעד —</option>
          {goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
        </select>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="הערות (אופציונלי)" style={{ ...inp, minHeight: 60, resize: 'vertical' as const }} />
        <div>
          <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 4 }}>שעה (אופציונלי)</div>
          <input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            style={{ ...inp, direction: 'ltr' }}
          />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{ ...btnS, flex: 1 }}>ביטול</button>
          <button onClick={handleSave} disabled={saving || !title.trim()} style={{ ...btnP, flex: 1, opacity: saving || !title.trim() ? 0.6 : 1 }}>{saving ? '...' : 'שמור'}</button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Schedule Modal ───────────────────────────────────────────────────────────
// Shared modal for both "שבץ" (new assignment) and "העבר יום" (move existing).
// No outside-click dismiss — uses Modal's ✕ button only.

function ScheduleModal({ task, activeAssignment, days, today, onClose, onDone }: {
  task: TaskShape; activeAssignment: AssignmentShape | null; days: Date[]; today: string;
  onClose: () => void; onDone: () => void;
}) {
  async function handleSelect(dateStr: string) {
    if (!activeAssignment) {
      await apiFetch(`${BASE_URL}/task-engine/tasks/${task.id}/assign`, {
        method: 'POST',
        body: JSON.stringify({ scheduledDate: dateStr }),
      }).catch(() => {});
    } else {
      await apiFetch(`${BASE_URL}/task-engine/assignments/${activeAssignment.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ scheduledDate: dateStr }),
      }).catch(() => {});
    }
    onDone();
  }

  return (
    <Modal title={!activeAssignment ? 'שיבוץ משימה' : 'העברת משימה ליום אחר'} onClose={onClose}>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 14 }}>{task.title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {days.map((d) => {
          const str = toDateStr(d);
          const dayIdx = d.getDay();
          const isToday = str === today;
          return (
            <button key={str} onClick={() => handleSelect(str)} style={{
              ...btnS, textAlign: 'right' as const, fontSize: 14,
              background: isToday ? '#eff6ff' : '#f9fafb',
              borderColor: isToday ? '#bfdbfe' : '#e5e7eb',
            }}>
              {DAYS_HE[dayIdx]} {formatShort(str)}{isToday ? ' (היום)' : ''}
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
