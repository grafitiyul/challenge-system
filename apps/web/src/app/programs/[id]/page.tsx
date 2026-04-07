'use client';

import { Suspense, use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { BASE_URL } from '@lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

type ProgramType = 'challenge' | 'game' | 'group_coaching' | 'personal_coaching';
type GroupStatus = 'active' | 'inactive';
type TabKey = 'settings' | 'groups' | 'game';

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

const VALID_TABS: TabKey[] = ['settings', 'groups', 'game'];

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

  async function handleSave() {
    if (!form.name.trim()) { setError('שם הוא שדה חובה'); return; }
    setSaving(true); setError('');
    try {
      const res = await fetch(`${BASE_URL}/programs/${program.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ name: form.name.trim(), description: form.description.trim() || undefined, isActive: form.isActive }),
      });
      if (!res.ok) { setError('שגיאה בשמירה'); return; }
      const updated = await res.json() as Program;
      onSaved({ ...program, ...updated });
      setSaved(true);
    } finally { setSaving(false); }
  }

  return (
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
      const res = await fetch(`${BASE_URL}/programs/${programId}/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ name: name.trim(), startDate: startDate || undefined, endDate: endDate || undefined, status }),
      });
      if (!res.ok) { setError('שגיאה ביצירת הקבוצה'); return; }
      const created = await res.json() as Group;
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
  points: number;
  maxPerDay: number | null;
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
    const action = actions.find((a) => a.id === actionId);
    return action ? `${ptsStr} כאשר מדווחים על "${action.name}"` : `${ptsStr} בהתקיים תנאי`;
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
  const [form, setForm] = useState({
    name: action?.name ?? '',
    description: action?.description ?? '',
    inputType: action?.inputType ?? 'boolean',
    points: String(action?.points ?? 10),
    maxPerDay: String(action?.maxPerDay ?? ''),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError('שם הוא שדה חובה'); return; }
    const pts = parseInt(form.points);
    if (isNaN(pts) || pts < 0) { setError('נקודות חייבות להיות מספר חיובי'); return; }
    setSaving(true); setError('');
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        inputType: form.inputType,
        points: pts,
        maxPerDay: form.maxPerDay ? parseInt(form.maxPerDay) : undefined,
      };
      const url = action
        ? `${BASE_URL}/game/programs/${programId}/actions/${action.id}`
        : `${BASE_URL}/game/programs/${programId}/actions`;
      const res = await fetch(url, {
        method: action ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify(body),
      });
      if (!res.ok) { setError('שגיאה בשמירה'); return; }
      onSaved(await res.json() as GameAction);
    } finally { setSaving(false); }
  }

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 14, padding: 28, width: '100%', maxWidth: 440, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', margin: 0 }}>{action ? 'עריכת פעולה' : 'פעולה חדשה'}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#94a3b8' }}>×</button>
        </div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={labelStyle}>שם הפעולה *</label>
            <input style={inputStyle} value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} autoFocus placeholder="לדוגמה: צ׳ק-אין יומי" />
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>שם שיוצג למנהל ויזוהה בדוחות</div>
          </div>
          <div>
            <label style={labelStyle}>תיאור (אופציונלי)</label>
            <input style={inputStyle} value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} placeholder="הסבר קצר לצוות..." />
          </div>
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>הגדרת ניקוד</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>נקודות לכל דיווח *</label>
                <input type="number" min={0} style={{ ...inputStyle, direction: 'ltr' }} value={form.points} onChange={(e) => setForm((p) => ({ ...p, points: e.target.value }))} />
              </div>
              <div>
                <label style={labelStyle}>מקסימום ביום</label>
                <input type="number" min={1} style={{ ...inputStyle, direction: 'ltr' }} value={form.maxPerDay} onChange={(e) => setForm((p) => ({ ...p, maxPerDay: e.target.value }))} placeholder="ללא הגבלה" />
              </div>
            </div>
            <div>
              <label style={labelStyle}>סוג קלט</label>
              <select style={inputStyle} value={form.inputType} onChange={(e) => setForm((p) => ({ ...p, inputType: e.target.value }))}>
                {ACTION_INPUT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                {form.inputType === 'boolean' && 'המשתתפת מאשרת ביצוע — כן/לא'}
                {form.inputType === 'number' && 'המשתתפת מזינה מספר (שלבים, כוסות מים...)'}
                {form.inputType === 'select' && 'המשתתפת בוחרת מתוך רשימת אפשרויות'}
              </div>
            </div>
          </div>
          {error && <div style={{ color: '#dc2626', fontSize: 13, background: '#fef2f2', padding: '8px 12px', borderRadius: 7 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={{ background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 7, padding: '9px 18px', fontSize: 13, cursor: 'pointer' }}>ביטול</button>
            <button type="submit" disabled={saving} style={{ background: saving ? '#93c5fd' : '#2563eb', color: '#fff', border: 'none', borderRadius: 7, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer' }}>
              {saving ? 'שומר...' : 'שמירה'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Rule Modal (human builder + advanced JSON toggle) ────────────────────────

function RuleModal({
  programId, rule, actions, onSaved, onClose,
}: {
  programId: string;
  rule: GameRule | null;
  actions: GameAction[];
  onSaved: (r: GameRule) => void;
  onClose: () => void;
}) {
  // Derive initial human values from existing rule
  const initCondition = rule?.conditionJson as Record<string, unknown> | null;
  const initReward = rule?.rewardJson as Record<string, unknown> | null;

  const [name, setName] = useState(rule?.name ?? '');
  const [type, setType] = useState(rule?.type ?? 'daily_bonus');
  const [activationType, setActivationType] = useState(rule?.activationType ?? 'immediate');
  const [activationDays, setActivationDays] = useState(String(rule?.activationDays ?? ''));
  const [requiresAdminApproval, setRequiresAdminApproval] = useState(rule?.requiresAdminApproval ?? false);
  const [rewardPoints, setRewardPoints] = useState(String(initReward?.['points'] ?? 10));
  const [minStreak, setMinStreak] = useState(String(initCondition?.['minStreak'] ?? '7'));
  const [conditionActionId, setConditionActionId] = useState(String(initCondition?.['actionId'] ?? ''));
  const [advancedMode, setAdvancedMode] = useState(false);
  const [conditionJson, setConditionJson] = useState(rule?.conditionJson ? JSON.stringify(rule.conditionJson, null, 2) : '{}');
  const [rewardJson, setRewardJson] = useState(rule?.rewardJson ? JSON.stringify(rule.rewardJson, null, 2) : '{"points":10}');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Sync human fields → JSON when type changes (only in normal mode)
  function buildJsonFromUI(): { cond: Record<string, unknown>; reward: Record<string, unknown> } {
    const pts = parseInt(rewardPoints) || 0;
    const reward = { points: pts };
    let cond: Record<string, unknown> = {};
    if (type === 'streak') cond = { minStreak: parseInt(minStreak) || 7 };
    if (type === 'conditional') cond = { actionId: conditionActionId };
    return { cond, reward };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('שם הוא שדה חובה'); return; }

    let conditionJsonParsed: Record<string, unknown>;
    let rewardJsonParsed: Record<string, unknown>;

    if (advancedMode) {
      try { conditionJsonParsed = JSON.parse(conditionJson); } catch { setError('תנאי JSON שגוי'); return; }
      try { rewardJsonParsed = JSON.parse(rewardJson); } catch { setError('פרס JSON שגוי'); return; }
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
      const res = await fetch(url, {
        method: rule ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify(body),
      });
      if (!res.ok) { setError('שגיאה בשמירה'); return; }
      onSaved(await res.json() as GameRule);
    } finally { setSaving(false); }
  }

  const ruleTypeDescriptions: Record<string, string> = {
    daily_bonus: 'מעניק נקודות פעם אחת בכל יום שיש פעילות',
    streak:      'מעניק נקודות בונוס כשהמשתתפת מגיעה לרצף ימים מסוים',
    conditional: 'מעניק נקודות כאשר משתתפת מדווחת על פעולה ספציפית',
  };

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 14, padding: 28, width: '100%', maxWidth: 500, maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', margin: 0 }}>{rule ? 'עריכת חוק' : 'חוק חדש'}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#94a3b8' }}>×</button>
        </div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

          {/* Name */}
          <div>
            <label style={labelStyle}>שם החוק *</label>
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="לדוגמה: בונוס רצף שבועי" />
          </div>

          {/* Rule type */}
          <div>
            <label style={labelStyle}>סוג חוק</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { value: 'daily_bonus', label: 'בונוס יומי', icon: '☀️' },
                { value: 'streak',      label: 'בונוס רצף',  icon: '🔥' },
                { value: 'conditional', label: 'תנאי פעולה', icon: '⚡' },
              ].map((t) => (
                <label key={t.value} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px', border: `1.5px solid ${type === t.value ? '#2563eb' : '#e2e8f0'}`, borderRadius: 8, cursor: 'pointer', background: type === t.value ? '#eff6ff' : '#fff' }}>
                  <input type="radio" name="ruleType" value={t.value} checked={type === t.value} onChange={() => setType(t.value)} style={{ marginTop: 2 }} />
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{t.icon} {t.label}</div>
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{ruleTypeDescriptions[t.value]}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Condition fields — only shown in normal mode */}
          {!advancedMode && (
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>תנאי הפעלה</div>

              {type === 'daily_bonus' && (
                <div style={{ fontSize: 14, color: '#374151' }}>החוק יופעל אוטומטית פעם אחת בכל יום שבו יש דיווח פעולה.</div>
              )}

              {type === 'streak' && (
                <div>
                  <label style={labelStyle}>מינימום ימים ברצף</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input type="number" min={1} style={{ ...inputStyle, width: 100, direction: 'ltr' }} value={minStreak} onChange={(e) => setMinStreak(e.target.value)} />
                    <span style={{ fontSize: 14, color: '#64748b' }}>ימים</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>הבונוס יינתן כשהמשתתפת מגיעה לרצף זה</div>
                </div>
              )}

              {type === 'conditional' && (
                <div>
                  <label style={labelStyle}>פעולה מפעילה</label>
                  {actions.length === 0 ? (
                    <div style={{ fontSize: 13, color: '#94a3b8', fontStyle: 'italic' }}>יש להוסיף פעולות תחילה</div>
                  ) : (
                    <select style={inputStyle} value={conditionActionId} onChange={(e) => setConditionActionId(e.target.value)}>
                      <option value="">— בחרי פעולה —</option>
                      {actions.filter((a) => a.isActive).map((a) => (
                        <option key={a.id} value={a.id}>{a.name} ({a.points} נק׳)</option>
                      ))}
                    </select>
                  )}
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>הבונוס יינתן בכל דיווח על הפעולה הנבחרת</div>
                </div>
              )}

              {/* Reward points */}
              <div>
                <label style={labelStyle}>נקודות בונוס</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input type="number" min={0} style={{ ...inputStyle, width: 100, direction: 'ltr' }} value={rewardPoints} onChange={(e) => setRewardPoints(e.target.value)} />
                  <span style={{ fontSize: 14, color: '#64748b' }}>נקודות</span>
                </div>
              </div>
            </div>
          )}

          {/* Activation */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>מתי החוק מתחיל לפעול?</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { value: 'immediate',   label: 'מיד מתחילת התוכנית' },
                { value: 'after_days',  label: 'אחרי מספר ימים' },
                { value: 'admin_unlock', label: 'רק לאחר פתיחה ידנית ע״י מנהל' },
              ].map((t) => (
                <label key={t.value} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14, color: '#374151' }}>
                  <input type="radio" name="activationType" value={t.value} checked={activationType === t.value} onChange={() => setActivationType(t.value)} />
                  {t.label}
                </label>
              ))}
            </div>
            {activationType === 'after_days' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 4 }}>
                <input type="number" min={1} style={{ ...inputStyle, width: 100, direction: 'ltr' }} value={activationDays} onChange={(e) => setActivationDays(e.target.value)} placeholder="7" />
                <span style={{ fontSize: 14, color: '#64748b' }}>ימים מתחילת הקבוצה</span>
              </div>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14, color: '#374151', paddingTop: 4 }}>
              <input type="checkbox" checked={requiresAdminApproval} onChange={(e) => setRequiresAdminApproval(e.target.checked)} style={{ width: 15, height: 15 }} />
              דורש אישור מנהל לכל פעולה
            </label>
          </div>

          {/* Advanced mode toggle */}
          <button
            type="button"
            onClick={() => {
              if (!advancedMode) {
                // Sync UI → JSON before opening
                const { cond, reward } = buildJsonFromUI();
                setConditionJson(JSON.stringify(cond, null, 2));
                setRewardJson(JSON.stringify(reward, null, 2));
              }
              setAdvancedMode((v) => !v);
            }}
            style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', textAlign: 'right', padding: 0, textDecoration: 'underline' }}
          >
            {advancedMode ? '▲ הסתר מצב מתקדם' : '▼ מצב מתקדם (JSON)'}
          </button>

          {advancedMode && (
            <div style={{ background: '#1e293b', borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>ADVANCED — ישנה רק אם ידוע מה עושים</div>
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
            <button type="button" onClick={onClose} style={{ background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 7, padding: '9px 18px', fontSize: 13, cursor: 'pointer' }}>ביטול</button>
            <button type="submit" disabled={saving} style={{ background: saving ? '#93c5fd' : '#2563eb', color: '#fff', border: 'none', borderRadius: 7, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer' }}>
              {saving ? 'שומר...' : 'שמירה'}
            </button>
          </div>
        </form>
      </div>
    </div>
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

  useEffect(() => {
    Promise.all([
      fetch(`${BASE_URL}/game/programs/${programId}/actions`, { cache: 'no-store' }).then((r) => r.json()),
      fetch(`${BASE_URL}/game/programs/${programId}/rules`, { cache: 'no-store' }).then((r) => r.json()),
    ]).then(([a, r]) => {
      setActions((a as GameAction[]).filter((x) => x.isActive));
      setRules((r as GameRule[]).filter((x) => x.isActive));
    }).finally(() => setLoading(false));
  }, [programId]);

  async function handleDeleteAction(a: GameAction) {
    setDeleting(true);
    try {
      await fetch(`${BASE_URL}/game/programs/${programId}/actions/${a.id}`, { method: 'DELETE', cache: 'no-store' });
      setActions((prev) => prev.filter((x) => x.id !== a.id));
      setDeleteAction(null);
    } finally { setDeleting(false); }
  }

  async function handleDeleteRule(r: GameRule) {
    setDeleting(true);
    try {
      await fetch(`${BASE_URL}/game/programs/${programId}/rules/${r.id}`, { method: 'DELETE', cache: 'no-store' });
      setRules((prev) => prev.filter((x) => x.id !== r.id));
      setDeleteRule(null);
    } finally { setDeleting(false); }
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
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 14, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '14px 18px' }}>
                <div style={{ width: 40, height: 40, borderRadius: 8, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>🎯</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', marginBottom: 4 }}>{a.name}</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    {badge(`${a.points} נקודות`, 'green')}
                    {badge(ACTION_INPUT_TYPES.find((t) => t.value === a.inputType)?.label ?? a.inputType ?? 'כן/לא', 'blue')}
                    {a.maxPerDay ? badge(`מקס׳ ${a.maxPerDay} פעם/יום`, 'orange') : badge('ללא הגבלה יומית', 'gray')}
                  </div>
                  {a.description && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{a.description}</div>}
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
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
    fetch(`${BASE_URL}/programs/${id}`, { cache: 'no-store' })
      .then((r) => { if (!r.ok) { setNotFound(true); return null; } return r.json(); })
      .then((data: unknown) => { if (data) setProgram(data as Program); })
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
    ...(program.type === 'game' ? [{ key: 'game' as TabKey, label: 'מנוע משחק' }] : []),
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
