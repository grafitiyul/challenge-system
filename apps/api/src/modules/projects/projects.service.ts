import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateItemDto,
  CreateNoteDto,
  CreateProjectDto,
  PROJECT_ITEM_TYPES,
  PROJECT_LOG_STATUSES,
  ProjectItemType,
  ReorderItemDto,
  UpdateItemDto,
  UpdateProjectDto,
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
  constructor(private readonly prisma: PrismaService) {}

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
    return { projects, notes };
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

  async adminCreateItem(projectId: string, dto: CreateItemDto) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');
    if (!PROJECT_ITEM_TYPES.includes(dto.itemType)) {
      throw new BadRequestException(`Unsupported itemType ${dto.itemType}`);
    }
    this.validateItemShape(dto.itemType, dto);
    const count = await this.prisma.projectItem.count({ where: { projectId } });
    return this.prisma.projectItem.create({
      data: {
        projectId,
        title: dto.title,
        itemType: dto.itemType,
        unit: dto.unit ?? null,
        targetValue: dto.targetValue ?? null,
        selectOptionsJson: (dto.selectOptions ?? null) as unknown as Prisma.InputJsonValue,
        sortOrder: count,
      },
    });
  }

  async adminUpdateItem(itemId: string, dto: UpdateItemDto) {
    const existing = await this.prisma.projectItem.findUnique({ where: { id: itemId } });
    if (!existing) throw new NotFoundException('Item not found');
    if (dto.selectOptions !== undefined && existing.itemType === 'select') {
      if (dto.selectOptions.length === 0) {
        throw new BadRequestException('select items require at least one option');
      }
    }
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
      },
    });
  }

  async adminArchiveItem(itemId: string) {
    const existing = await this.prisma.projectItem.findUnique({ where: { id: itemId } });
    if (!existing) throw new NotFoundException('Item not found');
    return this.prisma.projectItem.update({
      where: { id: itemId },
      data: { isArchived: true },
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

    const existing = await this.prisma.projectItemLog.findUnique({
      where: { itemId_logDate: { itemId, logDate } },
    });

    if (existing) {
      return this.prisma.projectItemLog.update({
        where: { id: existing.id },
        data: {
          status: resolved.status,
          numericValue: resolved.numericValue,
          selectValue: resolved.selectValue,
          skipNote: dto.status === 'skipped_today' ? dto.skipNote ?? null : null,
          commitNote: dto.status === 'committed' ? dto.commitNote ?? null : null,
          editedAt: new Date(),
          editedByRole,
        },
      });
    }

    return this.prisma.projectItemLog.create({
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
      },
    });
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
    await this.prisma.projectItemLog.deleteMany({ where: { itemId, logDate } });
    return { ok: true };
  }
}
