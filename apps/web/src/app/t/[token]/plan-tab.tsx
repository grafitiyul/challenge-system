'use client';

/**
 * PlanTab — participant task planner inside the personal portal (/t/[token])
 * and the dedicated task portal (/tg/[token]).
 *
 * Owns: token resolution, portal context loading, loading/error states.
 * Delegates: header + board rendering to TaskBoard → TaskBoardHeader.
 *
 * Portal opening gate: respects portalCallTime / portalOpenTime from the task
 * engine context, identical state logic to the game portal (/t/[token]/page.tsx).
 */

import { useEffect, useState } from 'react';
import { BASE_URL, apiFetch } from '@lib/api';
import { TaskBoard } from '@components/task-board';
import { PortalProjectsBoard } from '@components/projects-board';

// Two sibling views inside the task portal. 'plan' is the default — the
// weekly task plan the portal was originally built for. 'projects' is the
// Phase 1 Projects Tracking surface; intentionally lives here (alongside
// Tasks) rather than in the /t/ game portal.
type PortalView = 'plan' | 'projects';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PortalCtx {
  participantId: string;
  participantName: string;
  participantFirstName: string;
  groupId: string;
  groupName: string;
  taskEngineEnabled: boolean;
  memberIsActive: boolean;
  // Portal opening gate — null means always open
  portalCallTime: string | null;
  portalOpenTime: string | null;
}

// ─── Main component ───────────────────────────────────────────────────────────

