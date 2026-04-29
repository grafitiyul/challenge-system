'use client';

import { Suspense, use, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { BASE_URL, apiFetch } from '@lib/api';
import WhatsAppEditor from '@components/whatsapp-editor';
import RichContentEditor from '@components/rich-content-editor';
import { VariableButtonBar, type VariableEditorHandle } from '@components/variable-button-bar';
import { ProfileTab } from './profile-tab';

// ─── Types ────────────────────────────────────────────────────────────────────

type ProgramType = 'challenge' | 'game' | 'group_coaching' | 'personal_coaching';
type GroupStatus = 'active' | 'inactive';
type TabKey = 'settings' | 'groups' | 'game' | 'rules' | 'waitlist' | 'offers' | 'communication' | 'profile';

interface Group {
  id: string;
  name: string;
  status: GroupStatus;
  startDate: string | null;
  endDate: string | null;
  _count: { participantGroups: number };
}

interface Program {
  id: string;
  name: string;
  type: ProgramType;
  description: string | null;
  isActive: boolean;
  isHidden: boolean;
  groups: Group[];
  showIndividualLeaderboard: boolean;
  showGroupComparison: boolean;
  showOtherGroupsCharts: boolean;
  showOtherGroupsMemberDetails: boolean;
  rulesContent: string | null;
  rulesPublished: boolean;
  // Phase 7 — gates the participant-portal "פרטים אישיים" tab.
  profileTabEnabled: boolean;
  // Catch-up mode admin config — see /admin/programs/:id settings tab.
  catchUpEnabled: boolean;
  catchUpButtonLabel: string;
  catchUpConfirmTitle: string | null;
  catchUpConfirmBody: string | null;
  catchUpDurationMinutes: number;
  catchUpAllowedDaysBack: number;
  catchUpBannerText: string | null;
  catchUpAvailableDates: string[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TYPE_LABEL: Record<ProgramType, string> = {
  challenge:         'אתגר',
  game:              'משחק',
  group_coaching:    'ליווי קבוצתי',
  personal_coaching: 'ליווי אישי',
};

const TYPE_NAME_LABEL: Record<ProgramType, string> = {
  challenge:         'שם האתגר',
  game:              'שם המשחק',
  group_coaching:    'שם הליווי הקבוצתי',
  personal_coaching: 'שם הליווי האישי',
};

const TYPE_DESC_PLACEHOLDER: Record<ProgramType, string> = {
  challenge:         'תיאור קצר של האתגר...',
  game:              'תיאור קצר של המשחק...',
  group_coaching:    'תיאור קצר של הליווי הקבוצתי...',
  personal_coaching: 'תיאור קצר של הליווי האישי...',
};

const STATUS_LABEL: Record<GroupStatus, string> = { active: 'פעיל', inactive: 'לא פעיל' };

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  border: '1px solid #cbd5e1',
  borderRadius: 8,
  fontSize: 15,
  color: '#0f172a',
  background: '#ffffff',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
  lineHeight: 1.5,
  outline: 'none',
};
const labelStyle: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6, display: 'block',
};

const VALID_TABS: TabKey[] = ['settings', 'groups', 'game', 'rules', 'offers', 'waitlist', 'communication', 'profile'];

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('he-IL');
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────

function SettingsTab({ program, onSaved }: { program: Program; onSaved: (p: Program) => void }) {
  const [form, setForm] = useState({ name: program.name, description: program.description ?? '', isActive: program.isActive });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const router = useRouter();

  const [vis, setVis] = useState({
    showIndividualLeaderboard: program.showIndividualLeaderboard,
    showGroupComparison: program.showGroupComparison,
    showOtherGroupsCharts: program.showOtherGroupsCharts,
    showOtherGroupsMemberDetails: program.showOtherGroupsMemberDetails,
  });
  const [savingVis, setSavingVis] = useState(false);
  const [visSaved, setVisSaved] = useState(false);

  async function handleSave() {
    if (!form.name.trim()) { setError('שם הוא שדה חובה'); return; }
    setSaving(true); setError('');
    try {
      const updated = await apiFetch(`${BASE_URL}/programs/${program.id}`, {
        method: 'PATCH',
        cache: 'no-store',
        body: JSON.stringify({ name: form.name.trim(), description: form.description.trim() || undefined, isActive: form.isActive }),
      }) as Program;
      onSaved({ ...program, ...updated });
      setSaved(true);
    } finally { setSaving(false); }
  }

  async function handleSaveVisibility() {
    setSavingVis(true); setVisSaved(false);
    try {
      const updated = await apiFetch(`${BASE_URL}/programs/${program.id}`, {
        method: 'PATCH',
        cache: 'no-store',
        body: JSON.stringify(vis),
      }) as Program;
      onSaved({ ...program, ...updated });
      setVisSaved(true);
      setTimeout(() => setVisSaved(false), 2500);
    } finally { setSavingVis(false); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 680 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 520 }}>
        <div>
          <label style={labelStyle}>סוג</label>
          <div style={{ fontSize: 14, color: '#374151', padding: '6px 0' }}>{TYPE_LABEL[program.type]}</div>
        </div>
        <div>
          <label style={labelStyle}>{TYPE_NAME_LABEL[program.type]} *</label>
          <input style={inputStyle} value={form.name} onChange={(e) => { setForm((p) => ({ ...p, name: e.target.value })); setSaved(false); }} />
        </div>
        <div>
          <label style={labelStyle}>תיאור</label>
          <textarea
            rows={3}
            style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6, minHeight: 88 }}
            value={form.description}
            onChange={(e) => { setForm((p) => ({ ...p, description: e.target.value })); setSaved(false); }}
            placeholder={TYPE_DESC_PLACEHOLDER[program.type]}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{ ...labelStyle, margin: 0 }}>{TYPE_LABEL[program.type]} פעיל</label>
          <input type="checkbox" checked={form.isActive} onChange={(e) => { setForm((p) => ({ ...p, isActive: e.target.checked })); setSaved(false); }} style={{ width: 16, height: 16, cursor: 'pointer' }} />
        </div>
        {error && <div style={{ color: '#dc2626', fontSize: 13 }}>{error}</div>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={handleSave} disabled={saving} style={{ background: saving ? '#93c5fd' : '#2563eb', color: '#fff', border: 'none', borderRadius: 7, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer' }}>
            {saving ? 'שומר...' : 'שמירה'}
          </button>
          {saved && <span style={{ color: '#16a34a', fontSize: 13 }}>✓ נשמר</span>}
        </div>
      </div>

      {/* ── Visibility settings ── */}
      <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 24, display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 520 }}>
        <div>
          <label style={labelStyle}>הגדרות חשיפה למשתתפות</label>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
            שלטי הצגה אלו יקבעו מה רואות המשתתפות בממשק שלהן. המנהל תמיד רואה הכל.
          </div>
        </div>
        {([
          { key: 'showIndividualLeaderboard', label: 'הצגת דירוג אישי', desc: 'המשתתפת רואה את מיקומה ואת שאר חברות הקבוצה' },
          { key: 'showGroupComparison', label: 'הצגת השוואת קבוצות', desc: 'המשתתפת רואה את ציון הקבוצה שלה מול קבוצות אחרות' },
          { key: 'showOtherGroupsCharts', label: 'הצגת גרפים של קבוצות אחרות', desc: 'אפשרי רק כאשר השוואת קבוצות פעילה' },
          { key: 'showOtherGroupsMemberDetails', label: 'הצגת חברות קבוצות אחרות', desc: 'המשתתפת רואה שמות ודירוג מקבוצות אחרות' },
        ] as { key: keyof typeof vis; label: string; desc: string }[]).map((item) => (
          <div key={item.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <input
              type="checkbox"
              id={`vis-${item.key}`}
              checked={vis[item.key]}
              onChange={(e) => { setVis((p) => ({ ...p, [item.key]: e.target.checked })); setVisSaved(false); }}
              style={{ width: 16, height: 16, marginTop: 2, cursor: 'pointer', flexShrink: 0 }}
            />
            <label htmlFor={`vis-${item.key}`} style={{ cursor: 'pointer' }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: '#0f172a' }}>{item.label}</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{item.desc}</div>
            </label>
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={handleSaveVisibility}
            disabled={savingVis}
            style={{ background: savingVis ? '#93c5fd' : '#2563eb', color: '#fff', border: 'none', borderRadius: 7, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: savingVis ? 'not-allowed' : 'pointer' }}
          >
            {savingVis ? 'שומר...' : 'שמור הגדרות חשיפה'}
          </button>
          {visSaved && <span style={{ color: '#16a34a', fontSize: 13 }}>✓ נשמר</span>}
        </div>
      </div>

      {/* ── Catch-up mode ── Per-program admin section. Master toggle
           gates everything; available-dates list controls when the
           button can appear at all. Snapshot of duration / days-back
           on the session row insulates running sessions from edits. */}
      <CatchUpSettings program={program} onSaved={onSaved} />

      {/* ── Destructive zone ── Archive OR hard-delete. Hard-delete is
           gated server-side on zero dependents; the modal falls back to
           showing the reason + offers archive when blocked. */}
      <div style={{ borderTop: '1px solid #fee2e2', paddingTop: 24, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 520 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#b91c1c', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          🗑 ניהול מחיקה
        </div>
        <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.55 }}>
          ארכוב הופך את המוצר לבלתי פעיל מבלי לאבד היסטוריה — הדרך הבטוחה והמומלצת.
          מחיקה לצמיתות זמינה רק כאשר אין כלל קבוצות, הצעות, שאלונים, תבניות או רשומות
          ברשימת המתנה מקושרות (לרוב מתאים לתוכניות-בדיקה).
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const }}>
          {program.isActive ? (
            <button
              onClick={async () => {
                if (!confirm('להעביר את המוצר לארכיון? המוצר יוסתר מרשימות פעילות. ניתן לשחזר.')) return;
                const updated = await apiFetch(`${BASE_URL}/programs/${program.id}`, {
                  method: 'PATCH', body: JSON.stringify({ isActive: false }),
                }) as Program;
                onSaved({ ...program, ...updated });
              }}
              style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, background: '#fff', color: '#b45309', border: '1px solid #fde68a', borderRadius: 8, cursor: 'pointer' }}
            >העבר לארכיון</button>
          ) : (
            <button
              onClick={async () => {
                const updated = await apiFetch(`${BASE_URL}/programs/${program.id}`, {
                  method: 'PATCH', body: JSON.stringify({ isActive: true }),
                }) as Program;
                onSaved({ ...program, ...updated });
              }}
              style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0', borderRadius: 8, cursor: 'pointer' }}
            >שחזר מהארכיון</button>
          )}
          {/* Clutter control — independent of archive. Hidden programs
              stay fully intact but disappear from daily-use surfaces
              until "הצג פריטים מוסתרים" is toggled on the list page. */}
          {program.isHidden ? (
            <button
              onClick={async () => {
                const updated = await apiFetch(`${BASE_URL}/programs/${program.id}`, {
                  method: 'PATCH', body: JSON.stringify({ isHidden: false }),
                }) as Program;
                onSaved({ ...program, ...updated });
              }}
              style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, background: '#fff7ed', color: '#92400e', border: '1px solid #fed7aa', borderRadius: 8, cursor: 'pointer' }}
            >🙉 הצג מחדש</button>
          ) : (
            <button
              onClick={async () => {
                if (!confirm('להסתיר את המוצר מהמערכת? יישמר במלואו; יוסתר מרשימות ובוחרים. ניתן להציג מחדש בכל עת.')) return;
                const updated = await apiFetch(`${BASE_URL}/programs/${program.id}`, {
                  method: 'PATCH', body: JSON.stringify({ isHidden: true }),
                }) as Program;
                onSaved({ ...program, ...updated });
              }}
              style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, background: '#fff', color: '#92400e', border: '1px solid #fed7aa', borderRadius: 8, cursor: 'pointer' }}
            >🙈 הסתר מהמערכת</button>
          )}
          <button
            onClick={() => setDeleteOpen(true)}
            style={{ padding: '8px 16px', fontSize: 13, fontWeight: 700, background: '#fff', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: 8, cursor: 'pointer' }}
          >🗑 מחק מוצר לצמיתות…</button>
        </div>
      </div>

      {deleteOpen && (
        <DeleteProgramModal
          program={program}
          onClose={() => setDeleteOpen(false)}
          onDeleted={() => router.push('/admin/programs')}
        />
      )}
    </div>
  );
}

// ─── Catch-up mode settings (Settings tab subsection) ─────────────────────
// 8 admin-controlled fields. Master toggle (catchUpEnabled) at the top
// dims but does not disable the rest of the form, so the admin can
// stage all the wording before flipping the switch live.
//
// catchUpAvailableDates is rendered as a chip list with a +הוסף תאריך
// affordance. Each chip is a YYYY-MM-DD string; the backend dedups +
// sorts on save. Empty list = button never appears (safe default).

