import { createHmac } from 'crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GameEngineService, resolveEffectiveContextSchema } from './game-engine.service';

const DAY_MS = 86_400_000;

/** UTC start-of-day for the given date. Used for bucket boundaries in analytics. */
function startOfDayUTC(d: Date): Date {
  const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  return utc;
}

/**
 * Remove dimensions the participant should never see or fill.
 * Hidden if EITHER:
 *   - `visibleToParticipant === false` (Phase 3.1), OR
 *   - `inputMode !== 'participant'` (Phase 3.3 — system_fixed dimensions are
 *     entirely backend-owned).
 *
 * Strips internal-only metadata (`visibleToParticipant`, `inputMode`,
 * `analyticsVisible`, `fixedValue`) from the output so the participant never
 * receives behavior flags that don't concern her.
 *
 * Returns `null` if the resulting dimensions array is empty (the participant
 * UI treats `null` as "no context prompt at all").
 */
function stripHiddenDimensions(
  raw: unknown,
): Record<string, unknown> | null {
  if (raw === null || raw === undefined || typeof raw !== 'object') return null;
  const dims = (raw as { dimensions?: unknown }).dimensions;
  if (!Array.isArray(dims)) return null;
  const visible = dims
    .filter((d): d is Record<string, unknown> => {
      if (!d || typeof d !== 'object') return false;
      const v = d as {
        visibleToParticipant?: boolean;
        inputMode?: string;
      };
      if (v.visibleToParticipant === false) return false;
      if (v.inputMode && v.inputMode !== 'participant') return false;
      return true;
    })
    .map((d) => {
      const rest = { ...(d as Record<string, unknown>) };
      delete rest.visibleToParticipant;
      delete rest.inputMode;
      delete rest.analyticsVisible;
      delete rest.fixedValue;
      return rest;
    });
  if (visible.length === 0) return null;
  return { dimensions: visible };
}

/**
 * Resolve an inclusive UTC [sinceMidnight, untilEndOfDay] window from caller options.
 *
 * Precedence:
 *   1. If from + to provided → use them after validation.
 *   2. If days provided → last N days inclusive of today.
 *   3. If period provided → 7d/14d/30d windows or open-ended "all".
 *   4. Fallback → last 14 days.
 *
 * Throws BadRequestException on:
 *   - malformed dates
 *   - from > to
 *   - to in the future
 */
function resolveRange(opts: {
  days?: number;
  period?: '7d' | '14d' | '30d' | 'all';
  from?: string;
  to?: string;
}): { since: Date | null; until: Date } {
  const now = new Date();
  const todayEnd = startOfDayUTC(now);
  todayEnd.setUTCHours(23, 59, 59, 999);

  if (opts.from !== undefined || opts.to !== undefined) {
    if (!opts.from || !opts.to) {
      throw new BadRequestException('from and to must both be provided together');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.from) || !/^\d{4}-\d{2}-\d{2}$/.test(opts.to)) {
      throw new BadRequestException('from/to must be YYYY-MM-DD');
    }
    const since = new Date(`${opts.from}T00:00:00.000Z`);
    const until = new Date(`${opts.to}T00:00:00.000Z`);
    if (isNaN(since.getTime()) || isNaN(until.getTime())) {
      throw new BadRequestException('from/to are invalid dates');
    }
    until.setUTCHours(23, 59, 59, 999);
    if (since.getTime() > until.getTime()) {
      throw new BadRequestException('from must be <= to');
    }
    if (until.getTime() > todayEnd.getTime()) {
      throw new BadRequestException('to cannot be in the future');
    }
    return { since, until };
  }

  if (opts.days !== undefined) {
    if (![7, 14, 30].includes(opts.days)) {
      throw new BadRequestException('days must be 7, 14, or 30');
    }
    const since = startOfDayUTC(now);
    since.setUTCDate(since.getUTCDate() - (opts.days - 1));
    return { since, until: todayEnd };
  }

  if (opts.period !== undefined) {
    if (!['7d', '14d', '30d', 'all'].includes(opts.period)) {
      throw new BadRequestException('period must be 7d, 14d, 30d, or all');
    }
    if (opts.period === 'all') return { since: null, until: todayEnd };
    const days = opts.period === '7d' ? 7 : opts.period === '14d' ? 14 : 30;
    const since = startOfDayUTC(now);
    since.setUTCDate(since.getUTCDate() - (days - 1));
    return { since, until: todayEnd };
  }

  // Default: last 14 days.
  const since = startOfDayUTC(now);
  since.setUTCDate(since.getUTCDate() - 13);
  return { since, until: todayEnd };
}

