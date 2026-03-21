'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { use } from 'react';
import { BASE_URL } from '@lib/api';

interface Gender {
  id: string;
  name: string;
}

interface Challenge {
  id: string;
  name: string;
}

interface Group {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  challenge: Challenge;
}

interface ParticipantGroup {
  id: string;
  joinedAt: string;
  group: Group;
}

interface Participant {
  id: string;
  fullName: string;
  phoneNumber: string;
  gender: Gender;
  joinedAt: string;
  isActive: boolean;
  participantGroups: ParticipantGroup[];
}

type Tab = 'profile' | 'groups' | 'tracking' | 'insights';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('he-IL');
}

export default function ParticipantProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('profile');

  useEffect(() => {
    // Load participant by ID on mount
    console.log('[API] GET', `${BASE_URL}/participants/${id}`);
    fetch(`${BASE_URL}/participants/${id}`)
      .then((r) => {
        if (!r.ok) {
          setNotFound(true);
          return null;
        }
        return r.json();
      })
      .then((data: unknown) => {
        if (data) setParticipant(data as Participant);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  const tabs: { key: Tab; label: string }[] = [
    { key: 'profile', label: 'פרטים אישיים' },
    { key: 'groups', label: 'קבוצות' },
    { key: 'tracking', label: 'מעקב יומי' },
    { key: 'insights', label: 'תובנות AI' },
  ];

  if (loading) {
    return (
      <div className="page-wrapper" style={{ textAlign: 'center', paddingTop: 60, color: '#94a3b8' }}>
        טוען...
      </div>
    );
  }

  if (notFound || !participant) {
    return (
      <div className="page-wrapper" style={{ textAlign: 'center', paddingTop: 60 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>😕</div>
        <div style={{ color: '#374151', fontSize: 16, fontWeight: 500 }}>משתתפת לא נמצאה</div>
        <Link href="/participants" style={{ color: '#2563eb', fontSize: 14, marginTop: 12, display: 'inline-block' }}>
          ← חזרה לרשימה
        </Link>
      </div>
    );
  }

  return (
    <div className="page-wrapper" style={{ maxWidth: 900, margin: '0 auto' }}>
      {/* Back */}
      <Link
        href="/participants"
        style={{ color: '#64748b', fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 20 }}
      >
        → חזרה לרשימה
      </Link>

      {/* Profile header */}
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: 12,
          padding: '24px',
          marginBottom: 24,
          display: 'flex',
          alignItems: 'center',
          gap: 20,
          flexWrap: 'wrap',
        }}
      >
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: '50%',
            background: '#eff6ff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 28,
            flexShrink: 0,
          }}
        >
          👤
        </div>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', margin: 0 }}>{participant.fullName}</h1>
          <div style={{ display: 'flex', gap: 16, marginTop: 6, flexWrap: 'wrap' }}>
            <span style={{ color: '#64748b', fontSize: 14 }} dir="ltr">
              {participant.phoneNumber}
            </span>
            <span style={{ color: '#64748b', fontSize: 14 }}>{participant.gender?.name}</span>
            <span style={{ color: '#64748b', fontSize: 14 }}>הצטרפה: {formatDate(participant.joinedAt)}</span>
          </div>
        </div>
        <span
          style={{
            background: participant.isActive ? '#dcfce7' : '#f1f5f9',
            color: participant.isActive ? '#16a34a' : '#64748b',
            padding: '5px 14px',
            borderRadius: 20,
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          {participant.isActive ? 'פעילה' : 'לא פעילה'}
        </span>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid #e2e8f0',
          marginBottom: 24,
          gap: 0,
          background: '#ffffff',
          borderRadius: '10px 10px 0 0',
          overflow: 'hidden',
          border: '1px solid #e2e8f0',
        }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              flex: 1,
              padding: '12px 8px',
              border: 'none',
              borderBottom: activeTab === tab.key ? '2px solid #2563eb' : '2px solid transparent',
              background: 'transparent',
              color: activeTab === tab.key ? '#2563eb' : '#64748b',
              fontWeight: activeTab === tab.key ? 600 : 400,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'profile' && (
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: '#374151', marginTop: 0, marginBottom: 20 }}>
            פרטים אישיים
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            {[
              { label: 'שם מלא', value: participant.fullName },
              { label: 'טלפון', value: participant.phoneNumber, ltr: true },
              { label: 'מגדר', value: participant.gender?.name },
              { label: 'תאריך הצטרפות', value: formatDate(participant.joinedAt) },
            ].map((field) => (
              <div key={field.label}>
                <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 500, marginBottom: 4 }}>{field.label}</div>
                <div style={{ fontSize: 14, color: '#0f172a', fontWeight: 500 }} dir={field.ltr ? 'ltr' : undefined}>
                  {field.value ?? '—'}
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid #f1f5f9' }}>
            <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 500, marginBottom: 8 }}>מטרות אישיות</div>
            <div
              style={{
                background: '#f8fafc',
                border: '1px dashed #e2e8f0',
                borderRadius: 7,
                padding: '16px',
                color: '#94a3b8',
                fontSize: 14,
                textAlign: 'center',
              }}
            >
              מטרות אישיות — בקרוב
            </div>
          </div>
        </div>
      )}

      {activeTab === 'groups' && (
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0' }}>
            <span style={{ fontWeight: 600, fontSize: 15, color: '#0f172a' }}>
              קבוצות ({participant.participantGroups?.length ?? 0})
            </span>
          </div>
          {participant.participantGroups?.length === 0 && (
            <p style={{ padding: '20px', color: '#94a3b8', margin: 0 }}>לא משויכת לאף קבוצה.</p>
          )}
          {participant.participantGroups?.map((pg) => (
            <div
              key={pg.id}
              style={{
                padding: '14px 20px',
                borderBottom: '1px solid #f1f5f9',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 500, color: '#0f172a' }}>{pg.group.name}</div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                  {pg.group.challenge.name} · {formatDate(pg.group.startDate)} — {formatDate(pg.group.endDate)}
                </div>
              </div>
              <div style={{ fontSize: 12, color: '#64748b' }}>הצטרפה {formatDate(pg.joinedAt)}</div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'tracking' && (
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 10,
            padding: '40px 24px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 12 }}>📅</div>
          <div style={{ color: '#374151', fontSize: 16, fontWeight: 500 }}>מעקב יומי</div>
          <div style={{ color: '#94a3b8', fontSize: 14, marginTop: 6 }}>
            כאן יוצגו נתוני הדיווח היומי — בקרוב
          </div>
        </div>
      )}

      {activeTab === 'insights' && (
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 10,
            padding: '40px 24px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 12 }}>🤖</div>
          <div style={{ color: '#374151', fontSize: 16, fontWeight: 500 }}>תובנות AI</div>
          <div style={{ color: '#94a3b8', fontSize: 14, marginTop: 6 }}>
            סיכום AI, מטרות שזוהו והישגים — בקרוב
          </div>
          <div
            style={{
              marginTop: 20,
              background: '#f8fafc',
              border: '1px dashed #e2e8f0',
              borderRadius: 8,
              padding: '16px',
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 12,
              textAlign: 'right',
            }}
          >
            {['סיכום משתתפת', 'מטרות שזוהו', 'הישגים', 'הודעות מומלצות'].map((item) => (
              <div
                key={item}
                style={{
                  background: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: 7,
                  padding: '12px',
                }}
              >
                <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 500 }}>{item}</div>
                <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 4 }}>— טרם נוצר —</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
