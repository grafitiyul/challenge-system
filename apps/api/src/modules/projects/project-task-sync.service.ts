import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

// ─── ProjectTaskSyncService ──────────────────────────────────────────────────
//
// Single source of truth for the Phase 2 bidirectional link between a boolean
// Project goal (ProjectItem) and a PlanTask. Every cross-surface mirror write
// flows through one of this service's methods; no other code in the codebase
// reaches across the boundary.
//
// INVARIANT (the reason this service exists):
//   For any ProjectItem P with linkedPlanTaskId=T, for any date D, for any
//   active TaskAssignment A of T on D:
//
//       logFor(P,D).status === 'completed'  ⟺  A.isCompleted === true
//
// The four public methods preserve this invariant by construction. No sync
// method calls the other sync method (directly or indirectly), so mirror
// loops are impossible.
//
// Design rule: syncSource on ProjectItemLog is AUDIT-ONLY. No branch in this
// service reads it. Correctness derives solely from canonical state (log.status
// and assignment.isCompleted) plus the deterministic rules in the completion
// invariant.

// Parse a "YYYY-MM-DD" string into a midnight-UTC Date (matches ProjectItemLog
// storage and aligns with TaskAssignment.scheduledDate which is midnight UTC
// of the target day throughout the codebase).
function parseDayString(s: string): Date {
  const [y, m, d] = s.split('-').map((n) => parseInt(n, 10));
  return new Date(Date.UTC(y, m - 1, d));
}

function sameDay(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear()
    && a.getUTCMonth() === b.getUTCMonth()
    && a.getUTCDate() === b.getUTCDate();
}

