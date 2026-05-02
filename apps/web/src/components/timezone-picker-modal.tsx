'use client';

// TimezonePickerModal — admin-side picker for a participant's IANA
// timezone. Locked StrongModal:
//   - search filter against Intl.supportedValuesOf('timeZone')
//   - "מיקומים נפוצים" preset list at the top for one-tap selection
//   - live "הזמן אצלך כעת" preview using the picked tz so admin
//     verifies before saving
//   - clear note that changing tz applies to FUTURE logs only —
//     historical buckets are frozen by UserActionLog.timezoneSnapshot
//
// Used by the admin participant profile. The participant portal
// reuses this surface when self-edit is rolled out (out of scope).

import { useEffect, useMemo, useState } from 'react';
import { StrongModal } from './strong-modal';

const COMMON_PRESETS: Array<{ tz: string; label: string }> = [
  { tz: 'Asia/Jerusalem',     label: 'ישראל (Asia/Jerusalem)' },
  { tz: 'Europe/London',      label: 'לונדון (Europe/London)' },
  { tz: 'Europe/Paris',       label: 'פריז (Europe/Paris)' },
  { tz: 'America/New_York',   label: 'ניו יורק (America/New_York)' },
  { tz: 'America/Los_Angeles',label: 'לוס אנג׳לס (America/Los_Angeles)' },
  { tz: 'Australia/Sydney',   label: 'סידני (Australia/Sydney)' },
];

function listAllTimezones(): string[] {
  const fn = (Intl as unknown as {
    supportedValuesOf?: (key: 'timeZone') => string[];
  }).supportedValuesOf;
  if (typeof fn === 'function') {
    try { return fn('timeZone'); } catch { /* fall through */ }
  }
  return [];
}

function formatNowIn(tz: string): string {
  try {
    return new Intl.DateTimeFormat('he-IL', {
      timeZone: tz,
      hour: '2-digit', minute: '2-digit',
      day: '2-digit', month: '2-digit',
    }).format(new Date());
  } catch {
    return '—';
  }
}

export function TimezonePickerModal(props: {
  currentTimezone: string;
  onClose: () => void;
  onSave: (timezone: string) => Promise<void>;
}) {
  const [picked, setPicked] = useState(props.currentTimezone);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const allTimezones = useMemo(() => listAllTimezones(), []);

  // Refresh the "now" preview every 30s so it stays useful while the
  // admin reads the dropdown. Cleared on unmount.
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const isDirty = picked !== props.currentTimezone;
  const filteredAll = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allTimezones.slice(0, 60);
    return allTimezones.filter((tz) => tz.toLowerCase().includes(q)).slice(0, 60);
  }, [allTimezones, search]);

  async function save() {
    if (!picked) { setErr('יש לבחור אזור זמן'); return; }
    setBusy(true);
    setErr('');
    try {
      await props.onSave(picked);
    } catch (e) {
      const m = e instanceof Error ? e.message :
        (typeof e === 'object' && e !== null && typeof (e as { message?: unknown }).message === 'string')
          ? (e as { message: string }).message : 'שמירה נכשלה';
      setErr(m);
    } finally {
      setBusy(false);
    }
  }

  return (
    <StrongModal
      title="אזור זמן"
      isDirty={isDirty}
      onClose={props.onClose}
      busy={busy}
      maxWidth={520}
    >
      {({ attemptClose }) => (
        <>
          <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.6, margin: '0 0 14px' }}>
            אזור הזמן שלך משפיע על חישוב הרצף האישי בלבד.
            הניקוד והמשחק ממשיכים להתחשב בזמן ישראל באופן זהה לכל המשתתפות.
            שינוי כעת יחול על דיווחים עתידיים בלבד; היסטוריה לא תיחשב מחדש.
          </p>

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              מיקומים נפוצים
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {COMMON_PRESETS.map((p) => {
                const active = picked === p.tz;
                return (
                  <button
                    key={p.tz}
                    type="button"
                    onClick={() => setPicked(p.tz)}
                    style={{
                      padding: '5px 12px', fontSize: 12, fontWeight: 600,
                      background: active ? '#2563eb' : '#fff',
                      color: active ? '#fff' : '#475569',
                      border: `1px solid ${active ? '#2563eb' : '#cbd5e1'}`,
                      borderRadius: 999, cursor: 'pointer',
                    }}
                  >{p.label}</button>
                );
              })}
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6, display: 'block' }}>
              חיפוש
            </label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="לדוגמה: Asia, Berlin, Tokyo"
              dir="ltr"
              style={{
                width: '100%', padding: '8px 12px',
                border: '1px solid #cbd5e1', borderRadius: 8,
                fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box',
              }}
            />
          </div>

          <div
            style={{
              maxHeight: 220, overflowY: 'auto',
              border: '1px solid #e2e8f0', borderRadius: 8,
              marginBottom: 12,
            }}
          >
            {filteredAll.length === 0 && (
              <div style={{ padding: 14, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>
                {allTimezones.length === 0
                  ? 'לרשימה המלאה נדרש דפדפן/שרת מודרני יותר. השתמשי במיקומים הנפוצים למעלה.'
                  : 'לא נמצאו תוצאות'}
              </div>
            )}
            {filteredAll.map((tz) => {
              const active = picked === tz;
              return (
                <button
                  key={tz}
                  type="button"
                  onClick={() => setPicked(tz)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'right',
                    padding: '8px 12px',
                    background: active ? '#eff6ff' : 'none',
                    color: active ? '#1d4ed8' : '#0f172a',
                    border: 'none', borderBottom: '1px solid #f1f5f9',
                    cursor: 'pointer', fontSize: 13,
                    fontFamily: 'inherit', direction: 'ltr',
                  }}
                >
                  {tz}
                </button>
              );
            })}
          </div>

          <div
            style={{
              background: '#f8fafc', border: '1px solid #e2e8f0',
              borderRadius: 8, padding: 10, marginBottom: 14, fontSize: 13,
            }}
          >
            הזמן ב-<strong dir="ltr">{picked}</strong> כעת:
            <span style={{ marginInlineStart: 8, fontWeight: 700, color: '#0f172a' }}>
              {formatNowIn(picked)}
            </span>
          </div>

          {err && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 10 }}>{err}</div>}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              onClick={attemptClose}
              disabled={busy}
              style={{ background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 8, padding: '7px 14px', fontSize: 13, cursor: busy ? 'not-allowed' : 'pointer' }}
            >ביטול</button>
            <button
              onClick={() => { void save(); }}
              disabled={busy || !isDirty}
              style={{ background: busy || !isDirty ? '#93c5fd' : '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 18px', fontSize: 13, fontWeight: 700, cursor: busy || !isDirty ? 'not-allowed' : 'pointer' }}
            >{busy ? 'שומר...' : 'שמור'}</button>
          </div>
        </>
      )}
    </StrongModal>
  );
}
