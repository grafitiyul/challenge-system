'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
// REFRESH_INTERVAL_MS: background refresh cadence while portal is open
const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
import { BASE_URL, apiFetch } from '@lib/api';
import { ProfileTab, useProfileSnapshot } from './profile-tab';

// ─── Sound helper — plays built-in static audio files ────────────────────────
// Files live in /public/sounds/. Played via HTMLAudioElement so they work
// on mobile after a user-initiated gesture (the submit tap qualifies).
// Falls silently if browser blocks audio.

const SOUND_FILES: Record<string, string> = {
  ding:        '/sounds/purchase.wav',
  celebration: '/sounds/tada.wav',
  applause:    '/sounds/clap.wav',
};

function playActionSound(soundKey: string): void {
  if (!soundKey || soundKey === 'none') return;
  const src = SOUND_FILES[soundKey];
  if (!src) return;
  try {
    const audio = new Audio(src);
    audio.volume = 0.85;
    audio.play().catch(() => { /* browser blocked — fail silently */ });
  } catch { /* Audio constructor unavailable — fail silently */ }
}

// ─── Types ───────────────────────────────────────────────────────────────────

// Phase 3: shared context-schema shapes — must match backend.
type ContextFieldType = 'select' | 'text' | 'number';
interface ContextOption { value: string; label: string }
interface ContextField {
  key: string;
  label: string;
  type: ContextFieldType;
  required?: boolean;
  options?: ContextOption[];
}
interface ContextSchemaJson { dimensions: ContextField[] }

interface Action {
  id: string;
  name: string;
  description: string | null;
  inputType: string | null;
  aggregationMode: string;
  unit: string | null;
  points: number;
  maxPerDay: number | null;
  soundKey: string;
  // Phase 3.4: admin-editable submission prompt. When null, getInputLabel()
  // falls back to the aggregation-mode default.
  participantPrompt?: string | null;
  // Phase 4.1: optional free-text question rendered under the main input.
  participantTextPrompt?: string | null;
  // Phase 4.4: when true + prompt set, submission is blocked on empty text.
  participantTextRequired?: boolean;
  // Phase 3: optional schema. null/undefined → no extra fields prompt.
  contextSchemaJson?: ContextSchemaJson | null;
  contextSchemaVersion?: number;
}

interface PortalContext {
  participant: { id: string; firstName: string; lastName: string | null; profileImageUrl: string | null };
  // Primary group — drives the portal-opening gate + page header.
  group: { id: string; name: string; startDate: string | null; endDate: string | null };
  // Phase 8 — every active group the participant has in this program.
  // Length 1 → switcher hidden. Length > 1 → render the switcher above
  // the main content; tapping a group reloads stats + feed scoped to it.
  groups: { id: string; name: string; isActive: boolean }[];
  activeGroupId: string;
  program: { id: string; name: string; isActive: boolean; profileTabEnabled: boolean };
  // Portal opening gate — null means portal is always open
  portalCallTime: string | null;
  portalOpenTime: string | null;
  actions: Action[];
  todayScore: number;
  todayValues: Record<string, number>;
  // Catch-up mode visibility — null when the program has it disabled.
  // The button at the bottom of "הנתונים שלי" is shown when
  // catchUp.enabled && catchUp.availableToday && activeCatchUpSession === null.
  catchUp: {
    enabled: boolean;
    availableToday: boolean;
    buttonLabel: string;
    confirmTitle: string | null;
    confirmBody: string | null;
    durationMinutes: number;
    allowedDaysBack: number;
    bannerText: string | null;
  } | null;
  activeCatchUpSession: {
    id: string;
    expiresAt: string;
    allowedDaysBack: number;
    bannerText: string | null;
  } | null;
}

interface LogResult {
  pointsEarned: number;
  todayScore: number;
  todayValue: number | null;
}

interface PortalStats {
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

interface FeedItem {
  id: string;
  message: string;
  points: number;
  createdAt: string;
  participant: { id: string; firstName: string; lastName: string | null; profileImageUrl: string | null };
}

// ─── Phase 2A analytics shapes (match backend responses exactly) ──────────────

interface AnalyticsSummary {
  totalScore: number;
  todayScore: number;
  yesterdayScore: number;
  trendVsYesterday: number;
  currentStreak: number;
}

interface AnalyticsTrendPoint {
  date: string;            // YYYY-MM-DD
  points: number;
  submissionCount: number;
}

interface AnalyticsDayEntry {
  logId: string;
  time: string;            // HH:MM (server-formatted in Asia/Jerusalem, Phase 4.4)
  actionId: string;
  actionName: string;
  rawValue: string;
  effectiveValue: number | null;
  contextJson: Record<string, unknown> | null;
  /** Phase 4.4: pre-resolved display pairs — use these for rendering, not contextJson. */
  contextDisplay: Array<{ dimensionLabel: string; valueLabel: string }>;
  /** Phase 4.1: action-level free-text captured at submission. */
  extraText: string | null;
  points: number;
}

interface AnalyticsBreakdownEntry {
  actionId: string;
  actionName: string;
  totalPoints: number;
  count: number;
}

// Phase 4.6: per-log row from the slice drill-down endpoint.
interface AnalyticsSliceEntry {
  logId: string;
  date: string;           // YYYY-MM-DD (local)
  time: string;           // HH:MM (local)
  actionId: string;
  actionName: string;
  contextKey: string;
  contextLabel: string;
  valueLabel: string;
  points: number;
}

type TrendDays = 7 | 14 | 30;
type BreakdownPeriod = '7d' | '14d' | '30d' | 'all';

// Phase 2B — unified analytics range. Either one of the "quick" keys OR an
// explicit custom range. `custom` implies `from`+`to` are set.
// `today` is a convenience key that routes through from=today&to=today on the
// wire so it works with existing backend validation (no backend change needed).
type AnalyticsRangeKey = 'today' | '7d' | '14d' | '30d' | 'all' | 'custom';

interface AnalyticsRange {
  key: AnalyticsRangeKey;
  /** YYYY-MM-DD when key === 'custom'; undefined otherwise. */
  from?: string;
  to?: string;
}

interface ContextDimension {
  key: string;
  label: string;
  // Phase 4 analytics presentation layer — optional.
  displayLabel?: string | null;
  groupKey?: string | null;
  groupLabel?: string | null;
  // Phase 4.7 standalone-pill eligibility. Only renders as a standalone
  // selector pill when all three are true. Grouped contexts aggregate via
  // their parent group regardless of these flags.
  analyticsVisible?: boolean;
  participantVisible?: boolean;
  hasOptions?: boolean;
}

/** Breakdown grouping mode. `action` = by actionId; `context:<key>` = by that dim. */
// Phase 4: breakdown can now also group by an analytics presentation group —
// "group:<groupKey>" aggregates data from every context sharing that groupKey.
type BreakdownGroupBy = 'action' | `context:${string}` | `group:${string}`;

interface PortalRules {
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
    conditionJson: Record<string, unknown> | null;
    rewardJson: Record<string, unknown> | null;
    isActive: boolean;
  }[]; // conditionJson/rewardJson typed as Record for frontend convenience
}

type TabId = 'report' | 'stats' | 'feed' | 'rules' | 'profile';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const GREETINGS = ['בוקר אור', 'היי', 'יום נהדר', 'שלום', 'בואי נתקדם', 'כוחות'];

function dailyGreeting(): string {
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86_400_000,
  );
  return GREETINGS[dayOfYear % GREETINGS.length];
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' });
}

function formatDateRange(start: string | null, end: string | null): string {
  if (!start && !end) return '';
  if (start && end) return `${formatDate(start)} – ${formatDate(end)}`;
  if (start) return `מ- ${formatDate(start)}`;
  return `עד ${formatDate(end)}`;
}

function getInputLabel(action: Action): string {
  // Phase 3.4: admin-editable override wins when set.
  if (action.participantPrompt && action.participantPrompt.trim()) {
    return action.participantPrompt.trim();
  }
  if (action.aggregationMode === 'latest_value') return 'כמה הגעת עד עכשיו?';
  if (action.aggregationMode === 'incremental_sum') return 'כמה להוסיף עכשיו?';
  return 'האם ביצעת פעולה זו?';
}

function getTodayDisplay(action: Action, todayValues: Record<string, number>): string | null {
  const val = todayValues[action.id];
  if (val === undefined || val === 0) return null;
  if (action.inputType === 'number' && action.unit) return `היום: ${val.toLocaleString('he-IL')} ${action.unit}`;
  if (action.inputType === 'number') return `היום: ${val.toLocaleString('he-IL')}`;
  return 'בוצע היום';
}

// Hebrew label for the day-N-back chip during a catch-up session.
//   0 → היום, 1 → אתמול, 2 → שלשום, n>=3 → "לפני N ימים".
// No religious / holiday wording — admin controls availability dates,
// chip labels stay neutral.
function catchUpDayLabel(daysBack: number): string {
  if (daysBack === 0) return 'היום';
  if (daysBack === 1) return 'אתמול';
  if (daysBack === 2) return 'שלשום';
  return `לפני ${daysBack} ימים`;
}

// Compute a YYYY-MM-DD string that is `daysBack` calendar days before
// "today" in Asia/Jerusalem. Used by the action-sheet day chips when
// an active catch-up session is in flight. Server re-validates against
// the session, so a slightly skewed client clock can't slip past the
// allowedDaysBack cap — at worst the request is rejected.
function shiftLocalDateBack(daysBack: number): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const todayLocal = fmt.format(new Date());
  const [y, m, d] = todayLocal.split('-').map(Number);
  // Anchor at UTC noon then shift in millisecond multiples — DST
  // transitions happen at 02:00–03:00 local, well away from noon, so
  // this is stable across the gap.
  const target = new Date(Date.UTC(y, m - 1, d, 12, 0, 0) - daysBack * 86400000);
  return fmt.format(target);
}

// Format remaining milliseconds as "MM:SS" for the catch-up countdown
// banner. Caps at 99:59 (we never run > 99 minutes anyway).
function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.min(99, Math.floor(total / 60)).toString().padStart(2, '0');
  const ss = (total % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'עכשיו';
  if (mins < 60) return `לפני ${mins} דקות`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `לפני ${hrs} שעות`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `לפני ${days} ימים`;
  return new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' });
}

function initials(first: string, last: string | null): string {
  return (first[0] ?? '') + (last ? last[0] : '');
}

