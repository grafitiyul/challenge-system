'use client';

/**
 * PlanTab — participant task planner inside the personal portal.
 * Loaded lazily when the participant opens the "תוכנית" tab.
 * Full edit access: participant can add/edit/delete goals and tasks, check off assignments.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { BASE_URL, apiFetch } from '@lib/api';
import { TaskPoolRow, DayTaskCard, GoalSection } from '@components/task-engine-ui';

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

  const selectedItems = plan ? getAssignmentsForDay(plan, selectedDay) : [];
  const weekLabel = `${formatShort(toDateStr(currentSunday))} — ${formatShort(toDateStr(addDays(currentSunday, 6)))}`;

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ ...rootStyle, paddingBottom: 32 }}>

      {/* ── Participant header ─────────────────────────────────────────────── */}
      <div style={{
        background: 'linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%)',
        padding: '16px 16px 18px',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{
          width: 46, height: 46, borderRadius: '50%',
          background: 'rgba(255,255,255,0.22)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20, fontWeight: 700, color: '#fff', flexShrink: 0,
          border: '2px solid rgba(255,255,255,0.35)',
        }}>
          {ctx.participantFirstName.charAt(0)}
        </div>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#fff', lineHeight: 1.2 }}>
            {ctx.participantName}
          </div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 3 }}>תכנון שבועי</div>
        </div>
      </div>

      {/* ── Week navigation ────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: '#fff', borderBottom: '1px solid #f3f4f6', padding: '10px 12px',
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <button onClick={() => setCurrentSunday(addDays(currentSunday, -7))} style={{
          background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 7,
          cursor: 'pointer', fontSize: 12, color: '#374151', padding: '5px 10px', fontWeight: 600,
        }}>קודם ›</button>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 13, fontWeight: 600, color: '#374151' }}>{weekLabel}</div>
        <button onClick={() => { setCurrentSunday(weekSunday(new Date())); setSelectedDay(today); }} style={{
          fontSize: 11, color: '#1d4ed8', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 6,
          padding: '4px 8px', cursor: 'pointer',
        }}>השבוע</button>
        <button onClick={() => setCurrentSunday(addDays(currentSunday, 7))} style={{
          background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 7,
          cursor: 'pointer', fontSize: 12, color: '#374151', padding: '5px 10px', fontWeight: 600,
        }}>‹ הבא</button>
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
            {selectedItems.map(({ task, assignment, goalTitle }) => (
              <DayTaskCard
                key={assignment.id}
                task={task}
                assignment={assignment}
                goalTitle={goalTitle}
                onToggleComplete={() => toggleComplete(assignment)}
                onRemove={() => handleRemoveAssignment(assignment.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Daily summary ─────────────────────────────────────────────────── */}
      {plan && (() => {
        const dayItems = selectedItems.filter(i => i.assignment.status !== 'carried_forward');
        const total = dayItems.length;
        if (total === 0) return null;
        const done = dayItems.filter(i => i.assignment.isCompleted).length;
        const pct = Math.round((done / total) * 100);
        return (
          <div style={{ margin: '0 16px 8px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '10px 14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>סיכום יומי</span>
              <span style={{ fontSize: 12, color: pct === 100 ? '#15803d' : '#6b7280', fontWeight: 600 }}>
                {done}/{total} {pct === 100 ? '✅ הכול הושלם!' : `(${pct}%)`}
              </span>
            </div>
            <div style={{ height: 6, background: '#f3f4f6', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? '#22c55e' : '#1d4ed8', borderRadius: 3, transition: 'width 0.3s' }} />
            </div>
          </div>
        );
      })()}

      {/* Goals + task pool */}
      {plan && (
        <div style={{ padding: '0 16px 16px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', marginBottom: 10, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
            יעדים ומשימות השבוע
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

            {/* Goal sections */}
            {plan.goals.map((goal, gIdx) => (
              <GoalSection
                key={goal.id}
                goal={goal}
                goalIndex={gIdx}
                onEditGoal={() => setEditGoal(goal)}
                onDeleteGoal={() => handleDeleteGoal(goal.id)}
                onAddTask={() => { setAddTaskGoalId(goal.id); setAddTaskOpen(true); }}
                renderTask={(t) => {
                  const activeAssignment = t.assignments.find(a => weekDateSet.has(a.scheduledDate)) ?? null;
                  return (
                    <TaskPoolRow
                      key={t.id}
                      task={t}
                      isAssigned={activeAssignment !== null}
                      onEdit={() => setEditTask(t)}
                      onSchedule={() => setScheduleTarget({ task: t, activeAssignment })}
                      onDelete={() => handleDeleteTask(t.id)}
                    />
                  );
                }}
              />
            ))}

            {/* Ungrouped tasks */}
            {plan.ungroupedTasks.length > 0 && (
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ background: '#f9fafb', borderBottom: '1px solid #f3f4f6', padding: '10px 14px' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#6b7280' }}>משימות ללא יעד</div>
                </div>
                <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {plan.ungroupedTasks.map((t) => {
                    const activeAssignment = t.assignments.find(a => weekDateSet.has(a.scheduledDate)) ?? null;
                    return (
                      <TaskPoolRow
                        key={t.id}
                        task={t}
                        isAssigned={activeAssignment !== null}
                        onEdit={() => setEditTask(t)}
                        onSchedule={() => setScheduleTarget({ task: t, activeAssignment })}
                        onDelete={() => handleDeleteTask(t.id)}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {/* Weekly summary */}
            {(() => {
              const allItems = days.flatMap(d => getAssignmentsForDay(plan, toDateStr(d))).filter(i => i.assignment.status !== 'carried_forward');
              const weekTotal = allItems.length;
              if (weekTotal === 0) return null;
              const weekDone = allItems.filter(i => i.assignment.isCompleted).length;
              const weekPct = Math.round((weekDone / weekTotal) * 100);
              return (
                <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '10px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>סיכום שבועי</span>
                    <span style={{ fontSize: 12, color: weekPct === 100 ? '#15803d' : '#6b7280', fontWeight: 600 }}>
                      {weekDone}/{weekTotal} {weekPct === 100 ? '✅' : `(${weekPct}%)`}
                    </span>
                  </div>
                  <div style={{ height: 6, background: '#f3f4f6', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${weekPct}%`, background: weekPct === 100 ? '#22c55e' : '#1d4ed8', borderRadius: 3, transition: 'width 0.3s' }} />
                  </div>
                </div>
              );
            })()}

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
