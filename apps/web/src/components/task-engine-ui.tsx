'use client';

/**
 * task-engine-ui.tsx — Shared structural components for the task engine UI.
 *
 * Used by:
 *   - apps/web/src/app/t/[token]/plan-tab.tsx   (participant portal)
 *   - apps/web/src/app/tasks/portal/[id]/page.tsx (admin portal)
 *
 * These components contain ONLY visual structure and layout.
 * All business logic, API calls, and modal state remain in the parent files.
 * Behavioral differences (viewOnly, modal type, delete confirmation) are
 * controlled via props, not via internal branching.
 */

import React from 'react';

// ─── Minimal shared types ─────────────────────────────────────────────────────
// TypeScript structural typing: local TaskShape/GoalShape in parent files are
// compatible as long as they include at least these fields.

export interface SharedAssignment {
  id: string;
  scheduledDate: string;
  startTime: string | null;
  isCompleted: boolean;
  status: string;
  // Phase 2 audit-only: which surface authored today's completion. Used to
  // decide whether to render the "סומן במעקב" subtitle on the task row.
  completedVia?: 'direct' | 'task' | null;
}

export interface SharedTask {
  id: string;
  title: string;
  notes: string | null;
  sortOrder: number;
  isAbandoned: boolean;
  goalId: string | null;
  assignments: SharedAssignment[];
  // Phase 2: populated when a ProjectItem has this task's id in
  // linkedPlanTaskId. Drives the "🎯 חלק ממעקב" badge.
  linkedProjectItem?: { id: string; projectId: string; projectTitle: string } | null;
}

export interface SharedGoal {
  id: string;
  title: string;
  description: string | null;
  sortOrder: number;
  isAbandoned: boolean;
  tasks: SharedTask[];
}

// ─── Goal color palette ───────────────────────────────────────────────────────

const GOAL_COLORS = [
  { bg: '#eff6ff', border: '#bfdbfe', title: '#1d4ed8' },
  { bg: '#f0fdf4', border: '#86efac', title: '#15803d' },
  { bg: '#fdf4ff', border: '#e9d5ff', title: '#7e22ce' },
  { bg: '#fff7ed', border: '#fed7aa', title: '#c2410c' },
] as const;

// ─── TaskPoolRow ──────────────────────────────────────────────────────────────
/**
 * A task row inside the goal pool or ungrouped pool.
 *
 * Replaces four previously duplicated JSX blocks:
 *   - participant portal: goal-grouped task (plan-tab.tsx)
 *   - participant portal: ungrouped task (plan-tab.tsx)
 *   - admin portal: goal-grouped task (portal/[id]/page.tsx)
 *   - admin portal: ungrouped task (portal/[id]/page.tsx)
 *
 * Props:
 *   isAssigned  — true → "📅 העבר יום", false → "📅 שבץ"
 *   viewOnly    — hides all action buttons (admin view mode)
 *   compact     — smaller padding/fontSize for admin sidebar context
 */

export interface TaskPoolRowProps {
  task: SharedTask;
  isAssigned: boolean;
  onEdit: () => void;
  onSchedule: () => void;
  onDelete: () => void;
  // Phase 6.16: optional duplicate callback. When provided, a copy button
  // appears alongside edit/delete. Undefined hides the button (keeps older
  // call sites working without change).
  onDuplicate?: () => void;
  viewOnly?: boolean;
  compact?: boolean;
}