function CatchUpSettings({ program, onSaved }: { program: Program; onSaved: (p: Program) => void }) {
  const [form, setForm] = useState({
    catchUpEnabled:         program.catchUpEnabled,
    catchUpButtonLabel:     program.catchUpButtonLabel ?? '',
    catchUpConfirmTitle:    program.catchUpConfirmTitle ?? '',
    catchUpConfirmBody:     program.catchUpConfirmBody ?? '',
    catchUpDurationMinutes: program.catchUpDurationMinutes ?? 10,
    catchUpAllowedDaysBack: program.catchUpAllowedDaysBack ?? 2,
    catchUpBannerText:      program.catchUpBannerText ?? '',
    catchUpAvailableDates:  [...(program.catchUpAvailableDates ?? [])].sort(),
  });
  const [newDate, setNewDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');

  const dim = !form.catchUpEnabled;

  function addDate() {
    const v = newDate.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
    setForm((p) => {
      if (p.catchUpAvailableDates.includes(v)) return p;
      return { ...p, catchUpAvailableDates: [...p.catchUpAvailableDates, v].sort() };
    });
    setNewDate('');
    setSaved(false);
  }

  function removeDate(d: string) {
    setForm((p) => ({ ...p, catchUpAvailableDates: p.catchUpAvailableDates.filter((x) => x !== d) }));
    setSaved(false);
  }

  async function save() {
    setSaving(true); setErr(''); setSaved(false);
    try {
      // Auto-flush an unconfirmed date in the picker. The previous flow
      // required the admin to click "+ הוסף תאריך" to convert the date
      // input into a chip; if she skipped that and clicked שמירה
      // directly, the date silently dropped on the floor and the array
      // saved empty (the original root cause that broke the participant
      // button). Now we accept "what you see is what gets saved": if
      // the date input holds a valid YYYY-MM-DD, include it.
      const pendingDate = newDate.trim();
      const datesToSave = (
        /^\d{4}-\d{2}-\d{2}$/.test(pendingDate) && !form.catchUpAvailableDates.includes(pendingDate)
          ? [...form.catchUpAvailableDates, pendingDate].sort()
          : form.catchUpAvailableDates
      );

      // Send empty strings as nulls so the backend stores null when the
      // admin clears a field, rather than a literal empty string.
      const payload = {
        catchUpEnabled:         form.catchUpEnabled,
        catchUpButtonLabel:     form.catchUpButtonLabel.trim() || 'דיווח השלמה',
        catchUpConfirmTitle:    form.catchUpConfirmTitle.trim() || null,
        catchUpConfirmBody:     form.catchUpConfirmBody.trim() || null,
        catchUpDurationMinutes: Math.max(1, Number(form.catchUpDurationMinutes) || 1),
        catchUpAllowedDaysBack: Math.max(1, Number(form.catchUpAllowedDaysBack) || 1),
        catchUpBannerText:      form.catchUpBannerText.trim() || null,
        catchUpAvailableDates:  datesToSave,
      };
      // TEMP catch-up persistence diagnostic — print exactly what the
      // form is sending and what comes back. Remove once text fields
      // are confirmed to round-trip cleanly. Open devtools console
      // before clicking Save to capture this.
      // eslint-disable-next-line no-console
      console.log('[catchup-save] form snapshot:', JSON.parse(JSON.stringify(form)));
      // eslint-disable-next-line no-console
      console.log('[catchup-save] PATCH payload:', JSON.parse(JSON.stringify(payload)));
      const updated = await apiFetch(`${BASE_URL}/programs/${program.id}`, {
        method: 'PATCH',
        cache: 'no-store',
        body: JSON.stringify(payload),
      }) as Program;
      // eslint-disable-next-line no-console
      console.log('[catchup-save] PATCH response catch-up fields:', {
        catchUpEnabled:         updated.catchUpEnabled,
        catchUpButtonLabel:     updated.catchUpButtonLabel,
        catchUpConfirmTitle:    updated.catchUpConfirmTitle,
        catchUpConfirmBody:     updated.catchUpConfirmBody,
        catchUpDurationMinutes: updated.catchUpDurationMinutes,
        catchUpAllowedDaysBack: updated.catchUpAllowedDaysBack,
        catchUpBannerText:      updated.catchUpBannerText,
        catchUpAvailableDates:  updated.catchUpAvailableDates,
      });
      // Sync local form state to whatever the server actually persisted.
      // Without this, the UI showed the chip the admin had typed but
      // never confirmed, masking the bug. Now the source of truth is
      // always what came back.
      setForm((p) => ({
        ...p,
        catchUpAvailableDates: [...(updated.catchUpAvailableDates ?? [])].sort(),
      }));
      setNewDate('');
      onSaved({ ...program, ...updated });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'שמירה נכשלה');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 24, display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 520 }}>
      <div>
        <label style={labelStyle}>מצב השלמה</label>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10, lineHeight: 1.5 }}>
          מאפשר למשתתפת לפתוח חלון זמן קצר בתאריכים שתבחרי, ולדווח דיווחים רטרואקטיבית עד מספר ימים אחורה (למשל אחרי שבת או חג).
        </div>
      </div>

      {/* Master toggle */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <input
          type="checkbox"
          id="catchUpEnabled"
          checked={form.catchUpEnabled}
          onChange={(e) => { setForm((p) => ({ ...p, catchUpEnabled: e.target.checked })); setSaved(false); }}
          style={{ width: 16, height: 16, marginTop: 2, cursor: 'pointer', flexShrink: 0 }}
        />
        <label htmlFor="catchUpEnabled" style={{ cursor: 'pointer' }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: '#0f172a' }}>הצג כפתור מצב השלמה למשתתפות</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
            מתג ראשי. כשהוא כבוי הכפתור לא יופיע גם אם הוגדרו תאריכי זמינות.
          </div>
        </label>
      </div>

      {/* Form fields — dimmed when master is off */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, opacity: dim ? 0.55 : 1 }}>
        <div>
          <label style={labelStyle}>תווית הכפתור</label>
          <input
            style={inputStyle}
            value={form.catchUpButtonLabel}
            onChange={(e) => { setForm((p) => ({ ...p, catchUpButtonLabel: e.target.value })); setSaved(false); }}
            placeholder="דיווח אחרי שבת/חג ל-10 דקות"
          />
        </div>

        <div>
          <label style={labelStyle}>כותרת אישור</label>
          <input
            style={inputStyle}
            value={form.catchUpConfirmTitle}
            onChange={(e) => { setForm((p) => ({ ...p, catchUpConfirmTitle: e.target.value })); setSaved(false); }}
            placeholder="להפעיל מצב השלמה?"
          />
        </div>

        <div>
          <label style={labelStyle}>טקסט אישור</label>
          <textarea
            rows={3}
            style={{ ...inputStyle, resize: 'vertical', minHeight: 72, lineHeight: 1.55 }}
            value={form.catchUpConfirmBody}
            onChange={(e) => { setForm((p) => ({ ...p, catchUpConfirmBody: e.target.value })); setSaved(false); }}
            placeholder="לאחר ההפעלה תוכלי לדווח על דיווחים מהימים האחרונים. החלון פתוח למספר דקות בלבד."
          />
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>משך הפעלה (דקות)</label>
            <input
              type="number"
              min={1}
              style={inputStyle}
              value={form.catchUpDurationMinutes}
              onChange={(e) => { setForm((p) => ({ ...p, catchUpDurationMinutes: Number(e.target.value) })); setSaved(false); }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>ימים אחורה מותרים</label>
            <input
              type="number"
              min={1}
              style={inputStyle}
              value={form.catchUpAllowedDaysBack}
              onChange={(e) => { setForm((p) => ({ ...p, catchUpAllowedDaysBack: Number(e.target.value) })); setSaved(false); }}
            />
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
              מינימום 1. שני ימים = היום / אתמול / שלשום.
            </div>
          </div>
        </div>

        <div>
          <label style={labelStyle}>טקסט באנר/טיימר</label>
          <input
            style={inputStyle}
            value={form.catchUpBannerText}
            onChange={(e) => { setForm((p) => ({ ...p, catchUpBannerText: e.target.value })); setSaved(false); }}
            placeholder="מצב השלמה פעיל — נשארו {time}"
          />
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
            ניתן להשתמש ב-{'{time}'} למיקום הטיימר.
          </div>
        </div>

        {/* Available dates chip list */}
        <div>
          <label style={labelStyle}>תאריכי זמינות (זמן ישראל)</label>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8, lineHeight: 1.5 }}>
            הכפתור יופיע למשתתפות רק בתאריכים שכאן. הסרה אינה מבטלת סשנים שכבר רצים.
          </div>
          {form.catchUpAvailableDates.length === 0 ? (
            <div style={{ fontSize: 13, color: '#94a3b8', padding: '8px 0' }}>
              אין תאריכים מוגדרים — הכפתור לא יופיע.
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {form.catchUpAvailableDates.map((d) => (
                <div
                  key={d}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    background: '#eff6ff', color: '#1d4ed8',
                    border: '1px solid #bfdbfe', borderRadius: 999,
                    padding: '4px 10px', fontSize: 12, fontWeight: 600,
                  }}
                >
                  📅 {d}
                  <button
                    type="button"
                    onClick={() => removeDate(d)}
                    aria-label={`הסר ${d}`}
                    style={{ background: 'none', border: 'none', color: '#1d4ed8', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}
                  >×</button>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="date"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              style={{ ...inputStyle, width: 'auto' }}
            />
            <button
              type="button"
              onClick={addDate}
              disabled={!/^\d{4}-\d{2}-\d{2}$/.test(newDate)}
              style={{
                padding: '8px 14px', fontSize: 13, fontWeight: 600,
                background: '#fff', color: '#1d4ed8',
                border: '1px solid #bfdbfe', borderRadius: 8,
                cursor: /^\d{4}-\d{2}-\d{2}$/.test(newDate) ? 'pointer' : 'not-allowed',
                opacity: /^\d{4}-\d{2}-\d{2}$/.test(newDate) ? 1 : 0.5,
              }}
            >+ הוסף תאריך</button>
          </div>
          {/* Visible reminder when the admin has typed/picked a date
              but hasn't yet converted it into a chip. The save handler
              auto-flushes this on submit so it's no longer destructive
              — the hint is still useful so the chip list reflects
              reality before save. */}
          {/^\d{4}-\d{2}-\d{2}$/.test(newDate) && !form.catchUpAvailableDates.includes(newDate) && (
            <div style={{ fontSize: 11, color: '#92400e', marginTop: 6, lineHeight: 1.5 }}>
              ⚠ {newDate} עוד לא נוסף לרשימה. לחצי על "+ הוסף תאריך" או על "שמירה" — שניהם יוסיפו אותו.
            </div>
          )}
        </div>
      </div>

      {err && <div style={{ color: '#dc2626', fontSize: 13 }}>{err}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={save}
          disabled={saving}
          style={{
            background: saving ? '#93c5fd' : '#2563eb', color: '#fff',
            border: 'none', borderRadius: 7, padding: '9px 20px',
            fontSize: 13, fontWeight: 600,
            cursor: saving ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? 'שומר...' : 'שמור הגדרות מצב השלמה'}
        </button>
        {saved && <span style={{ color: '#16a34a', fontSize: 13 }}>✓ נשמר</span>}
      </div>
    </div>
  );
}

// ─── Triple-confirm program hard-delete modal ──────────────────────────────
// Stage 1: impact + safety check (attempts a dry delete via the server,
//          which returns 400 with a blocking reason if unsafe).
// Stage 2: type program name.
// Stage 3: final explicit button.
// Locked modal: no backdrop close, explicit × button, always soft-fallback.
function DeleteProgramModal(props: { program: Program; onClose: () => void; onDeleted: () => void }) {
  const [stage, setStage] = useState<1 | 2 | 3>(1);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [blocked, setBlocked] = useState<string | null>(null);
  const armed = typed.trim() === props.program.name.trim();

  async function attempt() {
    setBusy(true); setErr('');
    try {
      await apiFetch(`${BASE_URL}/programs/${props.program.id}/hard`, { method: 'DELETE' });
      props.onDeleted();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'מחיקה נכשלה';
      // When blocked by dependents the backend returns a human-readable
      // reason; surface it and drop back to stage 1 so admin can archive.
      setBlocked(msg);
      setStage(1);
    } finally { setBusy(false); }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 14, padding: 24, width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto' as const, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#b91c1c' }}>מחיקת מוצר — שלב {stage} / 3</div>
          <button aria-label="סגור" onClick={props.onClose} disabled={busy} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 22, cursor: busy ? 'not-allowed' : 'pointer' }}>×</button>
        </div>

        {stage === 1 && (
          <>
            {blocked && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: 12, marginBottom: 14, fontSize: 13, color: '#991b1b' }}>
                לא ניתן למחוק לצמיתות: {blocked}
              </div>
            )}
            <div style={{ fontSize: 14, color: '#374151', lineHeight: 1.65, marginBottom: 14 }}>
              מוצר “<strong>{props.program.name}</strong>” ימחק לצמיתות (כולל הגדרותיו).
            </div>
            <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, padding: 14, marginBottom: 14, fontSize: 13, color: '#7c2d12', lineHeight: 1.65 }}>
              השרת חוסם מחיקה כאשר קיימות: קבוצות, הצעות מכר, שאלונים, נוסחי הודעה,
              רשומות ברשימת המתנה, או היסטוריית משחק/ניקוד. אם כך — ארכוב הוא הפעולה הבטוחה.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={props.onClose} style={{ padding: '8px 18px', background: '#f1f5f9', border: '1px solid #e2e8f0', color: '#374151', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>ביטול</button>
              <button
                onClick={() => setStage(2)}
                style={{ padding: '8px 22px', background: '#b91c1c', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
              >הבנתי — המשך</button>
            </div>
          </>
        )}

        {stage === 2 && (
          <>
            <div style={{ fontSize: 14, color: '#374151', lineHeight: 1.65, marginBottom: 10 }}>
              לאימות, הקלידי את שם המוצר במדויק:
            </div>
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontWeight: 700, color: '#0f172a' }}>
              {props.program.name}
            </div>
            <input
              autoFocus
              style={{ width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={props.program.name}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
              <button onClick={() => setStage(1)} style={{ padding: '8px 18px', background: '#f1f5f9', border: '1px solid #e2e8f0', color: '#374151', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>חזרה</button>
              <button
                onClick={() => armed && setStage(3)}
                disabled={!armed}
                style={{ padding: '8px 22px', background: armed ? '#b91c1c' : '#fca5a5', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: armed ? 'pointer' : 'not-allowed' }}
              >המשך</button>
            </div>
          </>
        )}

        {stage === 3 && (
          <>
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: 14, marginBottom: 14, fontSize: 13, color: '#991b1b', lineHeight: 1.55 }}>
              פעולה זו לא ניתנת לשחזור. במידה וקיימים נתונים מקושרים, השרת יחסום אוטומטית
              וידחוף אותך לחזור לאפשרות הארכיון.
            </div>
            {err && <div style={{ color: '#b91c1c', fontSize: 13, marginBottom: 10 }}>{err}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setStage(2)} disabled={busy} style={{ padding: '8px 18px', background: '#f1f5f9', border: '1px solid #e2e8f0', color: '#374151', borderRadius: 8, fontSize: 13, cursor: busy ? 'not-allowed' : 'pointer' }}>חזרה</button>
              <button
                onClick={attempt}
                disabled={busy}
                style={{ padding: '8px 22px', background: busy ? '#fca5a5' : '#b91c1c', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer' }}
              >{busy ? 'מוחק...' : 'אני מבינה — מחק לצמיתות'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Create Group Modal ───────────────────────────────────────────────────────

function CreateGroupModal({ programId, onCreated, onClose }: {
  programId: string;
  onCreated: (g: Group) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [status, setStatus] = useState<GroupStatus>('active');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('שם הקבוצה הוא שדה חובה'); return; }
    setSaving(true); setError('');
    try {
      const created = await apiFetch(`${BASE_URL}/programs/${programId}/groups`, {
        method: 'POST',
        cache: 'no-store',
        body: JSON.stringify({ name: name.trim(), startDate: startDate || undefined, endDate: endDate || undefined, status }),
      }) as Group;
      onCreated(created);
    } finally { setSaving(false); }
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}
    >
      <div style={{ background: '#fff', borderRadius: 14, padding: 28, width: '100%', maxWidth: 440, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', margin: 0 }}>קבוצה חדשה</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#94a3b8' }}>×</button>
        </div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={labelStyle}>שם הקבוצה *</label>
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="לדוגמה: קבוצה א׳" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>תאריך התחלה</label>
              <input type="date" style={{ ...inputStyle, direction: 'ltr' }} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>תאריך סיום</label>
              <input type="date" style={{ ...inputStyle, direction: 'ltr' }} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          <div>
            <label style={labelStyle}>סטטוס</label>
            <select style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value as GroupStatus)}>
              <option value="active">פעיל</option>
              <option value="inactive">לא פעיל</option>
            </select>
          </div>
          {error && <div style={{ color: '#dc2626', fontSize: 13 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="button" onClick={onClose} style={{ background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>ביטול</button>
            <button type="submit" disabled={saving} style={{ background: saving ? '#93c5fd' : '#2563eb', color: '#fff', border: 'none', borderRadius: 7, padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer' }}>
              {saving ? 'יוצר...' : 'צור קבוצה'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Groups Tab ───────────────────────────────────────────────────────────────

interface RelatedGroupRow {
  id: string;
  name: string;
  isActive: boolean;
  isHidden: boolean;
  challenge: { id: string; name: string } | null;
  activeMembers: number;
  reasons: string[];
}

function GroupsTab({ program }: { program: Program }) {
  // Phase 4 cleanup: fetch the unified list from the API so archived
  // cohorts stay discoverable here (the initial payload was active-only).
  // The endpoint also tells us WHY each group is listed (direct, via
  // offer, via template) so the admin can trace relationships.
  const [rows, setRows] = useState<RelatedGroupRow[] | null>(null);
  const [err, setErr] = useState('');
  const [createModal, setCreateModal] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<RelatedGroupRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RelatedGroupRow | null>(null);
  const [includeHidden, setIncludeHidden] = useState(false);

  const reload = useCallback(() => {
    const qs = includeHidden ? '?includeHidden=true' : '';
    apiFetch<RelatedGroupRow[]>(`${BASE_URL}/programs/${program.id}/groups${qs}`, { cache: 'no-store' })
      .then(setRows)
      .catch((e) => setErr(e instanceof Error ? e.message : 'טעינה נכשלה'));
  }, [program.id, includeHidden]);
  useEffect(() => { reload(); }, [reload]);

  async function setHidden(g: RelatedGroupRow, isHidden: boolean) {
    try {
      await apiFetch(`${BASE_URL}/groups/${g.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isHidden }),
      });
      reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'פעולה נכשלה');
    }
  }

  async function setActive(g: RelatedGroupRow, isActive: boolean) {
    try {
      await apiFetch(`${BASE_URL}/groups/${g.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive }),
      });
      setArchiveTarget(null);
      reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'פעולה נכשלה');
    }
  }

  async function hardDelete(g: RelatedGroupRow) {
    try {
      await apiFetch(`${BASE_URL}/groups/${g.id}/hard`, { method: 'DELETE' });
      setDeleteTarget(null);
      reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'מחיקה נכשלה');
    }
  }

  if (err) return <div style={{ color: '#b91c1c' }}>{err}</div>;
  if (!rows) return <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8' }}>טוען...</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' as const }}>
        <span style={{ fontSize: 13, color: '#64748b' }}>{rows.length} קבוצות</span>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' as const }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#475569', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={includeHidden}
              onChange={(e) => setIncludeHidden(e.target.checked)}
            />
            הצג פריטים מוסתרים
          </label>
          <button
            onClick={() => setCreateModal(true)}
            style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 7, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >+ צור קבוצה</button>
        </div>
      </div>

      {rows.length === 0 && (
        <div style={{ padding: '40px 24px', textAlign: 'center', border: '2px dashed #e2e8f0', borderRadius: 10, color: '#94a3b8', fontSize: 14 }}>
          אין קבוצות עדיין — צרי קבוצה ראשונה
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((g) => {
          const empty = g.activeMembers === 0;
          return (
            <div
              key={g.id}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 12, background: '#ffffff', border: '1px solid #e2e8f0',
                borderRadius: 10, padding: '14px 18px', flexWrap: 'wrap' as const,
                opacity: g.isActive && !g.isHidden ? 1 : 0.65,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' as const }}>
                  <Link href={`/admin/groups/${g.id}`} style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', textDecoration: 'none' }}>
                    {g.name}
                  </Link>
                  {!g.isActive && (
                    <span style={{ background: '#f1f5f9', color: '#64748b', fontSize: 11, padding: '2px 10px', borderRadius: 999, fontWeight: 700 }}>
                      בארכיון
                    </span>
                  )}
                  {g.isHidden && (
                    <span style={{ background: '#fef3c7', color: '#92400e', fontSize: 11, padding: '2px 10px', borderRadius: 999, fontWeight: 700 }}>
                      🙈 מוסתר
                    </span>
                  )}
                  <span style={{ background: '#eff6ff', color: '#1d4ed8', fontSize: 11, padding: '2px 10px', borderRadius: 999 }}>
                    👥 {g.activeMembers}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  {g.challenge && <>אתגר: {g.challenge.name} · </>}
                  {g.reasons.join(' · ')}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap' as const }}>
                {g.isActive ? (
                  <button
                    onClick={() => setArchiveTarget(g)}
                    style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, background: 'transparent', color: '#b45309', border: '1px solid #fde68a', borderRadius: 7, cursor: 'pointer' }}
                  >העבר לארכיון</button>
                ) : (
                  <button
                    onClick={() => setActive(g, true)}
                    style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0', borderRadius: 7, cursor: 'pointer' }}
                  >שחזר</button>
                )}
                {/* Clutter control — independent of archive. Hidden rows
                    never show up on the admin page without the
                    "הצג פריטים מוסתרים" toggle. */}
                {g.isHidden ? (
                  <button
                    onClick={() => setHidden(g, false)}
                    style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, background: '#fff7ed', color: '#92400e', border: '1px solid #fed7aa', borderRadius: 7, cursor: 'pointer' }}
                  >🙉 הצג</button>
                ) : (
                  <button
                    onClick={() => setHidden(g, true)}
                    style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, background: 'transparent', color: '#92400e', border: '1px solid #fed7aa', borderRadius: 7, cursor: 'pointer' }}
                  >🙈 הסתר</button>
                )}
                {/* Hard delete is only offered when safe (zero active
                    members). The backend still re-validates before
                    deleting — this is just the UX guardrail. */}
                {empty && (
                  <button
                    onClick={() => setDeleteTarget(g)}
                    style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, background: 'transparent', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: 7, cursor: 'pointer' }}
                  >מחק</button>
                )}
                <Link
                  href={`/admin/groups/${g.id}`}
                  style={{ padding: '6px 12px', fontSize: 12, background: 'transparent', color: '#475569', border: '1px solid #e2e8f0', borderRadius: 7, textDecoration: 'none' }}
                >פתחי</Link>
              </div>
            </div>
          );
        })}
      </div>

      {createModal && (
        <CreateGroupModal
          programId={program.id}
          onCreated={() => { setCreateModal(false); reload(); }}
          onClose={() => setCreateModal(false)}
        />
      )}

      {archiveTarget && (
        <GroupArchiveModal
          group={archiveTarget}
          onClose={() => setArchiveTarget(null)}
          onConfirm={() => setActive(archiveTarget, false)}
        />
      )}

      {deleteTarget && (
        <GroupHardDeleteModal
          group={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => hardDelete(deleteTarget)}
        />
      )}
    </div>
  );
}

// ─── Group archive + hard-delete modals (locked, in-app only) ──────────────