export interface PortalContext {
  participant: { id: string; firstName: string; lastName: string | null };
  group: { id: string; name: string; startDate: Date | null; endDate: Date | null };
  program: { id: string; name: string; isActive: boolean };
  // Portal opening gate — both null means always open (backward compatible)
  // UTC ISO strings; frontend resolves state A/B/C purely by comparing now() to these values
  portalCallTime: string | null;
  portalOpenTime: string | null;
  actions: {
    id: string;
    name: string;
    description: string | null;
    inputType: string | null;
    aggregationMode: string;
    unit: string | null;
    points: number;
    maxPerDay: number | null;
    /**
     * Phase 3: dimensions the participant must fill alongside this submission.
     * `null` (or missing `dimensions`) → action has no extra context. Backend
     * validates the captured values against this schema on submit.
     */
    contextSchemaJson: Record<string, unknown> | null;
    contextSchemaVersion: number;
  }[];
  todayScore: number;
  todayValues: Record<string, number>; // actionId → current daily value
}

export interface PortalStats {
  todayScore: number;
  weekScore: number;
  totalScore: number;
  currentStreak: number;
  bestStreak: number;
  dailyTrend: { date: string; points: number }[];
  groupLeaderboard: {
    participantId: string;
    firstName: string;
    lastName: string | null;
    totalScore: number;
    todayScore: number;
    rank: number;
    isMe: boolean;
  }[];
}

export interface PortalFeedItem {
  id: string;
  message: string;
  points: number;
  createdAt: string;
  participant: { id: string; firstName: string; lastName: string | null };
}

export interface PortalRules {
  programRulesContent: string | null;
  rulesPublished: boolean;
  actions: {
    id: string;
    name: string;
    description: string | null;
    explanationContent: string | null;
    points: number;
    inputType: string | null;
    unit: string | null;
    maxPerDay: number | null;
    aggregationMode: string;
  }[];
  rules: {
    id: string;
    name: string;
    type: string;
    conditionJson: unknown;
    rewardJson: unknown;
    isActive: boolean;
  }[];
}

// ─── Phase 2A analytics shapes ─────────────────────────────────────────────────
// Source of truth: ScoreEvent ledger + UserActionLog (for submission metadata).
// Nothing is cached — every call re-reads the ledger. No group/social data mixed in.

export interface AnalyticsSummary {
  totalScore: number;
  todayScore: number;
  yesterdayScore: number;
  /** todayScore - yesterdayScore. Negative when today is worse. */
  trendVsYesterday: number;
  currentStreak: number;
}

export interface AnalyticsTrendPoint {
  date: string;           // YYYY-MM-DD
  points: number;         // net sum of all ScoreEvents on that day
  submissionCount: number; // count of active UserActionLogs on that day
}

export interface AnalyticsDayEntry {
  logId: string;
  time: string;           // HH:MM (24h, UTC)
  actionId: string;
  actionName: string;
  rawValue: string;
  effectiveValue: number | null;
  contextJson: Record<string, unknown> | null;
  points: number;
}

export interface AnalyticsBreakdownEntry {
  actionId: string;
  actionName: string;
  totalPoints: number;
  count: number;
}

