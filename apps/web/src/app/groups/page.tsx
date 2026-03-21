'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BASE_URL } from '@lib/api';

interface Group {
  id: string;
  name: string;
  challenge: { id: string; name: string };
  startDate: string;
  endDate: string;
  isActive: boolean;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('he-IL');
}

export default function GroupsPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    // Load all groups once on mount
    console.log('[API] GET', `${BASE_URL}/groups`);
    fetch(`${BASE_URL}/groups`)
      .then((r) => r.json())
      .then((data: unknown) => setGroups(Array.isArray(data) ? (data as Group[]) : []))
      .catch(() => setGroups([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = groups.filter(
    (g) =>
      g.name.toLowerCase().includes(search.toLowerCase()) ||
      g.challenge?.name?.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="page-wrapper" style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', margin: 0 }}>קבוצות</h1>
          {!loading && (
            <p style={{ color: '#64748b', fontSize: 14, marginTop: 4, marginBottom: 0 }}>
              {groups.length} קבוצות סה״כ
            </p>
          )}
        </div>
        <Link
          href="/challenges"
          style={{
            background: '#2563eb',
            color: '#ffffff',
            padding: '9px 18px',
            borderRadius: 7,
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          + קבוצה חדשה
        </Link>
      </div>

      <div style={{ marginBottom: 20 }}>
        <input
          style={{
            width: '100%',
            maxWidth: 360,
            padding: '9px 14px',
            border: '1px solid #e2e8f0',
            borderRadius: 7,
            fontSize: 14,
            background: '#ffffff',
            color: '#0f172a',
          }}
          placeholder="חיפוש לפי שם קבוצה או אתגר..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
              {['שם קבוצה', 'אתגר', 'תאריך התחלה', 'תאריך סיום', 'סטטוס'].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: '12px 16px',
                    textAlign: 'right',
                    fontWeight: 600,
                    color: '#374151',
                    fontSize: 13,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} style={{ padding: 28, textAlign: 'center', color: '#94a3b8' }}>
                  טוען...
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: 28, textAlign: 'center', color: '#94a3b8' }}>
                  {search ? 'לא נמצאו קבוצות תואמות.' : 'אין קבוצות עדיין.'}
                </td>
              </tr>
            )}
            {filtered.map((g) => (
              <tr key={g.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '12px 16px', fontWeight: 500, color: '#0f172a' }}>{g.name}</td>
                <td style={{ padding: '12px 16px', color: '#374151' }}>{g.challenge?.name ?? '—'}</td>
                <td style={{ padding: '12px 16px', color: '#374151' }}>{formatDate(g.startDate)}</td>
                <td style={{ padding: '12px 16px', color: '#374151' }}>{formatDate(g.endDate)}</td>
                <td style={{ padding: '12px 16px' }}>
                  <span
                    style={{
                      background: g.isActive ? '#dcfce7' : '#f1f5f9',
                      color: g.isActive ? '#16a34a' : '#64748b',
                      padding: '3px 10px',
                      borderRadius: 20,
                      fontSize: 12,
                      fontWeight: 500,
                    }}
                  >
                    {g.isActive ? 'פעילה' : 'לא פעילה'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
