'use client';

import { use, useEffect, useRef, useState } from 'react';
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
  actions: Action[];
  todayScore: number;
  todayValues: Record<string, number>;
}

interface LogResult {
  pointsEarned: number;
  todayScore: number;
  todayValue: number | null;
}

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

// ─── Main component ───────────────────────────────────────────────────────────

export default function ParticipantPortal({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);

  const [state, setState] = useState<'loading' | 'invalid' | 'inactive' | 'ready'>('loading');
  const [ctx, setCtx] = useState<PortalContext | null>(null);
  const [loadError, setLoadError] = useState('');

  // Bottom sheet state
  const [activeAction, setActiveAction] = useState<Action | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [inputError, setInputError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Per-action success feedback: actionId → { pointsEarned, visible }
  const [feedback, setFeedback] = useState<Record<string, { points: number; visible: boolean }>>({});

  const inputRef = useRef<HTMLInputElement>(null);

  // ─── Load context ──────────────────────────────────────────────────────────

  useEffect(() => {
    apiFetch<PortalContext>(`${BASE_URL}/public/participant/${token}`, { cache: 'no-store' })
      .then((data) => {
        setCtx(data);
        setState('ready');
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

  // ─── Open input sheet ──────────────────────────────────────────────────────

  function openAction(action: Action) {
    setActiveAction(action);
    setInputValue('');
    setInputError('');
    // Pre-fill for latest_value — participant sees their current reported total
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

  // ─── Submit action ─────────────────────────────────────────────────────────

  async function handleSubmit() {
    if (!activeAction || !ctx) return;
    setInputError('');

    const isNumeric = activeAction.inputType === 'number';
    const value = isNumeric ? inputValue.trim() : 'true';

    // Client-side validation
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

      // Update context with fresh values
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

      // Show success feedback on the row
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

  // ─── Render: loading ───────────────────────────────────────────────────────

  if (state === 'loading') {
    return (
      <div style={styles.fullScreen}>
        <div style={styles.statusBox}>
          <div style={styles.spinner} />
          <p style={styles.statusText}>טוענת...</p>
        </div>
      </div>
    );
  }

  if (state === 'invalid') {
    return (
      <div style={styles.fullScreen}>
        <div style={styles.statusBox}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🔗</div>
          <p style={styles.statusTitle}>הקישור אינו בתוקף</p>
          <p style={styles.statusText}>{loadError || 'יש לפנות למנהלת התוכנית'}</p>
        </div>
      </div>
    );
  }

  if (state === 'inactive') {
    return (
      <div style={styles.fullScreen}>
        <div style={styles.statusBox}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🏁</div>
          <p style={styles.statusTitle}>התוכנית הסתיימה</p>
          <p style={styles.statusText}>תודה על ההשתתפות</p>
        </div>
      </div>
    );
  }

  if (!ctx) return null;

  const firstName = ctx.participant.firstName;
  const dateRange = formatDateRange(ctx.group.startDate, ctx.group.endDate);

  // ─── Render: ready ─────────────────────────────────────────────────────────

  return (
    <div style={styles.root} dir="rtl">
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeInOut {
          0% { opacity: 0; transform: scale(0.95); }
          15% { opacity: 1; transform: scale(1); }
          75% { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(1.02); }
        }
      `}</style>

      {/* ── Top bar ── */}
      <div style={styles.topBar}>
        <div style={styles.topRow}>
          <span style={styles.greeting}>{dailyGreeting()}, {firstName}</span>
          <span style={styles.todayScore}>
            {ctx.todayScore > 0 ? `${ctx.todayScore} נקודות היום` : 'היום: 0 נקודות'}
          </span>
        </div>
        <div style={styles.programMeta}>
          <span style={styles.programName}>{ctx.program.name}</span>
          {dateRange && <span style={styles.dateRange}>{dateRange}</span>}
        </div>
      </div>

      {/* ── Action list ── */}
      <div style={styles.actionList}>
        {ctx.actions.map((action) => {
          const fb = feedback[action.id];
          const todayDisplay = getTodayDisplay(action, ctx.todayValues);
          const done = (ctx.todayValues[action.id] ?? 0) > 0;

          return (
            <button
              key={action.id}
              onClick={() => openAction(action)}
              style={{
                ...styles.actionRow,
                ...(done ? styles.actionRowDone : {}),
              }}
              aria-label={`דווחי על: ${action.name}`}
            >
              {/* Left side: status indicator */}
              <div style={styles.actionIndicator(done)} />

              {/* Content */}
              <div style={styles.actionContent}>
                <span style={styles.actionName}>{action.name}</span>
                {todayDisplay && (
                  <span style={styles.actionHint}>{todayDisplay}</span>
                )}
                {!todayDisplay && action.description && (
                  <span style={styles.actionHint}>{action.description}</span>
                )}
              </div>

              {/* Points badge */}
              <div style={styles.pointsBadge}>
                <span style={styles.pointsValue}>+{action.points}</span>
              </div>

              {/* Success flash */}
              {fb?.visible && (
                <div style={styles.successFlash}>
                  <span style={styles.successFlashText}>+{fb.points} נקודות!</span>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Bottom sheet backdrop ── */}
      {activeAction && (
        <div style={styles.backdrop} onClick={closeSheet} />
      )}

      {/* ── Bottom sheet ── */}
      <div style={{
        ...styles.sheet,
        transform: activeAction ? 'translateX(-50%) translateY(0)' : 'translateX(-50%) translateY(100%)',
      }}>
        {activeAction && (
          <div style={styles.sheetInner}>
            {/* Handle */}
            <div style={styles.sheetHandle} />

            {/* Action name */}
            <p style={styles.sheetActionName}>{activeAction.name}</p>

            {/* Input label */}
            <p style={styles.sheetLabel}>{getInputLabel(activeAction)}</p>

            {/* Input */}
            {activeAction.inputType === 'number' ? (
              <div style={styles.inputRow}>
                <input
                  ref={inputRef}
                  type="number"
                  inputMode="numeric"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
                  placeholder="0"
                  style={styles.input}
                  min="0"
                  dir="ltr"
                />
                {activeAction.unit && (
                  <span style={styles.inputUnit}>{activeAction.unit}</span>
                )}
              </div>
            ) : (
              // Boolean / select — no input needed, just confirm
              <p style={styles.confirmText}>לחצי "שלח" לאישור הפעולה</p>
            )}

            {/* Error */}
            {inputError && (
              <p style={styles.inputError}>{inputError}</p>
            )}

            {/* Submit button */}
            <button
              onClick={handleSubmit}
              disabled={submitting}
              style={{
                ...styles.submitBtn,
                ...(submitting ? styles.submitBtnDisabled : {}),
              }}
            >
              {submitting ? 'שולחת...' : 'שלח'}
            </button>

            {/* Cancel */}
            <button onClick={closeSheet} style={styles.cancelBtn}>
              ביטול
            </button>
          </div>
        )}
      </div>

    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = {
  root: {
    minHeight: '100vh',
    background: '#f9fafb',
    fontFamily: 'Arial, Helvetica, sans-serif',
    direction: 'rtl' as const,
    maxWidth: 480,
    margin: '0 auto',
    position: 'relative' as const,
    overflowX: 'hidden' as const,
  } satisfies React.CSSProperties,

  // ── Full-screen error/loading states ──
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

  // ── Action list ──
  actionList: {
    padding: '12px 16px 32px',
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

  // ── Success flash overlay on row ──
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
    // 16px+ prevents iOS auto-zoom
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