@Injectable()
export class ProjectTaskSyncService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Mirror: task-side completion → project-side log ─────────────────────
  //
  // Called from TaskEngineService.updateAssignment whenever isCompleted is
  // toggled. If `completed=true`, upsert a ProjectItemLog with
  // syncSource='task'. If `completed=false`, delete the matching log
  // unconditionally (syncSource is NOT a branch).
  //
  // Silent no-op when the task has no linked goal, or the linked item is
  // archived, or the project is cancelled — mirroring into an inactive
  // surface would produce orphan state.
  async syncFromTask(
    taskId: string,
    scheduledDate: Date,
    completed: boolean,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const db = tx ?? this.prisma;
    const item = await db.projectItem.findUnique({
      where: { linkedPlanTaskId: taskId },
      select: {
        id: true,
        isArchived: true,
        itemType: true,
        project: { select: { participantId: true, status: true } },
      },
    });
    if (!item) return;
    if (item.itemType !== 'boolean') return;
    if (item.isArchived) return;
    if (item.project.status === 'cancelled') return;

    const logDate = new Date(Date.UTC(
      scheduledDate.getUTCFullYear(),
      scheduledDate.getUTCMonth(),
      scheduledDate.getUTCDate(),
    ));

    if (completed) {
      await db.projectItemLog.upsert({
        where: { itemId_logDate: { itemId: item.id, logDate } },
        create: {
          itemId: item.id,
          participantId: item.project.participantId,
          logDate,
          status: 'completed',
          numericValue: null,
          selectValue: null,
          skipNote: null,
          commitNote: null,
          editedByRole: 'system',
          syncSource: 'task',
        },
        update: {
          status: 'completed',
          numericValue: null,
          selectValue: null,
          skipNote: null,
          commitNote: null,
          editedAt: new Date(),
          editedByRole: 'system',
          syncSource: 'task',
        },
      });
    } else {
      // Un-completion on the task side clears the log unconditionally so the
      // invariant `goal.completed ⟺ task.completed` holds.
      await db.projectItemLog.deleteMany({
        where: { itemId: item.id, logDate },
      });
    }
  }

  // ── Mirror: project-side log change → task-side assignment ──────────────
  //
  // Called from ProjectsService.upsertLog / deleteLog whenever the effective
  // completion state for (itemId, logDate) changes. If the item isn't linked,
  // silent no-op.
  //
  // Deliberately does NOT auto-create an assignment when none exists for the
  // date. The absence of an assignment means the participant didn't schedule
  // the task for that day, and we render a "לא נקבע להיום בלו״ז" hint in the
  // UI rather than silently pushing work into the plan. If an assignment is
  // later created for that date, the hard rule in onAssignmentCreated below
  // ensures it is born in the correct state.
  async syncFromProject(
    itemId: string,
    logDate: Date,
    completed: boolean,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const db = tx ?? this.prisma;
    const item = await db.projectItem.findUnique({
      where: { id: itemId },
      select: { linkedPlanTaskId: true, itemType: true },
    });
    if (!item?.linkedPlanTaskId) return;
    if (item.itemType !== 'boolean') return;

    // Find the most recent ACTIVE assignment for (task, date). We exclude
    // carried_forward / abandoned so we don't retroactively flip history.
    const assignment = await db.taskAssignment.findFirst({
      where: {
        taskId: item.linkedPlanTaskId,
        scheduledDate: logDate,
        status: { in: ['scheduled', 'completed'] },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, isCompleted: true },
    });
    if (!assignment) return;

    if (completed && !assignment.isCompleted) {
      await db.taskAssignment.update({
        where: { id: assignment.id },
        data: {
          isCompleted: true,
          status: 'completed',
          completedAt: new Date(),
        },
      });
    } else if (!completed && assignment.isCompleted) {
      await db.taskAssignment.update({
        where: { id: assignment.id },
        data: {
          isCompleted: false,
          status: 'scheduled',
          completedAt: null,
        },
      });
    }
  }

  // ── Hard rule: adopt existing completed log on assignment creation ──────
  //
  // Must be called BEFORE creating a TaskAssignment (to seed the create
  // payload with the correct completion state) or immediately AFTER (to fix
  // up a freshly-created row). We expose it as a pure "what should this
  // assignment's completion state be on birth" helper — creators embed its
  // output directly into their Prisma.create() call, so the row is never
  // committed in an unreconciled state.
  //
  // §2 of the design: the assignment is born COMPLETED if a completed log
  // already exists for the linked goal on the same date. Otherwise born
  // SCHEDULED. This rule applies to every assignment creation path:
  //   - task-engine.assignTask
  //   - task-engine.carryForward
  //   - task-engine.materializeRecurrenceForWeek
  // (All three eventually call into this helper.)
  async computeInitialAssignmentState(
    taskId: string,
    scheduledDate: Date,
    tx?: Prisma.TransactionClient,
  ): Promise<{ isCompleted: boolean; status: string; completedAt: Date | null }> {
    const db = tx ?? this.prisma;
    const item = await db.projectItem.findUnique({
      where: { linkedPlanTaskId: taskId },
      select: { id: true, isArchived: true, itemType: true },
    });
    const notLinked = !item || item.isArchived || item.itemType !== 'boolean';
    if (notLinked) {
      return { isCompleted: false, status: 'scheduled', completedAt: null };
    }
    const normalized = new Date(Date.UTC(
      scheduledDate.getUTCFullYear(),
      scheduledDate.getUTCMonth(),
      scheduledDate.getUTCDate(),
    ));
    const existingLog = await db.projectItemLog.findUnique({
      where: { itemId_logDate: { itemId: item!.id, logDate: normalized } },
      select: { status: true },
    });
    if (existingLog?.status === 'completed') {
      return { isCompleted: true, status: 'completed', completedAt: new Date() };
    }
    return { isCompleted: false, status: 'scheduled', completedAt: null };
  }

  // Convenience wrapper for callers that want to trigger the rule after the
  // assignment was created without passing its ID through. Runs the same
  // lookup and updates the row if adoption applies. Idempotent.
  async onAssignmentCreated(assignmentId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    const a = await db.taskAssignment.findUnique({
      where: { id: assignmentId },
      select: { taskId: true, scheduledDate: true, isCompleted: true },
    });
    if (!a) return;
    if (a.isCompleted) return; // already correct
    const want = await this.computeInitialAssignmentState(a.taskId, a.scheduledDate, tx);
    if (want.isCompleted) {
      await db.taskAssignment.update({
        where: { id: assignmentId },
        data: {
          isCompleted: true,
          status: 'completed',
          completedAt: want.completedAt ?? new Date(),
        },
      });
    }
  }

  // ── Task deletion: clear link before the task row disappears ────────────
  //
  // Called from task-engine.deleteTask in the same transaction as the delete
  // (or immediately before, if a transaction isn't being used). Single UPDATE
  // on the goal row. Logs are NOT touched — historical completion data
  // survives the linked task's removal.
  async onTaskDeleted(taskId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    await db.projectItem.updateMany({
      where: { linkedPlanTaskId: taskId },
      data: { linkedPlanTaskId: null },
    });
  }

  // ── Helpers for link validation + picker lists ──────────────────────────

  // List of tasks the participant owns that can currently be linked to a new
  // or existing goal. Excludes tasks already linked to some other goal.
  // `exceptItemId` lets the edit flow keep the currently-linked task visible
  // as a valid option (so saving-unchanged doesn't spuriously fail).
  async listLinkableTasks(participantId: string, exceptItemId?: string) {
    const tasks = await this.prisma.planTask.findMany({
      where: { participantId, isAbandoned: false },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        linkedProjectItem: { select: { id: true } },
      },
    });
    return tasks
      .filter((t) => !t.linkedProjectItem || t.linkedProjectItem.id === exceptItemId)
      .map((t) => ({ id: t.id, title: t.title }));
  }

  // Lightweight helper used on the portal/admin read paths: which of the
  // given (itemId, date) pairs currently has an active linked-task
  // assignment? Returns a Set of "itemId|YYYY-MM-DD" keys for O(1) lookup
  // in the frontend or caller. Used to drive the "לא נקבע להיום בלו״ז" hint.
  async findActiveAssignmentPairs(args: {
    linkedTaskIds: string[];
    dates: Date[];
  }): Promise<Set<string>> {
    const { linkedTaskIds, dates } = args;
    if (linkedTaskIds.length === 0 || dates.length === 0) return new Set();
    const assignments = await this.prisma.taskAssignment.findMany({
      where: {
        taskId: { in: linkedTaskIds },
        scheduledDate: { in: dates },
        status: { in: ['scheduled', 'completed'] },
      },
      select: { taskId: true, scheduledDate: true },
    });
    // Translate taskId → itemId via a second query (keeps this helper simple
    // and avoids a JOIN-in-where).
    const links = await this.prisma.projectItem.findMany({
      where: { linkedPlanTaskId: { in: linkedTaskIds } },
      select: { id: true, linkedPlanTaskId: true },
    });
    const taskToItem = new Map<string, string>();
    for (const l of links) if (l.linkedPlanTaskId) taskToItem.set(l.linkedPlanTaskId, l.id);
    const out = new Set<string>();
    for (const a of assignments) {
      const itemId = taskToItem.get(a.taskId);
      if (!itemId) continue;
      const iso = this.toDayString(a.scheduledDate);
      out.add(`${itemId}|${iso}`);
    }
    return out;
  }

  private toDayString(d: Date): string {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }

  // Exposed for callers that want to validate a proposed link before
  // persisting it (goal-create / goal-update). Throws on:
  //   - task not owned by the participant
  //   - task already linked to another ProjectItem
  //   - item is non-boolean
  async assertLinkable(args: {
    participantId: string;
    taskId: string;
    exceptItemId?: string;
    itemType: string;
  }): Promise<void> {
    if (args.itemType !== 'boolean') {
      const err = new Error('ניתן לקשר רק מטרות מסוג "בוצע/לא"');
      (err as { status?: number }).status = 400;
      throw err;
    }
    const task = await this.prisma.planTask.findUnique({
      where: { id: args.taskId },
      select: {
        participantId: true,
        isAbandoned: true,
        linkedProjectItem: { select: { id: true } },
      },
    });
    if (!task || task.participantId !== args.participantId || task.isAbandoned) {
      const err = new Error('Task not available for linking');
      (err as { status?: number }).status = 400;
      throw err;
    }
    if (task.linkedProjectItem && task.linkedProjectItem.id !== args.exceptItemId) {
      const err = new Error('המשימה כבר מקושרת למטרה אחרת');
      (err as { status?: number }).status = 409;
      throw err;
    }
  }

  // Silence unused-import warnings for parseDayString/sameDay if a future
  // refactor drops them. Both helpers are exported-in-spirit, so keep them.
  // (noop referenced in non-production test paths)
  _unused() { void parseDayString; void sameDay; }
}
