import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectTaskSyncService } from './project-task-sync.service';
import {
  CreateItemDto,
  CreateNoteDto,
  CreateProjectDto,
  PROJECT_ITEM_TYPES,
  PROJECT_LOG_STATUSES,
  ProjectItemType,
  ReorderItemDto,
  ScheduleItemDto,
  UpdateItemDto,
  UpdateProjectDto,
  UpsertDailyContextDto,
  UpsertLogDto,
} from './dto/projects.dto';

// ─── Date helpers (Asia/Jerusalem) ────────────────────────────────────────────

const ISRAEL_TZ = 'Asia/Jerusalem';

// Returns "YYYY-MM-DD" for the current civil date in Asia/Jerusalem.
function todayInIsrael(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ISRAEL_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  // en-CA gives YYYY-MM-DD directly.
  return parts;
}

function yesterdayInIsrael(): string {
  // Take today's YYYY-MM-DD and subtract one day purely by string math through Date.UTC.
  const today = todayInIsrael();
  const [y, m, d] = today.split('-').map((s) => parseInt(s, 10));
  const prev = new Date(Date.UTC(y, m - 1, d) - 86_400_000);
  return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}-${String(prev.getUTCDate()).padStart(2, '0')}`;
}

// Parse a "YYYY-MM-DD" string into a Date representing midnight UTC of that
// civil day. Postgres DATE columns ignore the time component; using midnight
// UTC avoids TZ drift when the row is serialized back on read.
function parseDayString(s: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new BadRequestException(`Invalid date: ${s}`);
  }
  const [y, m, d] = s.split('-').map((n) => parseInt(n, 10));
  return new Date(Date.UTC(y, m - 1, d));
}

function formatDayString(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: ProjectTaskSyncService,
  ) {}

  // ── Token resolution (portal mode) ─────────────────────────────────────────
  // Resolves a portal access token to a participant. Throws 404 if the token
  // doesn't match an active participant-group row. Returns the participant so
  // callers can enforce the canManageProjects flag inline.
  private async resolveToken(token: string): Promise<{
    id: string;
    firstName: string;
    lastName: string | null;
    canManageProjects: boolean;
  }> {
    const pg = await this.prisma.participantGroup.findUnique({
      where: { accessToken: token },
      include: {
        participant: {
          select: { id: true, firstName: true, lastName: true, canManageProjects: true },
        },
      },
    });
    if (!pg) throw new NotFoundException('Invalid portal token');
    return pg.participant;
  }

  private async assertOwnership(
    participantId: string,
    opts: { projectId?: string; itemId?: string; logId?: string; noteId?: string },
  ): Promise<void> {
    if (opts.projectId) {
      const p = await this.prisma.project.findUnique({
        where: { id: opts.projectId },
        select: { participantId: true },
      });
      if (!p) throw new NotFoundException('Project not found');
      if (p.participantId !== participantId) throw new ForbiddenException();
    }
    if (opts.itemId) {
      const i = await this.prisma.projectItem.findUnique({
        where: { id: opts.itemId },
        select: { project: { select: { participantId: true } } },
      });
      if (!i) throw new NotFoundException('Item not found');
      if (i.project.participantId !== participantId) throw new ForbiddenException();
    }
    if (opts.logId) {
      const l = await this.prisma.projectItemLog.findUnique({
        where: { id: opts.logId },
        select: { participantId: true },
      });
      if (!l) throw new NotFoundException('Log not found');
      if (l.participantId !== participantId) throw new ForbiddenException();
    }
    if (opts.noteId) {
      const n = await this.prisma.projectNote.findUnique({
        where: { id: opts.noteId },
        select: { project: { select: { participantId: true } } },
      });
      if (!n) throw new NotFoundException('Note not found');
      if (n.project.participantId !== participantId) throw new ForbiddenException();
    }
  }

  // ── Common list shape used by both admin and portal reads ──────────────────
  // Returns projects + items + logs for the given [fromDate..toDate] window.
  // Logs outside that window are omitted to keep payloads small. Archived items
  // and non-active projects are always included (reads never hide history).
  private async listProjectsForParticipant(
    participantId: string,
    opts: { fromDate: Date; toDate: Date; includeArchived: boolean },
  ) {
    const projects = await this.prisma.project.findMany({
      where: {
        participantId,
        ...(opts.includeArchived ? {} : { status: { not: 'cancelled' } }),
      },
      orderBy: [{ createdAt: 'asc' }],
      include: {
        items: {
          orderBy: [{ isArchived: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
          include: {
            logs: {
              where: {
                logDate: { gte: opts.fromDate, lte: opts.toDate },
              },
              orderBy: { logDate: 'asc' },
            },
          },
        },
      },
    });

    return projects.map((p) => ({
      id: p.id,
      participantId: p.participantId,
      title: p.title,
      description: p.description,
      colorHex: p.colorHex,
      status: p.status,
      createdByRole: p.createdByRole,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      items: p.items.map((it) => ({
        id: it.id,
        projectId: it.projectId,
        title: it.title,
        itemType: it.itemType,
        unit: it.unit,
        targetValue: it.targetValue,
        selectOptions: (it.selectOptionsJson as unknown as { value: string; label: string }[] | null) ?? null,
        sortOrder: it.sortOrder,
        isArchived: it.isArchived,
        linkedPlanTaskId: it.linkedPlanTaskId,
        // Phase 3 scheduling fields — always returned so the frontend can
        // pre-fill edit forms without a second fetch.
        scheduleFrequencyType: it.scheduleFrequencyType,
        scheduleTimesPerWeek: it.scheduleTimesPerWeek,
        schedulePreferredWeekdays: it.schedulePreferredWeekdays,
        // Phase 4 end date (YYYY-MM-DD string or null).
        endDate: it.endDate ? formatDayString(it.endDate) : null,
        createdAt: it.createdAt.toISOString(),
        logs: it.logs.map((l) => ({
          id: l.id,
          itemId: l.itemId,
          logDate: formatDayString(l.logDate),
          status: l.status,
          numericValue: l.numericValue,
          selectValue: l.selectValue,
          skipNote: l.skipNote,
          commitNote: l.commitNote,
          editedAt: l.editedAt ? l.editedAt.toISOString() : null,
          editedByRole: l.editedByRole,
          syncSource: l.syncSource,
          createdAt: l.createdAt.toISOString(),
        })),
      })),
    }));
  }

  private async loadNotes(projectIds: string[]) {
    if (projectIds.length === 0) return [];
    const notes = await this.prisma.projectNote.findMany({
      where: { projectId: { in: projectIds } },
      orderBy: { createdAt: 'asc' },
    });
    return notes.map((n) => ({
      id: n.id,
      projectId: n.projectId,
      participantId: n.participantId,
      content: n.content,
      authorRole: n.authorRole,
      createdAt: n.createdAt.toISOString(),
    }));
  }

  // ── Shape validation ───────────────────────────────────────────────────────

  private validateItemShape(
    itemType: ProjectItemType,
    dto: { selectOptions?: { value: string; label: string }[] },
  ) {
    if (itemType === 'select') {
      if (!dto.selectOptions || dto.selectOptions.length === 0) {
        throw new BadRequestException('select items require at least one option');
      }
    }
  }

  private validateLogForItem(
    item: { itemType: string; targetValue: number | null; selectOptionsJson: Prisma.JsonValue },
    dto: UpsertLogDto,
  ): { status: string; numericValue: number | null; selectValue: string | null } {
    if (!PROJECT_LOG_STATUSES.includes(dto.status)) {
      throw new BadRequestException(`Invalid status ${dto.status}`);
    }

    // skip/committed don't need a value — we accept them for any item type.
    if (dto.status === 'skipped_today' || dto.status === 'committed') {
      return { status: dto.status, numericValue: null, selectValue: null };
    }

    if (item.itemType === 'boolean') {
      if (dto.status !== 'completed') {
        throw new BadRequestException('boolean items only accept status=completed');
      }
      return { status: 'completed', numericValue: null, selectValue: null };
    }

    if (item.itemType === 'number') {
      if (dto.numericValue === undefined || dto.numericValue === null) {
        throw new BadRequestException('number items require numericValue');
      }
      const v = dto.numericValue;
      // Server decides completed vs value: if a target is set and value meets it,
      // the row is completed; otherwise it's a raw value entry.
      const meetsTarget =
        item.targetValue !== null && item.targetValue !== undefined && v >= item.targetValue;
      return {
        status: meetsTarget ? 'completed' : 'value',
        numericValue: v,
        selectValue: null,
      };
    }

    if (item.itemType === 'select') {
      if (!dto.selectValue) throw new BadRequestException('select items require selectValue');
      const opts = (item.selectOptionsJson as unknown as { value: string }[] | null) ?? [];
      if (!opts.some((o) => o.value === dto.selectValue)) {
        throw new BadRequestException('selectValue is not one of the item options');
      }
      return { status: 'completed', numericValue: null, selectValue: dto.selectValue };
    }

    throw new BadRequestException(`Unsupported itemType ${item.itemType}`);
  }

  // ── Admin CRUD (trusted caller, no ownership check needed) ─────────────────

  async adminListForParticipant(
    participantId: string,
    opts: { from?: string; to?: string } = {},
  ) {
    const toDate = opts.to ? parseDayString(opts.to) : parseDayString(todayInIsrael());
    // Default: last 14 days (wide enough for admin to scan recent activity).
    const defaultFromIso = (() => {
      const [y, m, d] = todayInIsrael().split('-').map((n) => parseInt(n, 10));
      const from = new Date(Date.UTC(y, m - 1, d - 13));
      return formatDayString(from);
    })();
    const fromDate = opts.from ? parseDayString(opts.from) : parseDayString(defaultFromIso);

    const projects = await this.listProjectsForParticipant(participantId, {
      fromDate,
      toDate,
      includeArchived: true,
    });
    const notes = await this.loadNotes(projects.map((p) => p.id));
    const linkableTasks = await this.sync.listLinkableTasks(participantId);
    const scheduledKeys = await this.computeScheduledKeys(projects, fromDate, toDate);
    const schedulingStatus = await this.buildSchedulingStatusMap(projects);
    return { projects, notes, linkableTasks, scheduledKeys, schedulingStatus };
  }

  // Phase 3: compute per-linked-goal scheduling status for the CURRENT week
  // (Asia/Jerusalem), regardless of the bootstrap's read window. The chip is
  // always about "this week now," not the historical log window.
  private async buildSchedulingStatusMap(
    projects: Array<{ id: string; items: Array<{
      id: string;
      linkedPlanTaskId: string | null;
      scheduleFrequencyType: string;
      scheduleTimesPerWeek: number | null;
      schedulePreferredWeekdays: string | null;
      itemType: string;
      isArchived: boolean;
      endDate: string | null;
      logs: { logDate: string; status: string }[];
    }> }>,
  ): Promise<Record<string, unknown>> {
    const allItems: Parameters<ProjectTaskSyncService['computeSchedulingStatus']>[0]['items'] = [];
    const logsByItem = new Map<string, { logDate: string; status: string }[]>();
    for (const p of projects) {
      for (const it of p.items) {
        allItems.push({
          id: it.id,
          linkedPlanTaskId: it.linkedPlanTaskId,
          scheduleFrequencyType: it.scheduleFrequencyType,
          scheduleTimesPerWeek: it.scheduleTimesPerWeek,
          schedulePreferredWeekdays: it.schedulePreferredWeekdays,
          itemType: it.itemType,
          isArchived: it.isArchived,
          endDate: it.endDate,
        });
        logsByItem.set(it.id, it.logs.map((l) => ({ logDate: l.logDate, status: l.status })));
      }
    }

    // Week start = Sunday 00:00 UTC in Asia/Jerusalem terms.
    const todayIso = todayInIsrael();
    const [y, m, d] = todayIso.split('-').map((n) => parseInt(n, 10));
    const todayUtc = new Date(Date.UTC(y, m - 1, d));
    const dayOfWeek = todayUtc.getUTCDay();
    const weekStartUtc = new Date(Date.UTC(y, m - 1, d - dayOfWeek));

    const statusMap = await this.sync.computeSchedulingStatus({
      items: allItems,
      weekStartUtc,
      todayUtc,
      logsByItem,
    });

    const out: Record<string, unknown> = {};
    statusMap.forEach((v, k) => { out[k] = v; });
    return out;
  }

  // Returns a Set-like array of "itemId|YYYY-MM-DD" keys indicating that the
  // linked task for that goal has an ACTIVE assignment on that date. The
  // frontend uses this to drive the "לא נקבע להיום בלו״ז" hint: hint is shown
  // iff the item is linked, a completed log exists on the date, and the key
  // is NOT in this set.
  private async computeScheduledKeys(
    projects: Array<{ id: string; items: Array<{ id: string; linkedPlanTaskId: string | null }> }>,
    fromDate: Date,
    toDate: Date,
  ): Promise<string[]> {
    const linkedTaskIds: string[] = [];
    for (const p of projects) {
      for (const it of p.items) {
        if (it.linkedPlanTaskId) linkedTaskIds.push(it.linkedPlanTaskId);
      }
    }
    if (linkedTaskIds.length === 0) return [];
    // Generate the inclusive date range as midnight-UTC Date instances so the
    // `in` filter matches the stored values.
    const dates: Date[] = [];
    for (let d = new Date(fromDate); d <= toDate; d = new Date(d.getTime() + 86_400_000)) {
      dates.push(new Date(d));
    }
    const pairs = await this.sync.findActiveAssignmentPairs({ linkedTaskIds, dates });
    return [...pairs];
  }

  async adminCreateProject(participantId: string, dto: CreateProjectDto) {
    const participant = await this.prisma.participant.findUnique({
      where: { id: participantId },
      select: { id: true },
    });
    if (!participant) throw new NotFoundException('Participant not found');
    return this.prisma.project.create({
      data: {
        participantId,
        title: dto.title,
        description: dto.description ?? null,
        colorHex: dto.colorHex ?? null,
        createdByRole: 'admin',
      },
    });
  }

  async adminUpdateProject(projectId: string, dto: UpdateProjectDto) {
    const existing = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!existing) throw new NotFoundException('Project not found');
    return this.prisma.project.update({
      where: { id: projectId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.description !== undefined ? { description: dto.description || null } : {}),
        ...(dto.colorHex !== undefined ? { colorHex: dto.colorHex || null } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
    });
  }

  // Hard-delete a project and all of its descendants. Irreversible.
  // Intentionally admin-only — participants get archive (soft) which
  // preserves logs. Deletion cascade order respects the FK graph:
  //   logs → items → notes → project.
  // Wrapped in a transaction so a partial failure can't leave orphans.
  // Linked PlanTasks survive — they live in a different domain; the FK
  // from ProjectItem is `ON DELETE SET NULL`, so the task simply loses
  // its reverse relation when the item row disappears.
  async adminHardDeleteProject(projectId: string) {
    const existing = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Project not found');
    await this.prisma.$transaction(async (tx) => {
      // Clear links first — Prisma can't cascade-null a self-referencing FK
      // on delete automatically, so we explicitly break the link before the
      // item rows go away.
      await tx.projectItem.updateMany({
        where: { projectId, linkedPlanTaskId: { not: null } },
        data: { linkedPlanTaskId: null },
      });
      await tx.projectItemLog.deleteMany({
        where: { item: { projectId } },
      });
      await tx.projectItem.deleteMany({ where: { projectId } });
      await tx.projectNote.deleteMany({ where: { projectId } });
      await tx.project.delete({ where: { id: projectId } });
    });
    return { ok: true };
  }

  async adminCreateItem(projectId: string, dto: CreateItemDto) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');
    if (!PROJECT_ITEM_TYPES.includes(dto.itemType)) {
      throw new BadRequestException(`Unsupported itemType ${dto.itemType}`);
    }
    this.validateItemShape(dto.itemType, dto);

    // Phase 2 link validation — must happen BEFORE the create so we don't
    // orphan a half-linked row on error.
    const linkId = this.normalizeLinkId(dto.linkedPlanTaskId);
    if (linkId) {
      await this.sync.assertLinkable({
        participantId: project.participantId,
        taskId: linkId,
        itemType: dto.itemType,
      });
    }

    // Phase 3 schedule validation + normalization. Only boolean goals may
    // carry a schedule; non-boolean + non-'none' is rejected early so the
    // row never commits with an inconsistent shape.
    const schedule = this.normalizeSchedule({
      itemType: dto.itemType,
      frequencyType: dto.scheduleFrequencyType,
      timesPerWeek: dto.scheduleTimesPerWeek,
      preferredWeekdays: dto.schedulePreferredWeekdays,
    });

    const count = await this.prisma.projectItem.count({ where: { projectId } });
    const endDate = this.normalizeEndDate(dto.endDate);
    return this.prisma.projectItem.create({
      data: {
        projectId,
        title: dto.title,
        itemType: dto.itemType,
        unit: dto.unit ?? null,
        targetValue: dto.targetValue ?? null,
        selectOptionsJson: (dto.selectOptions ?? null) as unknown as Prisma.InputJsonValue,
        sortOrder: count,
        linkedPlanTaskId: linkId,
        scheduleFrequencyType: schedule.frequencyType,
        scheduleTimesPerWeek: schedule.timesPerWeek,
        schedulePreferredWeekdays: schedule.preferredWeekdays,
        endDate,
      },
    });
  }

  async adminUpdateItem(itemId: string, dto: UpdateItemDto) {
    const existing = await this.prisma.projectItem.findUnique({
      where: { id: itemId },
      include: { project: { select: { participantId: true } } },
    });
    if (!existing) throw new NotFoundException('Item not found');
    if (dto.selectOptions !== undefined && existing.itemType === 'select') {
      if (dto.selectOptions.length === 0) {
        throw new BadRequestException('select items require at least one option');
      }
    }

    // Resolve the linkedPlanTaskId update:
    //   undefined   → no change
    //   null / ""   → unlink
    //   "some-id"   → link to that task (validated)
    let linkUpdate: { linkedPlanTaskId: string | null } | Record<string, never> = {};
    if (dto.linkedPlanTaskId !== undefined) {
      const normalized = this.normalizeLinkId(dto.linkedPlanTaskId);
      if (normalized) {
        await this.sync.assertLinkable({
          participantId: existing.project.participantId,
          taskId: normalized,
          exceptItemId: itemId,
          itemType: existing.itemType,
        });
      }
      linkUpdate = { linkedPlanTaskId: normalized };
    }

    // Phase 3 schedule update: only apply if ANY of the three fields was
    // provided. Treat them as a coherent bundle so admins can't leave the
    // row in an invalid combo (e.g. weekly without timesPerWeek).
    let scheduleUpdate: {
      scheduleFrequencyType?: string;
      scheduleTimesPerWeek?: number | null;
      schedulePreferredWeekdays?: string | null;
    } = {};
    const scheduleTouched =
      dto.scheduleFrequencyType !== undefined
      || dto.scheduleTimesPerWeek !== undefined
      || dto.schedulePreferredWeekdays !== undefined;
    if (scheduleTouched) {
      const freq =
        dto.scheduleFrequencyType !== undefined
          ? dto.scheduleFrequencyType
          : (existing.scheduleFrequencyType as 'none' | 'daily' | 'weekly');
      const schedule = this.normalizeSchedule({
        itemType: existing.itemType,
        frequencyType: freq,
        timesPerWeek: dto.scheduleTimesPerWeek !== undefined
          ? dto.scheduleTimesPerWeek
          : existing.scheduleTimesPerWeek,
        preferredWeekdays: dto.schedulePreferredWeekdays !== undefined
          ? dto.schedulePreferredWeekdays
          : existing.schedulePreferredWeekdays,
      });
      scheduleUpdate = {
        scheduleFrequencyType: schedule.frequencyType,
        scheduleTimesPerWeek: schedule.timesPerWeek,
        schedulePreferredWeekdays: schedule.preferredWeekdays,
      };
    }

    // Phase 4 endDate: undefined → leave; null → clear; string → set/validate.
    const endDateUpdate =
      dto.endDate === undefined
        ? {}
        : { endDate: this.normalizeEndDate(dto.endDate) };

    return this.prisma.projectItem.update({
      where: { id: itemId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.unit !== undefined ? { unit: dto.unit || null } : {}),
        ...(dto.targetValue !== undefined ? { targetValue: dto.targetValue ?? null } : {}),
        ...(dto.selectOptions !== undefined
          ? { selectOptionsJson: dto.selectOptions as unknown as Prisma.InputJsonValue }
          : {}),
        ...(dto.isArchived !== undefined ? { isArchived: dto.isArchived } : {}),
        ...linkUpdate,
        ...scheduleUpdate,
        ...endDateUpdate,
      },
    });
  }

  async adminArchiveItem(itemId: string) {
    const existing = await this.prisma.projectItem.findUnique({ where: { id: itemId } });
    if (!existing) throw new NotFoundException('Item not found');
    // Archive clears the link automatically (finalized design §9.C) so the
    // participant sees a consistent state: archived goals don't mirror.
    return this.prisma.projectItem.update({
      where: { id: itemId },
      data: { isArchived: true, linkedPlanTaskId: null },
    });
  }

  // Normalizes a client-supplied linkedPlanTaskId into one of:
  //   null         (explicit unlink)
  //   "<cuid>"     (request to link)
  // Empty string / whitespace / the literal string "null" all collapse to null.
  private normalizeLinkId(raw: string | null | undefined): string | null {
    if (raw === undefined || raw === null) return null;
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed === 'null') return null;
    return trimmed;
  }

  // ── Phase 5 stats ──────────────────────────────────────────────────────────
  //
  // Per-item roll-up for a date range. Pure read, no mutations. Stats are
  // scoped to boolean items with a schedule config — other types/items are
  // returned with expected=0/percentage=null so the frontend can still show
  // them (in a "no target" section if desired).
  //
  // completedCount counts ProjectItemLog rows with status='completed' in the
  // effective range (clamped to item.createdAt..min(endDate, today, to)).
  // expectedCount is derived from the frequency config:
  //   'daily'  → effectiveDays
  //   'weekly' → round(effectiveDays × timesPerWeek / 7)
  //   'none'   → 0
  //
  // No analytics, no trends, no cycle/cravings — out of scope for Phase 5.
  async computeProjectStats(
    participantId: string,
    fromStr: string,
    toStr: string,
  ) {
    const fromDate = parseDayString(fromStr);
    const toDate = parseDayString(toStr);
    const todayStr = todayInIsrael();

    const projects = await this.prisma.project.findMany({
      where: { participantId, status: { not: 'cancelled' } },
      orderBy: { createdAt: 'asc' },
      include: {
        items: {
          where: { isArchived: false },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          include: {
            logs: {
              where: { logDate: { gte: fromDate, lte: toDate } },
              orderBy: { logDate: 'asc' },
            },
          },
        },
      },
    });

    return {
      range: { from: fromStr, to: toStr },
      projects: projects.map((p) => ({
        id: p.id,
        title: p.title,
        colorHex: p.colorHex,
        items: p.items.map((it) => this.buildItemStats(it, fromStr, toStr, todayStr)),
      })),
    };
  }

  private buildItemStats(
    item: {
      id: string;
      title: string;
      itemType: string;
      scheduleFrequencyType: string;
      scheduleTimesPerWeek: number | null;
      endDate: Date | null;
      createdAt: Date;
      logs: { logDate: Date; status: string; skipNote: string | null }[];
    },
    fromStr: string,
    toStr: string,
    todayStr: string,
  ) {
    const endDateStr = item.endDate ? formatDayString(item.endDate) : null;
    // Effective range end = min(to, today, endDate if set).
    const candidates = [toStr, todayStr, ...(endDateStr ? [endDateStr] : [])];
    const effectiveEndStr = candidates.reduce((a, b) => (a < b ? a : b));

    // Effective range start = max(item.createdAt-day, from).
    const itemCreatedDay = new Intl.DateTimeFormat('en-CA', {
      timeZone: ISRAEL_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(item.createdAt);
    const effectiveStartStr = itemCreatedDay > fromStr ? itemCreatedDay : fromStr;

    const logMap = new Map<string, { status: string; skipNote: string | null }>();
    for (const l of item.logs) {
      logMap.set(formatDayString(l.logDate), { status: l.status, skipNote: l.skipNote });
    }

    const perDay: Array<{ date: string; completed: boolean; skipped: boolean; noteText: string | null }> = [];
    let days = 0;
    if (effectiveStartStr <= effectiveEndStr) {
      const cursor = parseDayString(effectiveStartStr);
      const end = parseDayString(effectiveEndStr);
      while (cursor.getTime() <= end.getTime()) {
        const iso = formatDayString(cursor);
        const log = logMap.get(iso);
        perDay.push({
          date: iso,
          completed: log?.status === 'completed',
          skipped: log?.status === 'skipped_today',
          noteText: log?.skipNote ?? null,
        });
        days++;
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }

    const completedCount = perDay.filter((d) => d.completed).length;

    let expectedCount = 0;
    if (item.itemType === 'boolean' && item.scheduleFrequencyType === 'daily') {
      expectedCount = days;
    } else if (
      item.itemType === 'boolean'
      && item.scheduleFrequencyType === 'weekly'
      && item.scheduleTimesPerWeek
    ) {
      expectedCount = Math.round((days * item.scheduleTimesPerWeek) / 7);
    }

    const percentage = expectedCount > 0
      ? Math.round((100 * completedCount) / expectedCount)
      : null;

    const colorBand: 'green' | 'yellow' | 'red' | null =
      percentage === null ? null
      : percentage >= 80 ? 'green'
      : percentage >= 50 ? 'yellow'
      : 'red';

    // Phase 5 streak: trailing consecutive completed days. If today is the
    // last entry and not yet completed, we skip it so an in-flight day
    // doesn't reset the streak.
    let currentStreak = 0;
    let si = perDay.length - 1;
    if (si >= 0 && perDay[si].date === todayStr && !perDay[si].completed) si--;
    while (si >= 0 && perDay[si].completed) { currentStreak++; si--; }

    return {
      id: item.id,
      title: item.title,
      itemType: item.itemType,
      frequencyType: item.scheduleFrequencyType,
      completedCount,
      expectedCount,
      percentage,
      colorBand,
      currentStreak,
      perDay,
    };
  }

  // Portal-side stats wrapper: resolves token → participant → stats.
  async portalStats(token: string, from: string, to: string) {
    const me = await this.resolveToken(token);
    return this.computeProjectStats(me.id, from, to);
  }

  // Phase 4: normalize client-supplied endDate. Null/undefined/empty → null.
  // String is parsed as a civil day; returned as a Date at midnight UTC.
  private normalizeEndDate(raw: string | null | undefined): Date | null {
    if (raw === undefined || raw === null) return null;
    const trimmed = String(raw).trim();
    if (trimmed === '' || trimmed === 'null') return null;
    return parseDayString(trimmed);
  }

  // Phase 3: validates + normalizes the scheduling bundle so every write
  // lands in one of 3 canonical shapes:
  //   none    → { type:'none',   timesPerWeek:null, preferredWeekdays:null }
  //   daily   → { type:'daily',  timesPerWeek:null, preferredWeekdays:null|csv }
  //   weekly  → { type:'weekly', timesPerWeek:1..6,  preferredWeekdays:null|csv }
  // timesPerWeek=7 on 'weekly' is normalized to 'daily' — same semantics.
  private normalizeSchedule(args: {
    itemType: string;
    frequencyType: string | undefined;
    timesPerWeek: number | null | undefined;
    preferredWeekdays: string | null | undefined;
  }): { frequencyType: string; timesPerWeek: number | null; preferredWeekdays: string | null } {
    const freq = args.frequencyType ?? 'none';

    if (freq !== 'none' && args.itemType !== 'boolean') {
      throw new BadRequestException('ניתן לקבוע לוח זמנים רק למטרות "בוצע/לא"');
    }

    if (freq === 'none') {
      return { frequencyType: 'none', timesPerWeek: null, preferredWeekdays: null };
    }

    // Validate preferredWeekdays shape.
    const preferredCsv = args.preferredWeekdays ?? null;
    let cleanPreferred: string | null = null;
    if (preferredCsv !== null && preferredCsv !== '') {
      const parts = preferredCsv.split(',').map((p) => parseInt(p.trim(), 10));
      const valid = parts.filter((n) => Number.isFinite(n) && n >= 0 && n <= 6);
      if (valid.length !== parts.length) {
        throw new BadRequestException('ימים מועדפים לא חוקיים');
      }
      const uniq: number[] = [];
      for (const n of valid) if (!uniq.includes(n)) uniq.push(n);
      uniq.sort((a, b) => a - b);
      cleanPreferred = uniq.length ? uniq.join(',') : null;
    }

    if (freq === 'daily') {
      return { frequencyType: 'daily', timesPerWeek: null, preferredWeekdays: cleanPreferred };
    }

    // freq === 'weekly'
    const tpw = args.timesPerWeek ?? null;
    if (tpw === null || !Number.isFinite(tpw) || tpw < 1 || tpw > 7) {
      throw new BadRequestException('חובה לציין כמה פעמים בשבוע (1–7)');
    }
    if (tpw === 7) {
      // Same semantics as 'daily' — normalize to avoid two representations.
      return { frequencyType: 'daily', timesPerWeek: null, preferredWeekdays: cleanPreferred };
    }
    return { frequencyType: 'weekly', timesPerWeek: tpw, preferredWeekdays: cleanPreferred };
  }

  // Phase 3 "fill the week" orchestration. Called for two scenarios:
  //   1. suggested → goal is not yet linked; create PlanTask + link + assign
  //   2. missing   → goal is linked; just create assignments
  // Each assignment is created via the shared creator which applies the
  // Phase 2 adoption rule, so no unreconciled state can emerge.
  //
  // Participant path: this orchestration allows a portal caller to schedule
  // WITHOUT canManageProjects (scheduling tasks is a first-class participant
  // action). BUT: creating a fresh PlanTask (the suggested case) requires
  // `canManageProjects` on the portal side, because that's a structural
  // addition to the plan. Admin side has no such gate.
  async scheduleItemWeek(args: {
    itemId: string;
    participantId: string;
    dto: ScheduleItemDto;
    requireCanManageForTaskCreation: boolean; // true on portal, false on admin
  }): Promise<{ linkedPlanTaskId: string; createdAssignmentIds: string[] }> {
    const item = await this.prisma.projectItem.findUnique({
      where: { id: args.itemId },
      include: { project: { select: { participantId: true, status: true } } },
    });
    if (!item) throw new NotFoundException('Item not found');
    if (item.project.participantId !== args.participantId) throw new ForbiddenException();
    if (item.isArchived) throw new BadRequestException('Item is archived');
    if (item.project.status === 'cancelled') throw new BadRequestException('Project is cancelled');
    if (item.itemType !== 'boolean') {
      throw new BadRequestException('ניתן לתזמן רק מטרות מסוג "בוצע/לא"');
    }
    if (!args.dto.dates || args.dto.dates.length === 0) {
      throw new BadRequestException('רשימת תאריכים ריקה');
    }

    const uniqueDates = [...new Set(args.dto.dates)].sort();

    return this.prisma.$transaction(async (tx) => {
      let taskId = item.linkedPlanTaskId;

      // Create PlanTask + link if not yet linked.
      if (!taskId) {
        if (args.requireCanManageForTaskCreation) {
          const p = await tx.participant.findUnique({
            where: { id: args.participantId },
            select: { canManageProjects: true },
          });
          if (!p?.canManageProjects) {
            throw new ForbiddenException('Participant cannot create tasks');
          }
        }
        // Build or reuse the current week's plan.
        const today = new Date();
        const todayIsrael = new Intl.DateTimeFormat('en-CA', {
          timeZone: ISRAEL_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(today);
        const [y, m, d] = todayIsrael.split('-').map((n) => parseInt(n, 10));
        const dayOfWeek = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
        const weekStart = new Date(Date.UTC(y, m - 1, d - dayOfWeek));
        const plan = await tx.weeklyPlan.upsert({
          where: { participantId_weekStart: { participantId: args.participantId, weekStart } },
          create: { participantId: args.participantId, weekStart },
          update: {},
        });
        const task = await tx.planTask.create({
          data: {
            planId: plan.id,
            participantId: args.participantId,
            title: (args.dto.taskTitle && args.dto.taskTitle.trim()) || item.title,
          },
        });
        await tx.projectItem.update({
          where: { id: item.id },
          data: { linkedPlanTaskId: task.id },
        });
        taskId = task.id;
      }

      // Phase 4: reject dates past the goal's endDate (when set). Silent
      // filter rather than throw — the picker shouldn't have surfaced them,
      // but if a stale payload arrives we ignore out-of-range entries.
      const endDateStr = item.endDate ? formatDayString(item.endDate) : null;
      const eligibleDates = endDateStr
        ? uniqueDates.filter((d) => d <= endDateStr)
        : uniqueDates;

      // Create assignments — applying the adoption rule per date.
      const createdAssignmentIds: string[] = [];
      for (const iso of eligibleDates) {
        const scheduled = parseDayString(iso);
        // Skip dates that already have an active assignment (idempotent).
        const existing = await tx.taskAssignment.findFirst({
          where: {
            taskId,
            scheduledDate: scheduled,
            status: { in: ['scheduled', 'completed'] },
          },
          select: { id: true },
        });
        if (existing) continue;
        const initial = await this.sync.computeInitialAssignmentState(taskId!, scheduled, tx);
        const row = await tx.taskAssignment.create({
          data: {
            taskId: taskId!,
            participantId: args.participantId,
            scheduledDate: scheduled,
            isCompleted: initial.isCompleted,
            status: initial.status,
            completedAt: initial.completedAt,
          },
        });
        createdAssignmentIds.push(row.id);
      }

      // Phase 4: scope='recurring' — also write PlanTask.recurrenceWeekdays
      // so future weeks auto-materialize via the existing materializer.
      // Derived from picked dates' weekdays. Overwrites any prior recurrence
      // setting (the user just made an explicit choice).
      if (args.dto.scope === 'recurring') {
        const weekdaySet = new Set<number>();
        for (const iso of eligibleDates) {
          weekdaySet.add(parseDayString(iso).getUTCDay());
        }
        if (weekdaySet.size > 0) {
          const csv = [...weekdaySet].sort((a, b) => a - b).join(',');
          await tx.planTask.update({
            where: { id: taskId! },
            data: { recurrenceWeekdays: csv },
          });
        }
      }

      return { linkedPlanTaskId: taskId!, createdAssignmentIds };
    });
  }

  async adminReorderItems(projectId: string, items: ReorderItemDto[]) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');
    // Verify every id belongs to this project before mutating (prevents
    // reorder calls from moving an item between projects via a stale payload).
    const existing = await this.prisma.projectItem.findMany({
      where: { projectId, id: { in: items.map((i) => i.id) } },
      select: { id: true },
    });
    if (existing.length !== items.length) {
      throw new BadRequestException('Some items do not belong to this project');
    }
    await Promise.all(
      items.map((i) =>
        this.prisma.projectItem.update({
          where: { id: i.id },
          data: { sortOrder: i.sortOrder },
        }),
      ),
    );
    return { ok: true };
  }

  async adminUpsertLog(itemId: string, participantId: string, dto: UpsertLogDto) {
    return this.upsertLog({ itemId, participantId, dto, editedByRole: 'admin', restrictToRecentDays: false });
  }

  // Clear a (item, logDate) row — returns to the default "no log = not
  // completed" state. Idempotent: deleting a missing row is not an error.
  async adminDeleteLog(itemId: string, participantId: string, logDate: string) {
    return this.deleteLog({
      itemId, participantId, logDate, restrictToRecentDays: false,
    });
  }

  async adminCreateNote(projectId: string, participantId: string, dto: CreateNoteDto) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');
    return this.prisma.projectNote.create({
      data: {
        projectId,
        participantId,
        content: dto.content,
        authorRole: 'admin',
      },
    });
  }

  // ── Participant permission + portal CRUD ───────────────────────────────────

  async setManagePermission(participantId: string, value: boolean) {
    const p = await this.prisma.participant.findUnique({ where: { id: participantId } });
    if (!p) throw new NotFoundException('Participant not found');
    return this.prisma.participant.update({
      where: { id: participantId },
      data: { canManageProjects: value },
    });
  }

  async portalBootstrap(token: string) {
    const me = await this.resolveToken(token);
    // Portal view window: today + yesterday. Older days are read-only in Phase 1
    // so we don't need them to render the UI. Single call keeps the portal
    // snappy on mobile.
    const fromStr = yesterdayInIsrael();
    const toStr = todayInIsrael();
    const fromDate = parseDayString(fromStr);
    const toDate = parseDayString(toStr);
    const projects = await this.listProjectsForParticipant(me.id, {
      fromDate,
      toDate,
      // Portal hides fully cancelled projects. Archived items inside an active
      // project are still returned with isArchived=true so the UI can filter.
      includeArchived: false,
    });
    const notes = await this.loadNotes(projects.map((p) => p.id));
    const linkableTasks = await this.sync.listLinkableTasks(me.id);
    const scheduledKeys = await this.computeScheduledKeys(projects, fromDate, toDate);
    const schedulingStatus = await this.buildSchedulingStatusMap(projects);
    const dailyContext = await this.loadDailyContext(me.id, toStr);
    return {
      participant: {
        id: me.id,
        firstName: me.firstName,
        lastName: me.lastName,
        canManageProjects: me.canManageProjects,
      },
      today: toStr,
      yesterday: fromStr,
      projects,
      notes,
      // Phase 2: list of tasks the participant can link a boolean goal to.
      linkableTasks,
      // Phase 2: "itemId|YYYY-MM-DD" keys where a linked task has an ACTIVE
      // assignment. Used to drive the "לא נקבע להיום בלו״ז" hint.
      scheduledKeys,
      // Phase 3: per-item scheduling status for the current week. Keyed by
      // item id. Missing entries = goal has no schedule config (frequencyType='none').
      schedulingStatus,
      // Daily Context: today's self-report. Always present with sensible
      // defaults so the UI can render chips without a second fetch.
      dailyContext,
    };
  }

  // ── Daily Context ──────────────────────────────────────────────────────────
  //
  // One row per (participantId, logDate). Returns the row or a zero-value
  // fallback — never null — so the portal can render the panel unconditionally.
  private async loadDailyContext(participantId: string, logDateStr: string) {
    const logDate = parseDayString(logDateStr);
    const row = await this.prisma.dailyContextLog.findUnique({
      where: { participantId_logDate: { participantId, logDate } },
    });
    return {
      logDate: logDateStr,
      hasPeriod: row?.hasPeriod ?? false,
      cravings: row?.cravings ?? [],
      states: row?.states ?? [],
      note: row?.note ?? null,
    };
  }

  async portalUpsertDailyContext(token: string, dto: UpsertDailyContextDto) {
    const me = await this.resolveToken(token);
    const logDate = parseDayString(dto.logDate);
    // Only include fields the client actually sent so partial updates don't
    // wipe other columns. Prisma requires the full set on CREATE, so the
    // defaults in the create branch fill the gaps.
    const createData: Prisma.DailyContextLogCreateInput = {
      participant: { connect: { id: me.id } },
      logDate,
      hasPeriod: dto.hasPeriod ?? false,
      cravings: dto.cravings ?? [],
      states: dto.states ?? [],
      note: dto.note ?? null,
    };
    const updateData: Prisma.DailyContextLogUpdateInput = {};
    if (dto.hasPeriod !== undefined) updateData.hasPeriod = dto.hasPeriod;
    if (dto.cravings !== undefined) updateData.cravings = { set: dto.cravings };
    if (dto.states !== undefined) updateData.states = { set: dto.states };
    if (dto.note !== undefined) updateData.note = dto.note;

    const row = await this.prisma.dailyContextLog.upsert({
      where: { participantId_logDate: { participantId: me.id, logDate } },
      create: createData,
      update: updateData,
    });
    return {
      logDate: dto.logDate,
      hasPeriod: row.hasPeriod,
      cravings: row.cravings,
      states: row.states,
      note: row.note,
    };
  }

  private async requireCanManage(token: string) {
    const me = await this.resolveToken(token);
    if (!me.canManageProjects) {
      throw new ForbiddenException('Participant cannot manage projects');
    }
    return me;
  }

  async portalCreateProject(token: string, dto: CreateProjectDto) {
    const me = await this.requireCanManage(token);
    return this.prisma.project.create({
      data: {
        participantId: me.id,
        title: dto.title,
        description: dto.description ?? null,
        colorHex: dto.colorHex ?? null,
        createdByRole: 'participant',
      },
    });
  }

  async portalUpdateProject(token: string, projectId: string, dto: UpdateProjectDto) {
    const me = await this.requireCanManage(token);
    await this.assertOwnership(me.id, { projectId });
    return this.adminUpdateProject(projectId, dto);
  }

  async portalCreateItem(token: string, projectId: string, dto: CreateItemDto) {
    const me = await this.requireCanManage(token);
    await this.assertOwnership(me.id, { projectId });
    return this.adminCreateItem(projectId, dto);
  }

  async portalUpdateItem(token: string, itemId: string, dto: UpdateItemDto) {
    const me = await this.requireCanManage(token);
    await this.assertOwnership(me.id, { itemId });
    return this.adminUpdateItem(itemId, dto);
  }

  async portalArchiveItem(token: string, itemId: string) {
    const me = await this.requireCanManage(token);
    await this.assertOwnership(me.id, { itemId });
    return this.adminArchiveItem(itemId);
  }

  async portalReorderItems(token: string, projectId: string, items: ReorderItemDto[]) {
    const me = await this.requireCanManage(token);
    await this.assertOwnership(me.id, { projectId });
    return this.adminReorderItems(projectId, items);
  }

  async portalUpsertLog(token: string, itemId: string, dto: UpsertLogDto) {
    // Log write does NOT require canManageProjects — any participant with a
    // project assigned to them can log values.
    const me = await this.resolveToken(token);
    await this.assertOwnership(me.id, { itemId });
    return this.upsertLog({
      itemId,
      participantId: me.id,
      dto,
      editedByRole: 'participant',
      restrictToRecentDays: true,
    });
  }

  // Participant clears a (item, logDate) row — used for reversible-completed
  // UX. Same today/yesterday window as upsert. Clearing = returning to the
  // implicit "not completed" default.
  async portalDeleteLog(token: string, itemId: string, logDate: string) {
    const me = await this.resolveToken(token);
    await this.assertOwnership(me.id, { itemId });
    return this.deleteLog({
      itemId,
      participantId: me.id,
      logDate,
      restrictToRecentDays: true,
    });
  }

  async portalScheduleItemWeek(token: string, itemId: string, dto: ScheduleItemDto) {
    const me = await this.resolveToken(token);
    await this.assertOwnership(me.id, { itemId });
    return this.scheduleItemWeek({
      itemId,
      participantId: me.id,
      dto,
      requireCanManageForTaskCreation: true,
    });
  }

  async portalCreateNote(token: string, projectId: string, dto: CreateNoteDto) {
    const me = await this.resolveToken(token);
    await this.assertOwnership(me.id, { projectId });
    return this.prisma.projectNote.create({
      data: {
        projectId,
        participantId: me.id,
        content: dto.content,
        authorRole: 'participant',
      },
    });
  }

  // ── Shared log upsert (admin and portal both land here) ────────────────────
  // One row per (itemId, logDate). Upsert semantics mean repeat submissions
  // collapse into the same row. restrictToRecentDays=true limits mutations to
  // today/yesterday (participant side); admin side has no date restriction.
  private async upsertLog(args: {
    itemId: string;
    participantId: string;
    dto: UpsertLogDto;
    editedByRole: 'admin' | 'participant';
    restrictToRecentDays: boolean;
  }) {
    const { itemId, participantId, dto, editedByRole, restrictToRecentDays } = args;

    const item = await this.prisma.projectItem.findUnique({
      where: { id: itemId },
      select: {
        id: true,
        itemType: true,
        targetValue: true,
        selectOptionsJson: true,
        isArchived: true,
        createdAt: true,
        project: { select: { participantId: true, status: true } },
      },
    });
    if (!item) throw new NotFoundException('Item not found');
    if (item.project.participantId !== participantId) throw new ForbiddenException();
    if (item.isArchived) throw new BadRequestException('Item is archived');
    if (item.project.status === 'cancelled') {
      throw new BadRequestException('Project is cancelled');
    }

    const logDate = parseDayString(dto.logDate);
    if (restrictToRecentDays) {
      const allowed = new Set([todayInIsrael(), yesterdayInIsrael()]);
      if (!allowed.has(dto.logDate)) {
        throw new BadRequestException('Participants can only log today or yesterday');
      }
    }

    // Guard: logs cannot predate the item (the "expected occurrences begin
    // from the item's creation date" rule). We use the item's createdAt to
    // clamp, rounded down to the civil day in Asia/Jerusalem.
    const itemCreatedDay = (() => {
      const iso = new Intl.DateTimeFormat('en-CA', {
        timeZone: ISRAEL_TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(item.createdAt);
      return iso;
    })();
    if (dto.logDate < itemCreatedDay) {
      throw new BadRequestException('Cannot log before the item was created');
    }

    const resolved = this.validateLogForItem(item, dto);

    // Wrap the log write + cross-surface sync in a single transaction so the
    // invariant `goal.completed ⟺ task.completed` can never be observed in a
    // half-applied state by a concurrent reader.
    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.projectItemLog.findUnique({
        where: { itemId_logDate: { itemId, logDate } },
      });

      const row = existing
        ? await tx.projectItemLog.update({
            where: { id: existing.id },
            data: {
              status: resolved.status,
              numericValue: resolved.numericValue,
              selectValue: resolved.selectValue,
              skipNote: dto.status === 'skipped_today' ? dto.skipNote ?? null : null,
              commitNote: dto.status === 'committed' ? dto.commitNote ?? null : null,
              editedAt: new Date(),
              editedByRole,
              // syncSource stays 'direct' for user-facing writes — the sync
              // service writes the 'task' value via its own direct path.
              syncSource: 'direct',
            },
          })
        : await tx.projectItemLog.create({
            data: {
              itemId,
              participantId,
              logDate,
              status: resolved.status,
              numericValue: resolved.numericValue,
              selectValue: resolved.selectValue,
              skipNote: dto.status === 'skipped_today' ? dto.skipNote ?? null : null,
              commitNote: dto.status === 'committed' ? dto.commitNote ?? null : null,
              editedByRole,
              syncSource: 'direct',
            },
          });

      // Mirror into the linked TaskAssignment (if any). "completed" drives the
      // bool — other statuses (skipped/committed/value-below-target) leave the
      // task in whatever state it's in.
      const targetCompleted = row.status === 'completed';
      await this.sync.syncFromProject(itemId, logDate, targetCompleted, tx);
      return row;
    });

    return result;
  }

  // Shared delete helper — clears a (item, logDate) log. Idempotent:
  // deleting a row that doesn't exist is treated as success. Enforces
  // ownership by checking the item → project → participantId chain so a
  // portal caller can't delete another participant's logs.
  private async deleteLog(args: {
    itemId: string;
    participantId: string;
    logDate: string;
    restrictToRecentDays: boolean;
  }) {
    const { itemId, participantId, logDate: logDateStr, restrictToRecentDays } = args;

    const item = await this.prisma.projectItem.findUnique({
      where: { id: itemId },
      select: { project: { select: { participantId: true } } },
    });
    if (!item) throw new NotFoundException('Item not found');
    if (item.project.participantId !== participantId) throw new ForbiddenException();

    if (restrictToRecentDays) {
      const allowed = new Set([todayInIsrael(), yesterdayInIsrael()]);
      if (!allowed.has(logDateStr)) {
        throw new BadRequestException('Participants can only clear today or yesterday');
      }
    }

    const logDate = parseDayString(logDateStr);
    // Transactional: clear the log AND mirror-uncomplete the linked
    // assignment, so the invariant holds for concurrent readers.
    await this.prisma.$transaction(async (tx) => {
      await tx.projectItemLog.deleteMany({ where: { itemId, logDate } });
      await this.sync.syncFromProject(itemId, logDate, false, tx);
    });
    return { ok: true };
  }
}