export function TaskPoolRow({
  task,
  isAssigned,
  onEdit,
  onSchedule,
  onDelete,
  onDuplicate,
  viewOnly = false,
  compact = false,
}: TaskPoolRowProps) {
  return (
    <div
      data-task-id={task.id}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: compact ? 4 : 6,
        padding: compact ? '5px 8px' : '8px 10px',
        background: compact ? '#f8fafc' : '#f9fafb',
        borderRadius: compact ? 6 : 8,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: compact ? 12 : 13,
          color: '#374151',
          wordBreak: 'normal',
          overflowWrap: 'break-word',
        }}>
          {task.title}
          {task.linkedProjectItem && (
            <span
              title={`חלק מהמעקב: ${task.linkedProjectItem.projectTitle}`}
              style={{
                marginInlineStart: 6,
                display: 'inline-flex', alignItems: 'center',
                padding: '1px 6px', borderRadius: 999,
                fontSize: 10, fontWeight: 600,
                background: '#eff6ff', color: '#2563eb',
                verticalAlign: 'middle',
              }}
            >🎯 חלק ממעקב</span>
          )}
        </div>
        {task.notes && (
          <div style={{
            fontSize: 11,
            color: compact ? '#94a3b8' : '#9ca3af',
            marginTop: compact ? 1 : 2,
            wordBreak: 'normal',
            overflowWrap: 'break-word',
          }}>
            {task.notes}
          </div>
        )}
      </div>
      {!viewOnly && (
        <div style={{ display: 'flex', gap: compact ? 2 : 3, flexShrink: 0 }}>
          <button
            onClick={onEdit}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: compact ? 11 : 13,
              padding: '2px 3px',
              lineHeight: 1,
            }}
            title="ערוך משימה"
          >✏️</button>
          <button
            onClick={onSchedule}
            style={{
              background: 'none',
              border: `1px solid ${compact ? '#e2e8f0' : '#bfdbfe'}`,
              borderRadius: compact ? 5 : 6,
              cursor: 'pointer',
              color: '#1d4ed8',
              fontSize: 11,
              padding: compact ? '1px 6px' : '3px 8px',
              fontWeight: 600,
            }}
          >
            {isAssigned ? '📅 העבר יום' : '📅 שבץ'}
          </button>
          {onDuplicate && (
            <button
              onClick={onDuplicate}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: compact ? 11 : 13,
                padding: '2px 3px',
                lineHeight: 1,
              }}
              title="שכפל משימה"
            >📋</button>
          )}
          <button
            onClick={onDelete}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#fca5a5',
              fontSize: compact ? 11 : 14,
              padding: '2px 3px',
              lineHeight: 1,
            }}
            title="מחק משימה"
          >🗑️</button>
        </div>
      )}
    </div>
  );
}

// ─── DayTaskCard ──────────────────────────────────────────────────────────────
/**
 * A task card rendered inside the selected day's task list.
 *
 * Replaces two previously duplicated JSX blocks:
 *   - participant portal day-view (plan-tab.tsx)
 *   - admin portal day-view (portal/[id]/page.tsx)
 *
 * Props:
 *   viewOnly — disables checkbox and hides remove button (admin view mode)
 */

export interface DayTaskCardProps {
  task: {
    id: string;
    title: string;
    notes: string | null;
    linkedProjectItem?: { id: string; projectId: string; projectTitle: string } | null;
  };
  assignment: SharedAssignment;
  goalTitle: string | null;
  onToggleComplete: () => void;
  onRemove: () => void;
  viewOnly?: boolean;
}

