'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BASE_URL, apiFetch } from '@lib/api';

type GroupStatus = 'active' | 'inactive';
type ProgramType = 'challenge' | 'game' | 'group_coaching' | 'personal_coaching';

interface Group {
  id: string;
  name: string;
  status: GroupStatus;
  isActive: boolean;
  startDate: string | null;
  endDate: string | null;
  challenge: { id: string; name: string } | null;
  program: { id: string; name: string; type: ProgramType } | null;
  _count: { participantGroups: number };
}

const PROGRAM_TYPE_LABEL: Record<ProgramType, string> = {
  challenge:         'אתגר',
  game:              'משחק',
  group_coaching:    'ליווי קבוצתי',
  personal_coaching: 'ליווי אישי',
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('he-IL');
}

export default function GroupsPage() {
  const router = useRouter();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Delete group
  const [deleteTarget, setDeleteTarget] = useState<Group | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch(`${BASE_URL}/groups`, { cache: 'no-store' })
      .then((data: unknown) => setGroups(Array.isArray(data) ? (data as Group[]) : []))
      .catch(() => setGroups([]))
      .finally(() => setLoading(false));
  }, []);

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await apiFetch(`${BASE_URL}/groups/${deleteTarget.id}`, { method: 'DELETE' });
      setGroups((prev) => prev.filter((g) => g.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(
        typeof err === 'object' && err !== null && 'message' in err
          ? String((err as { message: unknown }).message)
          : 'שגיאה במחיקה',
      );
    } finally {
      setDeleting(false);
    }
  }

  const filtered = groups.filter((g) => {
    const q = search.toLowerCase();
    return (
      g.name.toLowerCase().includes(q) ||
      g.program?.name?.toLowerCase().includes(q) ||
      g.challenge?.name?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="page-wrapper" style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', margin: 0 }}>קבוצות</h1>
          {!loading && <p style={{ color: '#64748b', fontSize: 14, marginTop: 4, marginBottom: 0 }}>{groups.length} קבוצות סה״כ</p>}
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <input
          style={{ width: '100%', maxWidth: 360, padding: '9px 14px', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 14, background: '#ffffff', color: '#0f172a' }}
          placeholder="חיפוש לפי שם קבוצה או תוכנית..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
              {['שם קבוצה', 'תוכנית', 'סוג', 'סטטוס', 'משתתפות', 'תאריכים', ''].map((h) => (
                <th key={h} style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: '#374151', fontSize: 13 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} style={{ padding: 28, textAlign: 'center', color: '#94a3b8' }}>טוען...</td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 28, textAlign: 'center', color: '#94a3b8' }}>{search ? 'לא נמצאו קבוצות תואמות.' : 'אין קבוצות עדיין.'}</td></tr>
            )}
            {filtered.map((g) => {
              const programName = g.program?.name ?? g.challenge?.name ?? '—';
              const programType = g.program?.type ?? null;
              const status = g.status ?? (g.isActive ? 'active' : 'inactive');
              return (
                <tr
                  key={g.id}
                  style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}
                  onClick={() => router.push(`/groups/${g.id}`)}
                >
                  <td style={{ padding: '12px 16px', fontWeight: 500, color: '#2563eb' }}>{g.name}</td>
                  <td style={{ padding: '12px 16px', color: '#374151' }}>{programName}</td>
                  <td style={{ padding: '12px 16px' }}>
                    {programType ? (
                      <span style={{ background: '#eff6ff', color: '#1d4ed8', fontSize: 11, padding: '2px 8px', borderRadius: 20, fontWeight: 500 }}>
                        {PROGRAM_TYPE_LABEL[programType]}
                      </span>
                    ) : '—'}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{
                      background: status === 'active' ? '#f0fdf4' : '#f1f5f9',
                      color: status === 'active' ? '#15803d' : '#64748b',
                      padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 500,
                    }}>
                      {status === 'active' ? 'פעיל' : 'לא פעיל'}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', color: '#374151' }}>{g._count?.participantGroups ?? 0}</td>
                  <td style={{ padding: '12px 16px', color: '#94a3b8', fontSize: 12 }}>
                    {formatDate(g.startDate)} — {formatDate(g.endDate)}
                  </td>
                  <td style={{ padding: '8px 12px' }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); router.push(`/groups/${g.id}?edit=1`); }}
                        title="עריכה"
                        style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: 6, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 13, color: '#374151' }}
                      >
                        ✏
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget(g); setDeleteError(null); }}
                        title="מחיקה"
                        style={{ background: 'none', border: '1px solid #fecaca', borderRadius: 6, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 13, color: '#ef4444' }}
                      >
                        🗑
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Delete group modal ── */}
      {deleteTarget && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget && !deleting) setDeleteTarget(null); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}
        >
          <div style={{ background: '#fff', borderRadius: 14, padding: 28, width: '100%', maxWidth: 400, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🗑️</div>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', margin: '0 0 10px' }}>מחיקת קבוצה</h2>
            <p style={{ fontSize: 14, color: '#374151', margin: '0 0 6px' }}>
              האם למחוק את הקבוצה <strong>"{deleteTarget.name}"</strong>?
            </p>
            <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 20px', lineHeight: 1.5 }}>
              הקבוצה תוסתר מהרשימה. המשתתפות והנתונים נשמרים.
            </p>
            {deleteError && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 7, padding: '8px 12px', color: '#dc2626', fontSize: 13, marginBottom: 16 }}>
                {deleteError}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                style={{ padding: '9px 20px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, color: '#374151', cursor: 'pointer' }}
              >
                ביטול
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                style={{ padding: '9px 22px', background: deleting ? '#fca5a5' : '#ef4444', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: deleting ? 'not-allowed' : 'pointer' }}
              >
                {deleting ? 'מוחק...' : 'מחק קבוצה'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
