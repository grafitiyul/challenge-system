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
  { value: 'boolean', label: 'כן/לא' },
  { value: 'number', label: 'מספר' },
  { value: 'select', label: 'בחירה' },
];

const RULE_TYPES = [
  { value: 'daily_bonus', label: 'בונוס יומי' },
  { value: 'streak', label: 'רצף' },
  { value: 'conditional', label: 'תנאי' },
];

const ACTIVATION_TYPES = [
  { value: 'immediate', label: 'מיידי' },
  { value: 'after_days', label: 'אחרי ימים' },
  { value: 'admin_unlock', label: 'פתיחת מנהל' },
];

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
    if (isNaN(pts) || pts < 0) { setError('נקודות חייב להיות מספר חיובי'); return; }
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
      const saved = await res.json() as GameAction;
      onSaved(saved);
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
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={labelStyle}>שם *</label>
            <input style={inputStyle} value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} autoFocus placeholder="לדוגמה: צ׳ק-אין יומי" />
          </div>
          <div>
            <label style={labelStyle}>תיאור</label>
            <input style={inputStyle} value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} placeholder="תיאור קצר..." />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>סוג קלט</label>
              <select style={inputStyle} value={form.inputType} onChange={(e) => setForm((p) => ({ ...p, inputType: e.target.value }))}>
                {ACTION_INPUT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>נקודות *</label>
              <input type="number" min={0} style={{ ...inputStyle, direction: 'ltr' }} value={form.points} onChange={(e) => setForm((p) => ({ ...p, points: e.target.value }))} />
            </div>
          </div>
          <div>
            <label style={labelStyle}>מקסימום ביום</label>
            <input type="number" min={1} style={{ ...inputStyle, direction: 'ltr', width: '50%' }} value={form.maxPerDay} onChange={(e) => setForm((p) => ({ ...p, maxPerDay: e.target.value }))} placeholder="ללא הגבלה" />
          </div>
          {error && <div style={{ color: '#dc2626', fontSize: 13 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="button" onClick={onClose} style={{ background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>ביטול</button>
            <button type="submit" disabled={saving} style={{ background: saving ? '#93c5fd' : '#2563eb', color: '#fff', border: 'none', borderRadius: 7, padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer' }}>
              {saving ? 'שומר...' : 'שמירה'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RuleModal({
  programId, rule, onSaved, onClose,
}: {
  programId: string;
  rule: GameRule | null;
  onSaved: (r: GameRule) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    name: rule?.name ?? '',
    type: rule?.type ?? 'daily_bonus',
    activationType: rule?.activationType ?? 'immediate',
    activationDays: String(rule?.activationDays ?? ''),
    requiresAdminApproval: rule?.requiresAdminApproval ?? false,
    conditionJson: rule?.conditionJson ? JSON.stringify(rule.conditionJson, null, 2) : '{}',
    rewardJson: rule?.rewardJson ? JSON.stringify(rule.rewardJson, null, 2) : '{}',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError('שם הוא שדה חובה'); return; }
    let conditionJson: Record<string, unknown> = {};
    let rewardJson: Record<string, unknown> = {};
    try { conditionJson = JSON.parse(form.conditionJson); } catch { setError('תנאי JSON שגוי'); return; }
    try { rewardJson = JSON.parse(form.rewardJson); } catch { setError('פרס JSON שגוי'); return; }
    setSaving(true); setError('');
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        type: form.type,
        activationType: form.activationType,
        activationDays: form.activationDays ? parseInt(form.activationDays) : undefined,
        requiresAdminApproval: form.requiresAdminApproval,
        conditionJson,
        rewardJson,
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
      const saved = await res.json() as GameRule;
      onSaved(saved);
    } finally { setSaving(false); }
  }

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 14, padding: 28, width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', margin: 0 }}>{rule ? 'עריכת חוק' : 'חוק חדש'}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#94a3b8' }}>×</button>
        </div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={labelStyle}>שם *</label>
            <input style={inputStyle} value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} autoFocus placeholder="לדוגמה: בונוס צ׳ק-אין 7 ימים" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>סוג חוק</label>
              <select style={inputStyle} value={form.type} onChange={(e) => setForm((p) => ({ ...p, type: e.target.value }))}>
                {RULE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>אופן הפעלה</label>
              <select style={inputStyle} value={form.activationType} onChange={(e) => setForm((p) => ({ ...p, activationType: e.target.value }))}>
                {ACTIVATION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>
          {form.activationType === 'after_days' && (
            <div>
              <label style={labelStyle}>אחרי כמה ימים</label>
              <input type="number" min={1} style={{ ...inputStyle, direction: 'ltr', width: '50%' }} value={form.activationDays} onChange={(e) => setForm((p) => ({ ...p, activationDays: e.target.value }))} />
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" id="req-approval" checked={form.requiresAdminApproval} onChange={(e) => setForm((p) => ({ ...p, requiresAdminApproval: e.target.checked }))} style={{ width: 16, height: 16, cursor: 'pointer' }} />
            <label htmlFor="req-approval" style={{ ...labelStyle, margin: 0, cursor: 'pointer' }}>דורש אישור מנהל</label>
          </div>
          <div>
            <label style={labelStyle}>תנאי (JSON)</label>
            <textarea rows={3} style={{ ...inputStyle, direction: 'ltr', fontFamily: 'monospace', fontSize: 13, resize: 'vertical' }} value={form.conditionJson} onChange={(e) => setForm((p) => ({ ...p, conditionJson: e.target.value }))} />
          </div>
          <div>
            <label style={labelStyle}>פרס (JSON)</label>
            <textarea rows={3} style={{ ...inputStyle, direction: 'ltr', fontFamily: 'monospace', fontSize: 13, resize: 'vertical' }} value={form.rewardJson} onChange={(e) => setForm((p) => ({ ...p, rewardJson: e.target.value }))} />
          </div>
          {error && <div style={{ color: '#dc2626', fontSize: 13 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="button" onClick={onClose} style={{ background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>ביטול</button>
            <button type="submit" disabled={saving} style={{ background: saving ? '#93c5fd' : '#2563eb', color: '#fff', border: 'none', borderRadius: 7, padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer' }}>
              {saving ? 'שומר...' : 'שמירה'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function GameEngineTab({ programId }: { programId: string }) {
  const [actions, setActions] = useState<GameAction[]>([]);
  const [rules, setRules] = useState<GameRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionModal, setActionModal] = useState<{ open: boolean; action: GameAction | null }>({ open: false, action: null });
  const [ruleModal, setRuleModal] = useState<{ open: boolean; rule: GameRule | null }>({ open: false, rule: null });

  useEffect(() => {
    Promise.all([
      fetch(`${BASE_URL}/game/programs/${programId}/actions`, { cache: 'no-store' }).then((r) => r.json()),
      fetch(`${BASE_URL}/game/programs/${programId}/rules`, { cache: 'no-store' }).then((r) => r.json()),
    ]).then(([a, r]) => {
      setActions(a as GameAction[]);
      setRules(r as GameRule[]);
    }).finally(() => setLoading(false));
  }, [programId]);

  const badgeStyle = (color: string): React.CSSProperties => ({
    background: color === 'blue' ? '#eff6ff' : color === 'green' ? '#f0fdf4' : '#f8fafc',
    color: color === 'blue' ? '#1d4ed8' : color === 'green' ? '#15803d' : '#475569',
    fontSize: 11, padding: '2px 8px', borderRadius: 20, fontWeight: 500,
  });

  if (loading) return <div style={{ color: '#94a3b8', textAlign: 'center', padding: 40 }}>טוען...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>

      {/* Actions Section */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', margin: 0 }}>פעולות ({actions.length})</h3>
          <button onClick={() => setActionModal({ open: true, action: null })}
            style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 7, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            + פעולה חדשה
          </button>
        </div>
        {actions.length === 0 ? (
          <div style={{ padding: '32px 20px', textAlign: 'center', border: '2px dashed #e2e8f0', borderRadius: 10, color: '#94a3b8', fontSize: 14 }}>
            אין פעולות עדיין — הוסיפי פעולה ראשונה
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {actions.map((a) => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '12px 16px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{a.name}</span>
                    {!a.isActive && <span style={badgeStyle('gray')}>לא פעיל</span>}
                    <span style={badgeStyle('blue')}>{ACTION_INPUT_TYPES.find((t) => t.value === a.inputType)?.label ?? a.inputType}</span>
                    <span style={badgeStyle('green')}>{a.points} נק׳</span>
                    {a.maxPerDay && <span style={badgeStyle('gray')}>מקס׳ {a.maxPerDay}/יום</span>}
                  </div>
                  {a.description && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{a.description}</div>}
                </div>
                <button onClick={() => setActionModal({ open: true, action: a })}
                  style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: 6, padding: '5px 12px', fontSize: 12, color: '#374151', cursor: 'pointer' }}>
                  ערוך
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Rules Section */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', margin: 0 }}>חוקים ({rules.length})</h3>
          <button onClick={() => setRuleModal({ open: true, rule: null })}
            style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 7, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            + חוק חדש
          </button>
        </div>
        {rules.length === 0 ? (
          <div style={{ padding: '32px 20px', textAlign: 'center', border: '2px dashed #e2e8f0', borderRadius: 10, color: '#94a3b8', fontSize: 14 }}>
            אין חוקים עדיין — הוסיפי חוק ראשון
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {rules.map((r) => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '12px 16px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{r.name}</span>
                    {!r.isActive && <span style={badgeStyle('gray')}>לא פעיל</span>}
                    <span style={badgeStyle('blue')}>{RULE_TYPES.find((t) => t.value === r.type)?.label ?? r.type}</span>
                    <span style={badgeStyle('gray')}>{ACTIVATION_TYPES.find((t) => t.value === r.activationType)?.label ?? r.activationType}</span>
                    {r.requiresAdminApproval && <span style={badgeStyle('gray')}>אישור מנהל</span>}
                  </div>
                </div>
                <button onClick={() => setRuleModal({ open: true, rule: r })}
                  style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: 6, padding: '5px 12px', fontSize: 12, color: '#374151', cursor: 'pointer' }}>
                  ערוך
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

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
          onSaved={(saved) => {
            setRules((prev) => ruleModal.rule
              ? prev.map((r) => r.id === saved.id ? saved : r)
              : [saved, ...prev]);
            setRuleModal({ open: false, rule: null });
          }}
          onClose={() => setRuleModal({ open: false, rule: null })}
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
