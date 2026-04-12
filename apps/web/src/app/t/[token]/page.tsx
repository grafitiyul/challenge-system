'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
// REFRESH_INTERVAL_MS: background refresh cadence while portal is open
const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
import { BASE_URL, apiFetch } from '@lib/api';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Action {
  id: string;
  name: string;
  description: string | null;
  inputType: string | null;
  aggregationMode: string;
  unit: string | null;
  points: number;
  maxPerDay: number | null;
}

interface PortalContext {
  participant: { id: string; firstName: string; lastName: string | null };
  group: { id: string; name: string; startDate: string | null; endDate: string | null };
  program: { id: string; name: string; isActive: boolean };
  // Portal opening gate — null means portal is always open
  portalCallTime: string | null;
  portalOpenTime: string | null;
  actions: Action[];
  todayScore: number;
  todayValues: Record<string, number>;
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
  participant: { id: string; firstName: string; lastName: string | null };
}

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

type TabId = 'report' | 'stats' | 'feed' | 'rules';

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

// ─── SVG Bar Chart ────────────────────────────────────────────────────────────

function TrendChart({ data }: { data: { date: string; points: number }[] }) {
  const WIDTH = 320;
  const HEIGHT = 80;
  const BAR_GAP = 2;
  const n = data.length;
  const barW = Math.floor((WIDTH - BAR_GAP * (n - 1)) / n);
  const maxVal = Math.max(...data.map((d) => d.points), 1);

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      style={{ display: 'block', overflow: 'visible' }}
      aria-label="גרף נקודות 14 ימים"
    >
      {data.map((d, i) => {
        const barH = Math.max(2, Math.round((d.points / maxVal) * (HEIGHT - 14)));
        const x = i * (barW + BAR_GAP);
        const y = HEIGHT - barH;
        const isToday = i === n - 1;
        return (
          <g key={d.date}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={barH}
              rx={3}
              fill={isToday ? '#1d4ed8' : d.points > 0 ? '#93c5fd' : '#e5e7eb'}
            />
            {isToday && d.points > 0 && (
              <text
                x={x + barW / 2}
                y={y - 4}
                textAnchor="middle"
                fontSize={9}
                fill="#1d4ed8"
                fontWeight={700}
              >
                {d.points}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ParticipantPortal({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);

  const [state, setState] = useState<'loading' | 'invalid' | 'inactive' | 'waiting_a' | 'waiting_b' | 'ready'>('loading');
  // Countdown for waiting_a state — updated every second
  const [countdown, setCountdown] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  const [ctx, setCtx] = useState<PortalContext | null>(null);
  const [loadError, setLoadError] = useState('');
  const [activeTab, setActiveTab] = useState<TabId>('report');

  // Rules: load only once (rarely changes mid-session)
  const rulesLoaded = useRef(false);

  // Bottom sheet state (report tab)
  const [activeAction, setActiveAction] = useState<Action | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [inputError, setInputError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<Record<string, { points: number; visible: boolean }>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  // Stats tab
  const [stats, setStats] = useState<PortalStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState('');

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
    apiFetch<PortalContext>(`${BASE_URL}/public/participant/${token}`, { cache: 'no-store' })
      .then((data) => {
        setCtx(data);
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
    apiFetch<PortalStats>(`${BASE_URL}/public/participant/${token}/stats`, { cache: 'no-store' })
      .then((data) => { setStats(data); setStatsError(''); })
      .catch(() => setStatsError('שגיאה בטעינת הנתונים'))
      .finally(() => setStatsLoading(false));
  }, [token]);

  const refreshFeed = useCallback((silent = false) => {
    if (!silent) setFeedLoading(true);
    apiFetch<FeedItem[]>(`${BASE_URL}/public/participant/${token}/feed`, { cache: 'no-store' })
      .then((data) => { setFeed(data); setFeedError(''); })
      .catch(() => setFeedError('שגיאה בטעינת המבזק'))
      .finally(() => setFeedLoading(false));
  }, [token]);

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
      refreshStats(true); // silent — no spinner
      refreshFeed(true);  // silent — no spinner
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [state, refreshStats, refreshFeed]);

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
    // stats and feed: always fetch fresh (no spinner if data already present)
    if (tab === 'stats') refreshStats(stats !== null);
    if (tab === 'feed') refreshFeed(feed.length > 0);
    if (tab === 'rules') loadRules(); // once-only — rules are static mid-session
  }

  // ─── Action sheet ──────────────────────────────────────────────────────────

  function openAction(action: Action) {
    setActiveAction(action);
    setInputValue('');
    setInputError('');
    if (action.inputType === 'number' && action.aggregationMode === 'latest_value' && ctx) {
      const current = ctx.todayValues[action.id];
      if (current && current > 0) setInputValue(String(current));
    }
    setTimeout(() => inputRef.current?.focus(), 80);
  }

  function closeSheet() {
    setActiveAction(null);
    setInputValue('');
    setInputError('');
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
      if (activeAction.aggregationMode === 'latest_value') {
        const current = ctx.todayValues[activeAction.id] ?? 0;
        if (num < current) {
          setInputError(`הערך לא יכול לרדת. הסה"כ הנוכחי שלך: ${current}${activeAction.unit ? ' ' + activeAction.unit : ''}`);
          return;
        }
      }
    }

    setSubmitting(true);
    try {
      const result = await apiFetch<LogResult>(`${BASE_URL}/public/participant/${token}/log`, {
        method: 'POST',
        body: JSON.stringify({ actionId: activeAction.id, value: isNumeric ? value : undefined }),
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
      closeSheet();

      // Immediately refresh נתונים and מבזק so they reflect this action
      refreshStats(true);
      refreshFeed(true);

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
        * { box-sizing: border-box; }
      `}</style>

      {/* ── Top bar ── */}
      <div style={s.topBar}>
        <div style={s.topRow}>
          <span style={s.greeting}>{dailyGreeting()}, {firstName}</span>
          <span style={s.todayScore}>
            {ctx.todayScore > 0 ? `${ctx.todayScore} נקודות היום` : 'היום: 0 נקודות'}
          </span>
        </div>
        <div style={s.programMeta}>
          <span style={s.programName}>{ctx.program.name}</span>
          {dateRange && <span style={s.dateRange}>{dateRange}</span>}
        </div>
      </div>

      {/* ── Tab content ── */}
      <div style={s.tabContent}>

        {/* ── Tab 1: דיווח שוטף ── */}
        {activeTab === 'report' && (
          <div style={s.actionList}>
            {ctx.actions.map((action) => {
              const fb = feedback[action.id];
              const todayDisplay = getTodayDisplay(action, ctx.todayValues);
              const done = (ctx.todayValues[action.id] ?? 0) > 0;
              return (
                <button
                  key={action.id}
                  onClick={() => openAction(action)}
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
          </div>
        )}

        {/* ── Tab 2: נתונים ── */}
        {activeTab === 'stats' && (
          <div style={s.tabPane}>
            {statsLoading && <div style={s.tabCenter}><div style={s.spinner} /></div>}
            {statsError && <p style={s.tabError}>{statsError}</p>}
            {stats && !statsLoading && (
              <>
                {/* Score cards */}
                <div style={s.statsGrid}>
                  <div style={s.statCard}>
                    <span style={s.statValue}>{stats.todayScore}</span>
                    <span style={s.statLabel}>היום</span>
                  </div>
                  <div style={s.statCard}>
                    <span style={s.statValue}>{stats.weekScore}</span>
                    <span style={s.statLabel}>השבוע</span>
                  </div>
                  <div style={s.statCard}>
                    <span style={s.statValue}>{stats.totalScore}</span>
                    <span style={s.statLabel}>סה"כ</span>
                  </div>
                  <div style={s.statCard}>
                    <span style={s.statValue}>{stats.currentStreak}</span>
                    <span style={s.statLabel}>רצף ימים</span>
                  </div>
                </div>

                {/* Trend chart */}
                <div style={s.chartCard}>
                  <p style={s.sectionTitle}>14 ימים אחרונים</p>
                  <TrendChart data={stats.dailyTrend} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                    <span style={s.chartAxisLabel}>{stats.dailyTrend[0]?.date ? formatDate(stats.dailyTrend[0].date) : ''}</span>
                    <span style={s.chartAxisLabel}>היום</span>
                  </div>
                </div>

                {/* Leaderboard */}
                {stats.groupLeaderboard.length > 1 && (
                  <div style={s.leaderboardCard}>
                    <p style={s.sectionTitle}>דירוג הקבוצה</p>
                    {stats.groupLeaderboard.map((row) => (
                      <div
                        key={row.participantId}
                        style={{ ...s.leaderRow, ...(row.isMe ? s.leaderRowMe : {}) }}
                      >
                        <span style={s.leaderRank}>#{row.rank}</span>
                        <span style={s.leaderName}>
                          {row.firstName}{row.lastName ? ` ${row.lastName}` : ''}
                          {row.isMe && <span style={s.meBadge}> (את)</span>}
                        </span>
                        <span style={s.leaderScore}>{row.totalScore}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Tab 3: מבזק ── */}
        {activeTab === 'feed' && (
          <div style={s.tabPane}>
            {feedLoading && <div style={s.tabCenter}><div style={s.spinner} /></div>}
            {feedError && <p style={s.tabError}>{feedError}</p>}
            {!feedLoading && !feedError && feed.length === 0 && (
              <p style={{ textAlign: 'center', color: '#9ca3af', padding: '40px 0', fontSize: 15 }}>אין פעילות עדיין</p>
            )}
            {feed.map((item) => (
              <div key={item.id} style={s.feedItem}>
                <div style={s.feedAvatar}>
                  {initials(item.participant.firstName, item.participant.lastName)}
                </div>
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
      </div>

      {/* ── Bottom navigation ── */}
      <nav style={s.bottomNav}>
        {(
          [
            { id: 'report', label: 'דיווח', icon: '✏️' },
            { id: 'stats',  label: 'נתונים', icon: '📊' },
            { id: 'feed',   label: 'מבזק',   icon: '📣' },
            { id: 'rules',  label: 'חוקים',  icon: '📋' },
          ] as { id: TabId; label: string; icon: string }[]
        ).map((tab) => (
          <button
            key={tab.id}
            onClick={() => switchTab(tab.id)}
            style={{
              ...s.navBtn,
              ...(activeTab === tab.id ? s.navBtnActive : {}),
            }}
          >
            <span style={s.navIcon}>{tab.icon}</span>
            <span style={s.navLabel(activeTab === tab.id)}>{tab.label}</span>
          </button>
        ))}
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

  todayScore: {
    color: '#fbbf24',
    fontSize: 15,
    fontWeight: 700,
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

  feedAvatar: {
    width: 40,
    height: 40,
    borderRadius: '50%',
    background: '#dbeafe',
    color: '#1d4ed8',
    fontSize: 13,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    textTransform: 'uppercase' as const,
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
