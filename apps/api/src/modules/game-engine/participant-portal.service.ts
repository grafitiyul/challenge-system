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

/** True when err is a Prisma unique-constraint violation (P2002). */
function isUniqueViolation(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
  );
}

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
 * Convert a YYYY-MM-DD (interpreted as Asia/Jerusalem local date) into the
 * UTC Date that represents 12:00 local on that calendar day. Used by
 * catch-up mode to anchor a backdated UserActionLog/ScoreEvent/FeedEvent
 * createdAt squarely inside the credited day under any "today" filter
 * (which uses local-midnight boundaries).
 *
 * DST-safe within reason: noon is many hours away from any DST transition
 * (transitions happen at 02:00–03:00 local), so the offset probed via
 * Intl is stable across the gap. Do not use this helper for dates near
 * midnight — it is intended only for 12:00 anchors.
 */
/**
 * Calendar-day distance between two YYYY-MM-DD strings (treating each
 * as Asia/Jerusalem local). Returns positive when `from` is earlier
 * than `to`. Used to compute "how many days back is this catch-up
 * report?" without instantiating Dates with timezone-dependent parsing.
 */
function daysBetweenLocalDates(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  // Use UTC noon on each day so the millisecond difference is exactly
  // 24h × N — no DST edge cases on the divide.
  const fUtc = Date.UTC(fy, fm - 1, fd, 12, 0, 0);
  const tUtc = Date.UTC(ty, tm - 1, td, 12, 0, 0);
  return Math.round((tUtc - fUtc) / DAY_MS);
}

function jerusalemNoonUtc(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  // Probe: at UTC noon on this date, what does the Jerusalem wall clock
  // read? +02 → 14, +03 → 15. The difference from 12 is the local offset.
  const probe = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const jerHour = parseInt(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: PARTICIPANT_TZ, hour: '2-digit', hour12: false,
    }).format(probe),
    10,
  );
  const offsetHours = jerHour - 12; // local is `offsetHours` ahead of UTC
  return new Date(Date.UTC(y, m - 1, d, 12 - offsetHours, 0, 0));
}

/**
 * Day-credit suffix used on backdated FeedEvent.message strings. No
 * religious / holiday-specific wording — purely "<relative day>" so the
 * admin's choice of which days to make available stays out of the
 * backend message bank.
 */
function backdatedDaySuffix(daysBack: number): string {
  if (daysBack <= 0) return '';
  if (daysBack === 1) return ' (דווח עבור אתמול)';
  if (daysBack === 2) return ' (דווח עבור שלשום)';
  return ` (דווח עבור לפני ${daysBack} ימים)`;
}

/**
 * Built-in default for the catch-up session-start FeedEvent. Used when
 * the program has no `catchUpBannerText` configured. Includes duration
 * + days-back so the group sees what's actually allowed without having
 * to ask the admin.
 */