export function DayTaskCard({
  task,
  assignment,
  goalTitle,
  onToggleComplete,
  onRemove,
  viewOnly = false,
}: DayTaskCardProps) {
  const isCarried = assignment.status === 'carried_forward';
  return (
    <div style={{
      background: isCarried ? '#fffbeb' : assignment.isCompleted ? '#f0fdf4' : '#fff',
      border: `1px solid ${isCarried ? '#fde68a' : assignment.isCompleted ? '#86efac' : '#e5e7eb'}`,
      borderLeft: `3px solid ${isCarried ? '#f59e0b' : assignment.isCompleted ? '#22c55e' : '#d1d5db'}`,
      borderRadius: 10,
      padding: '12px 14px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        {!isCarried && (
          <input
            type="checkbox"
            checked={assignment.isCompleted}
            onChange={onToggleComplete}
            disabled={viewOnly}
            style={{
              marginTop: 2,
              width: 18,
              height: 18,
              cursor: viewOnly ? 'not-allowed' : 'pointer',
              accentColor: '#1d4ed8',
              flexShrink: 0,
            }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 15,
            fontWeight: 500,
            color: assignment.isCompleted ? '#9ca3af' : '#111827',
            textDecoration: assignment.isCompleted ? 'line-through' : 'none',
            wordBreak: 'normal',
            overflowWrap: 'break-word',
          }}>
            {task.title}
            {task.linkedProjectItem && (
              <span
                title={`חלק מהמעקב: ${task.linkedProjectItem.projectTitle}`}
                style={{
                  marginInlineStart: 6,
                  display: 'inline-flex', alignItems: 'center',
                  padding: '1px 6px', borderRadius: 999,
                  fontSize: 10, fontWeight: 600,
                  background: '#eff6ff', color: '#2563eb',
                  verticalAlign: 'middle',
                }}
              >🎯 חלק ממעקב</span>
            )}
          </div>
          {goalTitle && (
            <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>{goalTitle}</div>
          )}
          {assignment.isCompleted && assignment.completedVia === 'direct' && (
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>סומן במעקב</div>
          )}
          {task.notes && !assignment.isCompleted && (
            <div style={{
              fontSize: 12,
              color: '#6b7280',
              marginTop: 4,
              fontStyle: 'italic',
              wordBreak: 'normal',
              overflowWrap: 'break-word',
            }}>
              {task.notes}
            </div>
          )}
          {isCarried && (
            <div style={{ fontSize: 11, color: '#d97706', marginTop: 2 }}>הועבר</div>
          )}
          {assignment.startTime && !isCarried && (
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{assignment.startTime}</div>
          )}
        </div>
        {!isCarried && !assignment.isCompleted && !viewOnly && (
          <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
            <button
              onClick={onRemove}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: '#fca5a5',
                padding: '2px 4px',
                fontSize: 14,
              }}
              title="הסר מהיום"
            >🗑️</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── GoalSection ──────────────────────────────────────────────────────────────
/**
 * A goal card: header with title/description/actions + task list below.
 *
 * Replaces two previously duplicated JSX blocks:
 *   - participant portal goal section (plan-tab.tsx)
 *   - admin portal goal section (portal/[id]/page.tsx)
 *
 * renderTask is a render prop — caller injects the appropriate task row
 * (TaskPoolRow with its own callbacks and context).
 *
 * Props:
 *   showInlineAddTask  — shows "+ הוסף משימה" link at bottom of task list.
 *                        true for participant (default), false for admin.
 *   viewOnly           — hides all action buttons.
 */

export interface GoalSectionProps {
  goal: SharedGoal;
  goalIndex: number;
  onEditGoal: () => void;
  onDeleteGoal: () => void;
  // Phase 6.16: optional duplicate handler. Shown only when provided —
  // when omitted (e.g. admin view mode), the button is hidden.
  onDuplicateGoal?: () => void;
  onAddTask: () => void;
  renderTask: (task: SharedTask) => React.ReactNode;
  viewOnly?: boolean;
  showInlineAddTask?: boolean;
}

export function GoalSection({
  goal,
  goalIndex,
  onEditGoal,
  onDeleteGoal,
  onDuplicateGoal,
  onAddTask,
  renderTask,
  viewOnly = false,
  showInlineAddTask = true,
}: GoalSectionProps) {
  const gc = GOAL_COLORS[goalIndex % GOAL_COLORS.length];
  return (
    <div style={{
      background: '#fff',
      border: '1px solid #e5e7eb',
      borderRadius: 10,
      overflow: 'hidden',
    }}>
      {/* Goal header */}
      <div style={{
        background: gc.bg,
        borderBottom: `1px solid ${gc.border}`,
        padding: '10px 14px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 14,
            fontWeight: 700,
            color: gc.title,
            wordBreak: 'normal',
            overflowWrap: 'break-word',
          }}>
            {goal.title}
          </div>
          {goal.description && (
            <div style={{
              fontSize: 12,
              color: '#6b7280',
              marginTop: 3,
              wordBreak: 'normal',
              overflowWrap: 'break-word',
            }}>
              {goal.description}
            </div>
          )}
        </div>
        {!viewOnly && (
          <div style={{ display: 'flex', gap: 2, flexShrink: 0, marginRight: 8 }}>
            <button
              onClick={onEditGoal}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 14, padding: '2px 4px', lineHeight: 1,
              }}
              title="ערוך יעד"
            >✏️</button>
            <button
              onClick={onAddTask}
              style={{
                background: 'none', border: 'none', color: '#1d4ed8',
                fontSize: 12, cursor: 'pointer', padding: '2px 6px', fontWeight: 600,
              }}
            >+ משימה</button>
            {onDuplicateGoal && (
              <button
                onClick={onDuplicateGoal}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 14, padding: '2px 4px', lineHeight: 1,
                }}
                title="שכפל יעד לשבוע הבא"
              >📋</button>
            )}
            <button
              onClick={onDeleteGoal}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: '#fca5a5', fontSize: 16, padding: '2px 4px', lineHeight: 1,
              }}
              title="מחק יעד"
            >✕</button>
          </div>
        )}
      </div>

      {/* Task list */}
      <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {goal.tasks.map(t => renderTask(t))}
        {goal.tasks.length === 0 && (
          <div style={{ fontSize: 12, color: '#d1d5db', padding: '4px 8px' }}>
            אין משימות עדיין
          </div>
        )}
        {!viewOnly && showInlineAddTask && (
          <button
            onClick={onAddTask}
            style={{
              background: 'none', border: 'none', color: '#1d4ed8',
              fontSize: 12, cursor: 'pointer',
              textAlign: 'right' as const, padding: '4px 8px',
            }}
          >+ הוסף משימה</button>
        )}
      </div>
    </div>
  );
}
