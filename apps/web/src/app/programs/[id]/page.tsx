'use client';

import { Suspense, use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { BASE_URL } from '@lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

type ProgramType = 'challenge' | 'game' | 'group_coaching' | 'personal_coaching';
type GroupStatus = 'active' | 'inactive';
type TabKey = 'settings' | 'groups';

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

const STATUS_LABEL: Record<GroupStatus, string> = { active: 'פעיל', inactive: 'לא פעיל' };

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', border: '1px solid #cbd5e1',
  borderRadius: 7, fontSize: 14, color: '#0f172a', background: '#ffffff', boxSizing: 'border-box',
};
const labelStyle: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 5, display: 'block',
};

const VALID_TABS: TabKey[] = ['settings', 'groups'];

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 520 }}>
      <div>
        <label style={labelStyle}>סוג תוכנית</label>
        <div style={{ fontSize: 14, color: '#374151', padding: '8px 0' }}>{TYPE_LABEL[program.type]}</div>
      </div>
      <div>
        <label style={labelStyle}>שם התוכנית *</label>
        <input style={inputStyle} value={form.name} onChange={(e) => { setForm((p) => ({ ...p, name: e.target.value })); setSaved(false); }} />
      </div>
      <div>
        <label style={labelStyle}>תיאור</label>
        <textarea rows={3} style={{ ...inputStyle, resize: 'vertical' }} value={form.description} onChange={(e) => { setForm((p) => ({ ...p, description: e.target.value })); setSaved(false); }} placeholder="תיאור קצר של התוכנית..." />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <label style={{ ...labelStyle, margin: 0 }}>תוכנית פעילה</label>
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
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
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
