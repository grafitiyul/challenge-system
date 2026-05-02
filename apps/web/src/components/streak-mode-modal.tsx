'use client';

// StreakModeModal — admin picks one of three continuity modes for a
// participant's membership in a specific group:
//
//   "fresh"    (default) — game streak starts at 0; portal hides
//                          personal streak/history and "סה״כ נקודות".
//   "continue"           — game streak still 0, but portal shows
//                          personal streak/history alongside.
//   "override"           — admin sets a starting streak number with
//                          optional reason. Phantom-day algorithm
//                          uses it as both the GAME-streak baseline
//                          AND the PERSONAL-streak baseline (most-
//                          recent across memberships wins).
//
// Locked StrongModal — backdrop noop, X + unsaved-changes confirm.
// Single endpoint POST /api/game/groups/:gid/participants/:pid/streak-mode
// covers all three cases. Service NULLs override columns when
// switching to fresh/continue.

import { useState } from 'react';
import { apiFetch, BASE_URL } from '@lib/api';
import { StrongModal } from './strong-modal';

export interface StreakModeInitial {
  mode: 'fresh' | 'continue' | 'override';
  value: number | null;
  reason: string | null;
  overrideBy: string | null;
  overrideAt: string | null;
}

export function StreakModeModal(props: {
  groupId: string;
  participantId: string;
  participantName: string;
  initial: StreakModeInitial;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [mode, setMode] = useState<StreakModeInitial['mode']>(props.initial.mode);
  const [value, setValue] = useState<string>(
    props.initial.value !== null ? String(props.initial.value) : '',
  );
  const [reason, setReason] = useState(props.initial.reason ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const isDirty =
    mode !== props.initial.mode ||
    (mode === 'override' && (
      value !== (props.initial.value !== null ? String(props.initial.value) : '') ||
      reason !== (props.initial.reason ?? '')
    ));

  async function save() {
    setErr('');
    if (mode === 'override') {
      const n = parseInt(value, 10);
      if (!Number.isInteger(n) || n < 0 || n > 9999) {
        setErr('יש להזין מספר רצף תקין (0–9999)');
        return;
      }
    }
    setBusy(true);
    try {
      const body: { mode: typeof mode; value?: number; reason?: string } = { mode };
      if (mode === 'override') {
        body.value = parseInt(value, 10);
        if (reason.trim()) body.reason = reason.trim();
      }
      await apiFetch(
        `${BASE_URL}/game/groups/${props.groupId}/participants/${props.participantId}/streak-mode`,
        { method: 'POST', body: JSON.stringify(body) },
      );
      props.onSaved();
    } catch (e) {
      const m = e instanceof Error ? e.message :
        (typeof e === 'object' && e !== null && typeof (e as { message?: unknown }).message === 'string')
          ? (e as { message: string }).message : 'שמירה נכשלה';
      setErr(m);
    } finally {
      setBusy(false);
    }
  }

  function modeRadio(key: 'fresh' | 'continue' | 'override', title: string, description: string) {
    const active = mode === key;
    return (
      <label
        key={key}
        style={{
          display: 'flex', alignItems: 'flex-start', gap: 10,
          padding: '12px 14px',
          border: `1.5px solid ${active ? '#2563eb' : '#e2e8f0'}`,
          background: active ? '#eff6ff' : '#fff',
          borderRadius: 10, cursor: 'pointer', marginBottom: 8,
        }}
      >
        <input
          type="radio"
          name="streakMode"
          checked={active}
          onChange={() => setMode(key)}
          style={{ marginTop: 3, flexShrink: 0 }}
        />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{title}</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 3, lineHeight: 1.5 }}>{description}</div>
        </div>
      </label>
    );
  }

  return (
    <StrongModal
      title={`המשכיות / רצף — ${props.participantName}`}
      isDirty={isDirty}
      onClose={props.onClose}
      busy={busy}
      maxWidth={540}
    >
      {({ attemptClose }) => (
        <>
          {/* Existing override summary — surfaces the audit fields when
              switching modes to override-mode rows that already have a
              value. Helps admin recall what was set, by whom, when. */}
          {props.initial.mode === 'override' && props.initial.value !== null && (
            <div
              style={{
                background: '#fffbeb', border: '1px solid #fde68a',
                borderRadius: 8, padding: 10, marginBottom: 14,
                fontSize: 12, color: '#92400e', lineHeight: 1.6,
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 4 }}>
                עריכה ידנית פעילה: {props.initial.value} ימים
              </div>
              {props.initial.reason && <div>סיבה: {props.initial.reason}</div>}
              {props.initial.overrideAt && (
                <div>נשמרה: {new Date(props.initial.overrideAt).toLocaleString('he-IL')}</div>
              )}
            </div>
          )}

          {modeRadio(
            'fresh',
            'התחלה חדשה (ברירת מחדל)',
            'חוויה חדשה לגמרי. רצף וניקוד במשחק מתחילים מ-0, וההיסטוריה מהמשחקים הקודמים לא תוצג כלל למשתתפת בקבוצה זו.',
          )}
          {modeRadio(
            'continue',
            'ממשיכה מההיסטוריה הקודמת',
            'אותה משתתפת, אותו מסע. רצף וניקוד במשחק עדיין מתחילים מ-0, אבל ההיסטוריה הקודמת חשופה — סה״כ נקודות, גרפים וטאב נתונים מציגים את כל הדרך. גם אם הרצף הקודם נשבר, החוויה היא של המשך, לא התחלה חדשה.',
          )}
          {modeRadio(
            'override',
            'עריכה ידנית',
            'התאמה לערך מסוים — לשימוש כשרצף קודם שגוי או דורש תיקון.',
          )}

          {mode === 'override' && (
            <div
              style={{
                marginTop: 4, marginBottom: 12,
                background: '#f8fafc', border: '1px solid #e2e8f0',
                borderRadius: 10, padding: 14,
              }}
            >
              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4, display: 'block' }}>
                  רצף התחלתי *
                </label>
                <input
                  type="number"
                  min={0}
                  max={9999}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  style={{
                    width: 140, padding: '8px 12px', direction: 'ltr',
                    border: '1px solid #cbd5e1', borderRadius: 8,
                    fontSize: 14, fontFamily: 'inherit',
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4, display: 'block' }}>
                  סיבה (אופציונלי)
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder="לדוגמה: רצף קודם בן 30 יום שלא נשמר במערכת"
                  style={{
                    width: '100%', padding: '8px 12px',
                    border: '1px solid #cbd5e1', borderRadius: 8,
                    fontSize: 13, fontFamily: 'inherit',
                    resize: 'vertical', boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>
          )}

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
