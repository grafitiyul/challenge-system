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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 28 }}>
            {[
              { value: countdown.days,    label: 'ימים'  },
              { value: countdown.hours,   label: 'שעות'  },
              { value: countdown.minutes, label: 'דקות'  },
              { value: countdown.seconds, label: 'שניות' },
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
        <style>{`@keyframes bounce-soft{0%,100%{transform:translateY(0);}50%{transform:translateY(-6px);}} @keyframes spin{to{transform:rotate(360deg);}}`}</style>
        <div style={{ maxWidth: 380, width: '100%', textAlign: 'center' }}>
          <div style={{ fontSize: 52, marginBottom: 20, display: 'inline-block', animation: 'bounce-soft 1.8s ease-in-out infinite' }}>🎉</div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: '#f0f9ff', lineHeight: 1.55, margin: '0 0 24px' }}>
            אולי במקום להציץ תקשיבי לשיחה?<br />
            <span style={{ color: '#38bdf8' }}>סתםםםם</span>, הכל טוב 😉<br />
            תכף זה קורה!!
          </h1>
          <div style={{ width: 40, height: 40, border: '3px solid rgba(255,255,255,0.15)', borderTopColor: '#38bdf8', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto' }} />
        </div>
      </div>
    );
  }

  // ── State C: portal open ─────────────────────────────────────────────────
  return (
    <div style={{ ...rootStyle, paddingBottom: 32 }}>
      <div style={{ padding: '16px 16px 0' }}>
        <TaskBoard
          participantId={ctx.participantId}
          participantName={ctx.participantName}
        />
      </div>
    </div>
  );
}
