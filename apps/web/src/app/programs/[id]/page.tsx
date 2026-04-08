'use client';

import { Suspense, use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { BASE_URL, apiFetch } from '@lib/api';
import WhatsAppEditor from '@components/whatsapp-editor';
import RichContentEditor from '@components/rich-content-editor';

// ─── Types ────────────────────────────────────────────────────────────────────

type ProgramType = 'challenge' | 'game' | 'group_coaching' | 'personal_coaching';
type GroupStatus = 'active' | 'inactive';
type TabKey = 'settings' | 'groups' | 'game' | 'leaderboard' | 'templates';

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
  groups: Group[];
  showIndividualLeaderboard: boolean;
  showGroupComparison: boolean;
  showOtherGroupsCharts: boolean;
  showOtherGroupsMemberDetails: boolean;
  rulesContent: string | null;
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

const VALID_TABS: TabKey[] = ['settings', 'groups', 'game', 'leaderboard', 'templates'];

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

  const [rulesContent, setRulesContent] = useState(program.rulesContent ?? '');
  const [rulesSaving, setRulesSaving] = useState(false);
  const [rulesSaved, setRulesSaved] = useState(false);

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

  async function handleSaveRules() {
    setRulesSaving(true);
    try {
      await apiFetch(`${BASE_URL}/programs/${program.id}`, {
        method: 'PATCH',
        cache: 'no-store',
        body: JSON.stringify({ rulesContent: rulesContent || null }),
      });
      onSaved({ ...program, rulesContent: rulesContent || null });
      setRulesSaved(true);
      setTimeout(() => setRulesSaved(false), 2500);
    } finally { setRulesSaving(false); }
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

      {/* ── Rules rich content ── */}
      <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div>
          <label style={labelStyle}>תוכן חוקים לפורטל המשתתפות</label>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
            תוכן זה יוצג בטאב &ldquo;חוקים&rdquo; בפורטל — כחלק ממסמך ההסברים לתוכנית. ניתן לכלול כותרות, רשימות, קישורים וטקסט מעוצב.
          </div>
        </div>
        <RichContentEditor
          value={rulesContent}
          onChange={(v) => { setRulesContent(v); setRulesSaved(false); }}
          placeholder="הוסיפי כאן את ההסברים, הכללים וההנחיות לתוכנית..."
          minHeight={200}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
          <button
            onClick={handleSaveRules}
            disabled={rulesSaving}
            style={{ background: rulesSaving ? '#93c5fd' : '#2563eb', color: '#fff', border: 'none', borderRadius: 7, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: rulesSaving ? 'not-allowed' : 'pointer' }}
          >
            {rulesSaving ? 'שומר...' : 'שמור תוכן חוקים'}
          </button>
          {rulesSaved && <span style={{ color: '#16a34a', fontSize: 13 }}>✓ נשמר</span>}
        </div>
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

function GroupsTab({ program }: { program: Program }) {
  const [groups, setGroups] = useState<Group[]>(program.groups ?? []);
  const [createModal, setCreateModal] = useState(false);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ fontSize: 13, color: '#64748b' }}>{groups.length} קבוצות</span>
        <button
          onClick={() => setCreateModal(true)}
          style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 7, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          + צור קבוצה
        </button>
      </div>

      {groups.length === 0 && (
        <div style={{ padding: '40px 24px', textAlign: 'center', border: '2px dashed #e2e8f0', borderRadius: 10, color: '#94a3b8', fontSize: 14 }}>
          אין קבוצות עדיין — צרי קבוצה ראשונה
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {groups.map((g) => (
          <Link key={g.id} href={`/groups/${g.id}`} style={{ textDecoration: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '14px 18px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{g.name}</span>
                  <span style={{
                    background: g.status === 'active' ? '#f0fdf4' : '#f1f5f9',
                    color: g.status === 'active' ? '#15803d' : '#64748b',
                    fontSize: 11, padding: '2px 8px', borderRadius: 20,
                  }}>
                    {STATUS_LABEL[g.status]}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: '#94a3b8' }}>
                  {formatDate(g.startDate)} — {formatDate(g.endDate)}
                  {' · '}
                  {g._count?.participantGroups ?? 0} משתתפות
                </div>
              </div>
              <span style={{ color: '#94a3b8', fontSize: 18, flexShrink: 0 }}>›</span>
            </div>
          </Link>
        ))}
      </div>

      {createModal && (
        <CreateGroupModal
          programId={program.id}
          onCreated={(g) => {
            setGroups((prev) => [{ ...g, _count: { participantGroups: 0 } }, ...prev]);
            setCreateModal(false);
          }}
          onClose={() => setCreateModal(false)}
        />
      )}
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
  maxPerDay: number | null;
  showInPortal: boolean;
  blockedMessage: string | null;
  explanationContent: string | null;
  isActive: boolean;
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

// ─── Action Modal ─────────────────────────────────────────────────────────────

function ActionModal({
  programId, action, onSaved, onClose,
}: {
  programId: string;
  action: GameAction | null;
  onSaved: (a: GameAction) => void;
  onClose: () => void;
}) {
  const initialForm = useRef({
    name: action?.name ?? '',
    description: action?.description ?? '',
    inputType: action?.inputType ?? 'boolean',
    aggregationMode: action?.aggregationMode ?? 'none',
    unit: action?.unit ?? '',
    points: String(action?.points ?? 10),
    maxPerDay: action?.maxPerDay != null ? String(action.maxPerDay) : '',
    showInPortal: action?.showInPortal ?? true,
    blockedMessage: action?.blockedMessage ?? '',
    explanationContent: action?.explanationContent ?? '',
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

  // Derived: participant-facing preview values
  const previewInputPrompt =
    form.inputType === 'number' && form.aggregationMode === 'latest_value' ? 'כמה הגעת עד עכשיו?' :
    form.inputType === 'number' && form.aggregationMode === 'incremental_sum' ? 'כמה להוסיף עכשיו?' :
    'האם ביצעת פעולה זו?';
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
    setSaving(true); setError('');
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        inputType: form.inputType,
        aggregationMode: form.inputType === 'number' ? form.aggregationMode : 'none',
        unit: form.inputType === 'number' ? (form.unit.trim() || null) : null,
        points: pts,
        // CRITICAL FIX: send null (not undefined) to properly clear maxPerDay in DB
        maxPerDay: form.maxPerDay.trim() ? parseInt(form.maxPerDay) : null,
        showInPortal: form.showInPortal,
        blockedMessage: form.blockedMessage.trim() || null,
        explanationContent: form.explanationContent.trim() || null,
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
              <select style={inputStyle} value={form.inputType} onChange={(e) => setForm((p) => ({ ...p, inputType: e.target.value, aggregationMode: e.target.value === 'number' ? (p.aggregationMode === 'none' ? 'latest_value' : p.aggregationMode) : 'none' }))}>
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
                <div>
                  <label style={labelStyle}>שיטת מעקב מספרי</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                    {([
                      {
                        value: 'latest_value',
                        label: 'סה״כ שוטף — המשתתפת מדווחת כמה יש לה עד עכשיו',
                        desc: 'כל דיווח מחליף את הקודם. לא ניתן לרדת. מתאים לצעדים, משקל, ק״מ.',
                        example: 'דוגמה: "הגעת ל-7,500 צעדים?" → 7500',
                      },
                      {
                        value: 'incremental_sum',
                        label: 'הוספה — המשתתפת מדווחת כמה עשתה עכשיו',
                        desc: 'כל דיווח מצטרף לסכום היומי. מתאים לכוסות מים, סבבים, אימונים.',
                        example: 'דוגמה: "כמה כוסות שתית?" → 2 (ועוד 3 בפעם הבאה = 5 ביום)',
                      },
                    ] as const).map((opt) => (
                      <label key={opt.value} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', padding: '10px 12px', border: `1.5px solid ${form.aggregationMode === opt.value ? '#2563eb' : '#e2e8f0'}`, borderRadius: 8, background: form.aggregationMode === opt.value ? '#eff6ff' : '#fff' }}>
                        <input type="radio" name="aggregationMode" value={opt.value} checked={form.aggregationMode === opt.value} onChange={() => setForm((p) => ({ ...p, aggregationMode: opt.value }))} style={{ marginTop: 3, flexShrink: 0 }} />
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{opt.label}</div>
                          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2, lineHeight: 1.5 }}>{opt.desc}</div>
                          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2, fontStyle: 'italic' }}>{opt.example}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label style={labelStyle}>יחידת מידה (אופציונלי)</label>
                  <input style={inputStyle} value={form.unit} onChange={(e) => setForm((p) => ({ ...p, unit: e.target.value }))} placeholder="צעדים · קומות · דקות · כוסות · ק״מ" />
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>מוצגת בפורטל וברשימת החוקים</div>
                </div>
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

// ─── Templates Tab ───────────────────────────────────────────────────────────

interface MessageTemplate {
  id: string;
  name: string;
  content: string;
  createdAt: string;
}

type TemplateModalMode = 'create' | 'edit';

function TemplatesTab({ programId }: { programId: string }) {
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ open: boolean; mode: TemplateModalMode; tmpl: MessageTemplate | null }>({ open: false, mode: 'create', tmpl: null });
  const [deleteTarget, setDeleteTarget] = useState<MessageTemplate | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    apiFetch(`${BASE_URL}/programs/${programId}/templates`, { cache: 'no-store' })
      .then((d) => setTemplates(d as MessageTemplate[]))
      .finally(() => setLoading(false));
  }, [programId]);

  async function handleDelete(tmpl: MessageTemplate) {
    setDeleting(true);
    try {
      await apiFetch(`${BASE_URL}/programs/${programId}/templates/${tmpl.id}`, { method: 'DELETE', cache: 'no-store' });
      setTemplates((prev) => prev.filter((t) => t.id !== tmpl.id));
      setDeleteTarget(null);
    } finally { setDeleting(false); }
  }

  if (loading) return <div style={{ color: '#94a3b8', textAlign: 'center', padding: 48 }}>טוען...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: '0 0 2px' }}>נוסחי הודעות</h3>
          <p style={{ fontSize: 12, color: '#94a3b8', margin: 0 }}>תבניות הודעה לשימוש חוזר בשליחת הודעות לקבוצות</p>
        </div>
        <button
          onClick={() => setModal({ open: true, mode: 'create', tmpl: null })}
          style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 7, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          + נוסח חדש
        </button>
      </div>

      {templates.length === 0 ? (
        <div style={{ padding: '36px 24px', textAlign: 'center', border: '2px dashed #e2e8f0', borderRadius: 10 }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>📝</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#374151', marginBottom: 6 }}>אין נוסחים עדיין</div>
          <div style={{ fontSize: 13, color: '#94a3b8', maxWidth: 280, margin: '0 auto' }}>
            צרי נוסחים לשימוש חוזר — ברכות, תזכורות, הנחיות שגרתיות ועוד.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {templates.map((tmpl) => (
            <div key={tmpl.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 14, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '14px 18px' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', marginBottom: 4 }}>{tmpl.name}</div>
                <div style={{ fontSize: 13, color: '#64748b', whiteSpace: 'pre-wrap', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const }}>
                  {tmpl.content}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button
                  onClick={() => setModal({ open: true, mode: 'edit', tmpl })}
                  style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 14px', fontSize: 12, color: '#374151', cursor: 'pointer', fontWeight: 500 }}
                >
                  ערוך
                </button>
                <button
                  onClick={() => setDeleteTarget(tmpl)}
                  style={{ background: 'none', border: '1px solid #fecaca', borderRadius: 6, padding: '6px 10px', fontSize: 12, color: '#dc2626', cursor: 'pointer' }}
                  title="מחק נוסח"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Create / Edit modal ── */}
      {modal.open && (
        <TemplateEditorModal
          programId={programId}
          mode={modal.mode}
          tmpl={modal.tmpl}
          onSaved={(saved) => {
            setTemplates((prev) =>
              modal.mode === 'edit'
                ? prev.map((t) => t.id === saved.id ? saved : t)
                : [...prev, saved],
            );
            setModal({ open: false, mode: 'create', tmpl: null });
          }}
          onClose={() => setModal({ open: false, mode: 'create', tmpl: null })}
        />
      )}

      {/* ── Delete confirm ── */}
      {deleteTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, maxWidth: 360, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: '0 0 10px' }}>מחיקת נוסח</h3>
            <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 20px' }}>
              למחוק את הנוסח <strong>&ldquo;{deleteTarget.name}&rdquo;</strong>? לא ניתן לשחזר.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setDeleteTarget(null)} style={{ background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>ביטול</button>
              <button
                onClick={() => handleDelete(deleteTarget)}
                disabled={deleting}
                style={{ background: deleting ? '#fca5a5' : '#dc2626', color: '#fff', border: 'none', borderRadius: 7, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: deleting ? 'not-allowed' : 'pointer' }}
              >
                {deleting ? 'מוחק...' : 'מחק'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TemplateEditorModal({
  programId, mode, tmpl, onSaved, onClose,
}: {
  programId: string;
  mode: TemplateModalMode;
  tmpl: MessageTemplate | null;
  onSaved: (t: MessageTemplate) => void;
  onClose: () => void;
}) {
  const initialName = tmpl?.name ?? '';
  const initialContent = tmpl?.content ?? '';
  const [name, setName] = useState(initialName);
  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showUnsaved, setShowUnsaved] = useState(false);

  function isDirty() {
    return name !== initialName || content !== initialContent;
  }

  function handleClose() {
    if (isDirty()) setShowUnsaved(true);
    else onClose();
  }

  async function submitForm(): Promise<boolean> {
    if (!name.trim()) { setError('שם הוא שדה חובה'); return false; }
    if (!content.trim()) { setError('תוכן הוא שדה חובה'); return false; }
    setSaving(true); setError('');
    try {
      const url = mode === 'edit' && tmpl
        ? `${BASE_URL}/programs/${programId}/templates/${tmpl.id}`
        : `${BASE_URL}/programs/${programId}/templates`;
      onSaved(await apiFetch(url, {
        method: mode === 'edit' ? 'PATCH' : 'POST',
        cache: 'no-store',
        body: JSON.stringify({ name: name.trim(), content: content.trim() }),
      }) as MessageTemplate);
      return true;
    } catch {
      setError('שגיאה בשמירה. נסי שוב.');
      return false;
    } finally { setSaving(false); }
  }

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20, overflowY: 'auto' }}>
        <div style={{ background: '#fff', borderRadius: 14, padding: 28, width: '100%', maxWidth: 540, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', maxHeight: '92vh', overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', margin: 0 }}>
              {mode === 'edit' ? 'עריכת נוסח' : 'נוסח חדש'}
            </h2>
            <button onClick={handleClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#94a3b8', lineHeight: 1 }}>×</button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>שם הנוסח *</label>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="לדוגמה: ברכת בוקר, תזכורת יומית..."
                style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 7, padding: '9px 12px', fontSize: 14, boxSizing: 'border-box' as const, outline: 'none' }}
              />
            </div>

            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>תוכן ההודעה *</label>
              <WhatsAppEditor
                value={content}
                onChange={setContent}
                placeholder="כתבי את תוכן הנוסח כאן..."
                minHeight={160}
              />
            </div>

            {error && <div style={{ color: '#dc2626', fontSize: 13, background: '#fef2f2', padding: '8px 12px', borderRadius: 7 }}>{error}</div>}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" onClick={handleClose} style={{ background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 7, padding: '9px 18px', fontSize: 13, cursor: 'pointer' }}>ביטול</button>
              <button
                onClick={() => submitForm()}
                disabled={saving}
                style={{ background: saving ? '#93c5fd' : '#2563eb', color: '#fff', border: 'none', borderRadius: 7, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer' }}
              >
                {saving ? 'שומר...' : 'שמירה'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {showUnsaved && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, maxWidth: 320, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: '0 0 8px' }}>שינויים לא שמורים</h3>
            <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 20px', lineHeight: 1.5 }}>יש שינויים שעדיין לא נשמרו. מה לעשות?</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button disabled={saving} onClick={async () => { const ok = await submitForm(); if (ok) setShowUnsaved(false); }} style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 7, padding: '10px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', textAlign: 'center' as const }}>
                {saving ? 'שומר...' : 'שמור ויצא'}
              </button>
              <button onClick={() => { setShowUnsaved(false); onClose(); }} style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 7, padding: '10px 16px', fontSize: 13, cursor: 'pointer', textAlign: 'center' as const }}>
                בטל שינויים
              </button>
              <button onClick={() => setShowUnsaved(false)} style={{ background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 7, padding: '10px 16px', fontSize: 13, cursor: 'pointer', textAlign: 'center' as const }}>
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

function GameEngineTab({ programId }: { programId: string }) {
  const [actions, setActions] = useState<GameAction[]>([]);
  const [rules, setRules] = useState<GameRule[]>([]);
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
    ]).then(([a, r]) => {
      setActions((a as GameAction[]).filter((x) => x.isActive));
      setRules((r as GameRule[]).filter((x) => x.isActive));
    }).finally(() => setLoading(false));
  }, [programId]);

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
            {actions.map((a) => (
              <div key={a.id} style={{ display: 'flex', flexDirection: 'column', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '14px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
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
            {rules.map((r) => {
              const typeIcons: Record<string, string> = { daily_bonus: '☀️', streak: '🔥', conditional: '⚡' };
              const desc = ruleDescription(r, actions);
              const activation = activationDescription(r);
              return (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 14, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '14px 18px' }}>
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

// ─── Leaderboard Tab ──────────────────────────────────────────────────────────

interface GroupRankRow {
  groupId: string;
  groupName: string;
  totalScore: number;
  todayScore: number;
  weekScore: number;
  participantCount: number;
  averageScorePerParticipant: number;
  rank: number;
}

interface ParticipantRankRow {
  participantId: string;
  firstName: string;
  lastName: string | null;
  totalScore: number;
  todayScore: number;
  weekScore: number;
  currentStreak: number;
  rank: number;
}

interface ProgramSummary {
  totalGroups: number;
  totalParticipants: number;
  totalScoreEvents: number;
  highestScoringGroup: { groupId: string | null; groupName: string | null; totalScore: number };
  highestScoringParticipant: { participantId: string | null; firstName: string | null; totalScore: number };
  averageScorePerGroup: number;
  averageScorePerParticipant: number;
}

function LeaderboardTab({ program, onVisibilityChange }: {
  program: Program;
  onVisibilityChange: (updated: Program) => void;
}) {
  const [groupRanks, setGroupRanks] = useState<GroupRankRow[]>([]);
  const [participantRanks, setParticipantRanks] = useState<ParticipantRankRow[]>([]);
  const [summary, setSummary] = useState<ProgramSummary | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string>('');
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [loadingParticipants, setLoadingParticipants] = useState(false);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [savingVis, setSavingVis] = useState(false);
  const [visSaved, setVisSaved] = useState(false);
  const [vis, setVis] = useState({
    showIndividualLeaderboard: program.showIndividualLeaderboard,
    showGroupComparison: program.showGroupComparison,
    showOtherGroupsCharts: program.showOtherGroupsCharts,
    showOtherGroupsMemberDetails: program.showOtherGroupsMemberDetails,
  });

  // Load group ranking and summary on mount
  useEffect(() => {
    setLoadingGroups(true);
    apiFetch(`${BASE_URL}/game/leaderboard/program/${program.id}/groups`, { cache: 'no-store' })
      .then((d: unknown) => setGroupRanks(d as GroupRankRow[]))
      .catch(() => {})
      .finally(() => setLoadingGroups(false));

    setLoadingSummary(true);
    apiFetch(`${BASE_URL}/game/leaderboard/program/${program.id}/summary`, { cache: 'no-store' })
      .then((d: unknown) => setSummary(d as ProgramSummary))
      .catch(() => {})
      .finally(() => setLoadingSummary(false));
  }, [program.id]);

  // Load participant ranking when group changes
  useEffect(() => {
    if (!selectedGroupId) { setParticipantRanks([]); return; }
    setLoadingParticipants(true);
    apiFetch(`${BASE_URL}/game/leaderboard/group/${selectedGroupId}`, { cache: 'no-store' })
      .then((d: unknown) => setParticipantRanks(d as ParticipantRankRow[]))
      .catch(() => {})
      .finally(() => setLoadingParticipants(false));
  }, [selectedGroupId]);

  async function saveVisibility() {
    setSavingVis(true); setVisSaved(false);
    try {
      const updated = await apiFetch(`${BASE_URL}/programs/${program.id}`, {
        method: 'PATCH',
        cache: 'no-store',
        body: JSON.stringify(vis),
      }) as Program;
      onVisibilityChange(updated);
      setVisSaved(true);
    } finally { setSavingVis(false); }
  }

  function refreshGroupRanks() {
    setLoadingGroups(true);
    apiFetch(`${BASE_URL}/game/leaderboard/program/${program.id}/groups`, { cache: 'no-store' })
      .then((d: unknown) => setGroupRanks(d as GroupRankRow[]))
      .catch(() => {})
      .finally(() => setLoadingGroups(false));
  }

  function refreshParticipantRanks() {
    if (!selectedGroupId) return;
    setLoadingParticipants(true);
    apiFetch(`${BASE_URL}/game/leaderboard/group/${selectedGroupId}`, { cache: 'no-store' })
      .then((d: unknown) => setParticipantRanks(d as ParticipantRankRow[]))
      .catch(() => {})
      .finally(() => setLoadingParticipants(false));
  }

  const medalColor = (rank: number) => rank === 1 ? '#f59e0b' : rank === 2 ? '#94a3b8' : rank === 3 ? '#b45309' : '#e2e8f0';
  const medalText = (rank: number) => rank === 1 ? '#fff' : rank === 2 ? '#fff' : rank === 3 ? '#fff' : '#64748b';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>

      {/* ── Summary stats ── */}
      {summary && (
        <section>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', margin: '0 0 14px' }}>סיכום תוכנית</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
            {[
              { label: 'קבוצות', value: summary.totalGroups },
              { label: 'משתתפות', value: summary.totalParticipants },
              { label: 'אירועי ניקוד', value: summary.totalScoreEvents },
              { label: 'ממוצע לקבוצה', value: summary.averageScorePerGroup + ' נק׳' },
              { label: 'ממוצע למשתתפת', value: summary.averageScorePerParticipant + ' נק׳' },
            ].map((s) => (
              <div key={s.label} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '14px 16px' }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', lineHeight: 1 }}>{s.value}</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{s.label}</div>
              </div>
            ))}
            {summary.highestScoringGroup.groupName && (
              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '14px 16px' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#92400e', lineHeight: 1.3 }}>{summary.highestScoringGroup.groupName}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#b45309' }}>{summary.highestScoringGroup.totalScore} נק׳</div>
                <div style={{ fontSize: 11, color: '#a16207', marginTop: 2 }}>קבוצה מובילה</div>
              </div>
            )}
            {summary.highestScoringParticipant.firstName && (
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '14px 16px' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#14532d', lineHeight: 1.3 }}>{summary.highestScoringParticipant.firstName}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#15803d' }}>{summary.highestScoringParticipant.totalScore} נק׳</div>
                <div style={{ fontSize: 11, color: '#166534', marginTop: 2 }}>משתתפת מובילה</div>
              </div>
            )}
          </div>
        </section>
      )}
      {loadingSummary && <div style={{ color: '#94a3b8', fontSize: 13 }}>טוען סיכום...</div>}

      {/* ── Group ranking ── */}
      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', margin: 0 }}>דירוג קבוצות</h3>
          <button
            onClick={refreshGroupRanks}
            style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 12px', fontSize: 12, color: '#374151', cursor: 'pointer' }}
          >
            ↻ רענן
          </button>
        </div>

        {loadingGroups && <div style={{ color: '#94a3b8', fontSize: 13 }}>טוען דירוג קבוצות...</div>}
        {!loadingGroups && groupRanks.length === 0 && (
          <div style={{ padding: '32px 24px', textAlign: 'center', border: '2px dashed #e2e8f0', borderRadius: 10, color: '#94a3b8', fontSize: 13 }}>
            אין נתוני ניקוד לקבוצות עדיין
          </div>
        )}
        {!loadingGroups && groupRanks.length > 0 && (
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#64748b', width: 40 }}>#</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#64748b' }}>קבוצה</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#64748b' }}>סה״כ</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#64748b' }}>השבוע</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#64748b' }}>היום</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#64748b' }}>משתתפות</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#64748b' }}>ממוצע</th>
                </tr>
              </thead>
              <tbody>
                {groupRanks.map((g) => (
                  <tr key={g.groupId} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '11px 14px' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: '50%', background: medalColor(g.rank), color: medalText(g.rank), fontSize: 12, fontWeight: 700 }}>
                        {g.rank}
                      </span>
                    </td>
                    <td style={{ padding: '11px 14px', fontWeight: 600, color: '#0f172a' }}>{g.groupName}</td>
                    <td style={{ padding: '11px 14px', fontWeight: 700, color: '#2563eb' }}>{g.totalScore}</td>
                    <td style={{ padding: '11px 14px', color: '#374151' }}>{g.weekScore}</td>
                    <td style={{ padding: '11px 14px', color: '#374151' }}>{g.todayScore}</td>
                    <td style={{ padding: '11px 14px', color: '#374151' }}>{g.participantCount}</td>
                    <td style={{ padding: '11px 14px', color: '#374151' }}>{g.averageScorePerParticipant}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Participant ranking ── */}
      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', margin: 0 }}>דירוג משתתפות בקבוצה</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select
              style={{ ...inputStyle, width: 'auto', minWidth: 160, fontSize: 13, padding: '7px 12px' }}
              value={selectedGroupId}
              onChange={(e) => setSelectedGroupId(e.target.value)}
            >
              <option value="">— בחרי קבוצה —</option>
              {program.groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
            {selectedGroupId && (
              <button
                onClick={refreshParticipantRanks}
                style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 12px', fontSize: 12, color: '#374151', cursor: 'pointer' }}
              >
                ↻ רענן
              </button>
            )}
          </div>
        </div>

        {!selectedGroupId && (
          <div style={{ padding: '32px 24px', textAlign: 'center', border: '2px dashed #e2e8f0', borderRadius: 10, color: '#94a3b8', fontSize: 13 }}>
            בחרי קבוצה כדי לראות את הדירוג הפנימי
          </div>
        )}
        {selectedGroupId && loadingParticipants && <div style={{ color: '#94a3b8', fontSize: 13 }}>טוען דירוג משתתפות...</div>}
        {selectedGroupId && !loadingParticipants && participantRanks.length === 0 && (
          <div style={{ padding: '32px 24px', textAlign: 'center', border: '2px dashed #e2e8f0', borderRadius: 10, color: '#94a3b8', fontSize: 13 }}>
            אין נתוני ניקוד לקבוצה זו עדיין
          </div>
        )}
        {selectedGroupId && !loadingParticipants && participantRanks.length > 0 && (
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#64748b', width: 40 }}>#</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#64748b' }}>שם</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#64748b' }}>סה״כ</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#64748b' }}>השבוע</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#64748b' }}>היום</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#64748b' }}>רצף</th>
                </tr>
              </thead>
              <tbody>
                {participantRanks.map((p) => (
                  <tr key={p.participantId} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '11px 14px' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: '50%', background: medalColor(p.rank), color: medalText(p.rank), fontSize: 12, fontWeight: 700 }}>
                        {p.rank}
                      </span>
                    </td>
                    <td style={{ padding: '11px 14px', fontWeight: 600, color: '#0f172a' }}>
                      {p.firstName}{p.lastName ? ' ' + p.lastName : ''}
                    </td>
                    <td style={{ padding: '11px 14px', fontWeight: 700, color: '#2563eb' }}>{p.totalScore}</td>
                    <td style={{ padding: '11px 14px', color: '#374151' }}>{p.weekScore}</td>
                    <td style={{ padding: '11px 14px', color: '#374151' }}>{p.todayScore}</td>
                    <td style={{ padding: '11px 14px' }}>
                      {p.currentStreak > 0
                        ? <span style={{ background: '#fff7ed', color: '#c2410c', fontSize: 12, padding: '2px 8px', borderRadius: 20 }}>🔥 {p.currentStreak}</span>
                        : <span style={{ color: '#94a3b8' }}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Visibility settings ── */}
      <section style={{ borderTop: '1px solid #e2e8f0', paddingTop: 28 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', margin: '0 0 6px' }}>הגדרות חשיפה למשתתפות</h3>
        <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 18px', lineHeight: 1.5 }}>
          שלטי הצגה אלו יקבעו מה רואות המשתתפות בממשק שלהן. המנהל תמיד רואה הכל.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 18 }}>
          <button
            onClick={saveVisibility}
            disabled={savingVis}
            style={{ background: savingVis ? '#93c5fd' : '#2563eb', color: '#fff', border: 'none', borderRadius: 7, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: savingVis ? 'not-allowed' : 'pointer' }}
          >
            {savingVis ? 'שומר...' : 'שמור הגדרות'}
          </button>
          {visSaved && <span style={{ color: '#16a34a', fontSize: 13 }}>✓ נשמר</span>}
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
    router.replace(`/programs/${id}?tab=${tab}`);
  }

  if (loading) return <div className="page-wrapper" style={{ color: '#94a3b8', paddingTop: 60, textAlign: 'center' }}>טוען...</div>;
  if (notFound || !program) return (
    <div className="page-wrapper" style={{ textAlign: 'center', paddingTop: 60 }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>😕</div>
      <div style={{ color: '#374151', fontSize: 16, fontWeight: 500, marginBottom: 12 }}>תוכנית לא נמצאה</div>
      <Link href="/programs" style={{ color: '#2563eb', fontSize: 14 }}>← חזרה לתוכניות</Link>
    </div>
  );

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'groups', label: 'קבוצות' },
    ...(program.type === 'game' ? [
      { key: 'game' as TabKey, label: 'מנוע משחק' },
      { key: 'leaderboard' as TabKey, label: 'דירוגים' },
    ] : []),
    { key: 'templates', label: 'נוסחים' },
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
        {activeTab === 'templates' && <TemplatesTab programId={program.id} />}
        {activeTab === 'leaderboard' && (
          <LeaderboardTab
            program={program}
            onVisibilityChange={(updated) => setProgram((p) => p ? { ...p, ...updated } : p)}
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