export function PlanTab({ token }: { token: string }) {
  const [ctx, setCtx] = useState<PortalCtx | null>(null);
  const [ctxLoading, setCtxLoading] = useState(true);
  const [ctxErr, setCtxErr] = useState('');
  const [portalState, setPortalState] = useState<'loading' | 'waiting_a' | 'waiting_b' | 'open'>('loading');
  const [countdown, setCountdown] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  // Current sibling view inside the open portal. Persisted in the URL so
  // a refresh doesn't bounce the participant back to the plan view.
  const [view, setView] = useState<PortalView>(() => {
    if (typeof window === 'undefined') return 'plan';
    const v = new URLSearchParams(window.location.search).get('view');
    return v === 'projects' ? 'projects' : 'plan';
  });
  function switchView(next: PortalView) {
    setView(next);
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (next === 'plan') url.searchParams.delete('view');
    else url.searchParams.set('view', next);
    window.history.replaceState({}, '', url.toString());
  }

  useEffect(() => {
    apiFetch<PortalCtx>(`${BASE_URL}/task-engine/portal/${token}`, { cache: 'no-store' })
      .then((data) => {
        setCtx(data);
        // Resolve opening state
        const now = Date.now();
        const callTime = data.portalCallTime ? new Date(data.portalCallTime).getTime() : null;
        const openTime = data.portalOpenTime ? new Date(data.portalOpenTime).getTime() : null;

        if (openTime !== null && now < openTime) {
          if (callTime !== null && now < callTime) {
            setPortalState('waiting_a');
          } else {
            setPortalState('waiting_b');
          }
        } else {
          setPortalState('open');
        }
      })
      .catch(() => setCtxErr('שגיאה בטעינת הנתונים'))
      .finally(() => setCtxLoading(false));
  }, [token]);

  // ─── Countdown + auto-advance ─────────────────────────────────────────────

  useEffect(() => {
    if (portalState !== 'waiting_a' && portalState !== 'waiting_b') return;
    if (!ctx) return;

    const callTime = ctx.portalCallTime ? new Date(ctx.portalCallTime).getTime() : null;
    const openTime = ctx.portalOpenTime ? new Date(ctx.portalOpenTime).getTime() : null;

    const tick = () => {
      const now = Date.now();

      if (openTime !== null && now >= openTime) {
        setPortalState('open');
        return;
      }

      if (portalState === 'waiting_a' && callTime !== null && now >= callTime) {
        setPortalState('waiting_b');
        return;
      }

      if (portalState === 'waiting_a' && callTime !== null) {
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

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [portalState, ctx]);

  // ─── Shared styles ────────────────────────────────────────────────────────

  const rootStyle: React.CSSProperties = {
    minHeight: '100vh',
    background: '#f9fafb',
    fontFamily: 'Arial, Helvetica, sans-serif',
    direction: 'rtl',
    position: 'relative',
    overflowX: 'hidden',
  };

  const waitingRoot: React.CSSProperties = {
    minHeight: '100vh',
    background: 'linear-gradient(160deg, #0f172a 0%, #1e3a5f 60%, #0f172a 100%)',
    fontFamily: 'Arial, Helvetica, sans-serif',
    direction: 'rtl',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '32px 24px',
  };

  // ─── Loading / error ──────────────────────────────────────────────────────

  if (ctxLoading) return (
    <div style={{ ...rootStyle, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>טוען...</div>
    </div>
  );
  if (ctxErr || !ctx) return (
    <div style={{ ...rootStyle, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', padding: 40, color: '#ef4444', fontSize: 14 }}>{ctxErr || 'שגיאה'}</div>
    </div>
  );
  if (!ctx.taskEngineEnabled) return (
    <div style={{ ...rootStyle, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', padding: 40 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
        <div style={{ fontSize: 16, fontWeight: 600, color: '#374151', marginBottom: 8 }}>תוכנית אישית</div>
        <div style={{ fontSize: 14, color: '#9ca3af' }}>התכונה הזו עדיין לא פעילה עבורך</div>
      </div>
    </div>
  );

  // ── State A: before the opening call ────────────────────────────────────
  if (portalState === 'waiting_a') {
    const firstName = ctx.participantFirstName;
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
      <div style={waitingRoot}>
        <style>{`@keyframes pulse-glow{0%,100%{opacity:.6;}50%{opacity:1;}} @keyframes spin{to{transform:rotate(360deg);}}`}</style>
        <div style={{ maxWidth: 400, width: '100%', textAlign: 'center' }}>
          <div style={{ fontSize: 52, marginBottom: 20, animation: 'pulse-glow 2.4s ease-in-out infinite' }}>⚡</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#f0f9ff', lineHeight: 1.45, margin: '0 0 28px' }}>
            כן {firstName}, כולנו כבר לא יכולות לחכות להתחיל — אבל זה קורה ממש עוד
          </h1>
          {/* RTL order: seconds far right → days far left */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 28 }}>
            {[
              { value: countdown.seconds, label: 'שניות' },
              { value: countdown.minutes, label: 'דקות'  },
              { value: countdown.hours,   label: 'שעות'  },
              { value: countdown.days,    label: 'ימים'  },
            ].map(({ value, label }) => (
              <div key={label} style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: '14px 8px' }}>
                <div style={{ fontSize: 32, fontWeight: 800, color: '#38bdf8', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                  {pad(value)}
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6, letterSpacing: '0.05em' }}>{label}</div>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 15, color: '#94a3b8', lineHeight: 1.65, margin: 0 }}>
            בינתיים נשאר רק לחכות בסבלנות,<br />אנחנו ממש מתחילות עוד רגע ✨
          </p>
        </div>
      </div>
    );
  }

  // ── State B: after call, before actual open ──────────────────────────────
  if (portalState === 'waiting_b') {
    return (
      <div style={waitingRoot}>
        <style>{`@keyframes sparkle-pulse{0%,100%{opacity:0.25;transform:scale(0.8) translateY(0);}50%{opacity:0.9;transform:scale(1.1) translateY(-5px);}}`}</style>
        <div style={{ maxWidth: 380, width: '100%', textAlign: 'center' }}>
          <div style={{ fontSize: 52, marginBottom: 20 }}>🎉</div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: '#f0f9ff', lineHeight: 1.55, margin: '0 0 32px' }}>
            אולי במקום להציץ תקשיבי לשיחה?<br />
            <span style={{ color: '#38bdf8' }}>סתםםםם</span>, הכל טוב 😉<br />
            תכף זה קורה!!
          </h1>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 20, fontSize: 24 }}>
            {[0, 0.7, 1.4].map((delay) => (
              <span key={delay} style={{ display: 'inline-block', animation: `sparkle-pulse 2.2s ease-in-out ${delay}s infinite` }}>✨</span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── State C: portal open ─────────────────────────────────────────────────
  // Inline tab strip switches between the weekly plan and Projects Tracking.
  // Mobile-first: full-width equal-column buttons; active tab gets a bottom
  // underline matching the admin tab style.
  const tabStripStyle: React.CSSProperties = {
    display: 'flex', gap: 0, background: '#ffffff',
    borderBottom: '1px solid #e2e8f0',
    position: 'sticky', top: 0, zIndex: 5,
  };
  const tabBtn = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: '14px 12px',
    border: 'none',
    borderBottom: active ? '2px solid #2563eb' : '2px solid transparent',
    background: 'transparent',
    color: active ? '#2563eb' : '#64748b',
    fontWeight: active ? 700 : 500,
    fontSize: 15, cursor: 'pointer',
    fontFamily: 'inherit',
  });

  return (
    <div style={{ ...rootStyle, paddingBottom: 32 }}>
      <div style={tabStripStyle} role="tablist">
        <button
          role="tab"
          aria-selected={view === 'plan'}
          style={tabBtn(view === 'plan')}
          onClick={() => switchView('plan')}
        >
          📅 התכנון שלי
        </button>
        <button
          role="tab"
          aria-selected={view === 'projects'}
          style={tabBtn(view === 'projects')}
          onClick={() => switchView('projects')}
        >
          🎯 המעקב שלי
        </button>
      </div>
      {view === 'plan' ? (
        <div style={{ padding: '16px 16px 0' }}>
          <TaskBoard
            participantId={ctx.participantId}
            participantName={ctx.participantName}
          />
        </div>
      ) : (
        <PortalProjectsBoard token={token} />
      )}
    </div>
  );
}
