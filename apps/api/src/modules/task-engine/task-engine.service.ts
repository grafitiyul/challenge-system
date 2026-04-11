import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateGoalDto,
  UpdateGoalDto,
  CreateTaskDto,
  UpdateTaskDto,
  AssignTaskDto,
  UpdateAssignmentDto,
  CarryForwardDto,
  UpdatePlanDto,
  ReorderItemDto,
  CreateNoteDto,
} from './dto/task-engine.dto';
import {
  buildDailySummaryMessage,
  buildWeeklySummaryMessage,
  DailySummaryData,
  WeeklySummaryData,
} from './task-engine.message-builder';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Normalise a calendar date (YYYY-MM-DD or Date) to midnight UTC DateTime */
function toMidnightUTC(date: string | Date): Date {
  const d = typeof date === 'string' ? new Date(date + 'T00:00:00.000Z') : new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Return the most recent Sunday on or before the given date (Israeli week start) */
function weekSundayUTC(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  const day = d.getUTCDay(); // 0 = Sun
  d.setUTCDate(d.getUTCDate() - day);
  return d;
}

/** Add N days to a UTC midnight date */
function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

/** Format a Date as "YYYY-MM-DD" */
function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

// ─── Full week response shape ─────────────────────────────────────────────────

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

export interface WeekPlanResponse {
  plan: { id: string; weekStart: string; status: string };
  goals: GoalShape[];
  ungroupedTasks: TaskShape[];
}

@Injectable()
export class TaskEngineService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Plan ──────────────────────────────────────────────────────────────────

  async getOrCreateWeekPlan(participantId: string, weekStartStr: string): Promise<WeekPlanResponse> {
    const weekStart = toMidnightUTC(weekStartStr);
    // Ensure weekStart is always a Sunday
    const sunday = weekSundayUTC(weekStart);

    let plan = await this.prisma.weeklyPlan.findUnique({
      where: { participantId_weekStart: { participantId, weekStart: sunday } },
    });
    if (!plan) {
      plan = await this.prisma.weeklyPlan.create({
        data: { participantId, weekStart: sunday },
      });
    }
    return this.buildWeekResponse(plan.id);
  }

  private async buildWeekResponse(planId: string): Promise<WeekPlanResponse> {
    const plan = await this.prisma.weeklyPlan.findUnique({
      where: { id: planId },
      include: {
        goals: {
          where: { isAbandoned: false },
          orderBy: { sortOrder: 'asc' },
          include: {
            tasks: {
              where: { isAbandoned: false },
              orderBy: { sortOrder: 'asc' },
              include: { assignments: { orderBy: { scheduledDate: 'asc' } } },
            },
          },
        },
        tasks: {
          where: { goalId: null, isAbandoned: false },
          orderBy: { sortOrder: 'asc' },
          include: { assignments: { orderBy: { scheduledDate: 'asc' } } },
        },
      },
    });
    if (!plan) throw new NotFoundException('Plan not found');

    const mapAssignment = (a: {
      id: string; scheduledDate: Date; startTime: string | null; endTime: string | null;
      isCompleted: boolean; completedAt: Date | null; status: string; carriedToId: string | null;
    }): AssignmentShape => ({
      id: a.id,
      scheduledDate: formatDate(a.scheduledDate),
      startTime: a.startTime,
      endTime: a.endTime,
      isCompleted: a.isCompleted,
      completedAt: a.completedAt ? a.completedAt.toISOString() : null,
      status: a.status,
      carriedToId: a.carriedToId,
    });

    const mapTask = (t: {
      id: string; title: string; notes: string | null; estimatedMinutes: number | null;
      sortOrder: number; isAbandoned: boolean; goalId: string | null;
      assignments: Parameters<typeof mapAssignment>[0][];
    }): TaskShape => ({
      id: t.id,
      title: t.title,
      notes: t.notes,
      estimatedMinutes: t.estimatedMinutes,
      sortOrder: t.sortOrder,
      isAbandoned: t.isAbandoned,
      goalId: t.goalId,
      assignments: t.assignments.map(mapAssignment),
    });

    return {
      plan: {
        id: plan.id,
        weekStart: formatDate(plan.weekStart),
        status: plan.status,
      },
      goals: plan.goals.map((g) => ({
        id: g.id,
        title: g.title,
        description: g.description,
        sortOrder: g.sortOrder,
        isAbandoned: g.isAbandoned,
        tasks: g.tasks.map(mapTask),
      })),
      ungroupedTasks: plan.tasks.map(mapTask),
    };
  }

  async updatePlan(planId: string, dto: UpdatePlanDto) {
    const plan = await this.prisma.weeklyPlan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Plan not found');
    return this.prisma.weeklyPlan.update({
      where: { id: planId },
      data: { ...(dto.status ? { status: dto.status } : {}) },
    });
  }

  // ─── Goals ─────────────────────────────────────────────────────────────────

  async createGoal(planId: string, dto: CreateGoalDto) {
    const plan = await this.prisma.weeklyPlan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Plan not found');
    const count = await this.prisma.weeklyGoal.count({ where: { planId } });
    return this.prisma.weeklyGoal.create({
      data: { planId, title: dto.title, description: dto.description ?? null, sortOrder: count },
    });
  }

  async updateGoal(goalId: string, dto: UpdateGoalDto) {
    const goal = await this.prisma.weeklyGoal.findUnique({ where: { id: goalId } });
    if (!goal) throw new NotFoundException('Goal not found');
    return this.prisma.weeklyGoal.update({
      where: { id: goalId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.isAbandoned !== undefined ? { isAbandoned: dto.isAbandoned } : {}),
      },
    });
  }

  async deleteGoal(goalId: string) {
    const goal = await this.prisma.weeklyGoal.findUnique({ where: { id: goalId } });
    if (!goal) throw new NotFoundException('Goal not found');
    // Also abandon all tasks under this goal
    await this.prisma.planTask.updateMany({ where: { goalId }, data: { isAbandoned: true } });
    return this.prisma.weeklyGoal.update({ where: { id: goalId }, data: { isAbandoned: true } });
  }

  async reorderGoals(planId: string, items: ReorderItemDto[]) {
    await this.prisma.$transaction(
      items.map((item) =>
        this.prisma.weeklyGoal.update({
          where: { id: item.id, planId },
          data: { sortOrder: item.sortOrder },
        }),
      ),
    );
  }

  // ─── Tasks ─────────────────────────────────────────────────────────────────

  async createTask(planId: string, participantId: string, dto: CreateTaskDto) {
    const plan = await this.prisma.weeklyPlan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Plan not found');
    if (plan.participantId !== participantId) throw new BadRequestException('Plan does not belong to participant');
    const count = await this.prisma.planTask.count({
      where: { planId, goalId: dto.goalId ?? null },
    });
    return this.prisma.planTask.create({
      data: {
        planId,
        participantId,
        goalId: dto.goalId ?? null,
        title: dto.title,
        notes: dto.notes ?? null,
        estimatedMinutes: dto.estimatedMinutes ?? null,
        sortOrder: count,
      },
      include: { assignments: true },
    });
  }

  async updateTask(taskId: string, dto: UpdateTaskDto) {
    const task = await this.prisma.planTask.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Task not found');
    return this.prisma.planTask.update({
      where: { id: taskId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        ...(dto.estimatedMinutes !== undefined ? { estimatedMinutes: dto.estimatedMinutes } : {}),
        ...(dto.isAbandoned !== undefined ? { isAbandoned: dto.isAbandoned } : {}),
        ...(dto.goalId !== undefined ? { goalId: dto.goalId } : {}),
      },
      include: { assignments: true },
    });
  }

  async deleteTask(taskId: string) {
    const task = await this.prisma.planTask.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Task not found');
    return this.prisma.planTask.update({ where: { id: taskId }, data: { isAbandoned: true } });
  }

  async reorderTasks(planId: string, items: ReorderItemDto[]) {
    await this.prisma.$transaction(
      items.map((item) =>
        this.prisma.planTask.update({
          where: { id: item.id, planId },
          data: { sortOrder: item.sortOrder },
        }),
      ),
    );
  }

  // ─── Assignments ───────────────────────────────────────────────────────────

  async assignTask(taskId: string, dto: AssignTaskDto) {
    const task = await this.prisma.planTask.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Task not found');
    const scheduledDate = toMidnightUTC(dto.scheduledDate);
    return this.prisma.taskAssignment.create({
      data: {
        taskId,
        participantId: task.participantId,
        scheduledDate,
        startTime: dto.startTime ?? null,
        endTime: dto.endTime ?? null,
      },
    });
  }

  async updateAssignment(assignmentId: string, dto: UpdateAssignmentDto) {
    const a = await this.prisma.taskAssignment.findUnique({ where: { id: assignmentId } });
    if (!a) throw new NotFoundException('Assignment not found');
    return this.prisma.taskAssignment.update({
      where: { id: assignmentId },
      data: {
        ...(dto.scheduledDate !== undefined ? { scheduledDate: toMidnightUTC(dto.scheduledDate) } : {}),
        ...(dto.startTime !== undefined ? { startTime: dto.startTime } : {}),
        ...(dto.endTime !== undefined ? { endTime: dto.endTime } : {}),
        ...(dto.isCompleted !== undefined
          ? {
              isCompleted: dto.isCompleted,
              status: dto.isCompleted ? 'completed' : 'scheduled',
              completedAt: dto.isCompleted ? new Date() : null,
            }
          : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
    });
  }

  async removeAssignment(assignmentId: string) {
    const a = await this.prisma.taskAssignment.findUnique({ where: { id: assignmentId } });
    if (!a) throw new NotFoundException('Assignment not found');
    // Only remove if not yet completed and not already carried forward
    if (a.status === 'carried_forward') throw new BadRequestException('Cannot remove a carried-forward history record');
    return this.prisma.taskAssignment.delete({ where: { id: assignmentId } });
  }

  // ─── Carry Forward ─────────────────────────────────────────────────────────

  async carryForward(assignmentId: string, dto: CarryForwardDto) {
    const assignment = await this.prisma.taskAssignment.findUnique({
      where: { id: assignmentId },
      include: { task: true },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');
    if (assignment.isCompleted) throw new BadRequestException('Cannot carry forward a completed task');

    const today = toMidnightUTC(new Date().toISOString().split('T')[0]);

    // Determine target date
    let toDate: Date;
    if (dto.toDate) {
      toDate = toMidnightUTC(dto.toDate);
    } else if (dto.toWeekStart) {
      const fromWeekday = assignment.scheduledDate.getUTCDay();
      const targetWeekSunday = toMidnightUTC(dto.toWeekStart);
      toDate = addDays(targetWeekSunday, fromWeekday);
    } else {
      toDate = addDays(today, 1);
    }

    const isDeferral = assignment.scheduledDate <= today;
    const deferralType = dto.toWeekStart ? 'weekly' : 'daily';

    // Count consecutive streaks before the transaction
    let consecutiveDailyDeferrals = 0;
    let consecutiveWeeklyCarries = 0;

    if (isDeferral) {
      const recent = await this.prisma.deferralEvent.findMany({
        where: { taskId: assignment.taskId, isDeferral: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
      // Use the composite index [taskId, completedAt] for this query
      const lastCompletion = await this.prisma.taskAssignment.findFirst({
        where: { taskId: assignment.taskId, isCompleted: true },
        orderBy: { completedAt: 'desc' },
      });
      const lastCompletionTime = lastCompletion?.completedAt ?? null;

      for (const e of recent) {
        if (lastCompletionTime && e.createdAt < lastCompletionTime) break;
        if (e.deferralType === 'daily') consecutiveDailyDeferrals++;
        if (e.deferralType === 'weekly') consecutiveWeeklyCarries++;
      }
      if (deferralType === 'daily') consecutiveDailyDeferrals++;
      else consecutiveWeeklyCarries++;
    }

    // Execute atomically.
    //
    // Invariant: a TaskAssignment with status='scheduled' must produce at most one
    // carried_forward child. We enforce this by using updateMany with a conditional
    // WHERE status='scheduled' inside the transaction. If the row was already carried
    // forward (e.g. a concurrent request beat us), updateMany returns count=0 and we
    // throw — no partial write, no branching chains.
    const newAssignment = await this.prisma.$transaction(async (tx) => {
      // Atomic status guard: only updates if still 'scheduled'
      const { count } = await tx.taskAssignment.updateMany({
        where: { id: assignmentId, status: 'scheduled' },
        data: { status: 'carried_forward' },
      });
      if (count === 0) {
        // Already carried forward or completed by a concurrent request
        throw new BadRequestException('Assignment is already carried forward or completed');
      }

      // Create the new assignment on the target date
      const created = await tx.taskAssignment.create({
        data: {
          taskId: assignment.taskId,
          participantId: assignment.participantId,
          scheduledDate: toDate,
          startTime: assignment.startTime,
          endTime: assignment.endTime,
        },
      });

      // Link old → new (completes the chain pointer)
      await tx.taskAssignment.update({
        where: { id: assignmentId },
        data: { carriedToId: created.id },
      });

      // Record deferral event
      await tx.deferralEvent.create({
        data: {
          taskId: assignment.taskId,
          participantId: assignment.participantId,
          fromAssignmentId: assignmentId,
          fromDate: assignment.scheduledDate,
          toDate,
          deferralType,
          isDeferral,
          consecutiveDailyDeferrals,
          consecutiveWeeklyCarries,
        },
      });

      return created;
    });

    return newAssignment;
  }

  // ─── Daily view ────────────────────────────────────────────────────────────

  async getDayAssignments(participantId: string, dateStr: string) {
    const date = toMidnightUTC(dateStr);
    const assignments = await this.prisma.taskAssignment.findMany({
      where: { participantId, scheduledDate: date },
      orderBy: [{ startTime: 'asc' }, { createdAt: 'asc' }],
      include: {
        task: {
          include: {
            goal: { select: { id: true, title: true } },
          },
        },
      },
    });
    return assignments.map((a) => ({
      id: a.id,
      scheduledDate: formatDate(a.scheduledDate),
      startTime: a.startTime,
      endTime: a.endTime,
      isCompleted: a.isCompleted,
      completedAt: a.completedAt ? a.completedAt.toISOString() : null,
      status: a.status,
      carriedToId: a.carriedToId,
      task: {
        id: a.task.id,
        title: a.task.title,
        notes: a.task.notes,
        estimatedMinutes: a.task.estimatedMinutes,
        goal: a.task.goal ? { id: a.task.goal.id, title: a.task.goal.title } : null,
      },
    }));
  }

  // ─── Daily summary (message preview) ──────────────────────────────────────

  async getDailySummary(participantId: string, dateStr: string) {
    const today = toMidnightUTC(dateStr);
    const tomorrow = addDays(today, 1);

    const [participant, todayAssignments, tomorrowAssignments] = await Promise.all([
      this.prisma.participant.findUnique({
        where: { id: participantId },
        select: { firstName: true, lastName: true },
      }),
      this.prisma.taskAssignment.findMany({
        where: { participantId, scheduledDate: today },
        include: { task: { include: { goal: { select: { title: true } } } } },
        orderBy: [{ startTime: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.taskAssignment.findMany({
        where: { participantId, scheduledDate: tomorrow, status: 'scheduled' },
        include: { task: { include: { goal: { select: { title: true } } } } },
        orderBy: [{ startTime: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);

    const completed = todayAssignments.filter((a) => a.isCompleted);
    const incomplete = todayAssignments.filter((a) => !a.isCompleted && a.status !== 'carried_forward');
    const carriedForward = todayAssignments.filter((a) => a.status === 'carried_forward');

    const dateFormatted = today.toLocaleDateString('he-IL', {
      weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
    });

    const summaryData: DailySummaryData = {
      participantName: participant ? `${participant.firstName} ${participant.lastName ?? ''}`.trim() : '',
      date: dateStr,
      dateFormatted,
      completed: completed.map((a) => ({ taskId: a.taskId, title: a.task.title })),
      incomplete: incomplete.map((a) => ({ taskId: a.taskId, title: a.task.title })),
      carriedForward: carriedForward.map((a) => ({ taskId: a.taskId, title: a.task.title })),
      tomorrowPlan: tomorrowAssignments.map((a) => ({ taskId: a.taskId, title: a.task.title, startTime: a.startTime })),
    };

    return {
      ...summaryData,
      messagePreview: buildDailySummaryMessage(summaryData),
    };
  }

  // ─── Weekly summary (message preview) ─────────────────────────────────────

  async getWeeklySummary(planId: string) {
    const plan = await this.prisma.weeklyPlan.findUnique({
      where: { id: planId },
      include: {
        participant: { select: { firstName: true, lastName: true } },
        goals: {
          where: { isAbandoned: false },
          orderBy: { sortOrder: 'asc' },
          include: {
            tasks: {
              where: { isAbandoned: false },
              include: { assignments: { orderBy: { scheduledDate: 'asc' } } },
            },
          },
        },
        tasks: {
          where: { goalId: null, isAbandoned: false },
          include: { assignments: { orderBy: { scheduledDate: 'asc' } } },
        },
      },
    });
    if (!plan) throw new NotFoundException('Plan not found');

    const allTasks = [
      ...plan.goals.flatMap((g) => g.tasks.map((t) => ({ ...t, goalTitle: g.title }))),
      ...plan.tasks.map((t) => ({ ...t, goalTitle: null as string | null })),
    ];

    type GoalStat = { goal: { id: string; title: string }; total: number; completed: number };
    const goalStats: GoalStat[] = plan.goals.map((g) => {
      const tasks = g.tasks.filter((t) => !t.isAbandoned);
      const completedCount = tasks.filter((t) =>
        t.assignments.some((a) => a.isCompleted),
      ).length;
      return { goal: { id: g.id, title: g.title }, total: tasks.length, completed: completedCount };
    });

    const completedTasks = allTasks.filter((t) => t.assignments.some((a) => a.isCompleted));
    const incompleteTasks = allTasks.filter(
      (t) => !t.isAbandoned && !t.assignments.some((a) => a.isCompleted),
    );

    const weekEndStr = formatDate(addDays(plan.weekStart, 6));
    const weekStartStr = formatDate(plan.weekStart);

    const summaryData: WeeklySummaryData = {
      participantName: `${plan.participant.firstName} ${plan.participant.lastName ?? ''}`.trim(),
      weekStart: weekStartStr,
      weekEnd: weekEndStr,
      goalStats,
      completedTasks: completedTasks.map((t) => ({ title: t.title })),
      incompleteTasks: incompleteTasks.map((t) => ({ title: t.title })),
    };

    return {
      ...summaryData,
      completedCount: completedTasks.length,
      incompleteCount: incompleteTasks.length,
      messagePreview: buildWeeklySummaryMessage(summaryData),
    };
  }

  // ─── Portal token resolution ───────────────────────────────────────────────
  // Resolves a ParticipantGroup.accessToken → participant context.
  // Returns the participant + group info needed to bootstrap the portal.

  async resolvePortalToken(token: string) {
    const pg = await this.prisma.participantGroup.findUnique({
      where: { accessToken: token },
      include: {
        participant: {
          select: { id: true, firstName: true, lastName: true },
        },
        group: {
          select: { id: true, name: true, taskEngineEnabled: true, portalCallTime: true, portalOpenTime: true },
        },
      },
    });

    if (!pg) throw new NotFoundException('Link not found or invalid');

    return {
      participantId: pg.participantId,
      participantName: `${pg.participant.firstName} ${pg.participant.lastName ?? ''}`.trim(),
      participantFirstName: pg.participant.firstName,
      groupId: pg.groupId,
      groupName: pg.group.name,
      taskEngineEnabled: pg.group.taskEngineEnabled,
      memberIsActive: pg.isActive,
      portalCallTime: pg.group.portalCallTime ? pg.group.portalCallTime.toISOString() : null,
      portalOpenTime: pg.group.portalOpenTime ? pg.group.portalOpenTime.toISOString() : null,
    };
  }

  // ─── Coach ↔ participant notes ─────────────────────────────────────────────

  async getNotes(participantId: string) {
    return this.prisma.participantTaskNote.findMany({
      where: { participantId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createNote(dto: CreateNoteDto) {
    return this.prisma.participantTaskNote.create({
      data: {
        participantId: dto.participantId,
        content: dto.content,
        senderType: dto.senderType,
        senderName: dto.senderName ?? null,
      },
    });
  }
}
