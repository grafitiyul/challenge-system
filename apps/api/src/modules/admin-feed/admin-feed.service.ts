import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GameEngineService } from '../game-engine/game-engine.service';

// Admin-side full feed view. No time window, no isPublic filter — the
// whole point is to give admins visibility into hidden / superseded /
// debug events that the participant portal deliberately hides.
//
// Returns a denormalised row shape so the admin UI doesn't have to
// chase relations: participant + group + program + log basics travel
// inline. Capped at a generous 1000 rows per page to avoid runaway
// requests; the page param walks older pages via skip.

export interface AdminFeedRow {
  id: string;
  type: string;
  message: string;
  points: number;
  isPublic: boolean;
  createdAt: string;
  logId: string | null;
  // Phase 8.2 — when logId is set, attach the action-log context the
  // edit modal needs to pre-fill the value field. Null when the feed
  // event isn't linked to a log (rare but possible: rule events,
  // legacy rows, future system messages).
  log: {
    id: string;
    value: string;
    status: string;        // 'active' | 'superseded' | 'voided'
    actionName: string;
    actionInputType: string | null;
  } | null;
  participant: { id: string; firstName: string; lastName: string | null } | null;
  group: { id: string; name: string } | null;
  program: { id: string; name: string } | null;
}

export interface ListFeedOpts {
  participantId?: string;
  groupId?: string;
  programId?: string;
  // "all" (default) | "public" | "hidden" — admin-side filter for the
  // isPublic column so they can isolate the "things participants
  // actually saw" vs "things hidden by void/edit".
  visibility?: 'all' | 'public' | 'hidden';
  type?: string;
  // Phase: action-specific filter. Resolved by joining FeedEvent.logId
  // through UserActionLog.actionId (no Prisma relation declared, so
  // we do the join manually below). When set, ONLY log-linked rows
  // for that action are returned — system / rule events are excluded
  // because they aren't "for" a specific action.
  actionId?: string;
  skip?: number;
  take?: number;
}

export interface AdminFeedActionOption {
  id: string;
  name: string;
  programId: string;
  programName: string;
  isActive: boolean;
}

// Generous defaults for the admin audit surface. Page size is also
// admin-selectable in the UI; MAX_TAKE only protects against a
// pathological direct API call.
const DEFAULT_TAKE = 500;
const MAX_TAKE = 2000;

export interface AdminFeedPage {
  rows: AdminFeedRow[];
  total: number;       // total rows matching the filter (no pagination)
  skip: number;        // echoed back so the UI can compute "X-Y of Z"
  take: number;        // applied page size after clamping
  hasMore: boolean;    // skip + rows.length < total
}

@Injectable()
export class AdminFeedService {
  constructor(
    private readonly prisma: PrismaService,
    // Re-using the existing scoring engine (voidLog / correctLog) is
    // intentional — it keeps the score ledger, multi-group fan-out
    // compensation, FeedEvent isPublic flips, and threshold-rule
    // recompute in lockstep with how participants edit their own logs.
    // Adding a parallel admin-only delete path would invariably drift.
    private readonly gameEngine: GameEngineService,
  ) {}