// Phase 8 — participant avatar bubble used by feed items + leaderboard rows.
// Renders the uploaded profileImageUrl when present (resolved through the
// /api-proxy rewrite when the URL is a relative /uploads/<file> path), and
// falls back to the existing initials chip when the URL is missing OR the
// browser fails to load the image. Pure presentation — no fetches.
function ParticipantAvatar(props: {
  firstName: string;
  lastName: string | null;
  profileImageUrl: string | null;
  size?: number;
  fontSize?: number;
}) {
  const { firstName, lastName, profileImageUrl, size = 40, fontSize = 13 } = props;
  const [broken, setBroken] = useState(false);
  const showImage = profileImageUrl && !broken;
  const src = profileImageUrl
    ? (profileImageUrl.startsWith('/uploads') ? `/api-proxy${profileImageUrl}` : profileImageUrl)
    : null;
  const baseStyle: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    flexShrink: 0,
    overflow: 'hidden',
    background: '#dbeafe',
    color: '#1d4ed8',
    fontSize,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };
  if (showImage && src) {
    return (
      <span style={baseStyle}>
        <img
          src={src}
          alt=""
          onError={() => setBroken(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          loading="lazy"
        />
      </span>
    );
  }
  return <span style={baseStyle}>{initials(firstName, lastName)}</span>;
}

function ruleDescription(rule: PortalRules['rules'][0]): string {
  const pts = rule.rewardJson?.['points'];
  const ptsStr = pts != null ? `${pts} נקודות` : 'נקודות';
  const cond = rule.conditionJson;
  if (rule.type === 'daily_bonus') return `${ptsStr} — בכל יום שיש דיווח`;
  if (rule.type === 'streak') {
    const min = cond?.['minStreak'];
    return min ? `${ptsStr} — אחרי ${min} ימים ברצף` : `${ptsStr} — בונוס רצף`;
  }
  if (rule.type === 'conditional') {
    const threshold = cond?.['threshold'];
    return threshold !== undefined ? `${ptsStr} — בהגיע לסף ${threshold}` : `${ptsStr} — בהתקיים תנאי`;
  }
  return ptsStr;
}

// ─── SVG Bar Chart with per-bar date labels ───────────────────────────────────

function shortBarDate(iso: string): string {
  // "2026-04-14" → "14/4"
  const parts = iso.split('-');
  const day = parseInt(parts[2], 10);
  const month = parseInt(parts[1], 10);
  return `${day}/${month}`;
}

function TrendChart({ data }: { data: { date: string; points: number }[] }) {
  const WIDTH = 320;
  const BAR_H = 72;        // height of bar drawing area
  const LABEL_H = 26;      // space below bars for rotated labels
  const SVG_H = BAR_H + LABEL_H;
  const BAR_GAP = 2;
  const n = data.length;
  const barW = Math.floor((WIDTH - BAR_GAP * (n - 1)) / n);
  const maxVal = Math.max(...data.map((d) => d.points), 1);

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${WIDTH} ${SVG_H}`}
      style={{ display: 'block', overflow: 'visible' }}
      aria-label="גרף נקודות 14 ימים"
    >
      {data.map((d, i) => {
        const barH = Math.max(2, Math.round((d.points / maxVal) * (BAR_H - 14)));
        const x = i * (barW + BAR_GAP);
        const y = BAR_H - barH;
        const cx = x + barW / 2;
        const isToday = i === n - 1;
        const label = shortBarDate(d.date);
        return (
          <g key={d.date}>
            {/* Bar */}
            <rect
              x={x}
              y={y}
              width={barW}
              height={barH}
              rx={3}
              fill={isToday ? '#1d4ed8' : d.points > 0 ? '#93c5fd' : '#e5e7eb'}
            />
            {/* Points label above today's bar */}
            {isToday && d.points > 0 && (
              <text
                x={cx}
                y={y - 4}
                textAnchor="middle"
                fontSize={9}
                fill="#1d4ed8"
                fontWeight={700}
              >
                {d.points}
              </text>
            )}
            {/* Date label below bar, rotated -40° around its base center */}
            <text
              x={cx}
              y={BAR_H + 10}
              textAnchor="end"
              fontSize={7}
              fill={isToday ? '#1d4ed8' : '#9ca3af'}
              fontWeight={isToday ? 700 : 400}
              transform={`rotate(-40, ${cx}, ${BAR_H + 10})`}
            >
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Bottom-nav group icon (Phase 2A polish pass 2) ────────────────────────
// A dedicated inline SVG so the "הקבוצה" tab's glyph can track the same
// active/inactive blue-gray palette as the other tabs, instead of being a flat
// unicode emoji whose color we can't control.

function GroupNavIcon({ active }: { active: boolean }) {
  // Two overlapping silhouettes = community/group. Stroke-based so the icon
  // stays crisp at the 24px tab size on retina screens.
  const color = active ? '#1d4ed8' : '#6b7280';
  return (
    <svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      {/* Front person (head + shoulders) */}
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 19c0-3.1 2.7-5.5 6-5.5s6 2.4 6 5.5" />
      {/* Back person (partially visible head + shoulder arc) */}
      <circle cx="16.5" cy="7.5" r="2.6" />
      <path d="M15.5 13.6c.7-.2 1.4-.3 2-.3 2.7 0 4.5 1.9 4.5 4.4" />
    </svg>
  );
}

// ─── Interactive trend chart (Phase 2A polish) ─────────────────────────────
// Layout anchoring:
//   - viewBox uses fractional coordinates that ALWAYS span the full width so
//     bars feel evenly distributed regardless of `n` (7 / 14 / 30 days).
//   - A subtle baseline under the bars grounds the whole chart so empty days
//     no longer read as dead space.
//   - Zero-value days render as a faint baseline stub instead of disappearing.
// Values:
//   - Every bar with points > 0 shows its number above it in small subtle type.
//   - Today's bar uses the accent blue; earlier bars use a muted gray so the
//     eye can still pick out the current day.

function InteractiveTrendChart({
  data,
  onBarClick,
}: {
  data: { date: string; points: number; submissionCount: number }[];
  onBarClick: (date: string) => void;
}) {
  const VIEW_W = 320;
  const BAR_H = 84;
  const LABEL_H = 30;
  const TOP_PAD = 14; // headroom for per-bar value labels
  const SVG_H = TOP_PAD + BAR_H + LABEL_H;
  const n = Math.max(data.length, 1);
  // Adaptive layout (progress-style chart):
  //   The caller filters `data` to only days WITH activity. We pick a layout
  //   that reads naturally for the resulting count:
  //     - Few bars (sparse): fixed natural width + stride, cluster CENTERED
  //       in the chart. A single bar sits in the middle; two bars sit as a
  //       tight pair in the middle; three bars spread but still centered.
  //     - Many bars (populated): fill the full width left-anchored so no
  //       visual dead space remains on either edge.
  //   The switch happens automatically when the full-width bar width would
  //   exceed MAX_BAR_W — that's when bars stop "feeling like a chart" and
  //   start looking like slabs.
  const BAR_FILL = 0.72;
  const MAX_BAR_W = 28;
  const uncappedBarW = (VIEW_W / n) * BAR_FILL;

  let barW: number;
  let stride: number;   // distance between adjacent bar LEFT edges
  let firstBarX: number; // x of the first bar's LEFT edge

  if (uncappedBarW > MAX_BAR_W) {
    // Sparse: cap bar width + use a natural density stride and CENTER the cluster.
    barW = MAX_BAR_W;
    stride = MAX_BAR_W / BAR_FILL;                     // ≈ 38.9
    const clusterW = (n - 1) * stride + barW;
    firstBarX = Math.max(0, (VIEW_W - clusterW) / 2);
  } else {
    // Populated: fill full width left-anchored.
    barW = Math.max(3, uncappedBarW);
    stride = n > 1 ? (VIEW_W - barW) / (n - 1) : 0;
    firstBarX = 0;
  }

  const maxVal = Math.max(...data.map((d) => d.points), 1);
  const baselineY = TOP_PAD + BAR_H;

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${VIEW_W} ${SVG_H}`}
      preserveAspectRatio="none"
      style={{ display: 'block', overflow: 'visible' }}
      aria-label="גרף נקודות לפי יום"
    >
      {/* Baseline — anchors the chart visually so empty days read as "inactive"
          rather than "missing". 1px high, faint gray. */}
      <line
        x1={0}
        x2={VIEW_W}
        y1={baselineY}
        y2={baselineY}
        stroke="#e5e7eb"
        strokeWidth={1}
      />

      {data.map((d, i) => {
        const x = firstBarX + i * stride;
        const cx = x + barW / 2;
        // Hit-box spans from halfway-to-previous to halfway-to-next so taps
        // stay reliable on short/sparse bars. Clamped inside the viewbox.
        const hitX = n === 1 ? 0 : Math.max(0, x - (stride - barW) / 2);
        const hitW = n === 1 ? VIEW_W : stride;
        const isToday = i === n - 1;
        const hasPoints = d.points > 0;
        const positiveH = Math.round((d.points / maxVal) * (BAR_H - 10));
        const barH = hasPoints ? Math.max(4, positiveH) : 3;
        const y = baselineY - barH;
        const label = shortBarDate(d.date);
        const fill = isToday
          ? '#1d4ed8'
          : hasPoints
          ? '#93c5fd'
          : '#f3f4f6';

        return (
          <g
            key={d.date}
            onClick={() => onBarClick(d.date)}
            style={{ cursor: 'pointer' }}
          >
            <rect x={hitX} y={0} width={hitW} height={BAR_H + TOP_PAD} fill="transparent" />
            <rect x={x} y={y} width={barW} height={barH} rx={2} fill={fill} />

            {/* Per-bar value label. Positive days get muted/accent type; zero
                days get a very faint "0" so the day reads as "yes, real, just
                empty" rather than "data missing". The zero label is skipped
                in populated mode where stride is too tight to fit cleanly. */}
            {hasPoints ? (
              <text
                x={cx}
                y={y - 3}
                textAnchor="middle"
                fontSize={9}
                fill={isToday ? '#1d4ed8' : '#6b7280'}
                fontWeight={isToday ? 700 : 600}
              >
                {d.points}
              </text>
            ) : stride >= 24 ? (
              <text
                x={cx}
                y={baselineY - 6}
                textAnchor="middle"
                fontSize={8}
                fill="#d1d5db"
                fontWeight={500}
              >
                0
              </text>
            ) : null}

            {/* Date label below baseline, rotated so many days fit without
                overlap. textAnchor="end" anchors at the baseline corner. */}
            <text
              x={cx}
              y={baselineY + 10}
              textAnchor="end"
              fontSize={7}
              fill={isToday ? '#1d4ed8' : '#9ca3af'}
              fontWeight={isToday ? 700 : 400}
              transform={`rotate(-40, ${cx}, ${baselineY + 10})`}
            >
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Breakdown pie (Phase 2A polish) ───────────────────────────────────────
// Mobile-first donut chart. Mirrors the same data the BreakdownList shows so
// the numbers always agree. Negative rows (participant corrected downward) are
// excluded from slice math because pie slices can't represent negative area.
// If the net is zero/empty, nothing renders — the parent handles empty state.

const PIE_COLORS = [
  '#1d4ed8', '#7c3aed', '#db2777', '#16a34a',
  '#f59e0b', '#0891b2', '#65a30d', '#dc2626',
  '#6366f1', '#ea580c',
] as const;

// ─── Unified breakdown section (Phase 2A polish pass 2) ───────────────────
// Centered donut + single list below. The donut color for each slice is shared
// with the list so the color indicator column tells you which pie slice each
// row represents. Tapping a slice OR a row toggles focus — the counterpart
// dims so the relationship is visually obvious.

interface BreakdownSlice {
  row: { actionId: string; actionName: string; totalPoints: number; count: number };
  color: string;
  pct: number;
  path: string;
}

function BreakdownSection({
  rows,
  focusedKey,
  onSelect,
}: {
  rows: { actionId: string; actionName: string; totalPoints: number; count: number }[];
  focusedKey?: string | null;
  onSelect?: (key: string) => void;
}) {
  // Positive-only for pie area; zero/negative rows still show in the table
  // below but get no slice and no color dot (neutral gray indicator instead).
  const positive = rows.filter((r) => r.totalPoints > 0);
  const total = positive.reduce((s, r) => s + r.totalPoints, 0);
  const ordered = [...positive].sort((a, b) => b.totalPoints - a.totalPoints);

  // Slice colors are assigned in descending-order index so the biggest slice
  // always gets PIE_COLORS[0]. The table uses the same map.
  const sliceByAction = new Map<string, BreakdownSlice>();
  if (total > 0) {
    const SIZE = 160;
    const R_OUTER = 70;
    const R_INNER = 42;
    const CX = SIZE / 2;
    const CY = SIZE / 2;
    let cursor = -Math.PI / 2;
    ordered.forEach((row, idx) => {
      const frac = row.totalPoints / total;
      const start = cursor;
      const end = cursor + frac * Math.PI * 2;
      cursor = end;
      sliceByAction.set(row.actionId, {
        row,
        color: PIE_COLORS[idx % PIE_COLORS.length],
        pct: Math.round(frac * 100),
        path: donutPath(CX, CY, R_INNER, R_OUTER, start, end),
      });
    });
  }

  const focusedSlice = focusedKey ? sliceByAction.get(focusedKey) ?? null : null;
  const centerValue = focusedSlice ? focusedSlice.row.totalPoints : total;
  const centerLabel = focusedSlice ? 'נק׳ בקטגוריה' : 'סה״כ נק׳';

  return (
    <div>
      {/* Centered donut — wrapper is flex-center so the pie always sits in the
          middle of the card regardless of row lengths below. */}
      {total > 0 && (
        <div style={s.pieCenterWrap}>
          <svg
            width={160}
            height={160}
            viewBox="0 0 160 160"
            aria-label="התפלגות נקודות"
            style={{ display: 'block' }}
          >
            {ordered.map((row) => {
              const sl = sliceByAction.get(row.actionId)!;
              const isFocused = focusedKey === row.actionId;
              const isDimmed = focusedKey != null && !isFocused;
              return (
                <path
                  key={row.actionId}
                  d={sl.path}
                  fill={sl.color}
                  opacity={isDimmed ? 0.35 : 1}
                  style={{
                    cursor: onSelect ? 'pointer' : 'default',
                    transition: 'opacity 0.15s',
                  }}
                  onClick={() => onSelect?.(row.actionId)}
                />
              );
            })}
            <text
              x={80}
              y={76}
              textAnchor="middle"
              fontSize={18}
              fontWeight={800}
              fill="#111827"
            >
              {centerValue.toLocaleString('he-IL')}
            </text>
            <text
              x={80}
              y={92}
              textAnchor="middle"
              fontSize={10}
              fill="#6b7280"
              fontWeight={600}
            >
              {centerLabel}
            </text>
          </svg>
        </div>
      )}

      {/* Unified table — one row per action with color + name + % + points + count. */}
      <div style={s.breakdownTable}>
        {rows.map((r) => {
          const sl = sliceByAction.get(r.actionId);
          const isFocused = focusedKey === r.actionId;
          const isDimmed = focusedKey != null && !isFocused;
          const pct = sl?.pct ?? 0;
          const color = sl?.color ?? '#d1d5db';
          return (
            <button
              key={r.actionId}
              onClick={() => onSelect?.(r.actionId)}
              style={{
                ...s.breakdownRow,
                ...(isFocused ? s.breakdownRowFocused : {}),
                opacity: isDimmed ? 0.55 : 1,
              }}
            >
              <span style={{ ...s.breakdownRowDot, background: color }} />
              <span style={s.breakdownRowName}>{r.actionName}</span>
              <span style={s.breakdownRowPct}>{pct}%</span>
              <span style={s.breakdownRowPoints}>
                {r.totalPoints.toLocaleString('he-IL')}
              </span>
              <span style={s.breakdownRowCount}>{r.count}x</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Day drill-down: grouped list (Phase 2B) ──────────────────────────────
// Entries come from the server in chronological order. We group them by
// actionId on the client, preserving chronology inside each group, and show a
// per-action header with subtotal + count. A disabled "edit" affordance is
// rendered as a placeholder column so that when Phase 5 introduces corrections
// the layout doesn't shift.

function DaySheetGroupedList({
  entries,
  canEdit,
  onEdit,
  onDelete,
}: {
  entries: AnalyticsDayEntry[];
  // Phase 6.11: edit/delete are only available for today's sheet. When
  // canEdit=false, rows render without action buttons (read-only history).
  canEdit: boolean;
  onEdit: (entry: AnalyticsDayEntry) => void;
  onDelete: (entry: AnalyticsDayEntry) => void;
}) {
  // Stable group order: first appearance in the chronological list.
  const order: string[] = [];
  const groups: Record<string, AnalyticsDayEntry[]> = {};
  for (const e of entries) {
    if (!groups[e.actionId]) {
      groups[e.actionId] = [];
      order.push(e.actionId);
    }
    groups[e.actionId].push(e);
  }

  return (
    <div style={s.daySheetList}>
      {order.map((actionId) => {
        const group = groups[actionId];
        const subtotal = group.reduce((sum, e) => sum + e.points, 0);
        const actionName = group[0].actionName;
        return (
          <div key={actionId} style={s.daySheetGroup}>
            <div style={s.daySheetGroupHeader}>
              <span style={s.daySheetGroupName}>{actionName}</span>
              <span style={s.daySheetGroupMeta}>
                <span style={s.daySheetGroupCount}>{group.length}x</span>
                <span style={s.daySheetGroupTotal}>
                  {subtotal > 0 ? `+${subtotal}` : subtotal} נק׳
                </span>
              </span>
            </div>
            {group.map((entry) => {
              // Phase 4.4: chips read from the pre-resolved contextDisplay —
              // select values show their labels (e.g. "בוקר"), never the
              // internal option value (e.g. "bvkr"). Fallback to legacy
              // contextJson only when the server didn't populate contextDisplay
              // (shouldn't happen in current builds, belt-and-braces).
              const contextChips: string[] = [];
              if (Array.isArray(entry.contextDisplay) && entry.contextDisplay.length > 0) {
                for (const d of entry.contextDisplay) {
                  if (d.valueLabel && d.valueLabel.trim()) {
                    contextChips.push(d.valueLabel.trim());
                  }
                }
              } else if (entry.contextJson && typeof entry.contextJson === 'object') {
                for (const v of Object.values(entry.contextJson)) {
                  if (v === null || v === undefined || v === '') continue;
                  const s = typeof v === 'string' ? v : String(v);
                  if (s.trim()) contextChips.push(s);
                }
              }
              // Phase 4.1: action-level free-text, quoted for distinction.
              if (entry.extraText && entry.extraText.trim()) {
                contextChips.push(`"${entry.extraText.trim()}"`);
              }
              return (
                <div key={entry.logId} style={s.daySheetGroupRow}>
                  <span style={s.daySheetTime}>{entry.time}</span>
                  <div style={s.daySheetBody}>
                    {entry.effectiveValue !== null ? (
                      <span style={s.daySheetValue}>
                        {entry.effectiveValue.toLocaleString('he-IL')}
                        {entry.rawValue && entry.rawValue !== 'true' && entry.rawValue !== String(entry.effectiveValue)
                          ? ` (${entry.rawValue})`
                          : ''}
                      </span>
                    ) : (
                      <span style={s.daySheetValueMuted}>בוצע</span>
                    )}
                    {contextChips.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
                        {contextChips.map((c, i) => (
                          <span
                            key={i}
                            style={{
                              fontSize: 10,
                              color: '#4b5563',
                              background: '#f3f4f6',
                              padding: '1px 7px',
                              borderRadius: 999,
                              whiteSpace: 'nowrap' as const,
                              maxWidth: 160,
                              overflow: 'hidden' as const,
                              textOverflow: 'ellipsis' as const,
                            }}
                          >
                            {c}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <span style={s.daySheetPointsSmall}>
                    {entry.points > 0 ? `+${entry.points}` : entry.points}
                  </span>
                  {canEdit ? (
                    <span style={{ display: 'inline-flex', gap: 4, flexShrink: 0 }}>
                      {entry.effectiveValue !== null && (
                        <button
                          type="button"
                          onClick={() => onEdit(entry)}
                          aria-label={`ערוך ${entry.actionName}`}
                          title="ערוך"
                          style={{
                            background: '#f1f5f9',
                            border: '1px solid #e2e8f0',
                            borderRadius: 6,
                            padding: '4px 8px',
                            fontSize: 13,
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                            lineHeight: 1,
                          }}
                        >
                          ✏️
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onDelete(entry)}
                        aria-label={`מחק ${entry.actionName}`}
                        title="מחק"
                        style={{
                          background: '#fef2f2',
                          border: '1px solid #fecaca',
                          borderRadius: 6,
                          padding: '4px 8px',
                          fontSize: 13,
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                          lineHeight: 1,
                        }}
                      >
                        🗑️
                      </button>
                    </span>
                  ) : (
                    <span style={s.daySheetEditPlaceholder} aria-hidden="true">⋯</span>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ─── Insights (Phase 6) ─────────────────────────────────────────────────────
// Backend-driven deterministic insights. The server generates candidates,
// scores them, dedupes overlapping patterns, and returns 0–4 short lines
// already ranked by importance. We just render them in order.
//
// Types:
//   strongest   — highest-points category
//   weakest     — lowest non-zero category with a meaningful gap
//   best_day    — day whose points stand out from the average
//   trend       — % change vs previous equal-length period
//   consistency — active-days / total-days ratio (celebrates or nudges)

interface AnalyticsInsight {
  type: 'strongest' | 'weakest' | 'best_day' | 'trend' | 'consistency';
  text: string;
  icon: string;
  score: number;
}

function InsightsCard({ insights }: { insights: AnalyticsInsight[] | null }) {
  // Nothing to show → render nothing (no empty card shell).
  if (!insights || insights.length === 0) return null;
  return (
    <div style={s.insightsCard}>
      {insights.map((i, idx) => (
        <div key={`${i.type}-${idx}`} style={s.insightRow}>
          <span style={s.insightIcon}>{i.icon}</span>
          <span style={s.insightText}>{i.text}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Build an SVG path string for a donut slice between two angles.
 * Handles the large-arc flag for slices > 180°.
 */
function donutPath(
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
  a0: number,
  a1: number,
): string {
  const sweep = a1 - a0;
  // If a single slice covers the full circle we must split into two halves,
  // otherwise the Arc command degenerates. Rare but guard against it.
  if (sweep >= Math.PI * 2 - 1e-6) {
    const mid = a0 + Math.PI;
    return [donutPath(cx, cy, rInner, rOuter, a0, mid), donutPath(cx, cy, rInner, rOuter, mid, a1)].join(' ');
  }
  const largeArc = sweep > Math.PI ? 1 : 0;
  const xo0 = cx + rOuter * Math.cos(a0), yo0 = cy + rOuter * Math.sin(a0);
  const xo1 = cx + rOuter * Math.cos(a1), yo1 = cy + rOuter * Math.sin(a1);
  const xi1 = cx + rInner * Math.cos(a1), yi1 = cy + rInner * Math.sin(a1);
  const xi0 = cx + rInner * Math.cos(a0), yi0 = cy + rInner * Math.sin(a0);
  return [
    `M ${xo0} ${yo0}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${xo1} ${yo1}`,
    `L ${xi1} ${yi1}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${xi0} ${yi0}`,
    'Z',
  ].join(' ');
}

// BreakdownList (Phase 2A) removed in polish pass 2 — its content is now part
// of BreakdownSection's unified table. The pie and the table share a single
// slice-color map, eliminating the duplicated "legend-next-to-pie" list.

// ─── Main component ───────────────────────────────────────────────────────────

export default function ParticipantPortal({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);

  const [state, setState] = useState<'loading' | 'invalid' | 'inactive' | 'game_ended' | 'waiting_a' | 'waiting_b' | 'ready'>('loading');
  // Countdown for waiting_a state — updated every second
  const [countdown, setCountdown] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  const [ctx, setCtx] = useState<PortalContext | null>(null);
  const [loadError, setLoadError] = useState('');
  const [activeTab, setActiveTab] = useState<TabId>('report');
  // Phase 8 — selected group context for ranking + feed. Read from
  // `?group=<id>` on first load so a refresh keeps the choice; null
  // until the context loads, after which it defaults to the server's
  // activeGroupId (the primary group). User switches via the group
  // strip above the main content.
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('group');
  });
  // Phase 7 — participant-profile snapshot. Drives the new bottom-nav
  // tab + its missing-required badge + ripple. Loads only when the
  // server says profileTabEnabled=true; otherwise the hook is a no-op.
  const profileSnapshotState = useProfileSnapshot(token, !!ctx?.program?.profileTabEnabled);
  const { snapshot: profileSnapshot, setSnapshot: setProfileSnapshot } = profileSnapshotState;
  const profileMissingCount = profileSnapshot?.missingRequiredCount ?? 0;
  // Tab persistence (Phase 6.1): restore the selected tab from `?tab=` on
  // page load so a refresh doesn't bounce the participant back to "report".
  // A ref guards the restore so it only runs once per session, immediately
  // after the portal reaches the 'ready' state (tabs don't render before then,
  // so restoring earlier would be wasted).
  const didRestoreTab = useRef(false);

  // Rules: load only once (rarely changes mid-session)
  const rulesLoaded = useRef(false);

  // Bottom sheet state (report tab)
  const [activeAction, setActiveAction] = useState<Action | null>(null);
  // Phase 8 — fan-out target groups for the next submission. Defaults
  // to ALL active groups when the action sheet opens; participant can
  // uncheck to apply the report to fewer groups. Single-group + flag-off
  // participants never see the checkbox UI; their submissions go to
  // their only / primary group via the array's one element.
  const [fanOutGroupIds, setFanOutGroupIds] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [inputError, setInputError] = useState('');
  // Phase 3: in-flight values for the action's context dimensions. Reset per
  // open. Keys correspond to ContextField.key. Always strings in state — we
  // coerce to numbers/etc on submit per dimension type.
  const [contextDraft, setContextDraft] = useState<Record<string, string>>({});
  // Phase 4.1: in-flight value for action.participantTextPrompt.
  const [extraTextDraft, setExtraTextDraft] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<Record<string, { points: number; visible: boolean }>>({});
  const [glowActionId, setGlowActionId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Catch-up mode state ─────────────────────────────────────────────────
  // The confirm modal renders only when the participant taps the
  // catch-up button and there's no active session yet. Re-entering
  // the portal mid-session goes straight to the banner — never the
  // modal — per the UX spec.
  const [catchUpConfirmOpen, setCatchUpConfirmOpen] = useState(false);
  const [catchUpStarting, setCatchUpStarting] = useState(false);
  const [catchUpError, setCatchUpError] = useState('');
  // Day chip selected inside the action sheet during an active
  // session. Number of days back from "today" — 0 = today (default).
  // Reset to 0 on every openAction.
  const [catchUpDaysBack, setCatchUpDaysBack] = useState(0);
  // Live countdown driven by an interval; recomputes against
  // expiresAt every second so a stale browser tab can't drift.
  const [catchUpRemainingMs, setCatchUpRemainingMs] = useState<number | null>(null);
  // Brief Hebrew toast when the timer hits zero.
  const [catchUpExpiredToast, setCatchUpExpiredToast] = useState(false);

  // Stats tab — legacy shape, still used by the feed tab's leaderboard card.
  const [stats, setStats] = useState<PortalStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState('');

  // ── Phase 2A+2B analytics state ─────────────────────────────────────────
  // All analytics re-fetch on tab entry and on range/groupBy changes. No cache
  // beyond the last loaded response held in state (avoids flicker).
  const [analyticsSummary, setAnalyticsSummary] = useState<AnalyticsSummary | null>(null);
  const [analyticsTrend, setAnalyticsTrend] = useState<AnalyticsTrendPoint[] | null>(null);
  const [analyticsBreakdown, setAnalyticsBreakdown] = useState<AnalyticsBreakdownEntry[] | null>(null);
  // Phase 6: deterministic insights, fetched from the backend per range.
  const [analyticsInsights, setAnalyticsInsights] = useState<AnalyticsInsight[] | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState('');

  // Phase 2B: one shared range drives chart + breakdown + pie. The trend chart
  // needs a bounded range, so when key='all' we internally fetch the trend with
  // the last 30 days while breakdown/pie use the true unbounded range.
  const [range, setRange] = useState<AnalyticsRange>({ key: '14d' });
  const [customFrom, setCustomFrom] = useState<string>('');
  const [customTo, setCustomTo] = useState<string>('');
  const [rangeError, setRangeError] = useState<string>('');

  // Phase 2B: breakdown grouping mode + available context dimensions.
  const [groupBy, setGroupBy] = useState<BreakdownGroupBy>('action');
  const [contextDimensions, setContextDimensions] = useState<ContextDimension[]>([]);

  // Pie interaction: focused actionId highlights the matching row + dims others.
  const [focusedSliceKey, setFocusedSliceKey] = useState<string | null>(null);

  // Phase 4.6: pie-slice drill-down sheet state. Opens when the participant
  // taps a slice; shows concrete UserActionLog rows that produced that slice.
  const [sliceSheet, setSliceSheet] = useState<{
    title: string;         // e.g. "שגרה · בוקר"
    entries: AnalyticsSliceEntry[] | null;
    loading: boolean;
    error: string;
  } | null>(null);

  // ── Day drill-down sheet ────────────────────────────────────────────────
  const [daySheetDate, setDaySheetDate] = useState<string | null>(null);
  const [daySheetEntries, setDaySheetEntries] = useState<AnalyticsDayEntry[] | null>(null);
  const [daySheetLoading, setDaySheetLoading] = useState(false);
  const [daySheetError, setDaySheetError] = useState('');

  // Phase 6.11: inline edit / delete of today's own logs.
  // Modals render inside the day-sheet backdrop; server call uses the
  // participant-scoped PATCH/DELETE endpoints and then reloads the sheet +
  // analytics so every total on screen reflects the post-recompute truth.
  const [editTarget, setEditTarget] = useState<AnalyticsDayEntry | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<AnalyticsDayEntry | null>(null);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Feed tab
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedError, setFeedError] = useState('');

  // Rules tab
  const [rules, setRules] = useState<PortalRules | null>(null);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [rulesError, setRulesError] = useState('');


  // ─── Load context ──────────────────────────────────────────────────────────

  useEffect(() => {
    // Pass the URL-saved group selection (if any) to the server so the
    // activeGroupId in the response reflects the user's last choice.
    // Read fresh from the URL here rather than depend on state — the
    // state gets updated below after the response lands and we don't
    // want to re-fire the effect on every switcher click.
    const urlGroup = typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('group')
      : null;
    const groupParam = urlGroup ? `?groupId=${encodeURIComponent(urlGroup)}` : '';
    apiFetch<PortalContext>(`${BASE_URL}/public/participant/${token}${groupParam}`, { cache: 'no-store' })
      .then((data) => {
        setCtx(data);
        // Adopt the server-resolved activeGroupId — server validates
        // membership and silently falls back to the primary group when
        // the URL param is stale, so this is always a safe value.
        setSelectedGroupId(data.activeGroupId);
        // ── Resolve portal opening state ─────────────────────────────────
        // All comparisons are in UTC (both sides are Date objects).
        const now = Date.now();
        const callTime = data.portalCallTime ? new Date(data.portalCallTime).getTime() : null;
        const openTime = data.portalOpenTime ? new Date(data.portalOpenTime).getTime() : null;

        if (openTime !== null && now < openTime) {
          // Portal not yet open. Decide A or B.
          if (callTime !== null && now < callTime) {
            setState('waiting_a'); // pre-call: show countdown
          } else {
            setState('waiting_b'); // call has happened, portal opening soon
          }
        } else {
          // Portal is open (or no restriction set)
          setState('ready');
        }
      })
      .catch((err) => {
        const msg = typeof err === 'object' && err !== null && 'message' in err
          ? String((err as { message: string }).message)
          : '';
        if (msg === 'program_inactive') { setState('inactive'); return; }
        if (msg === 'game_ended') { setState('game_ended'); return; }
        setLoadError(msg || 'שגיאה בטעינת הדף');
        setState('invalid');
      });

  }, [token]);

  // ─── Data loaders ──────────────────────────────────────────────────────────
  // Stats and feed: always re-fetch (fresh on entry, fresh on tab-switch).
  // silent=true → no loading spinner; used for background refresh and post-submit refresh.
  // silent=false (default) → show spinner when there is no data yet.

  const refreshStats = useCallback((silent = false) => {
    if (!silent) setStatsLoading(true);
    const groupQs = selectedGroupId ? `?groupId=${encodeURIComponent(selectedGroupId)}` : '';
    apiFetch<PortalStats>(`${BASE_URL}/public/participant/${token}/stats${groupQs}`, { cache: 'no-store' })
      .then((data) => { setStats(data); setStatsError(''); })
      .catch(() => setStatsError('שגיאה בטעינת הנתונים'))
      .finally(() => setStatsLoading(false));
  }, [token, selectedGroupId]);

  // ── Analytics loaders (Phase 2B: range + groupBy aware) ────────────────
  //
  // Quick keys 7d/14d/30d map to the trend's `days=` param.
  // 'all' uses `?days=30` for the trend (needs a bounded window) and `?period=all`
  //   for breakdown.
  // 'custom' passes explicit `from`/`to` to both endpoints.
  // Idempotent URL builders — no side effects — keep refetch logic predictable.
  // Phase 4.6: build the period/from-to query chunk shared by breakdown + slice.
  function buildRangeQuery(r: AnalyticsRange): string {
    if (r.key === 'today') {
      const today = new Date().toISOString().slice(0, 10);
      return `from=${today}&to=${today}`;
    }
    if (r.key === 'custom' && r.from && r.to) {
      return `from=${r.from}&to=${r.to}`;
    }
    return `period=${r.key === 'custom' ? '14d' : r.key}`;
  }

  function buildTrendQuery(r: AnalyticsRange): string {
    if (r.key === 'today') {
      const today = new Date().toISOString().slice(0, 10);
      return `from=${today}&to=${today}`;
    }
    if (r.key === 'custom' && r.from && r.to) return `from=${r.from}&to=${r.to}`;
    const days = r.key === '7d' ? 7 : r.key === '30d' ? 30 : r.key === 'all' ? 30 : 14;
    return `days=${days}`;
  }
  function buildBreakdownQuery(r: AnalyticsRange, g: BreakdownGroupBy): string {
    let base: string;
    if (r.key === 'today') {
      const today = new Date().toISOString().slice(0, 10);
      base = `from=${today}&to=${today}`;
    } else if (r.key === 'custom' && r.from && r.to) {
      base = `from=${r.from}&to=${r.to}`;
    } else {
      base = `period=${r.key === 'custom' ? '14d' : r.key}`;
    }
    return `${base}&groupBy=${encodeURIComponent(g)}`;
  }
  // Phase 6: insights are range-scoped (not groupBy-scoped). They aggregate
  // the same ledger data regardless of which category pill is selected, so
  // we only re-fetch when the range changes, not when groupBy flips.
  function buildInsightsQuery(r: AnalyticsRange): string {
    if (r.key === 'today') {
      const today = new Date().toISOString().slice(0, 10);
      return `from=${today}&to=${today}`;
    }
    if (r.key === 'custom' && r.from && r.to) return `from=${r.from}&to=${r.to}`;
    return `period=${r.key === 'custom' ? '14d' : r.key}`;
  }

  const refreshAnalytics = useCallback(
    (silent = false, r: AnalyticsRange = range, g: BreakdownGroupBy = groupBy) => {
      if (!silent) setAnalyticsLoading(true);
      // Phase 6.14: insights is fetched INDEPENDENTLY of the core analytics
      // bundle. A failure in insights must not tear down the whole screen —
      // a truthful empty section is better than a blank page.
      apiFetch<AnalyticsInsight[]>(
        `${BASE_URL}/public/participant/${token}/analytics/insights?${buildInsightsQuery(r)}`,
        { cache: 'no-store' },
      )
        .then(setAnalyticsInsights)
        .catch(() => {
          // Soft fail: hide the section this render, don't cascade the error
          // into the rest of the analytics screen.
          setAnalyticsInsights([]);
        });
      Promise.all([
        apiFetch<AnalyticsSummary>(
          `${BASE_URL}/public/participant/${token}/analytics/summary`,
          { cache: 'no-store' },
        ),
        apiFetch<AnalyticsTrendPoint[]>(
          `${BASE_URL}/public/participant/${token}/analytics/trend?${buildTrendQuery(r)}`,
          { cache: 'no-store' },
        ),
        apiFetch<AnalyticsBreakdownEntry[]>(
          `${BASE_URL}/public/participant/${token}/analytics/breakdown?${buildBreakdownQuery(r, g)}`,
          { cache: 'no-store' },
        ),
      ])
        .then(([summary, trend, breakdown]) => {
          setAnalyticsSummary(summary);
          setAnalyticsTrend(trend);
          setAnalyticsBreakdown(breakdown);
          setAnalyticsError('');
        })
        .catch(() => setAnalyticsError('שגיאה בטעינת הנתונים'))
        .finally(() => setAnalyticsLoading(false));
    },
    [token, range, groupBy],
  );

  const refreshTrendOnly = useCallback(
    (r: AnalyticsRange) => {
      apiFetch<AnalyticsTrendPoint[]>(
        `${BASE_URL}/public/participant/${token}/analytics/trend?${buildTrendQuery(r)}`,
        { cache: 'no-store' },
      )
        .then(setAnalyticsTrend)
        .catch(() => setAnalyticsError('שגיאה בטעינת הנתונים'));
    },
    [token],
  );

  const refreshBreakdownOnly = useCallback(
    (r: AnalyticsRange, g: BreakdownGroupBy) => {
      apiFetch<AnalyticsBreakdownEntry[]>(
        `${BASE_URL}/public/participant/${token}/analytics/breakdown?${buildBreakdownQuery(r, g)}`,
        { cache: 'no-store' },
      )
        .then(setAnalyticsBreakdown)
        .catch(() => setAnalyticsError('שגיאה בטעינת הנתונים'));
    },
    [token],
  );

  const loadContextDimensions = useCallback(() => {
    apiFetch<ContextDimension[]>(
      `${BASE_URL}/public/participant/${token}/analytics/context-dimensions`,
      { cache: 'no-store' },
    )
      .then(setContextDimensions)
      .catch(() => { /* non-critical — toggle just stays hidden */ });
  }, [token]);

  /**
   * Apply a new range. For quick keys fetch immediately. For a custom range
   * validate before fetching so bad input never touches the network.
   */
  const applyRange = useCallback(
    (next: AnalyticsRange) => {
      setRangeError('');
      if (next.key === 'custom') {
        if (!next.from || !next.to) {
          setRangeError('יש לבחור תאריך התחלה וסיום');
          return;
        }
        if (next.from > next.to) {
          setRangeError('תאריך ההתחלה חייב להיות לפני תאריך הסיום');
          return;
        }
        const today = new Date().toISOString().slice(0, 10);
        if (next.to > today) {
          setRangeError('לא ניתן לבחור תאריך עתידי');
          return;
        }
      }
      setRange(next);
      setFocusedSliceKey(null); // reset pie highlight when scope changes
      refreshAnalytics(true, next, groupBy);
    },
    [refreshAnalytics, groupBy],
  );

  const loadDayDrilldown = useCallback(
    (date: string) => {
      setDaySheetDate(date);
      setDaySheetEntries(null);
      setDaySheetLoading(true);
      setDaySheetError('');
      apiFetch<AnalyticsDayEntry[]>(
        `${BASE_URL}/public/participant/${token}/analytics/day?date=${date}`,
        { cache: 'no-store' },
      )
        .then(setDaySheetEntries)
        .catch(() => setDaySheetError('שגיאה בטעינת פירוט היום'))
        .finally(() => setDaySheetLoading(false));
    },
    [token],
  );

  const closeDaySheet = useCallback(() => {
    setDaySheetDate(null);
    setDaySheetEntries(null);
    setDaySheetError('');
  }, []);

  // Phase 6.11 edit/delete handlers.
  // Server call → reload the day sheet + full analytics + ctx (today's score)
  // so every visible total reflects the post-recompute truth. No optimistic
  // state: we wait for the server and always refetch.
  const openEditModal = useCallback((entry: AnalyticsDayEntry) => {
    setEditTarget(entry);
    setEditValue(entry.rawValue ?? '');
    setEditError('');
  }, []);
  const closeEditModal = useCallback(() => {
    if (editSaving) return;
    setEditTarget(null);
    setEditValue('');
    setEditError('');
  }, [editSaving]);
  const submitEdit = useCallback(async () => {
    if (!editTarget) return;
    const trimmed = editValue.trim();
    if (!trimmed) {
      setEditError('יש להזין ערך');
      return;
    }
    setEditSaving(true);
    setEditError('');
    try {
      await apiFetch(
        `${BASE_URL}/public/participant/${token}/logs/${editTarget.logId}`,
        {
          method: 'PATCH',
          cache: 'no-store',
          body: JSON.stringify({ value: trimmed }),
        },
      );
      // Reload the day sheet, then refresh all analytics surfaces so the
      // totals in header, chart, breakdown, and insights all shift together.
      if (daySheetDate) {
        const fresh = await apiFetch<AnalyticsDayEntry[]>(
          `${BASE_URL}/public/participant/${token}/analytics/day?date=${daySheetDate}`,
          { cache: 'no-store' },
        );
        setDaySheetEntries(fresh);
      }
      refreshAnalytics(true);
      // Refresh portal context so the header's todayScore reflects post-
      // recompute truth. Best-effort; stale data is an acceptable fallback.
      try {
        const fresh = await apiFetch<PortalContext>(
          `${BASE_URL}/public/participant/${token}`,
          { cache: 'no-store' },
        );
        setCtx((prev) =>
          prev
            ? { ...prev, todayScore: fresh.todayScore, todayValues: fresh.todayValues }
            : prev,
        );
      } catch {
        /* ignore */
      }
      setEditTarget(null);
      setEditValue('');
    } catch (e) {
      const msg =
        e && typeof e === 'object' && 'message' in e
          ? String((e as { message?: string }).message ?? '')
          : '';
      setEditError(msg || 'שגיאה בשמירה');
    } finally {
      setEditSaving(false);
    }
  }, [editTarget, editValue, daySheetDate, token]);

  const openDeleteModal = useCallback((entry: AnalyticsDayEntry) => {
    setDeleteTarget(entry);
    setDeleteError('');
  }, []);
  const closeDeleteModal = useCallback(() => {
    if (deleteSaving) return;
    setDeleteTarget(null);
    setDeleteError('');
  }, [deleteSaving]);
  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleteSaving(true);
    setDeleteError('');
    try {
      await apiFetch(
        `${BASE_URL}/public/participant/${token}/logs/${deleteTarget.logId}`,
        { method: 'DELETE', cache: 'no-store' },
      );
      if (daySheetDate) {
        const fresh = await apiFetch<AnalyticsDayEntry[]>(
          `${BASE_URL}/public/participant/${token}/analytics/day?date=${daySheetDate}`,
          { cache: 'no-store' },
        );
        setDaySheetEntries(fresh);
      }
      refreshAnalytics(true);
      // Refresh portal context so the header's todayScore reflects post-
      // recompute truth. Best-effort; stale data is an acceptable fallback.
      try {
        const fresh = await apiFetch<PortalContext>(
          `${BASE_URL}/public/participant/${token}`,
          { cache: 'no-store' },
        );
        setCtx((prev) =>
          prev
            ? { ...prev, todayScore: fresh.todayScore, todayValues: fresh.todayValues }
            : prev,
        );
      } catch {
        /* ignore */
      }
      setDeleteTarget(null);
    } catch (e) {
      const msg =
        e && typeof e === 'object' && 'message' in e
          ? String((e as { message?: string }).message ?? '')
          : '';
      setDeleteError(msg || 'שגיאה במחיקה');
    } finally {
      setDeleteSaving(false);
    }
  }, [deleteTarget, daySheetDate, token]);

  // Phase 4.6: open the slice drill-down. Caller supplies the view title
  // (e.g. "שגרה · בוקר") so the sheet shows the participant what she tapped.
  const openSliceSheet = useCallback(
    (title: string, currentGroupBy: BreakdownGroupBy, value: string, r: AnalyticsRange) => {
      if (currentGroupBy === 'action') return; // pie in action view isn't context-based
      setSliceSheet({ title, entries: null, loading: true, error: '' });
      const qs =
        `groupBy=${encodeURIComponent(currentGroupBy)}&value=${encodeURIComponent(value)}&${buildRangeQuery(r)}`;
      apiFetch<AnalyticsSliceEntry[]>(
        `${BASE_URL}/public/participant/${token}/analytics/slice-drilldown?${qs}`,
        { cache: 'no-store' },
      )
        .then((entries) =>
          setSliceSheet((prev) => (prev ? { ...prev, entries, loading: false } : prev)),
        )
        .catch(() =>
          setSliceSheet((prev) => (prev ? { ...prev, loading: false, error: 'שגיאה בטעינת הפירוט' } : prev)),
        );
    },
    [token],
  );

  const closeSliceSheet = useCallback(() => setSliceSheet(null), []);

  const refreshFeed = useCallback((silent = false) => {
    if (!silent) setFeedLoading(true);
    const groupQs = selectedGroupId ? `?groupId=${encodeURIComponent(selectedGroupId)}` : '';
    apiFetch<FeedItem[]>(`${BASE_URL}/public/participant/${token}/feed${groupQs}`, { cache: 'no-store' })
      .then((data) => { setFeed(data); setFeedError(''); })
      .catch(() => setFeedError('שגיאה בטעינת המבזק'))
      .finally(() => setFeedLoading(false));
  }, [token, selectedGroupId]);

  // Phase 8 — when the user picks a different group from the switcher,
  // refresh stats + feed quietly. We don't reload the whole page or the
  // context (the gate / actions / today's score are program-scoped, not
  // group-scoped) so logs and inputs are never lost. Skip the very
  // first render: the initial fetches are kicked off elsewhere.
  const lastGroupRef = useRef<string | null>(null);
  useEffect(() => {
    if (state !== 'ready') return;
    if (!selectedGroupId) return;
    if (lastGroupRef.current === null) { lastGroupRef.current = selectedGroupId; return; }
    if (lastGroupRef.current === selectedGroupId) return;
    lastGroupRef.current = selectedGroupId;
    refreshStats(stats !== null);
    refreshFeed(feed.length > 0);
    // stats / feed deliberately omitted from deps — including them would
    // refire after every refresh and we'd loop. We just need this to
    // run when the selection actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGroupId, state, refreshStats, refreshFeed]);

  // Picks a group from the switcher. Updates state + URL (?group=<id>)
  // so a refresh keeps the choice. Logs / inputs / streak / score are
  // unaffected — only ranking + feed re-scope.
  function switchGroup(id: string) {
    setSelectedGroupId(id);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('group', id);
      window.history.replaceState({}, '', url.toString());
    }
  }

  const loadRules = useCallback(() => {
    if (rulesLoaded.current) return;
    rulesLoaded.current = true;
    setRulesLoading(true);
    apiFetch<PortalRules>(`${BASE_URL}/public/participant/${token}/rules`, { cache: 'no-store' })
      .then(setRules)
      .catch(() => setRulesError('שגיאה בטעינת החוקים'))
      .finally(() => setRulesLoading(false));
  }, [token]);

  // ─── 5-minute background refresh while portal is open ─────────────────────

  useEffect(() => {
    if (state !== 'ready') return;
    const id = setInterval(() => {
      refreshAnalytics(true); // silent — no spinner
      refreshStats(true);     // still needed for leaderboard under feed tab
      refreshFeed(true);
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [state, refreshAnalytics, refreshStats, refreshFeed]);

  // ─── Waiting state: countdown + auto-advance ──────────────────────────────
  // Runs only in waiting_a and waiting_b states.
  // Ticks every second. When a threshold is crossed, advances state automatically.

  useEffect(() => {
    if (state !== 'waiting_a' && state !== 'waiting_b') return;
    if (!ctx) return;

    const callTime = ctx.portalCallTime ? new Date(ctx.portalCallTime).getTime() : null;
    const openTime = ctx.portalOpenTime ? new Date(ctx.portalOpenTime).getTime() : null;

    const tick = () => {
      const now = Date.now();

      // Check if portal should now be open
      if (openTime !== null && now >= openTime) {
        setState('ready');
        return;
      }

      // Check if we should advance from A → B
      if (state === 'waiting_a' && callTime !== null && now >= callTime) {
        setState('waiting_b');
        return;
      }

      // Update countdown (only meaningful in waiting_a)
      if (state === 'waiting_a' && callTime !== null) {
        const diff = callTime - now;
        if (diff > 0) {
          setCountdown({
            days: Math.floor(diff / 86_400_000),
            hours: Math.floor((diff % 86_400_000) / 3_600_000),
            minutes: Math.floor((diff % 3_600_000) / 60_000),
            seconds: Math.floor((diff % 60_000) / 1_000),
          });
        }
      }
    };

    tick(); // Run immediately on mount
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [state, ctx]);

  function switchTab(tab: TabId) {
    setActiveTab(tab);
    // Phase 6.1: reflect the active tab in the URL so a refresh lands on the
    // same tab. `report` is the default — clear the query param in that case
    // to keep URLs clean. Use replaceState so this never adds a history entry
    // (participants tapping tabs shouldn't pollute back-button history).
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (tab === 'report') url.searchParams.delete('tab');
      else url.searchParams.set('tab', tab);
      window.history.replaceState({}, '', url.toString());
    }
    // Analytics tab ("הנתונים שלי"): always fetch fresh so numbers are never stale.
    // Skip the spinner on re-entry to avoid a flicker.
    if (tab === 'stats') {
      refreshAnalytics(analyticsSummary !== null);
      // Context dimensions are loaded lazily the first time the tab is opened.
      // The list only depends on program config + history and rarely changes.
      if (contextDimensions.length === 0) loadContextDimensions();
    }
    // Feed tab renders both the group feed and the group leaderboard (from legacy stats).
    if (tab === 'feed') {
      refreshFeed(feed.length > 0);
      refreshStats(stats !== null);
    }
    if (tab === 'rules') loadRules(); // once-only — rules are static mid-session
  }

  // Phase 6.1 tab restore. Reads `?tab=stats|feed|rules` from the URL once
  // the portal is ready and lands the participant on the persisted tab. Also
  // triggers the normal tab-entry data load via switchTab so the restored tab
  // doesn't render with empty state.
  useEffect(() => {
    if (didRestoreTab.current) return;
    if (state !== 'ready') return;
    didRestoreTab.current = true;
    if (typeof window === 'undefined') return;
    const raw = new URLSearchParams(window.location.search).get('tab');
    if (raw === 'stats' || raw === 'feed' || raw === 'rules' || raw === 'profile') {
      switchTab(raw as TabId);
    }
    // switchTab is a stable function reference in this component (declared at
    // top-level inside the component). Dependencies intentionally omitted —
    // this effect must run exactly once per ready transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // ─── Catch-up countdown ────────────────────────────────────────────────────
  // Drives the active-session banner. Recomputed against the
  // server-issued absolute `expiresAt` rather than `setTimeout(duration)`
  // so client-clock skew can't desync the banner. When the timer
  // crosses zero we fire a toast, clear the session from ctx, and
  // re-fetch the portal context so the button-vs-banner state lands
  // back in sync with the server.
  useEffect(() => {
    const session = ctx?.activeCatchUpSession ?? null;
    if (!session) {
      setCatchUpRemainingMs(null);
      return;
    }
    const expiresAtMs = new Date(session.expiresAt).getTime();
    const tick = () => {
      const remaining = expiresAtMs - Date.now();
      if (remaining <= 0) {
        setCatchUpRemainingMs(0);
        setCatchUpExpiredToast(true);
        setTimeout(() => setCatchUpExpiredToast(false), 3500);
        // Drop the active session locally so the banner disappears
        // immediately. The server has already enforced expiry; the
        // next poll will agree.
        setCtx((prev) => prev ? { ...prev, activeCatchUpSession: null } : prev);
        return;
      }
      setCatchUpRemainingMs(remaining);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [ctx?.activeCatchUpSession]);

  // ─── Catch-up start ────────────────────────────────────────────────────────
  async function startCatchUp() {
    if (!ctx) return;
    setCatchUpStarting(true);
    setCatchUpError('');
    try {
      const session = await apiFetch<{
        id: string;
        expiresAt: string;
        durationMinutes: number;
        allowedDaysBack: number;
        bannerText: string | null;
      }>(`${BASE_URL}/public/participant/${token}/catch-up/start`, {
        method: 'POST',
        body: JSON.stringify({ programId: ctx.program.id }),
      });
      // Inject the new session into ctx so the banner appears + the
      // button hides without a full refetch.
      setCtx((prev) => prev ? {
        ...prev,
        activeCatchUpSession: {
          id: session.id,
          expiresAt: session.expiresAt,
          allowedDaysBack: session.allowedDaysBack,
          bannerText: session.bannerText,
        },
        catchUp: prev.catchUp ? { ...prev.catchUp, availableToday: false } : prev.catchUp,
      } : prev);
      setCatchUpConfirmOpen(false);
    } catch (e) {
      setCatchUpError(e instanceof Error ? e.message : 'הפעלה נכשלה');
    } finally {
      setCatchUpStarting(false);
    }
  }

  // ─── Action sheet ──────────────────────────────────────────────────────────

  function openAction(action: Action) {
    setActiveAction(action);
    setInputValue('');
    setInputError('');
    // Reset context draft to empty per-dimension. For select dimensions we
    // intentionally start blank so the participant must make an explicit choice.
    setContextDraft({});
    setExtraTextDraft('');
    // Catch-up: every action sheet opens defaulted to "today". The
    // day-chip strip below the input lets the participant pick אתמול /
    // שלשום / etc. when an active catch-up session is in flight.
    setCatchUpDaysBack(0);
    // Phase 8 — default the fan-out target set to every active group the
    // participant currently has. The checkbox UI below is rendered only
    // for multi-group-enabled participants with > 1 active group; for
    // everyone else this is a 1-element list and the body just sends it
    // along.
    setFanOutGroupIds(ctx?.groups.map((g) => g.id) ?? []);
    if (action.inputType === 'number' && action.aggregationMode === 'latest_value' && ctx) {
      const current = ctx.todayValues[action.id];
      if (current && current > 0) setInputValue(String(current));
    }
    setTimeout(() => inputRef.current?.focus(), 80);

    // Silently refresh ctx so todayValues is current (handles the case where admin
    // deleted/reset the participant's data while this page was already open).
    apiFetch<PortalContext>(`${BASE_URL}/public/participant/${token}`, { cache: 'no-store' })
      .then((fresh) => {
        setCtx((prev) => prev ? { ...prev, todayScore: fresh.todayScore, todayValues: fresh.todayValues } : prev);
        // Update the pre-fill with the fresh value for latest_value actions
        if (action.inputType === 'number' && action.aggregationMode === 'latest_value') {
          const freshCurrent = fresh.todayValues[action.id] ?? 0;
          setInputValue(freshCurrent > 0 ? String(freshCurrent) : '');
        }
      })
      .catch(() => { /* ignore — stale data is acceptable fallback */ });
  }

  function closeSheet() {
    setActiveAction(null);
    setInputValue('');
    setInputError('');
    setContextDraft({});
    setExtraTextDraft('');
  }

  async function handleSubmit() {
    if (!activeAction || !ctx) return;
    setInputError('');

    const isNumeric = activeAction.inputType === 'number';
    const value = isNumeric ? inputValue.trim() : 'true';

    if (isNumeric) {
      const num = parseFloat(value);
      if (!value || isNaN(num) || num < 0) {
        setInputError('יש להזין מספר תקין');
        return;
      }
    }

    // Phase 3: validate + build the context payload for this action.
    // Mirrors the backend rules so the participant gets immediate feedback
    // before the network round-trip. Backend revalidates as the source of truth.
    const dims = activeAction.contextSchemaJson?.dimensions ?? [];
    const contextJson: Record<string, unknown> = {};
    for (const d of dims) {
      const raw = (contextDraft[d.key] ?? '').trim();
      if (!raw) {
        if (d.required) {
          setInputError(`חובה למלא: ${d.label}`);
          return;
        }
        continue;
      }
      if (d.type === 'select') {
        const opt = (d.options ?? []).find((o) => o.value === raw);
        if (!opt) { setInputError(`בחירה לא חוקית עבור: ${d.label}`); return; }
        contextJson[d.key] = raw;
      } else if (d.type === 'number') {
        const n = parseFloat(raw);
        if (!Number.isFinite(n)) { setInputError(`${d.label} חייב להיות מספר`); return; }
        contextJson[d.key] = n;
      } else {
        // text
        contextJson[d.key] = raw;
      }
    }

    // Phase 4.4: action-level required text input — block submission when
    // configured AND empty. Mirrors the server-side check for snappy UX.
    if (
      activeAction.participantTextRequired &&
      activeAction.participantTextPrompt &&
      activeAction.participantTextPrompt.trim() &&
      !extraTextDraft.trim()
    ) {
      setInputError(`חובה למלא: ${activeAction.participantTextPrompt.trim()}`);
      return;
    }

    setSubmitting(true);
    try {
      const result = await apiFetch<LogResult>(`${BASE_URL}/public/participant/${token}/log`, {
        method: 'POST',
        body: JSON.stringify({
          actionId: activeAction.id,
          value: isNumeric ? value : undefined,
          ...(dims.length > 0 ? { contextJson } : {}),
          // Phase 4.1: action-level free-text answer. Only sent when the
          // participant actually typed something into the optional field.
          ...(extraTextDraft.trim() ? { extraText: extraTextDraft.trim() } : {}),
          // Phase 8 fan-out — the set of groups the participant chose
          // to credit with this report. For single-group / flag-off
          // participants this is a 1-element array. The server fans
          // out one ScoreEvent + FeedEvent per id, all referencing the
          // single UserActionLog created by the call.
          ...(fanOutGroupIds.length > 0 ? { groupIds: fanOutGroupIds } : {}),
          // Legacy single-group hint kept for back-compat with old
          // clients during the rollout window.
          ...(selectedGroupId ? { groupId: selectedGroupId } : {}),
          // Catch-up backdate. Only sent when an active session exists
          // AND the participant chose a day other than today. Server
          // re-validates against the session's allowedDaysBack and
          // re-derives the canonical YYYY-MM-DD from server "now".
          ...(ctx.activeCatchUpSession && catchUpDaysBack > 0
            ? { effectiveDate: shiftLocalDateBack(catchUpDaysBack) }
            : {}),
        }),
      });

      setCtx((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          todayScore: result.todayScore,
          todayValues: {
            ...prev.todayValues,
            [activeAction.id]: result.todayValue ?? prev.todayValues[activeAction.id],
          },
        };
      });

      const actionId = activeAction.id;
      const pointsEarned = result.pointsEarned;
      const soundKey = activeAction.soundKey ?? 'none';
      closeSheet();

      // Immediately refresh נתונים and מבזק so they reflect this action
      refreshStats(true);
      refreshFeed(true);

      if (pointsEarned > 0) {
        // Play configured sound (after confirmed success, not optimistically)
        playActionSound(soundKey);

        // Glow: highlight the action card for 600ms
        setGlowActionId(actionId);
        setTimeout(() => setGlowActionId(null), 600);
      }

      setFeedback((prev) => ({ ...prev, [actionId]: { points: pointsEarned, visible: true } }));
      setTimeout(() => {
        setFeedback((prev) => ({ ...prev, [actionId]: { ...prev[actionId], visible: false } }));
      }, 2200);

    } catch (err) {
      const msg = typeof err === 'object' && err !== null && 'message' in err
        ? String((err as { message: string }).message)
        : 'שגיאה בשליחה';
      setInputError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Loading / error screens ───────────────────────────────────────────────

  if (state === 'loading') {
    return (
      <div style={s.fullScreen}>
        <div style={s.statusBox}>
          <div style={s.spinner} />
          <p style={s.statusText}>טוענת...</p>
        </div>
      </div>
    );
  }

  if (state === 'invalid') {
    return (
      <div style={s.fullScreen}>
        <div style={s.statusBox}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🔗</div>
          <p style={s.statusTitle}>הקישור אינו בתוקף</p>
          <p style={s.statusText}>{loadError || 'יש לפנות למנהלת התוכנית'}</p>
        </div>
      </div>
    );
  }

  if (state === 'inactive') {
    return (
      <div style={s.fullScreen}>
        <div style={s.statusBox}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🏁</div>
          <p style={s.statusTitle}>התוכנית הסתיימה</p>
          <p style={s.statusText}>תודה על ההשתתפות</p>
        </div>
      </div>
    );
  }

  // Phase 8 — token resolves to a real participant but every membership
  // is inactive (or the active one was just deactivated). Friendlier
  // than "invalid link" because the user once played and may rejoin.
  if (state === 'game_ended') {
    return (
      <div style={s.fullScreen}>
        <div style={s.statusBox}>
          <div style={{ fontSize: 44, marginBottom: 16 }}>🎯</div>
          <p style={s.statusTitle}>המשחק הזה הסתיים</p>
          <p style={s.statusText}>אבל אנחנו כבר מחכות לך באתגר הבא 💛</p>
        </div>
      </div>
    );
  }

  // ── State A: before the opening call ──────────────────────────────────────
  if (state === 'waiting_a' && ctx) {
    const firstName = ctx.participant.firstName;
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
      <div style={{
        minHeight: '100vh', background: 'linear-gradient(160deg, #0f172a 0%, #1e3a5f 60%, #0f172a 100%)',
        fontFamily: 'Arial, Helvetica, sans-serif', direction: 'rtl',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '32px 24px',
      }}>
        <style>{`@keyframes pulse-glow { 0%,100%{opacity:0.6;} 50%{opacity:1;} } @keyframes spin { to{transform:rotate(360deg);} }`}</style>
        <div style={{ maxWidth: 400, width: '100%', textAlign: 'center' }}>

          {/* Animated spark */}
          <div style={{ fontSize: 52, marginBottom: 20, animation: 'pulse-glow 2.4s ease-in-out infinite' }}>⚡</div>

          {/* Headline */}
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#f0f9ff', lineHeight: 1.45, margin: '0 0 28px' }}>
            כן {firstName}, כולנו כבר לא יכולות לחכות להתחיל — אבל זה קורה ממש עוד
          </h1>

          {/* Live countdown — RTL order: seconds far right → days far left */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 28,
          }}>
            {[
              { value: countdown.seconds, label: 'שניות'  },
              { value: countdown.minutes, label: 'דקות'   },
              { value: countdown.hours,   label: 'שעות'   },
              { value: countdown.days,    label: 'ימים'   },
            ].map(({ value, label }) => (
              <div key={label} style={{
                background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 12, padding: '14px 8px',
              }}>
                <div style={{ fontSize: 32, fontWeight: 800, color: '#38bdf8', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                  {pad(value)}
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6, letterSpacing: '0.05em' }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Footer text */}
          <p style={{ fontSize: 15, color: '#94a3b8', lineHeight: 1.65, margin: 0 }}>
            בינתיים נשאר רק לחכות בסבלנות,<br />אנחנו ממש מתחילות עוד רגע ✨
          </p>

        </div>
      </div>
    );
  }

  // ── State B: after call time, before actual open ───────────────────────────
  if (state === 'waiting_b' && ctx) {
    return (
      <div style={{
        minHeight: '100vh', background: 'linear-gradient(160deg, #0f172a 0%, #1e3a5f 60%, #0f172a 100%)',
        fontFamily: 'Arial, Helvetica, sans-serif', direction: 'rtl',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '32px 24px',
      }}>
        <style>{`
          @keyframes sparkle-pulse {
            0%,100% { opacity: 0.25; transform: scale(0.8) translateY(0); }
            50%      { opacity: 0.9;  transform: scale(1.1) translateY(-5px); }
          }
        `}</style>
        <div style={{ maxWidth: 380, width: '100%', textAlign: 'center' }}>

          <div style={{ fontSize: 52, marginBottom: 20 }}>🎉</div>

          <h1 style={{ fontSize: 20, fontWeight: 800, color: '#f0f9ff', lineHeight: 1.55, margin: '0 0 32px' }}>
            אולי במקום להציץ תקשיבי לשיחה?<br />
            <span style={{ color: '#38bdf8' }}>סתםםםם</span>, הכל טוב 😉<br />
            תכף זה קורה!!
          </h1>

          {/* Decorative pulsing sparkles — alive but not a loader */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 20, fontSize: 24 }}>
            {[0, 0.7, 1.4].map((delay) => (
              <span key={delay} style={{
                display: 'inline-block',
                animation: `sparkle-pulse 2.2s ease-in-out ${delay}s infinite`,
              }}>✨</span>
            ))}
          </div>

        </div>
      </div>
    );
  }

  if (!ctx) return null;

  const firstName = ctx.participant.firstName;
  const dateRange = formatDateRange(ctx.group.startDate, ctx.group.endDate);

  // ─── Main app render ───────────────────────────────────────────────────────

  return (
    <div style={s.root} dir="rtl">
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeInOut {
          0%   { opacity: 0; transform: scale(0.95); }
          15%  { opacity: 1; transform: scale(1); }
          75%  { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(1.02); }
        }
        @keyframes successGlow {
          0%   { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
          30%  { box-shadow: 0 0 0 6px rgba(34, 197, 94, 0.28); }
          100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
        }
        .action-glow { animation: successGlow 0.6s ease-out forwards; }
        * { box-sizing: border-box; }
      `}</style>

      {/* ── Top bar ── */}
      <div style={s.topBar}>
        <div style={s.topRow}>
          <span style={s.greeting}>{dailyGreeting()}, {firstName}</span>
          <div style={s.todayScorePill}>
            <span style={s.todayScoreNumber}>{ctx.todayScore}</span>
            <span style={s.todayScoreUnit}>נק׳</span>
          </div>
        </div>
        <div style={s.programMeta}>
          <span style={s.programName}>{ctx.program.name}</span>
          {dateRange && <span style={s.dateRange}>{dateRange}</span>}
        </div>
      </div>

      {/* ── Phase 8 — group context switcher ──
          Shown only when the participant has more than one active group
          in this program (managers / assistants / multi-cohort users).
          Tapping a group reloads ranking + feed scoped to that group;
          logs / today's score / streak stay shared. */}
      {ctx.groups.length > 1 && (
        <div
          style={{
            display: 'flex', gap: 6, padding: '8px 12px',
            overflowX: 'auto', WebkitOverflowScrolling: 'touch',
            background: '#f8fafc', borderBottom: '1px solid #e2e8f0',
            position: 'sticky', top: 0, zIndex: 5,
          }}
          aria-label="בחירת קבוצה"
        >
          <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, alignSelf: 'center', whiteSpace: 'nowrap', paddingInlineEnd: 4 }}>
            הקבוצה שלי:
          </span>
          {ctx.groups.map((g) => {
            const isActive = (selectedGroupId ?? ctx.activeGroupId) === g.id;
            return (
              <button
                key={g.id}
                onClick={() => switchGroup(g.id)}
                style={{
                  padding: '6px 12px', fontSize: 12, fontWeight: 600,
                  background: isActive ? '#1d4ed8' : '#fff',
                  color: isActive ? '#fff' : '#475569',
                  border: `1px solid ${isActive ? '#1d4ed8' : '#e2e8f0'}`,
                  borderRadius: 999, cursor: 'pointer',
                  whiteSpace: 'nowrap', flexShrink: 0,
                }}
              >
                {g.name}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Tab content ── */}
      <div style={s.tabContent}>

        {/* ── Tab 1: דיווח שוטף ── */}
        {activeTab === 'report' && (
          <div style={s.actionList}>
            {/* Active catch-up banner — shown ONLY while a session is live.
                Replaces the catch-up button area with a live mm:ss
                countdown. Banner text comes from program config; {time}
                is replaced with the current remaining countdown. */}
            {ctx.activeCatchUpSession && catchUpRemainingMs !== null && catchUpRemainingMs > 0 && (
              <div
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: 12, padding: '12px 14px', marginBottom: 10,
                  background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10,
                  color: '#1d4ed8', fontSize: 13, fontWeight: 600,
                }}
                role="status"
                aria-live="polite"
              >
                <span style={{ flex: 1, lineHeight: 1.5 }}>
                  {(() => {
                    const tpl = ctx.activeCatchUpSession.bannerText
                      ?? `מצב השלמה פעיל — נשארו {time}`;
                    const cd = formatCountdown(catchUpRemainingMs);
                    return tpl.includes('{time}') ? tpl.replace('{time}', cd) : `${tpl} (${cd})`;
                  })()}
                </span>
              </div>
            )}

            {ctx.actions.map((action) => {
              const fb = feedback[action.id];
              const todayDisplay = getTodayDisplay(action, ctx.todayValues);
              const done = (ctx.todayValues[action.id] ?? 0) > 0;
              return (
                <button
                  key={action.id}
                  onClick={() => openAction(action)}
                  className={glowActionId === action.id ? 'action-glow' : undefined}
                  style={{ ...s.actionRow, ...(done ? s.actionRowDone : {}) }}
                  aria-label={`דווחי על: ${action.name}`}
                >
                  <div style={s.actionIndicator(done)} />
                  <div style={s.actionContent}>
                    <span style={s.actionName}>{action.name}</span>
                    {todayDisplay && <span style={s.actionHint}>{todayDisplay}</span>}
                    {!todayDisplay && action.description && <span style={s.actionHint}>{action.description}</span>}
                  </div>
                  <div style={s.pointsBadge}>
                    <span style={s.pointsValue}>+{action.points}</span>
                  </div>
                  {fb?.visible && (
                    <div style={s.successFlash}>
                      <span style={s.successFlashText}>+{fb.points} נקודות!</span>
                    </div>
                  )}
                </button>
              );
            })}
            {ctx.actions.length === 0 && (
              <p style={{ textAlign: 'center', color: '#9ca3af', padding: '40px 0', fontSize: 15 }}>
                אין פעולות להצגה כרגע
              </p>
            )}

            {/* Catch-up button — quiet, at the bottom of the list. Only
                rendered when the program has catch-up enabled, today is
                in the configured availability dates, and no active
                session for today has been started yet. The visibility
                rule is computed entirely server-side and surfaced as
                ctx.catchUp.availableToday so the client never has to
                check dates / sessions / master flag separately. */}
            {ctx.catchUp?.enabled && ctx.catchUp.availableToday && !ctx.activeCatchUpSession && (
              <button
                type="button"
                onClick={() => { setCatchUpError(''); setCatchUpConfirmOpen(true); }}
                style={{
                  marginTop: 18,
                  width: '100%',
                  padding: '12px 16px',
                  background: '#fff',
                  color: '#1d4ed8',
                  border: '1px dashed #93c5fd',
                  borderRadius: 10,
                  fontSize: 13, fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {ctx.catchUp.buttonLabel || 'דיווח השלמה'}
              </button>
            )}
          </div>
        )}

        {/* ── Tab 2: הנתונים שלי (Phase 2A) ── */}
        {activeTab === 'stats' && (
          <div style={s.tabPane}>
            {/* Spinner only when we have NO data yet — otherwise re-fetches are silent
                so the user never sees a full-tab flash during background refresh. */}
            {analyticsLoading && analyticsSummary === null && (
              <div style={s.tabCenter}><div style={s.spinner} /></div>
            )}
            {analyticsError && <p style={s.tabError}>{analyticsError}</p>}
            {analyticsSummary && (
              <>
                {/* ── Summary strip ───────────────────────────────────── */}
                <div style={s.summaryStrip}>
                  <div style={s.summaryChipPrimary}>
                    <span style={s.summaryChipValueAccent}>{analyticsSummary.todayScore}</span>
                    <span style={s.summaryChipLabel}>נקודות היום</span>
                  </div>
                  <div style={s.summaryChip}>
                    <span style={s.summaryChipValue}>{analyticsSummary.currentStreak}</span>
                    <span style={s.summaryChipLabel}>רצף ימים</span>
                  </div>
                  <div style={s.summaryChip}>
                    {(() => {
                      const d = analyticsSummary.trendVsYesterday;
                      const arrow = d > 0 ? '↑' : d < 0 ? '↓' : '—';
                      const color = d > 0 ? '#16a34a' : d < 0 ? '#dc2626' : '#9ca3af';
                      const text = d === 0 ? 'זהה לאתמול' : `${d > 0 ? '+' : ''}${d} מאתמול`;
                      return (
                        <>
                          <span style={{ ...s.summaryChipValue, color }}>{arrow}</span>
                          <span style={{ ...s.summaryChipLabel, color }}>{text}</span>
                        </>
                      );
                    })()}
                  </div>
                </div>

                {/* ── Total ───────────────────────────────────────────── */}
                <div style={s.totalStripe}>
                  <span style={s.totalStripeLabel}>סה"כ</span>
                  <span style={s.totalStripeValue}>
                    {analyticsSummary.totalScore.toLocaleString('he-IL')} נקודות
                  </span>
                </div>

                {/* ── Shared range picker (drives chart + breakdown + pie) */}
                <div style={s.rangeCard}>
                  <div style={s.periodToggle} role="tablist" aria-label="טווח תאריכים">
                    {([
                      { key: 'today' as const, label: 'היום' },
                      { key: '7d'    as const, label: '7'    },
                      { key: '14d'   as const, label: '14'   },
                      { key: '30d'   as const, label: '30'   },
                      { key: 'all'   as const, label: 'הכל'  },
                    ]).map((opt) => (
                      <button
                        key={opt.key}
                        role="tab"
                        aria-selected={range.key === opt.key}
                        onClick={() => {
                          if (range.key === opt.key) return;
                          applyRange({ key: opt.key });
                        }}
                        style={{
                          ...s.periodBtn,
                          ...(range.key === opt.key ? s.periodBtnActive : {}),
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {/* Custom range kept accessible as a secondary affordance so
                      Phase 2B's capability isn't lost. The primary toggle row
                      remains the spec-required 5 quick options. */}
                  <button
                    type="button"
                    onClick={() => {
                      setRange((r) => ({ ...r, key: 'custom' }));
                      setRangeError('');
                    }}
                    style={{
                      ...s.customRangeLink,
                      ...(range.key === 'custom' ? s.customRangeLinkActive : {}),
                    }}
                  >
                    {range.key === 'custom' ? 'טווח מותאם ▾' : 'טווח מותאם'}
                  </button>
                  {range.key === 'custom' && (
                    <div style={s.customRangeRow}>
                      <label style={s.customRangeLabel}>
                        <span style={s.customRangeLabelText}>מתאריך</span>
                        <input
                          type="date"
                          value={customFrom}
                          max={new Date().toISOString().slice(0, 10)}
                          onChange={(e) => setCustomFrom(e.target.value)}
                          style={s.datePickerInput}
                        />
                      </label>
                      <label style={s.customRangeLabel}>
                        <span style={s.customRangeLabelText}>עד תאריך</span>
                        <input
                          type="date"
                          value={customTo}
                          max={new Date().toISOString().slice(0, 10)}
                          onChange={(e) => setCustomTo(e.target.value)}
                          style={s.datePickerInput}
                        />
                      </label>
                      <button
                        style={s.customRangeApply}
                        onClick={() =>
                          applyRange({ key: 'custom', from: customFrom, to: customTo })
                        }
                      >
                        הצגי
                      </button>
                    </div>
                  )}
                  {rangeError && <p style={s.rangeErrorText}>{rangeError}</p>}
                </div>

                {/* ── Insights (Phase 6: backend-driven, above the chart) ── */}
                <InsightsCard insights={analyticsInsights} />


                {/* ── Trend chart ─────────────────────────────────────── */}
                {/* Product rule: progress-style timeline.
                    Show a continuous sequence of real days from the timeline's
                    relevant start through the end of the selected window —
                    INCLUDING zero-value days that fall inside that sequence.
                    Trim the PREFIX of the window (everything before the start)
                    so the chart doesn't render ghost slots for days before the
                    game/participant actually began.

                    Start-anchor resolution, in priority order:
                      1. Group.startDate (if set)   — the authoritative timeline
                         origin; zero days between startDate and the first
                         submission still render.
                      2. First day in the window with activity — used as a
                         fallback when the program doesn't publish a start date.
                      3. If neither yields a start (all zero, no startDate) →
                         empty state. */}
                <div style={s.chartCard}>
                  <p style={s.sectionTitle}>ההתקדמות שלי</p>
                  {(() => {
                    if (analyticsTrend === null) return null;
                    const groupStart = ctx?.group.startDate
                      ? new Date(ctx.group.startDate).toISOString().slice(0, 10)
                      : null;

                    let sliceFrom = -1;
                    if (groupStart) {
                      // First day in the window whose date is on or after the game start.
                      sliceFrom = analyticsTrend.findIndex((d) => d.date >= groupStart);
                    }
                    if (sliceFrom === -1) {
                      // Fallback: first day in the window that has any activity.
                      sliceFrom = analyticsTrend.findIndex(
                        (d) => d.points > 0 || d.submissionCount > 0,
                      );
                    }
                    if (sliceFrom === -1) {
                      return <p style={s.emptyHint}>טרם נאסף מידע בטווח הזה.</p>;
                    }
                    const timeline = analyticsTrend.slice(sliceFrom);
                    return (
                      <InteractiveTrendChart
                        data={timeline}
                        onBarClick={(date) => loadDayDrilldown(date)}
                      />
                    );
                  })()}
                  <div style={s.datePickerRow}>
                    <span style={s.chartHint}>טיפ: הקישי על יום בגרף או בחרי תאריך</span>
                    <label style={s.datePickerLabel}>
                      <input
                        type="date"
                        max={new Date().toISOString().slice(0, 10)}
                        onChange={(e) => {
                          if (e.target.value) loadDayDrilldown(e.target.value);
                        }}
                        style={s.datePickerInput}
                        aria-label="בחרי תאריך"
                      />
                    </label>
                  </div>
                </div>

                {/* ── Breakdown (list + pie, optional group-by context) ─── */}
                {/* Phase 3.4: hierarchical toggle. First level is פעולה / הקשרים.
                    When "הקשרים" is selected and multiple dimensions exist, a
                    compact dropdown lets the participant pick which context
                    she's grouping by. With many contexts, the flat toggle
                    became a wall of buttons — this keeps the first level short. */}
                <div style={s.breakdownCard}>
                  {/* Phase 4.5: N-view flat selector.
                      The number of presentation views is dynamic:
                        - "פעולה" is always present.
                        - Each analytics group becomes one view (groupBy=group:<id>).
                        - Each standalone context becomes one view (groupBy=context:<key>).
                      Views render as a wrapping pill row — inline when there
                      are a few, naturally multi-row when there are many.
                      Never mixes contexts into one pie: every view maps to a
                      single concrete groupBy value. */}
                  {(() => {
                    type View =
                      | { key: 'action'; label: string }
                      | { key: `group:${string}`; label: string }
                      | { key: `context:${string}`; label: string };

                    // Build groups map + standalone list in declaration order.
                    //
                    // Phase 6.4 rules (independent dimensions):
                    //   - GROUP MEMBERSHIP and STANDALONE PILL are independent
                    //     concerns. A context can be both a group member
                    //     (feeding the group's context-level pie) AND a
                    //     standalone pill (showing its own value-level pie).
                    //   - A context becomes a STANDALONE pill when it is
                    //     analytics-visible, was participant-visible during
                    //     reporting, AND has selectable options — regardless
                    //     of whether it also belongs to a group. Grouping is
                    //     an extra presentation layer, not a replacement for
                    //     the context's own selectable view.
                    //   - Hidden / system contexts (analyticsVisible=false or
                    //     participantVisible=false or hasOptions=false) still
                    //     don't appear as standalone — they only participate
                    //     inside a group's aggregation.
                    const groupMap = new Map<string, { label: string; members: ContextDimension[] }>();
                    const standalone: ContextDimension[] = [];
                    for (const d of contextDimensions) {
                      // Group membership — always additive, never exclusive.
                      if (d.groupKey && d.groupLabel) {
                        const g = groupMap.get(d.groupKey);
                        if (g) g.members.push(d);
                        else groupMap.set(d.groupKey, { label: d.groupLabel, members: [d] });
                      }
                      // Standalone eligibility — evaluated independently of
                      // group membership. A participant-visible context with
                      // options gets its own pill even when grouped.
                      const analyticsVisible = d.analyticsVisible !== false;
                      const participantVisible = d.participantVisible !== false;
                      const hasOptions = d.hasOptions !== false;
                      if (analyticsVisible && participantVisible && hasOptions) {
                        standalone.push(d);
                      }
                    }
                    const views: View[] = [
                      { key: 'action', label: 'פעולה' },
                      ...Array.from(groupMap.entries()).map<View>(([gid, v]) => ({
                        key: `group:${gid}` as const,
                        label: v.label,
                      })),
                      ...standalone.map<View>((d) => ({
                        key: `context:${d.key}` as const,
                        label: d.displayLabel?.trim() || d.label,
                      })),
                    ];

                    // Title: resolve by matching the active groupBy against
                    // the built views. Falls back to "לפי פעולות" for the
                    // always-present action view.
                    const active = views.find((v) => v.key === groupBy);
                    const title =
                      !active || active.key === 'action'
                        ? 'לפי פעולות'
                        : `לפי ${active.label}`;

                    return (
                      <>
                        <div style={s.chartHeader}>
                          <p style={s.sectionTitle}>{title}</p>
                        </div>
                        <div
                          role="tablist"
                          aria-label="תצוגת אנליטיקות"
                          style={{
                            display: 'flex',
                            flexWrap: 'wrap' as const,
                            gap: 6,
                            marginBottom: 12,
                          }}
                        >
                          {views.map((v) => {
                            const selected = groupBy === v.key;
                            return (
                              <button
                                key={v.key}
                                role="tab"
                                aria-selected={selected}
                                onClick={() => {
                                  if (selected) return;
                                  setGroupBy(v.key);
                                  setFocusedSliceKey(null);
                                  refreshBreakdownOnly(range, v.key);
                                }}
                                style={{
                                  border: selected ? '1.5px solid #1d4ed8' : '1px solid #e5e7eb',
                                  background: selected ? '#eff6ff' : '#ffffff',
                                  color: selected ? '#1d4ed8' : '#374151',
                                  borderRadius: 999,
                                  padding: '6px 12px',
                                  fontSize: 12,
                                  fontWeight: selected ? 700 : 600,
                                  cursor: 'pointer',
                                  fontFamily: 'inherit',
                                  whiteSpace: 'nowrap' as const,
                                }}
                              >
                                {v.label}
                              </button>
                            );
                          })}
                        </div>
                      </>
                    );
                  })()}
                  {analyticsBreakdown === null ? null : analyticsBreakdown.length === 0 ? (
                    <p style={s.emptyHint}>אין נתונים בטווח שבחרת.</p>
                  ) : (
                    <BreakdownSection
                      rows={analyticsBreakdown}
                      focusedKey={focusedSliceKey}
                      // Phase 4.6: tapping a slice both highlights it AND
                      // opens the concrete drill-down — but only when the
                      // current view is a context/group (action view has no
                      // contextual rows to drill into).
                      onSelect={(k) => {
                        setFocusedSliceKey((cur) => (cur === k ? null : k));
                        if (groupBy !== 'action') {
                          const row = analyticsBreakdown.find((r) => r.actionId === k);
                          const valueLabel = row?.actionName ?? k;
                          // Title: "<viewLabel> · <valueLabel>" — viewLabel
                          // is whichever group or context is currently active.
                          const viewLabel = (() => {
                            if (groupBy.startsWith('group:')) {
                              const gid = groupBy.slice('group:'.length);
                              const dim = contextDimensions.find((d) => d.groupKey === gid);
                              return dim?.groupLabel ?? 'קבוצה';
                            }
                            if (groupBy.startsWith('context:')) {
                              const ckey = groupBy.slice('context:'.length);
                              const dim = contextDimensions.find((d) => d.key === ckey);
                              return dim?.displayLabel?.trim() || dim?.label || 'הקשר';
                            }
                            return '';
                          })();
                          openSliceSheet(`${viewLabel} · ${valueLabel}`, groupBy, k, range);
                        }
                      }}
                    />
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Tab 3: הקבוצה (leaderboard + feed) ── */}
        {activeTab === 'feed' && (
          <div style={s.tabPane}>
            {/* Leaderboard — relocated from the legacy נתונים tab as part of the
                Phase 2A analytics/group separation. Sourced from PortalStats. */}
            {stats && stats.groupLeaderboard.length > 1 && (
              <div style={s.leaderboardCard}>
                <p style={s.sectionTitle}>דירוג הקבוצה</p>
                {stats.groupLeaderboard.map((row) => (
                  <div
                    key={row.participantId}
                    style={{ ...s.leaderRow, ...(row.isMe ? s.leaderRowMe : {}) }}
                  >
                    <span style={s.leaderRank}>#{row.rank}</span>
                    <ParticipantAvatar
                      firstName={row.firstName}
                      lastName={row.lastName}
                      profileImageUrl={row.profileImageUrl}
                      size={28}
                      fontSize={11}
                    />
                    <span style={s.leaderName}>
                      {row.firstName}{row.lastName ? ` ${row.lastName}` : ''}
                      {row.isMe && <span style={s.meBadge}> (את)</span>}
                    </span>
                    <span style={s.leaderScore}>
                      {row.totalScore}
                      {row.todayScore !== 0 && (
                        <span style={s.leaderScoreToday}>
                          {' ('}{row.todayScore > 0 ? '+' : ''}{row.todayScore} היום{')'}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {feedLoading && <div style={s.tabCenter}><div style={s.spinner} /></div>}
            {feedError && <p style={s.tabError}>{feedError}</p>}
            {!feedLoading && !feedError && feed.length === 0 && (
              <p style={{ textAlign: 'center', color: '#9ca3af', padding: '40px 0', fontSize: 15 }}>אין פעילות ב-48 השעות האחרונות</p>
            )}
            {/* Phase 8.1 — feed window expanded from 30 rows to "last 48
                hours". Wrap the list in a scrollable container so a busy
                group doesn't push the bottom nav off-screen on mobile.
                The container height is bounded by viewport math instead
                of a magic px so it adapts to phones, tablets, and the
                portal-opening header above it. */}
            {feed.length > 0 && (
              <div
                style={{
                  maxHeight: 'calc(100vh - 320px)',
                  minHeight: 240,
                  overflowY: 'auto',
                  WebkitOverflowScrolling: 'touch',
                  paddingInlineEnd: 4,
                }}
              >
                {feed.map((item) => (
                  <div key={item.id} style={s.feedItem}>
                    <ParticipantAvatar
                      firstName={item.participant.firstName}
                      lastName={item.participant.lastName}
                      profileImageUrl={item.participant.profileImageUrl}
                      size={40}
                      fontSize={13}
                    />
                    <div style={s.feedContent}>
                      <p style={s.feedMessage}>
                        <span style={s.feedName}>
                          {item.participant.firstName}
                          {item.participant.lastName ? ` ${item.participant.lastName}` : ''}
                        </span>
                        {' '}
                        {item.message}
                      </p>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={s.feedTime}>{relativeTime(item.createdAt)}</span>
                        {item.points > 0 && (
                          <span style={s.feedPoints}>+{item.points} נק׳</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Tab 4: חוקים ── */}
        {activeTab === 'rules' && (
          <div style={s.tabPane}>
            {rulesLoading && <div style={s.tabCenter}><div style={s.spinner} /></div>}
            {rulesError && <p style={s.tabError}>{rulesError}</p>}
            {rules && !rulesLoading && !rules.rulesPublished && (
              <div style={{ textAlign: 'center', padding: '48px 24px' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#374151', marginBottom: 8 }}>תוכן החוקים לא זמין כרגע</div>
                <div style={{ fontSize: 14, color: '#94a3b8' }}>המנהלת תפרסם את החוקים בקרוב</div>
              </div>
            )}
            {rules && !rulesLoading && rules.rulesPublished && (
              <>
                {/* Section A — Program rules rich content */}
                {rules.programRulesContent && (
                  <div style={{ marginBottom: 28 }}>
                    <div
                      style={{
                        fontSize: 15,
                        color: '#1e293b',
                        lineHeight: 1.7,
                        background: '#ffffff',
                        border: '1px solid #e2e8f0',
                        borderRadius: 14,
                        padding: '18px 18px',
                      }}
                      dangerouslySetInnerHTML={{ __html: rules.programRulesContent }}
                    />
                  </div>
                )}

                {/* Section B — Action cards */}
                <p style={{ ...s.sectionTitle, marginBottom: 12 }}>פעולות ונקודות</p>
                {rules.actions.map((a) => (
                  <div key={a.id} style={{ ...s.ruleActionRow, flexDirection: 'column', alignItems: 'stretch', gap: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                      <div style={{ flex: 1 }}>
                        <span style={s.ruleActionName}>{a.name}</span>
                        {a.description && <span style={s.ruleActionDesc}>{a.description}</span>}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                          {a.maxPerDay && (
                            <span style={s.ruleTag}>עד {a.maxPerDay} פעמים ביום</span>
                          )}
                          {a.unit && (
                            <span style={s.ruleTag}>{a.unit}</span>
                          )}
                          {a.inputType === 'number' && a.aggregationMode === 'latest_value' && (
                            <span style={s.ruleTag}>סה&quot;כ שוטף</span>
                          )}
                          {a.inputType === 'number' && a.aggregationMode === 'incremental_sum' && (
                            <span style={s.ruleTag}>צבירה</span>
                          )}
                        </div>
                      </div>
                      <div style={s.rulePointsBadge}>+{a.points}</div>
                    </div>
                    {a.explanationContent && (
                      <div
                        style={{
                          marginTop: 12,
                          paddingTop: 12,
                          borderTop: '1px solid #f0f0f0',
                          fontSize: 13,
                          color: '#374151',
                          lineHeight: 1.65,
                        }}
                        dangerouslySetInnerHTML={{ __html: a.explanationContent }}
                      />
                    )}
                  </div>
                ))}

                {/* Section C — Bonus rules */}
                {rules.rules.filter((r) => r.isActive).length > 0 && (
                  <>
                    <p style={{ ...s.sectionTitle, marginTop: 24, marginBottom: 12 }}>בונוסים מיוחדים</p>
                    {rules.rules.filter((r) => r.isActive).map((r) => {
                      const pts = r.rewardJson?.['points'];
                      return (
                        <div key={r.id} style={s.bonusRow}>
                          <div style={s.bonusIcon}>⭐</div>
                          <div style={{ flex: 1 }}>
                            <span style={s.bonusName}>{r.name}</span>
                            <span style={s.bonusDesc}>{ruleDescription(r)}</span>
                          </div>
                          {pts != null && <div style={s.bonusPoints}>+{String(pts)}</div>}
                        </div>
                      );
                    })}
                  </>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Tab 5: פרטים אישיים (Phase 7 — gated by program.profileTabEnabled) ── */}
        {activeTab === 'profile' && ctx?.program?.profileTabEnabled && profileSnapshot && (
          <ProfileTab
            token={token}
            snapshot={profileSnapshot}
            onSnapshotChanged={setProfileSnapshot}
          />
        )}
        {activeTab === 'profile' && ctx?.program?.profileTabEnabled && !profileSnapshot && (
          <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>
            {profileSnapshotState.err ? profileSnapshotState.err : 'טוען...'}
          </div>
        )}

      </div>

      {/* Phase 7 — ripple-attention animation for the profile tab. Soft
          expanding wave keyframes; honors prefers-reduced-motion so the
          animation is suppressed for users who opt out. The class is
          attached only when there are missing required fields. */}
      <style>{`
        @keyframes profile-tab-ripple {
          0%   { transform: scale(0.85); opacity: 0.55; }
          70%  { transform: scale(1.65); opacity: 0; }
          100% { transform: scale(1.65); opacity: 0; }
        }
        .profile-tab-ripple::before,
        .profile-tab-ripple::after {
          content: '';
          position: absolute;
          inset: 50% auto auto 50%;
          width: 38px; height: 38px;
          margin: -19px 0 0 -19px;
          border-radius: 50%;
          background: rgba(220, 38, 38, 0.35);
          pointer-events: none;
          animation: profile-tab-ripple 2.2s ease-out infinite;
        }
        .profile-tab-ripple::after { animation-delay: 1.1s; }
        @media (prefers-reduced-motion: reduce) {
          .profile-tab-ripple::before,
          .profile-tab-ripple::after { animation: none; display: none; }
        }
      `}</style>

      {/* ── Bottom navigation ── */}
      <nav style={s.bottomNav}>
        {(
          [
            { id: 'report', label: 'דיווח',       icon: '✏️' },
            { id: 'stats',  label: 'הנתונים שלי', icon: '📊' },
            // Group tab uses a real inline SVG (not an emoji) so its color can
            // track the active-state palette the same way the other tabs do.
            // Rendered via `iconNode` below; `icon` is kept as a fallback string.
            { id: 'feed',   label: 'הקבוצה',      icon: '',   iconNode: true as const },
            { id: 'rules',  label: 'חוקים',       icon: '📋' },
            // Phase 7 — added last, only when the program admin enabled it.
            ...(ctx?.program?.profileTabEnabled
              ? [{ id: 'profile' as TabId, label: 'פרטים אישיים', icon: '👤' }]
              : []),
          ] as { id: TabId; label: string; icon: string; iconNode?: true }[]
        ).map((tab) => {
          const isActive = activeTab === tab.id;
          // Profile tab gets a missing-required badge + ripple-attention
          // animation when configured fields are still empty. Both stop
          // the moment the count hits zero (badge hidden, ripple class removed).
          const isProfile = tab.id === 'profile';
          const showBadge = isProfile && profileMissingCount > 0;
          const rippleClass = showBadge ? 'profile-tab-ripple' : '';
          return (
            <button
              key={tab.id}
              onClick={() => switchTab(tab.id)}
              className={rippleClass}
              style={{
                ...s.navBtn,
                ...(isActive ? s.navBtnActive : {}),
                position: 'relative',
              }}
            >
              {tab.iconNode ? (
                <GroupNavIcon active={isActive} />
              ) : (
                <span style={s.navIcon}>{tab.icon}</span>
              )}
              <span style={s.navLabel(isActive)}>{tab.label}</span>
              {showBadge && (
                <span
                  aria-label={`${profileMissingCount} שדות חסרים`}
                  style={{
                    position: 'absolute',
                    top: 4,
                    insetInlineEnd: 'calc(50% - 26px)',
                    minWidth: 18,
                    height: 18,
                    padding: '0 5px',
                    background: '#dc2626',
                    color: '#fff',
                    fontSize: 11,
                    fontWeight: 700,
                    lineHeight: '18px',
                    borderRadius: 999,
                    textAlign: 'center',
                    boxShadow: '0 0 0 2px #fff',
                  }}
                >
                  {profileMissingCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* ── Bottom sheet backdrop ── */}
      {activeAction && (
        <div style={s.backdrop} onClick={closeSheet} />
      )}

      {/* ── Bottom sheet ── */}
      <div style={{
        ...s.sheet,
        transform: activeAction ? 'translateX(-50%) translateY(0)' : 'translateX(-50%) translateY(100%)',
      }}>
        {activeAction && (
          <div style={s.sheetInner}>
            <div style={s.sheetHandle} />
            <p style={s.sheetActionName}>{activeAction.name}</p>
            <p style={s.sheetLabel}>{getInputLabel(activeAction)}</p>

            {/* Catch-up day chips — shown ONLY when an active session
                exists. Number of chips = allowedDaysBack + 1, e.g.
                allowedDaysBack=2 → היום / אתמול / שלשום. Default
                selection is היום so a participant who taps an action
                without thinking about the day still credits today.
                Outside an active session this block doesn't render
                and the rest of the sheet behaves identically to before. */}
            {ctx.activeCatchUpSession && (
              <div style={{ marginBottom: 12 }}>
                <p style={{ ...s.sheetLabel, marginBottom: 6 }}>לאיזה יום לשייך את הדיווח?</p>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {Array.from({ length: ctx.activeCatchUpSession.allowedDaysBack + 1 }, (_, i) => i).map((d) => {
                    const selected = catchUpDaysBack === d;
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setCatchUpDaysBack(d)}
                        style={{
                          padding: '8px 14px',
                          fontSize: 13, fontWeight: 600,
                          background: selected ? '#1d4ed8' : '#fff',
                          color: selected ? '#fff' : '#1d4ed8',
                          border: `1px solid ${selected ? '#1d4ed8' : '#bfdbfe'}`,
                          borderRadius: 999,
                          cursor: 'pointer',
                        }}
                      >
                        {catchUpDayLabel(d)}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {activeAction.inputType === 'number' ? (
              <div style={s.inputRow}>
                <input
                  ref={inputRef}
                  type="number"
                  inputMode="numeric"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
                  placeholder="0"
                  style={s.input}
                  min="0"
                  dir="ltr"
                />
                {activeAction.unit && (
                  <span style={s.inputUnit}>{activeAction.unit}</span>
                )}
              </div>
            ) : (
              <p style={s.confirmText}>לחצי "שלח" לאישור הפעולה</p>
            )}

            {/* Phase 3: dynamically rendered context fields. Only appears when
                the action declares a contextSchemaJson with at least one field.
                Phase 3.4: small select (≤6 options) renders as large chip
                buttons for one-tap selection; text inputs capped at 120 chars. */}
            {activeAction.contextSchemaJson?.dimensions?.map((d) => {
              const current = contextDraft[d.key] ?? '';
              const smallSelect =
                d.type === 'select' && (d.options?.length ?? 0) > 0 && (d.options?.length ?? 0) <= 6;
              return (
                <div key={d.key} style={s.contextField}>
                  <label style={s.contextLabel}>
                    {d.label}
                    {d.required && <span style={s.contextRequired}> *</span>}
                  </label>
                  {d.type === 'select' && smallSelect ? (
                    <div style={s.chipsRow}>
                      {(d.options ?? []).map((o) => {
                        const selected = current === o.value;
                        return (
                          <button
                            type="button"
                            key={o.value}
                            onClick={() =>
                              setContextDraft((prev) => ({
                                ...prev,
                                [d.key]: selected ? '' : o.value,
                              }))
                            }
                            style={{
                              ...s.chip,
                              ...(selected ? s.chipSelected : {}),
                            }}
                          >
                            {o.label}
                          </button>
                        );
                      })}
                    </div>
                  ) : d.type === 'select' ? (
                    <select
                      style={s.contextInput}
                      value={current}
                      onChange={(e) =>
                        setContextDraft((prev) => ({ ...prev, [d.key]: e.target.value }))
                      }
                    >
                      <option value="">— בחרי —</option>
                      {(d.options ?? []).map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  ) : d.type === 'number' ? (
                    <input
                      type="number"
                      inputMode="numeric"
                      style={s.contextInput}
                      value={current}
                      onChange={(e) =>
                        setContextDraft((prev) => ({ ...prev, [d.key]: e.target.value }))
                      }
                      dir="ltr"
                    />
                  ) : (
                    <input
                      type="text"
                      style={s.contextInput}
                      value={current}
                      onChange={(e) =>
                        setContextDraft((prev) => ({ ...prev, [d.key]: e.target.value }))
                      }
                      maxLength={120}
                      placeholder="הקלידי טקסט קצר..."
                    />
                  )}
                </div>
              );
            })}

            {/* Phase 4.1: action-level free-text input. Not a context.
                Phase 4.4: red asterisk when required. */}
            {activeAction.participantTextPrompt && activeAction.participantTextPrompt.trim() && (
              <div style={s.contextField}>
                <label style={s.contextLabel}>
                  {activeAction.participantTextPrompt.trim()}
                  {activeAction.participantTextRequired && (
                    <span style={s.contextRequired}> *</span>
                  )}
                </label>
                <input
                  type="text"
                  style={s.contextInput}
                  value={extraTextDraft}
                  onChange={(e) => setExtraTextDraft(e.target.value)}
                  maxLength={120}
                  placeholder="הקלידי טקסט קצר..."
                />
              </div>
            )}

            {/* Phase 8 — multi-group fan-out picker. Visible only when the
                participant has more than one active group in this program
                (the server gates ctx.groups by multiGroupEnabled). Default
                state is "all groups checked" so the typical action keeps
                the one-tap feel; she can uncheck if a report applies to
                fewer groups. */}
            {ctx && ctx.groups.length > 1 && (
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: 10,
                  padding: '10px 12px',
                  marginTop: 10,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>
                  לאיזו קבוצה לזכות את הדיווח?
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 4 }}>
                  {ctx.groups.map((g) => {
                    const checked = fanOutGroupIds.includes(g.id);
                    const lastChecked = checked && fanOutGroupIds.length === 1;
                    return (
                      <label
                        key={g.id}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          fontSize: 14, color: '#0f172a',
                          cursor: lastChecked ? 'not-allowed' : 'pointer',
                          opacity: lastChecked ? 0.85 : 1,
                          padding: '4px 2px',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={lastChecked}
                          onChange={(e) => {
                            // Prevent the participant from unchecking the
                            // last selected group — server would reject and
                            // it's confusing UX. At least one group must
                            // receive the report.
                            if (e.target.checked) {
                              setFanOutGroupIds((cur) => Array.from(new Set([...cur, g.id])));
                            } else if (fanOutGroupIds.length > 1) {
                              setFanOutGroupIds((cur) => cur.filter((id) => id !== g.id));
                            }
                          }}
                          style={{ width: 18, height: 18, accentColor: '#1d4ed8', cursor: 'inherit' }}
                        />
                        <span>{g.name}</span>
                      </label>
                    );
                  })}
                </div>
                <p style={{ fontSize: 11, color: '#64748b', margin: '6px 2px 0', lineHeight: 1.5 }}>
                  ברירת מחדל: כל הקבוצות מסומנות. בטלי סימון אם הדיווח שייך רק לחלקן.
                </p>
              </div>
            )}

            {inputError && <p style={s.inputError}>{inputError}</p>}

            <button
              onClick={handleSubmit}
              disabled={submitting}
              style={{ ...s.submitBtn, ...(submitting ? s.submitBtnDisabled : {}) }}
            >
              {submitting ? 'שולחת...' : 'שלח'}
            </button>

            <button onClick={closeSheet} style={s.cancelBtn}>ביטול</button>
          </div>
        )}
      </div>

      {/* ── Catch-up confirm modal ────────────────────────────────────────
          Locked: no backdrop close, explicit X. Title + body come from
          program config; falls back to a minimal default if the admin
          left them empty. Re-entering the portal mid-session never
          opens this modal — the visibility rule on the trigger button
          already excludes that case. */}
      {catchUpConfirmOpen && ctx?.catchUp && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1100, padding: 16,
          }}
          role="dialog"
          aria-modal="true"
        >
          <div style={{
            background: '#fff', borderRadius: 12, padding: 22, width: '100%',
            maxWidth: 420, boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
              <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: '#0f172a' }}>
                {ctx.catchUp.confirmTitle?.trim() || 'להפעיל מצב השלמה?'}
              </h3>
              <button
                type="button"
                onClick={() => setCatchUpConfirmOpen(false)}
                disabled={catchUpStarting}
                aria-label="סגור"
                style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 22, cursor: catchUpStarting ? 'not-allowed' : 'pointer', lineHeight: 1 }}
              >×</button>
            </div>
            <div style={{ fontSize: 14, color: '#475569', lineHeight: 1.6, marginBottom: 12 }}>
              {ctx.catchUp.confirmBody?.trim()
                || `לאחר ההפעלה תוכלי לדווח על דיווחים מ-${ctx.catchUp.allowedDaysBack} הימים האחרונים. החלון פתוח ל-${ctx.catchUp.durationMinutes} דקות בלבד.`}
            </div>
            {catchUpError && <p style={{ color: '#b91c1c', fontSize: 13, margin: '0 0 10px' }}>{catchUpError}</p>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setCatchUpConfirmOpen(false)}
                disabled={catchUpStarting}
                style={{
                  padding: '8px 16px', fontSize: 13, fontWeight: 600,
                  background: '#f1f5f9', color: '#374151',
                  border: '1px solid #e2e8f0', borderRadius: 8,
                  cursor: catchUpStarting ? 'not-allowed' : 'pointer',
                }}
              >ביטול</button>
              <button
                type="button"
                onClick={() => { void startCatchUp(); }}
                disabled={catchUpStarting}
                style={{
                  padding: '8px 16px', fontSize: 13, fontWeight: 700,
                  background: catchUpStarting ? '#93c5fd' : '#1d4ed8',
                  color: '#fff', border: 'none', borderRadius: 8,
                  cursor: catchUpStarting ? 'not-allowed' : 'pointer',
                }}
              >
                {catchUpStarting ? 'מפעיל...' : 'הפעלי'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Catch-up expired toast ────────────────────────────────────────
          Briefly visible when the timer reaches 0. Position: fixed top
          so it doesn't fight the bottom nav. Auto-dismissed after 3.5s. */}
      {catchUpExpiredToast && (
        <div
          style={{
            position: 'fixed', top: 16, insetInline: 0,
            display: 'flex', justifyContent: 'center',
            zIndex: 1200, pointerEvents: 'none',
          }}
          role="status"
          aria-live="polite"
        >
          <div style={{
            background: '#1e293b', color: '#fff',
            padding: '10px 18px', borderRadius: 999,
            fontSize: 13, fontWeight: 600,
            boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
          }}>
            מצב השלמה הסתיים
          </div>
        </div>
      )}

      {/* ── Day drill-down sheet (Phase 2A) ──────────────────────────────── */}
      {daySheetDate && (
        <div style={s.backdrop} onClick={closeDaySheet} />
      )}
      <div style={{
        ...s.sheet,
        transform: daySheetDate ? 'translateX(-50%) translateY(0)' : 'translateX(-50%) translateY(100%)',
      }}>
        {daySheetDate && (
          <div style={s.sheetInner}>
            <div style={s.sheetHandle} />

            {/* Header: full formatted date + total points for that day.
                Total is derived from the entries array (ScoreEvent.points per
                log) — same source of truth the server used to populate it. */}
            <div style={s.daySheetHeader}>
              <div style={s.daySheetHeaderLeft}>
                <span style={s.daySheetHeaderDay}>
                  {new Date(daySheetDate).toLocaleDateString('he-IL', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                  })}
                </span>
                <span style={s.daySheetHeaderSub}>פירוט הפעולות של היום הזה</span>
              </div>
              <div style={s.daySheetTotal}>
                <span style={s.daySheetTotalValue}>
                  {(daySheetEntries ?? []).reduce((sum, e) => sum + e.points, 0)}
                </span>
                <span style={s.daySheetTotalLabel}>סה״כ נק׳</span>
              </div>
            </div>

            {daySheetLoading && (
              <div style={{ padding: '24px 0', textAlign: 'center' }}>
                <div style={s.spinner} />
              </div>
            )}
            {daySheetError && <p style={s.tabError}>{daySheetError}</p>}
            {!daySheetLoading && !daySheetError && daySheetEntries !== null && (
              daySheetEntries.length === 0 ? (
                <p style={s.emptyHint}>לא נרשמה פעילות ביום זה.</p>
              ) : (
                (() => {
                  // Phase 6.11: edit/delete are only enabled when viewing
                  // TODAY's sheet. Past-day sheets render as read-only
                  // history. Both backend and frontend enforce this so the
                  // UI never offers an action the server will reject.
                  const todayUtc = new Date().toISOString().slice(0, 10);
                  const canEdit = daySheetDate === todayUtc;
                  return (
                    <>
                      {canEdit && (
                        <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 8px', lineHeight: 1.5 }}>
                          עריכה או מחיקה יעדכנו את הניקוד של היום בהתאם
                        </p>
                      )}
                      <DaySheetGroupedList
                        entries={daySheetEntries}
                        canEdit={canEdit}
                        onEdit={openEditModal}
                        onDelete={openDeleteModal}
                      />
                    </>
                  );
                })()
              )
            )}

            <button onClick={closeDaySheet} style={s.cancelBtn}>סגור</button>
          </div>
        )}
      </div>

      {/* ── Phase 6.11: edit-log modal ─────────────────────────────────────── */}
      {editTarget && (
        <>
          <div style={{ ...s.backdrop, zIndex: 110 }} onClick={closeEditModal} />
          <div
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              background: '#fff',
              borderRadius: 14,
              padding: 20,
              width: 'min(360px, calc(100vw - 32px))',
              boxShadow: '0 18px 40px rgba(0,0,0,0.18)',
              zIndex: 120,
              display: 'flex',
              flexDirection: 'column' as const,
              gap: 12,
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
              עריכת {editTarget.actionName}
            </div>
            <p style={{ fontSize: 12, color: '#64748b', margin: 0, lineHeight: 1.5 }}>
              הערך הנוכחי: <b>{editTarget.rawValue}</b>. שמירה תעדכן את הניקוד של היום בהתאם.
            </p>
            <label style={{ display: 'flex', flexDirection: 'column' as const, gap: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>ערך חדש</span>
              <input
                type="number"
                inputMode="numeric"
                dir="ltr"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                  padding: '10px 12px',
                  fontSize: 16,
                  fontFamily: 'inherit',
                  direction: 'ltr' as const,
                }}
                autoFocus
              />
            </label>
            {editError && (
              <p style={{ fontSize: 12, color: '#dc2626', margin: 0 }}>{editError}</p>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={closeEditModal}
                disabled={editSaving}
                style={{
                  background: '#f1f5f9',
                  color: '#475569',
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                  padding: '9px 16px',
                  fontSize: 14,
                  cursor: editSaving ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                ביטול
              </button>
              <button
                type="button"
                onClick={submitEdit}
                disabled={editSaving}
                style={{
                  background: '#2563eb',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  padding: '9px 18px',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: editSaving ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {editSaving ? 'שומרת…' : 'שמור'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Phase 6.11: delete confirmation modal ──────────────────────────── */}
      {deleteTarget && (
        <>
          <div style={{ ...s.backdrop, zIndex: 110 }} onClick={closeDeleteModal} />
          <div
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              background: '#fff',
              borderRadius: 14,
              padding: 20,
              width: 'min(360px, calc(100vw - 32px))',
              boxShadow: '0 18px 40px rgba(0,0,0,0.18)',
              zIndex: 120,
              display: 'flex',
              flexDirection: 'column' as const,
              gap: 12,
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
              מחיקת {deleteTarget.actionName}
            </div>
            <p style={{ fontSize: 13, color: '#374151', margin: 0, lineHeight: 1.5 }}>
              לא ניתן לבטל פעולה זו. הניקוד של היום יעודכן בהתאם.
            </p>
            {deleteError && (
              <p style={{ fontSize: 12, color: '#dc2626', margin: 0 }}>{deleteError}</p>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={closeDeleteModal}
                disabled={deleteSaving}
                style={{
                  background: '#f1f5f9',
                  color: '#475569',
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                  padding: '9px 16px',
                  fontSize: 14,
                  cursor: deleteSaving ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                ביטול
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deleteSaving}
                style={{
                  background: '#dc2626',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  padding: '9px 18px',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: deleteSaving ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {deleteSaving ? 'מוחקת…' : 'מחק'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Phase 4.6: pie-slice drill-down sheet ─────────────────────────── */}
      {sliceSheet && (
        <div style={s.backdrop} onClick={closeSliceSheet} />
      )}
      <div style={{
        ...s.sheet,
        transform: sliceSheet ? 'translateX(-50%) translateY(0)' : 'translateX(-50%) translateY(100%)',
      }}>
        {sliceSheet && (
          <div style={s.sheetInner}>
            <div style={s.sheetHandle} />
            <div style={s.daySheetHeader}>
              <div style={s.daySheetHeaderLeft}>
                <span style={s.daySheetHeaderDay}>{sliceSheet.title}</span>
                <span style={s.daySheetHeaderSub}>כל הדיווחים שתרמו לפרוסה הזו</span>
              </div>
              {sliceSheet.entries && (
                <div style={s.daySheetTotal}>
                  <span style={s.daySheetTotalValue}>
                    {sliceSheet.entries.reduce((sum, e) => sum + e.points, 0)}
                  </span>
                  <span style={s.daySheetTotalLabel}>סה״כ נק׳</span>
                </div>
              )}
            </div>

            {sliceSheet.loading && (
              <div style={{ padding: '24px 0', textAlign: 'center' }}>
                <div style={s.spinner} />
              </div>
            )}
            {sliceSheet.error && <p style={s.tabError}>{sliceSheet.error}</p>}

            {!sliceSheet.loading && !sliceSheet.error && sliceSheet.entries && (
              sliceSheet.entries.length === 0 ? (
                <p style={s.emptyHint}>לא נמצאו רשומות מתאימות.</p>
              ) : (
                <div style={s.daySheetList}>
                  {sliceSheet.entries.map((entry) => (
                    <div key={entry.logId} style={s.daySheetGroup}>
                      <div style={s.daySheetGroupHeader}>
                        <span style={s.daySheetGroupName}>{entry.actionName}</span>
                        <span style={s.daySheetGroupMeta}>
                          <span style={s.daySheetGroupTotal}>
                            {entry.points > 0 ? `+${entry.points}` : entry.points} נק׳
                          </span>
                        </span>
                      </div>
                      <div style={s.daySheetGroupRow}>
                        <span style={s.daySheetTime}>{entry.time}</span>
                        <div style={s.daySheetBody}>
                          {/* Phase 4.6: for group slice drill-downs, surface
                              WHICH context inside the group this row came
                              from — "ארוחה: בוקר" reads naturally and
                              distinguishes entries from different contexts
                              that share a value label. */}
                          <span style={s.daySheetValue}>
                            <b style={{ color: '#111827' }}>{entry.contextLabel}:</b>{' '}
                            {entry.valueLabel}
                          </span>
                          <span style={{ fontSize: 11, color: '#9ca3af' }}>
                            {new Date(entry.date).toLocaleDateString('he-IL', {
                              weekday: 'short',
                              day: 'numeric',
                              month: 'short',
                            })}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}

            <button onClick={closeSliceSheet} style={s.cancelBtn}>סגור</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const BOTTOM_NAV_H = 64;

const s = {
  root: {
    minHeight: '100vh',
    background: '#f9fafb',
    fontFamily: 'Arial, Helvetica, sans-serif',
    direction: 'rtl' as const,
    maxWidth: 480,
    margin: '0 auto',
    position: 'relative' as const,
    overflowX: 'hidden' as const,
    paddingBottom: BOTTOM_NAV_H + 16,
  } satisfies React.CSSProperties,

  fullScreen: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f9fafb',
    fontFamily: 'Arial, Helvetica, sans-serif',
    direction: 'rtl' as const,
  } satisfies React.CSSProperties,

  statusBox: {
    textAlign: 'center' as const,
    padding: '32px 24px',
  } satisfies React.CSSProperties,

  statusTitle: {
    fontSize: 22,
    fontWeight: 700,
    color: '#111827',
    margin: '0 0 8px',
  } satisfies React.CSSProperties,

  statusText: {
    fontSize: 16,
    color: '#6b7280',
    margin: 0,
  } satisfies React.CSSProperties,

  spinner: {
    width: 36,
    height: 36,
    border: '3px solid #e5e7eb',
    borderTopColor: '#1d4ed8',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
    margin: '0 auto 16px',
  } satisfies React.CSSProperties,

  // ── Top bar ──
  topBar: {
    background: '#111827',
    padding: '16px 20px 14px',
    position: 'sticky' as const,
    top: 0,
    zIndex: 10,
  } satisfies React.CSSProperties,

  topRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  } satisfies React.CSSProperties,

  greeting: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: 600,
  } satisfies React.CSSProperties,

  todayScorePill: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 3,
    background: 'rgba(251,191,36,0.15)',
    border: '1px solid rgba(251,191,36,0.35)',
    borderRadius: 20,
    paddingInline: 10,
    paddingBlock: 3,
  } satisfies React.CSSProperties,

  todayScoreNumber: {
    color: '#fbbf24',
    fontSize: 20,
    fontWeight: 800,
    lineHeight: 1,
  } satisfies React.CSSProperties,

  todayScoreUnit: {
    color: '#fcd34d',
    fontSize: 12,
    fontWeight: 600,
  } satisfies React.CSSProperties,

  programMeta: {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
  } satisfies React.CSSProperties,

  programName: {
    color: '#9ca3af',
    fontSize: 13,
  } satisfies React.CSSProperties,

  dateRange: {
    color: '#6b7280',
    fontSize: 12,
  } satisfies React.CSSProperties,

  // ── Tab content area ──
  tabContent: {
    minHeight: 0,
  } satisfies React.CSSProperties,

  tabPane: {
    padding: '16px 16px 0',
  } satisfies React.CSSProperties,

  tabCenter: {
    display: 'flex',
    justifyContent: 'center',
    padding: '40px 0',
  } satisfies React.CSSProperties,

  tabError: {
    textAlign: 'center' as const,
    color: '#ef4444',
    padding: '40px 0',
    fontSize: 15,
  } satisfies React.CSSProperties,

  // ── Report tab ──
  actionList: {
    padding: '12px 16px 0',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 10,
  } satisfies React.CSSProperties,

  actionRow: {
    position: 'relative' as const,
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '18px 16px',
    background: '#ffffff',
    border: '1.5px solid #e5e7eb',
    borderRadius: 14,
    cursor: 'pointer',
    width: '100%',
    textAlign: 'right' as const,
    minHeight: 72,
    transition: 'border-color 0.15s, background 0.15s',
    overflow: 'hidden' as const,
  } satisfies React.CSSProperties,

  actionRowDone: {
    borderColor: '#bbf7d0',
    background: '#f0fdf4',
  } satisfies React.CSSProperties,

  actionIndicator: (done: boolean): React.CSSProperties => ({
    width: 10,
    height: 10,
    borderRadius: '50%',
    background: done ? '#22c55e' : '#d1d5db',
    flexShrink: 0,
  }),

  actionContent: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
    minWidth: 0,
  } satisfies React.CSSProperties,

  actionName: {
    fontSize: 18,
    fontWeight: 600,
    color: '#111827',
    lineHeight: 1.3,
  } satisfies React.CSSProperties,

  actionHint: {
    fontSize: 13,
    color: '#6b7280',
  } satisfies React.CSSProperties,

  pointsBadge: {
    flexShrink: 0,
    background: '#eff6ff',
    border: '1px solid #bfdbfe',
    borderRadius: 8,
    padding: '4px 10px',
  } satisfies React.CSSProperties,

  pointsValue: {
    fontSize: 13,
    fontWeight: 700,
    color: '#1d4ed8',
  } satisfies React.CSSProperties,

  successFlash: {
    position: 'absolute' as const,
    inset: 0,
    background: 'rgba(34, 197, 94, 0.92)',
    borderRadius: 13,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    animation: 'fadeInOut 2.2s ease forwards',
  } satisfies React.CSSProperties,

  successFlashText: {
    fontSize: 20,
    fontWeight: 700,
    color: '#ffffff',
  } satisfies React.CSSProperties,

  // ── Stats tab ──
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 10,
    marginBottom: 16,
  } satisfies React.CSSProperties,

  statCard: {
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: 14,
    padding: '16px 12px',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 4,
  } satisfies React.CSSProperties,

  statValue: {
    fontSize: 28,
    fontWeight: 800,
    color: '#111827',
    lineHeight: 1,
  } satisfies React.CSSProperties,

  statLabel: {
    fontSize: 13,
    color: '#6b7280',
  } satisfies React.CSSProperties,

  // ── Phase 2A: summary strip, period toggle, chart header, drill-down sheet
  summaryStrip: {
    display: 'grid',
    gridTemplateColumns: '1.3fr 1fr 1fr',
    gap: 8,
    marginBottom: 12,
  } satisfies React.CSSProperties,

  // Info cards — all three look the same (white background with a subtle border).
  // Previously the "today" card had a saturated blue fill which read as a selected
  // tab; it is now a plain card with an accent blue number. The label color is
  // consistent across all three chips to reinforce that none are interactive.
  summaryChipPrimary: {
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: 14,
    padding: '12px 14px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
    alignItems: 'flex-start',
  } satisfies React.CSSProperties,

  summaryChip: {
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: 14,
    padding: '12px 10px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
    alignItems: 'flex-start',
  } satisfies React.CSSProperties,

  summaryChipValue: {
    fontSize: 26,
    fontWeight: 800,
    lineHeight: 1,
    color: '#111827',
    fontVariantNumeric: 'tabular-nums' as const,
  } satisfies React.CSSProperties,

  summaryChipValueAccent: {
    fontSize: 26,
    fontWeight: 800,
    lineHeight: 1,
    color: '#1d4ed8',
    fontVariantNumeric: 'tabular-nums' as const,
  } satisfies React.CSSProperties,

  summaryChipLabel: {
    fontSize: 11,
    color: '#6b7280',
    fontWeight: 500,
    lineHeight: 1.2,
  } satisfies React.CSSProperties,

  totalStripe: {
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: 14,
    padding: '10px 14px',
    marginBottom: 16,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  } satisfies React.CSSProperties,

  totalStripeLabel: {
    fontSize: 12,
    color: '#6b7280',
    fontWeight: 600,
  } satisfies React.CSSProperties,

  totalStripeValue: {
    fontSize: 15,
    color: '#111827',
    fontWeight: 800,
  } satisfies React.CSSProperties,

  chartHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  } satisfies React.CSSProperties,

  periodToggle: {
    display: 'inline-flex',
    background: '#f3f4f6',
    borderRadius: 999,
    padding: 2,
    gap: 2,
  } satisfies React.CSSProperties,

  periodBtn: {
    border: 'none',
    background: 'transparent',
    padding: '4px 10px',
    fontSize: 12,
    fontWeight: 600,
    color: '#6b7280',
    borderRadius: 999,
    cursor: 'pointer',
  } satisfies React.CSSProperties,

  periodBtnActive: {
    background: '#ffffff',
    color: '#1d4ed8',
    boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
  } satisfies React.CSSProperties,

  // Shared range card — holds the period toggle and the custom-range inputs.
  rangeCard: {
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: 14,
    padding: '10px 12px',
    marginBottom: 12,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 10,
  } satisfies React.CSSProperties,

  customRangeRow: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    alignItems: 'flex-end',
    gap: 8,
  } satisfies React.CSSProperties,

  customRangeLabel: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 3,
    flex: 1,
    minWidth: 110,
  } satisfies React.CSSProperties,

  customRangeLabelText: {
    fontSize: 11,
    color: '#6b7280',
    fontWeight: 600,
  } satisfies React.CSSProperties,

  customRangeApply: {
    background: '#1d4ed8',
    color: '#ffffff',
    border: 'none',
    borderRadius: 8,
    padding: '6px 14px',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: 'inherit',
  } satisfies React.CSSProperties,

  customRangeLink: {
    background: 'transparent',
    border: 'none',
    color: '#6b7280',
    fontSize: 12,
    fontWeight: 600,
    padding: '2px 4px',
    cursor: 'pointer',
    alignSelf: 'flex-start' as const,
    fontFamily: 'inherit',
    textDecoration: 'underline' as const,
    textUnderlineOffset: 2,
  } satisfies React.CSSProperties,

  customRangeLinkActive: {
    color: '#1d4ed8',
    textDecoration: 'none' as const,
  } satisfies React.CSSProperties,

  rangeErrorText: {
    fontSize: 12,
    color: '#dc2626',
    margin: 0,
    fontWeight: 600,
  } satisfies React.CSSProperties,

  // Insights
  insightsCard: {
    background: '#f8fafc',
    border: '1px solid #e5e7eb',
    borderRadius: 14,
    padding: '12px 14px',
    marginBottom: 12,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
  } satisfies React.CSSProperties,

  insightRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  } satisfies React.CSSProperties,

  insightIcon: {
    fontSize: 16,
    lineHeight: 1,
  } satisfies React.CSSProperties,

  insightText: {
    fontSize: 13,
    color: '#374151',
    lineHeight: 1.35,
    flex: 1,
  } satisfies React.CSSProperties,

  chartHint: {
    marginTop: 0,
    marginBottom: 0,
    fontSize: 11,
    color: '#9ca3af',
    flex: 1,
  } satisfies React.CSSProperties,

  datePickerRow: {
    marginTop: 12,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  } satisfies React.CSSProperties,

  datePickerLabel: {
    display: 'inline-flex',
    alignItems: 'center',
  } satisfies React.CSSProperties,

  datePickerInput: {
    border: '1px solid #d1d5db',
    borderRadius: 8,
    padding: '4px 8px',
    fontSize: 12,
    color: '#374151',
    background: '#ffffff',
    fontFamily: 'inherit',
    cursor: 'pointer',
  } satisfies React.CSSProperties,

  emptyHint: {
    fontSize: 13,
    color: '#9ca3af',
    textAlign: 'center' as const,
    padding: '16px 0',
    margin: 0,
  } satisfies React.CSSProperties,

  breakdownCard: {
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: 14,
    padding: '16px',
    marginBottom: 16,
  } satisfies React.CSSProperties,

  // Phase 2A pass 2: unified breakdown
  pieCenterWrap: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  } satisfies React.CSSProperties,

  breakdownTable: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
    borderTop: '1px solid #f3f4f6',
  } satisfies React.CSSProperties,

  breakdownRow: {
    display: 'grid',
    gridTemplateColumns: '14px 1fr auto auto auto',
    alignItems: 'center',
    columnGap: 10,
    padding: '10px 4px',
    border: 'none',
    background: 'transparent',
    borderBottom: '1px solid #f3f4f6',
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'right' as const,
    transition: 'opacity 0.15s, background 0.15s',
  } satisfies React.CSSProperties,

  breakdownRowFocused: {
    background: '#eff6ff',
  } satisfies React.CSSProperties,

  breakdownRowDot: {
    width: 12,
    height: 12,
    borderRadius: 3,
    flexShrink: 0,
  } satisfies React.CSSProperties,

  breakdownRowName: {
    fontSize: 13,
    fontWeight: 600,
    color: '#111827',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    minWidth: 0,
  } satisfies React.CSSProperties,

  breakdownRowPct: {
    fontSize: 12,
    fontWeight: 700,
    color: '#1d4ed8',
    fontVariantNumeric: 'tabular-nums' as const,
    minWidth: 38,
    textAlign: 'end' as const,
  } satisfies React.CSSProperties,

  breakdownRowPoints: {
    fontSize: 13,
    fontWeight: 800,
    color: '#111827',
    fontVariantNumeric: 'tabular-nums' as const,
    minWidth: 46,
    textAlign: 'end' as const,
  } satisfies React.CSSProperties,

  breakdownRowCount: {
    fontSize: 11,
    fontWeight: 600,
    color: '#9ca3af',
    fontVariantNumeric: 'tabular-nums' as const,
    minWidth: 28,
    textAlign: 'end' as const,
  } satisfies React.CSSProperties,

  // Day drill-down sheet
  daySheetHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '6px 4px 10px',
    borderBottom: '1px solid #f3f4f6',
    marginBottom: 8,
  } satisfies React.CSSProperties,

  daySheetHeaderLeft: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
    flex: 1,
    minWidth: 0,
  } satisfies React.CSSProperties,

  daySheetHeaderDay: {
    fontSize: 16,
    fontWeight: 800,
    color: '#111827',
    lineHeight: 1.2,
  } satisfies React.CSSProperties,

  daySheetHeaderSub: {
    fontSize: 11,
    color: '#9ca3af',
    fontWeight: 500,
  } satisfies React.CSSProperties,

  daySheetTotal: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'flex-end',
    background: '#eff6ff',
    borderRadius: 10,
    padding: '6px 12px',
    flexShrink: 0,
  } satisfies React.CSSProperties,

  daySheetTotalValue: {
    fontSize: 22,
    fontWeight: 800,
    color: '#1d4ed8',
    lineHeight: 1,
    fontVariantNumeric: 'tabular-nums' as const,
  } satisfies React.CSSProperties,

  daySheetTotalLabel: {
    fontSize: 10,
    color: '#1d4ed8',
    fontWeight: 600,
    marginTop: 2,
  } satisfies React.CSSProperties,

  daySheetList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
    margin: '12px 0',
    maxHeight: '50vh',
    overflowY: 'auto' as const,
  } satisfies React.CSSProperties,

  daySheetRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 4px',
    borderBottom: '1px solid #f3f4f6',
  } satisfies React.CSSProperties,

  daySheetTime: {
    fontSize: 12,
    color: '#9ca3af',
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums' as const,
    minWidth: 42,
  } satisfies React.CSSProperties,

  daySheetBody: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
  } satisfies React.CSSProperties,

  daySheetAction: {
    fontSize: 14,
    color: '#111827',
    fontWeight: 600,
  } satisfies React.CSSProperties,

  daySheetValue: {
    fontSize: 12,
    color: '#6b7280',
  } satisfies React.CSSProperties,

  daySheetPoints: {
    fontSize: 14,
    fontWeight: 800,
    color: '#1d4ed8',
    fontVariantNumeric: 'tabular-nums' as const,
  } satisfies React.CSSProperties,

  // Phase 2B: grouped drill-down styles
  daySheetGroup: {
    background: '#ffffff',
    border: '1px solid #f3f4f6',
    borderRadius: 10,
    padding: '8px 10px',
    marginBottom: 6,
  } satisfies React.CSSProperties,

  daySheetGroupHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid #f3f4f6',
    paddingBottom: 6,
    marginBottom: 4,
  } satisfies React.CSSProperties,

  daySheetGroupName: {
    fontSize: 14,
    fontWeight: 700,
    color: '#111827',
  } satisfies React.CSSProperties,

  daySheetGroupMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  } satisfies React.CSSProperties,

  daySheetGroupCount: {
    fontSize: 11,
    color: '#9ca3af',
    fontWeight: 600,
  } satisfies React.CSSProperties,

  daySheetGroupTotal: {
    fontSize: 13,
    color: '#1d4ed8',
    fontWeight: 800,
    fontVariantNumeric: 'tabular-nums' as const,
  } satisfies React.CSSProperties,

  daySheetGroupRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '6px 2px',
  } satisfies React.CSSProperties,

  daySheetPointsSmall: {
    fontSize: 12,
    fontWeight: 700,
    color: '#6b7280',
    fontVariantNumeric: 'tabular-nums' as const,
    minWidth: 34,
    textAlign: 'end' as const,
  } satisfies React.CSSProperties,

  daySheetValueMuted: {
    fontSize: 12,
    color: '#9ca3af',
  } satisfies React.CSSProperties,

  // Placeholder column for the future edit button. Rendered but disabled so
  // the layout already accounts for it in Phase 2B — zero layout shift when
  // Phase 5 wires it up.
  daySheetEditPlaceholder: {
    width: 18,
    textAlign: 'center' as const,
    color: '#e5e7eb',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'not-allowed' as const,
  } satisfies React.CSSProperties,

  chartCard: {
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: 14,
    padding: '16px',
    marginBottom: 16,
  } satisfies React.CSSProperties,

  sectionTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: '#374151',
    margin: '0 0 10px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  } satisfies React.CSSProperties,

  chartAxisLabel: {
    fontSize: 11,
    color: '#9ca3af',
  } satisfies React.CSSProperties,

  trendCard: {
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: 14,
    padding: '14px 16px',
    marginBottom: 16,
    display: 'flex',
    alignItems: 'center',
    gap: 14,
  } satisfies React.CSSProperties,

  trendArrow: {
    fontSize: 32,
    fontWeight: 800,
    lineHeight: 1,
    flexShrink: 0,
  } satisfies React.CSSProperties,

  trendTextGroup: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
  } satisfies React.CSSProperties,

  trendCardLabel: {
    fontSize: 12,
    color: '#9ca3af',
    fontWeight: 500,
  } satisfies React.CSSProperties,

  trendDiff: {
    fontSize: 16,
    fontWeight: 700,
  } satisfies React.CSSProperties,

  leaderboardCard: {
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: 14,
    padding: '16px',
    marginBottom: 16,
  } satisfies React.CSSProperties,

  leaderRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 0',
    borderBottom: '1px solid #f3f4f6',
  } satisfies React.CSSProperties,

  leaderRowMe: {
    background: '#eff6ff',
    margin: '0 -16px',
    padding: '10px 16px',
    borderRadius: 8,
  } satisfies React.CSSProperties,

  leaderRank: {
    fontSize: 13,
    color: '#9ca3af',
    width: 28,
    flexShrink: 0,
  } satisfies React.CSSProperties,

  leaderName: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
    fontWeight: 500,
  } satisfies React.CSSProperties,

  leaderScore: {
    fontSize: 15,
    fontWeight: 700,
    color: '#1d4ed8',
  } satisfies React.CSSProperties,

  leaderScoreToday: {
    fontSize: 12,
    fontWeight: 500,
    color: '#94a3b8',
  } satisfies React.CSSProperties,

  meBadge: {
    fontSize: 12,
    color: '#1d4ed8',
    fontWeight: 400,
  } satisfies React.CSSProperties,

  // ── Feed tab ──
  feedItem: {
    display: 'flex',
    gap: 12,
    padding: '14px 0',
    borderBottom: '1px solid #f3f4f6',
    alignItems: 'flex-start',
  } satisfies React.CSSProperties,

  feedContent: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  } satisfies React.CSSProperties,

  feedMessage: {
    fontSize: 15,
    color: '#111827',
    margin: 0,
    lineHeight: 1.4,
  } satisfies React.CSSProperties,

  feedName: {
    fontWeight: 700,
    color: '#1d4ed8',
  } satisfies React.CSSProperties,

  feedTime: {
    fontSize: 12,
    color: '#9ca3af',
  } satisfies React.CSSProperties,

  feedPoints: {
    fontSize: 12,
    fontWeight: 600,
    color: '#16a34a',
    background: '#dcfce7',
    padding: '1px 7px',
    borderRadius: 10,
  } satisfies React.CSSProperties,

  // ── Rules tab ──
  ruleActionRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    padding: '12px',
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    marginBottom: 8,
  } satisfies React.CSSProperties,

  ruleActionName: {
    fontSize: 15,
    fontWeight: 600,
    color: '#111827',
    display: 'block',
    marginBottom: 2,
  } satisfies React.CSSProperties,

  ruleActionDesc: {
    fontSize: 13,
    color: '#6b7280',
    display: 'block',
    marginBottom: 4,
  } satisfies React.CSSProperties,

  ruleTag: {
    display: 'inline-block',
    fontSize: 11,
    color: '#6b7280',
    background: '#f3f4f6',
    borderRadius: 6,
    padding: '2px 6px',
  } satisfies React.CSSProperties,

  rulePointsBadge: {
    background: '#eff6ff',
    border: '1px solid #bfdbfe',
    borderRadius: 8,
    padding: '4px 10px',
    fontSize: 14,
    fontWeight: 700,
    color: '#1d4ed8',
    flexShrink: 0,
    alignSelf: 'center' as const,
  } satisfies React.CSSProperties,

  bonusRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    padding: '12px',
    background: '#fffbeb',
    border: '1px solid #fde68a',
    borderRadius: 12,
    marginBottom: 8,
  } satisfies React.CSSProperties,

  bonusIcon: {
    fontSize: 20,
    flexShrink: 0,
  } satisfies React.CSSProperties,

  bonusName: {
    fontSize: 15,
    fontWeight: 600,
    color: '#92400e',
    display: 'block',
    marginBottom: 2,
  } satisfies React.CSSProperties,

  bonusDesc: {
    fontSize: 13,
    color: '#78350f',
    display: 'block',
  } satisfies React.CSSProperties,

  bonusPoints: {
    background: '#fef3c7',
    border: '1px solid #fde68a',
    borderRadius: 8,
    padding: '4px 10px',
    fontSize: 14,
    fontWeight: 700,
    color: '#92400e',
    flexShrink: 0,
    alignSelf: 'center' as const,
  } satisfies React.CSSProperties,

  // ── Bottom navigation ──
  bottomNav: {
    position: 'fixed' as const,
    bottom: 0,
    left: '50%',
    transform: 'translateX(-50%)',
    width: '100%',
    maxWidth: 480,
    height: BOTTOM_NAV_H,
    background: '#ffffff',
    borderTop: '1px solid #e5e7eb',
    display: 'flex',
    zIndex: 20,
    paddingBottom: 'env(safe-area-inset-bottom)',
  } satisfies React.CSSProperties,

  navBtn: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    padding: '6px 0',
    minHeight: 48,
  } satisfies React.CSSProperties,

  navBtnActive: {
    borderTop: '2px solid #1d4ed8',
  } satisfies React.CSSProperties,

  navIcon: {
    fontSize: 20,
    lineHeight: 1,
  } satisfies React.CSSProperties,

  navLabel: (active: boolean): React.CSSProperties => ({
    fontSize: 11,
    color: active ? '#1d4ed8' : '#9ca3af',
    fontWeight: active ? 700 : 400,
  }),

  // ── Bottom sheet ──
  backdrop: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.45)',
    zIndex: 40,
  } satisfies React.CSSProperties,

  sheet: {
    position: 'fixed' as const,
    bottom: 0,
    left: '50%',
    width: '100%',
    maxWidth: 480,
    background: '#ffffff',
    borderRadius: '20px 20px 0 0',
    boxShadow: '0 -4px 24px rgba(0,0,0,0.15)',
    zIndex: 50,
    transition: 'transform 0.28s cubic-bezier(0.32, 0.72, 0, 1)',
  } satisfies React.CSSProperties,

  sheetInner: {
    padding: '12px 24px 40px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 0,
  } satisfies React.CSSProperties,

  sheetHandle: {
    width: 40,
    height: 4,
    background: '#d1d5db',
    borderRadius: 4,
    margin: '0 auto 20px',
  } satisfies React.CSSProperties,

  sheetActionName: {
    fontSize: 20,
    fontWeight: 700,
    color: '#111827',
    margin: '0 0 6px',
    textAlign: 'right' as const,
  } satisfies React.CSSProperties,

  sheetLabel: {
    fontSize: 15,
    color: '#6b7280',
    margin: '0 0 20px',
    textAlign: 'right' as const,
  } satisfies React.CSSProperties,

  inputRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 6,
  } satisfies React.CSSProperties,

  input: {
    flex: 1,
    fontSize: 28,
    fontWeight: 700,
    color: '#111827',
    border: '2px solid #e5e7eb',
    borderRadius: 12,
    padding: '14px 16px',
    outline: 'none',
    background: '#f9fafb',
    textAlign: 'center' as const,
    WebkitTextSizeAdjust: '100%',
  } satisfies React.CSSProperties,

  inputUnit: {
    fontSize: 16,
    color: '#9ca3af',
    fontWeight: 500,
    flexShrink: 0,
  } satisfies React.CSSProperties,

  confirmText: {
    fontSize: 15,
    color: '#374151',
    marginBottom: 16,
    textAlign: 'right' as const,
  } satisfies React.CSSProperties,

  // Phase 3: dynamic context fields rendered inside the submission sheet.
  contextField: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
    marginTop: 12,
  } satisfies React.CSSProperties,

  contextLabel: {
    fontSize: 13,
    color: '#374151',
    fontWeight: 600,
  } satisfies React.CSSProperties,

  contextRequired: {
    color: '#dc2626',
    fontWeight: 700,
  } satisfies React.CSSProperties,

  contextInput: {
    fontSize: 15,
    fontWeight: 500,
    color: '#111827',
    border: '1.5px solid #e5e7eb',
    borderRadius: 10,
    padding: '10px 12px',
    outline: 'none',
    background: '#ffffff',
    width: '100%',
    boxSizing: 'border-box' as const,
    fontFamily: 'inherit',
  } satisfies React.CSSProperties,

  // Phase 3.4: chip-style option buttons for small select dimensions.
  chipsRow: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 8,
  } satisfies React.CSSProperties,

  chip: {
    fontSize: 14,
    fontWeight: 600,
    color: '#374151',
    background: '#ffffff',
    border: '1.5px solid #e5e7eb',
    borderRadius: 999,
    padding: '8px 14px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'background 0.12s, border-color 0.12s, color 0.12s',
  } satisfies React.CSSProperties,

  chipSelected: {
    background: '#1d4ed8',
    borderColor: '#1d4ed8',
    color: '#ffffff',
  } satisfies React.CSSProperties,

  inputError: {
    fontSize: 14,
    color: '#ef4444',
    margin: '4px 0 12px',
    textAlign: 'right' as const,
  } satisfies React.CSSProperties,

  submitBtn: {
    width: '100%',
    padding: '17px',
    background: '#1d4ed8',
    color: '#ffffff',
    border: 'none',
    borderRadius: 14,
    fontSize: 17,
    fontWeight: 700,
    cursor: 'pointer',
    marginTop: 8,
    marginBottom: 10,
    minHeight: 54,
  } satisfies React.CSSProperties,

  submitBtnDisabled: {
    background: '#9ca3af',
    cursor: 'not-allowed',
  } satisfies React.CSSProperties,

  cancelBtn: {
    width: '100%',
    padding: '14px',
    background: 'transparent',
    color: '#6b7280',
    border: 'none',
    borderRadius: 14,
    fontSize: 16,
    cursor: 'pointer',
    minHeight: 48,
  } satisfies React.CSSProperties,
} as const;