function defaultCatchUpActivationMessage(
  fullName: string, durationMinutes: number, allowedDaysBack: number,
): string {
  return `${fullName} הפעילה מצב השלמה (${durationMinutes} דקות, עד ${allowedDaysBack} ימים אחורה)`;
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
  participant: { id: string; firstName: string; lastName: string | null; profileImageUrl: string | null };
  // The "primary" group — drives the portal-opening gate (call/open times)
  // and the page header. Defined as the participant's oldest active
  // membership in the program, so a participant who's been moved between
  // groups doesn't lose her gate context just because she joined a new
  // group later.
  group: { id: string; name: string; startDate: Date | null; endDate: Date | null };
  // Phase 8 — every active group the participant has in the same program,
  // ordered by joinedAt ascending. The frontend uses this for the group
  // switcher (only shown when length > 1). For single-group participants
  // this is a 1-element array and the switcher is hidden.
  groups: { id: string; name: string; isActive: boolean }[];
  // The group context the leaderboard / feed are currently scoped to.
  // Driven by an optional `?groupId=` query param; falls back to the
  // primary group when absent or invalid.
  activeGroupId: string;
  program: { id: string; name: string; isActive: boolean; profileTabEnabled: boolean };
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
  // Catch-up mode visibility state. Drives whether the participant sees
  // the "catch-up" button at the bottom of "הנתונים שלי" tab, and
  // whether an active session banner + day-chips are currently showing.
  // null when the program has catch-up turned off entirely (master flag
  // off) — saves the client from having to guard on individual fields.
  catchUp: {
    enabled: boolean;          // master switch (program.catchUpEnabled)
    availableToday: boolean;   // today in catchUpAvailableDates AND no session today
    buttonLabel: string;
    confirmTitle: string | null;
    confirmBody: string | null;
    durationMinutes: number;
    allowedDaysBack: number;
    bannerText: string | null;
  } | null;
  // Set when an unexpired session exists right now. Banner + day chips
  // render based on this. Outside an active session the field is null
  // and the action sheet behaves exactly as before (today-only).
  activeCatchUpSession: {
    id: string;
    expiresAt: string;
    allowedDaysBack: number;
    bannerText: string | null;
  } | null;
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
    profileImageUrl: string | null;
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
  // Wall-clock submission time. For backdated catch-up reports this is
  // when the participant tapped submit (often "now"), NOT the credited
  // day stored on createdAt. The feed represents real-time activity, so
  // every consumer that renders relative time / orders rows reads this.
  // createdAt remains the scoring/credited date and is intentionally
  // not surfaced on this DTO.
  occurredAt: string;
  participant: { id: string; firstName: string; lastName: string | null; profileImageUrl: string | null };
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
  // ── Performance / distribution ─────────────────────────────────────────
  | 'strongest'
  | 'weakest'
  | 'dominant_source'
  | 'balanced_distribution'
  | 'missing_category'
  // ── Change (vs previous equal-length period) ───────────────────────────
  | 'trend'
  | 'most_improved'
  | 'most_declined'
  // ── Time / temporal patterns ───────────────────────────────────────────
  | 'best_day'
  | 'weekday_pattern'
  | 'strongest_hour_range'
  | 'activity_comeback'
  // ── Behavior signals ───────────────────────────────────────────────────
  | 'high_concentration'
  | 'low_engagement'
  // ── Consistency ────────────────────────────────────────────────────────
  | 'consistency'
  | 'consistent_streak';

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

  // ─── Phase 6.8 insight selection strategy ─────────────────────────────────
  // Replaces the previous global `typeUsageCounter` singleton with
  // per-program DB-backed state. No in-memory caches, no cross-program
  // interference. See ProgramInsightTypeUsage in schema.prisma.

  // ─── Resolve token → participant context ──────────────────────────────────

  async getContext(token: string, bypassSig?: string, requestedGroupId?: string): Promise<PortalContext> {
    // Validate bypass sig (HMAC-SHA256 of the access token, first 24 hex chars)
    let bypass = false;
    if (bypassSig) {
      const secret = process.env.BYPASS_SECRET ?? 'challenge-bypass-dev-secret';
      const expected = createHmac('sha256', secret).update(token).digest('hex').slice(0, 24);
      bypass = bypassSig === expected;
    }
    // Phase 8: discover every group the participant has in this program.
    // The primary group anchors portalCallTime / portalOpenTime so the
    // gate state can't change just because the participant flipped the
    // switcher. activeGroupId is what the leaderboard / feed scope to.
    const multi = await this.resolveMultiGroup(token, requestedGroupId);
    const pg = await this.prisma.participantGroup.findUnique({
      where: { participantId_groupId: { participantId: multi.participantId, groupId: multi.primaryGroupId } },
      include: {
        participant: {
          select: { id: true, firstName: true, lastName: true, profileImageUrl: true },
        },
        group: {
          include: {
            program: true,
            challenge: { select: { startDate: true, endDate: true } },
          },
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

    // Phase 8 (fan-out model) — score is per-group. Each report fans
    // out to one ScoreEvent per selected group, so summing by groupId
    // gives the participant's score within that specific group context.
    const scoreAgg = await this.prisma.scoreEvent.aggregate({
      _sum: { points: true },
      where: {
        participantId: pg.participantId,
        groupId: multi.activeGroupId,
        createdAt: { gte: todayStart },
      },
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

    // ── Catch-up state ──────────────────────────────────────────────────
    // Resolved entirely server-side so the client never has to check
    // dates / sessions / master flag separately. When the master flag
    // is off we hand back null and the participant UI suppresses the
    // entire surface with a single conditional.
    const program = pg.group.program;
    const todayLocal = formatLocalDate(new Date());
    let catchUp: PortalContext['catchUp'] = null;
    let activeCatchUpSession: PortalContext['activeCatchUpSession'] = null;
    if (program.catchUpEnabled) {
      // Two cheap reads, both indexed: the today-row check (unique key)
      // and the active-session lookup (same row when present).
      const sessionToday = await this.prisma.catchUpSession.findUnique({
        where: {
          participantId_programId_availabilityDate: {
            participantId: pg.participantId,
            programId,
            availabilityDate: todayLocal,
          },
        },
      });
      const todayInList = (program.catchUpAvailableDates ?? []).includes(todayLocal);
      catchUp = {
        enabled: true,
        // "Available" requires the master flag, today in the configured
        // dates, AND no session row already exists for today (one
        // activation per participant per program per available date).
        availableToday: todayInList && !sessionToday,
        buttonLabel: program.catchUpButtonLabel,
        confirmTitle: program.catchUpConfirmTitle,
        confirmBody: program.catchUpConfirmBody,
        durationMinutes: program.catchUpDurationMinutes,
        allowedDaysBack: program.catchUpAllowedDaysBack,
        bannerText: program.catchUpBannerText,
      };
      if (sessionToday && sessionToday.endedAt === null && sessionToday.expiresAt > new Date()) {
        activeCatchUpSession = {
          id: sessionToday.id,
          expiresAt: sessionToday.expiresAt.toISOString(),
          allowedDaysBack: sessionToday.allowedDaysBack,
          bannerText: sessionToday.bannerText,
        };
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
      groups: multi.groups,
      activeGroupId: multi.activeGroupId,
      program: {
        id: pg.group.program.id,
        name: pg.group.program.name,
        isActive: pg.group.program.isActive,
        profileTabEnabled: pg.group.program.profileTabEnabled,
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
      catchUp,
      activeCatchUpSession,
    };
  }

  // ─── Catch-up mode ─────────────────────────────────────────────────────────
  // Open a session that allows the participant to backdate up to N
  // days (snapshotted from program config). Read-side gating + the
  // (participantId, programId, availabilityDate) unique constraint
  // together guarantee one activation per participant per program per
  // available local-Jerusalem date. Emits a public FeedEvent per active
  // group so the activation is transparent in the group feed.
  async startCatchUpSession(token: string, programId: string): Promise<{
    id: string;
    expiresAt: string;
    durationMinutes: number;
    allowedDaysBack: number;
    bannerText: string | null;
  }> {
    if (!programId) throw new BadRequestException('programId נדרש');
    const multi = await this.resolveMultiGroup(token);
    if (multi.programId !== programId) {
      throw new BadRequestException('התוכנית לא תואמת את המשתתפת');
    }
    const program = await this.prisma.program.findUnique({
      where: { id: programId },
      select: {
        id: true, name: true, isActive: true,
        catchUpEnabled: true,
        catchUpDurationMinutes: true,
        catchUpAllowedDaysBack: true,
        catchUpAvailableDates: true,
        catchUpBannerText: true,
      },
    });
    if (!program || !program.isActive) throw new NotFoundException('התוכנית אינה פעילה');
    if (!program.catchUpEnabled) {
      throw new BadRequestException('מצב השלמה אינו פעיל');
    }
    const todayLocal = formatLocalDate(new Date());
    if (!(program.catchUpAvailableDates ?? []).includes(todayLocal)) {
      throw new BadRequestException('מצב השלמה לא מופעל היום');
    }
    if (program.catchUpAllowedDaysBack < 1) {
      throw new BadRequestException('מספר הימים אחורה לא תקין');
    }

    // Conflict check against today's row (the @@unique key). If an
    // active row exists, return it — double-tapping the button just
    // adopts the in-flight session. If a row exists but already
    // expired, this still rejects (per "one activation per available
    // date" — the day is consumed even if the timer already ran out).
    const existing = await this.prisma.catchUpSession.findUnique({
      where: {
        participantId_programId_availabilityDate: {
          participantId: multi.participantId,
          programId,
          availabilityDate: todayLocal,
        },
      },
    });
    if (existing) {
      const stillRunning = existing.endedAt === null && existing.expiresAt > new Date();
      if (stillRunning) {
        return {
          id: existing.id,
          expiresAt: existing.expiresAt.toISOString(),
          durationMinutes: existing.durationMinutes,
          allowedDaysBack: existing.allowedDaysBack,
          bannerText: existing.bannerText,
        };
      }
      throw new BadRequestException('כבר השתמשת במצב השלמה היום');
    }

    // Snapshot the program config now. Editing the program later does
    // NOT change a session that's already running.
    const startedAt = new Date();
    const expiresAt = new Date(startedAt.getTime() + program.catchUpDurationMinutes * 60_000);

    let session;
    try {
      session = await this.prisma.catchUpSession.create({
        data: {
          participantId: multi.participantId,
          programId,
          availabilityDate: todayLocal,
          startedAt,
          expiresAt,
          durationMinutes: program.catchUpDurationMinutes,
          allowedDaysBack: program.catchUpAllowedDaysBack,
          bannerText: program.catchUpBannerText,
        },
      });
    } catch (e) {
      // Race: two browser tabs starting at once. The unique key catches
      // it; the loser reads the winner's row and adopts.
      if (isUniqueViolation(e)) {
        const won = await this.prisma.catchUpSession.findUnique({
          where: {
            participantId_programId_availabilityDate: {
              participantId: multi.participantId,
              programId,
              availabilityDate: todayLocal,
            },
          },
        });
        if (won) {
          return {
            id: won.id,
            expiresAt: won.expiresAt.toISOString(),
            durationMinutes: won.durationMinutes,
            allowedDaysBack: won.allowedDaysBack,
            bannerText: won.bannerText,
          };
        }
      }
      throw e;
    }

    // Activation feed event — one row per active group of this
    // participant in this program (matches the regular fan-out shape).
    // Publicly visible so the group sees catch-up mode being entered.
    // Built-in default carries duration + days-back numbers so the
    // group context is self-describing.
    const participant = await this.prisma.participant.findUnique({
      where: { id: multi.participantId },
      select: { firstName: true, lastName: true },
    });
    const fullName = participant
      ? [participant.firstName, participant.lastName].filter(Boolean).join(' ')
      : 'משתתפת';
    const message = defaultCatchUpActivationMessage(
      fullName, program.catchUpDurationMinutes, program.catchUpAllowedDaysBack,
    );
    for (const g of multi.groups) {
      await this.prisma.feedEvent.create({
        data: {
          participantId: multi.participantId,
          programId,
          groupId: g.id,
          type: 'system',
          message,
          points: 0,
          isPublic: true,
          metadata: { catchUpSessionId: session.id, expiresAt: expiresAt.toISOString() },
        },
      });
    }

    return {
      id: session.id,
      expiresAt: session.expiresAt.toISOString(),
      durationMinutes: session.durationMinutes,
      allowedDaysBack: session.allowedDaysBack,
      bannerText: session.bannerText,
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
      // Legacy single-group hint. New clients send `groupIds` instead.
      // Used as the only entry of the fan-out set when groupIds is omitted.
      groupId?: string;
      // Phase 8 fan-out — all active groups the participant chose to
      // credit. One UserActionLog row, one direct ScoreEvent per group,
      // one FeedEvent per group. Validated against her active
      // memberships; falls back silently to the primary when omitted.
      groupIds?: string[];
      // Catch-up mode — when set, the action is credited to that local
      // Asia/Jerusalem date instead of today. Requires an active
      // CatchUpSession; daysBack must be within session.allowedDaysBack;
      // future dates are rejected.
      effectiveDate?: string;
    },
    idempotencyKey?: string,
  ): Promise<{
    pointsEarned: number;
    actionPoints: number;
    bonusPoints: number;
    bonuses: { ruleId: string; ruleName: string | null; points: number }[];
    todayScore: number;
    todayValue: number | null;
  }> {
    const multi = await this.resolveMultiGroup(token, dto.groupId);
    const { participantId, programId, activeGroupId } = multi;

    // ── Catch-up validation ────────────────────────────────────────────────
    // When effectiveDate is present we resolve it against an active
    // session and compute the credited createdAt + the day-suffix that
    // gets appended to the FeedEvent message. Both stay null when this
    // is a normal "today" submission; the engine then falls through to
    // its existing now()-based behavior with no semantic change.
    const todayLocal = formatLocalDate(new Date());
    let creditedAt: Date | null = null;
    let messageSuffix: string = '';
    if (dto.effectiveDate && dto.effectiveDate !== todayLocal) {
      const session = await this.prisma.catchUpSession.findFirst({
        where: {
          participantId,
          programId,
          endedAt: null,
          expiresAt: { gt: new Date() },
        },
        orderBy: { startedAt: 'desc' },
      });
      if (!session) {
        throw new BadRequestException('אין סשן מצב השלמה פעיל');
      }
      // daysBack is calendar-day distance in Asia/Jerusalem.
      const daysBack = daysBetweenLocalDates(dto.effectiveDate, todayLocal);
      if (daysBack < 0) {
        throw new BadRequestException('לא ניתן לדווח לתאריך עתידי');
      }
      if (daysBack > session.allowedDaysBack) {
        throw new BadRequestException(
          `לא ניתן לדווח יותר מ-${session.allowedDaysBack} ימים אחורה`,
        );
      }
      creditedAt = jerusalemNoonUtc(dto.effectiveDate);
      messageSuffix = backdatedDaySuffix(daysBack);
    }

    // Resolve fan-out target set:
    //   - explicit `groupIds` → use those (validated below)
    //   - else explicit `groupId` → single-group submission
    //   - else default to ALL the participant's active groups
    const requestedSet = (dto.groupIds && dto.groupIds.length > 0)
      ? dto.groupIds
      : (dto.groupId ? [dto.groupId] : multi.groups.map((g) => g.id));

    // Strict membership validation — every fan-out target must be one of
    // the participant's currently active memberships in this program.
    // resolveMultiGroup already enforces multiGroupEnabled and same-program;
    // we just intersect the request with that set.
    const validIds = new Set(multi.groups.map((g) => g.id));
    const fanOutGroupIds = Array.from(new Set(requestedSet.filter((id) => validIds.has(id))));
    if (fanOutGroupIds.length === 0) fanOutGroupIds.push(activeGroupId);

    // Primary group: write through gameEngine.logAction (UserActionLog +
    // primary ScoreEvent + primary FeedEvent + rule firings + streak
    // update). Rule firings stay attached to the primary group only —
    // fanning rules out would clash with the partial unique index on
    // (participantId, sourceId, bucketKey). Direct action points + the
    // social-feed entry are the things participants notice; rule
    // bonuses are inherited program-wide via the personal score paths.
    const primaryGroupId = fanOutGroupIds[0];
    const result = await this.gameEngine.logAction({
      participantId,
      programId,
      groupId: primaryGroupId,
      actionId: dto.actionId,
      value: dto.value,
      contextJson: dto.contextJson,
      extraText: dto.extraText,
      clientSubmissionId: idempotencyKey,
      // Catch-up backdating: when set, the engine writes UserActionLog,
      // ScoreEvent and FeedEvent with createdAt = creditedAt and the
      // message gets the suffix appended. occurredAt stays now() via
      // the @default(now()) on the column.
      creditedAt: creditedAt ?? undefined,
      messageSuffix: messageSuffix || undefined,
    });

    // Fan-out: one ScoreEvent + one FeedEvent per additional group, all
    // pointing at the same UserActionLog.id. Skipped on idempotent
    // replays (the original call already wrote the fan-out rows).
    const replayed = (result as { replayed?: boolean }).replayed === true;
    if (!replayed && result.scoreEvent && fanOutGroupIds.length > 1) {
      const primaryFeed = await this.prisma.feedEvent.findFirst({
        where: { logId: result.log.id, groupId: primaryGroupId, type: 'action' },
        select: { message: true },
      });
      const extraGroupIds = fanOutGroupIds.slice(1);
      for (const gid of extraGroupIds) {
        await this.prisma.scoreEvent.create({
          data: {
            participantId,
            programId,
            groupId: gid,
            sourceType: 'action',
            sourceId: dto.actionId,
            logId: result.log.id,
            points: result.scoreEvent.points,
            // Backdate the fanned-out rows the same way the primary
            // row was backdated. Without this, per-group leaderboards
            // would credit yesterday's catch-up report to today on the
            // non-primary groups.
            ...(creditedAt ? { createdAt: creditedAt } : {}),
          },
        });
        if (primaryFeed?.message) {
          await this.prisma.feedEvent.create({
            data: {
              participantId,
              programId,
              groupId: gid,
              type: 'action',
              // The primary FeedEvent already has the day-suffix baked
              // into its message (the engine appended it before write),
              // so reading primaryFeed.message and copying it gives
              // every fan-out group the suffix for free.
              message: primaryFeed.message,
              points: result.scoreEvent.points,
              isPublic: true,
              logId: result.log.id,
              ...(creditedAt ? { createdAt: creditedAt } : {}),
            },
          });
        }
      }
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // Phase 8 (fan-out model) — today's score within the selected group.
    // The fan-out write above made sure the report landed on every
    // selected group, so this same query returns the right number for
    // any group the participant is currently viewing.
    const scoreAgg = await this.prisma.scoreEvent.aggregate({
      _sum: { points: true },
      where: { participantId, groupId: primaryGroupId, createdAt: { gte: todayStart } },
    });

    const action = await this.prisma.gameAction.findUnique({ where: { id: dto.actionId } });
    let todayValue: number | null = null;
    if (action) {
      // todayValues / counts read from UserActionLog which is
      // (participant, program) scoped — there's only ever one log row
      // per submission regardless of group, so the day-level "have I
      // done this today?" answer is the same across groups.
      if (action.inputType === 'number') {
        todayValue = await this.getEffectiveDailyValue(
          participantId, programId, dto.actionId, todayStart, action.aggregationMode,
        );
      } else {
        todayValue = await this.prisma.userActionLog.count({
          where: {
            participantId,
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
    //
    // Split the response so the success animation can label "+20 action"
    // and "+60 bonus · <ruleName>" distinctly instead of conflating them
    // into a single "+80" that misleads the participant about how the
    // points were earned.
    const actionPoints = result.scoreEvent ? result.scoreEvent.points : 0;
    const firedRuleResults = result.ruleResults.filter(
      (r: { fired: boolean; points?: number }) => r.fired,
    );
    const bonusPoints = firedRuleResults.reduce(
      (sum: number, r: { points?: number }) => sum + (r.points ?? 0),
      0,
    );
    // Look up rule names for any fired rules so the UI can name the
    // bonus ("בונוס: <ruleName>") rather than just show a number. One
    // tiny extra query per submission; only runs when a rule fired.
    let bonuses: { ruleId: string; ruleName: string | null; points: number }[] = [];
    if (firedRuleResults.length > 0) {
      const ruleIds = firedRuleResults.map((r: { ruleId: string }) => r.ruleId);
      const rulesById = new Map(
        (await this.prisma.gameRule.findMany({
          where: { id: { in: ruleIds } },
          select: { id: true, name: true },
        })).map((r) => [r.id, r.name] as const),
      );
      bonuses = firedRuleResults.map((r: { ruleId: string; points?: number }) => ({
        ruleId: r.ruleId,
        ruleName: rulesById.get(r.ruleId) ?? null,
        points: r.points ?? 0,
      }));
    }

    // ── Fan-out invariant guardrail ────────────────────────────────────
    // Detect any (logId, groupId) with > 1 action ScoreEvent. The
    // participant-portal flow is supposed to write exactly one action
    // SE per group: gameEngine.logAction creates one for primaryGroupId,
    // the fan-out loop creates one per id in extraGroupIds (slice(1)
    // dedupes against primary), and dto.groupIds is itself deduped via
    // `new Set(...)`. If a duplicate ever lands, log loudly. This is a
    // permanent guardrail — it catches future regressions that would
    // silently double a participant's per-group score.
    const fanOutAudit = await this.prisma.scoreEvent.groupBy({
      by: ['groupId'],
      where: { logId: result.log.id, sourceType: 'action' },
      _count: { _all: true },
    });
    const dups = fanOutAudit.filter((row) => row._count._all > 1);
    if (dups.length > 0) {
      // eslint-disable-next-line no-console
      console.error(
        '[scoring-invariant-breach] fan-out duplicates log=%s rows=%j fanOutGroupIds=%j',
        result.log.id, dups, fanOutGroupIds,
      );
    }

    return {
      // pointsEarned kept for backwards-compat with any pre-existing
      // caller that may have read it. New surfaces should prefer the
      // explicit actionPoints / bonusPoints split below.
      pointsEarned: actionPoints + bonusPoints,
      actionPoints,
      bonusPoints,
      bonuses,
      todayScore: scoreAgg._sum.points ?? 0,
      todayValue,
    };
  }

  // ─── Stats tab ─────────────────────────────────────────────────────────────

  async getPortalStats(token: string, requestedGroupId?: string): Promise<PortalStats> {
    // Phase 8 (fan-out model) — score is per-group. The participant
    // chose at log time which groups to credit; this query reads back
    // the events stamped with the currently-selected group.
    //   - personal totals: SUM by (participant, groupId)
    //   - leaderboard: members of the selected group + their per-group totals
    //   - feed: events stamped with the selected group's id
    // Streak stays (participant, program)-scoped (one row by schema).
    const multi = await this.resolveMultiGroup(token, requestedGroupId);
    const { participantId, programId, activeGroupId: groupId } = multi;

    const now = new Date();
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay()); weekStart.setHours(0, 0, 0, 0);

    // Personal scores per group: only events stamped with this groupId.
    const [todayAgg, weekAgg, totalAgg, streak] = await Promise.all([
      this.prisma.scoreEvent.aggregate({ _sum: { points: true }, where: { participantId, groupId, createdAt: { gte: todayStart } } }),
      this.prisma.scoreEvent.aggregate({ _sum: { points: true }, where: { participantId, groupId, createdAt: { gte: weekStart } } }),
      this.prisma.scoreEvent.aggregate({ _sum: { points: true }, where: { participantId, groupId } }),
      this.gameEngine.getStreakLive(participantId, programId),
    ]);

    // 14-day daily trend — also per-group.
    const dailyTrend = await this.buildDailyTrend(participantId, groupId, 14);

    // Group leaderboard. Members of the selected group; totals come
    // from ScoreEvents stamped with that groupId. Member-set + groupId
    // double filter protects against members who have since left
    // pulling old events into the wrong leaderboard.
    const members = await this.prisma.participantGroup.findMany({
      where: { groupId, isActive: true, group: { isActive: true } },
      include: { participant: { select: { id: true, firstName: true, lastName: true, profileImageUrl: true } } },
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
        profileImageUrl: m.participant.profileImageUrl ?? null,
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

  async getPortalFeed(token: string, requestedGroupId?: string): Promise<PortalFeedItem[]> {
    // Phase 8 (fan-out model) — feed scopes by FeedEvent.groupId. The
    // log endpoint writes one FeedEvent per group the participant
    // selected, so each group only sees events the participant
    // explicitly credited to it. No member-set duplicates; no leakage
    // from groups she opted out of.
    //
    // Time semantics: this surface represents REAL-TIME ACTIVITY, so
    // the 48h window, ordering, and per-row timestamp all read
    // FeedEvent.occurredAt — the wall-clock instant the participant
    // tapped submit. createdAt is the credited/scoring date and for
    // catch-up backdated reports it points at the credited day, NOT
    // wall-clock now; using it here would push catch-up rows backward
    // in the feed and out of the 48h window.
    //
    // Product behavior is "show the last 48 hours". The take ceiling
    // below is a SAFETY ceiling, not the product limit — it only
    // prevents runaway payloads when a group has an unusually high
    // event volume in 48 hours (mass imports, future automation,
    // misconfigured rules). Normal groups produce dozens of rows per
    // day, well under the ceiling. Do not lower it below the product
    // intent of "show 48 hours" — and do not load more than this
    // many rows in a single response.
    const multi = await this.resolveMultiGroup(token, requestedGroupId);
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const events = await this.prisma.feedEvent.findMany({
      where: {
        groupId: multi.activeGroupId,
        isPublic: true,
        occurredAt: { gte: since },
      },
      orderBy: { occurredAt: 'desc' },
      take: 1500,
      include: {
        participant: { select: { id: true, firstName: true, lastName: true, profileImageUrl: true } },
      },
    });
    return events.map((e) => ({
      id: e.id,
      message: e.message,
      points: e.points,
      occurredAt: e.occurredAt.toISOString(),
      participant: {
        id: e.participant.id,
        firstName: e.participant.firstName,
        lastName: e.participant.lastName,
        profileImageUrl: e.participant.profileImageUrl ?? null,
      },
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
      // AnalyticsGroup.id.
      //
      // Phase 6.3: group aggregation is now CONTEXT-LEVEL, not value-level.
      // Each pie slice represents one member context (e.g. ארוחות / שינה /
      // מים), valued by the total points from logs where that context is
      // populated. The previous value-level model mixed unrelated values
      // from different contexts into the same pie, which was confusing and
      // semantically wrong. Single-context views (context:<key>) keep the
      // existing value-level behavior via breakdownByContext.
      const groupId = groupBy.slice('group:'.length);
      if (!groupId) throw new BadRequestException('groupBy=group: requires a group id');
      const members = await this.prisma.contextDefinition.findMany({
        where: { programId, analyticsGroupId: groupId, isActive: true },
        select: { key: true },
      });
      const memberKeys = members.map((m) => m.key);
      if (memberKeys.length === 0) return [];
      return this.breakdownByContextGroup(participantId, programId, since, until, memberKeys);
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
        inputMode: true,
        optionsJson: true,
        analyticsDisplayLabel: true,
      },
    });
    const labelByKey = new Map<string, string>();
    const optionLabelByKey = new Map<string, Map<string, string>>();
    // Phase 6.4: mark system-fixed / text-only keys. When emitting rows for
    // these contexts we replace the technical raw value (e.g. "tracked",
    // "logged") with a localized auto-recorded indicator, since those tokens
    // are internal plumbing the participant shouldn't see in analytics.
    const isSystemByKey = new Map<string, boolean>();
    for (const d of definitions) {
      labelByKey.set(d.key, d.analyticsDisplayLabel?.trim() || d.label);
      isSystemByKey.set(
        d.key,
        d.inputMode === 'system_fixed' || d.type === 'text',
      );
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

    // Drill-down target handling. Three input shapes are supported:
    //
    //   1. Phase 6.3 group slices (context-level) — `opts.value` is exactly
    //      a memberKey. Emit every log where that context is populated,
    //      regardless of value. The per-row `valueLabel` still resolves to
    //      the actual option label so the sheet stays readable.
    //
    //   2. Phase 4.8 compound-value slices — `opts.value` is
    //      `${contextKey}:${value}`. Constrain match to that contextKey AND
    //      that value — precise row selection for multi-key context views.
    //
    //   3. Legacy plain value — `opts.value` is a raw option value with no
    //      colon prefix. Any memberKey whose value matches emits a row.
    //      Preserves pre-4.8 behavior for every call site that still sends
    //      bare values.
    let parsedKey: string | null = null;
    let target = String(opts.value);
    let byContextOnly = false;
    if (memberKeys.includes(target)) {
      parsedKey = target;
      byContextOnly = true;
    } else {
      const colonIdx = target.indexOf(':');
      if (colonIdx > 0) {
        const prefix = target.slice(0, colonIdx);
        if (memberKeys.includes(prefix)) {
          parsedKey = prefix;
          target = target.slice(colonIdx + 1);
        }
      }
    }
    const out: AnalyticsSliceEntry[] = [];
    for (const l of logs) {
      const ctx = l.contextJson as Record<string, unknown> | null;
      if (!ctx) continue;
      // Find which member key in this log matches the tapped value. A single
      // log may carry multiple matching members (rare — e.g. two contexts in
      // one group both happen to equal the same value); emit one row per.
      for (const k of memberKeys) {
        if (parsedKey !== null && k !== parsedKey) continue;
        const raw = ctx[k];
        if (raw === undefined || raw === null || raw === '') continue;
        if (!byContextOnly && String(raw) !== target) continue;
        // Label resolution: reusable first, local schema fallback.
        // When byContextOnly=true, `target` is the contextKey (not a value),
        // so resolve valueLabel off this row's actual raw value instead.
        const rowValue = String(raw);
        const labelLookupValue = byContextOnly ? rowValue : target;
        let dimensionLabel = labelByKey.get(k) ?? null;
        let valueLabel =
          optionLabelByKey.get(k)?.get(labelLookupValue) ?? null;
        if (!dimensionLabel || !valueLabel) {
          const fallback = localLabelsForAction(l.action, k);
          if (fallback) {
            dimensionLabel = dimensionLabel ?? fallback.dimensionLabel;
            valueLabel =
              valueLabel ?? fallback.options.get(labelLookupValue) ?? null;
          }
        }
        // Phase 6.4 drill-down polish. System-fixed / text-only contexts
        // store internal tokens (e.g. "tracked", "logged") as their raw
        // value. Surfacing those in the drill-down sheet is confusing —
        // the participant never typed them and they read as noise. Replace
        // the value label with a localized "auto-recorded" marker so the
        // row still reads naturally ("שינה · נרשם אוטומטית") without
        // leaking implementation details.
        const isSystemCtx = isSystemByKey.get(k) === true;
        const finalValueLabel = isSystemCtx
          ? 'נרשם אוטומטית'
          : valueLabel ?? labelLookupValue;
        out.push({
          logId: l.id,
          date: formatLocalDate(l.createdAt),
          time: formatLocalHourMinute(l.createdAt),
          actionId: l.action.id,
          actionName: l.action.name,
          contextKey: k,
          contextLabel: dimensionLabel ?? k,
          valueLabel: finalValueLabel,
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

    // Phase 4.8 (audit fix): fetch definitions first so we can filter out
    // system-fixed and text-type members BEFORE any other work. These
    // contexts contribute a single constant/opaque value per log and produce
    // meaningless 100%-ish slices in the pie — they don't belong in a value
    // breakdown. Non-definition-backed keys (legacy per-action local
    // dimensions) are kept; they carry real participant-reported values.
    const definitions = await this.prisma.contextDefinition.findMany({
      where: { programId, key: { in: dimensionKeys } },
      select: { key: true, optionsJson: true, type: true, inputMode: true },
    });
    const excludedKeys = new Set<string>();
    for (const def of definitions) {
      if (def.inputMode === 'system_fixed' || def.type === 'text') {
        excludedKeys.add(def.key);
      }
    }
    const effectiveKeys = dimensionKeys.filter((k) => !excludedKeys.has(k));
    if (effectiveKeys.length === 0) return [];
    const effectiveKeySet = new Set(effectiveKeys);

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

    // Label resolution spans every effective member key. Reusable labels
    // from each definition merge into one value→label map; action-local
    // schema labels are a per-action fallback for legacy dimensions.
    const reusableLabels = new Map<string, string>();
    for (const def of definitions) {
      if (excludedKeys.has(def.key)) continue;
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
        if (!d.key || !effectiveKeySet.has(d.key)) continue;
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

    // Phase 4.8 bucket key is COMPOUND: `${contextKey}:${value}`.
    //   - Prevents collisions when two member keys share a value string
    //     (e.g. two contexts that both have an option "morning" won't
    //     silently merge into one slice).
    //   - Each slice is uniquely identified by its dimension + value pair.
    // Multi-context contribution is preserved: a log that fills two member
    // keys still contributes to both buckets.
    const totals: Record<string, { points: number; count: number; label: string }> = {};
    for (const l of logs) {
      const ctx = l.contextJson as Record<string, unknown> | null;
      if (!ctx) continue;
      const pts = pointsByLog[l.id] ?? 0;
      for (const k of effectiveKeys) {
        const raw = ctx[k];
        if (raw === undefined || raw === null || raw === '') continue;
        const value = String(raw);
        const bucketKey = `${k}:${value}`;
        const label = resolveLabel(l.actionId, value);
        const entry = totals[bucketKey] ?? { points: 0, count: 0, label };
        entry.points += pts;
        entry.count += 1;
        if (entry.label === value && label !== value) entry.label = label;
        totals[bucketKey] = entry;
      }
    }

    const rows: AnalyticsBreakdownEntry[] = Object.entries(totals).map(
      ([bucketKey, v]) => ({
        actionId: bucketKey,   // compound "contextKey:value" — unique per dim+value
        actionName: v.label,   // resolved human label (option label, else raw value)
        totalPoints: v.points,
        count: v.count,
      }),
    );
    rows.sort((a, b) => b.totalPoints - a.totalPoints || b.count - a.count);
    return rows;
  }

  /**
   * Phase 6.3 — group-view aggregation, CONTEXT-LEVEL.
   *
   * Each slice represents one member context (e.g. "ארוחות", "שינה", "מים")
   * rather than a value within a context. A log contributes its points to
   * every member context that has a non-empty value in its contextJson.
   *
   * Why this is different from breakdownByContext:
   *   - breakdownByContext (single context / compound-bucket) is value-level.
   *     It's right when the pie answers "within this one dimension, which
   *     values contributed the most?".
   *   - breakdownByContextGroup is context-level. It answers "within this
   *     group of dimensions, which dimensions contributed the most?".
   *     Mixing values from different dimensions into one pie is nonsense
   *     ("morning" from meal_period vs "morning" from sleep_quality aren't
   *     the same slice), so groups use this model instead.
   *
   * System-fixed / text-type contexts are INCLUDED here. They represent
   * something meaningful ("this log was part of the routine") — we just
   * can't slice them by value, which is exactly why the slice is the
   * whole context.
   *
   * Response shape (reused from AnalyticsBreakdownEntry):
   *   actionId   — the context key (opaque identifier for drill-down)
   *   actionName — the context's display label
   *   totalPoints/count — aggregated over logs where the context is populated
   */
  private async breakdownByContextGroup(
    participantId: string,
    programId: string,
    since: Date | null,
    until: Date,
    groupMemberKeys: string[],
  ): Promise<AnalyticsBreakdownEntry[]> {
    if (groupMemberKeys.length === 0) return [];

    const logs = await this.prisma.userActionLog.findMany({
      where: {
        participantId,
        programId,
        status: 'active',
        ...(since
          ? { createdAt: { gte: since, lte: until } }
          : { createdAt: { lte: until } }),
      },
      select: { id: true, contextJson: true },
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

    // Resolve a display label per member context. Prefer the per-context
    // `analyticsDisplayLabel` (the short analytics label the admin sets),
    // fall back to the full `label`, and finally to the raw key.
    const definitions = await this.prisma.contextDefinition.findMany({
      where: { programId, key: { in: groupMemberKeys } },
      select: { key: true, label: true, analyticsDisplayLabel: true },
    });
    const labelByKey = new Map<string, string>();
    for (const def of definitions) {
      labelByKey.set(def.key, def.analyticsDisplayLabel?.trim() || def.label);
    }

    // Bucket by context key. A single log with multiple member values
    // contributes to each member's slice — consistent with how the per-
    // context breakdown handles multi-value logs.
    const totals: Record<string, { points: number; count: number }> = {};
    for (const l of logs) {
      const ctx = l.contextJson as Record<string, unknown> | null;
      if (!ctx) continue;
      const pts = pointsByLog[l.id] ?? 0;
      for (const k of groupMemberKeys) {
        const raw = ctx[k];
        if (raw === undefined || raw === null || raw === '') continue;
        const entry = totals[k] ?? { points: 0, count: 0 };
        entry.points += pts;
        entry.count += 1;
        totals[k] = entry;
      }
    }

    const rows: AnalyticsBreakdownEntry[] = Object.entries(totals).map(
      ([k, v]) => ({
        actionId: k, // context key — drill-down matches this against memberKeys
        actionName: labelByKey.get(k) ?? k,
        totalPoints: v.points,
        count: v.count,
      }),
    );
    rows.sort((a, b) => b.totalPoints - a.totalPoints || b.count - a.count);
    return rows;
  }

  // ─── Phase 6.1: insights engine (expanded library + strict eligibility) ───
  //
  // Deterministic, no-AI pipeline with 16 candidate types across 5 families.
  // Every type has explicit minimum-data rules and a score floor; anything
  // that doesn't meet them is dropped rather than shown as a weak/generic
  // placeholder. Selection enforces family diversity (1 per family in the
  // strict pass, up to 2 per family only if slots remain open).
  //
  // Types, by family:
  //   performance  — strongest, weakest, dominant_source,
  //                  balanced_distribution, missing_category
  //   change       — trend, most_improved, most_declined
  //   time         — best_day, weekday_pattern, strongest_hour_range,
  //                  activity_comeback
  //   behavior     — high_concentration, low_engagement
  //   consistency  — consistency, consistent_streak
  //
  // Data sources: ScoreEvent ledger for current range + one previous-period
  // fetch (per-action). No extra queries per type.
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

    const [events, actions, programConfig, typeUsageRows] = await Promise.all([
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
      // Phase 6.8: per-program insight strategy config. Each program has
      // its own strategy + tuning — no cross-program interference.
      this.prisma.program.findUnique({
        where: { id: programId },
        select: {
          insightSelectionStrategy: true,
          insightDiversityStrength: true,
        },
      }),
      // Phase 6.8: per-program per-type usage counts. Replaces the global
      // singleton counter. Empty array when a program has never had insights
      // selected — which is the correct starting state.
      this.prisma.programInsightTypeUsage.findMany({
        where: { programId },
        select: { insightType: true, count: true },
      }),
    ]);
    // Resolve strategy config with defaults that match a fresh Program row.
    const selectionStrategy =
      programConfig?.insightSelectionStrategy ?? 'score_with_diversity';
    const diversityStrength = programConfig?.insightDiversityStrength ?? 0.3;
    const typeUsageByProgram: Record<string, number> = {};
    for (const row of typeUsageRows) {
      typeUsageByProgram[row.insightType] = row.count;
    }

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
    const submissionsByAction = new Map<string, number>();
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
      // Submission count: one scoreEvent per actual participant submission
      // (sourceType='action'). Corrections are not submissions — they're
      // retroactive point adjustments.
      if (e.sourceType === 'action' && e.sourceId) {
        submissionsByAction.set(
          e.sourceId,
          (submissionsByAction.get(e.sourceId) ?? 0) + 1,
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
    const totalSubmissions = Array.from(submissionsByAction.values()).reduce(
      (a, b) => a + b,
      0,
    );

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

    // ── Phase 6.3 concept model ─────────────────────────────────────────
    // Concept is a tighter grouping than the old "family" — two insights
    // that tell the same story at different angles (e.g. "strongest
    // category" + "dominant source" + "high concentration" all say the
    // participant's effort is concentrated in one place) share a concept.
    // Selection keeps at most one insight per concept in the strict pass;
    // a relaxed pass allows a second only for non-pattern concepts.
    type InsightConcept =
      | 'dominance'    // concentration/leader
      | 'improvement'  // positive change / growth / decline
      | 'pattern'      // temporal patterns
      | 'consistency'  // streaks + active-ratio + comebacks
      | 'coverage'     // balance / gaps in category footprint
      | 'engagement';  // raw volume signal
    // Phase 6.5: focusKey identifies the CATEGORY this insight is "about"
    // (e.g. "הליכה"). Two insights from different concepts but sharing a
    // focus — e.g. "הכי השתפרת ב־הליכה" + "70% הגיעו מ־הליכה" — tell the
    // same narrative to the participant and should collapse to one.
    // null = insight isn't tied to any single category (temporal, aggregate,
    // engagement, etc.) — these never collide with each other.
    type Candidate = AnalyticsInsight & {
      concept: InsightConcept;
      focusKey: string | null;
    };
    const candidates: Candidate[] = [];
    // Per-insight score floor: anything below drops entirely. Keeps the card
    // free of weak, low-information insights even when they technically fire.
    const MIN_SCORE = 18;
    // Active days across the range — used by multiple eligibility gates.
    const activeCount = days.filter((d) => d.points > 0).length;

    // ╔════════════════════════════════════════════════════════════════════╗
    // ║ PERFORMANCE family                                                 ║
    // ╚════════════════════════════════════════════════════════════════════╝

    // strongest — concept: dominance. ≥2 categories AND ≥30% dominance.
    if (categories.length >= 2) {
      const top = categories[0];
      const second = categories[1];
      const dominance = (top.points - second.points) / second.points;
      if (dominance >= 0.3) {
        candidates.push({
          type: 'strongest',
          concept: 'dominance',
          focusKey: top.name,
          icon: '⭐',
          text: `התחזקת במיוחד ב־${top.name}`,
          score: Math.min((1 + dominance) * 20, 80),
        });
      }
    }

    // weakest — concept: coverage. Phase 6.3: score multiplier 80 → 55 so
    // this insight no longer dominates top-4 for participants with mildly
    // uneven distributions.
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
            concept: 'coverage',
            focusKey: weakest.name,
            icon: '📌',
            text: `יש לך מקום לשיפור ב־${weakest.name}`,
            score: gap * 55,
          });
        }
      }
    }

    // dominant_source — concept: dominance. Phase 6.3 boosted (80 → 95):
    // a true dominant source is high-information and actionable.
    if (categories.length >= 2) {
      const totalPts = categories.reduce((s, c) => s + c.points, 0);
      if (totalPts > 0) {
        const share = categories[0].points / totalPts;
        if (share >= 0.6) {
          candidates.push({
            type: 'dominant_source',
            concept: 'dominance',
            focusKey: categories[0].name,
            icon: '🔥',
            text: `${Math.round(share * 100)}% מהנקודות שלך הגיעו מ־${categories[0].name}`,
            score: share * 95,
          });
        }
      }
    }

    // balanced_distribution — concept: coverage. Fires for participants
    // whose effort IS spread — the symmetric answer to dominant_source.
    if (categories.length >= 4) {
      const totalPts = categories.reduce((s, c) => s + c.points, 0);
      if (totalPts > 0) {
        const share = categories[0].points / totalPts;
        if (share <= 0.4) {
          candidates.push({
            type: 'balanced_distribution',
            concept: 'coverage',
            focusKey: null,
            icon: '🧩',
            text: 'יש לך פיזור יפה בין כמה תחומים',
            score: (0.5 - share) * 160,
          });
        }
      }
    }

    // missing_category — concept: coverage. Phase 6.3 boosted (60 → 85):
    // a category going from non-trivial activity to zero is a strong,
    // concrete, actionable signal and should beat generic insights.
    if (prevPointsByAction.size > 0) {
      let missed: { name: string; prev: number } | null = null;
      for (const [id, prev] of prevPointsByAction.entries()) {
        if (prev < 10) continue;
        const curr = pointsByAction.get(id) ?? 0;
        if (curr === 0 && (!missed || prev > missed.prev)) {
          missed = { name: nameById.get(id) ?? '(פעולה שנמחקה)', prev };
        }
      }
      if (missed) {
        candidates.push({
          type: 'missing_category',
          concept: 'coverage',
          focusKey: missed.name,
          icon: '🕳️',
          text: `לא הייתה פעילות בכלל ב־${missed.name}`,
          score: Math.min(missed.prev, 85),
        });
      }
    }

    // ╔════════════════════════════════════════════════════════════════════╗
    // ║ CHANGE family (vs previous equal-length period)                    ║
    // ╚════════════════════════════════════════════════════════════════════╝

    // trend — concept: improvement. Total points vs prev period.
    if (since && dayCount >= 3) {
      const currTotal = days.reduce((a, b) => a + b.points, 0);
      if (prevTotal > 0 && currTotal > 0) {
        const pct = Math.round(((currTotal - prevTotal) / prevTotal) * 100);
        if (Math.abs(pct) >= 10) {
          candidates.push({
            type: 'trend',
            concept: 'improvement',
            focusKey: null,
            icon: pct > 0 ? '📈' : '📉',
            text:
              pct > 0
                ? `שיפור של ${pct}% לעומת התקופה הקודמת`
                : `ירידה של ${Math.abs(pct)}% לעומת התקופה הקודמת`,
            score: Math.min(Math.abs(pct), 80),
          });
        }
      }
    }

    // most_improved — concept: improvement. Phase 6.3 boosted (80 → 95):
    // named per-category improvement is more specific than aggregate trend
    // and should outrank it when both qualify.
    if (prevPointsByAction.size > 0 && categories.length > 0) {
      let best: { name: string; pct: number } | null = null;
      for (const c of categories) {
        const prev = prevPointsByAction.get(c.id) ?? 0;
        if (prev < 5) continue;
        const pct = Math.round(((c.points - prev) / prev) * 100);
        if (pct >= 20 && (!best || pct > best.pct)) {
          best = { name: c.name, pct };
        }
      }
      if (best) {
        candidates.push({
          type: 'most_improved',
          concept: 'improvement',
          focusKey: best.name,
          icon: '🚀',
          text: `הכי השתפרת ב־${best.name} (+${best.pct}%)`,
          score: Math.min(best.pct, 95),
        });
      }
    }

    // most_declined — concept: improvement. Phase 6.3 boosted (80 → 95):
    // named per-category decline is actionable and deserves top ranking.
    if (prevPointsByAction.size > 0) {
      let worst: { name: string; pct: number } | null = null;
      for (const [id, prev] of prevPointsByAction.entries()) {
        if (prev < 5) continue;
        const curr = pointsByAction.get(id) ?? 0;
        const pct = Math.round(((curr - prev) / prev) * 100);
        if (pct <= -25 && (!worst || pct < worst.pct)) {
          worst = { name: nameById.get(id) ?? '(פעולה שנמחקה)', pct };
        }
      }
      if (worst) {
        candidates.push({
          type: 'most_declined',
          concept: 'improvement',
          focusKey: worst.name,
          icon: '⚠️',
          text: `יש ירידה ב־${worst.name} (${worst.pct}%)`,
          score: Math.min(Math.abs(worst.pct), 95),
        });
      }
    }

    // ╔════════════════════════════════════════════════════════════════════╗
    // ║ TIME family                                                        ║
    // ╚════════════════════════════════════════════════════════════════════╝

    // best_day — concept: pattern. Phase 6.3 truth fix: gate by ACTIVE day
    // count (≥5), not total range length. Showing "your best day" when the
    // participant has only 2 active days out of 14 is noise. Score multiplier
    // also reduced 30 → 18 because best_day was overused in earlier passes.
    if (activeCount >= 5) {
      const active = days.filter((d) => d.points > 0);
      const total = days.reduce((a, b) => a + b.points, 0);
      const avg = total / days.length;
      const best = active.reduce((bd, d) => (d.points > bd.points ? d : bd));
      const deviation = avg > 0 ? (best.points - avg) / avg : 0;
      if (deviation > 0.25) {
        candidates.push({
          type: 'best_day',
          concept: 'pattern',
          focusKey: null,
          icon: '🏆',
          text: `היום הכי חזק שלך היה ${this.formatHebrewDay(best.date)} עם ${best.points} נק׳`,
          score: Math.min(deviation * 18, 55),
        });
      }
    }

    // weekday_pattern — strict eligibility:
    //   * range must span ≥ 14 days (at least two rotations of each weekday)
    //   * the winning weekday must appear ≥3 times in the range
    //   * its points must come from ≥2 different calendar weeks — prevents
    //     "the Sunday we had 80 points" from falsely reading as "Sundays"
    //   * weekday avg must be ≥1.4× overall daily avg
    if (dayCount >= 14) {
      const pointsByWday: number[] = [0, 0, 0, 0, 0, 0, 0];
      const countsByWday: number[] = [0, 0, 0, 0, 0, 0, 0];
      // Track distinct weeks where this weekday contributed POSITIVE points.
      // Zero-point days don't count as "occurrences" for pattern claims —
      // otherwise an empty range would read as if the weekday was strong.
      const weeksByWday: Set<string>[] = Array.from(
        { length: 7 },
        () => new Set<string>(),
      );
      for (const d of days) {
        const dateUtc = new Date(`${d.date}T00:00:00.000Z`);
        const wd = dateUtc.getUTCDay();
        pointsByWday[wd] += d.points;
        countsByWday[wd] += 1;
        if (d.points > 0) {
          // ISO-week-ish bucket (UTC-based, good enough for "different weeks").
          const isoWeek = Math.floor(dateUtc.getTime() / DAY_MS / 7);
          weeksByWday[wd].add(String(isoWeek));
        }
      }
      const overallAvg = days.reduce((s, d) => s + d.points, 0) / days.length;
      if (overallAvg > 0) {
        let bestWd = -1;
        let bestAvg = 0;
        for (let i = 0; i < 7; i++) {
          if (countsByWday[i] < 3) continue; // ≥3 occurrences
          if (weeksByWday[i].size < 2) continue; // ≥2 different weeks
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
            concept: 'pattern',
            focusKey: null,
            icon: '📅',
            text: `ימי ${hebrewDays[bestWd]} הם החזקים ביותר שלך`,
            score: Math.min((bestAvg / overallAvg - 1) * 60, 80),
          });
        }
      }
    }

    // strongest_hour_range — bucket action-event timestamps into four hour
    // bands in Asia/Jerusalem. Fires when ≥50% of submissions fall in one
    // band AND the participant has ≥10 total submissions in the range.
    if (totalSubmissions >= 10) {
      type HourBand = 'morning' | 'afternoon' | 'evening' | 'night';
      const bandLabels: Record<HourBand, string> = {
        morning: '06:00–12:00',
        afternoon: '12:00–18:00',
        evening: '18:00–23:00',
        night: '23:00–06:00',
      };
      const bandCounts: Record<HourBand, number> = {
        morning: 0,
        afternoon: 0,
        evening: 0,
        night: 0,
      };
      for (const e of events) {
        if (e.sourceType !== 'action' || !e.sourceId) continue;
        const hourStr = new Intl.DateTimeFormat('en-GB', {
          timeZone: PARTICIPANT_TZ,
          hour: '2-digit',
          hour12: false,
        }).format(e.createdAt);
        const hour = parseInt(hourStr, 10);
        if (hour >= 6 && hour < 12) bandCounts.morning++;
        else if (hour >= 12 && hour < 18) bandCounts.afternoon++;
        else if (hour >= 18 && hour < 23) bandCounts.evening++;
        else bandCounts.night++;
      }
      let topBand: HourBand = 'morning';
      let topCount = 0;
      (Object.keys(bandCounts) as HourBand[]).forEach((b) => {
        if (bandCounts[b] > topCount) {
          topCount = bandCounts[b];
          topBand = b;
        }
      });
      const share = topCount / totalSubmissions;
      if (share >= 0.5) {
        candidates.push({
          type: 'strongest_hour_range',
          concept: 'pattern',
          focusKey: null,
          icon: '🕐',
          text: `השעות החזקות שלך הן ${bandLabels[topBand]}`,
          score: share * 60,
        });
      }
    }

    // activity_comeback — concept: consistency.
    //
    // Phase 6.3 truth fix (CRITICAL). A "comeback" is meaningless without a
    // real prior activity to return to. The previous implementation would
    // fire on any 3-day zero streak at the START of a range followed by two
    // active days — that's not a comeback, that's simply "started tracking".
    //
    // Correct definition:
    //   1. At least one active day BEFORE the gap (sawActive = true).
    //   2. Gap of ≥3 consecutive days with zero points.
    //   3. ≥2 consecutive active days immediately after the gap (the
    //      current day AND the next day both non-zero).
    //
    // Score multiplier reduced 10 → 6 per Phase 6.3 overuse penalty.
    if (dayCount >= 7) {
      let comebackGap = 0;
      let gap = 0;
      let sawActive = false;
      for (let i = 0; i < days.length; i++) {
        if (days[i].points === 0) {
          if (sawActive) gap++;
          continue;
        }
        if (
          sawActive &&
          gap >= 3 &&
          i + 1 < days.length &&
          days[i + 1].points > 0
        ) {
          if (gap > comebackGap) comebackGap = gap;
        }
        sawActive = true;
        gap = 0;
      }
      if (comebackGap >= 3) {
        candidates.push({
          type: 'activity_comeback',
          concept: 'consistency',
          focusKey: null,
          icon: '🔄',
          text: 'חזרת לפעילות אחרי הפסקה',
          score: Math.min(comebackGap * 6, 36),
        });
      }
    }

    // ╔════════════════════════════════════════════════════════════════════╗
    // ║ BEHAVIOR family                                                    ║
    // ╚════════════════════════════════════════════════════════════════════╝

    // high_concentration — concept: dominance (shares the concept with
    // strongest + dominant_source; concept dedup keeps only one of them).
    if (totalSubmissions >= 10 && submissionsByAction.size >= 2) {
      let topCount = 0;
      for (const c of submissionsByAction.values()) {
        if (c > topCount) topCount = c;
      }
      const share = topCount / totalSubmissions;
      if (share >= 0.7) {
        candidates.push({
          type: 'high_concentration',
          concept: 'dominance',
          focusKey: null,
          icon: '🎯',
          text: 'רוב הפעילות שלך מתמקדת בתחום אחד',
          score: share * 60,
        });
      }
    }

    // low_engagement — concept: engagement. Phase 6.3 boosted (60 → 75):
    // a genuine volume deficit is a concrete, honest, actionable signal.
    if (dayCount >= 7) {
      const perDay = totalSubmissions / dayCount;
      if (perDay < 0.5) {
        const raw = (0.5 - perDay) * 120;
        if (raw >= MIN_SCORE) {
          candidates.push({
            type: 'low_engagement',
            concept: 'engagement',
            focusKey: null,
            icon: '📉',
            text: 'כמות הפעילות שלך נמוכה בתקופה הזו',
            score: Math.min(raw, 75),
          });
        }
      }
    }

    // ╔════════════════════════════════════════════════════════════════════╗
    // ║ CONSISTENCY family                                                 ║
    // ╚════════════════════════════════════════════════════════════════════╝

    // consistency — concept: consistency. Scores are intentionally small
    // so generic consistency never beats a concrete named insight. The
    // mid-band stays silent so most participants don't see this at all.
    if (dayCount >= 7) {
      const ratio = activeCount / days.length;
      if (ratio >= 0.85) {
        candidates.push({
          type: 'consistency',
          concept: 'consistency',
          focusKey: null,
          icon: '🎯',
          text: 'היית עקבית השבוע — כל הכבוד',
          score: ratio * 22,
        });
      } else if (ratio > 0 && ratio <= 0.2) {
        candidates.push({
          type: 'consistency',
          concept: 'consistency',
          focusKey: null,
          icon: '💡',
          text: 'כדאי לנסות לשמור על עקביות גבוהה יותר',
          score: (1 - ratio) * 18,
        });
      }
    }

    // consistent_streak — concept: consistency.
    //
    // Phase 6.3 truth fix: require ACTIVE days ≥ 5 in addition to streak
    // ≥ 3. A 3-day streak on a participant with only 3 active days total
    // is trivially true (every active day is in the "streak") and says
    // nothing interesting. Gating by activeCount ensures the insight
    // represents real pattern, not a data-sparse coincidence.
    //
    // Score multiplier reduced 10 → 6 per overuse penalty.
    if (activeCount >= 5) {
      let maxStreak = 0;
      let currentStreak = 0;
      for (const d of days) {
        if (d.points > 0) {
          currentStreak++;
          if (currentStreak > maxStreak) maxStreak = currentStreak;
        } else {
          currentStreak = 0;
        }
      }
      if (maxStreak >= 3) {
        candidates.push({
          type: 'consistent_streak',
          concept: 'consistency',
          focusKey: null,
          icon: '🔥',
          text: `יש לך רצף של ${maxStreak} ימים פעילים`,
          score: Math.min(maxStreak * 6, 42),
        });
      }
    }

    // ── Phase 6.4 type-base weighting ───────────────────────────────────
    // Per-type multipliers applied to the raw score to rebalance the output
    // distribution across participants. This is NOT a change to the truth
    // conditions — every insight still must meet its own eligibility gates
    // to even exist as a candidate. The weight only nudges ranking.
    //
    // Weights < 1 gently suppress types that tend to fire for almost every
    // participant (best_day, weakest, streak, comeback, generic consistency).
    // Weights > 1 gently boost types that are named, concrete, and directly
    // actionable (most_improved, most_declined, missing_category).
    // Types not listed keep their raw score (weight = 1.0).
    const TYPE_BASE_WEIGHT: Partial<Record<AnalyticsInsightType, number>> = {
      best_day: 0.7,
      weakest: 0.8,
      consistent_streak: 0.75,
      activity_comeback: 0.6,
      consistency: 0.7,
      dominant_source: 1.0,
      most_improved: 1.1,
      most_declined: 1.1,
      missing_category: 1.05,
      low_engagement: 1.0,
    };
    // ── Phase 6.14: apply base weight + MIN_SCORE as the TRUTH GATE ─────
    //
    // Previously, the MIN_SCORE floor was applied AFTER diversity weighting.
    // That was wrong: with accumulated ProgramInsightTypeUsage counts, the
    // diversity multiplier (1 / (1 + usage * 0.3)) shrinks rapidly — usage
    // of ~10 drops every insight's effective score by 4×. For programs that
    // have been exercised repeatedly, this was silently eliminating ALL
    // candidates from the final output, making the section disappear.
    //
    // Diversity is supposed to RE-RANK, not SUPPRESS. The fix: the floor
    // is a property of the candidate's truth value (raw × per-type weight),
    // independent of usage history. Diversity only reorders survivors.
    for (const c of candidates) {
      const baseWeight = TYPE_BASE_WEIGHT[c.type] ?? 1.0;
      c.score = c.score * baseWeight;
    }
    const strongCandidates = candidates.filter((c) => c.score >= MIN_SCORE);

    // ── Phase 6.8 selection strategy dispatch (re-ranking only) ─────────
    //   'pure_score'           → diversity weight = 1 (no-op).
    //   'score_with_diversity' → apply the per-program diversity formula:
    //                             weight(usage) = 1 / (1 + usage * strength)
    //
    // usage comes from ProgramInsightTypeUsage (scoped to THIS program).
    // strength is configurable on the program — 0.0 disables, higher
    // values penalize repetition more aggressively. Applied AFTER the
    // MIN_SCORE gate so a heavily-used type can still surface when the
    // truth signal is strong enough.
    if (selectionStrategy === 'score_with_diversity' && diversityStrength > 0) {
      for (const c of strongCandidates) {
        const usage = typeUsageByProgram[c.type] ?? 0;
        const diversityWeight = 1 / (1 + usage * diversityStrength);
        c.score = c.score * diversityWeight;
      }
    }

    // ── Phase 6.3 concept-level dedup (MANDATORY) ───────────────────────
    // Group candidates by concept, keep only the highest-scoring one per
    // concept. This enforces "different concepts per slot" without any
    // concept-count tracking in the selection loop — the output can have
    // at most one dominance, one improvement, one pattern, etc.
    //
    // This also subsumes the old type-level dedup (strongest + best_day,
    // dominant_source + high_concentration) because those pairs share the
    // same concept (dominance / pattern respectively).
    const bestByConcept = new Map<InsightConcept, Candidate>();
    for (const c of strongCandidates) {
      const current = bestByConcept.get(c.concept);
      if (!current || c.score > current.score) {
        bestByConcept.set(c.concept, c);
      }
    }
    const conceptDeduplicated = Array.from(bestByConcept.values());

    // ── Phase 6.5 narrative dedup ───────────────────────────────────────
    // Two insights from DIFFERENT concepts can still tell the same story
    // to the participant when they're focused on the same category —
    // "הכי השתפרת ב־הליכה" (improvement) and "70% הגיעו מ־הליכה"
    // (dominance) are two angles on the same fact. Collapse them to the
    // higher-scoring one.
    //
    // Only category-based insights carry a non-null focusKey. null-keyed
    // insights (best_day, trend, consistency, etc.) never collide here —
    // they pass through unchanged.
    const bestByFocus = new Map<string, Candidate>();
    const narrativeDeduplicated: Candidate[] = [];
    for (const c of conceptDeduplicated) {
      if (c.focusKey === null) {
        narrativeDeduplicated.push(c);
        continue;
      }
      const current = bestByFocus.get(c.focusKey);
      if (!current || c.score > current.score) {
        bestByFocus.set(c.focusKey, c);
      }
    }
    narrativeDeduplicated.push(...bestByFocus.values());

    // ── Selection ───────────────────────────────────────────────────────
    // Sort by score DESC, take top 4. With concept-level AND focus-level
    // dedup already applied, every returned insight is both a different
    // concept and a different category (or unfocused). If fewer than 4
    // survive, return fewer — padding with weak insights would violate
    // the "never mislead" rule.
    narrativeDeduplicated.sort((a, b) => b.score - a.score);
    const selected = narrativeDeduplicated.slice(0, 4);

    // Phase 6.8: persist per-program usage for any type that actually got
    // selected. Only runs when the program is using the diversity strategy
    // — `pure_score` programs skip the write entirely, so their usage
    // table stays empty and they never incur any cross-participant coupling.
    //
    // Upsert is done per row with the composite-unique (programId, insightType)
    // constraint. DB handles concurrency; no in-process synchronization.
    // Types that qualified but were dropped during dedup do NOT count as
    // "seen" — only what actually surfaced to the participant.
    if (selectionStrategy === 'score_with_diversity' && selected.length > 0) {
      await Promise.all(
        selected.map((c) =>
          this.prisma.programInsightTypeUsage.upsert({
            where: {
              programId_insightType: {
                programId,
                insightType: c.type,
              },
            },
            create: {
              programId,
              insightType: c.type,
              count: 1,
            },
            update: {
              count: { increment: 1 },
            },
          }),
        ),
      );
    }

    // Strip internal concept/focus tags before returning.
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
          // Phase 4.8 (audit fix): removed `NOT: { type: 'text' }` so that
          // hidden/system contexts (stored with type='text' by the Phase 4.2
          // model) surface here too. Without them, an analytics group whose
          // members are all hidden was invisible to the frontend even though
          // the breakdown endpoint happily aggregated them — a discovery /
          // aggregation mismatch. Standalone-vs-group rendering is already
          // decided on the frontend using the three flag fields below, so
          // surfacing every context here is safe.
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

  // ─── Phase 6.11: participant-scoped edit / delete of own same-day logs ──
  //
  // Authorization chain:
  //   1. Token resolves to a (participantId, programId) pair.
  //   2. The target log must belong to THAT participantId + programId.
  //   3. The log must be status='active' (already-corrected chains are
  //      read-only; the active head is always the editable one).
  //   4. The log's createdAt must fall within today's UTC day. Past-day
  //      logs are locked — admin can still correct via separate admin tools,
  //      but participants cannot retroactively change history.
  //
  // All four checks run before any mutation. On success we delegate to the
  // existing GameEngineService.correctLog / voidLog, which handle the
  // compensation, units-delta cascade, and threshold-rule recompute.

  private async resolveOwnEditableLog(token: string, logId: string) {
    const { participantId, programId } = await this.resolveToken(token);
    const log = await this.prisma.userActionLog.findUnique({
      where: { id: logId },
      select: {
        id: true,
        participantId: true,
        programId: true,
        status: true,
        createdAt: true,
      },
    });
    if (!log) throw new NotFoundException('הפעולה לא נמצאה');
    if (log.participantId !== participantId || log.programId !== programId) {
      // Different participant's log — don't leak existence; return same
      // message as "not found" to avoid information disclosure.
      throw new NotFoundException('הפעולה לא נמצאה');
    }
    if (log.status !== 'active') {
      throw new BadRequestException('לא ניתן לערוך פעולה שכבר עודכנה');
    }
    const now = new Date();
    const todayStart = startOfDayUTC(now);
    const todayEnd = new Date(todayStart.getTime() + DAY_MS);
    if (log.createdAt < todayStart || log.createdAt >= todayEnd) {
      throw new BadRequestException(
        'ניתן לערוך או למחוק רק פעולות שבוצעו היום',
      );
    }
    return { log };
  }

  async editOwnLog(
    token: string,
    logId: string,
    dto: { value: string },
  ) {
    await this.resolveOwnEditableLog(token, logId);
    return this.gameEngine.correctLog({
      logId,
      value: dto.value,
      actorRole: 'participant',
    });
  }

  async deleteOwnLog(token: string, logId: string) {
    await this.resolveOwnEditableLog(token, logId);
    return this.gameEngine.voidLog({
      logId,
      actorRole: 'participant',
    });
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  // Phase 3: resolve a portal token to the active ParticipantGroup row.
  // Tries the participant-scoped accessToken first (current + stable),
  // falls back to the legacy per-group column for pre-migration rows.
  // Returns the { participantId, groupId } composite key so each caller
  // can then run its own findUnique with the include shape it needs.
  private async findPgByToken(token: string): Promise<{ participantId: string; groupId: string } | null> {
    // Phase 8 (bug fix) — both ParticipantGroup.isActive AND Group.isActive
    // must be true. Without the second clause, a token would still resolve
    // when admin archived a Group, leaving the participant on a portal that
    // points at a "dead" group. The game-ended path can only fire when
    // resolution actually returns null.
    const direct = await this.prisma.participant.findUnique({
      where: { accessToken: token },
      select: {
        id: true,
        participantGroups: {
          where: { isActive: true, group: { isActive: true } },
          orderBy: { joinedAt: 'desc' },
          take: 1,
          select: { groupId: true },
        },
      },
    });
    if (direct?.participantGroups[0]) {
      return { participantId: direct.id, groupId: direct.participantGroups[0].groupId };
    }
    const legacy = await this.prisma.participantGroup.findUnique({
      where: { accessToken: token },
      select: {
        participantId: true, groupId: true, isActive: true,
        group: { select: { isActive: true } },
      },
    });
    if (legacy && legacy.isActive && legacy.group.isActive) {
      return { participantId: legacy.participantId, groupId: legacy.groupId };
    }
    return null;
  }

  private async resolveToken(token: string) {
    const pair = await this.findPgByToken(token);
    if (!pair) throw new NotFoundException('הקישור אינו בתוקף');
    const pg = await this.prisma.participantGroup.findUnique({
      where: { participantId_groupId: pair },
      select: { participantId: true, groupId: true, isActive: true, group: { select: { programId: true } } },
    });
    if (!pg || !pg.isActive) throw new NotFoundException('הקישור אינו בתוקף');
    if (!pg.group.programId) throw new NotFoundException('לא נמצאה תוכנית');
    return { participantId: pg.participantId, groupId: pg.groupId, programId: pg.group.programId };
  }

  // Phase 8 — multi-group resolution.
  // Returns every active group the participant has in the program plus a
  // chosen "active" group for read scoping. When `requestedGroupId` is
  // supplied we validate that it belongs to the participant and is in
  // the same program; otherwise we default to the oldest active
  // membership (stable, deterministic).
  //
  // Importantly: this NEVER touches logs / score events / feed events.
  // It's a read-side helper used by getContext / getPortalStats /
  // getPortalFeed to choose which group's member-set to compare against.
  private async resolveMultiGroup(
    token: string,
    requestedGroupId?: string | null,
  ): Promise<{
    participantId: string;
    programId: string;
    primaryGroupId: string;
    activeGroupId: string;
    groups: Array<{ id: string; name: string; isActive: boolean }>;
  }> {
    const pair = await this.findPgByToken(token);

    // Token didn't match any current active membership. Distinguish two
    // sub-cases for a friendlier portal experience:
    //   (a) token belongs to a participant who once played but whose
    //       memberships are all inactive now → throw 'game_ended' so
    //       the portal shows "המשחק הזה הסתיים..." instead of
    //       "הקישור אינו בתוקף".
    //   (b) token does not match any participant at all → genuine
    //       invalid link.
    if (!pair) {
      const ghost = await this.prisma.participant.findUnique({
        where: { accessToken: token },
        select: { id: true, _count: { select: { participantGroups: true } } },
      });
      if (ghost && ghost._count.participantGroups > 0) {
        throw new BadRequestException('game_ended');
      }
      throw new NotFoundException('הקישור אינו בתוקף');
    }

    const primary = await this.prisma.participantGroup.findUnique({
      where: { participantId_groupId: pair },
      select: {
        participantId: true,
        isActive: true,
        group: { select: { programId: true, isActive: true } },
      },
    });
    // Group.isActive guards against an admin who archived the group AFTER
    // findPgByToken cached the pair. Either flag false → bail to game_ended.
    if (!primary || !primary.isActive || !primary.group.isActive || !primary.group.programId) {
      throw new BadRequestException('game_ended');
    }
    const participantId = primary.participantId;
    const programId = primary.group.programId;

    // Phase 8 — explicit opt-in for the multi-group switcher. When the
    // flag is off we expose ONLY the primary group, so the portal never
    // reveals other memberships through the API and the frontend
    // length-check naturally suppresses the switcher UI.
    const participantRow = await this.prisma.participant.findUnique({
      where: { id: participantId },
      select: { multiGroupEnabled: true },
    });
    const multiGroupEnabled = !!participantRow?.multiGroupEnabled;

    // All active memberships for this participant in the same program,
    // oldest-first so the switcher renders in a stable order and the
    // default selection is deterministic across refreshes.
    // Both branches add `group: { isActive: true }` so an archived
    // Group never appears in the switcher or the flag-off primary set.
    const memberships = multiGroupEnabled
      ? await this.prisma.participantGroup.findMany({
          where: {
            participantId,
            isActive: true,
            group: { programId, isActive: true },
          },
          orderBy: { joinedAt: 'asc' },
          select: { group: { select: { id: true, name: true, isActive: true } } },
        })
      // Flag off → resolve only the primary so the API doesn't leak
      // sibling memberships, and any ?groupId= override is silently
      // ignored (the primary group is the only valid scope).
      : await this.prisma.participantGroup.findMany({
          where: {
            participantId: pair.participantId,
            groupId: pair.groupId,
            group: { isActive: true },
          },
          select: { group: { select: { id: true, name: true, isActive: true } } },
        });
    if (memberships.length === 0) {
      // Active memberships for this program disappeared between the
      // initial token resolution and this query (race / admin
      // deactivation). Treat the same as ghost-with-only-inactive.
      throw new BadRequestException('game_ended');
    }

    const groups = memberships.map((m) => m.group);
    const primaryGroupId = groups[0].id;

    // Validate ?groupId= against the participant's own membership set.
    // Silently fall back to the primary group if the param is missing,
    // points at another program, or the participant doesn't have the
    // multi-group flag (in which case `groups` is just [primary]).
    let activeGroupId = primaryGroupId;
    if (requestedGroupId) {
      const found = groups.find((g) => g.id === requestedGroupId);
      if (found) activeGroupId = found.id;
    }

    return { participantId, programId, primaryGroupId, activeGroupId, groups };
  }

  // Phase 8 (fan-out model) — daily trend per group. Events stamped
  // with the selected groupId only; the chart reflects what the
  // participant earned IN THIS group.
  private async buildDailyTrend(participantId: string, groupId: string, days: number): Promise<{ date: string; points: number }[]> {
    const now = new Date();
    const since = new Date(now);
    since.setDate(now.getDate() - days + 1);
    since.setHours(0, 0, 0, 0);

    const events = await this.prisma.scoreEvent.findMany({
      where: { participantId, groupId, createdAt: { gte: since } },
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
