'use client';

// Admin status + pairing screen for the WhatsApp Bridge (Baileys).
//
// Polls /api/admin/whatsapp/status:
//   - every 2 s while the bridge is disconnected / pairing (so a fresh
//     QR appears within a tick of being emitted),
//   - every 15 s while connected (heartbeat only — no admin is watching
//     a connected screen for changes).
//
// QR pairing: the API returns both the raw qr string and a pre-rendered
// data URL. We render the data URL as <img> so no QR library is loaded
// in the browser. The QR rotates every ~20 s on the bridge side; our
// 2 s poll catches the new one within one cycle.
//
// Sign-out: locked confirm modal. After confirming, the bridge wipes
// credentials and re-starts; the page returns to qr_required state on
// the next poll.

import { useCallback, useEffect, useRef, useState } from 'react';
import { BASE_URL, apiFetch } from '@lib/api';

type ConnStatus = 'disconnected' | 'qr_required' | 'pairing' | 'connecting' | 'connected';

// Live readiness snapshot from the bridge — same shape that /send uses
// to decide whether to even hand off to socket.sendMessage. Used here
// to drive the admin "connected" pill so the UI never claims "מחובר"
// while sends would actually fail.
interface Readiness {
  ok: boolean;
  reason: string | null;
  hasSocket: boolean;
  connected: boolean;
  hasUser: boolean;
  wsState: 'CONNECTING' | 'OPEN' | 'CLOSING' | 'CLOSED' | 'unknown';
  ageMs: number | null;
  lastUpdate: 'open' | 'close' | 'connecting' | null;
  lastDisconnectReason: string | null;
  staleReason: string | null;
  reconnecting: boolean;
}

interface BridgeStatus {
  status: ConnStatus;
  qr: string | null;
  qrDataUrl: string | null;
  phoneJid: string | null;
  deviceName: string | null;
  lastQrAt: string | null;
  lastConnectedAt: string | null;
  lastDisconnectAt: string | null;
  lastDisconnectReason: string | null;
  lastMessageAt: string | null;
  reconnectAttempts: number;
  // Phase 2 — present when the API was redeployed with the matching
  // bridge build. Pre-Phase-2 deployments leave these undefined so we
  // optional-chain everywhere they're consumed.
  lastMediaError?: string | null;
  lastMediaErrorAt?: string | null;
  messagesToday?: number;
  mediaToday?: number;
  // Optional only for backward compat with a stale bridge build that
  // hasn't been redeployed yet. New code paths read it.
  readiness?: Readiness;
}

interface BridgeUnavailable {
  bridgeUnavailable: true;
  reason: string;
}

type StatusResponse = BridgeStatus | BridgeUnavailable;

function isUnavailable(r: StatusResponse): r is BridgeUnavailable {
  return (r as BridgeUnavailable).bridgeUnavailable === true;
}

// Pure status pill — used as a fallback only when the bridge response
// has no `readiness` field (older bridge build). Once readiness is
// available, derivePill() below is the single source of truth.
const STATUS_LABEL: Record<ConnStatus, { text: string; bg: string; fg: string }> = {
  disconnected: { text: 'מנותק',     bg: '#fee2e2', fg: '#b91c1c' },
  qr_required:  { text: 'ממתין לסריקה', bg: '#fef3c7', fg: '#92400e' },
  pairing:      { text: 'מתחבר',     bg: '#fef3c7', fg: '#92400e' },
  connecting:   { text: 'מתחבר',     bg: '#dbeafe', fg: '#1d4ed8' },
  connected:    { text: 'מחובר',     bg: '#dcfce7', fg: '#15803d' },
};

const PILL_GREEN  = { bg: '#dcfce7', fg: '#15803d' };
const PILL_YELLOW = { bg: '#fef3c7', fg: '#92400e' };
const PILL_BLUE   = { bg: '#dbeafe', fg: '#1d4ed8' };
const PILL_RED    = { bg: '#fee2e2', fg: '#b91c1c' };

interface Pill { text: string; bg: string; fg: string; ok: boolean }

