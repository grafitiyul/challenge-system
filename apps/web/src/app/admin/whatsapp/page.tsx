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
}

interface BridgeUnavailable {
  bridgeUnavailable: true;
  reason: string;
}

type StatusResponse = BridgeStatus | BridgeUnavailable;

function isUnavailable(r: StatusResponse): r is BridgeUnavailable {
  return (r as BridgeUnavailable).bridgeUnavailable === true;
}

const STATUS_LABEL: Record<ConnStatus, { text: string; bg: string; fg: string }> = {
  disconnected: { text: 'מנותק',     bg: '#fee2e2', fg: '#b91c1c' },
  qr_required:  { text: 'ממתין לסריקה', bg: '#fef3c7', fg: '#92400e' },
  pairing:      { text: 'מתחבר',     bg: '#fef3c7', fg: '#92400e' },
  connecting:   { text: 'מתחבר',     bg: '#dbeafe', fg: '#1d4ed8' },
  connected:    { text: 'מחובר',     bg: '#dcfce7', fg: '#15803d' },
};

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
    const isConnected = !isUnavailable(data) && data.status === 'connected';
    const intervalMs = isConnected ? 15_000 : 2_000;
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

  const status = data && !isUnavailable(data) ? data.status : null;
  const pill = status ? STATUS_LABEL[status] : null;

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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
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
              </div>
              {data.status === 'connected' && (
                <button
                  onClick={() => setSignOutOpen(true)}
                  style={{
                    padding: '7px 14px', fontSize: 13, fontWeight: 600,
                    background: '#fff', color: '#b91c1c',
                    border: '1px solid #fecaca', borderRadius: 8,
                    cursor: 'pointer',
                  }}
                >
                  התנתקי / שכחי מכשיר
                </button>
              )}
            </div>

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
          {data.status === 'disconnected' && (
            <div style={{ background: '#fef3c7', color: '#92400e', padding: 12, borderRadius: 8, fontSize: 13, marginBottom: 16, lineHeight: 1.55 }}>
              הגשר מנותק. הוא ינסה להתחבר אוטומטית.
              {data.reconnectAttempts > 0 && ` (ניסיון ${data.reconnectAttempts})`}
            </div>
          )}
        </>
      )}

      {loading && !data && (
        <div style={{ textAlign: 'center', color: '#94a3b8', padding: 40, fontSize: 14 }}>טוען...</div>
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
