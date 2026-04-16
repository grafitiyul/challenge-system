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

/** Participant timezone. Hardcoded for now — all our participants live here. */
const PARTICIPANT_TZ = 'Asia/Jerusalem';

/**
 * Format a UTC timestamp as HH:MM in the participant's local wall clock.
 * Uses Intl so it works regardless of the Node server's system timezone.
 */
function formatLocalHourMinute(d: Date): string {
  // 'en-GB' gives a stable 24h HH:MM without AM/PM.
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: PARTICIPANT_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

/** Format a UTC timestamp as YYYY-MM-DD in the participant's local day. */
function formatLocalDate(d: Date): string {
  // 'en-CA' gives ISO-like YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PARTICIPANT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/**
 * Given a log's contextJson + the action's effective schema, return an array
 * of user-facing (dimensionLabel, valueLabel) pairs. Skips hidden / system
 * dimensions. Select values are translated from the internal option value to
 * the option label. Text + number values render as-is.
 */
function resolveContextDisplay(
  ctx: Record<string, unknown> | null,
  schema: Record<string, unknown> | null,
): Array<{ dimensionLabel: string; valueLabel: string }> {
  if (!ctx || !schema) return [];
  const dims = (schema as { dimensions?: Array<Record<string, unknown>> }).dimensions ?? [];
  const out: Array<{ dimensionLabel: string; valueLabel: string }> = [];
  for (const d of dims) {
    if (d.visibleToParticipant === false) continue;
    if (d.inputMode && d.inputMode !== 'participant') continue;
    const k = typeof d.key === 'string' ? d.key : null;
    if (!k) continue;
    const v = ctx[k];
    if (v === undefined || v === null || v === '') continue;
    const dimensionLabel = typeof d.label === 'string' ? d.label : k;
    let valueLabel = String(v);
    if (d.type === 'select' && Array.isArray(d.options)) {
      const opts = d.options as Array<{ value?: string; label?: string }>;
      const match = opts.find((o) => o.value === String(v));
      if (match?.label) valueLabel = match.label;
    }
    out.push({ dimensionLabel, valueLabel });
  }
  return out;
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
    /** Phase 3.4: admin-editable prompt; null = use derived default. */
    participantPrompt: string | null;
    /** Phase 4.1: when set, portal renders a free-text input under the main input. */
    participantTextPrompt: string | null;
    /** Phase 4.4: when true + prompt set, portal blocks submission on empty text. */
    participantTextRequired: boolean;
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
  /** Phase 4.4: HH:MM in Asia/Jerusalem (participant's local time). */
  time: string;
  actionId: string;
  actionName: string;
  rawValue: string;
  effectiveValue: number | null;
  contextJson: Record<string, unknown> | null;
  /**
   * Phase 4.4: pre-resolved display pairs for the drill-down UI. Dimensions
   * already stripped of hidden ones; select values already translated from
   * internal value → label. Use this instead of contextJson for rendering.
   *
   * Shape: [{ dimensionLabel, valueLabel }]
   */
  contextDisplay: Array<{ dimensionLabel: string; valueLabel: string }>;
  /** Phase 4.1: optional action-level free-text. Surfaces in drill-down. */
  extraText: string | null;
  points: number;
}

export interface AnalyticsBreakdownEntry {
  actionId: string;
  actionName: string;
  totalPoints: number;
  count: number;
}

/**
 * Phase 4.6 — row returned from the pie-slice drill-down endpoint.
 * Each row represents one UserActionLog that contributed to the tapped slice.
 * For group views the `contextLabel` tells the participant WHICH context in
 * the group produced this row (so "שגרה → בוקר" drill-down shows that some
 * entries came from "ארוחה" and others from "שינה", etc.).
 */
export interface AnalyticsSliceEntry {
  logId: string;
  date: string;           // YYYY-MM-DD local
  time: string;           // HH:MM local
  actionId: string;
  actionName: string;
  contextKey: string;     // which context key produced this sample
  contextLabel: string;   // its display label
  valueLabel: string;     // resolved option label (e.g. "בוקר")
  points: number;
}

/**
 * Phase 4: shape returned by /analytics/context-dimensions. Presentation-only
 * metadata (group key/label + custom display label) piggybacks on the existing
 * endpoint so no extra network round-trip is needed.
 *
 * groupKey === null → standalone (no presentation group).
 */
export interface AnalyticsContextDimension {
  key: string;
  label: string;
  displayLabel: string | null;
  groupKey: string | null;
  groupLabel: string | null;
  // Phase 4.7 standalone-pill eligibility flags. Frontend only renders a
  // context as a STANDALONE selector pill when all three are true. Grouped
  // contexts still aggregate via their parent AnalyticsGroup regardless of
  // these flags, so hidden/system contexts can still participate in a group
  // without cluttering the top-level selector.
  //   analyticsVisible     — admin didn't suppress this context from analytics
  //   participantVisible   — was shown to the participant during reporting
  //   hasOptions           — type='select' with a non-empty option list
  analyticsVisible: boolean;
  participantVisible: boolean;
  hasOptions: boolean;
}

/**
 * Phase 6 — Insights engine output shape.
 *
 * Deterministic: every insight is derived from ScoreEvent + UserActionLog only,
 * with no AI / randomness. Backend generates candidates, scores them, dedupes
 * against overlapping patterns, and returns the 2–4 most important. Frontend
 * renders them as simple one-line cards above the chart.
 */
export type AnalyticsInsightType =
  | 'strongest'
  | 'weakest'
  | 'best_day'
  | 'trend'
  | 'consistency'
  // Phase 6.2 diversity expansion — per-category change, concentration,
  // weekday pattern. Deterministic, derived from the same ledger data
  // (no extra per-type DB calls beyond one previous-period fetch).
  | 'most_improved'
  | 'most_declined'
  | 'dominant_source'
  | 'weekday_pattern';

export interface AnalyticsInsight {
  type: AnalyticsInsightType;
  text: string;
  /** Short emoji or unicode glyph used as the leading decoration. */
  icon: string;
  /**
   * Importance score in roughly [0, 100]. Only used for selection — the
   * absolute value is not surfaced to the participant. Higher = more important.
   */
  score: number;
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
        participantPrompt: a.participantPrompt ?? null,
        participantTextPrompt: a.participantTextPrompt ?? null,
        participantTextRequired: a.participantTextRequired ?? false,
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
    dto: {
      actionId: string;
      value?: string;
      contextJson?: Record<string, unknown>;
      extraText?: string;
    },
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
      extraText: dto.extraText,
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

    // Phase 4.4: pre-resolve context labels for every log so the frontend
    // never has to show raw internal values (e.g. "bvkr" instead of "בוקר").
    // We resolve each log's effective schema once, then walk contextJson
    // swapping values → option labels. Hidden dimensions + system dims are
    // skipped because the participant shouldn't see them in drill-down.
    const actionIds = Array.from(new Set(logs.map((l) => l.action.id)));
    const schemaByAction = new Map<string, Record<string, unknown> | null>();
    await Promise.all(
      actionIds.map(async (aid) => {
        schemaByAction.set(aid, await resolveEffectiveContextSchema(this.prisma, aid));
      }),
    );

    return logs.map((l) => ({
      logId: l.id,
      // Phase 4.4: participant-local clock. toLocaleString with Asia/Jerusalem
      // returns "HH:MM" regardless of the server's wall-clock timezone.
      time: formatLocalHourMinute(l.createdAt),
      actionId: l.action.id,
      actionName: l.action.name,
      rawValue: l.value,
      effectiveValue: l.effectiveValue !== null ? Number(l.effectiveValue) : null,
      contextJson: (l.contextJson as Record<string, unknown> | null) ?? null,
      contextDisplay: resolveContextDisplay(
        l.contextJson as Record<string, unknown> | null,
        schemaByAction.get(l.action.id) ?? null,
      ),
      extraText: l.extraText ?? null,
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
      return this.breakdownByContext(participantId, programId, since, until, [key]);
    }
    if (groupBy.startsWith('group:')) {
      // Phase 4.3: centralized group lookup by FK. The id segment is the
      // AnalyticsGroup.id — resolve every context pointing at that group and
      // aggregate their data into one breakdown.
      const groupId = groupBy.slice('group:'.length);
      if (!groupId) throw new BadRequestException('groupBy=group: requires a group id');
      const members = await this.prisma.contextDefinition.findMany({
        where: { programId, analyticsGroupId: groupId, isActive: true },
        select: { key: true },
      });
      const memberKeys = members.map((m) => m.key);
      if (memberKeys.length === 0) return [];
      return this.breakdownByContext(participantId, programId, since, until, memberKeys);
    }
    if (groupBy !== 'action') {
      throw new BadRequestException('groupBy must be "action", "context:<key>", or "group:<key>"');
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

  /**
   * Phase 4.6 pie-slice drill-down. Returns the concrete UserActionLog rows
   * that produced a specific breakdown slice, so the participant can see
   * which actions + contexts + values contributed to it.
   *
   * Accepts the same `groupBy` semantics as breakdown:
   *   - `context:<key>`  → one dimension key
   *   - `group:<groupId>` → all contexts in that analytics group
   *
   * Rows include `contextLabel` so group drill-downs reveal WHICH context
   * inside the group each row came from.
   */
  async getAnalyticsSliceDrilldown(
    token: string,
    opts: {
      groupBy: string;
      value: string;
      period?: '7d' | '14d' | '30d' | 'all';
      from?: string;
      to?: string;
    },
  ): Promise<AnalyticsSliceEntry[]> {
    const { participantId, programId } = await this.resolveToken(token);
    const { since, until } = resolveRange({
      period: opts.period,
      from: opts.from,
      to: opts.to,
    });
    if (!opts.value || !opts.groupBy) {
      throw new BadRequestException('value and groupBy are required');
    }

    // Resolve member keys for this view.
    let memberKeys: string[] = [];
    if (opts.groupBy.startsWith('context:')) {
      const k = opts.groupBy.slice('context:'.length);
      if (!k) throw new BadRequestException('invalid groupBy');
      memberKeys = [k];
    } else if (opts.groupBy.startsWith('group:')) {
      const gid = opts.groupBy.slice('group:'.length);
      if (!gid) throw new BadRequestException('invalid groupBy');
      const members = await this.prisma.contextDefinition.findMany({
        where: { programId, analyticsGroupId: gid, isActive: true },
        select: { key: true },
      });
      memberKeys = members.map((m) => m.key);
    } else {
      throw new BadRequestException('groupBy must be context:<key> or group:<id>');
    }
    if (memberKeys.length === 0) return [];

    // Walk every active log in range; keep only logs where at least one of
    // the member keys holds the tapped value. Build the per-row resolution
    // (context label, value label) from the shared definitions table +
    // action-local schema fallback.
    const logs = await this.prisma.userActionLog.findMany({
      where: {
        participantId, programId,
        status: 'active',
        ...(since ? { createdAt: { gte: since, lte: until } } : { createdAt: { lte: until } }),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        action: { select: { id: true, name: true, contextSchemaJson: true } },
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

    // Resolve context label + option labels for every member key, program-wide.
    const definitions = await this.prisma.contextDefinition.findMany({
      where: { programId, key: { in: memberKeys } },
      select: {
        key: true,
        label: true,
        type: true,
        optionsJson: true,
        analyticsDisplayLabel: true,
      },
    });
    const labelByKey = new Map<string, string>();
    const optionLabelByKey = new Map<string, Map<string, string>>();
    for (const d of definitions) {
      labelByKey.set(d.key, d.analyticsDisplayLabel?.trim() || d.label);
      if (d.type === 'select' && Array.isArray(d.optionsJson)) {
        const opts = new Map<string, string>();
        for (const o of d.optionsJson as Array<{ value?: string; label?: string }>) {
          if (typeof o?.value === 'string' && typeof o?.label === 'string') {
            opts.set(o.value, o.label);
          }
        }
        optionLabelByKey.set(d.key, opts);
      }
    }

    // For member keys that are local (action-only, no reusable definition),
    // fall back to the action's schema per log.
    function localLabelsForAction(a: { contextSchemaJson: unknown }, key: string) {
      const schema = a.contextSchemaJson as {
        dimensions?: Array<{ key?: string; label?: string; options?: Array<{ value?: string; label?: string }> }>;
      } | null;
      for (const d of schema?.dimensions ?? []) {
        if (d.key !== key) continue;
        const valueMap = new Map<string, string>();
        for (const o of d.options ?? []) {
          if (typeof o.value === 'string' && typeof o.label === 'string') {
            valueMap.set(o.value, o.label);
          }
        }
        return { dimensionLabel: d.label ?? key, options: valueMap };
      }
      return null;
    }

    const target = String(opts.value);
    const out: AnalyticsSliceEntry[] = [];
    for (const l of logs) {
      const ctx = l.contextJson as Record<string, unknown> | null;
      if (!ctx) continue;
      // Find which member key in this log matches the tapped value. A single
      // log may carry multiple matching members (rare — e.g. two contexts in
      // one group both happen to equal the same value); emit one row per.
      for (const k of memberKeys) {
        const raw = ctx[k];
        if (raw === undefined || raw === null || raw === '') continue;
        if (String(raw) !== target) continue;
        // Label resolution: reusable first, local schema fallback.
        let dimensionLabel = labelByKey.get(k) ?? null;
        let valueLabel = optionLabelByKey.get(k)?.get(target) ?? null;
        if (!dimensionLabel || !valueLabel) {
          const fallback = localLabelsForAction(l.action, k);
          if (fallback) {
            dimensionLabel = dimensionLabel ?? fallback.dimensionLabel;
            valueLabel = valueLabel ?? fallback.options.get(target) ?? null;
          }
        }
        out.push({
          logId: l.id,
          date: formatLocalDate(l.createdAt),
          time: formatLocalHourMinute(l.createdAt),
          actionId: l.action.id,
          actionName: l.action.name,
          contextKey: k,
          contextLabel: dimensionLabel ?? k,
          valueLabel: valueLabel ?? target,
          points: pointsByLog[l.id] ?? 0,
        });
      }
    }
    return out;
  }

  private async breakdownByContext(
    participantId: string,
    programId: string,
    since: Date | null,
    until: Date,
    // Phase 4: a single-element array is the original "group by one context"
    // case; 2+ elements means "aggregate multiple contexts into one breakdown"
    // for an analytics presentation group.
    dimensionKeys: string[],
  ): Promise<AnalyticsBreakdownEntry[]> {
    if (dimensionKeys.length === 0) return [];
    const dimensionSet = new Set(dimensionKeys);

    const logs = await this.prisma.userActionLog.findMany({
      where: {
        participantId, programId,
        status: 'active',
        ...(since ? { createdAt: { gte: since, lte: until } } : { createdAt: { lte: until } }),
      },
      select: { id: true, actionId: true, contextJson: true },
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

    // Phase 4: label resolution spans ALL dimension keys in the group. Reusable
    // labels from each member definition merge into one big value→label map.
    // If two members declare overlapping option values with different labels,
    // first-declared wins (deterministic on query order).
    const definitions = await this.prisma.contextDefinition.findMany({
      where: { programId, key: { in: dimensionKeys } },
      select: { key: true, optionsJson: true, type: true },
    });
    const reusableLabels = new Map<string, string>();
    for (const def of definitions) {
      if (def.type === 'select' && Array.isArray(def.optionsJson)) {
        for (const o of def.optionsJson as Array<{ value?: string; label?: string }>) {
          if (typeof o?.value === 'string' && typeof o?.label === 'string') {
            if (!reusableLabels.has(o.value)) reusableLabels.set(o.value, o.label);
          }
        }
      }
    }

    const actionIds = Array.from(new Set(logs.map((l) => l.actionId)));
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
        if (!d.key || !dimensionSet.has(d.key)) continue;
        for (const o of d.options ?? []) {
          if (typeof o.value === 'string' && typeof o.label === 'string') {
            if (!perKey.has(o.value)) perKey.set(o.value, o.label);
          }
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

    // Phase 4 aggregation rule: for each log, emit one sample per member-key
    // that is present in its contextJson. Logs with multiple members present
    // contribute to each (e.g. log with meal_period=breakfast AND mood=happy
    // feeds both buckets when both dimensions belong to the same group).
    // Same value from different dimension keys merges under one bucket by
    // shared value string.
    const totals: Record<string, { points: number; count: number; label: string }> = {};
    for (const l of logs) {
      const ctx = l.contextJson as Record<string, unknown> | null;
      if (!ctx) continue;
      const pts = pointsByLog[l.id] ?? 0;
      for (const k of dimensionKeys) {
        const raw = ctx[k];
        if (raw === undefined || raw === null || raw === '') continue;
        const value = String(raw);
        const label = resolveLabel(l.actionId, value);
        const entry = totals[value] ?? { points: 0, count: 0, label };
        entry.points += pts;
        entry.count += 1;
        if (entry.label === value && label !== value) entry.label = label;
        totals[value] = entry;
      }
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

  // ─── Phase 6: insights engine ─────────────────────────────────────────────
  //
  // Deterministic, no-AI pipeline:
  //   1. Generate candidates from the ScoreEvent ledger + active UserActionLogs
  //      for the requested range.
  //   2. Score each candidate on a rough [0, 100] importance scale.
  //   3. Dedupe overlapping messages (e.g. strongest + best_day telling the
  //      same story).
  //   4. Sort by score DESC and return at most 4.
  //
  // All five types share one DB read pair (events + logs in range) so this
  // endpoint never adds heavy queries beyond what /trend and /breakdown already
  // cost. Type D (previous-period trend) does one extra aggregate call.
  async getAnalyticsInsights(
    token: string,
    opts: { period?: '7d' | '14d' | '30d' | 'all'; from?: string; to?: string },
  ): Promise<AnalyticsInsight[]> {
    const { participantId, programId } = await this.resolveToken(token);
    const { since, until } = resolveRange({
      period: opts.period,
      from: opts.from,
      to: opts.to,
    });

    const rangeWhere = since
      ? { createdAt: { gte: since, lte: until } }
      : { createdAt: { lte: until } };

    const [events, actions] = await Promise.all([
      this.prisma.scoreEvent.findMany({
        where: { participantId, programId, ...rangeWhere },
        select: {
          points: true,
          sourceId: true,
          sourceType: true,
          createdAt: true,
        },
      }),
      this.prisma.gameAction.findMany({
        where: { programId },
        select: { id: true, name: true },
      }),
    ]);

    const nameById = new Map<string, string>(
      actions.map((a) => [a.id, a.name]),
    );

    // ── Daily totals (net of all ScoreEvent kinds) ──────────────────────
    const pointsByDay = new Map<string, number>();
    for (const e of events) {
      const key = e.createdAt.toISOString().slice(0, 10);
      pointsByDay.set(key, (pointsByDay.get(key) ?? 0) + e.points);
    }

    // Dense day list covers the whole requested window. Empty days sit at 0
    // so the "active days vs total days" ratio is well defined.
    const days: { date: string; points: number }[] = [];
    let dayCount = 0;
    if (since) {
      dayCount =
        Math.floor(
          (startOfDayUTC(until).getTime() - since.getTime()) / DAY_MS,
        ) + 1;
      for (let i = 0; i < dayCount; i++) {
        const d = new Date(since.getTime() + i * DAY_MS);
        const key = d.toISOString().slice(0, 10);
        days.push({ date: key, points: pointsByDay.get(key) ?? 0 });
      }
    }

    // ── Category (action) breakdown, positive points only ───────────────
    // Using action as the "category" is the most intuitive grouping — it's
    // always present, always meaningful, and doesn't depend on whether the
    // admin has configured analytics groups.
    const pointsByAction = new Map<string, number>();
    for (const e of events) {
      if (
        (e.sourceType === 'action' || e.sourceType === 'correction') &&
        e.sourceId
      ) {
        pointsByAction.set(
          e.sourceId,
          (pointsByAction.get(e.sourceId) ?? 0) + e.points,
        );
      }
    }
    const categories = Array.from(pointsByAction.entries())
      .filter(([, p]) => p > 0)
      .map(([id, p]) => ({
        id,
        name: nameById.get(id) ?? '(פעולה שנמחקה)',
        points: p,
      }))
      .sort((a, b) => b.points - a.points);

    // ── Previous-period per-action breakdown (Phase 6.2) ────────────────
    // Needed for: Type D (aggregate trend), Type F (most improved category),
    // Type G (most declined category). Fetched once, broken down per action.
    // Only runs when a previous period is actually definable.
    const prevPointsByAction = new Map<string, number>();
    let prevTotal = 0;
    if (since && dayCount >= 3) {
      const prevSince = new Date(since.getTime() - dayCount * DAY_MS);
      const prevUntil = new Date(since.getTime() - 1);
      const prevEvents = await this.prisma.scoreEvent.findMany({
        where: {
          participantId,
          programId,
          createdAt: { gte: prevSince, lte: prevUntil },
        },
        select: { points: true, sourceId: true, sourceType: true },
      });
      for (const e of prevEvents) {
        prevTotal += e.points;
        if (
          (e.sourceType === 'action' || e.sourceType === 'correction') &&
          e.sourceId
        ) {
          prevPointsByAction.set(
            e.sourceId,
            (prevPointsByAction.get(e.sourceId) ?? 0) + e.points,
          );
        }
      }
    }

    // Phase 6.2 diversity model. Each candidate carries a `family` tag so the
    // selection step can enforce variety — max one insight per family in the
    // strict pass, then relax to two per family if we still have < 4 slots.
    // Families:
    //   performance         — where the participant stands right now
    //   improvement_decline — how it moved vs the previous period
    //   pattern             — temporal patterns (best day, weekday)
    //   consistency         — active-days/total-days signal
    type InsightFamily =
      | 'performance'
      | 'improvement_decline'
      | 'pattern'
      | 'consistency';
    type Candidate = AnalyticsInsight & { family: InsightFamily };
    const candidates: Candidate[] = [];

    // Type A — Strongest category.
    // Tightened threshold (Phase 6.2): only fire when there's a real runner-up
    // AND the top is >= 1.3x the second. Single-category or near-tie cases
    // are noise, not insight.
    if (categories.length >= 2) {
      const top = categories[0];
      const second = categories[1];
      const ratio = top.points / second.points;
      if (ratio >= 1.3) {
        candidates.push({
          type: 'strongest',
          family: 'performance',
          icon: '⭐',
          text: `התחזקת במיוחד ב־${top.name}`,
          score: Math.min(ratio, 5) * 20,
        });
      }
    }

    // Type B — Weakest category. Skip when there's only one category, when
    // all values are equal, or when the gap from the average is negligible
    // (< 15%) — a tiny gap isn't a "room to improve" signal, it's noise.
    if (categories.length >= 2) {
      const vals = categories.map((c) => c.points);
      const allEqual = vals.every((v) => v === vals[0]);
      if (!allEqual) {
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        const weakest = categories[categories.length - 1];
        const gap = avg > 0 ? (avg - weakest.points) / avg : 0;
        if (gap >= 0.15) {
          candidates.push({
            type: 'weakest',
            family: 'performance',
            icon: '📌',
            text: `יש לך מקום לשיפור ב־${weakest.name}`,
            score: gap * 80,
          });
        }
      }
    }

    // Type C — Best day. Requires a bounded range (days.length > 0) and a
    // distance-from-average signal. A spike of at least +25% over the mean
    // feels worth flagging; below that it's just a normal good day.
    if (days.length >= 2) {
      const active = days.filter((d) => d.points > 0);
      if (active.length > 0) {
        const total = days.reduce((a, b) => a + b.points, 0);
        const avg = total / days.length;
        const best = active.reduce((bd, d) =>
          d.points > bd.points ? d : bd,
        );
        const deviation = avg > 0 ? (best.points - avg) / avg : 0;
        if (deviation > 0.25) {
          candidates.push({
            type: 'best_day',
            family: 'pattern',
            icon: '🏆',
            text: `היום הכי חזק שלך היה ${this.formatHebrewDay(best.date)} עם ${best.points} נק׳`,
            score: Math.min(deviation * 30, 100),
          });
        }
      }
    }

    // Type D — Trend vs previous equal-length period. Skips when the current
    // range is 'all' (no previous period), when either side has zero points,
    // or when the change is negligible (< 5%).
    if (since && dayCount >= 3) {
      const currTotal = days.reduce((a, b) => a + b.points, 0);
      if (prevTotal > 0 && currTotal > 0) {
        const pct = Math.round(((currTotal - prevTotal) / prevTotal) * 100);
        if (Math.abs(pct) >= 5) {
          candidates.push({
            type: 'trend',
            family: 'improvement_decline',
            icon: pct > 0 ? '📈' : '📉',
            text:
              pct > 0
                ? `שיפור של ${pct}% לעומת התקופה הקודמת`
                : `ירידה של ${Math.abs(pct)}% לעומת התקופה הקודמת`,
            score: Math.min(Math.abs(pct), 100),
          });
        }
      }
    }

    // Type E — Consistency. Phase 6.2 tightens both branches so this family
    // doesn't dominate every participant's output:
    //   - high branch (celebrate): raised 0.75 → 0.8, multiplier 40 → 25
    //   - low branch (nudge):      lowered 0.4 → 0.25, multiplier 40 → 20
    // The mid band (0.25 < ratio < 0.8) stays silent — that's "normal".
    if (days.length >= 5) {
      const activeCount = days.filter((d) => d.points > 0).length;
      const ratio = activeCount / days.length;
      if (ratio >= 0.8) {
        candidates.push({
          type: 'consistency',
          family: 'consistency',
          icon: '🎯',
          text: 'היית עקבית השבוע — כל הכבוד',
          score: ratio * 25,
        });
      } else if (ratio > 0 && ratio <= 0.25) {
        candidates.push({
          type: 'consistency',
          family: 'consistency',
          icon: '💡',
          text: 'כדאי לנסות לשמור על עקביות גבוהה יותר',
          score: (1 - ratio) * 20,
        });
      }
    }

    // Type F — Most improved category vs previous period (Phase 6.2).
    // Only fires when a category grew by at least 15% AND had non-trivial
    // previous-period points (≥ 5) so "went from 1 to 3" doesn't dominate.
    if (prevPointsByAction.size > 0 && categories.length > 0) {
      let best: { name: string; pct: number } | null = null;
      for (const c of categories) {
        const prev = prevPointsByAction.get(c.id) ?? 0;
        if (prev < 5) continue;
        const pct = Math.round(((c.points - prev) / prev) * 100);
        if (pct >= 15 && (!best || pct > best.pct)) {
          best = { name: c.name, pct };
        }
      }
      if (best) {
        candidates.push({
          type: 'most_improved',
          family: 'improvement_decline',
          icon: '🚀',
          text: `הכי השתפרת ב־${best.name} (+${best.pct}%)`,
          score: Math.min(best.pct, 100),
        });
      }
    }

    // Type G — Most declined category vs previous period. Mirrors F: only
    // fires when the loss is ≥ 20% of a meaningful previous baseline.
    if (prevPointsByAction.size > 0) {
      let worst: { name: string; pct: number } | null = null;
      for (const [id, prev] of prevPointsByAction.entries()) {
        if (prev < 5) continue;
        const curr = pointsByAction.get(id) ?? 0;
        const pct = Math.round(((curr - prev) / prev) * 100);
        if (pct <= -20 && (!worst || pct < worst.pct)) {
          worst = { name: nameById.get(id) ?? '(פעולה שנמחקה)', pct };
        }
      }
      if (worst) {
        candidates.push({
          type: 'most_declined',
          family: 'improvement_decline',
          icon: '⚠️',
          text: `ירידה ב־${worst.name} (${worst.pct}%)`,
          score: Math.min(Math.abs(worst.pct), 100),
        });
      }
    }

    // Type H — Dominant source. Fires when a single category accounts for
    // ≥ 60% of total category points. Requires ≥ 2 categories so "100% from
    // the only action you tracked" doesn't surface as an insight.
    if (categories.length >= 2) {
      const totalCategoryPts = categories.reduce((s, c) => s + c.points, 0);
      if (totalCategoryPts > 0) {
        const top = categories[0];
        const share = top.points / totalCategoryPts;
        if (share >= 0.6) {
          candidates.push({
            type: 'dominant_source',
            family: 'performance',
            icon: '🔥',
            text: `${Math.round(share * 100)}% מהנקודות שלך הגיעו מ־${top.name}`,
            score: share * 80,
          });
        }
      }
    }

    // Type I — Weekday pattern. Needs at least 2 weeks of data so every
    // weekday appears a couple of times before we claim one is "strongest".
    // Fires when a weekday's average is ≥ 1.4x the overall daily average.
    if (days.length >= 14) {
      const pointsByWday: number[] = [0, 0, 0, 0, 0, 0, 0];
      const countsByWday: number[] = [0, 0, 0, 0, 0, 0, 0];
      for (const d of days) {
        const wd = new Date(`${d.date}T00:00:00.000Z`).getUTCDay();
        pointsByWday[wd] += d.points;
        countsByWday[wd] += 1;
      }
      const overallAvg = days.reduce((s, d) => s + d.points, 0) / days.length;
      if (overallAvg > 0) {
        let bestWd = -1;
        let bestAvg = 0;
        for (let i = 0; i < 7; i++) {
          if (countsByWday[i] < 2) continue;
          const avg = pointsByWday[i] / countsByWday[i];
          if (avg > bestAvg) {
            bestAvg = avg;
            bestWd = i;
          }
        }
        if (bestWd >= 0 && bestAvg / overallAvg >= 1.4) {
          const hebrewDays = [
            'ראשון',
            'שני',
            'שלישי',
            'רביעי',
            'חמישי',
            'שישי',
            'שבת',
          ];
          candidates.push({
            type: 'weekday_pattern',
            family: 'pattern',
            icon: '📅',
            text: `ימי ${hebrewDays[bestWd]} הם החזקים ביותר שלך`,
            score: Math.min((bestAvg / overallAvg - 1) * 60, 100),
          });
        }
      }
    }

    // ── Dedup ───────────────────────────────────────────────────────────
    // Strongest + best_day often tell the same story (single peak day driven
    // by the strongest action). Keep whichever scores higher; drop the other.
    const strongestIdx = candidates.findIndex((c) => c.type === 'strongest');
    const bestDayIdx = candidates.findIndex((c) => c.type === 'best_day');
    if (strongestIdx >= 0 && bestDayIdx >= 0) {
      const loserIdx =
        candidates[strongestIdx].score >= candidates[bestDayIdx].score
          ? bestDayIdx
          : strongestIdx;
      candidates.splice(loserIdx, 1);
    }

    // ── Diversity-aware selection (Phase 6.2) ───────────────────────────
    // Sort by score DESC, then pick in two passes:
    //   Pass 1: strict 1-per-family. This guarantees variety when ≥ 4
    //           families have candidates — no more "same 3 insights every
    //           time" pattern.
    //   Pass 2: relax to 2-per-family only if still < 4 slots filled. This
    //           keeps the card from going empty when only 2–3 families have
    //           anything to say.
    // We never pad below 2 with low-score insights — the spec prefers fewer
    // cards over weak ones.
    candidates.sort((a, b) => b.score - a.score);
    const selected: Candidate[] = [];
    const familyCount = new Map<InsightFamily, number>();
    const bump = (f: InsightFamily) =>
      familyCount.set(f, (familyCount.get(f) ?? 0) + 1);

    for (const c of candidates) {
      if (selected.length >= 4) break;
      if ((familyCount.get(c.family) ?? 0) >= 1) continue;
      selected.push(c);
      bump(c.family);
    }
    if (selected.length < 4) {
      for (const c of candidates) {
        if (selected.length >= 4) break;
        if (selected.includes(c)) continue;
        if ((familyCount.get(c.family) ?? 0) >= 2) continue;
        selected.push(c);
        bump(c.family);
      }
    }
    // Strip internal family tag before returning to the client.
    return selected.map((c) => ({
      type: c.type,
      icon: c.icon,
      text: c.text,
      score: c.score,
    }));
  }

  /**
   * Format a YYYY-MM-DD date key as a Hebrew short weekday + day label.
   * Uses Asia/Jerusalem so weekday alignment matches the participant's wall
   * clock. Example: "2026-04-12" → "יום ראשון, 12 באפר׳".
   */
  private formatHebrewDay(isoDate: string): string {
    const d = new Date(`${isoDate}T00:00:00.000Z`);
    return new Intl.DateTimeFormat('he-IL', {
      timeZone: PARTICIPANT_TZ,
      weekday: 'long',
      day: 'numeric',
      month: 'short',
    }).format(d);
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
  ): Promise<AnalyticsContextDimension[]> {
    const { participantId, programId } = await this.resolveToken(token);

    // Phase 3.2+4: unify dimensions across layers AND surface their Phase 4
    // presentation-layer metadata (analytics group + display label).
    //   Layer A — program-wide reusable definitions (ContextDefinition).
    //   Layer B — legacy per-action local dimensions from contextSchemaJson.
    // Labels come from the reusable definition when available, so cross-action
    // analytics stay consistent. The presentation-layer fields come from
    // ContextDefinition only (local-schema dims have no group semantics).
    const [actions, definitions] = await Promise.all([
      this.prisma.gameAction.findMany({
        where: { programId },
        select: { contextSchemaJson: true },
      }),
      this.prisma.contextDefinition.findMany({
        where: {
          programId,
          isActive: true,
          NOT: { type: 'text' },
          // Phase 4.7: we intentionally do NOT filter by `analyticsVisible`
          // here. Hidden/system contexts need to surface so their parent
          // analytics group can be discovered by the frontend. The frontend
          // then uses `participantVisible` + `hasOptions` (set below) to
          // decide whether a context qualifies as a STANDALONE selector pill.
        },
        // Phase 4.3: group is now a FK to AnalyticsGroup. Pull label through it.
        // Phase 4.7: also pull visibleToParticipantByDefault + type + optionsJson
        // + analyticsVisible so the frontend can distinguish hidden/system
        // contexts (which may still belong to a group) from participant-visible
        // ones (which can also appear as standalone selector pills).
        select: {
          key: true,
          label: true,
          type: true,
          analyticsDisplayLabel: true,
          analyticsGroupId: true,
          analyticsGroup: { select: { id: true, label: true } },
          visibleToParticipantByDefault: true,
          analyticsVisible: true,
          optionsJson: true,
        },
      }),
    ]);
    type DeclaredEntry = {
      key: string;
      label: string;
      displayLabel: string | null;
      groupKey: string | null;
      groupLabel: string | null;
      analyticsVisible: boolean;
      participantVisible: boolean;
      hasOptions: boolean;
    };
    const declared = new Map<string, DeclaredEntry>();
    const reusableKeys = new Set<string>();
    for (const d of definitions) {
      const options = Array.isArray(d.optionsJson)
        ? (d.optionsJson as unknown[])
        : [];
      declared.set(d.key, {
        key: d.key,
        label: d.label,
        displayLabel: d.analyticsDisplayLabel ?? null,
        // Phase 4.3: groupKey is the AnalyticsGroup.id; groupLabel is pulled
        // off the related row so the UI can surface a human-friendly name.
        groupKey: d.analyticsGroupId ?? null,
        groupLabel: d.analyticsGroup?.label ?? null,
        analyticsVisible: d.analyticsVisible === true,
        participantVisible: d.visibleToParticipantByDefault === true,
        hasOptions: d.type === 'select' && options.length > 0,
      });
      reusableKeys.add(d.key);
    }
    for (const a of actions) {
      const schema = a.contextSchemaJson as {
        dimensions?: {
          key?: string;
          label?: string;
          type?: string;
          options?: unknown[];
        }[];
      } | null;
      for (const d of schema?.dimensions ?? []) {
        if (d.type === 'text') continue;
        if (typeof d.key === 'string' && !declared.has(d.key)) {
          declared.set(d.key, {
            key: d.key,
            label: typeof d.label === 'string' ? d.label : d.key,
            displayLabel: null,
            groupKey: null,
            groupLabel: null,
            // Legacy per-action dimensions have no presentation metadata.
            // Treat them as analytics- and participant-visible (they were
            // captured by the participant at reporting time) with options
            // iff the schema declares a non-empty option list.
            analyticsVisible: true,
            participantVisible: true,
            hasOptions: d.type === 'select' && Array.isArray(d.options) && d.options.length > 0,
          });
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

    return Array.from(declared.values())
      .filter((d) => reusableKeys.has(d.key) || present.has(d.key))
      .map((d) => ({
        key: d.key,
        label: d.label,
        displayLabel: d.displayLabel,
        groupKey: d.groupKey,
        groupLabel: d.groupLabel,
        analyticsVisible: d.analyticsVisible,
        participantVisible: d.participantVisible,
        hasOptions: d.hasOptions,
      }));
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