  async list(opts: ListFeedOpts = {}): Promise<AdminFeedPage> {
    // Action filter — resolve to a logId set first. FeedEvent.logId has
    // no Prisma relation declared (legacy reasons), so we can't write
    // `where: { log: { actionId } }`. Two-step is cheap: actions
    // typically have at most a few thousand logs, well within the
    // Postgres IN-list comfort zone. When the action has zero logs
    // we short-circuit to an empty page so the count query doesn't
    // run a wasted scan.
    const take = Math.min(opts.take ?? DEFAULT_TAKE, MAX_TAKE);
    const skip = Math.max(opts.skip ?? 0, 0);

    let logIdConstraint: string[] | null = null;
    if (opts.actionId) {
      const matchingLogs = await this.prisma.userActionLog.findMany({
        where: {
          actionId: opts.actionId,
          // Narrow further by program if the admin already has program
          // filter set — keeps the IN-list smaller.
          ...(opts.programId ? { programId: opts.programId } : {}),
        },
        select: { id: true },
      });
      logIdConstraint = matchingLogs.map((l) => l.id);
      if (logIdConstraint.length === 0) {
        return { rows: [], total: 0, skip, take, hasMore: false };
      }
    }

    const where: Prisma.FeedEventWhereInput = {
      ...(opts.participantId ? { participantId: opts.participantId } : {}),
      ...(opts.groupId ? { groupId: opts.groupId } : {}),
      ...(opts.programId ? { programId: opts.programId } : {}),
      ...(opts.type ? { type: opts.type } : {}),
      ...(opts.visibility === 'public' ? { isPublic: true } :
          opts.visibility === 'hidden' ? { isPublic: false } : {}),
      ...(logIdConstraint ? { logId: { in: logIdConstraint } } : {}),
    };

    // Run page query + total count in parallel so the UI can render
    // explicit pagination ("מציג 1-500 מתוך 2347") instead of guessing
    // when more rows exist by checking if the page came back full.
    const [rows, total] = await Promise.all([
      this.prisma.feedEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          participant: { select: { id: true, firstName: true, lastName: true } },
          group: { select: { id: true, name: true } },
          program: { select: { id: true, name: true } },
        },
      }),
      this.prisma.feedEvent.count({ where }),
    ]);

    // Fetch UserActionLog context for log-linked rows. There's no FK
    // declared on FeedEvent.logId so we batch-resolve by id. Used by
    // the admin edit modal to pre-fill the current value and decide
    // which input type to show (number vs text).
    const logIds = Array.from(new Set(
      rows.map((r) => r.logId).filter((x): x is string => !!x),
    ));
    const logs = logIds.length === 0
      ? []
      : await this.prisma.userActionLog.findMany({
          where: { id: { in: logIds } },
          select: {
            id: true,
            value: true,
            status: true,
            action: { select: { name: true, inputType: true } },
          },
        });
    const logMap = new Map(logs.map((l) => [l.id, l]));

    return {
      rows: rows.map((r) => {
        const log = r.logId ? logMap.get(r.logId) ?? null : null;
        return {
          id: r.id,
          type: r.type,
          message: r.message,
          points: r.points,
          isPublic: r.isPublic,
          createdAt: r.createdAt.toISOString(),
          logId: r.logId,
          log: log
            ? {
                id: log.id,
                value: log.value,
                status: log.status,
                actionName: log.action.name,
                actionInputType: log.action.inputType ?? null,
              }
            : null,
          participant: r.participant
            ? { id: r.participant.id, firstName: r.participant.firstName, lastName: r.participant.lastName ?? null }
            : null,
          group: r.group ? { id: r.group.id, name: r.group.name } : null,
          program: r.program ? { id: r.program.id, name: r.program.name } : null,
        };
      }),
      total,
      skip,
      take,
      hasMore: skip + rows.length < total,
    };
  }

  // ── Filter options ─────────────────────────────────────────────────────────
  // Powers the "פעולה" dropdown in the admin feed. Returns ALL game
  // actions across ALL programs — including inactive ones — so the
  // admin can filter on actions that have been disabled but still
  // have historical logs in the feed. Sorted by program name then
  // action name so the dropdown lands in a stable order.
  async listActionsForFilter(): Promise<AdminFeedActionOption[]> {
    const actions = await this.prisma.gameAction.findMany({
      select: {
        id: true,
        name: true,
        isActive: true,
        program: { select: { id: true, name: true } },
      },
      orderBy: [
        { program: { name: 'asc' } },
        { name: 'asc' },
      ],
    });
    return actions.map((a) => ({
      id: a.id,
      name: a.name,
      programId: a.program.id,
      programName: a.program.name,
      isActive: a.isActive,
    }));
  }

  // ── Row-level admin actions ────────────────────────────────────────────────
  //
  // Both paths route log-linked rows through the existing scoring
  // engine (voidLog / correctLog) so the participant portal,
  // leaderboards, multi-group fan-out compensation, and threshold-rule
  // cascades all stay consistent. Standalone feed rows (no logId) only
  // touch the FeedEvent itself — there's no score ledger entry to
  // unwind for them.

  // Returns a small shape so the controller can tell the frontend
  // whether scoring was affected (so the admin UI can refresh context).
  async voidByFeedEventId(id: string): Promise<{ mode: 'log_voided' | 'feed_hidden'; logId: string | null }> {
    const ev = await this.prisma.feedEvent.findUnique({
      where: { id },
      select: { id: true, logId: true, isPublic: true },
    });
    if (!ev) throw new NotFoundException(`FeedEvent ${id} not found`);

    if (ev.logId) {
      // Idempotent: if the log was already voided, don't re-call (the
      // engine throws on non-active logs). We just confirm the feed
      // row is hidden and return.
      const log = await this.prisma.userActionLog.findUnique({
        where: { id: ev.logId },
        select: { status: true },
      });
      if (log?.status === 'active') {
        await this.gameEngine.voidLog({ logId: ev.logId, actorRole: 'admin' });
      } else if (ev.isPublic) {
        // Log already inactive but this particular feed row is somehow
        // still public — flip it. Should be rare; covers pre-fan-out
        // legacy rows.
        await this.prisma.feedEvent.update({
          where: { id: ev.id },
          data: { isPublic: false },
        });
      }
      return { mode: 'log_voided', logId: ev.logId };
    }

    // Standalone feed row — feed-only hide.
    await this.prisma.feedEvent.update({
      where: { id: ev.id },
      data: { isPublic: false },
    });
    return { mode: 'feed_hidden', logId: null };
  }

  async editByFeedEventId(
    id: string,
    dto: { value?: string; message?: string; isPublic?: boolean },
  ): Promise<{ mode: 'log_corrected' | 'feed_edited'; logId: string | null }> {
    const ev = await this.prisma.feedEvent.findUnique({
      where: { id },
      select: { id: true, logId: true },
    });
    if (!ev) throw new NotFoundException(`FeedEvent ${id} not found`);

    if (ev.logId) {
      // Log-linked row — must use correctLog for value changes.
      // Reject pure-text edits on log-linked rows because letting
      // admin re-write the message without recomputing points would
      // create an audit trail that lies about the underlying log.
      if (dto.value === undefined) {
        throw new BadRequestException(
          'שורה זו מקושרת ללוג פעולה — חובה לעדכן את הערך כדי להשפיע על הניקוד. עריכת טקסט בלבד אינה אפשרית.',
        );
      }
      await this.gameEngine.correctLog({
        logId: ev.logId,
        value: dto.value,
        actorRole: 'admin',
      });
      return { mode: 'log_corrected', logId: ev.logId };
    }

    // Standalone feed row — message + isPublic are the only knobs.
    if (dto.message === undefined && dto.isPublic === undefined) {
      throw new BadRequestException('יש לציין message או isPublic.');
    }
    await this.prisma.feedEvent.update({
      where: { id: ev.id },
      data: {
        ...(dto.message !== undefined ? { message: dto.message } : {}),
        ...(dto.isPublic !== undefined ? { isPublic: dto.isPublic } : {}),
      },
    });
    return { mode: 'feed_edited', logId: null };
  }
}
