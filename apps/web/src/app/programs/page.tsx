'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { BASE_URL } from '@lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

type ProgramType = 'challenge' | 'game' | 'group_coaching' | 'personal_coaching';

interface Program {
  id: string;
  name: string;
  type: ProgramType;
  description: string | null;
  isActive: boolean;
  _count: { groups: number };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TYPE_OPTIONS: { key: ProgramType; label: string; description: string; emoji: string }[] = [
  { key: 'challenge',         label: 'אתגרים',           description: 'תוכניות אתגר עם מחויבות ויעדים ברורים', emoji: '⚡' },
  { key: 'game',              label: 'משחקים',           description: 'תוכניות משחק וגיימיפיקציה',              emoji: '🎮' },
  { key: 'group_coaching',    label: 'ליווי קבוצתי',    description: 'ליווי וקואצ׳ינג לקבוצות',                emoji: '👥' },
  { key: 'personal_coaching', label: 'ליווי אישי',      description: 'ליווי אישי אחד על אחד',                  emoji: '🎯' },
];

const TYPE_LABEL: Record<ProgramType, string> = {
  challenge:         'אתגר',
  game:              'משחק',
  group_coaching:    'ליווי קבוצתי',
  personal_coaching: 'ליווי אישי',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  border: '1px solid #cbd5e1',
  borderRadius: 7,
  fontSize: 14,
  color: '#0f172a',
  background: '#ffffff',
  boxSizing: 'border-box',
};

// ─── Create modal ─────────────────────────────────────────────────────────────

function CreateProgramModal({ defaultType, onCreated, onClose }: {
  defaultType: ProgramType;
  onCreated: (p: Program) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('שם הוא שדה חובה'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${BASE_URL}/programs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ name: name.trim(), type: defaultType, description: description.trim() || undefined }),
      });
      if (!res.ok) { setError('שגיאה ביצירת התוכנית'); return; }
      const created = await res.json() as Program;
      onCreated(created);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}
    >
      <div style={{ background: '#fff', borderRadius: 14, padding: 28, width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', margin: 0 }}>תוכנית חדשה — {TYPE_LABEL[defaultType]}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#94a3b8' }}>×</button>
        </div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 5, display: 'block' }}>שם התוכנית *</label>
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="לדוגמה: אתגר בריאות 2026" />
          </div>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 5, display: 'block' }}>תיאור (אופציונלי)</label>
            <textarea rows={3} style={{ ...inputStyle, resize: 'vertical' }} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="תיאור קצר של התוכנית..." />
          </div>
          {error && <div style={{ color: '#dc2626', fontSize: 13 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="button" onClick={onClose} style={{ background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>ביטול</button>
            <button type="submit" disabled={saving} style={{ background: saving ? '#93c5fd' : '#2563eb', color: '#fff', border: 'none', borderRadius: 7, padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer' }}>
              {saving ? 'יוצר...' : 'צור תוכנית'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function ProgramsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedType = searchParams.get('type') as ProgramType | null;

  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(false);
  const [createModal, setCreateModal] = useState(false);

  useEffect(() => {
    if (!selectedType) return;
    setLoading(true);
    fetch(`${BASE_URL}/programs?type=${selectedType}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: unknown) => setPrograms(Array.isArray(data) ? data as Program[] : []))
      .catch(() => setPrograms([]))
      .finally(() => setLoading(false));
  }, [selectedType]);

  // ── Type picker (step 1) ───────────────────────────────────────────────────
  if (!selectedType) {
    return (
      <div className="page-wrapper" style={{ maxWidth: 800, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>תוכניות</h1>
        <p style={{ color: '#64748b', fontSize: 14, marginBottom: 32 }}>בחרי סוג תוכנית להמשך</p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => router.replace(`/programs?type=${opt.key}`)}
              style={{
                background: '#ffffff',
                border: '1.5px solid #e2e8f0',
                borderRadius: 14,
                padding: '28px 24px',
                textAlign: 'right',
                cursor: 'pointer',
                transition: 'border-color 0.15s, box-shadow 0.15s',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = '#2563eb';
                (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 16px rgba(37,99,235,0.1)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = '#e2e8f0';
                (e.currentTarget as HTMLButtonElement).style.boxShadow = 'none';
              }}
            >
              <div style={{ fontSize: 36, marginBottom: 12 }}>{opt.emoji}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>{opt.label}</div>
              <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>{opt.description}</div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── Filtered list (step 2) ─────────────────────────────────────────────────
  const typeOption = TYPE_OPTIONS.find((o) => o.key === selectedType)!;

  return (
    <div className="page-wrapper" style={{ maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24, flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => router.replace('/programs')}
            style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 14, cursor: 'pointer', padding: '4px 0' }}
          >
            → תוכניות
          </button>
          <span style={{ color: '#cbd5e1' }}>/</span>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>{typeOption.emoji} {typeOption.label}</span>
        </div>
        <button
          onClick={() => setCreateModal(true)}
          style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 7, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          + תוכנית חדשה
        </button>
      </div>

      {loading && <div style={{ color: '#94a3b8', textAlign: 'center', paddingTop: 40 }}>טוען...</div>}

      {!loading && programs.length === 0 && (
        <div style={{ padding: '60px 24px', textAlign: 'center', border: '2px dashed #e2e8f0', borderRadius: 12, color: '#94a3b8' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>{typeOption.emoji}</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#374151', marginBottom: 6 }}>אין תוכניות עדיין</div>
          <div style={{ fontSize: 13, marginBottom: 20 }}>צרי תוכנית {typeOption.label} ראשונה</div>
          <button
            onClick={() => setCreateModal(true)}
            style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 7, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            + תוכנית חדשה
          </button>
        </div>
      )}

      {!loading && programs.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {programs.map((p) => (
            <Link key={p.id} href={`/programs/${p.id}`} style={{ textDecoration: 'none' }}>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
                background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 10,
                padding: '16px 20px', cursor: 'pointer',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                    <span style={{ fontSize: 15, fontWeight: 600, color: '#0f172a' }}>{p.name}</span>
                    {!p.isActive && (
                      <span style={{ background: '#f1f5f9', color: '#64748b', fontSize: 11, padding: '2px 8px', borderRadius: 20 }}>לא פעיל</span>
                    )}
                  </div>
                  {p.description && (
                    <div style={{ fontSize: 13, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.description}</div>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
                  <span style={{ fontSize: 13, color: '#64748b' }}>{p._count.groups} קבוצות</span>
                  <span style={{ color: '#94a3b8', fontSize: 18 }}>›</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {createModal && (
        <CreateProgramModal
          defaultType={selectedType}
          onCreated={(created) => {
            setPrograms((prev) => [{ ...created, _count: { groups: 0 } }, ...prev]);
            setCreateModal(false);
            router.push(`/programs/${created.id}`);
          }}
          onClose={() => setCreateModal(false)}
        />
      )}
    </div>
  );
}

export default function ProgramsPage() {
  return (
    <Suspense>
      <ProgramsPageInner />
    </Suspense>
  );
}
