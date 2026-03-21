'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BASE_URL } from '@lib/api';

interface Challenge {
  id: string;
  name: string;
  isActive: boolean;
  challengeType: { name: string };
  startDate: string;
  endDate: string;
}

interface Group {
  id: string;
  name: string;
  challenge: { name: string };
}

interface Participant {
  id: string;
}

export default function DashboardPage() {
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Load all dashboard data on mount — no subscription cleanup needed
    const load = async () => {
      try {
        const includeMock = localStorage.getItem('showMockParticipants') === 'true';
        console.log('[API] GET', `${BASE_URL}/challenges`, `${BASE_URL}/groups`, `${BASE_URL}/participants?includeMock=${includeMock}`);
        const [cRes, gRes, pRes] = await Promise.all([
          fetch(`${BASE_URL}/challenges`),
          fetch(`${BASE_URL}/groups`),
          fetch(`${BASE_URL}/participants?includeMock=${includeMock}`),
        ]);
        const [cData, gData, pData] = await Promise.all([cRes.json(), gRes.json(), pRes.json()]);
        setChallenges(Array.isArray(cData) ? (cData as Challenge[]) : []);
        setGroups(Array.isArray(gData) ? (gData as Group[]) : []);
        setParticipants(Array.isArray(pData) ? (pData as Participant[]) : []);
      } catch {
        // Graceful degradation — show zeros if API unreachable
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const activeChallenges = challenges.filter((c) => c.isActive);

  const statCards = [
    {
      label: 'אתגרים פעילים',
      value: loading ? '...' : activeChallenges.length,
      sub: `מתוך ${challenges.length} סה״כ`,
      color: '#2563eb',
      link: '/challenges',
    },
    {
      label: 'קבוצות',
      value: loading ? '...' : groups.length,
      sub: 'קבוצות רשומות',
      color: '#16a34a',
      link: '/groups',
    },
    {
      label: 'משתתפות',
      value: loading ? '...' : participants.length,
      sub: 'משתתפות פעילות',
      color: '#7c3aed',
      link: '/participants',
    },
    {
      label: 'דיווחו היום',
      value: '—',
      sub: 'בקרוב',
      color: '#ea580c',
      link: null,
    },
  ];

  const today = new Date().toLocaleDateString('he-IL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="page-wrapper" style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', margin: 0 }}>דשבורד</h1>
        <p style={{ color: '#64748b', fontSize: 14, marginTop: 4, marginBottom: 0 }}>{today}</p>
      </div>

      {/* Stat cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
          gap: 16,
          marginBottom: 32,
        }}
      >
        {statCards.map((card) => {
          const inner = (
            <div
              style={{
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: 10,
                padding: '20px',
                borderTop: `3px solid ${card.color}`,
                cursor: card.link ? 'pointer' : 'default',
              }}
            >
              <div style={{ fontSize: 34, fontWeight: 700, color: card.color }}>{card.value}</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#0f172a', marginTop: 4 }}>{card.label}</div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{card.sub}</div>
            </div>
          );
          return card.link ? (
            <Link key={card.label} href={card.link}>
              {inner}
            </Link>
          ) : (
            <div key={card.label}>{inner}</div>
          );
        })}
      </div>

      {/* Content grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Active challenges */}
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
          <div
            style={{
              padding: '14px 20px',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 15, color: '#0f172a' }}>אתגרים פעילים</span>
            <Link href="/challenges" style={{ fontSize: 13, color: '#2563eb' }}>
              הצג הכל →
            </Link>
          </div>
          <div style={{ padding: '8px 0' }}>
            {loading && (
              <p style={{ padding: '8px 20px', color: '#94a3b8', fontSize: 14, margin: 0 }}>טוען...</p>
            )}
            {!loading && activeChallenges.length === 0 && (
              <p style={{ padding: '8px 20px', color: '#94a3b8', fontSize: 14, margin: 0 }}>אין אתגרים פעילים.</p>
            )}
            {activeChallenges.map((c) => (
              <div
                key={c.id}
                style={{
                  padding: '10px 20px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  borderBottom: '1px solid #f8fafc',
                }}
              >
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500, color: '#0f172a' }}>{c.name}</div>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>{c.challengeType.name}</div>
                </div>
                <span
                  style={{
                    fontSize: 11,
                    background: '#dcfce7',
                    color: '#16a34a',
                    padding: '2px 9px',
                    borderRadius: 20,
                    fontWeight: 500,
                  }}
                >
                  פעיל
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Groups quick view */}
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
          <div
            style={{
              padding: '14px 20px',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 15, color: '#0f172a' }}>קבוצות אחרונות</span>
            <Link href="/groups" style={{ fontSize: 13, color: '#2563eb' }}>
              הצג הכל →
            </Link>
          </div>
          <div style={{ padding: '8px 0' }}>
            {loading && (
              <p style={{ padding: '8px 20px', color: '#94a3b8', fontSize: 14, margin: 0 }}>טוען...</p>
            )}
            {!loading && groups.length === 0 && (
              <p style={{ padding: '8px 20px', color: '#94a3b8', fontSize: 14, margin: 0 }}>אין קבוצות עדיין.</p>
            )}
            {groups.slice(0, 5).map((g) => (
              <div key={g.id} style={{ padding: '10px 20px', borderBottom: '1px solid #f8fafc' }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: '#0f172a' }}>{g.name}</div>
                <div style={{ fontSize: 12, color: '#94a3b8' }}>{g.challenge?.name ?? '—'}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Did not report (placeholder) */}
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #e2e8f0' }}>
            <span style={{ fontWeight: 600, fontSize: 15, color: '#0f172a' }}>לא דיווחו היום</span>
          </div>
          <div style={{ padding: '36px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>📋</div>
            <div style={{ color: '#94a3b8', fontSize: 14 }}>מעקב יומי יהיה זמין בקרוב</div>
          </div>
        </div>

        {/* Needs attention (placeholder) */}
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #e2e8f0' }}>
            <span style={{ fontWeight: 600, fontSize: 15, color: '#0f172a' }}>דורשות תשומת לב</span>
          </div>
          <div style={{ padding: '36px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>🔔</div>
            <div style={{ color: '#94a3b8', fontSize: 14 }}>ניתוח AI יהיה זמין בקרוב</div>
          </div>
        </div>
      </div>
    </div>
  );
}