function GroupArchiveModal(props: { group: RelatedGroupRow; onClose: () => void; onConfirm: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 14, padding: 22, width: '100%', maxWidth: 460, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>העברת קבוצה לארכיון</div>
          <button aria-label="סגור" onClick={props.onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ fontSize: 14, color: '#374151', lineHeight: 1.65, marginBottom: 14 }}>
          קבוצה “<strong>{props.group.name}</strong>” תוסתר מרשימות פעילות.{' '}
          {props.group.activeMembers > 0 && (
            <><strong>{props.group.activeMembers}</strong> משתתפות נשארות מקושרות במסד הנתונים ולא יאבדו.</>
          )}
        </div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14 }}>
          אפשר לשחזר בכל עת מכאן או ממסך הקבוצות (“כלול ארכיון”).
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={props.onClose} style={{ padding: '8px 18px', background: '#f1f5f9', border: '1px solid #e2e8f0', color: '#374151', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>ביטול</button>
          <button onClick={props.onConfirm} style={{ padding: '8px 22px', background: '#b45309', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            העבר לארכיון
          </button>
        </div>
      </div>
    </div>
  );
}

function GroupHardDeleteModal(props: { group: RelatedGroupRow; onClose: () => void; onConfirm: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 14, padding: 22, width: '100%', maxWidth: 460, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#b91c1c' }}>מחיקת קבוצה לצמיתות</div>
          <button aria-label="סגור" onClick={props.onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: 12, marginBottom: 14, fontSize: 13, color: '#991b1b', lineHeight: 1.5 }}>
          קבוצה “<strong>{props.group.name}</strong>” תימחק לצמיתות. הפעולה לא ניתנת לשחזור.
          השרת יחסום את המחיקה אוטומטית אם תתגלה היסטוריה (משתתפות, תשלומים, הודעות).
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={props.onClose} style={{ padding: '8px 18px', background: '#f1f5f9', border: '1px solid #e2e8f0', color: '#374151', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>ביטול</button>
          <button onClick={props.onConfirm} style={{ padding: '8px 22px', background: '#b91c1c', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            מחק לצמיתות
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Game Engine Tab ──────────────────────────────────────────────────────────

interface GameAction {
  id: string;
  name: string;
  description: string | null;
  inputType: string | null;
  aggregationMode: string | null;
  unit: string | null;
  points: number;
  // Phase 6.7 explicit base scoring strategy. Admin picks this; engine
  // dispatches on it. aggregationMode is server-derived.
  baseScoringType:
    | 'flat'
    | 'quantity_multiplier'
    | 'latest_value_flat'
    | 'latest_value_units_delta';
  unitSize: number | null;
  basePointsPerUnit: number | null;
  maxPerDay: number | null;
  showInPortal: boolean;
  blockedMessage: string | null;
  explanationContent: string | null;
  soundKey: string;
  // Phase 3.4: admin-editable prompt; null = derive default from aggregation mode.
  participantPrompt: string | null;
  // Phase 4.1: optional free-text question under the main input; null = not rendered.
  participantTextPrompt: string | null;
  // Phase 4.4: when true + prompt set, submission is blocked on empty text.
  participantTextRequired: boolean;
  isActive: boolean;
  sortOrder: number;
  // Phase 3: optional context schema. shape:
  //   { dimensions: [{ key, label, type, required?, options?: [{value,label}] }] }
  contextSchemaJson: ContextSchemaJson | null;
  contextSchemaVersion: number;
  // Phase 3.2: reusable context definitions attached to this action.
  contextUses?: ActionContextUse[];
}

// ─── Context schema shapes (Phase 3) ─────────────────────────────────────────

type ContextFieldType = 'select' | 'text' | 'number';

interface ContextOption {
  value: string;
  label: string;
}

interface ContextField {
  /**
   * Internal slug. Auto-generated from `label` on save for new fields.
   * NEVER surfaced in the admin UI — kept in form state only so existing
   * fields preserve their key across edits (so UserActionLog.contextJson
   * keeps resolving to the same dimension after label tweaks).
   */
  key: string;
  label: string;
  type: ContextFieldType;
  required?: boolean;
  /** Phase 3.1: if false, field is hidden from the participant UI. */
  visibleToParticipant?: boolean;
  options?: ContextOption[]; // select only
}

// Hebrew → ASCII transliteration map for key generation. Not a perfect
// transcription — just enough to produce a deterministic, unique, DB-safe
// slug from a Hebrew label. Keys are internal identifiers, never displayed.
const HEB_TRANSLIT: Record<string, string> = {
  'א': 'a', 'ב': 'b', 'ג': 'g', 'ד': 'd', 'ה': 'h',
  'ו': 'v', 'ז': 'z', 'ח': 'ch', 'ט': 't', 'י': 'y',
  'כ': 'k', 'ך': 'k', 'ל': 'l', 'מ': 'm', 'ם': 'm',
  'נ': 'n', 'ן': 'n', 'ס': 's', 'ע': 'a', 'פ': 'p',
  'ף': 'p', 'צ': 'tz', 'ץ': 'tz', 'ק': 'k', 'ר': 'r',
  'ש': 'sh', 'ת': 't',
};

function slugifyLabel(label: string): string {
  const lowered = label.trim().toLowerCase();
  let out = '';
  for (const ch of lowered) {
    if (HEB_TRANSLIT[ch]) out += HEB_TRANSLIT[ch];
    else if (/[a-z0-9]/.test(ch)) out += ch;
    else out += '_';
  }
  out = out.replace(/_+/g, '_').replace(/^_|_$/g, '');
  if (!out || /^[0-9]/.test(out)) out = out ? `field_${out}` : 'field';
  return out;
}

function uniqueKey(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

interface ContextSchemaJson {
  dimensions: ContextField[];
}

// ─── Phase 3.2: Reusable context library ────────────────────────────────────

interface ContextDefinition {
  id: string;
  programId: string;
  label: string;
  key: string;                           // auto-generated, read-only
  type: ContextFieldType;
  requiredByDefault: boolean;
  visibleToParticipantByDefault: boolean;
  optionsJson: ContextOption[] | null;   // select only
  isActive: boolean;
  sortOrder: number;
  inputMode: 'participant' | 'system_fixed';
  analyticsVisible: boolean;
  fixedValue: string | null;
  // Phase 4.3: centralized analytics group (FK + hydrated label).
  analyticsGroupId: string | null;
  analyticsGroup: { id: string; label: string } | null;
  analyticsDisplayLabel: string | null;
}

// Phase 4.3: centralized analytics group entity.
interface AnalyticsGroup {
  id: string;
  label: string;
  sortOrder: number;
  memberCount: number;
}

interface ActionContextUse {
  id: string;
  actionId: string;
  definitionId: string;
  requiredOverride: boolean | null;
  visibleToParticipantOverride: boolean | null;
  sortOrder: number;
  definition: ContextDefinition;
}

interface GameRule {
  id: string;
  name: string;
  type: string;
  activationType: string | null;
  activationDays: number | null;
  requiresAdminApproval: boolean;
  conditionJson: Record<string, unknown> | null;
  rewardJson: Record<string, unknown> | null;
  isActive: boolean;
  sortOrder: number;
}

const ACTION_INPUT_TYPES = [
  { value: 'boolean', label: 'כן / לא' },
  { value: 'number', label: 'מספר' },
  { value: 'select', label: 'בחירה מרשימה' },
];

// ─── Human-readable rule description ─────────────────────────────────────────

function ruleDescription(rule: GameRule, actions: GameAction[]): string {
  const pts = (rule.rewardJson as Record<string, unknown> | null)?.['points'];
  const ptsStr = pts != null ? `${pts} נקודות` : 'נקודות';
  const condition = rule.conditionJson as Record<string, unknown> | null;

  if (rule.type === 'daily_bonus') {
    return `${ptsStr} פעם אחת ביום`;
  }
  if (rule.type === 'streak') {
    const minStreak = condition?.['minStreak'];
    return minStreak ? `${ptsStr} לאחר ${minStreak} ימים ברצף` : `${ptsStr} בונוס רצף`;
  }
  if (rule.type === 'conditional') {
    const actionId = condition?.['actionId'] as string | undefined;
    const threshold = condition?.['threshold'] as number | undefined;
    const action = actions.find((a) => a.id === actionId);
    const thresholdStr = threshold !== undefined
      ? ` (סף: ${threshold}${action?.unit ? ' ' + action.unit : ''})`
      : '';
    return action ? `${ptsStr} כאשר "${action.name}"${thresholdStr}` : `${ptsStr} בהתקיים תנאי`;
  }
  return ptsStr;
}

function activationDescription(rule: GameRule): string {
  if (rule.activationType === 'after_days' && rule.activationDays) {
    return `מתחיל ביום ${rule.activationDays}`;
  }
  if (rule.activationType === 'admin_unlock') {
    return 'נדרש פתיחה ע״י מנהל';
  }
  return '';
}

// ─── Double-confirm delete modal ─────────────────────────────────────────────

function DeleteConfirmModal({
  title, warning, itemName, confirmWord, onConfirm, onClose, deleting,
}: {
  title: string;
  warning: string;
  itemName: string;
  confirmWord: string;
  onConfirm: () => void;
  onClose: () => void;
  deleting: boolean;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [typed, setTyped] = useState('');
  const isMatch = typed.trim() === confirmWord;

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 20 }}
    >
      <div style={{ background: '#fff', borderRadius: 14, padding: 28, width: '100%', maxWidth: 420, boxShadow: '0 24px 64px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div style={{ fontSize: 20, lineHeight: 1 }}>⚠️</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#94a3b8', lineHeight: 1 }}>×</button>
        </div>

        <h2 style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', margin: '0 0 8px' }}>{title}</h2>
        <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 4px', lineHeight: 1.6 }}>{warning}</p>
        <p style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', margin: '0 0 20px' }}>{itemName}</p>

        {step === 1 && (
          <>
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '12px 14px', fontSize: 13, color: '#991b1b', marginBottom: 20, lineHeight: 1.5 }}>
              פעולה זו אינה ניתנת לביטול. הנתון יוסתר מכל הממשקים.
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={onClose} style={{ background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 7, padding: '9px 18px', fontSize: 13, cursor: 'pointer' }}>ביטול</button>
              <button onClick={() => setStep(2)} style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 7, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>כן, המשך למחיקה</button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div style={{ marginBottom: 16 }}>
              <label style={{ ...labelStyle, marginBottom: 6 }}>
                כדי לאשר, הקלידי: <strong style={{ color: '#dc2626' }}>{confirmWord}</strong>
              </label>
              <input
                autoFocus
                style={{ ...inputStyle, border: isMatch ? '1px solid #16a34a' : '1px solid #cbd5e1' }}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={confirmWord}
              />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={onClose} style={{ background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 7, padding: '9px 18px', fontSize: 13, cursor: 'pointer' }}>ביטול</button>
              <button
                onClick={onConfirm}
                disabled={!isMatch || deleting}
                style={{ background: (!isMatch || deleting) ? '#fca5a5' : '#dc2626', color: '#fff', border: 'none', borderRadius: 7, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: (!isMatch || deleting) ? 'not-allowed' : 'pointer' }}
              >
                {deleting ? 'מוחק...' : 'מחק לצמיתות'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Sound preview (plays the same static WAV files as the participant portal) ─

const SOUND_OPTIONS = [
  { value: 'none',        label: 'ללא צליל' },
  { value: 'ding',        label: 'טינג' },
  { value: 'celebration', label: 'חגיגי' },
  { value: 'applause',    label: 'מחיאות כפיים' },
];

const SOUND_FILES: Record<string, string> = {
  ding:        '/sounds/purchase.wav',
  celebration: '/sounds/tada.wav',
  applause:    '/sounds/clap.wav',
};

function playSoundPreview(soundKey: string): void {
  const src = SOUND_FILES[soundKey];
  if (!src) return;
  try {
    const audio = new Audio(src);
    audio.volume = 0.85;
    audio.play().catch(() => {});
  } catch { /* fail silently */ }
}

// ─── Action Modal ─────────────────────────────────────────────────────────────

// ─── Phase 3.2: Attach reusable contexts to an action ───────────────────────
// Picker + per-use overrides (required / visibleToParticipant). Admins pick
// from the program's library (archived definitions aren't listed). No type /
// key / option editing here — those live in the library only.

function AttachedContextsSection({
  definitions,
  attached,
  onChange,
  sectionHead,
}: {
  definitions: ContextDefinition[];
  attached: AttachedContextUseDraft[];
  onChange: (next: AttachedContextUseDraft[]) => void;
  sectionHead: React.CSSProperties;
}) {
  const attachedIds = new Set(attached.map((a) => a.definitionId));
  const available = definitions.filter((d) => d.isActive && !attachedIds.has(d.id));
  const defById = new Map(definitions.map((d) => [d.id, d]));

  function patch(i: number, p: Partial<AttachedContextUseDraft>) {
    onChange(attached.map((u, idx) => (idx === i ? { ...u, ...p } : u)));
  }
  function remove(i: number) {
    onChange(attached.filter((_, idx) => idx !== i));
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= attached.length) return;
    const next = [...attached];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }
  function attach(definitionId: string) {
    if (!definitionId) return;
    onChange([
      ...attached,
      {
        definitionId,
        // null means "inherit the definition default". Admins can override per-action.
        requiredOverride: null,
        visibleToParticipantOverride: null,
      },
    ]);
  }

  return (
    <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={sectionHead}>הקשרים משותפים</div>
      <div style={{ fontSize: 12, color: '#15803d', lineHeight: 1.5 }}>
        צרפי הגדרות הקשר מהספרייה. אותו הקשר יכול להיות מצורף לפעולות רבות — הנתונים נספרים יחד באנליטיקס.
      </div>

      {attached.length === 0 && (
        <div style={{ fontSize: 12, color: '#64748b', fontStyle: 'italic' }}>
          עדיין לא צורפו הקשרים משותפים.
        </div>
      )}

      {attached.map((u, i) => {
        const def = defById.get(u.definitionId);
        if (!def) {
          // Stale reference (e.g. definition deleted mid-session).
          return (
            <div key={u.definitionId} style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: 10, fontSize: 12, color: '#b91c1c' }}>
              הגדרה לא נמצאה. <button type="button" onClick={() => remove(i)} style={{ color: '#b91c1c', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>הסירי</button>
            </div>
          );
        }
        const required = u.requiredOverride ?? def.requiredByDefault;
        const visible = u.visibleToParticipantOverride ?? def.visibleToParticipantByDefault;
        // Phase 3.3: system_fixed definitions are not participant-rendered, so
        // the required/visible overrides have no meaning here — hide them.
        const isSystemFixed = def.inputMode === 'system_fixed';
        return (
          <div key={def.id} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flexWrap: 'wrap' as const }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{def.label}</div>
                <div style={{ fontSize: 11, color: '#6b7280', whiteSpace: 'nowrap' }}>
                  {def.type === 'select' ? `בחירה · ${def.optionsJson?.length ?? 0} אפשרויות` : def.type === 'number' ? 'מספר' : 'טקסט'}
                </div>
                {isSystemFixed && (
                  <span style={{ background: '#fef3c7', color: '#92400e', fontSize: 11, padding: '2px 8px', borderRadius: 20, fontWeight: 600 }}>
                    מערכת · {def.fixedValue ?? '—'}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} style={fieldBtnStyle(i === 0)} aria-label="הזז למעלה">↑</button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === attached.length - 1} style={fieldBtnStyle(i === attached.length - 1)} aria-label="הזז למטה">↓</button>
                <button type="button" onClick={() => remove(i)} style={{ ...fieldBtnStyle(false), color: '#dc2626' }} aria-label="הסירי">×</button>
              </div>
            </div>

            {isSystemFixed && (
              <div style={{ fontSize: 12, color: '#78350f', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 6, padding: '8px 10px' }}>
                ערך זה מוזרק אוטומטית — למשתתפת לא תוצג שאלה.
              </div>
            )}

            {!isSystemFixed && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#374151', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={required}
                  onChange={(e) => patch(i, { requiredOverride: e.target.checked })}
                />
                חובה
                {u.requiredOverride === null && (
                  <span style={{ fontSize: 11, color: '#9ca3af' }}>
                    (ברירת מחדל: {def.requiredByDefault ? 'חובה' : 'לא חובה'})
                  </span>
                )}
                {u.requiredOverride !== null && (
                  <button
                    type="button"
                    onClick={() => patch(i, { requiredOverride: null })}
                    style={{ fontSize: 11, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', marginInlineStart: 4 }}
                  >
                    אפסי לברירת מחדל
                  </button>
                )}
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#374151', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={visible}
                  onChange={(e) => patch(i, { visibleToParticipantOverride: e.target.checked })}
                />
                להציג למשתתפת
                {u.visibleToParticipantOverride === null && (
                  <span style={{ fontSize: 11, color: '#9ca3af' }}>
                    (ברירת מחדל: {def.visibleToParticipantByDefault ? 'להציג' : 'מוסתר'})
                  </span>
                )}
                {u.visibleToParticipantOverride !== null && (
                  <button
                    type="button"
                    onClick={() => patch(i, { visibleToParticipantOverride: null })}
                    style={{ fontSize: 11, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', marginInlineStart: 4 }}
                  >
                    אפסי לברירת מחדל
                  </button>
                )}
              </label>
            </div>
            )}
          </div>
        );
      })}

      {available.length > 0 ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            style={{ ...inputStyle, flex: 1 }}
            value=""
            onChange={(e) => { attach(e.target.value); e.target.value = ''; }}
          >
            <option value="">+ צרפי הקשר מהספרייה...</option>
            {available.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
                {d.type === 'select' ? ` (בחירה, ${d.optionsJson?.length ?? 0} אפשרויות)` : d.type === 'number' ? ' (מספר)' : ' (טקסט)'}
              </option>
            ))}
          </select>
        </div>
      ) : attached.length === 0 ? (
        <div style={{ fontSize: 12, color: '#6b7280' }}>
          אין הקשרים משותפים זמינים. הגדירי בספרייה למעלה ואז חזרי לכאן.
        </div>
      ) : (
        <div style={{ fontSize: 12, color: '#6b7280' }}>
          כל ההקשרים הזמינים כבר מצורפים.
        </div>
      )}
    </div>
  );
}

// ─── Context builder (Phase 3) ───────────────────────────────────────────────
// Visual editor for an action's contextSchemaJson.dimensions list.
// - No JSON editing surface — only structured controls.
// - Add / edit / remove / reorder fields.
// - For type=select, manage options (value+label) inline.
// - The parent state owns `fields`; this component only mutates via onChange.

const CONTEXT_FIELD_TYPES: { value: ContextFieldType; label: string }[] = [
  { value: 'select', label: 'בחירה' },
  { value: 'text',   label: 'טקסט' },
  { value: 'number', label: 'מספר' },
];

function ContextFieldsBuilder({
  fields,
  onChange,
  sectionHead,
}: {
  fields: ContextField[];
  onChange: (next: ContextField[]) => void;
  sectionHead: React.CSSProperties;
}) {
  function patch(i: number, p: Partial<ContextField>) {
    const next = fields.map((f, idx) => (idx === i ? { ...f, ...p } : f));
    onChange(next);
  }
  function remove(i: number) {
    onChange(fields.filter((_, idx) => idx !== i));
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= fields.length) return;
    const next = [...fields];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }
  function add() {
    onChange([
      ...fields,
      {
        key: '', // auto-generated on save
        label: '',
        type: 'select',
        required: true,
        visibleToParticipant: true,
        options: [{ value: '', label: '' }],
      },
    ]);
  }
  function setOption(i: number, oi: number, p: Partial<ContextOption>) {
    const f = fields[i];
    const nextOpts = (f.options ?? []).map((o, idx) => (idx === oi ? { ...o, ...p } : o));
    patch(i, { options: nextOpts });
  }
  function addOption(i: number) {
    const f = fields[i];
    patch(i, { options: [...(f.options ?? []), { value: '', label: '' }] });
  }
  function removeOption(i: number, oi: number) {
    const f = fields[i];
    patch(i, { options: (f.options ?? []).filter((_, idx) => idx !== oi) });
  }

  return (
    <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={sectionHead}>שדות הקשר (אופציונלי)</div>
      <div style={{ fontSize: 12, color: '#1e40af', lineHeight: 1.5 }}>
        שדות נוספים שהמשתתפת תמלא בעת הדיווח. לדוגמה: ארוחה (בוקר/צהריים/ערב), מיקום, מצב רוח. השאירי ריק כדי להמשיך ללא הקשר.
      </div>

      {fields.length === 0 && (
        <div style={{ fontSize: 12, color: '#64748b', fontStyle: 'italic' }}>
          אין שדות הקשר מוגדרים.
        </div>
      )}

      {fields.map((f, i) => (
        <div
          key={i}
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>שדה {i + 1}</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                style={fieldBtnStyle(i === 0)} aria-label="הזז למעלה">↑</button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === fields.length - 1}
                style={fieldBtnStyle(i === fields.length - 1)} aria-label="הזז למטה">↓</button>
              <button type="button" onClick={() => remove(i)}
                style={{ ...fieldBtnStyle(false), color: '#dc2626' }} aria-label="מחק שדה">×</button>
            </div>
          </div>

          <div>
            <label style={miniLabelStyle}>תווית (מה המשתתפת רואה)</label>
            <input
              style={inputStyle}
              value={f.label}
              onChange={(e) => patch(i, { label: e.target.value })}
              placeholder="למשל: ארוחה"
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 10, alignItems: 'end' }}>
            <div>
              <label style={miniLabelStyle}>סוג</label>
              <select
                style={inputStyle}
                value={f.type}
                onChange={(e) => {
                  const next = e.target.value as ContextFieldType;
                  patch(i, {
                    type: next,
                    options: next === 'select' ? (f.options ?? [{ value: '', label: '' }]) : undefined,
                  });
                }}
              >
                {CONTEXT_FIELD_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#374151', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <input
                type="checkbox"
                checked={!!f.required}
                onChange={(e) => patch(i, { required: e.target.checked })}
              />
              חובה
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#374151', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <input
                type="checkbox"
                checked={f.visibleToParticipant !== false}
                onChange={(e) => patch(i, { visibleToParticipant: e.target.checked })}
              />
              להציג למשתתפת
            </label>
          </div>

          {f.type === 'select' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid #f1f5f9', paddingTop: 10 }}>
              <div style={miniLabelStyle}>אפשרויות</div>
              {(f.options ?? []).map((o, oi) => (
                // Phase 3.1: admins enter only the visible label per option.
                // Internal `value` is auto-derived from label on save (same
                // slugify pipeline as the field key). Existing option values
                // are preserved across edits so historical context data stays
                // attributable to the same option.
                <div key={oi} style={{ display: 'grid', gridTemplateColumns: '1fr 28px', gap: 6 }}>
                  <input
                    style={inputStyle}
                    value={o.label}
                    onChange={(e) => setOption(i, oi, { label: e.target.value })}
                    placeholder="תווית (בוקר)"
                  />
                  <button type="button" onClick={() => removeOption(i, oi)}
                    style={{ ...fieldBtnStyle(false), color: '#dc2626' }} aria-label="מחק אפשרות">×</button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => addOption(i)}
                style={{ background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer', alignSelf: 'flex-start' }}
              >
                + הוסיפי אפשרות
              </button>
            </div>
          )}
        </div>
      ))}

      <button
        type="button"
        onClick={add}
        style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 7, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', alignSelf: 'flex-start' }}
      >
        + הוסיפי שדה הקשר
      </button>
    </div>
  );
}

const miniLabelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  color: '#475569',
  fontWeight: 600,
  marginBottom: 4,
};

function fieldBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    width: 28,
    height: 28,
    border: '1px solid #e2e8f0',
    background: disabled ? '#f8fafc' : '#ffffff',
    color: disabled ? '#cbd5e1' : '#475569',
    borderRadius: 6,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: 14,
    fontWeight: 700,
    lineHeight: 1,
  };
}

// Attached reusable context — mutable form-state shape (overrides track null vs bool).
interface AttachedContextUseDraft {
  definitionId: string;
  requiredOverride: boolean | null;
  visibleToParticipantOverride: boolean | null;
}

function ActionModal({
  programId, action, definitions, onSaved, onClose,
}: {
  programId: string;
  action: GameAction | null;
  definitions: ContextDefinition[];
  onSaved: (a: GameAction) => void;
  onClose: () => void;
}) {
  // contextFields is part of the dirty-tracked form so that adding/removing
  // a dimension or editing an option triggers the unsaved-changes guard.
  const initialContextFields: ContextField[] =
    action?.contextSchemaJson?.dimensions?.map((d) => ({
      key: d.key,
      label: d.label,
      type: d.type,
      required: d.required ?? false,
      // Backfill: undefined on legacy rows is treated as visible (old behavior).
      visibleToParticipant: d.visibleToParticipant !== false,
      options: d.options ? d.options.map((o) => ({ value: o.value, label: o.label })) : undefined,
    })) ?? [];

  // Phase 3.2 — attached reusable contexts, ordered. Each entry holds
  // optional overrides (null = inherit definition default).
  const initialAttached: AttachedContextUseDraft[] =
    action?.contextUses?.map((u) => ({
      definitionId: u.definitionId,
      requiredOverride: u.requiredOverride,
      visibleToParticipantOverride: u.visibleToParticipantOverride,
    })) ?? [];

  const initialForm = useRef({
    name: action?.name ?? '',
    description: action?.description ?? '',
    inputType: action?.inputType ?? 'boolean',
    // Phase 6.7: base scoring strategy is the primary admin choice.
    // aggregationMode is no longer admin-set — derived server-side from
    // baseScoringType.
    baseScoringType:
      (action?.baseScoringType as
        | 'flat'
        | 'quantity_multiplier'
        | 'latest_value_flat'
        | 'latest_value_units_delta'
        | undefined) ?? 'flat',
    unit: action?.unit ?? '',
    points: String(action?.points ?? 10),
    unitSize: action?.unitSize != null ? String(action.unitSize) : '',
    basePointsPerUnit:
      action?.basePointsPerUnit != null ? String(action.basePointsPerUnit) : '',
    maxPerDay: action?.maxPerDay != null ? String(action.maxPerDay) : '',
    showInPortal: action?.showInPortal ?? true,
    blockedMessage: action?.blockedMessage ?? '',
    explanationContent: action?.explanationContent ?? '',
    soundKey: action?.soundKey ?? 'none',
    participantPrompt: action?.participantPrompt ?? '',
    participantTextPrompt: action?.participantTextPrompt ?? '',
    participantTextRequired: action?.participantTextRequired ?? false,
    contextFields: initialContextFields,
    attachedContexts: initialAttached,
  });
  const [form, setForm] = useState(initialForm.current);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showUnsaved, setShowUnsaved] = useState(false);

  function isDirty(): boolean {
    return JSON.stringify(form) !== JSON.stringify(initialForm.current);
  }

  function handleClose() {
    if (isDirty()) setShowUnsaved(true);
    else onClose();
  }

  // Derived default prompt — used as placeholder in the admin form and as
  // fallback in the portal when the admin leaves the override blank.
  const derivedPrompt =
    form.inputType === 'number' && (form.baseScoringType === 'latest_value_flat' || form.baseScoringType === 'latest_value_units_delta') ? 'כמה הגעת עד עכשיו?' :
    form.inputType === 'number' && form.baseScoringType === 'quantity_multiplier' ? 'כמה להוסיף עכשיו?' :
    'האם ביצעת פעולה זו?';
  const previewInputPrompt = form.participantPrompt.trim() || derivedPrompt;
  const previewLimit = form.maxPerDay
    ? (parseInt(form.maxPerDay) === 1 ? 'ניתן לדווח פעם אחת ביום' : `ניתן לדווח עד ${form.maxPerDay} פעמים ביום`)
    : 'ללא הגבלת דיווחים יומית';
  const previewBlockMsg = form.blockedMessage.trim() ||
    (form.maxPerDay && parseInt(form.maxPerDay) === 1
      ? 'כבר ביצעת פעולה זו היום. ניתן לדווח שוב מחר.'
      : form.maxPerDay
        ? `כבר הגעת למכסה היומית לפעולה זו (${form.maxPerDay} פעמים). ניתן לדווח שוב מחר.`
        : '');

  async function submitForm(): Promise<boolean> {
    if (!form.name.trim()) { setError('שם הוא שדה חובה'); return false; }
    const pts = parseInt(form.points);
    if (isNaN(pts) || pts < 0) { setError('נקודות חייבות להיות מספר חיובי'); return false; }

    // Phase 3.1: client-side validation. Keys are no longer admin-editable;
    // labels are the only required input. Keys get auto-generated below.
    for (const f of form.contextFields) {
      if (!f.label.trim()) { setError('כל שדה הקשר חייב תווית'); return false; }
      if (f.type === 'select') {
        if (!f.options || f.options.length === 0) {
          setError(`שדה בחירה "${f.label}" חייב לפחות אפשרות אחת`);
          return false;
        }
        const seenLabels = new Set<string>();
        for (const o of f.options) {
          if (!o.label.trim()) {
            setError(`כל אפשרות ב-"${f.label}" חייבת תווית`);
            return false;
          }
          if (seenLabels.has(o.label.trim())) {
            setError(`תווית כפולה ב-"${f.label}": "${o.label}"`);
            return false;
          }
          seenLabels.add(o.label.trim());
        }
      }
    }

    // Auto-generate keys:
    //   - existing fields keep their stored key so historical UserActionLog
    //     contextJson rows keep resolving to the same dimension.
    //   - new fields (empty key) derive a key from the label and collide-dodge
    //     against all other keys in the form.
    const keySet = new Set<string>();
    for (const f of form.contextFields) if (f.key) keySet.add(f.key);
    const fieldsWithKeys: ContextField[] = form.contextFields.map((f) => {
      if (f.key) return f;
      const base = slugifyLabel(f.label);
      const k = uniqueKey(base, keySet);
      keySet.add(k);
      return { ...f, key: k };
    });

    // Option values: auto-generate from option label when missing, keep if already set.
    const finalFields: ContextField[] = fieldsWithKeys.map((f) => {
      if (f.type !== 'select') return f;
      const opts = (f.options ?? []).map((o) => ({
        label: o.label.trim(),
        value: o.value?.trim() || slugifyLabel(o.label),
      }));
      // Dedup option values — append _2 on clashes.
      const seen = new Set<string>();
      const finalOpts = opts.map((o) => {
        const v = uniqueKey(o.value, seen);
        seen.add(v);
        return { label: o.label, value: v };
      });
      return { ...f, options: finalOpts };
    });

    setSaving(true); setError('');
    try {
      const contextSchemaJson: ContextSchemaJson | null =
        finalFields.length === 0
          ? null
          : {
              dimensions: finalFields.map((f) => ({
                key: f.key,
                label: f.label.trim(),
                type: f.type,
                required: !!f.required,
                // Phase 3.1: visibility. Default true when undefined.
                visibleToParticipant: f.visibleToParticipant !== false,
                ...(f.type === 'select' && f.options
                  ? { options: f.options }
                  : {}),
              })),
            };
      // Push generated keys back into local state so subsequent edits preserve them.
      setForm((p) => ({ ...p, contextFields: finalFields }));

      const body: Record<string, unknown> = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        inputType: form.inputType,
        // Phase 6.7: aggregationMode is SERVER-DERIVED from baseScoringType.
        // Admin only picks inputType + baseScoringType; server sets the rest.
        baseScoringType:
          form.inputType === 'number' ? form.baseScoringType : 'flat',
        unit: form.inputType === 'number' ? (form.unit.trim() || null) : null,
        points: pts,
        // Unit parameters only meaningful for the units-delta strategy.
        // Sent as null in every other shape so the backend never stores
        // stale leftover values.
        unitSize:
          form.inputType === 'number' &&
          form.baseScoringType === 'latest_value_units_delta' &&
          form.unitSize.trim()
            ? parseInt(form.unitSize)
            : null,
        basePointsPerUnit:
          form.inputType === 'number' &&
          form.baseScoringType === 'latest_value_units_delta' &&
          form.basePointsPerUnit.trim()
            ? parseInt(form.basePointsPerUnit)
            : null,
        // CRITICAL FIX: send null (not undefined) to properly clear maxPerDay in DB
        // Phase 6.9: units-delta supports multiple same-day submissions.
        // No forced maxPerDay. Whatever the admin sets flows through.
        maxPerDay: form.maxPerDay.trim() ? parseInt(form.maxPerDay) : null,
        showInPortal: form.showInPortal,
        blockedMessage: form.blockedMessage.trim() || null,
        explanationContent: form.explanationContent.trim() || null,
        soundKey: form.soundKey,
        // Phase 3.4: empty string clears the override so the portal falls back
        // to the default derived prompt.
        participantPrompt: form.participantPrompt.trim() || null,
        // Phase 4.1: empty string means "no text input rendered at all".
        participantTextPrompt: form.participantTextPrompt.trim() || null,
        // Phase 4.4: "required" only meaningful when the prompt is set.
        participantTextRequired: !!form.participantTextPrompt.trim() && form.participantTextRequired,
        // Phase 3: send null to clear, otherwise the schema object.
        contextSchemaJson,
        // Phase 3.2: replace-all reconciliation of attached reusable contexts.
        contextUses: form.attachedContexts.map((u) => ({
          definitionId: u.definitionId,
          requiredOverride: u.requiredOverride,
          visibleToParticipantOverride: u.visibleToParticipantOverride,
        })),
      };
      const url = action
        ? `${BASE_URL}/game/programs/${programId}/actions/${action.id}`
        : `${BASE_URL}/game/programs/${programId}/actions`;
      onSaved(await apiFetch(url, {
        method: action ? 'PATCH' : 'POST',
        cache: 'no-store',
        body: JSON.stringify(body),
      }) as GameAction);
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg) setError(msg);
      return false;
    } finally { setSaving(false); }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    submitForm();
  }

  const sectionHead: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase',
    letterSpacing: '0.06em', marginBottom: 12,
  };

  return (
    <>
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 20, overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 28, width: '100%', maxWidth: 500, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', margin: 0 }}>{action ? 'עריכת פעולה' : 'פעולה חדשה'}</h2>
          <button onClick={handleClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#94a3b8', lineHeight: 1 }}>×</button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* ── Identity ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={labelStyle}>שם הפעולה *</label>
              <input style={inputStyle} value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} autoFocus placeholder="לדוגמה: צ׳ק-אין יומי, שתיית מים, פעילות גופנית" />
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>השם שהמשתתפת רואה בפורטל</div>
            </div>
            <div>
              <label style={labelStyle}>תיאור (אופציונלי)</label>
              <input style={inputStyle} value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} placeholder="הסבר קצר שיוצג מתחת לשם..." />
            </div>
          </div>

          {/* ── How participant reports ── */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={sectionHead}>איך המשתתפת מדווחת?</div>
            <div>
              <label style={labelStyle}>סוג דיווח</label>
              <select style={inputStyle} value={form.inputType} onChange={(e) => {
                const nextInput = e.target.value;
                setForm((p) => ({
                  ...p,
                  inputType: nextInput,
                  // Phase 6.7: when switching to/from number, also snap the
                  // scoring strategy to a value that's valid for that input.
                  baseScoringType:
                    nextInput === 'number'
                      ? (p.baseScoringType === 'flat' ? 'latest_value_flat' : p.baseScoringType)
                      : 'flat',
                }));
              }}>
                {ACTION_INPUT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                {form.inputType === 'boolean' && 'לחצן אחד — המשתתפת מאשרת שביצעה. פשוט ומדויק.'}
                {form.inputType === 'number' && 'המשתתפת מזינה ערך מספרי — שלבים, דקות, כוסות מים...'}
                {form.inputType === 'select' && 'המשתתפת בוחרת מרשימת אפשרויות שתגדיר'}
              </div>
            </div>

            {form.inputType === 'number' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, borderTop: '1px solid #e2e8f0', paddingTop: 14 }}>
                {/* Phase 6.7: explicit base scoring strategy. Replaces the
                    old aggregationMode radio. Admin picks ONE way points
                    are computed; server derives aggregationMode from it.
                    Wording is product-level (not engineering). */}
                <div>
                  <label style={labelStyle}>איך מחושבות הנקודות?</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                    {([
                      {
                        value: 'latest_value_flat',
                        label: 'נקודות קבועות לפי סה״כ שוטף',
                        desc: 'המשתתפת מדווחת כמה יש לה עד עכשיו. כל דיווח תקין מזכה בנקודות קבועות. לא ניתן לרדת.',
                        example: 'דוגמה: "הגעת ל-7,500?" → 10 נק׳ לכל דיווח',
                      },
                      {
                        value: 'latest_value_units_delta',
                        label: 'נקודות לפי יחידות התקדמות',
                        desc: 'כל יחידה שלמה של התקדמות מזכה בנקודות. רק הדלתא לעומת הסה״כ הקודם מזכה. מתאים למעקב התקדמות לפי יחידות (כל X יחידות = Y נקודות).',
                        example: 'דוגמה: גודל יחידה 1000, נקודות ליחידה 15 → דיווח 15,304 = 15 יחידות × 15 = 225 נק׳',
                      },
                      {
                        value: 'quantity_multiplier',
                        label: 'נקודות לפי כמות',
                        desc: 'המשתתפת מדווחת כמה עשתה עכשיו. הדיווחים מצטרפים לסכום היומי. נקודות = נקודות לכל יחידה × הכמות שדווחה.',
                        example: 'דוגמה: 5 נק׳ לכוס × 2 כוסות = 10 נק׳',
                      },
                    ] as const).map((opt) => {
                      const selected = form.baseScoringType === opt.value;
                      return (
                        <label key={opt.value} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', padding: '10px 12px', border: `1.5px solid ${selected ? '#2563eb' : '#e2e8f0'}`, borderRadius: 8, background: selected ? '#eff6ff' : '#fff' }}>
                          <input
                            type="radio"
                            name="baseScoringType"
                            value={opt.value}
                            checked={selected}
                            onChange={() => setForm((p) => ({ ...p, baseScoringType: opt.value }))}
                            style={{ marginTop: 3, flexShrink: 0 }}
                          />
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{opt.label}</div>
                            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2, lineHeight: 1.5 }}>{opt.desc}</div>
                            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2, fontStyle: 'italic' }}>{opt.example}</div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <label style={labelStyle}>יחידת מידה (אופציונלי)</label>
                  <input style={inputStyle} value={form.unit} onChange={(e) => setForm((p) => ({ ...p, unit: e.target.value }))} placeholder="צעדים · קומות · דקות · כוסות · ק״מ" />
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>מוצגת בפורטל וברשימת החוקים</div>
                </div>
                {/* Phase 6.7: unit-delta parameters. Shown ONLY for the
                    matching scoring type, never as an optional side-panel. */}
                {form.baseScoringType === 'latest_value_units_delta' && (
                  <div style={{ background: '#ffffff', border: '1px solid #bfdbfe', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#1d4ed8' }}>
                      פרמטרים לחישוב לפי יחידות התקדמות
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <div>
                        <label style={labelStyle}>גודל יחידה</label>
                        <input
                          type="number"
                          min={1}
                          style={{ ...inputStyle, direction: 'ltr' }}
                          value={form.unitSize}
                          onChange={(e) => setForm((p) => ({ ...p, unitSize: e.target.value }))}
                          placeholder="למשל: 1000"
                        />
                        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                          כל X {form.unit?.trim() || 'יחידות'} נחשבות יחידה אחת
                        </div>
                      </div>
                      <div>
                        <label style={labelStyle}>נקודות ליחידה</label>
                        <input
                          type="number"
                          min={0}
                          style={{ ...inputStyle, direction: 'ltr' }}
                          value={form.basePointsPerUnit}
                          onChange={(e) => setForm((p) => ({ ...p, basePointsPerUnit: e.target.value }))}
                          placeholder="למשל: 15"
                        />
                        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                          נקודות שמזכה כל יחידה מלאה
                        </div>
                      </div>
                    </div>
                    {form.unitSize.trim() && form.basePointsPerUnit.trim() && parseInt(form.unitSize) > 0 && (
                      <div style={{ fontSize: 11, color: '#2563eb', fontStyle: 'italic' }}>
                        דוגמה: דיווח {(parseInt(form.unitSize) * 15 + 304).toLocaleString('he-IL')} → {Math.floor((parseInt(form.unitSize) * 15 + 304) / parseInt(form.unitSize))} יחידות × {form.basePointsPerUnit} = {Math.floor((parseInt(form.unitSize) * 15 + 304) / parseInt(form.unitSize)) * parseInt(form.basePointsPerUnit)} נק׳
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: '#1e40af', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 6, padding: '6px 10px', lineHeight: 1.5 }}>
                      נקודות מוענקות רק על יחידות מלאות חדשות מעבר לסה״כ הקודם באותו יום. ניתן לדווח כמה פעמים ביום — כל דיווח יוסיף רק את ההפרש. תיקונים ומחיקות מחשבים מחדש את כל השרשרת היומית כדי שהתוצאה תישאר מדויקת.
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Scoring ── */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={sectionHead}>ניקוד והגבלות</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>נקודות לכל דיווח *</label>
                <input type="number" min={0} style={{ ...inputStyle, direction: 'ltr' }} value={form.points} onChange={(e) => setForm((p) => ({ ...p, points: e.target.value }))} />
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>כמה נקודות מרוויחים בכל דיווח</div>
              </div>
              <div>
                <label style={labelStyle}>מגבלה יומית</label>
                <input type="number" min={1} style={{ ...inputStyle, direction: 'ltr' }} value={form.maxPerDay} onChange={(e) => setForm((p) => ({ ...p, maxPerDay: e.target.value }))} placeholder="ללא הגבלה" />
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                  {form.maxPerDay ? `המשתתפת תיחסם לאחר ${form.maxPerDay} דיווחים ביום` : 'ריק = ניתן לדווח ללא הגבלה'}
                </div>
              </div>
            </div>

            {form.maxPerDay && (
              <div>
                <label style={labelStyle}>הודעה כשמגיעים למגבלה (אופציונלי)</label>
                <input
                  style={inputStyle}
                  value={form.blockedMessage}
                  onChange={(e) => setForm((p) => ({ ...p, blockedMessage: e.target.value }))}
                  placeholder={previewBlockMsg}
                />
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                  ריק = ייעשה שימוש בהודעת ברירת מחדל (מוצג למטה)
                </div>
              </div>
            )}

            {/* Phase 3.4: per-action participant prompt override. Placeholder
                shows the auto-derived default so admins know what they're
                replacing if left blank. */}
            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 14 }}>
              <label style={labelStyle}>השאלה למשתתפת</label>
              <input
                style={inputStyle}
                value={form.participantPrompt}
                onChange={(e) => setForm((p) => ({ ...p, participantPrompt: e.target.value }))}
                placeholder={derivedPrompt}
                maxLength={120}
              />
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                השאלה שתופיע למשתתפת בעת הדיווח. ריק = ייעשה שימוש בברירת המחדל.
              </div>
            </div>

            {/* Phase 4.1: optional action-level free-text question. When set,
                the portal renders a short text input below the main submission
                input. The value appears in drill-down + feed but never in
                analytics aggregation (it's not a dimension).
                Phase 4.4: "required" checkbox shown only when a prompt is set. */}
            <div>
              <label style={labelStyle}>שדה טקסט נוסף למשתתפת (אופציונלי)</label>
              <input
                style={inputStyle}
                value={form.participantTextPrompt}
                onChange={(e) => setForm((p) => ({ ...p, participantTextPrompt: e.target.value }))}
                placeholder="למשל: מה היה הפיתוי?"
                maxLength={120}
              />
              {form.participantTextPrompt.trim() && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#374151', cursor: 'pointer', marginTop: 8 }}>
                  <input
                    type="checkbox"
                    checked={form.participantTextRequired}
                    onChange={(e) => setForm((p) => ({ ...p, participantTextRequired: e.target.checked }))}
                  />
                  חובה למילוי
                </label>
              )}
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                אם מוגדר — יופיע שדה טקסט קצר מתחת לבחירה. המידע מוצג במבזק ובפירוט היום, לא באנליטיקות.
              </div>
            </div>
          </div>

          {/* ── Visibility ── */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 16 }}>
            <div style={sectionHead}>נראות בפורטל המשתתפות</div>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={form.showInPortal}
                onChange={(e) => setForm((p) => ({ ...p, showInPortal: e.target.checked }))}
                style={{ marginTop: 3, width: 16, height: 16, flexShrink: 0 }}
              />
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>
                  {form.showInPortal ? 'מוצג לכל המשתתפות' : 'מוסתר מהמשתתפות'}
                </div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 2, lineHeight: 1.5 }}>
                  {form.showInPortal
                    ? 'הפעולה מופיעה בפורטל ומשתתפות יכולות לדווח עליה.'
                    : 'הפעולה מוסתרת מהפורטל. ניתן לדווח עליה רק ע״י מנהל. הפעולה נשמרת במערכת.'}
                </div>
              </div>
            </label>
          </div>

          {/* ── Sound feedback ── */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={sectionHead}>הצליל שיושמע</div>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 2 }}>
              הצליל שיושמע בפורטל המשתתפת לאחר דיווח מוצלח
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <select
                style={{ ...inputStyle, flex: 1 }}
                value={form.soundKey}
                onChange={(e) => setForm((p) => ({ ...p, soundKey: e.target.value }))}
              >
                {SOUND_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              {form.soundKey !== 'none' && (
                <button
                  type="button"
                  onClick={() => playSoundPreview(form.soundKey)}
                  title="השמע צליל"
                  style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 7, padding: '7px 12px', fontSize: 13, cursor: 'pointer', color: '#1d4ed8', flexShrink: 0 }}
                >
                  ▶ נגן
                </button>
              )}
            </div>
          </div>

          {/* ── Explanation content (rules tab) ── */}
          <div style={{ background: '#fefce8', border: '1px solid #fde68a', borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.06em' }}>הסבר מורחב לטאב חוקים</div>
            <div style={{ fontSize: 12, color: '#78350f', lineHeight: 1.5 }}>
              תוכן זה מוצג בטאב &ldquo;חוקים&rdquo; בפורטל — מתחת לשם הפעולה ולנקודות. מקום לתת הסבר מפורט, טיפים, דוגמאות.
            </div>
            <RichContentEditor
              value={form.explanationContent}
              onChange={(v) => setForm((p) => ({ ...p, explanationContent: v }))}
              placeholder="הוסיפי הסבר, טיפים, דוגמאות לפעולה זו..."
              minHeight={120}
            />
          </div>

          {/* ── Phase 3.2: Attached reusable contexts ── */}
          <AttachedContextsSection
            definitions={definitions}
            attached={form.attachedContexts}
            onChange={(next) => setForm((p) => ({ ...p, attachedContexts: next }))}
            sectionHead={sectionHead}
          />

          {/* ── Context fields (Phase 3) — local-only, backward compat ── */}
          {/* Keep using for action-specific dimensions that don't warrant a
              reusable definition. New shared dimensions should go in the
              library above instead. */}
          <ContextFieldsBuilder
            fields={form.contextFields}
            onChange={(next) => setForm((p) => ({ ...p, contextFields: next }))}
            sectionHead={sectionHead}
          />

          {/* ── Participant-facing preview ── */}
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#15803d', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
              תצוגת משתתפת — כך ייראה בפורטל
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={{ fontSize: 13, color: '#374151' }}>
                <strong>פעולה:</strong> {form.name || '(שם הפעולה)'}
              </div>
              {form.description && (
                <div style={{ fontSize: 12, color: '#6b7280' }}>
                  <strong>תיאור:</strong> {form.description}
                </div>
              )}
              <div style={{ fontSize: 12, color: '#374151' }}>
                <strong>שאלה למשתתפת:</strong> {previewInputPrompt}
              </div>
              <div style={{ fontSize: 12, color: form.maxPerDay ? '#c2410c' : '#6b7280' }}>
                <strong>מגבלה:</strong> {previewLimit}
              </div>
              {!form.showInPortal && (
                <div style={{ fontSize: 12, color: '#dc2626', fontWeight: 600, marginTop: 2 }}>
                  ⚠️ פעולה זו מוסתרת — לא תופיע לפנני משתתפות
                </div>
              )}
              {form.maxPerDay && (
                <div style={{ fontSize: 12, color: '#6b7280', fontStyle: 'italic', marginTop: 2 }}>
                  <strong>הודעת חסימה:</strong> &ldquo;{previewBlockMsg}&rdquo;
                </div>
              )}
            </div>
          </div>

          {error && <div style={{ color: '#dc2626', fontSize: 13, background: '#fef2f2', padding: '8px 12px', borderRadius: 7 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" onClick={handleClose} style={{ background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 7, padding: '9px 18px', fontSize: 13, cursor: 'pointer' }}>ביטול</button>
            <button type="submit" disabled={saving} style={{ background: saving ? '#93c5fd' : '#2563eb', color: '#fff', border: 'none', borderRadius: 7, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer' }}>
              {saving ? 'שומר...' : 'שמירה'}
            </button>
          </div>
        </form>
      </div>
    </div>

    {/* ── Unsaved-changes confirmation ── */}
    {showUnsaved && (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div style={{ background: '#fff', borderRadius: 12, padding: 24, maxWidth: 320, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: '0 0 8px' }}>שינויים לא שמורים</h3>
          <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 20px', lineHeight: 1.5 }}>יש שינויים שעדיין לא נשמרו. מה לעשות?</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              disabled={saving}
              onClick={async () => { const ok = await submitForm(); if (ok) setShowUnsaved(false); }}
              style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 7, padding: '10px 16px', fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', textAlign: 'center' as const }}
            >
              {saving ? 'שומר...' : 'שמור ויצא'}
            </button>
            <button
              onClick={() => { setShowUnsaved(false); onClose(); }}
              style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 7, padding: '10px 16px', fontSize: 13, cursor: 'pointer', textAlign: 'center' as const }}
            >
              בטל שינויים
            </button>
            <button
              onClick={() => setShowUnsaved(false)}
              style={{ background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 7, padding: '10px 16px', fontSize: 13, cursor: 'pointer', textAlign: 'center' as const }}
            >
              המשך עריכה
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

// ─── Rule Modal ───────────────────────────────────────────────────────────────

function RuleModal({
  programId, rule, actions, onSaved, onClose,
}: {
  programId: string;
  rule: GameRule | null;
  actions: GameAction[];
  onSaved: (r: GameRule) => void;
  onClose: () => void;
}) {
  const initCondition = rule?.conditionJson as Record<string, unknown> | null;
  const initReward = rule?.rewardJson as Record<string, unknown> | null;

  const initial = useRef({
    name: rule?.name ?? '',
    type: rule?.type ?? 'daily_bonus',
    activationType: rule?.activationType ?? 'immediate',
    activationDays: String(rule?.activationDays ?? ''),
    requiresAdminApproval: rule?.requiresAdminApproval ?? false,
    rewardPoints: String(initReward?.['points'] ?? 10),
    minStreak: String(initCondition?.['minStreak'] ?? '7'),
    conditionActionId: String(initCondition?.['actionId'] ?? ''),
    threshold: String(initCondition?.['threshold'] ?? ''),
    conditionJson: rule?.conditionJson ? JSON.stringify(rule.conditionJson, null, 2) : '{}',
    rewardJson: rule?.rewardJson ? JSON.stringify(rule.rewardJson, null, 2) : '{"points":10}',
  });

  const [name, setName] = useState(initial.current.name);
  const [type, setType] = useState(initial.current.type);
  const [activationType, setActivationType] = useState(initial.current.activationType);
  const [activationDays, setActivationDays] = useState(initial.current.activationDays);
  const [requiresAdminApproval, setRequiresAdminApproval] = useState(initial.current.requiresAdminApproval);
  const [rewardPoints, setRewardPoints] = useState(initial.current.rewardPoints);
  const [minStreak, setMinStreak] = useState(initial.current.minStreak);
  const [conditionActionId, setConditionActionId] = useState(initial.current.conditionActionId);
  const [threshold, setThreshold] = useState(initial.current.threshold);
  const [advancedMode, setAdvancedMode] = useState(false);
  const [conditionJson, setConditionJson] = useState(initial.current.conditionJson);
  const [rewardJson, setRewardJson] = useState(initial.current.rewardJson);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showUnsaved, setShowUnsaved] = useState(false);

  function isDirty(): boolean {
    return (
      name !== initial.current.name ||
      type !== initial.current.type ||
      activationType !== initial.current.activationType ||
      activationDays !== initial.current.activationDays ||
      requiresAdminApproval !== initial.current.requiresAdminApproval ||
      rewardPoints !== initial.current.rewardPoints ||
      minStreak !== initial.current.minStreak ||
      conditionActionId !== initial.current.conditionActionId ||
      threshold !== initial.current.threshold ||
      conditionJson !== initial.current.conditionJson ||
      rewardJson !== initial.current.rewardJson
    );
  }

  function handleClose() {
    if (isDirty()) setShowUnsaved(true);
    else onClose();
  }

  function buildJsonFromUI(): { cond: Record<string, unknown>; reward: Record<string, unknown> } {
    const pts = parseInt(rewardPoints) || 0;
    const reward = { points: pts };
    let cond: Record<string, unknown> = {};
    if (type === 'streak') cond = { minStreak: parseInt(minStreak) || 7 };
    if (type === 'conditional') {
      cond = { actionId: conditionActionId };
      const selectedAction = actions.find((a) => a.id === conditionActionId);
      if (threshold && selectedAction?.inputType === 'number') {
        const t = parseInt(threshold);
        if (!isNaN(t) && t > 0) cond.threshold = t;
      }
    }
    return { cond, reward };
  }

  // Live human-readable summary
  function buildSummary(): string {
    const pts = parseInt(rewardPoints);
    const ptsStr = isNaN(pts) ? '?' : `${pts}`;
    if (type === 'daily_bonus') return `בכל יום שיש דיווח → ${ptsStr} נקודות (פעם אחת ביום)`;
    if (type === 'streak') {
      const s = parseInt(minStreak) || '?';
      return `כשמגיעים ל-${s} ימים ברצף → ${ptsStr} נקודות`;
    }
    if (type === 'conditional') {
      const act = actions.find((a) => a.id === conditionActionId);
      const actName = act ? `"${act.name}"` : '(בחרי פעולה)';
      if (threshold && act?.inputType === 'number') {
        const unit = act.unit ? ` ${act.unit}` : '';
        return `כשהסה״כ היומי של ${actName} מגיע ל-${threshold}${unit} → ${ptsStr} נקודות`;
      }
      return `בכל דיווח על ${actName} → ${ptsStr} נקודות (פעם אחת ביום)`;
    }
    return '';
  }

  async function submitForm(): Promise<boolean> {
    if (!name.trim()) { setError('שם הוא שדה חובה'); return false; }

    let conditionJsonParsed: Record<string, unknown>;
    let rewardJsonParsed: Record<string, unknown>;

    if (advancedMode) {
      try { conditionJsonParsed = JSON.parse(conditionJson); } catch { setError('תנאי JSON שגוי'); return false; }
      try { rewardJsonParsed = JSON.parse(rewardJson); } catch { setError('פרס JSON שגוי'); return false; }
    } else {
      const { cond, reward } = buildJsonFromUI();
      conditionJsonParsed = cond;
      rewardJsonParsed = reward;
    }

    setSaving(true); setError('');
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        type,
        activationType,
        activationDays: activationDays ? parseInt(activationDays) : undefined,
        requiresAdminApproval,
        conditionJson: conditionJsonParsed,
        rewardJson: rewardJsonParsed,
      };
      const url = rule
        ? `${BASE_URL}/game/programs/${programId}/rules/${rule.id}`
        : `${BASE_URL}/game/programs/${programId}/rules`;
      onSaved(await apiFetch(url, {
        method: rule ? 'PATCH' : 'POST',
        cache: 'no-store',
        body: JSON.stringify(body),
      }) as GameRule);
      return true;
    } catch {
      return false;
    } finally { setSaving(false); }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    submitForm();
  }

  const sectionHead: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase',
    letterSpacing: '0.06em', marginBottom: 12,
  };

  const selectedAction = actions.find((a) => a.id === conditionActionId);
  const isNumeric = selectedAction?.inputType === 'number';
  const summary = buildSummary();

  return (
    <>
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 28, width: '100%', maxWidth: 520, maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', margin: 0 }}>{rule ? 'עריכת חוק' : 'חוק בונוס חדש'}</h2>
          <button onClick={handleClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#94a3b8', lineHeight: 1 }}>×</button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* ── Name ── */}
          <div>
            <label style={labelStyle}>שם החוק *</label>
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="לדוגמה: בונוס רצף שבועי" />
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>שם לזיהוי פנימי בלבד — לא מוצג למשתתפות</div>
          </div>

          {/* ── Trigger ── */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={sectionHead}>מה מפעיל את הבונוס?</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { value: 'daily_bonus', icon: '☀️', label: 'בונוס יומי', desc: 'מעניק נקודות פעם אחת בכל יום שבו יש דיווח כלשהו' },
                { value: 'streak',      icon: '🔥', label: 'בונוס רצף',  desc: 'מעניק נקודות כשמשתתפת מגיעה לרצף ימים רצופים' },
                { value: 'conditional', icon: '⚡', label: 'פעולה ספציפית', desc: 'מעניק נקודות כשמשתתפת מדווחת על פעולה מסוימת (עם אפשרות סף מספרי)' },
              ].map((t) => (
                <label key={t.value} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px', border: `1.5px solid ${type === t.value ? '#2563eb' : '#e2e8f0'}`, borderRadius: 8, cursor: 'pointer', background: type === t.value ? '#eff6ff' : '#fff' }}>
                  <input type="radio" name="ruleType" value={t.value} checked={type === t.value} onChange={() => setType(t.value)} style={{ marginTop: 3 }} />
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{t.icon} {t.label}</div>
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{t.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* ── Condition (only shown in normal mode) ── */}
          {!advancedMode && (
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={sectionHead}>פרטי התנאי</div>

              {type === 'daily_bonus' && (
                <div style={{ fontSize: 14, color: '#374151', lineHeight: 1.6 }}>
                  ✅ אין מה להגדיר — הבונוס יופעל אוטומטית פעם אחת בכל יום שבו יש דיווח כלשהו.
                </div>
              )}

              {type === 'streak' && (
                <div>
                  <label style={labelStyle}>מינימום ימים ברצף לקבלת הבונוס</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input type="number" min={1} style={{ ...inputStyle, width: 100, direction: 'ltr' }} value={minStreak} onChange={(e) => setMinStreak(e.target.value)} />
                    <span style={{ fontSize: 14, color: '#64748b' }}>ימים רצופים</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6, lineHeight: 1.5 }}>
                    הבונוס יינתן כשהמשתתפת מדווחת ביום ה-{minStreak || 'N'} ברצף (ומעלה). פעם אחת ביום.
                  </div>
                </div>
              )}

              {type === 'conditional' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div>
                    <label style={labelStyle}>פעולה שמפעילה את הבונוס</label>
                    {actions.filter((a) => a.isActive).length === 0 ? (
                      <div style={{ fontSize: 13, color: '#94a3b8', fontStyle: 'italic' }}>יש להוסיף פעולות תחילה</div>
                    ) : (
                      <select style={inputStyle} value={conditionActionId} onChange={(e) => { setConditionActionId(e.target.value); setThreshold(''); }}>
                        <option value="">— בחרי פעולה —</option>
                        {actions.filter((a) => a.isActive).map((a) => (
                          <option key={a.id} value={a.id}>{a.name}{a.unit ? ` (${a.unit})` : ''}</option>
                        ))}
                      </select>
                    )}
                    {conditionActionId && (
                      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                        {isNumeric ? 'פעולה מספרית — ניתן להגדיר סף ערך יומי למטה' : 'הבונוס יינתן פעם אחת ביום בכל דיווח על הפעולה הנבחרת'}
                      </div>
                    )}
                  </div>

                  {isNumeric && (
                    <div>
                      <label style={labelStyle}>סף ערך יומי (אופציונלי)</label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <input
                          type="number" min={1}
                          style={{ ...inputStyle, width: 130, direction: 'ltr' }}
                          value={threshold}
                          onChange={(e) => setThreshold(e.target.value)}
                          placeholder="לדוגמה: 5000"
                        />
                        {selectedAction?.unit && (
                          <span style={{ fontSize: 14, color: '#64748b' }}>{selectedAction.unit}</span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: '#64748b', marginTop: 6, lineHeight: 1.6, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 7, padding: '8px 10px' }}>
                        💡 <strong>איך עובד סולם תגמול:</strong> צרי כמה חוקים לאותה פעולה עם ספים עולים (3000, 5000, 10000).
                        הנקודות שתגדירי הן <strong>הסה״כ הצבור לרמה הזו</strong> — המערכת מעניקה רק את ההפרש. לדוגמה: רמה א׳=10 נק׳, רמה ב׳=20 נק׳ → כשמגיעים לרמה ב׳ מקבלים עוד 10 בלבד.
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Reward */}
              <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 14 }}>
                <label style={labelStyle}>נקודות בונוס שיינתנו</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input type="number" min={0} style={{ ...inputStyle, width: 110, direction: 'ltr' }} value={rewardPoints} onChange={(e) => setRewardPoints(e.target.value)} />
                  <span style={{ fontSize: 14, color: '#64748b' }}>נקודות</span>
                </div>
                {type === 'conditional' && threshold && (
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                    סה״כ מצטבר לרמה זו — המערכת תעניק רק את ההפרש
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Live summary ── */}
          {!advancedMode && summary && (
            <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '10px 14px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#1d4ed8', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>תקציר החוק</div>
              <div style={{ fontSize: 14, color: '#1e40af', fontWeight: 500 }}>{summary}</div>
            </div>
          )}

          {/* ── When does it start ── */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={sectionHead}>מתי החוק מתחיל לפעול?</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { value: 'immediate',    label: 'מיד מתחילת התוכנית', desc: 'בתוקף מהיום הראשון' },
                { value: 'after_days',   label: 'רק אחרי כמה ימים', desc: 'מאפשר להפעיל חוקים מאוחרים יותר' },
                { value: 'admin_unlock', label: 'רק אחרי פתיחה ידנית', desc: 'מנהל מפעיל ידנית לכל קבוצה' },
              ].map((t) => (
                <label key={t.value} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14, color: '#374151' }}>
                  <input type="radio" name="activationType" value={t.value} checked={activationType === t.value} onChange={() => setActivationType(t.value)} />
                  <div>
                    <span style={{ fontWeight: 500 }}>{t.label}</span>
                    <span style={{ fontSize: 12, color: '#94a3b8', marginRight: 6 }}>— {t.desc}</span>
                  </div>
                </label>
              ))}
            </div>
            {activationType === 'after_days' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
                <input type="number" min={1} style={{ ...inputStyle, width: 100, direction: 'ltr' }} value={activationDays} onChange={(e) => setActivationDays(e.target.value)} placeholder="7" />
                <span style={{ fontSize: 14, color: '#64748b' }}>ימים מתחילת הקבוצה</span>
              </div>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14, color: '#374151', marginTop: 4 }}>
              <input type="checkbox" checked={requiresAdminApproval} onChange={(e) => setRequiresAdminApproval(e.target.checked)} style={{ width: 15, height: 15 }} />
              <div>
                <span style={{ fontWeight: 500 }}>דורש אישור מנהל לכל קבוצה</span>
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 1 }}>כשמסומן, על המנהל לפתוח ידנית לכל קבוצה דרך ניהול קבוצה</div>
              </div>
            </label>
          </div>

          {/* Advanced mode */}
          <button
            type="button"
            onClick={() => {
              if (!advancedMode) {
                const { cond, reward } = buildJsonFromUI();
                setConditionJson(JSON.stringify(cond, null, 2));
                setRewardJson(JSON.stringify(reward, null, 2));
              }
              setAdvancedMode((v) => !v);
            }}
            style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 12, cursor: 'pointer', textAlign: 'right', padding: 0, textDecoration: 'underline' }}
          >
            {advancedMode ? '▲ חזור לעורך הרגיל' : '▼ מצב מתקדם (JSON — למפתחים)'}
          </button>

          {advancedMode && (
            <div style={{ background: '#1e293b', borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 12, color: '#f59e0b', fontWeight: 600 }}>⚠️ מצב מתקדם — שנה רק אם ידוע מה עושים</div>
              <div>
                <label style={{ ...labelStyle, color: '#94a3b8', fontSize: 12 }}>conditionJson</label>
                <textarea rows={3} style={{ ...inputStyle, direction: 'ltr', fontFamily: 'monospace', fontSize: 12, resize: 'vertical', background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155' }} value={conditionJson} onChange={(e) => setConditionJson(e.target.value)} />
              </div>
              <div>
                <label style={{ ...labelStyle, color: '#94a3b8', fontSize: 12 }}>rewardJson</label>
                <textarea rows={3} style={{ ...inputStyle, direction: 'ltr', fontFamily: 'monospace', fontSize: 12, resize: 'vertical', background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155' }} value={rewardJson} onChange={(e) => setRewardJson(e.target.value)} />
              </div>
            </div>
          )}

          {error && <div style={{ color: '#dc2626', fontSize: 13, background: '#fef2f2', padding: '8px 12px', borderRadius: 7 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" onClick={handleClose} style={{ background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 7, padding: '9px 18px', fontSize: 13, cursor: 'pointer' }}>ביטול</button>
            <button type="submit" disabled={saving} style={{ background: saving ? '#93c5fd' : '#2563eb', color: '#fff', border: 'none', borderRadius: 7, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer' }}>
              {saving ? 'שומר...' : 'שמירה'}
            </button>
          </div>
        </form>
      </div>
    </div>

    {/* ── Unsaved-changes confirmation ── */}
    {showUnsaved && (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div style={{ background: '#fff', borderRadius: 12, padding: 24, maxWidth: 320, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: '0 0 8px' }}>שינויים לא שמורים</h3>
          <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 20px', lineHeight: 1.5 }}>יש שינויים שעדיין לא נשמרו. מה לעשות?</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              disabled={saving}
              onClick={async () => { const ok = await submitForm(); if (ok) setShowUnsaved(false); }}
              style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 7, padding: '10px 16px', fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', textAlign: 'center' as const }}
            >
              {saving ? 'שומר...' : 'שמור ויצא'}
            </button>
            <button
              onClick={() => { setShowUnsaved(false); onClose(); }}
              style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 7, padding: '10px 16px', fontSize: 13, cursor: 'pointer', textAlign: 'center' as const }}
            >
              בטל שינויים
            </button>
            <button
              onClick={() => setShowUnsaved(false)}
              style={{ background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 7, padding: '10px 16px', fontSize: 13, cursor: 'pointer', textAlign: 'center' as const }}
            >
              המשך עריכה
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}


// ─── Game Engine Tab ──────────────────────────────────────────────────────────

// ─── Phase 4.3: Centralized analytics groups section ───────────────────────
// Inline CRUD for AnalyticsGroup. Label-only entity; admins create groups once
// and then pick them from the dropdown inside each context definition. Delete
// is refused server-side when a group is in use — we surface the count on
// each row so the admin knows when it's safe to delete.

function AnalyticsGroupsSection({
  programId,
  groups,
  definitions,
  onChanged,
}: {
  programId: string;
  groups: AnalyticsGroup[];
  // Phase 4.5: the full library, so each group row can render its members
  // and the "+ הוסף הקשר" picker can offer currently-unassigned contexts.
  // Only participant-visible + analytics-visible contexts are attachable
  // — hidden / non-analytics ones wouldn't show up in the participant UI
  // anyway, so offering them would be misleading.
  definitions: ContextDefinition[];
  onChanged: () => Promise<void> | void;
}) {
  const [draftLabel, setDraftLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Per-group "picking a new member" state — which group is currently showing
  // its attach dropdown open.
  const [attachingGroupId, setAttachingGroupId] = useState<string | null>(null);

  async function create() {
    const label = draftLabel.trim();
    if (!label) { setError('יש להזין שם קבוצה'); return; }
    setBusy(true); setError('');
    try {
      await apiFetch(`${BASE_URL}/game/programs/${programId}/analytics-groups`, {
        method: 'POST',
        cache: 'no-store',
        body: JSON.stringify({ label }),
      });
      setDraftLabel('');
      setCreating(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה ביצירת קבוצה');
    } finally { setBusy(false); }
  }

  async function saveEdit(id: string) {
    const label = editingLabel.trim();
    if (!label) { setError('שם הקבוצה לא יכול להיות ריק'); return; }
    setBusy(true); setError('');
    try {
      await apiFetch(`${BASE_URL}/game/programs/${programId}/analytics-groups/${id}`, {
        method: 'PATCH',
        cache: 'no-store',
        body: JSON.stringify({ label }),
      });
      setEditingId(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בעדכון');
    } finally { setBusy(false); }
  }

  async function remove(g: AnalyticsGroup) {
    if (g.memberCount > 0) {
      setError(`לא ניתן למחוק — הקבוצה בשימוש ב-${g.memberCount} הקשרים. בטלי קודם את השיוך.`);
      return;
    }
    if (!confirm(`למחוק את הקבוצה "${g.label}"?`)) return;
    setBusy(true); setError('');
    try {
      await apiFetch(`${BASE_URL}/game/programs/${programId}/analytics-groups/${g.id}`, {
        method: 'DELETE',
        cache: 'no-store',
      });
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה במחיקה');
    } finally { setBusy(false); }
  }

  // Phase 4.5: attach/detach via the existing context-definitions PATCH
  // endpoint — we just flip analyticsGroupId. Keeps the backend flat (no new
  // route). On success, refresh both groups (member-count) and definitions
  // (group assignment) in the parent.
  // Phase 4.7: surface backend errors verbatim. `apiFetch` throws a plain
  // `{ status, message }` object on non-OK, which is NOT `instanceof Error`,
  // so the previous `e instanceof Error ? e.message : ...` path always showed
  // the generic message and hid the real cause. Extract `.message` defensively.
  function extractApiError(e: unknown, fallback: string): string {
    if (e && typeof e === 'object' && 'message' in e) {
      const m = (e as { message?: unknown }).message;
      if (typeof m === 'string' && m.length > 0) return m;
    }
    if (e instanceof Error) return e.message;
    return fallback;
  }

  async function attachContextToGroup(definitionId: string, groupId: string) {
    setBusy(true); setError('');
    try {
      await apiFetch(`${BASE_URL}/game/programs/${programId}/context-definitions/${definitionId}`, {
        method: 'PATCH',
        cache: 'no-store',
        body: JSON.stringify({ analyticsGroupId: groupId }),
      });
      setAttachingGroupId(null);
      await onChanged();
    } catch (e) {
      setError(extractApiError(e, 'שגיאה בחיבור הקשר'));
    } finally { setBusy(false); }
  }

  async function detachContextFromGroup(definitionId: string) {
    setBusy(true); setError('');
    try {
      await apiFetch(`${BASE_URL}/game/programs/${programId}/context-definitions/${definitionId}`, {
        method: 'PATCH',
        cache: 'no-store',
        body: JSON.stringify({ analyticsGroupId: '' }),
      });
      await onChanged();
    } catch (e) {
      setError(extractApiError(e, 'שגיאה בהסרת הקשר'));
    } finally { setBusy(false); }
  }

  // Eligible contexts = any active context that isn't already in THIS group.
  //
  // Phase 4.8 (audit fix): the previous `d.type !== 'text'` filter silently
  // excluded every hidden/system context, because the simplified Phase 4.2
  // model stores `visibleByDefault=false` contexts with `type='text'` —
  // exactly the contexts admins want to bundle under a parent group. The
  // aggregation layer now skips system-fixed members on its own, so the
  // picker no longer needs to second-guess which contexts are groupable.
  function eligibleForGroup(g: AnalyticsGroup): ContextDefinition[] {
    return definitions.filter(
      (d) => d.isActive && d.analyticsGroupId !== g.id,
    );
  }

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: '0 0 2px' }}>
            קבוצות לאנליטיקות
          </h3>
          <p style={{ fontSize: 12, color: '#94a3b8', margin: 0 }}>
            קבוצות המרכזות הקשרים באנליטיקות. הגדירי פעם אחת, שייכי הקשרים בתפריט הנפתח בעורך ההקשר.
          </p>
        </div>
        {!creating && (
          <button
            type="button"
            onClick={() => { setCreating(true); setError(''); }}
            style={{ background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 7, padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            + קבוצה חדשה
          </button>
        )}
      </div>

      {creating && (
        <div style={{ background: '#faf5ff', border: '1px solid #ddd6fe', borderRadius: 10, padding: 12, display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
          <input
            autoFocus
            style={{ ...inputStyle, flex: 1 }}
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
            placeholder="שם הקבוצה — למשל: תזונה"
            maxLength={60}
          />
          <button
            type="button"
            disabled={busy}
            onClick={create}
            style={{ background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 7, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer' }}
          >
            שמירה
          </button>
          <button
            type="button"
            onClick={() => { setCreating(false); setDraftLabel(''); setError(''); }}
            style={{ background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', borderRadius: 7, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }}
          >
            ביטול
          </button>
        </div>
      )}

      {error && (
        <div style={{ color: '#dc2626', fontSize: 12, background: '#fef2f2', padding: '6px 10px', borderRadius: 6, marginBottom: 10 }}>
          {error}
        </div>
      )}

      {groups.length === 0 && !creating ? (
        <div style={{ padding: '20px', textAlign: 'center', border: '2px dashed #e2e8f0', borderRadius: 10, color: '#94a3b8', fontSize: 13 }}>
          עדיין לא הוגדרו קבוצות. צרי קבוצה אחת ותשייכי אליה הקשרים.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {groups.map((g) => {
            const members = definitions.filter((d) => d.analyticsGroupId === g.id);
            const eligible = eligibleForGroup(g);
            return (
              <div
                key={g.id}
                style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 12 }}
              >
                {/* Header row: label + counts + per-group actions */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {editingId === g.id ? (
                    <>
                      <input
                        style={{ ...inputStyle, flex: 1 }}
                        value={editingLabel}
                        onChange={(e) => setEditingLabel(e.target.value)}
                        maxLength={60}
                      />
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => saveEdit(g.id)}
                        style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer' }}
                      >
                        שמירה
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        style={{ background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}
                      >
                        ביטול
                      </button>
                    </>
                  ) : (
                    <>
                      <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: '#0f172a' }}>
                        {g.label}
                      </div>
                      <span style={{ background: '#ede9fe', color: '#5b21b6', fontSize: 11, padding: '3px 9px', borderRadius: 20, fontWeight: 500 }}>
                        {members.length} הקשרים
                      </span>
                      <button
                        type="button"
                        onClick={() => { setEditingId(g.id); setEditingLabel(g.label); setError(''); }}
                        style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 12px', fontSize: 12, color: '#374151', cursor: 'pointer', fontWeight: 500 }}
                      >
                        ערוך
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(g)}
                        disabled={members.length > 0}
                        title={members.length > 0 ? 'לא ניתן למחוק — הקבוצה בשימוש' : 'מחק'}
                        style={{ background: 'none', border: '1px solid #fecaca', color: members.length > 0 ? '#fca5a5' : '#dc2626', borderRadius: 6, padding: '6px 10px', fontSize: 12, cursor: members.length > 0 ? 'not-allowed' : 'pointer' }}
                      >
                        ✕
                      </button>
                    </>
                  )}
                </div>

                {/* Phase 4.5: members + attach picker — full membership control
                    from the group screen. Hidden while editing the label so
                    the edit UX stays focused. */}
                {editingId !== g.id && (
                  <div style={{ marginTop: 10, borderTop: '1px solid #f1f5f9', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {members.length === 0 ? (
                      <div style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>
                        אין הקשרים בקבוצה.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {members.map((m) => (
                          <span
                            key={m.id}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                              background: '#f5f3ff',
                              border: '1px solid #ddd6fe',
                              color: '#4c1d95',
                              borderRadius: 999,
                              padding: '4px 10px',
                              fontSize: 12,
                              fontWeight: 500,
                            }}
                          >
                            {m.label}
                            <button
                              type="button"
                              onClick={() => detachContextFromGroup(m.id)}
                              disabled={busy}
                              title="הסר מקבוצה"
                              aria-label={`הסר ${m.label} מהקבוצה`}
                              style={{ background: 'none', border: 'none', color: '#7c3aed', cursor: busy ? 'not-allowed' : 'pointer', fontSize: 13, lineHeight: 1, padding: 0, fontWeight: 700 }}
                            >
                              ✕
                            </button>
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Phase 4.6 attach UX rewrite: explicit per-context
                        button. Each eligible context is one button; clicking
                        it synchronously calls the attach handler. This avoids
                        the controlled-<select> onChange-reentry edge case
                        that was silently no-opping the previous picker. */}
                    {attachingGroupId === g.id ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, background: '#faf5ff', border: '1px dashed #ddd6fe', borderRadius: 8, padding: 10 }}>
                        <div style={{ fontSize: 12, color: '#6d28d9', fontWeight: 600 }}>
                          בחרי הקשר להוספה לקבוצה
                        </div>
                        {eligible.length === 0 ? (
                          <div style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>
                            אין הקשרים זמינים.
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {eligible.map((d) => {
                              const reassigning =
                                d.analyticsGroupId && d.analyticsGroupId !== g.id;
                              return (
                                <button
                                  key={d.id}
                                  type="button"
                                  disabled={busy}
                                  onClick={() => attachContextToGroup(d.id, g.id)}
                                  style={{
                                    background: '#ffffff',
                                    border: '1px solid #ddd6fe',
                                    color: '#4c1d95',
                                    borderRadius: 999,
                                    padding: '6px 10px',
                                    fontSize: 12,
                                    fontWeight: 600,
                                    cursor: busy ? 'not-allowed' : 'pointer',
                                    fontFamily: 'inherit',
                                  }}
                                  title={reassigning ? 'יועבר מקבוצה אחרת' : ''}
                                >
                                  + {d.label}
                                  {reassigning && (
                                    <span style={{ marginInlineStart: 6, fontSize: 10, color: '#7c3aed', fontWeight: 500 }}>
                                      (מועבר)
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => setAttachingGroupId(null)}
                          style={{ alignSelf: 'flex-start', background: 'transparent', color: '#6b7280', border: 'none', fontSize: 12, cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
                        >
                          סגור
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={eligible.length === 0}
                        title={eligible.length === 0 ? 'אין הקשרים זמינים להוספה' : ''}
                        onClick={() => { setAttachingGroupId(g.id); setError(''); }}
                        style={{ alignSelf: 'flex-start', background: '#faf5ff', color: '#7c3aed', border: '1px solid #ddd6fe', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: eligible.length === 0 ? 'not-allowed' : 'pointer', opacity: eligible.length === 0 ? 0.6 : 1 }}
                      >
                        + הוסף הקשר
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ─── Phase 3.2: Context library management section ──────────────────────────
// A compact, inline CRUD for the reusable context definitions of a program.
// Kept simple: list visible above actions, add via inline form, edit via
// expand-on-click, archive/restore via button. No modal — admins should see
// the library at a glance while working on actions below.

function ContextLibrarySection({
  programId,
  definitions,
  actions,
  analyticsGroups,
  onChanged,
  onActionsChanged,
}: {
  programId: string;
  definitions: ContextDefinition[];
  actions: GameAction[];
  // Phase 4.3: passed to ContextDefinitionForm for the group dropdown.
  analyticsGroups: AnalyticsGroup[];
  onChanged: () => void;
  onActionsChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const visible = definitions.filter((d) => showArchived || d.isActive);

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: '0 0 2px' }}>
            ספריית הקשרים משותפים
          </h3>
          <p style={{ fontSize: 12, color: '#94a3b8', margin: 0 }}>
            הגדרות שניתנות לשימוש חוזר במגוון פעולות. שינוי כאן מתעדכן בכל הפעולות.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            style={{ background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', borderRadius: 7, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}
          >
            {showArchived ? 'הסתר ארכיון' : 'הצג ארכיון'}
          </button>
          <button
            type="button"
            onClick={() => { setEditingId(null); setAdding(true); }}
            style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 7, padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            + הגדרה חדשה
          </button>
        </div>
      </div>

      {adding && (
        <ContextDefinitionForm
          programId={programId}
          definition={null}
          actions={actions}
          analyticsGroups={analyticsGroups}
          onSaved={() => { setAdding(false); onChanged(); }}
          onCancel={() => setAdding(false)}
          onActionsChanged={onActionsChanged}
        />
      )}

      {visible.length === 0 && !adding ? (
        <div style={{ padding: '24px', textAlign: 'center', border: '2px dashed #e2e8f0', borderRadius: 10, color: '#94a3b8', fontSize: 13 }}>
          עדיין לא הוגדרו הקשרים משותפים
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {visible.map((d) => (
            <div key={d.id}>
              <div
                style={{
                  background: d.isActive ? '#fff' : '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: 10,
                  padding: '12px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  opacity: d.isActive ? 1 : 0.6,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', marginBottom: 4 }}>
                    {d.label}
                    {!d.isActive && <span style={{ marginInlineStart: 8, fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>(בארכיון)</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    {(() => {
                      const typeLabel = d.type === 'select' ? 'בחירה' : d.type === 'number' ? 'מספר' : 'טקסט';
                      const optsCount = d.type === 'select' ? (d.optionsJson?.length ?? 0) : 0;
                      return (
                        <>
                          <span style={{ background: '#eff6ff', color: '#1d4ed8', fontSize: 11, padding: '3px 9px', borderRadius: 20, fontWeight: 500 }}>
                            {typeLabel}{d.type === 'select' ? ` · ${optsCount} אפשרויות` : ''}
                          </span>
                          {d.inputMode === 'system_fixed' && (
                            <span style={{ background: '#fef3c7', color: '#92400e', fontSize: 11, padding: '3px 9px', borderRadius: 20, fontWeight: 500 }}>
                              מערכת · {d.fixedValue ?? '—'}
                            </span>
                          )}
                          {d.inputMode === 'participant' && d.requiredByDefault && (
                            <span style={{ background: '#fef2f2', color: '#dc2626', fontSize: 11, padding: '3px 9px', borderRadius: 20, fontWeight: 500 }}>
                              חובה כברירת מחדל
                            </span>
                          )}
                          {d.inputMode === 'participant' && !d.visibleToParticipantByDefault && (
                            <span style={{ background: '#f3f4f6', color: '#6b7280', fontSize: 11, padding: '3px 9px', borderRadius: 20, fontWeight: 500 }}>
                              מוסתר מהמשתתפת
                            </span>
                          )}
                          {!d.analyticsVisible && (
                            <span style={{ background: '#f1f5f9', color: '#475569', fontSize: 11, padding: '3px 9px', borderRadius: 20, fontWeight: 500 }}>
                              לא באנליטיקות
                            </span>
                          )}
                          {d.analyticsVisible && d.analyticsGroup && (
                            <span style={{ background: '#ede9fe', color: '#5b21b6', fontSize: 11, padding: '3px 9px', borderRadius: 20, fontWeight: 500 }}>
                              קבוצה: {d.analyticsGroup.label}
                            </span>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => { setAdding(false); setEditingId(editingId === d.id ? null : d.id); }}
                    style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 12px', fontSize: 12, color: '#374151', cursor: 'pointer', fontWeight: 500 }}
                  >
                    {editingId === d.id ? 'סגור' : 'ערוך'}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const path = d.isActive ? 'archive' : 'restore';
                      await apiFetch(`${BASE_URL}/game/programs/${programId}/context-definitions/${d.id}/${path}`, { method: 'POST', cache: 'no-store' });
                      onChanged();
                    }}
                    style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 10px', fontSize: 12, color: '#6b7280', cursor: 'pointer' }}
                  >
                    {d.isActive ? 'ארכוב' : 'שחזר'}
                  </button>
                </div>
              </div>
              {editingId === d.id && (
                <ContextDefinitionForm
                  programId={programId}
                  definition={d}
                  actions={actions}
                  analyticsGroups={analyticsGroups}
                  onSaved={() => { setEditingId(null); onChanged(); }}
                  onCancel={() => setEditingId(null)}
                  onActionsChanged={onActionsChanged}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// Inline create/edit form for a ContextDefinition. Used by both "add new" and
// "edit existing" flows in the library section.
function ContextDefinitionForm({
  programId,
  definition,
  actions,
  analyticsGroups,
  onSaved,
  onCancel,
  onActionsChanged,
}: {
  programId: string;
  definition: ContextDefinition | null;
  actions: GameAction[];
  // Phase 4.3: centralized group dropdown source.
  analyticsGroups: AnalyticsGroup[];
  onSaved: () => void;
  onCancel: () => void;
  onActionsChanged: () => void;
}) {
  const isNew = definition === null;
  const [label, setLabel] = useState(definition?.label ?? '');
  // Phase 4.2: `type` is derived server-side from visibility; we no longer
  // expose it in the form. Kept as a read-only ref for any code path that
  // still inspects the legacy field.
  const [type] = useState<ContextFieldType>(definition?.type ?? 'select');
  void type;
  const [requiredByDefault, setRequiredByDefault] = useState(definition?.requiredByDefault ?? true);
  const [visibleByDefault, setVisibleByDefault] = useState(definition?.visibleToParticipantByDefault ?? true);
  const [options, setOptions] = useState<ContextOption[]>(
    definition?.optionsJson ?? (definition?.type === 'select' ? [] : [{ value: '', label: '' }]),
  );
  // Phase 3.4: inputMode is no longer admin-configurable. It's DERIVED from
  // `visibleByDefault`:
  //   visibleByDefault=true  → participant fills (inputMode='participant')
  //   visibleByDefault=false → system handles (inputMode='system_fixed')
  // A hidden system context still holds its `fixedValue` so analytics can
  // group on it; a hidden participant input is not a meaningful product
  // state, so we collapse the distinction.
  const derivedInputMode: 'participant' | 'system_fixed' = visibleByDefault
    ? 'participant'
    : 'system_fixed';
  const [analyticsVisible, setAnalyticsVisible] = useState(definition?.analyticsVisible ?? true);
  const [fixedValue, setFixedValue] = useState(definition?.fixedValue ?? '');
  // Phase 4.3: centralized group FK. Admin picks from a dropdown of existing
  // groups (or "ללא קבוצה"). No free-text label input at the context level.
  const [analyticsGroupId, setAnalyticsGroupId] = useState<string>(
    definition?.analyticsGroupId ?? '',
  );
  const [analyticsDisplayLabel, setAnalyticsDisplayLabel] = useState(definition?.analyticsDisplayLabel ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Phase 3.4: pending action attachments for attach-during-creation flow.
  const [pendingAttachActionIds, setPendingAttachActionIds] = useState<string[]>([]);

  async function save() {
    if (!label.trim()) { setError('תווית היא שדה חובה'); return; }
    // Phase 4.2: participant-visible → options required; system → fixed value required.
    if (visibleByDefault) {
      const labels = new Set<string>();
      for (const o of options) {
        const lbl = o.label.trim();
        if (!lbl) { setError('כל אפשרות צריכה תווית'); return; }
        if (labels.has(lbl)) { setError(`תווית אפשרות כפולה: ${lbl}`); return; }
        labels.add(lbl);
      }
      if (options.length === 0) { setError('הקשר שמוצג למשתתפת חייב לפחות אפשרות אחת'); return; }
    } else {
      if (!fixedValue.trim()) {
        setError('הקשר המטופל על ידי המערכת חייב ערך קבוע');
        return;
      }
    }
    setSaving(true); setError('');
    try {
      const body: Record<string, unknown> = {
        label: label.trim(),
        requiredByDefault,
        visibleToParticipantByDefault: visibleByDefault,
        // Phase 3.4: inputMode derives from participantVisible.
        inputMode: derivedInputMode,
        analyticsVisible,
        fixedValue: derivedInputMode === 'system_fixed' ? fixedValue.trim() : '',
        // Phase 4.3: centralized group FK. Empty string clears the assignment.
        analyticsGroupId: analyticsGroupId || '',
        analyticsDisplayLabel: analyticsDisplayLabel.trim(),
      };
      // Phase 4.2: server derives type from visibility. Only participant-
      // visible contexts carry options; system contexts never do.
      if (isNew) body.type = visibleByDefault ? 'select' : 'text';
      if (visibleByDefault) {
        body.options = options.map((o) => ({
          value: o.value?.trim() || undefined,
          label: o.label.trim(),
        }));
      }
      const url = isNew
        ? `${BASE_URL}/game/programs/${programId}/context-definitions`
        : `${BASE_URL}/game/programs/${programId}/context-definitions/${definition!.id}`;
      const saved = (await apiFetch(url, {
        method: isNew ? 'POST' : 'PATCH',
        cache: 'no-store',
        body: JSON.stringify(body),
      })) as ContextDefinition;
      // Phase 3.4: attach-during-creation. Flush the pending attachment list
      // immediately after the definition exists. Silent-best-effort — if one
      // attachment fails, the definition still saved; admin can retry from
      // the edit form's attachment section.
      if (isNew && pendingAttachActionIds.length > 0) {
        const defId = saved.id;
        for (const actionId of pendingAttachActionIds) {
          try {
            await apiFetch(
              `${BASE_URL}/game/programs/${programId}/context-definitions/${defId}/attach-action`,
              { method: 'POST', cache: 'no-store', body: JSON.stringify({ actionId }) },
            );
          } catch { /* best-effort; admin can re-attach from edit form */ }
        }
        onActionsChanged();
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בשמירה');
    } finally { setSaving(false); }
  }

  return (
    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, marginTop: 8, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>
          תווית (מה שהמשתתפת רואה)
        </label>
        <input
          style={inputStyle}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="למשל: ארוחה"
          autoFocus={isNew}
        />
      </div>

      {/* Phase 3.4 UX: the two core toggles — participant visibility and
          analytics visibility — drive every other control. "מי ממלא?" is
          gone; if visibleByDefault=true → participant fills, otherwise the
          system handles (via fixedValue). */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#374151', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={visibleByDefault} onChange={(e) => setVisibleByDefault(e.target.checked)} />
          להציג למשתתפת
        </label>
        {visibleByDefault && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#374151', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={requiredByDefault} onChange={(e) => setRequiredByDefault(e.target.checked)} />
            חובה כברירת מחדל
          </label>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#374151', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={analyticsVisible} onChange={(e) => setAnalyticsVisible(e.target.checked)} />
          להציג באנליטיקות
        </label>
      </div>

      {/* Type is only relevant when the participant is the filler. For
          participant mode, only 'בחירה' and 'שדה פתוח' are exposed; the
          hidden 'number' option survives for legacy definitions that already
          use it but isn't offered on creation. */}
      {/* Phase 4.2: the "סוג" selector is removed. Visibility drives the type:
          visible = always בחירה (with options); hidden = system fixed value.
          The rest of the form renders the right block based on visibleByDefault. */}

      {!visibleByDefault && (
        // Phase 4.2: single simple text input. Accepts any string — admins
        // can type `sleep`, `42`, `location_gym`, whatever. Validation is
        // non-emptiness only. No options block, no type branching.
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 8, padding: 12 }}>
          <div>
            <label style={{ fontSize: 13, fontWeight: 700, color: '#78350f', display: 'block', marginBottom: 4 }}>
              ערך שהמערכת תשמור
            </label>
            <input
              type="text"
              style={inputStyle}
              value={fixedValue}
              onChange={(e) => setFixedValue(e.target.value)}
              placeholder="הערך שיישמר אוטומטית (למשל: sleep או 42)"
            />
            <div style={{ fontSize: 11, color: '#92400e', marginTop: 4, lineHeight: 1.4 }}>
              המשתתפת לא תראה שדה זה. המערכת תשמור את הערך הזה אוטומטית בכל דיווח.
            </div>
          </div>
        </div>
      )}

      {/* Phase 4.2: options section now shows ONLY when participant-visible.
          A system context never has participant-facing options. */}
      {visibleByDefault && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid #e2e8f0', paddingTop: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>אפשרויות</div>
          {options.map((o, oi) => (
            <div key={oi} style={{ display: 'grid', gridTemplateColumns: '1fr 28px', gap: 6 }}>
              <input
                style={inputStyle}
                value={o.label}
                onChange={(e) => setOptions((prev) => prev.map((p, i) => i === oi ? { ...p, label: e.target.value } : p))}
                placeholder="תווית (בוקר)"
              />
              <button
                type="button"
                onClick={() => setOptions((prev) => prev.filter((_, i) => i !== oi))}
                style={{ width: 28, height: 28, border: '1px solid #e2e8f0', background: '#fff', color: '#dc2626', borderRadius: 6, cursor: 'pointer', fontSize: 14, fontWeight: 700 }}
                aria-label="מחק אפשרות"
              >×</button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setOptions((prev) => [...prev, { value: '', label: '' }])}
            style={{ background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer', alignSelf: 'flex-start' }}
          >
            + הוסיפי אפשרות
          </button>
        </div>
      )}

      {/* Phase 4.3: centralized group dropdown. Admins define groups once in
          the "קבוצות לאנליטיקות" section above and pick them here. */}
      {analyticsVisible && (
        <div style={{ background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12, color: '#5b21b6', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
            תצוגה באנליטיקות
          </div>
          <div style={{ fontSize: 12, color: '#5b21b6', lineHeight: 1.5 }}>
            אופציונלי. הקשרים המשויכים לאותה קבוצה יאוחדו לפריט אחד באנליטיקות.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#4c1d95', display: 'block', marginBottom: 4 }}>
                לאיזו קבוצה שייך ההקשר?
              </label>
              <select
                style={inputStyle}
                value={analyticsGroupId}
                onChange={(e) => setAnalyticsGroupId(e.target.value)}
              >
                <option value="">ללא קבוצה</option>
                {analyticsGroups.map((g) => (
                  <option key={g.id} value={g.id}>{g.label}</option>
                ))}
              </select>
              {analyticsGroups.length === 0 && (
                <div style={{ fontSize: 11, color: '#6d28d9', marginTop: 4, fontStyle: 'italic' }}>
                  עדיין לא הוגדרו קבוצות. הוסיפי אחת בקטע &ldquo;קבוצות לאנליטיקות&rdquo; למעלה.
                </div>
              )}
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#4c1d95', display: 'block', marginBottom: 4 }}>
                תווית קצרה באנליטיקות (אופציונלי)
              </label>
              <input
                style={inputStyle}
                value={analyticsDisplayLabel}
                onChange={(e) => setAnalyticsDisplayLabel(e.target.value)}
                placeholder={`ברירת מחדל: ${label || 'תווית ההקשר'}`}
                maxLength={60}
              />
              <div style={{ fontSize: 11, color: '#6d28d9', marginTop: 4 }}>
                כשריק — התווית הרגילה של ההקשר.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Phase 3.3 UX: manage this context's action attachments from the
          context editor. Phase 3.4: also works DURING creation — selections
          are kept in a pending list and attached after the definition is
          saved. Per-use overrides still live on the action-editor side. */}
      {!isNew && definition ? (
        <AttachedActionsSection
          mode="persistent"
          programId={programId}
          definitionId={definition.id}
          actions={actions}
          onActionsChanged={onActionsChanged}
        />
      ) : (
        <AttachedActionsSection
          mode="pending"
          actions={actions}
          pending={pendingAttachActionIds}
          onPendingChange={setPendingAttachActionIds}
        />
      )}

      {error && <div style={{ color: '#dc2626', fontSize: 12, background: '#fef2f2', padding: '6px 10px', borderRadius: 6 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} style={{ background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 7, padding: '7px 14px', fontSize: 13, cursor: 'pointer' }}>
          ביטול
        </button>
        <button type="button" onClick={save} disabled={saving} style={{ background: saving ? '#93c5fd' : '#2563eb', color: '#fff', border: 'none', borderRadius: 7, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer' }}>
          {saving ? 'שומר...' : 'שמירה'}
        </button>
      </div>
    </div>
  );
}

// ─── Phase 3.3 UX: attach/detach actions from the context side ──────────────
// Lightweight mirror of the action-editor's attachment picker. Lives inside
// ContextDefinitionForm (edit mode only). Only surfaces attach/detach — per-use
// overrides (required/visible) remain exclusively in the action editor so
// there's only one place where those are edited.

type AttachedActionsPersistProps = {
  mode: 'persistent';
  programId: string;
  definitionId: string;
  actions: GameAction[];
  onActionsChanged: () => void;
};
type AttachedActionsPendingProps = {
  mode: 'pending';
  actions: GameAction[];
  pending: string[];
  onPendingChange: (next: string[]) => void;
};

function AttachedActionsSection(props: AttachedActionsPersistProps | AttachedActionsPendingProps) {
  // Resolve the "currently attached" set from either live data (persistent
  // mode, edit flow) or the in-memory pending list (creation flow).
  let attached: GameAction[];
  if (props.mode === 'persistent') {
    attached = props.actions.filter((a) =>
      (a.contextUses ?? []).some((u) => u.definitionId === props.definitionId),
    );
  } else {
    const set = new Set(props.pending);
    attached = props.actions.filter((a) => set.has(a.id));
  }
  const attachedIds = new Set(attached.map((a) => a.id));
  const available = props.actions.filter((a) => !attachedIds.has(a.id));

  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const filteredAvailable = filter.trim()
    ? available.filter((a) => a.name.toLowerCase().includes(filter.toLowerCase()))
    : available;

  async function attach(actionId: string) {
    if (!actionId) return;
    if (props.mode === 'pending') {
      if (props.pending.includes(actionId)) return;
      props.onPendingChange([...props.pending, actionId]);
      return;
    }
    setBusy(true);
    try {
      await apiFetch(
        `${BASE_URL}/game/programs/${props.programId}/context-definitions/${props.definitionId}/attach-action`,
        { method: 'POST', cache: 'no-store', body: JSON.stringify({ actionId }) },
      );
      props.onActionsChanged();
    } finally {
      setBusy(false);
    }
  }

  async function detach(actionId: string) {
    if (props.mode === 'pending') {
      props.onPendingChange(props.pending.filter((id) => id !== actionId));
      return;
    }
    setBusy(true);
    try {
      await apiFetch(
        `${BASE_URL}/game/programs/${props.programId}/context-definitions/${props.definitionId}/attach-action/${actionId}`,
        { method: 'DELETE', cache: 'no-store' },
      );
      props.onActionsChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#0369a1', marginBottom: 2 }}>
          מחובר לפעולות
        </div>
        <div style={{ fontSize: 11, color: '#0c4a6e', lineHeight: 1.4 }}>
          הוסיפי או הסירי פעולות שמשתמשות בהקשר זה. התאמה לפעולה ספציפית (חובה/להציג) מתבצעת בעורך הפעולה.
          {props.mode === 'pending' && (
            <>
              {' '}
              <span style={{ color: '#92400e', fontWeight: 600 }}>החיבור ייווצר אחרי שמירת ההגדרה.</span>
            </>
          )}
        </div>
      </div>

      {attached.length === 0 ? (
        <div style={{ fontSize: 12, color: '#64748b', fontStyle: 'italic' }}>
          עדיין לא מחובר לפעולה.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {attached.map((a) => (
            <div
              key={a.id}
              style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: '8px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
            >
              <span style={{ fontSize: 13, color: '#0f172a', fontWeight: 600 }}>{a.name}</span>
              <button
                type="button"
                onClick={() => detach(a.id)}
                disabled={busy}
                style={{ background: 'none', border: '1px solid #fecaca', color: '#dc2626', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: busy ? 'not-allowed' : 'pointer', fontWeight: 500 }}
              >
                הסר
              </button>
            </div>
          ))}
        </div>
      )}

      {available.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {available.length > 8 && (
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="חיפוש פעולה..."
              style={{ ...inputStyle, fontSize: 12, padding: '6px 10px' }}
            />
          )}
          <select
            value=""
            disabled={busy}
            onChange={(e) => { attach(e.target.value); }}
            style={{ ...inputStyle, fontSize: 13 }}
          >
            <option value="">+ הוסיפי לפעולה</option>
            {filteredAvailable.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
      ) : attached.length === 0 ? null : (
        <div style={{ fontSize: 12, color: '#6b7280' }}>
          כל הפעולות כבר מחוברות להקשר זה.
        </div>
      )}
    </div>
  );
}

function GameEngineTab({ programId }: { programId: string }) {
  const [actions, setActions] = useState<GameAction[]>([]);
  const [rules, setRules] = useState<GameRule[]>([]);
  // Phase 3.2: reusable context library — loaded alongside actions/rules so
  // the ActionModal can render the attachment picker without an extra fetch.
  const [definitions, setDefinitions] = useState<ContextDefinition[]>([]);
  // Phase 4.3: centralized analytics groups — scoped to this program.
  const [analyticsGroups, setAnalyticsGroups] = useState<AnalyticsGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionModal, setActionModal] = useState<{ open: boolean; action: GameAction | null }>({ open: false, action: null });
  const [ruleModal, setRuleModal] = useState<{ open: boolean; rule: GameRule | null }>({ open: false, rule: null });
  const [deleteAction, setDeleteAction] = useState<GameAction | null>(null);
  const [deleteRule, setDeleteRule] = useState<GameRule | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [portalToggling, setPortalToggling] = useState<Record<string, boolean>>({});
  const [portalErrors, setPortalErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    Promise.all([
      apiFetch(`${BASE_URL}/game/programs/${programId}/actions`, { cache: 'no-store' }),
      apiFetch(`${BASE_URL}/game/programs/${programId}/rules`, { cache: 'no-store' }),
      apiFetch(`${BASE_URL}/game/programs/${programId}/context-definitions?includeArchived=true`, { cache: 'no-store' }),
      apiFetch(`${BASE_URL}/game/programs/${programId}/analytics-groups`, { cache: 'no-store' }),
    ]).then(([a, r, d, g]) => {
      setActions((a as GameAction[]).filter((x) => x.isActive));
      setRules((r as GameRule[]).filter((x) => x.isActive));
      setDefinitions(d as ContextDefinition[]);
      setAnalyticsGroups(g as AnalyticsGroup[]);
    }).finally(() => setLoading(false));
  }, [programId]);

  async function refreshDefinitions() {
    const d = await apiFetch(
      `${BASE_URL}/game/programs/${programId}/context-definitions?includeArchived=true`,
      { cache: 'no-store' },
    );
    setDefinitions(d as ContextDefinition[]);
  }

  async function refreshAnalyticsGroups() {
    const g = await apiFetch(
      `${BASE_URL}/game/programs/${programId}/analytics-groups`,
      { cache: 'no-store' },
    );
    setAnalyticsGroups(g as AnalyticsGroup[]);
  }

  async function handleDeleteAction(a: GameAction) {
    setDeleting(true);
    try {
      await apiFetch(`${BASE_URL}/game/programs/${programId}/actions/${a.id}`, { method: 'DELETE', cache: 'no-store' });
      setActions((prev) => prev.filter((x) => x.id !== a.id));
      setDeleteAction(null);
    } finally { setDeleting(false); }
  }

  async function handleDeleteRule(r: GameRule) {
    setDeleting(true);
    try {
      await apiFetch(`${BASE_URL}/game/programs/${programId}/rules/${r.id}`, { method: 'DELETE', cache: 'no-store' });
      setRules((prev) => prev.filter((x) => x.id !== r.id));
      setDeleteRule(null);
    } finally { setDeleting(false); }
  }

  async function handleTogglePortal(a: GameAction) {
    const newValue = !a.showInPortal;
    setPortalToggling((p) => ({ ...p, [a.id]: true }));
    setPortalErrors((p) => ({ ...p, [a.id]: '' }));
    // Optimistic update
    setActions((prev) => prev.map((x) => x.id === a.id ? { ...x, showInPortal: newValue } : x));
    try {
      await apiFetch(`${BASE_URL}/game/programs/${programId}/actions/${a.id}`, {
        method: 'PATCH',
        cache: 'no-store',
        body: JSON.stringify({ showInPortal: newValue }),
      });
    } catch {
      // Revert on failure
      setActions((prev) => prev.map((x) => x.id === a.id ? { ...x, showInPortal: !newValue } : x));
      setPortalErrors((p) => ({ ...p, [a.id]: 'שגיאה בשמירת הנראות' }));
    } finally {
      setPortalToggling((p) => ({ ...p, [a.id]: false }));
    }
  }

  async function handleMoveAction(index: number, direction: 'up' | 'down') {
    const next = direction === 'up' ? index - 1 : index + 1;
    if (next < 0 || next >= actions.length) return;
    const reordered = [...actions];
    [reordered[index], reordered[next]] = [reordered[next], reordered[index]];
    const withOrder = reordered.map((a, i) => ({ ...a, sortOrder: i }));
    setActions(withOrder);
    try {
      await apiFetch(`${BASE_URL}/game/programs/${programId}/actions/reorder`, {
        method: 'POST',
        cache: 'no-store',
        body: JSON.stringify({ items: withOrder.map((a) => ({ id: a.id, sortOrder: a.sortOrder })) }),
      });
    } catch {
      // Revert on failure — re-fetch from server
      apiFetch(`${BASE_URL}/game/programs/${programId}/actions`, { cache: 'no-store' })
        .then((data) => setActions((data as GameAction[]).filter((x) => x.isActive)));
    }
  }

  async function handleMoveRule(index: number, direction: 'up' | 'down') {
    const next = direction === 'up' ? index - 1 : index + 1;
    if (next < 0 || next >= rules.length) return;
    const reordered = [...rules];
    [reordered[index], reordered[next]] = [reordered[next], reordered[index]];
    const withOrder = reordered.map((r, i) => ({ ...r, sortOrder: i }));
    setRules(withOrder);
    try {
      await apiFetch(`${BASE_URL}/game/programs/${programId}/rules/reorder`, {
        method: 'POST',
        cache: 'no-store',
        body: JSON.stringify({ items: withOrder.map((r) => ({ id: r.id, sortOrder: r.sortOrder })) }),
      });
    } catch {
      // Revert on failure — re-fetch from server
      apiFetch(`${BASE_URL}/game/programs/${programId}/rules`, { cache: 'no-store' })
        .then((data) => setRules((data as GameRule[]).filter((x) => x.isActive)));
    }
  }

  const badge = (text: string, color: 'blue' | 'green' | 'gray' | 'orange'): React.ReactElement => {
    const styles: Record<string, React.CSSProperties> = {
      blue:   { background: '#eff6ff', color: '#1d4ed8' },
      green:  { background: '#f0fdf4', color: '#15803d' },
      gray:   { background: '#f1f5f9', color: '#475569' },
      orange: { background: '#fff7ed', color: '#c2410c' },
    };
    return <span style={{ ...styles[color], fontSize: 11, padding: '3px 9px', borderRadius: 20, fontWeight: 500, whiteSpace: 'nowrap' }}>{text}</span>;
  };

  if (loading) return <div style={{ color: '#94a3b8', textAlign: 'center', padding: 48 }}>טוען...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 36 }}>

      {/* ── Phase 4.3+: Centralized analytics groups ── */}
      <AnalyticsGroupsSection
        programId={programId}
        groups={analyticsGroups}
        definitions={definitions}
        onChanged={async () => {
          // Attach/detach mutates both the group's member count AND each
          // context's analyticsGroupId, so refresh both lists.
          await Promise.all([refreshAnalyticsGroups(), refreshDefinitions()]);
        }}
      />

      {/* ── Phase 3.2: Reusable context library ── */}
      <ContextLibrarySection
        programId={programId}
        definitions={definitions}
        actions={actions}
        analyticsGroups={analyticsGroups}
        onChanged={refreshDefinitions}
        onActionsChanged={async () => {
          const refreshed = await apiFetch(
            `${BASE_URL}/game/programs/${programId}/actions`,
            { cache: 'no-store' },
          );
          setActions((refreshed as GameAction[]).filter((x) => x.isActive));
        }}
      />

      {/* ── Actions ── */}
      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: '0 0 2px' }}>פעולות</h3>
            <p style={{ fontSize: 12, color: '#94a3b8', margin: 0 }}>הפעולות שמשתתפות יכולות לדווח עליהן</p>
          </div>
          <button onClick={() => setActionModal({ open: true, action: null })}
            style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 7, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            + הוספת פעולה
          </button>
        </div>

        {actions.length === 0 ? (
          <div style={{ padding: '36px 24px', textAlign: 'center', border: '2px dashed #e2e8f0', borderRadius: 10 }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>🎯</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#374151', marginBottom: 6 }}>אין פעולות עדיין</div>
            <div style={{ fontSize: 13, color: '#94a3b8', maxWidth: 280, margin: '0 auto' }}>
              פעולות הן הדברים שמשתתפות מדווחות עליהם — שתיית מים, צ׳ק-אין, פעילות גופנית וכדומה.
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {actions.map((a, idx) => (
              <div key={a.id} style={{ display: 'flex', flexDirection: 'column', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '14px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
                    <button onClick={() => handleMoveAction(idx, 'up')} disabled={idx === 0}
                      style={{ background: 'none', border: 'none', cursor: idx === 0 ? 'default' : 'pointer', color: idx === 0 ? '#cbd5e1' : '#64748b', fontSize: 14, lineHeight: 1, padding: '1px 4px' }}
                      title="הזז למעלה">▲</button>
                    <button onClick={() => handleMoveAction(idx, 'down')} disabled={idx === actions.length - 1}
                      style={{ background: 'none', border: 'none', cursor: idx === actions.length - 1 ? 'default' : 'pointer', color: idx === actions.length - 1 ? '#cbd5e1' : '#64748b', fontSize: 14, lineHeight: 1, padding: '1px 4px' }}
                      title="הזז למטה">▼</button>
                  </div>
                  <div style={{ width: 40, height: 40, borderRadius: 8, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>🎯</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', marginBottom: 4 }}>{a.name}</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      {badge(`${a.points} נקודות`, 'green')}
                      {badge(ACTION_INPUT_TYPES.find((t) => t.value === a.inputType)?.label ?? a.inputType ?? 'כן/לא', 'blue')}
                      {a.inputType === 'number' && a.aggregationMode === 'latest_value' && badge('סה״כ שוטף', 'blue')}
                      {a.inputType === 'number' && a.aggregationMode === 'incremental_sum' && badge('הוספה מצטברת', 'blue')}
                      {a.unit && badge(a.unit, 'gray')}
                      {a.maxPerDay ? badge(`מגבלה: ${a.maxPerDay}/יום`, 'orange') : badge('ללא מגבלה', 'gray')}
                    </div>
                    {a.description && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{a.description}</div>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <button
                      onClick={() => handleTogglePortal(a)}
                      disabled={portalToggling[a.id]}
                      title={a.showInPortal ? 'גלוי למשתתפות — לחץ להסתרה' : 'מוסתר ממשתתפות — לחץ להציג'}
                      style={{
                        background: a.showInPortal ? '#f0fdf4' : '#f8fafc',
                        border: `1px solid ${a.showInPortal ? '#bbf7d0' : '#cbd5e1'}`,
                        borderRadius: 6,
                        padding: '5px 10px',
                        fontSize: 12,
                        color: a.showInPortal ? '#15803d' : '#94a3b8',
                        cursor: portalToggling[a.id] ? 'wait' : 'pointer',
                        whiteSpace: 'nowrap' as const,
                        fontWeight: 500,
                      }}
                    >
                      {portalToggling[a.id] ? '...' : (a.showInPortal ? '👁 גלוי' : '🚫 מוסתר')}
                    </button>
                    <button onClick={() => setActionModal({ open: true, action: a })}
                      style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 14px', fontSize: 12, color: '#374151', cursor: 'pointer', fontWeight: 500 }}>
                      ערוך
                    </button>
                    <button onClick={() => setDeleteAction(a)}
                      style={{ background: 'none', border: '1px solid #fecaca', borderRadius: 6, padding: '6px 10px', fontSize: 12, color: '#dc2626', cursor: 'pointer' }}
                      title="מחק פעולה"
                    >
                      ✕
                    </button>
                  </div>
                </div>
                {portalErrors[a.id] && (
                  <div style={{ fontSize: 12, color: '#dc2626', marginTop: 6, padding: '4px 8px', background: '#fef2f2', borderRadius: 5 }}>
                    {portalErrors[a.id]}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Rules ── */}
      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: '0 0 2px' }}>חוקי בונוס</h3>
            <p style={{ fontSize: 12, color: '#94a3b8', margin: 0 }}>כללים שמוסיפים נקודות מעבר לפעולות הרגילות</p>
          </div>
          <button onClick={() => setRuleModal({ open: true, rule: null })}
            style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 7, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            + הוספת חוק
          </button>
        </div>

        {rules.length === 0 ? (
          <div style={{ padding: '36px 24px', textAlign: 'center', border: '2px dashed #e2e8f0', borderRadius: 10 }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>⚡</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#374151', marginBottom: 6 }}>אין חוקי בונוס עדיין</div>
            <div style={{ fontSize: 13, color: '#94a3b8', maxWidth: 300, margin: '0 auto' }}>
              חוקים מוסיפים עניין למשחק — בונוס רצף, בונוס יומי, פרס על פעולות ספציפיות ועוד.
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rules.map((r, idx) => {
              const typeIcons: Record<string, string> = { daily_bonus: '☀️', streak: '🔥', conditional: '⚡' };
              const desc = ruleDescription(r, actions);
              const activation = activationDescription(r);
              return (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 14, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '14px 18px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
                    <button onClick={() => handleMoveRule(idx, 'up')} disabled={idx === 0}
                      style={{ background: 'none', border: 'none', cursor: idx === 0 ? 'default' : 'pointer', color: idx === 0 ? '#cbd5e1' : '#64748b', fontSize: 14, lineHeight: 1, padding: '1px 4px' }}
                      title="הזז למעלה">▲</button>
                    <button onClick={() => handleMoveRule(idx, 'down')} disabled={idx === rules.length - 1}
                      style={{ background: 'none', border: 'none', cursor: idx === rules.length - 1 ? 'default' : 'pointer', color: idx === rules.length - 1 ? '#cbd5e1' : '#64748b', fontSize: 14, lineHeight: 1, padding: '1px 4px' }}
                      title="הזז למטה">▼</button>
                  </div>
                  <div style={{ width: 40, height: 40, borderRadius: 8, background: '#fff7ed', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
                    {typeIcons[r.type] ?? '⚡'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', marginBottom: 4 }}>{r.name}</div>
                    <div style={{ fontSize: 13, color: '#475569', marginBottom: 4 }}>{desc}</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      {activation && badge(activation, 'orange')}
                      {r.requiresAdminApproval && badge('דורש אישור מנהל', 'gray')}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button onClick={() => setRuleModal({ open: true, rule: r })}
                      style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 14px', fontSize: 12, color: '#374151', cursor: 'pointer', fontWeight: 500 }}>
                      ערוך
                    </button>
                    <button onClick={() => setDeleteRule(r)}
                      style={{ background: 'none', border: '1px solid #fecaca', borderRadius: 6, padding: '6px 10px', fontSize: 12, color: '#dc2626', cursor: 'pointer' }}
                      title="מחק חוק"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Modals ── */}

      {actionModal.open && (
        <ActionModal
          programId={programId}
          action={actionModal.action}
          definitions={definitions}
          onSaved={(saved) => {
            setActions((prev) => actionModal.action
              ? prev.map((a) => a.id === saved.id ? saved : a)
              : [saved, ...prev]);
            setActionModal({ open: false, action: null });
          }}
          onClose={() => setActionModal({ open: false, action: null })}
        />
      )}

      {ruleModal.open && (
        <RuleModal
          programId={programId}
          rule={ruleModal.rule}
          actions={actions}
          onSaved={(saved) => {
            setRules((prev) => ruleModal.rule
              ? prev.map((r) => r.id === saved.id ? saved : r)
              : [saved, ...prev]);
            setRuleModal({ open: false, rule: null });
          }}
          onClose={() => setRuleModal({ open: false, rule: null })}
        />
      )}

      {deleteAction && (
        <DeleteConfirmModal
          title="מחיקת פעולה"
          warning="הפעולה הבאה תוסר מהמשחק. לוגים קיימים ישמרו אך לא ניתן יהיה לדווח עליה יותר:"
          itemName={deleteAction.name}
          confirmWord="מחק"
          onConfirm={() => handleDeleteAction(deleteAction)}
          onClose={() => setDeleteAction(null)}
          deleting={deleting}
        />
      )}

      {deleteRule && (
        <DeleteConfirmModal
          title="מחיקת חוק בונוס"
          warning="חוק הבונוס הבא יוסר מהמשחק. ניקוד שנצבר בעבר לא ישתנה:"
          itemName={deleteRule.name}
          confirmWord="מחק"
          onConfirm={() => handleDeleteRule(deleteRule)}
          onClose={() => setDeleteRule(null)}
          deleting={deleting}
        />
      )}
    </div>
  );
}

// ─── Rules Tab ────────────────────────────────────────────────────────────────

function RulesTab({ program, onSaved }: { program: Program; onSaved: (p: Program) => void }) {
  const [rulesContent, setRulesContent] = useState(program.rulesContent ?? '');
  const [rulesPublished, setRulesPublished] = useState(program.rulesPublished);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [actions, setActions] = useState<GameAction[]>([]);
  const [actionsLoading, setActionsLoading] = useState(false);

  useEffect(() => {
    setActionsLoading(true);
    apiFetch<GameAction[]>(`${BASE_URL}/game/programs/${program.id}/actions`, { cache: 'no-store' })
      .then((data) => setActions(data.filter((a) => a.isActive)))
      .catch(() => {})
      .finally(() => setActionsLoading(false));
  }, [program.id]);

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await apiFetch(`${BASE_URL}/programs/${program.id}`, {
        method: 'PATCH',
        cache: 'no-store',
        body: JSON.stringify({ rulesContent: rulesContent || null, rulesPublished }),
      }) as Program;
      onSaved({ ...program, ...updated });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally { setSaving(false); }
  }

  const portalActions = actions.filter((a) => a.showInPortal);

  const aggLabel: Record<string, string> = {
    count: 'ספירה',
    latest_value: 'ערך עדכני',
    incremental_sum: 'סכום מצטבר',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32, maxWidth: 800 }}>

      {/* ── Section A: Content editor ── */}
      <section>
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>א — תוכן חוקים כללי</div>
          <div style={{ fontSize: 12, color: '#64748b' }}>
            תוכן חופשי שיוצג בראש טאב &ldquo;חוקים&rdquo; בפורטל המשתתפות. ניתן לכלול כותרות, רשימות, קישורים, תמונות וסרטונים.
          </div>
        </div>
        <RichContentEditor
          value={rulesContent}
          onChange={(v) => { setRulesContent(v); setSaved(false); }}
          placeholder="הוסיפי כאן את ההסברים, הכללים וההנחיות לתוכנית..."
          minHeight={220}
        />
      </section>

      {/* ── Section B: Publishing control ── */}
      <section style={{ borderTop: '1px solid #e2e8f0', paddingTop: 24 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', marginBottom: 12 }}>ב — פרסום לפורטל</div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
          <input
            type="checkbox"
            id="rules-published"
            checked={rulesPublished}
            onChange={(e) => { setRulesPublished(e.target.checked); setSaved(false); }}
            style={{ width: 16, height: 16, marginTop: 2, cursor: 'pointer', flexShrink: 0 }}
          />
          <label htmlFor="rules-published" style={{ cursor: 'pointer' }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: '#0f172a' }}>פרסם חוקים בפורטל</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
              {rulesPublished
                ? '✓ המשתתפות רואות את תוכן החוקים בפורטל'
                : '✗ טאב "חוקים" בפורטל יציג הודעת "תוכן לא זמין"'}
            </div>
          </label>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{ background: saving ? '#93c5fd' : '#2563eb', color: '#fff', border: 'none', borderRadius: 7, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer' }}
          >
            {saving ? 'שומר...' : 'שמור ופרסם'}
          </button>
          {saved && <span style={{ color: '#16a34a', fontSize: 13 }}>✓ נשמר</span>}
        </div>
      </section>

      {/* ── Section C: Actions review ── */}
      <section style={{ borderTop: '1px solid #e2e8f0', paddingTop: 24 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>ג — פעולות וניקוד (סקירה)</div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14 }}>
          פעולות הניקוד הפעילות בתוכנית זו. פעולות עם ✓ בפורטל מופיעות לפני המשתתפות.
        </div>
        {actionsLoading && <div style={{ color: '#94a3b8', fontSize: 13 }}>טוען פעולות...</div>}
        {!actionsLoading && actions.length === 0 && (
          <div style={{ padding: '24px', textAlign: 'center', border: '2px dashed #e2e8f0', borderRadius: 10, color: '#94a3b8', fontSize: 13 }}>
            לא הוגדרו פעולות לתוכנית זו עדיין
          </div>
        )}
        {!actionsLoading && actions.length > 0 && (
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#64748b' }}>פעולה</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#64748b' }}>נקודות</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#64748b' }}>סוג</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#64748b' }}>מקסימום יומי</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#64748b' }}>בפורטל</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#64748b' }}>הסבר</th>
                </tr>
              </thead>
              <tbody>
                {actions.map((a) => (
                  <tr key={a.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '11px 14px' }}>
                      <div style={{ fontWeight: 600, color: '#0f172a' }}>{a.name}</div>
                      {a.description && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{a.description}</div>}
                    </td>
                    <td style={{ padding: '11px 14px', fontWeight: 700, color: '#2563eb' }}>
                      {a.points} נק׳{a.unit ? ` / ${a.unit}` : ''}
                    </td>
                    <td style={{ padding: '11px 14px' }}>
                      <span style={{ background: '#f1f5f9', color: '#374151', fontSize: 11, padding: '2px 8px', borderRadius: 20 }}>
                        {a.aggregationMode ? (aggLabel[a.aggregationMode] ?? a.aggregationMode) : (a.inputType ?? 'ספירה')}
                      </span>
                    </td>
                    <td style={{ padding: '11px 14px', color: '#374151' }}>
                      {a.maxPerDay ?? '∞'}
                    </td>
                    <td style={{ padding: '11px 14px', textAlign: 'center' }}>
                      {a.showInPortal
                        ? <span style={{ color: '#16a34a', fontWeight: 600 }}>✓</span>
                        : <span style={{ color: '#94a3b8' }}>—</span>}
                    </td>
                    <td style={{ padding: '11px 14px', textAlign: 'center' }}>
                      {a.explanationContent
                        ? <span style={{ background: '#f0fdf4', color: '#16a34a', fontSize: 11, padding: '2px 8px', borderRadius: 20 }}>יש הסבר</span>
                        : <span style={{ color: '#94a3b8', fontSize: 12 }}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {portalActions.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>
            {portalActions.length} מתוך {actions.length} פעולות מוצגות בפורטל
          </div>
        )}
      </section>

      {/* ── Section D: Portal preview ── */}
      <section style={{ borderTop: '1px solid #e2e8f0', paddingTop: 24 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>ד — תצוגה מקדימה (פורטל)</div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14 }}>
          כך ייראה תוכן זה בטאב &ldquo;חוקים&rdquo; בפורטל המשתתפות
        </div>
        <div style={{ border: '2px solid #e2e8f0', borderRadius: 14, padding: '20px', background: '#fafafa', maxWidth: 480 }}>
          {/* Simulated phone header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #e2e8f0' }}>
            <span style={{ fontSize: 16 }}>📋</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>חוקים</span>
            <span style={{ marginRight: 'auto', fontSize: 11, background: rulesPublished ? '#dcfce7' : '#fef2f2', color: rulesPublished ? '#16a34a' : '#dc2626', padding: '2px 8px', borderRadius: 20, fontWeight: 600 }}>
              {rulesPublished ? 'פורסם' : 'לא פורסם'}
            </span>
          </div>
          {!rulesPublished ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: '#94a3b8', fontSize: 13 }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>🔒</div>
              תוכן החוקים לא זמין כרגע
            </div>
          ) : rulesContent ? (
            <div
              style={{ fontSize: 14, lineHeight: 1.7, color: '#0f172a', direction: 'rtl' }}
              dangerouslySetInnerHTML={{ __html: rulesContent }}
            />
          ) : (
            <div style={{ textAlign: 'center', padding: '32px 0', color: '#94a3b8', fontSize: 13 }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>✏️</div>
              לא הוזן תוכן חוקים עדיין
            </div>
          )}
        </div>
      </section>

    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function ProgramPageInner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const rawTab = searchParams.get('tab') as TabKey | null;
  const [activeTab, setActiveTab] = useState<TabKey>(rawTab && VALID_TABS.includes(rawTab) ? rawTab : 'groups');
  const router = useRouter();

  const [program, setProgram] = useState<Program | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    apiFetch(`${BASE_URL}/programs/${id}`, { cache: 'no-store' })
      .then((data: unknown) => setProgram(data as Program))
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  function switchTab(tab: TabKey) {
    setActiveTab(tab);
    router.replace(`/admin/programs/${id}?tab=${tab}`);
  }

  if (loading) return <div className="page-wrapper" style={{ color: '#94a3b8', paddingTop: 60, textAlign: 'center' }}>טוען...</div>;
  if (notFound || !program) return (
    <div className="page-wrapper" style={{ textAlign: 'center', paddingTop: 60 }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>😕</div>
      <div style={{ color: '#374151', fontSize: 16, fontWeight: 500, marginBottom: 12 }}>תוכנית לא נמצאה</div>
      <Link href="/admin/programs" style={{ color: '#2563eb', fontSize: 14 }}>← חזרה לתוכניות</Link>
    </div>
  );

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'groups', label: 'קבוצות' },
    { key: 'offers', label: 'הצעות מכר' },
    { key: 'waitlist', label: 'רשימת המתנה' },
    { key: 'communication', label: 'נוסחים להודעות' },
    ...(program.type === 'game' ? [
      { key: 'game' as TabKey, label: 'מנוע משחק' },
      { key: 'rules' as TabKey, label: 'חוקים' },
    ] : []),
    { key: 'profile', label: 'פרטים אישיים' },
    { key: 'settings', label: 'הגדרות' },
  ];

  return (
    <div className="page-wrapper" style={{ maxWidth: 900, margin: '0 auto' }}>
      <Link href={`/programs?type=${program.type}`} style={{ color: '#64748b', fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 16 }}>
        → חזרה לרשימה
      </Link>

      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', margin: 0 }}>{program.name}</h1>
          {!program.isActive && (
            <span style={{ background: '#fef2f2', color: '#dc2626', fontSize: 12, padding: '3px 10px', borderRadius: 20 }}>לא פעיל</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ background: '#eff6ff', color: '#1d4ed8', fontSize: 12, padding: '3px 10px', borderRadius: 20, fontWeight: 500 }}>{TYPE_LABEL[program.type]}</span>
          {program.description && <span style={{ fontSize: 13, color: '#64748b' }}>{program.description}</span>}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px 10px 0 0', overflow: 'hidden' }}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => switchTab(tab.key)}
            style={{
              flex: 1, padding: '13px 8px', border: 'none',
              borderBottom: activeTab === tab.key ? '2px solid #2563eb' : '2px solid transparent',
              background: 'transparent',
              color: activeTab === tab.key ? '#2563eb' : '#64748b',
              fontWeight: activeTab === tab.key ? 600 : 400,
              fontSize: 14, cursor: 'pointer',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderTop: 'none', borderRadius: '0 0 10px 10px', padding: 24 }}>
        {activeTab === 'settings' && <SettingsTab program={program} onSaved={(updated) => setProgram(updated)} />}
        {activeTab === 'groups' && <GroupsTab program={program} />}
        {activeTab === 'game' && <GameEngineTab programId={program.id} />}
        {activeTab === 'rules' && <RulesTab program={program} onSaved={(updated) => setProgram(updated)} />}
        {activeTab === 'offers' && <ProductOffersTab programId={program.id} />}
        {activeTab === 'waitlist' && <ProductWaitlistTab programId={program.id} />}
        {activeTab === 'communication' && <ProductCommunicationTab programId={program.id} />}
        {activeTab === 'profile' && (
          <ProfileTab
            programId={program.id}
            profileTabEnabled={program.profileTabEnabled}
            onProfileTabEnabledChanged={(next) =>
              setProgram((p) => p ? { ...p, profileTabEnabled: next } : p)
            }
          />
        )}
      </div>
    </div>
  );
}

export default function ProgramPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense>
      <ProgramPageInner params={params} />
    </Suspense>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Phase 4: product-shaped tabs — Program IS the product.
// Offers / Waitlist / Communication templates live here instead of a
// parallel /admin/products area.
// ══════════════════════════════════════════════════════════════════════════════

const CARD: React.CSSProperties = {
  background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 16,
};
const INPUT_P4: React.CSSProperties = {
  width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0',
  borderRadius: 8, fontSize: 14, background: '#fff', color: '#0f172a',
  boxSizing: 'border-box' as const, fontFamily: 'inherit',
};
const LABEL_P4: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4,
};

// ─── Offers tab ─────────────────────────────────────────────────────────────
interface OfferLite {
  id: string;
  title: string;
  amount: string;
  currency: string;
  iCountPaymentUrl: string | null;
  iCountPageId: string | null;
  iCountItemName: string | null;
  iCountExternalId: string | null;
  isActive: boolean;
  defaultGroup: { id: string; name: string } | null;
  _count: { payments: number };
}

function ProductOffersTab({ programId }: { programId: string }) {
  const [offers, setOffers] = useState<OfferLite[] | null>(null);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState<OfferLite | 'new' | null>(null);
  const reload = useCallback(() => {
    apiFetch<OfferLite[]>(`${BASE_URL}/programs/${programId}/offers`, { cache: 'no-store' })
      .then(setOffers)
      .catch((e) => setErr(e instanceof Error ? e.message : 'טעינה נכשלה'));
  }, [programId]);
  useEffect(() => { reload(); }, [reload]);

  if (err) return <div style={{ color: '#b91c1c' }}>{err}</div>;
  if (!offers) return <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8' }}>טוען...</div>;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap' as const, gap: 8 }}>
        <div style={{ fontSize: 13, color: '#64748b' }}>
          {offers.length} הצעות מכר משויכות לתוכנית זו
        </div>
        <button
          onClick={() => setEditing('new')}
          style={{ padding: '8px 16px', fontSize: 13, fontWeight: 700, background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}
        >+ הצעה חדשה</button>
      </div>

      {offers.length === 0 && (
        <div style={{ ...CARD, color: '#64748b', textAlign: 'center' as const }}>
          אין הצעות מכר. צרי הצעה חדשה כדי להתחיל.
        </div>
      )}

      {offers.map((o) => (
        <div
          key={o.id}
          onClick={() => setEditing(o)}
          style={{ ...CARD, marginBottom: 8, cursor: 'pointer', opacity: o.isActive ? 1 : 0.6 }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' as const }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' as const }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{o.title}</div>
                {!o.isActive && (
                  <span style={{ background: '#f1f5f9', color: '#64748b', padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600 }}>לא פעיל</span>
                )}
                <span style={{ background: '#dbeafe', color: '#1d4ed8', padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
                  {Number(o.amount).toLocaleString('he-IL')} {o.currency}
                </span>
                {o._count.payments > 0 && (
                  <span style={{ background: '#dcfce7', color: '#15803d', padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
                    💳 {o._count.payments} תשלומים
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 10, fontSize: 12, color: '#64748b', flexWrap: 'wrap' as const }}>
                {o.defaultGroup && <span>קבוצת ברירת-מחדל: {o.defaultGroup.name}</span>}
                {o.iCountPaymentUrl && (
                  <a
                    href={o.iCountPaymentUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    style={{ color: '#2563eb' }}
                  >🔗 iCount</a>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}

      {editing && (
        <OfferModalInline
          programId={programId}
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
    </div>
  );
}

function OfferModalInline(props: {
  programId: string;
  initial: OfferLite | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!props.initial;
  const [title, setTitle] = useState(props.initial?.title ?? '');
  const [amount, setAmount] = useState(props.initial ? props.initial.amount : '');
  const [currency, setCurrency] = useState(props.initial?.currency ?? 'ILS');
  const [iCountPaymentUrl, setIcount] = useState(props.initial?.iCountPaymentUrl ?? '');
  const [iCountPageId, setICountPageId] = useState(props.initial?.iCountPageId ?? '');
  const [iCountItemName, setICountItemName] = useState(props.initial?.iCountItemName ?? '');
  const [iCountExternalId, setICountExternalId] = useState(props.initial?.iCountExternalId ?? '');
  const [defaultGroupId, setDefaultGroupId] = useState(props.initial?.defaultGroup?.id ?? '');
  const [isActive, setIsActive] = useState(props.initial?.isActive ?? true);
  const [groups, setGroups] = useState<Array<{ id: string; name: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    apiFetch<Array<{ id: string; name: string }>>(`${BASE_URL}/groups`)
      .then(setGroups).catch(() => setGroups([]));
  }, []);

  async function submit() {
    if (!title.trim()) { setErr('כותרת חובה'); return; }
    const n = parseFloat(String(amount).replace(',', '.'));
    if (!isFinite(n) || n < 0) { setErr('סכום לא תקין'); return; }
    setBusy(true); setErr('');
    try {
      const body = {
        title: title.trim(),
        amount: n,
        currency: currency.trim() || 'ILS',
        iCountPaymentUrl: iCountPaymentUrl.trim() || null,
        iCountPageId: iCountPageId.trim() || null,
        iCountItemName: iCountItemName.trim() || null,
        iCountExternalId: iCountExternalId.trim() || null,
        linkedProgramId: props.programId,
        defaultGroupId: defaultGroupId || null,
        isActive,
      };
      if (isEdit) {
        await apiFetch(`${BASE_URL}/offers/${props.initial!.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        await apiFetch(`${BASE_URL}/offers`, { method: 'POST', body: JSON.stringify(body) });
      }
      props.onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'שמירה נכשלה');
    } finally { setBusy(false); }
  }

  async function deactivate() {
    if (!props.initial || !confirm('להשבית את ההצעה? תשלומים קיימים יישמרו.')) return;
    await apiFetch(`${BASE_URL}/offers/${props.initial.id}`, { method: 'DELETE' });
    props.onSaved();
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !busy) props.onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
    >
      <div style={{ background: '#fff', borderRadius: 14, padding: 22, width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto' as const, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>{isEdit ? 'עריכת הצעה' : 'הצעה חדשה'}</div>
          <button aria-label="סגור" onClick={props.onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            <label style={LABEL_P4}>כותרת *</label>
            <input style={INPUT_P4} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="לדוגמה: מחזור מאי — 297₪" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
            <div>
              <label style={LABEL_P4}>סכום *</label>
              <input style={INPUT_P4} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
            </div>
            <div>
              <label style={LABEL_P4}>מטבע</label>
              <input style={INPUT_P4} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
            </div>
          </div>
          <div>
            <label style={LABEL_P4}>קישור iCount</label>
            <input style={INPUT_P4} dir="ltr" value={iCountPaymentUrl} onChange={(e) => setIcount(e.target.value)} placeholder="https://..." />
          </div>
          {/* iCount matching fields — used by the webhook ingester to
              resolve which offer an incoming payment belongs to. All
              optional: fill any one of them and automatic matching
              works. Leave blank and the webhook will create
              "needs_review" logs that you attach manually. */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 8 }}>
              התאמה אוטומטית ל-iCount
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ ...LABEL_P4, fontSize: 11 }}>Page ID</label>
                <input style={INPUT_P4} dir="ltr" value={iCountPageId} onChange={(e) => setICountPageId(e.target.value)} placeholder="לדוגמה: c68ea9ad..." />
              </div>
              <div>
                <label style={{ ...LABEL_P4, fontSize: 11 }}>External ID</label>
                <input style={INPUT_P4} dir="ltr" value={iCountExternalId} onChange={(e) => setICountExternalId(e.target.value)} placeholder="SKU או מזהה חיצוני" />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ ...LABEL_P4, fontSize: 11 }}>שם מוצר ב-iCount (Line item)</label>
                <input style={INPUT_P4} value={iCountItemName} onChange={(e) => setICountItemName(e.target.value)} placeholder="השם המדויק כפי שמופיע בחשבונית" />
              </div>
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>
              המערכת תנסה סדר עדיפות: Page ID → External ID → שם מוצר → קישור → סכום+מטבע ייחודיים.
            </div>
          </div>
          <div>
            <label style={LABEL_P4}>קבוצת ברירת-מחדל לשיוך אחרי תשלום</label>
            <select style={INPUT_P4} value={defaultGroupId} onChange={(e) => setDefaultGroupId(e.target.value)}>
              <option value="">— ללא —</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            הצעה פעילה
          </label>
          {err && <div style={{ color: '#b91c1c', fontSize: 13 }}>{err}</div>}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 18, alignItems: 'center' }}>
          <div>
            {isEdit && props.initial?.isActive && (
              <button onClick={deactivate} style={{ padding: '8px 14px', fontSize: 13, fontWeight: 600, background: 'transparent', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: 8, cursor: 'pointer' }}>השבת</button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={props.onClose} style={{ padding: '8px 18px', background: '#f1f5f9', border: '1px solid #e2e8f0', color: '#374151', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>ביטול</button>
            <button
              onClick={submit}
              disabled={busy}
              style={{ padding: '8px 22px', background: busy ? '#93c5fd' : '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer' }}
            >{busy ? 'שומר...' : 'שמירה'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Waitlist tab ───────────────────────────────────────────────────────────
interface WaitlistRow {
  id: string;
  source: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  participant: { id: string; firstName: string; lastName: string | null; phoneNumber: string; email: string | null; status: string | null };
}

function ProductWaitlistTab({ programId }: { programId: string }) {
  const [rows, setRows] = useState<WaitlistRow[] | null>(null);
  const [err, setErr] = useState('');
  const reload = useCallback(() => {
    apiFetch<WaitlistRow[]>(`${BASE_URL}/programs/${programId}/waitlist`, { cache: 'no-store' })
      .then(setRows)
      .catch((e) => setErr(e instanceof Error ? e.message : 'טעינה נכשלה'));
  }, [programId]);
  useEffect(() => { reload(); }, [reload]);

  async function remove(participantId: string) {
    if (!confirm('להוריד את המשתתפת מרשימת ההמתנה?')) return;
    await apiFetch(`${BASE_URL}/programs/${programId}/waitlist/${participantId}`, { method: 'DELETE' });
    reload();
  }

  if (err) return <div style={{ color: '#b91c1c' }}>{err}</div>;
  if (!rows) return <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8' }}>טוען...</div>;
  if (rows.length === 0) return (
    <div style={{ ...CARD, color: '#64748b' }}>
      אין משתתפות ברשימת ההמתנה. מילוי שאלון מסוג “רשימת המתנה” שמשויך לתוכנית זו יוסיף אוטומטית משתתפות.
    </div>
  );
  return (
    <div style={{ ...CARD, overflow: 'hidden' }}>
      {rows.map((r) => (
        <div key={r.id} style={{ padding: 14, borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' as const }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Link href={`/admin/participants/${r.participant.id}`} style={{ color: '#0f172a', textDecoration: 'none', fontWeight: 600 }}>
              {[r.participant.firstName, r.participant.lastName].filter(Boolean).join(' ')}
            </Link>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
              <span dir="ltr">{r.participant.phoneNumber}</span>
              {r.source && <> · מקור: {r.source}</>}
              {' · '}{new Date(r.createdAt).toLocaleDateString('he-IL')}
            </div>
          </div>
          <button
            onClick={() => remove(r.participant.id)}
            style={{ padding: '6px 12px', fontSize: 12, background: 'transparent', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: 7, cursor: 'pointer' }}
          >הסר</button>
        </div>
      ))}
    </div>
  );
}

// ─── Communication templates tab ────────────────────────────────────────────
interface CommTemplate {
  id: string;
  channel: 'email' | 'whatsapp';
  title: string;
  subject: string | null;
  body: string;
  isActive: boolean;
}

function ProductCommunicationTab({ programId }: { programId: string }) {
  const [rows, setRows] = useState<CommTemplate[] | null>(null);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState<CommTemplate | 'new' | null>(null);
  const reload = useCallback(() => {
    apiFetch<CommTemplate[]>(`${BASE_URL}/programs/${programId}/communication-templates`, { cache: 'no-store' })
      .then(setRows)
      .catch((e) => setErr(e instanceof Error ? e.message : 'טעינה נכשלה'));
  }, [programId]);
  useEffect(() => { reload(); }, [reload]);

  if (err) return <div style={{ color: '#b91c1c' }}>{err}</div>;
  if (!rows) return <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8' }}>טוען...</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' as const, gap: 8 }}>
        <div style={{ fontSize: 13, color: '#64748b' }}>
          משתנים: {'{firstName} {productTitle} {offerTitle} {groupName} {portalLink}'}
        </div>
        <button
          onClick={() => setEditing('new')}
          style={{ padding: '8px 16px', fontSize: 13, fontWeight: 700, background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}
        >+ תבנית</button>
      </div>

      {rows.length === 0 && <div style={{ ...CARD, color: '#64748b' }}>אין תבניות עדיין.</div>}

      {rows.map((t) => (
        <div key={t.id} onClick={() => setEditing(t)} style={{ ...CARD, marginBottom: 8, cursor: 'pointer' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' as const }}>
            <span style={{
              background: t.channel === 'email' ? '#eff6ff' : '#dcfce7',
              color: t.channel === 'email' ? '#1d4ed8' : '#15803d',
              padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700,
            }}>
              {t.channel === 'email' ? 'מייל' : 'וואטסאפ'}
            </span>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{t.title}</div>
          </div>
          {t.subject && <div style={{ fontSize: 12, color: '#475569', marginBottom: 4 }}>נושא: {t.subject}</div>}
          <div style={{ fontSize: 12, color: '#64748b', whiteSpace: 'pre-wrap' as const, maxHeight: 60, overflow: 'hidden' }}>
            {t.body.slice(0, 200)}{t.body.length > 200 ? '...' : ''}
          </div>
        </div>
      ))}

      {editing && (
        <CommTemplateModal
          programId={programId}
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
    </div>
  );
}

function CommTemplateModal(props: {
  programId: string;
  initial: CommTemplate | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!props.initial;
  const [channel, setChannel] = useState<'email' | 'whatsapp'>(props.initial?.channel ?? 'whatsapp');
  const [title, setTitle] = useState(props.initial?.title ?? '');
  const [subject, setSubject] = useState(props.initial?.subject ?? '');
  const [body, setBody] = useState(props.initial?.body ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // Shared imperative ref — both WhatsAppEditor and RichContentEditor
  // expose the same { insertAtCursor, focus } surface, so the variable
  // bar doesn't need to know which editor is mounted.
  const editorHandleRef = useRef<VariableEditorHandle | null>(null);

  async function save() {
    if (!title.trim() || !body.trim()) { setErr('חובה למלא שם וגוף ההודעה'); return; }
    setBusy(true); setErr('');
    try {
      const payload = {
        channel,
        title: title.trim(),
        subject: channel === 'email' ? (subject.trim() || null) : null,
        body,
      };
      if (isEdit) {
        await apiFetch(`${BASE_URL}/communication-templates/${props.initial!.id}`, {
          method: 'PATCH', body: JSON.stringify(payload),
        });
      } else {
        await apiFetch(`${BASE_URL}/programs/${props.programId}/communication-templates`, {
          method: 'POST', body: JSON.stringify(payload),
        });
      }
      props.onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'שמירה נכשלה');
    } finally { setBusy(false); }
  }

  async function deactivate() {
    if (!props.initial || !confirm('להשבית את התבנית?')) return;
    await apiFetch(`${BASE_URL}/communication-templates/${props.initial.id}`, { method: 'DELETE' });
    props.onSaved();
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !busy) props.onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
    >
      <div style={{ background: '#fff', borderRadius: 14, padding: 22, width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' as const, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>{isEdit ? 'עריכת תבנית' : 'תבנית חדשה'}</div>
          <button aria-label="סגור" onClick={props.onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            <label style={LABEL_P4}>ערוץ</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['whatsapp', 'email'] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setChannel(c)}
                  style={{
                    flex: 1, padding: '9px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    border: `2px solid ${channel === c ? '#2563eb' : '#e2e8f0'}`,
                    background: channel === c ? '#eff6ff' : '#fff',
                    color: channel === c ? '#2563eb' : '#374151',
                    borderRadius: 7,
                  }}
                >{c === 'whatsapp' ? 'וואטסאפ' : 'מייל'}</button>
              ))}
            </div>
          </div>
          <div>
            <label style={LABEL_P4}>שם התבנית *</label>
            <input style={INPUT_P4} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="ברוכה הבאה אחרי תשלום" />
          </div>
          {channel === 'email' && (
            <div>
              <label style={LABEL_P4}>נושא</label>
              <input style={INPUT_P4} value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
          )}
          <div>
            <label style={LABEL_P4}>גוף ההודעה *</label>
            {/* Variable bar sits directly above the editor and calls the
                shared imperative handle on click. The two editors have
                different internals but the same { insertAtCursor, focus }
                surface, so the bar doesn't need channel awareness. */}
            <VariableButtonBar editorRef={editorHandleRef} />
            {channel === 'whatsapp' ? (
              <WhatsAppEditor
                ref={editorHandleRef}
                value={body}
                onChange={setBody}
                placeholder="שלום {firstName}!&#10;ברוכה הבאה ל-{productTitle}.&#10;הקישור לפורטל: {portalLink}"
                minHeight={180}
              />
            ) : (
              <RichContentEditor
                ref={editorHandleRef}
                value={body}
                onChange={setBody}
                placeholder="שלום {firstName}!&#10;ברוכה הבאה ל-{productTitle}."
                minHeight={220}
              />
            )}
          </div>
          {err && <div style={{ color: '#b91c1c', fontSize: 13 }}>{err}</div>}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 18 }}>
          <div>
            {isEdit && (
              <button onClick={deactivate} style={{ padding: '8px 14px', fontSize: 13, fontWeight: 600, background: 'transparent', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: 8, cursor: 'pointer' }}>השבת</button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={props.onClose} style={{ padding: '8px 18px', background: '#f1f5f9', border: '1px solid #e2e8f0', color: '#374151', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>ביטול</button>
            <button
              onClick={save}
              disabled={busy}
              style={{ padding: '8px 22px', background: busy ? '#93c5fd' : '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer' }}
            >{busy ? 'שומר...' : 'שמירה'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