@Injectable()
export class ParticipantPortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gameEngine: GameEngineService,
  ) {}

  // ─── Resolve token → participant context ──────────────────────────────────

  async getContext(token: string, bypassSig?: string): Promise<PortalContext> {
    // Validate bypass sig (HMAC-SHA256 of the access token, first 24 hex chars)
    let bypass = false;
    if (bypassSig) {
      const secret = process.env.BYPASS_SECRET ?? 'challenge-bypass-dev-secret';
      const expected = createHmac('sha256', secret).update(token).digest('hex').slice(0, 24);
      bypass = bypassSig === expected;
    }
    const pg = await this.prisma.participantGroup.findUnique({
      where: { accessToken: token },
      include: {
        participant: {
          select: { id: true, firstName: true, lastName: true },
        },
        group: {
          include: {
            program: true,
            challenge: { select: { startDate: true, endDate: true } },
          },
          // portalCallTime + portalOpenTime are on Group — included via the relation above
        },
      },
    });

    if (!pg || !pg.isActive) throw new NotFoundException('הקישור אינו בתוקף');
    if (!pg.group.programId || !pg.group.program) throw new NotFoundException('לא נמצאה תוכנית');
    if (!pg.group.program.isActive) throw new BadRequestException('program_inactive');

    const programId = pg.group.programId;

    const actions = await this.prisma.gameAction.findMany({
      where: { programId, isActive: true, showInPortal: true },
      orderBy: { sortOrder: 'asc' },
    });

    // Phase 3.2: resolve the effective schema (reusable + local merged) for
    // each action in a single pass, then hand the merged schema to the
    // participant UI. Preserves the Phase 3.1 visibility strip on the way out.
    const effectiveSchemas = await Promise.all(
      actions.map((a) => resolveEffectiveContextSchema(this.prisma, a.id)),
    );

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const scoreAgg = await this.prisma.scoreEvent.aggregate({
      _sum: { points: true },
      where: { participantId: pg.participantId, programId, createdAt: { gte: todayStart } },
    });

    const todayValues: Record<string, number> = {};
    for (const action of actions) {
      if (action.inputType === 'number') {
        todayValues[action.id] = await this.getEffectiveDailyValue(
          pg.participantId, programId, action.id, todayStart, action.aggregationMode,
        );
      } else {
        todayValues[action.id] = await this.prisma.userActionLog.count({
          where: {
            participantId: pg.participantId,
            actionId: action.id,
            status: 'active',
            createdAt: { gte: todayStart },
          },
        });
      }
    }

    return {
      participant: pg.participant,
      group: {
        id: pg.group.id,
        name: pg.group.name,
        startDate: pg.group.startDate ?? pg.group.challenge.startDate,
        endDate: pg.group.endDate ?? pg.group.challenge.endDate,
      },
      program: {
        id: pg.group.program.id,
        name: pg.group.program.name,
        isActive: pg.group.program.isActive,
      },
      // bypass=true: return null times so the frontend skips the opening gate (admin preview only)
      portalCallTime: bypass ? null : (pg.group.portalCallTime ? pg.group.portalCallTime.toISOString() : null),
      portalOpenTime: bypass ? null : (pg.group.portalOpenTime ? pg.group.portalOpenTime.toISOString() : null),
      actions: actions.map((a, idx) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        inputType: a.inputType,
        aggregationMode: a.aggregationMode,
        unit: a.unit,
        points: a.points,
        maxPerDay: a.maxPerDay,
        // Phase 3.2: effective schema = reusable attachments + local dimensions.
        // Phase 3.1 hidden-strip applied on top.
        contextSchemaJson: stripHiddenDimensions(effectiveSchemas[idx]),
        contextSchemaVersion: a.contextSchemaVersion,
      })),
      todayScore: scoreAgg._sum.points ?? 0,
      todayValues,
    };
  }

  // ─── Log action ────────────────────────────────────────────────────────────

  async logAction(
    token: string,
    dto: { actionId: string; value?: string; contextJson?: Record<string, unknown> },
    idempotencyKey?: string,
  ): Promise<{ pointsEarned: number; todayScore: number; todayValue: number | null }> {
    const pg = await this.prisma.participantGroup.findUnique({
      where: { accessToken: token },
      include: { group: { select: { programId: true, id: true } } },
    });
    if (!pg || !pg.isActive) throw new NotFoundException('הקישור אינו בתוקף');
    if (!pg.group.programId) throw new NotFoundException('לא נמצאה תוכנית');

    const result = await this.gameEngine.logAction({
      participantId: pg.participantId,
      programId: pg.group.programId,
      groupId: pg.groupId,
      actionId: dto.actionId,
      value: dto.value,
      contextJson: dto.contextJson,
      clientSubmissionId: idempotencyKey,
    });

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const scoreAgg = await this.prisma.scoreEvent.aggregate({
      _sum: { points: true },
      where: { participantId: pg.participantId, programId: pg.group.programId, createdAt: { gte: todayStart } },
    });

    const action = await this.prisma.gameAction.findUnique({ where: { id: dto.actionId } });
    let todayValue: number | null = null;
    if (action) {
      if (action.inputType === 'number') {
        todayValue = await this.getEffectiveDailyValue(
          pg.participantId, pg.group.programId, dto.actionId, todayStart, action.aggregationMode,
        );
      } else {
        todayValue = await this.prisma.userActionLog.count({
          where: {
            participantId: pg.participantId,
            actionId: dto.actionId,
            status: 'active',
            createdAt: { gte: todayStart },
          },
        });
      }
    }

    // On an idempotent replay, result.scoreEvent may be null (the original rule
    // firings also already happened and are part of the stored total). The sum of
    // today's ScoreEvents is authoritative, so pointsEarned falls back to 0 for
    // replays — the caller sees the same todayScore as the original submission.
    const pointsEarned = result.scoreEvent
      ? result.scoreEvent.points +
        result.ruleResults.reduce(
          (sum: number, r: { fired: boolean; points?: number }) => sum + (r.fired ? (r.points ?? 0) : 0),
          0,
        )
      : 0;

    return {
      pointsEarned,
      todayScore: scoreAgg._sum.points ?? 0,
      todayValue,
    };
  }

  // ─── Stats tab ─────────────────────────────────────────────────────────────

  async getPortalStats(token: string): Promise<PortalStats> {
    const pg = await this.resolveToken(token);
    const { participantId, programId, groupId } = pg;

    const now = new Date();
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay()); weekStart.setHours(0, 0, 0, 0);

    // Personal scores + streak (computed live so it's always consistent with actual ScoreEvent data)
    const [todayAgg, weekAgg, totalAgg, streak] = await Promise.all([
      this.prisma.scoreEvent.aggregate({ _sum: { points: true }, where: { participantId, programId, createdAt: { gte: todayStart } } }),
      this.prisma.scoreEvent.aggregate({ _sum: { points: true }, where: { participantId, programId, createdAt: { gte: weekStart } } }),
      this.prisma.scoreEvent.aggregate({ _sum: { points: true }, where: { participantId, programId } }),
      this.gameEngine.getStreakLive(participantId, programId),
    ]);

    // 14-day daily trend
    const dailyTrend = await this.buildDailyTrend(participantId, programId, 14);

    // Group leaderboard
    const members = await this.prisma.participantGroup.findMany({
      where: { groupId, isActive: true },
      include: { participant: { select: { id: true, firstName: true, lastName: true } } },
    });

    const participantIds = members.map((m) => m.participantId);
    const memberTotals = await this.prisma.scoreEvent.groupBy({
      by: ['participantId'],
      where: { groupId, participantId: { in: participantIds } },
      _sum: { points: true },
    });
    const memberTodayTotals = await this.prisma.scoreEvent.groupBy({
      by: ['participantId'],
      where: { groupId, participantId: { in: participantIds }, createdAt: { gte: todayStart } },
      _sum: { points: true },
    });

    const totalsMap = Object.fromEntries(memberTotals.map((r) => [r.participantId, r._sum.points ?? 0]));
    const todayMap = Object.fromEntries(memberTodayTotals.map((r) => [r.participantId, r._sum.points ?? 0]));

    const leaderboard = members
      .map((m) => ({
        participantId: m.participantId,
        firstName: m.participant.firstName,
        lastName: m.participant.lastName ?? null,
        totalScore: totalsMap[m.participantId] ?? 0,
        todayScore: todayMap[m.participantId] ?? 0,
        isMe: m.participantId === participantId,
      }))
      .sort((a, b) => b.totalScore - a.totalScore)
      .map((r, i) => ({ ...r, rank: i + 1 }));

    return {
      todayScore: todayAgg._sum.points ?? 0,
      weekScore: weekAgg._sum.points ?? 0,
      totalScore: totalAgg._sum.points ?? 0,
      currentStreak: streak.currentStreak,
      bestStreak: streak.bestStreak,
      dailyTrend,
      groupLeaderboard: leaderboard,
    };
  }

  // ─── Feed tab ──────────────────────────────────────────────────────────────

  async getPortalFeed(token: string): Promise<PortalFeedItem[]> {
    const pg = await this.resolveToken(token);
    const events = await this.prisma.feedEvent.findMany({
      where: { groupId: pg.groupId, isPublic: true },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: {
        participant: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    return events.map((e) => ({
      id: e.id,
      message: e.message,
      points: e.points,
      createdAt: e.createdAt.toISOString(),
      participant: e.participant,
    }));
  }

  // ─── Rules tab ─────────────────────────────────────────────────────────────

  async getPortalRules(token: string): Promise<PortalRules> {
    const pg = await this.resolveToken(token);
    const { programId } = pg;

    const [program, actions, rules] = await Promise.all([
      this.prisma.program.findUnique({ where: { id: programId }, select: { rulesContent: true, rulesPublished: true } }),
      this.prisma.gameAction.findMany({
        where: { programId, isActive: true, showInPortal: true },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, name: true, description: true, explanationContent: true, points: true, inputType: true, unit: true, maxPerDay: true, aggregationMode: true },
      }),
      this.prisma.gameRule.findMany({
        where: { programId },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, name: true, type: true, conditionJson: true, rewardJson: true, isActive: true },
      }),
    ]);

    const published = program?.rulesPublished ?? false;
    return {
      programRulesContent: published ? (program?.rulesContent ?? null) : null,
      rulesPublished: published,
      actions,
      rules,
    };
  }

  // ─── Phase 2A: participant analytics ───────────────────────────────────────
  //
  // These endpoints are the new participant "My Data" surface. All four derive
  // strictly from ScoreEvent (for points/trends) and UserActionLog (for
  // submission metadata). No cached aggregates. No group/social data.

  async getAnalyticsSummary(token: string): Promise<AnalyticsSummary> {
    const { participantId, programId } = await this.resolveToken(token);

    const now = new Date();
    const todayStart = startOfDayUTC(now);
    const yesterdayStart = new Date(todayStart.getTime() - DAY_MS);

    const [totalAgg, todayAgg, yesterdayAgg, streak] = await Promise.all([
      this.prisma.scoreEvent.aggregate({
        _sum: { points: true },
        where: { participantId, programId },
      }),
      this.prisma.scoreEvent.aggregate({
        _sum: { points: true },
        where: { participantId, programId, createdAt: { gte: todayStart } },
      }),
      this.prisma.scoreEvent.aggregate({
        _sum: { points: true },
        where: {
          participantId, programId,
          createdAt: { gte: yesterdayStart, lt: todayStart },
        },
      }),
      this.gameEngine.getStreakLive(participantId, programId),
    ]);

    const todayScore = todayAgg._sum.points ?? 0;
    const yesterdayScore = yesterdayAgg._sum.points ?? 0;

    return {
      totalScore: totalAgg._sum.points ?? 0,
      todayScore,
      yesterdayScore,
      trendVsYesterday: todayScore - yesterdayScore,
      currentStreak: streak.currentStreak,
    };
  }

  async getAnalyticsTrend(
    token: string,
    opts: { days?: number; from?: string; to?: string },
  ): Promise<AnalyticsTrendPoint[]> {
    const { participantId, programId } = await this.resolveToken(token);
    const { since, until } = resolveRange({ days: opts.days, from: opts.from, to: opts.to });
    // Trend requires a concrete start — a bounded window makes no sense for "all".
    if (since === null) {
      throw new BadRequestException('trend requires days or from/to; "all" is not supported');
    }

    // Sum ALL ScoreEvent rows per day (action, rule, correction net out naturally).
    const events = await this.prisma.scoreEvent.findMany({
      where: {
        participantId, programId,
        createdAt: { gte: since, lte: until },
      },
      select: { points: true, createdAt: true },
    });
    const pointsByDay: Record<string, number> = {};
    for (const e of events) {
      const key = e.createdAt.toISOString().slice(0, 10);
      pointsByDay[key] = (pointsByDay[key] ?? 0) + e.points;
    }

    // Submission count = active UserActionLogs per day.
    const logs = await this.prisma.userActionLog.findMany({
      where: {
        participantId, programId,
        status: 'active',
        createdAt: { gte: since, lte: until },
      },
      select: { createdAt: true },
    });
    const countByDay: Record<string, number> = {};
    for (const l of logs) {
      const key = l.createdAt.toISOString().slice(0, 10);
      countByDay[key] = (countByDay[key] ?? 0) + 1;
    }

    // Dense fill oldest→newest (inclusive on both ends).
    const dayCount = Math.floor((startOfDayUTC(until).getTime() - since.getTime()) / DAY_MS) + 1;
    const out: AnalyticsTrendPoint[] = [];
    for (let i = 0; i < dayCount; i++) {
      const d = new Date(since.getTime() + i * DAY_MS);
      const key = d.toISOString().slice(0, 10);
      out.push({
        date: key,
        points: pointsByDay[key] ?? 0,
        submissionCount: countByDay[key] ?? 0,
      });
    }
    return out;
  }

  async getAnalyticsDay(token: string, date: string): Promise<AnalyticsDayEntry[]> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('date must be YYYY-MM-DD');
    }
    const { participantId, programId } = await this.resolveToken(token);

    const dayStart = new Date(`${date}T00:00:00.000Z`);
    if (isNaN(dayStart.getTime())) {
      throw new BadRequestException('date is invalid');
    }
    const dayEnd = new Date(dayStart.getTime() + DAY_MS);

    // Active logs for that day + their action's name + the linked action ScoreEvent.
    // ScoreEvent is the source of truth for points; the logId back-link is CHECK-enforced
    // so every active action log has exactly one action ScoreEvent.
    const logs = await this.prisma.userActionLog.findMany({
      where: {
        participantId, programId,
        status: 'active',
        createdAt: { gte: dayStart, lt: dayEnd },
      },
      orderBy: { createdAt: 'asc' },
      include: {
        action: { select: { id: true, name: true } },
      },
    });

    if (logs.length === 0) return [];

    const logIds = logs.map((l) => l.id);
    const scoreEvents = await this.prisma.scoreEvent.findMany({
      where: { logId: { in: logIds }, sourceType: 'action' },
      select: { logId: true, points: true },
    });
    const pointsByLog: Record<string, number> = {};
    for (const se of scoreEvents) {
      if (se.logId) pointsByLog[se.logId] = se.points;
    }

    return logs.map((l) => ({
      logId: l.id,
      time: l.createdAt.toISOString().slice(11, 16), // HH:MM
      actionId: l.action.id,
      actionName: l.action.name,
      rawValue: l.value,
      effectiveValue: l.effectiveValue !== null ? Number(l.effectiveValue) : null,
      contextJson: (l.contextJson as Record<string, unknown> | null) ?? null,
      points: pointsByLog[l.id] ?? 0,
    }));
  }

  async getAnalyticsBreakdown(
    token: string,
    opts: {
      period?: '7d' | '14d' | '30d' | 'all';
      from?: string;
      to?: string;
      /**
       * `action` (default) groups by actionId.
       * `context:<key>` groups by the given dimension value (label from contextSchema).
       */
      groupBy?: string;
    },
  ): Promise<AnalyticsBreakdownEntry[]> {
    const { participantId, programId } = await this.resolveToken(token);
    const { since, until } = resolveRange({
      period: opts.period,
      from: opts.from,
      to: opts.to,
    });

    const groupBy = opts.groupBy ?? 'action';
    if (groupBy.startsWith('context:')) {
      const key = groupBy.slice('context:'.length);
      if (!key) throw new BadRequestException('groupBy=context: requires a key');
      return this.breakdownByContext(participantId, programId, since, until, key);
    }
    if (groupBy !== 'action') {
      throw new BadRequestException('groupBy must be "action" or "context:<key>"');
    }

    // ── Group by actionId ────────────────────────────────────────────────
    // Sum ScoreEvents (action + correction net). Count active UserActionLogs.
    const whereScoreEvents: Prisma.ScoreEventWhereInput = {
      participantId, programId,
      sourceType: { in: ['action', 'correction'] },
      sourceId: { not: null },
      ...(since ? { createdAt: { gte: since, lte: until } } : { createdAt: { lte: until } }),
    };
    const grouped = await this.prisma.scoreEvent.groupBy({
      by: ['sourceId'],
      where: whereScoreEvents,
      _sum: { points: true },
    });

    const whereLogs: Prisma.UserActionLogWhereInput = {
      participantId, programId,
      status: 'active',
      ...(since ? { createdAt: { gte: since, lte: until } } : { createdAt: { lte: until } }),
    };
    const logsGrouped = await this.prisma.userActionLog.groupBy({
      by: ['actionId'],
      where: whereLogs,
      _count: { _all: true },
    });
    const countByAction: Record<string, number> = {};
    for (const g of logsGrouped) countByAction[g.actionId] = g._count._all;

    const actionIds = Array.from(
      new Set<string>([
        ...grouped.map((g) => g.sourceId).filter((id): id is string => !!id),
        ...logsGrouped.map((g) => g.actionId),
      ]),
    );
    if (actionIds.length === 0) return [];

    const actions = await this.prisma.gameAction.findMany({
      where: { id: { in: actionIds } },
      select: { id: true, name: true },
    });
    const nameById: Record<string, string> = Object.fromEntries(
      actions.map((a) => [a.id, a.name]),
    );

    const rows: AnalyticsBreakdownEntry[] = [];
    for (const actionId of actionIds) {
      const totalPoints =
        grouped.find((g) => g.sourceId === actionId)?._sum.points ?? 0;
      const count = countByAction[actionId] ?? 0;
      if (count === 0 && totalPoints === 0) continue;
      rows.push({
        actionId,
        actionName: nameById[actionId] ?? '(פעולה שנמחקה)',
        totalPoints,
        count,
      });
    }
    rows.sort((a, b) => b.totalPoints - a.totalPoints || b.count - a.count);
    return rows;
  }

  /**
   * Group points + counts by a single context dimension value.
   *
   * Only active UserActionLogs contribute. Corrections are intentionally NOT
   * merged in here because compensating ScoreEvents don't have a logId and
   * therefore cannot be attributed to a context value. Since the old log is
   * already marked superseded (excluded from the active filter), the net math
   * still works: old context's points are gone, new context's points appear.
   *
   * The `actionId` field on the response carries the raw dimension value, and
   * `actionName` carries the option label resolved from the action's
   * contextSchemaJson (or the raw value if no label is declared).
   */
  private async breakdownByContext(
    participantId: string,
    programId: string,
    since: Date | null,
    until: Date,
    dimensionKey: string,
  ): Promise<AnalyticsBreakdownEntry[]> {
    const logs = await this.prisma.userActionLog.findMany({
      where: {
        participantId, programId,
        status: 'active',
        ...(since ? { createdAt: { gte: since, lte: until } } : { createdAt: { lte: until } }),
      },
      select: { id: true, actionId: true, contextJson: true },
    });
    if (logs.length === 0) return [];

    // Points per log — action-type ScoreEvents only (corrections excluded above).
    const logIds = logs.map((l) => l.id);
    const scoreEvents = await this.prisma.scoreEvent.findMany({
      where: { logId: { in: logIds }, sourceType: 'action' },
      select: { logId: true, points: true },
    });
    const pointsByLog: Record<string, number> = {};
    for (const se of scoreEvents) {
      if (se.logId) pointsByLog[se.logId] = se.points;
    }

    // Phase 3.2: label resolution first tries the program-wide reusable
    // definition for this key (so the same dimension uses the same option
    // labels across every action that uses it), then falls back to whichever
    // action's local schema declares the key.
    const [definitionForKey, actionIds] = await Promise.all([
      this.prisma.contextDefinition.findFirst({
        where: { programId, key: dimensionKey },
        select: { optionsJson: true, type: true },
      }),
      Promise.resolve(Array.from(new Set(logs.map((l) => l.actionId)))),
    ]);
    const reusableLabels = new Map<string, string>();
    if (definitionForKey?.type === 'select' && Array.isArray(definitionForKey.optionsJson)) {
      for (const o of definitionForKey.optionsJson as Array<{ value?: string; label?: string }>) {
        if (typeof o?.value === 'string' && typeof o?.label === 'string') {
          reusableLabels.set(o.value, o.label);
        }
      }
    }

    const actions = await this.prisma.gameAction.findMany({
      where: { id: { in: actionIds } },
      select: { id: true, contextSchemaJson: true },
    });
    const localLabelsByAction = new Map<string, Map<string, string>>();
    for (const a of actions) {
      const schema = a.contextSchemaJson as {
        dimensions?: { key?: string; type?: string; options?: { value?: string; label?: string }[] }[];
      } | null;
      const perKey = new Map<string, string>();
      for (const d of schema?.dimensions ?? []) {
        if (d.key !== dimensionKey) continue;
        for (const o of d.options ?? []) {
          if (typeof o.value === 'string' && typeof o.label === 'string') perKey.set(o.value, o.label);
        }
      }
      localLabelsByAction.set(a.id, perKey);
    }

    function resolveLabel(actionId: string, value: string): string {
      return (
        reusableLabels.get(value) ??
        localLabelsByAction.get(actionId)?.get(value) ??
        value
      );
    }

    const totals: Record<string, { points: number; count: number; label: string }> = {};
    for (const l of logs) {
      const ctx = l.contextJson as Record<string, unknown> | null;
      if (!ctx) continue;
      const raw = ctx[dimensionKey];
      if (raw === undefined || raw === null || raw === '') continue;
      const value = String(raw);
      const label = resolveLabel(l.actionId, value);
      const entry = totals[value] ?? { points: 0, count: 0, label };
      entry.points += pointsByLog[l.id] ?? 0;
      entry.count += 1;
      if (entry.label === value && label !== value) entry.label = label;
      totals[value] = entry;
    }

    const rows: AnalyticsBreakdownEntry[] = Object.entries(totals).map(
      ([value, v]) => ({
        actionId: value,       // reused as "group key"
        actionName: v.label,   // reused as "group label"
        totalPoints: v.points,
        count: v.count,
      }),
    );
    rows.sort((a, b) => b.totalPoints - a.totalPoints || b.count - a.count);
    return rows;
  }

  /**
   * List context dimensions that appear in the participant's active log history.
   * Used by the frontend to decide whether the "group by context" toggle should
   * be shown at all, and what options to present.
   *
   * Only declared dimensions (from each action's contextSchemaJson) AND having
   * at least one active log with a non-empty value for that key are returned.
   */
  async getAnalyticsContextDimensions(
    token: string,
  ): Promise<{ key: string; label: string }[]> {
    const { participantId, programId } = await this.resolveToken(token);

    // Phase 3.2: unify declared dimensions from both layers.
    //   Layer A — program-wide reusable definitions (ContextDefinition).
    //             One dimension per unique key, even if attached to many actions.
    //   Layer B — legacy per-action local dimensions from contextSchemaJson.
    // Labels come from the reusable definition when available, so cross-action
    // analytics stay consistent (fixing the "same dimension, different labels"
    // problem that local-only schemas caused).
    const [actions, definitions] = await Promise.all([
      this.prisma.gameAction.findMany({
        where: { programId },
        select: { contextSchemaJson: true },
      }),
      this.prisma.contextDefinition.findMany({
        // Phase 3.3: analyticsVisible gates whether a reusable dimension ever
        // appears in the participant analytics toggle. Archived definitions
        // are also excluded to avoid ghost dimensions from deprecated setups.
        where: { programId, analyticsVisible: true, isActive: true },
        select: { key: true, label: true },
      }),
    ]);
    const declared = new Map<string, string>();
    for (const d of definitions) declared.set(d.key, d.label);
    for (const a of actions) {
      const schema = a.contextSchemaJson as {
        dimensions?: { key?: string; label?: string }[];
      } | null;
      for (const d of schema?.dimensions ?? []) {
        if (typeof d.key === 'string' && !declared.has(d.key)) {
          declared.set(d.key, typeof d.label === 'string' ? d.label : d.key);
        }
      }
    }
    if (declared.size === 0) return [];

    const logs = await this.prisma.userActionLog.findMany({
      where: { participantId, programId, status: 'active' },
      select: { contextJson: true },
    });
    const present = new Set<string>();
    for (const l of logs) {
      const ctx = l.contextJson as Record<string, unknown> | null;
      if (!ctx) continue;
      for (const [k, v] of Object.entries(ctx)) {
        if (v !== null && v !== undefined && v !== '') present.add(k);
      }
    }

    return Array.from(declared.entries())
      .filter(([k]) => present.has(k))
      .map(([key, label]) => ({ key, label }));
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private async resolveToken(token: string) {
    const pg = await this.prisma.participantGroup.findUnique({
      where: { accessToken: token },
      select: { participantId: true, groupId: true, isActive: true, group: { select: { programId: true } } },
    });
    if (!pg || !pg.isActive) throw new NotFoundException('הקישור אינו בתוקף');
    if (!pg.group.programId) throw new NotFoundException('לא נמצאה תוכנית');
    return { participantId: pg.participantId, groupId: pg.groupId, programId: pg.group.programId };
  }

  private async buildDailyTrend(participantId: string, programId: string, days: number): Promise<{ date: string; points: number }[]> {
    const now = new Date();
    const since = new Date(now);
    since.setDate(now.getDate() - days + 1);
    since.setHours(0, 0, 0, 0);

    const events = await this.prisma.scoreEvent.findMany({
      where: { participantId, programId, createdAt: { gte: since } },
      select: { points: true, createdAt: true },
    });

    // Build date → points map
    const map: Record<string, number> = {};
    for (const e of events) {
      const key = e.createdAt.toISOString().slice(0, 10); // YYYY-MM-DD
      map[key] = (map[key] ?? 0) + e.points;
    }

    // Fill all days in range (including zeros)
    const result: { date: string; points: number }[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(since);
      d.setDate(since.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      result.push({ date: key, points: map[key] ?? 0 });
    }
    return result;
  }

  private async getEffectiveDailyValue(
    participantId: string,
    programId: string,
    actionId: string,
    todayStart: Date,
    aggregationMode: string,
  ): Promise<number> {
    const logs = await this.prisma.userActionLog.findMany({
      where: {
        participantId,
        programId,
        actionId,
        status: 'active',
        createdAt: { gte: todayStart },
      },
      select: { value: true },
    });
    if (logs.length === 0) return 0;
    const values = logs.map((l) => parseFloat(l.value ?? '0')).filter((v) => !isNaN(v));
    if (aggregationMode === 'latest_value') return Math.max(...values);
    if (aggregationMode === 'incremental_sum') return values.reduce((a, b) => a + b, 0);
    return 0;
  }
}
