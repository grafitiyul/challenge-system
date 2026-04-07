'use client';

import { useEffect, useState } from 'react';
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
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    apiFetch(`${BASE_URL}/groups`, { cache: 'no-store' })
      .then((data: unknown) => setGroups(Array.isArray(data) ? (data as Group[]) : []))
      .catch(() => setGroups([]))
      .finally(() => setLoading(false));
  }, []);

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
              {['שם קבוצה', 'תוכנית', 'סוג', 'סטטוס', 'משתתפות', 'תאריכים'].map((h) => (
                <th key={h} style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: '#374151', fontSize: 13 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} style={{ padding: 28, textAlign: 'center', color: '#94a3b8' }}>טוען...</td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={6} style={{ padding: 28, textAlign: 'center', color: '#94a3b8' }}>{search ? 'לא נמצאו קבוצות תואמות.' : 'אין קבוצות עדיין.'}</td></tr>
            )}
            {filtered.map((g) => {
              const programName = g.program?.name ?? g.challenge?.name ?? '—';
              const programType = g.program?.type ?? null;
              const status = g.status ?? (g.isActive ? 'active' : 'inactive');
              return (
                <tr
                  key={g.id}
                  style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}
                  onClick={() => { window.location.href = `/groups/${g.id}`; }}
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
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