/**
 * Map (readiness, persisted status) → the pill the admin sees and a
 * boolean `ok` callers use to gate "is the bridge actually usable for
 * sending right now?".
 *
 * Single source of truth: `ok` is `readiness.ok` when readiness is
 * present; otherwise we fall back to the persisted status meaning
 * "best we know" (older bridge build).
 *
 * Hebrew reason mapping is exhaustive across the reasons the bridge
 * helper can emit (see ReadinessSnapshot in
 * apps/whatsapp-bridge/src/baileys/client.ts):
 *   reconnecting       → "מתחבר מחדש"
 *   stale:<reason>     → "החיבור תקוע" + sub-reason
 *   no_socket          → "אין סוקט פעיל" (or "ממתין לסריקה" when QR pending)
 *   not_connected_flag → "לא מחובר ל-WhatsApp"
 *   no_user            → "הסוקט עוד לא הסתנכרן"
 *   ws_CONNECTING      → "הסוקט עדיין מתחבר"
 *   ws_CLOSING         → "הסוקט בסגירה"
 *   ws_CLOSED          → "הסוקט סגור"
 */
function derivePill(data: BridgeStatus): Pill {
  const r = data.readiness;
  if (r?.ok) return { text: 'מחובר ומוכן לשליחה', ...PILL_GREEN, ok: true };

  if (r) {
    const reason = r.reason ?? '';
    if (reason === 'reconnecting') {
      return { text: 'מתחבר מחדש...', ...PILL_BLUE, ok: false };
    }
    if (reason.startsWith('stale:')) {
      const sub = reason.slice('stale:'.length);
      return { text: `החיבור תקוע (${sub}) — נדרש איפוס`, ...PILL_RED, ok: false };
    }
    if (reason === 'no_socket') {
      if (data.status === 'qr_required') return { text: 'ממתין לסריקת QR', ...PILL_YELLOW, ok: false };
      if (data.status === 'connecting' || data.status === 'pairing') {
        return { text: 'מתחבר...', ...PILL_BLUE, ok: false };
      }
      return { text: 'אין סוקט פעיל', ...PILL_RED, ok: false };
    }
    if (reason === 'not_connected_flag') {
      if (data.status === 'qr_required') return { text: 'ממתין לסריקת QR', ...PILL_YELLOW, ok: false };
      if (data.status === 'connecting' || data.status === 'pairing') {
        return { text: 'מתחבר...', ...PILL_BLUE, ok: false };
      }
      return { text: 'לא מחובר ל-WhatsApp', ...PILL_RED, ok: false };
    }
    if (reason === 'no_user') {
      return { text: 'הסוקט עוד לא הסתנכרן עם המשתמש', ...PILL_YELLOW, ok: false };
    }
    if (reason === 'ws_CONNECTING') {
      return { text: 'הסוקט עדיין מתחבר', ...PILL_BLUE, ok: false };
    }
    if (reason === 'ws_CLOSING') {
      return { text: 'הסוקט נסגר — נדרש איפוס', ...PILL_RED, ok: false };
    }
    if (reason === 'ws_CLOSED') {
      return { text: 'הסוקט סגור — נדרש איפוס', ...PILL_RED, ok: false };
    }
    return { text: `לא מוכן (${reason || 'לא ידוע'})`, ...PILL_RED, ok: false };
  }

  // No readiness in payload → old bridge build. Fall back to persisted status.
  const fallback = STATUS_LABEL[data.status];
  return { ...fallback, ok: data.status === 'connected' };
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('he-IL', {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function WhatsAppBridgePage() {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [hardResetOpen, setHardResetOpen] = useState(false);
  const [hardResetting, setHardResetting] = useState(false);
  // Latched message from the last restart/hard-reset attempt — shown
  // next to the pill until the next status response either confirms
  // recovery (readiness.ok=true) or surfaces a fresh failure reason.
  const [restartHint, setRestartHint] = useState<string | null>(null);
  // Diagnostic send state — separate input + output so it doesn't
  // interfere with the existing status / restart / hard-reset flows.
  const [debugPhone, setDebugPhone] = useState('');
  const [debugRunning, setDebugRunning] = useState(false);
  const [debugResult, setDebugResult] = useState<unknown>(null);
  const [debugError, setDebugError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<StatusResponse>(`${BASE_URL}/admin/whatsapp/status`, { cache: 'no-store' });
      setData(res);
      setErr('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'טעינה נכשלה');
    } finally {
      setLoading(false);
    }
  }, []);

  // Adaptive polling: faster while disconnected/pairing so a fresh QR
  // appears within ~2 s, slower while connected (heartbeat only).
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    if (!data) return;
    // Poll cadence is driven by readiness.ok (the same flag /send keys
    // off). When NOT ready we poll every 2 s so a restart's recovery —
    // and any new QR — surfaces immediately. When ready we drop to a
    // 15 s heartbeat. Falls back to the persisted status only when the
    // bridge response has no readiness field (older bridge build).
    const ready = !isUnavailable(data)
      && (data.readiness ? data.readiness.ok : data.status === 'connected');
    const intervalMs = ready ? 15_000 : 2_000;
    pollTimer.current = setTimeout(() => void load(), intervalMs);
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [data, load]);

  async function confirmSignOut() {
    setSigningOut(true);
    try {
      await apiFetch(`${BASE_URL}/admin/whatsapp/sign-out`, { method: 'POST' });
      setSignOutOpen(false);
      // Force-refresh; the bridge needs a beat to flip status, so we
      // schedule a second refresh shortly after for snappier feedback.
      setTimeout(() => void load(), 500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'התנתקות נכשלה');
    } finally {
      setSigningOut(false);
    }
  }

  // POST /api/admin/whatsapp/debug-send — diagnostic-only outbound.
  // Bypasses the regular send path's send-chain lock and reconnect
  // side-effects; the response is a per-step JSON shape that
  // pinpoints exactly which stage (normalize / readiness /
  // onWhatsApp / sendMessage) is the source of the timeout. Pure
  // observation — never persists an outbound row.
  async function runDebugSend() {
    if (!debugPhone.trim()) {
      setDebugError('יש להזין מספר טלפון');
      return;
    }
    setDebugRunning(true);
    setDebugError(null);
    setDebugResult(null);
    try {
      const json = await apiFetch<unknown>(`${BASE_URL}/admin/whatsapp/debug-send`, {
        method: 'POST',
        body: JSON.stringify({ phone: debugPhone.trim(), message: 'בדיקת גשר' }),
      });
      setDebugResult(json);
    } catch (e) {
      setDebugError(e instanceof Error ? e.message : 'בדיקה נכשלה');
    } finally {
      setDebugRunning(false);
    }
  }

  // POST /api/admin/whatsapp/hard-reset-session — nuke + repair.
  // Deletes the persisted Baileys auth (creds + every signal key),
  // resets the WhatsAppConnection singleton, and spawns a fresh
  // socket so a new QR appears. Use when restart-socket hasn't
  // recovered the bridge from repeated send_timeout / decrypt
  // failures — strong signal that the persisted session is corrupt.
  async function confirmHardReset() {
    setHardResetting(true);
    setRestartHint('שולח בקשת איפוס מלא...');
    try {
      await apiFetch(`${BASE_URL}/admin/whatsapp/hard-reset-session`, { method: 'POST' });
      setHardResetOpen(false);
      setRestartHint('הסשן אופס — ממתין שיופיע קוד QR חדש לסריקה...');
      // Bridge takes ~1–2s to wipe + open the fresh socket. Two
      // staggered refreshes catch the QR within one poll cycle.
      setTimeout(() => void load(), 600);
      setTimeout(() => void load(), 2000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'איפוס מלא נכשל';
      setRestartHint(`איפוס מלא נכשל: ${msg}`);
    } finally {
      setHardResetting(false);
    }
  }

  // POST /api/admin/whatsapp/restart-socket — tear down the current
  // Baileys socket and rebuild it WITHOUT wiping creds. Recovery path
  // for the zombie-socket case (bridge thinks it's connected, /send
  // hangs). Bridge replies 202 immediately; the actual reopen happens
  // async, so we lean on the existing 2 s poll loop to redraw the pill
  // as readiness flips back to ok.
  async function restartConnection() {
    setRestarting(true);
    setRestartHint('שולח בקשת איפוס...');
    try {
      await apiFetch(`${BASE_URL}/admin/whatsapp/restart-socket`, { method: 'POST' });
      setRestartHint('בקשת איפוס נשלחה — ממתין שיחזור החיבור...');
      // First refresh quickly to catch the "reconnecting" transient,
      // then let the polling loop drive subsequent updates. Two
      // staggered refreshes hide the brief gap between "connect()
      // returned" and "connection.update('open')" without being chatty.
      setTimeout(() => void load(), 400);
      setTimeout(() => void load(), 1500);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'איפוס נכשל';
      setRestartHint(`איפוס נכשל: ${msg}`);
    } finally {
      setRestarting(false);
    }
  }

  const status = data && !isUnavailable(data) ? data.status : null;
  const liveStatus = data && !isUnavailable(data) ? data : null;
  const pill: Pill | null = liveStatus ? derivePill(liveStatus) : null;
  // Clear the post-restart hint once the live readiness flips ok again,
  // so the operator sees the green pill standalone.
  if (pill?.ok && restartHint) {
    setTimeout(() => setRestartHint(null), 0);
  }

  return (
    <div className="page-wrapper" style={{ maxWidth: 720, margin: '0 auto' }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>WhatsApp — חיבור</h1>
        <p style={{ color: '#64748b', fontSize: 14, margin: '4px 0 0', lineHeight: 1.55 }}>
          ניהול חיבור הגשר של WhatsApp. בעת ניתוק יש לסרוק קוד QR עם המכשיר בו פועל הוואטסאפ.
        </p>
      </div>

      {err && !data && (
        <div style={{ background: '#fee2e2', color: '#b91c1c', padding: 12, borderRadius: 8, fontSize: 13, marginBottom: 12 }}>
          {err}
        </div>
      )}

      {data && isUnavailable(data) && (
        <div
          style={{
            background: '#fef9c3', color: '#854d0e',
            padding: 14, borderRadius: 10, fontSize: 13, lineHeight: 1.55,
            border: '1px solid #fde68a', marginBottom: 16,
          }}
        >
          <strong>שירות הגשר אינו זמין.</strong>
          <div style={{ marginTop: 4, fontFamily: 'monospace', fontSize: 12 }}>{data.reason}</div>
          <div style={{ marginTop: 8 }}>
            ודאי שהשירות whatsapp-bridge פועל ב-Railway, ושמשתני הסביבה
            <code style={{ margin: '0 4px' }}>WHATSAPP_BRIDGE_URL</code>
            ו-
            <code style={{ margin: '0 4px' }}>INTERNAL_API_SECRET</code>
            מוגדרים בשני השירותים.
          </div>
        </div>
      )}

      {data && !isUnavailable(data) && (
        <>
          {/* Status card */}
          <div
            style={{
              background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12,
              padding: 18, marginBottom: 16,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 13, color: '#64748b' }}>סטטוס</div>
                {pill && (
                  <span
                    style={{
                      display: 'inline-block', marginTop: 4,
                      background: pill.bg, color: pill.fg,
                      padding: '4px 12px', borderRadius: 999,
                      fontSize: 13, fontWeight: 700,
                    }}
                  >
                    {pill.text}
                  </span>
                )}
                {/* Post-restart latched message — replaced as soon as
                    the next /status response confirms recovery
                    (pill.ok=true clears it via the effect above). */}
                {restartHint && (
                  <div style={{ marginTop: 6, fontSize: 12, color: '#1d4ed8' }}>
                    {restartHint}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {/* Restart connection — admin recovery path for the
                    zombie-socket case. Visible whenever the bridge is
                    NOT in a clean ready state, regardless of which
                    sub-reason fired (stale, ws_CLOSED, reconnecting, …).
                    Hidden once readiness.ok=true to avoid tempting an
                    operator to "fix" an already-healthy bridge. */}
                {pill && !pill.ok && (
                  <button
                    onClick={() => { void restartConnection(); }}
                    disabled={restarting}
                    style={{
                      padding: '7px 14px', fontSize: 13, fontWeight: 600,
                      background: restarting ? '#bfdbfe' : '#2563eb',
                      color: '#fff', border: 'none', borderRadius: 8,
                      cursor: restarting ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {restarting ? 'מאתחל...' : 'איפוס חיבור'}
                  </button>
                )}
                {(data.status === 'connected' || data.lastDisconnectReason === 'loggedOut') && (
                  <button
                    onClick={() => setSignOutOpen(true)}
                    style={{
                      padding: '7px 14px', fontSize: 13, fontWeight: 600,
                      background: data.lastDisconnectReason === 'loggedOut' ? '#dc2626' : '#fff',
                      color: data.lastDisconnectReason === 'loggedOut' ? '#fff' : '#b91c1c',
                      border: data.lastDisconnectReason === 'loggedOut' ? '1px solid #dc2626' : '1px solid #fecaca',
                      borderRadius: 8,
                      cursor: 'pointer',
                    }}
                  >
                    {data.lastDisconnectReason === 'loggedOut'
                      ? 'התנתקי וחברי מחדש'
                      : 'התנתקי / שכחי מכשיר'}
                  </button>
                )}
                {/* Hard reset — always available. Different from the
                    restart button (which keeps the auth) and the
                    sign-out button (which calls socket.logout and can
                    hang on a corrupt session). Use when restart-socket
                    has failed to recover from repeated send_timeout. */}
                <button
                  onClick={() => setHardResetOpen(true)}
                  style={{
                    padding: '7px 14px', fontSize: 13, fontWeight: 600,
                    background: '#fff', color: '#7c2d12',
                    border: '1px dashed #c2410c', borderRadius: 8,
                    cursor: 'pointer',
                  }}
                >
                  איפוס מלא וחיבור מחדש
                </button>
              </div>
            </div>
            {/* Readiness diagnostic strip — shown only when not ready,
                so a healthy connection stays visually clean. Surfaces
                the four most-actionable bits from the live snapshot:
                wsState, lastUpdate, lastDisconnectReason, staleReason.
                These match exactly what /send sees, so the admin can
                correlate "WhatsApp page says X" with "send returns Y". */}
            {data.readiness && !data.readiness.ok && (
              <div
                style={{
                  marginBottom: 12, padding: '10px 12px',
                  background: '#fff7ed', border: '1px solid #fed7aa',
                  borderRadius: 8, fontSize: 12, lineHeight: 1.6, color: '#7c2d12',
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 4 }}>פרטי מצב הסוקט</div>
                <div style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  reason={data.readiness.reason ?? '—'} ·
                  ws={data.readiness.wsState} ·
                  lastUpdate={data.readiness.lastUpdate ?? '—'} ·
                  lastDisconnect={data.readiness.lastDisconnectReason ?? '—'} ·
                  stale={data.readiness.staleReason ?? '—'} ·
                  reconnecting={String(data.readiness.reconnecting)}
                </div>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 13 }}>
              <Field label="מכשיר" value={data.deviceName || '—'} />
              <Field label="JID" value={data.phoneJid || '—'} mono />
              <Field label="התחברות אחרונה" value={formatTime(data.lastConnectedAt)} />
              <Field label="הודעה אחרונה" value={formatTime(data.lastMessageAt)} />
              <Field label="ניתוק אחרון" value={formatTime(data.lastDisconnectAt)} />
              <Field label="סיבת ניתוק" value={data.lastDisconnectReason || '—'} mono />
              {data.reconnectAttempts > 0 && (
                <Field label="נסיונות חיבור" value={String(data.reconnectAttempts)} />
              )}
            </div>
          </div>

          {/* ── Phase 2 — message + media metrics ──
              Only renders when the API + bridge are on Phase 2 builds
              (the new fields are present). Pre-Phase-2 status payloads
              omit them and the block is hidden. */}
          {(data.messagesToday !== undefined || data.mediaToday !== undefined || data.lastMediaError) && (
            <div
              style={{
                background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12,
                padding: 18, marginBottom: 16,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', marginBottom: 10 }}>
                פעילות היום
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 13 }}>
                <Field label="הודעות היום" value={String(data.messagesToday ?? 0)} />
                <Field label="מדיה היום" value={String(data.mediaToday ?? 0)} />
              </div>
              {data.lastMediaError && (
                <div
                  style={{
                    marginTop: 12, padding: '8px 10px',
                    background: '#fef2f2', color: '#991b1b',
                    border: '1px solid #fecaca', borderRadius: 8,
                    fontSize: 12, lineHeight: 1.5,
                  }}
                >
                  <div style={{ fontWeight: 600 }}>שגיאת מדיה אחרונה</div>
                  <div style={{ fontFamily: 'monospace', marginTop: 2, wordBreak: 'break-all' }}>
                    {data.lastMediaError}
                  </div>
                  {data.lastMediaErrorAt && (
                    <div style={{ marginTop: 2, color: '#7f1d1d' }}>{formatTime(data.lastMediaErrorAt)}</div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* QR pairing pane — only when needed */}
          {data.status === 'qr_required' && data.qrDataUrl && (
            <div
              style={{
                background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12,
                padding: 22, textAlign: 'center', marginBottom: 16,
              }}
            >
              <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>
                סרקי את הקוד מהטלפון
              </div>
              <p style={{ color: '#64748b', fontSize: 13, margin: '4px 0 16px', lineHeight: 1.55 }}>
                בטלפון: WhatsApp ← הגדרות ← מכשירים מקושרים ← קישור מכשיר.
                הקוד מתעדכן אוטומטית כל ~20 שניות; אם פג תוקפו, חכי שיוחלף.
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={data.qrDataUrl}
                alt="QR pairing code"
                style={{
                  width: 320, height: 320, maxWidth: '100%',
                  borderRadius: 8, background: '#fff',
                }}
              />
              {data.lastQrAt && (
                <div style={{ marginTop: 8, fontSize: 11, color: '#94a3b8' }}>
                  קוד שהונפק ב-{formatTime(data.lastQrAt)}
                </div>
              )}
            </div>
          )}

          {/* Connecting / disconnected hint */}
          {data.status === 'connecting' && (
            <div style={{ background: '#dbeafe', color: '#1d4ed8', padding: 12, borderRadius: 8, fontSize: 13, marginBottom: 16 }}>
              מתחבר ל-WhatsApp...
            </div>
          )}
          {data.status === 'disconnected' && data.lastDisconnectReason === 'loggedOut' && (
            <div
              style={{
                background: '#fef2f2', color: '#991b1b', padding: 14,
                borderRadius: 10, fontSize: 13, marginBottom: 16, lineHeight: 1.6,
                border: '1px solid #fecaca',
              }}
            >
              <strong>WhatsApp ניתק את הגשר וצריך לחבר מחדש.</strong>
              <div style={{ marginTop: 4 }}>
                ההרשאה לקישור הוסרה (ייתכן שהמכשיר נמחק מ"מכשירים מקושרים" בטלפון, או
                שהיה התנגשות סשן). לחצי <strong>"התנתקי וחברי מחדש"</strong> למעלה כדי
                לנקות את האימות הישן ולסרוק קוד QR חדש.
              </div>
            </div>
          )}
          {data.status === 'disconnected' && data.lastDisconnectReason !== 'loggedOut' && (
            <div style={{ background: '#fef3c7', color: '#92400e', padding: 12, borderRadius: 8, fontSize: 13, marginBottom: 16, lineHeight: 1.55 }}>
              הגשר מנותק. הוא ינסה להתחבר אוטומטית.
              {data.reconnectAttempts > 0 && ` (ניסיון ${data.reconnectAttempts})`}
            </div>
          )}

          {/* ── Temporary diagnostic ────────────────────────────────────
              Fires POST /api/admin/whatsapp/debug-send. Renders the
              full server response so failedAt + reason + per-step
              timings are visible without opening a Railway shell.
              Bypasses the regular send path's lock + reconnect
              side-effects, so running it is safe even when the
              regular send is timing out. */}
          <div
            style={{
              background: '#fff', border: '1px dashed #c2410c', borderRadius: 12,
              padding: 18, marginBottom: 16,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: '#7c2d12', marginBottom: 4 }}>
              בדיקת שליחה אבחונית
            </div>
            <div style={{ fontSize: 12, color: '#7c2d12', lineHeight: 1.5, marginBottom: 10 }}>
              שולחת הודעת &ldquo;בדיקת גשר&rdquo; דרך הצינור האבחוני בלבד (לא נשמר log,
              לא מפעיל reconnect). מציגה לאיזה שלב מגיע הביצוע — normalize / readiness /
              onWhatsApp / sendMessage — וכמה זמן לקח.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
              <input
                dir="ltr"
                inputMode="tel"
                placeholder="לדוגמה: 972504020000"
                value={debugPhone}
                onChange={(e) => setDebugPhone(e.target.value)}
                disabled={debugRunning}
                style={{
                  flex: '1 1 220px', minWidth: 0,
                  padding: '8px 10px', fontSize: 13,
                  border: '1px solid #cbd5e1', borderRadius: 8,
                  fontFamily: 'monospace',
                }}
              />
              <button
                onClick={() => { void runDebugSend(); }}
                disabled={debugRunning || !debugPhone.trim()}
                style={{
                  padding: '8px 14px', fontSize: 13, fontWeight: 600,
                  background: debugRunning ? '#fdba74' : '#c2410c',
                  color: '#fff', border: 'none', borderRadius: 8,
                  cursor: (debugRunning || !debugPhone.trim()) ? 'not-allowed' : 'pointer',
                  opacity: (debugRunning || !debugPhone.trim()) ? 0.7 : 1,
                }}
              >
                {debugRunning ? 'רץ...' : 'הרץ בדיקה'}
              </button>
            </div>

            {debugError && (
              <div style={{ background: '#fee2e2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: 8, padding: 10, fontSize: 12, marginBottom: 10 }}>
                {debugError}
              </div>
            )}

            {debugResult !== null && (
              <DebugResult result={debugResult} />
            )}
          </div>
        </>
      )}

      {loading && !data && (
        <div style={{ textAlign: 'center', color: '#94a3b8', padding: 40, fontSize: 14 }}>טוען...</div>
      )}

      {/* Hard-reset confirm modal */}
      {hardResetOpen && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1100, padding: 16,
          }}
          role="dialog"
          aria-modal="true"
        >
          <div style={{ background: '#fff', borderRadius: 12, padding: 22, width: '100%', maxWidth: 460 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: '#0f172a' }}>
                לבצע איפוס מלא של חיבור ה-WhatsApp?
              </h3>
              <button
                type="button"
                onClick={() => setHardResetOpen(false)}
                disabled={hardResetting}
                aria-label="סגור"
                style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 22, cursor: hardResetting ? 'not-allowed' : 'pointer', lineHeight: 1 }}
              >×</button>
            </div>
            <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.6, margin: '0 0 8px' }}>
              זה ימחק את חיבור ה-WhatsApp השמור וידרוש סריקת QR מחדש.
            </p>
            <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.6, margin: '0 0 14px' }}>
              להבדיל מ-&ldquo;איפוס חיבור&rdquo; — שמשאיר את החיבור השמור — האיפוס המלא מוחק את כל המידע שנשמר ב-Postgres
              (creds + signal keys), מאפס את שורת מצב החיבור, ומפעיל סוקט חדש שיציג קוד QR חדש לסריקה.
              נדרש כשהסשן השמור פגום וההודעות לא נשלחות גם אחרי איפוס חיבור רגיל.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setHardResetOpen(false)}
                disabled={hardResetting}
                style={{
                  padding: '8px 16px', fontSize: 13, fontWeight: 600,
                  background: '#f1f5f9', color: '#374151',
                  border: '1px solid #e2e8f0', borderRadius: 8,
                  cursor: hardResetting ? 'not-allowed' : 'pointer',
                }}
              >
                ביטול
              </button>
              <button
                onClick={() => { void confirmHardReset(); }}
                disabled={hardResetting}
                style={{
                  padding: '8px 16px', fontSize: 13, fontWeight: 700,
                  background: hardResetting ? '#fdba74' : '#c2410c',
                  color: '#fff', border: 'none', borderRadius: 8,
                  cursor: hardResetting ? 'not-allowed' : 'pointer',
                }}
              >
                {hardResetting ? 'מאפס...' : 'כן, אפס מלא'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sign-out confirm modal */}
      {signOutOpen && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1100, padding: 16,
          }}
          role="dialog"
          aria-modal="true"
        >
          <div style={{ background: '#fff', borderRadius: 12, padding: 22, width: '100%', maxWidth: 420 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: '#0f172a' }}>
                להתנתק מ-WhatsApp?
              </h3>
              <button
                type="button"
                onClick={() => setSignOutOpen(false)}
                disabled={signingOut}
                aria-label="סגור"
                style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 22, cursor: signingOut ? 'not-allowed' : 'pointer', lineHeight: 1 }}
              >×</button>
            </div>
            <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.6, margin: '0 0 14px' }}>
              ההתנתקות מוחקת את הזיהוי של הגשר. כדי לחבר מחדש יהיה צורך לסרוק קוד QR נוסף.
              הודעות שכבר נקלטו לא ימחקו.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setSignOutOpen(false)}
                disabled={signingOut}
                style={{
                  padding: '8px 16px', fontSize: 13, fontWeight: 600,
                  background: '#f1f5f9', color: '#374151',
                  border: '1px solid #e2e8f0', borderRadius: 8,
                  cursor: signingOut ? 'not-allowed' : 'pointer',
                }}
              >
                ביטול
              </button>
              <button
                onClick={() => { void confirmSignOut(); }}
                disabled={signingOut}
                style={{
                  padding: '8px 16px', fontSize: 13, fontWeight: 700,
                  background: signingOut ? '#fca5a5' : '#dc2626',
                  color: '#fff', border: 'none', borderRadius: 8,
                  cursor: signingOut ? 'not-allowed' : 'pointer',
                }}
              >
                {signingOut ? 'מתנתק...' : 'כן, התנתק'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Renders the response of /admin/whatsapp/debug-send. Shows the
// headline (ok / failedAt / reason) prominently, a per-step grid in
// the middle, and the full raw JSON underneath for copy/paste into
// triage notes. Defensive: any unexpected shape (e.g. bridge
// returned bridgeUnavailable) still renders as the JSON dump so the
// admin always sees the truth.
function DebugResult({ result }: { result: unknown }) {
  const r = (result ?? {}) as {
    ok?: boolean;
    failedAt?: string | null;
    reason?: string;
    totalMs?: number;
    steps?: Array<{
      name: string;
      ok: boolean;
      ms: number;
      [key: string]: unknown;
    }>;
    bridgeUnavailable?: boolean;
  };
  const headlineBg = r.ok ? '#dcfce7' : '#fee2e2';
  const headlineFg = r.ok ? '#15803d' : '#991b1b';
  const headlineText = r.ok
    ? `הצלחה — נשלח ב-${r.totalMs ?? '?'}ms`
    : r.bridgeUnavailable
    ? `הגשר לא זמין: ${(r as { reason?: string }).reason ?? 'לא ידוע'}`
    : `נכשל בשלב ${r.failedAt ?? 'לא ידוע'}${r.reason ? ` — ${r.reason}` : ''}`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div
        style={{
          background: headlineBg, color: headlineFg,
          padding: '8px 12px', borderRadius: 8,
          fontSize: 13, fontWeight: 700,
        }}
      >
        {headlineText}
      </div>

      {Array.isArray(r.steps) && r.steps.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {r.steps.map((s, i) => {
            const sFg = s.ok ? '#15803d' : '#b91c1c';
            // Strip the keys that are already shown in the header row
            // so the details object isn't redundant. Keys not in the
            // strip set are dumped JSON-style for triage.
            const SKIP = new Set(['name', 'ok', 'ms']);
            const extras: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(s)) {
              if (!SKIP.has(k)) extras[k] = v;
            }
            return (
              <div
                key={i}
                style={{
                  background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8,
                  padding: '8px 10px', fontSize: 12,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, color: sFg, fontFamily: 'monospace' }}>
                    {s.ok ? '✓' : '✗'} {s.name}
                  </span>
                  <span style={{ color: '#64748b', fontFamily: 'monospace', fontSize: 11 }}>{s.ms}ms</span>
                </div>
                {Object.keys(extras).length > 0 && (
                  <pre
                    dir="ltr"
                    style={{
                      margin: 0, fontSize: 11, lineHeight: 1.5,
                      whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                      color: '#334155', fontFamily: 'monospace',
                    }}
                  >
                    {JSON.stringify(extras, null, 2)}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      )}

      <details>
        <summary style={{ cursor: 'pointer', fontSize: 11, color: '#64748b' }}>
          תשובה גולמית (JSON)
        </summary>
        <pre
          dir="ltr"
          style={{
            margin: '8px 0 0', padding: 10, background: '#0f172a', color: '#e2e8f0',
            borderRadius: 8, fontSize: 11, lineHeight: 1.55,
            whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            fontFamily: 'monospace', maxHeight: 320, overflowY: 'auto',
          }}
        >
          {JSON.stringify(result, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>{label}</div>
      <div
        style={{
          fontSize: 13, color: '#0f172a',
          fontFamily: mono ? 'monospace' : 'inherit',
          wordBreak: 'break-all',
        }}
      >
        {value}
      </div>
    </div>
  );
}
