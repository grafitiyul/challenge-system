'use client';

import { useEffect, useState } from 'react';
import { BASE_URL } from '@lib/api';

interface NamedItem {
  id: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
}

interface SettingSection {
  key: string;
  title: string;
  description: string;
  icon: string;
  endpoint: string;
  placeholder: string;
}

const SECTIONS: SettingSection[] = [
  {
    key: 'challengeTypes',
    title: 'סוגי אתגרים',
    description: 'הגדר את סוגי האתגרים הזמינים במערכת',
    icon: '⚡',
    endpoint: '/challenge-types',
    placeholder: 'לדוגמה: ירידה במשקל, כושר, כסף',
  },
  {
    key: 'genders',
    title: 'מגדרים',
    description: 'אפשרויות המגדר הזמינות בטפסי הרשמה',
    icon: '👤',
    endpoint: '/genders',
    placeholder: 'לדוגמה: אישה, גבר, אחר',
  },
];

const PLACEHOLDER_SECTIONS = [
  {
    title: 'מקורות הגעה',
    description: 'מאיפה מגיעות המשתתפות — לנתוני מעקב',
    icon: '📣',
  },
  {
    title: 'הגדרות WhatsApp',
    description: 'חיבור קבוצות ווטסאפ ואינטגרציה עם המערכת',
    icon: '💬',
  },
  {
    title: 'מנהלי מערכת',
    description: 'ניהול גישת המנהלים למערכת',
    icon: '🔑',
  },
  {
    title: 'הגדרות AI',
    description: 'קביעת מודל AI, prompt עיקרי והגדרות ניתוח',
    icon: '🤖',
  },
];

const MOCK_SETTING_KEY = 'showMockParticipants';

export default function SettingsPage() {
  const [data, setData] = useState<Record<string, NamedItem[]>>({});
  const [loading, setLoading] = useState(true);
  const [showMock, setShowMock] = useState(false);

  const toggleShowMock = (val: boolean) => {
    localStorage.setItem(MOCK_SETTING_KEY, String(val));
    setShowMock(val);
  };

  useEffect(() => {
    // Read mock setting from localStorage on mount
    setShowMock(localStorage.getItem(MOCK_SETTING_KEY) === 'true');
    // Load all configurable lists on mount
    const load = async () => {
      try {
        const results = await Promise.all(
          SECTIONS.map((s) => {
            console.log('[API] GET', `${BASE_URL}${s.endpoint}`);
            return fetch(`${BASE_URL}${s.endpoint}`)
              .then((r) => r.json())
              .then((d: unknown) => [s.key, Array.isArray(d) ? d : []] as [string, NamedItem[]]);
          }),
        );
        setData(Object.fromEntries(results));
      } catch {
        // Continue with empty state on error
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  return (
    <div className="page-wrapper" style={{ maxWidth: 900, margin: '0 auto' }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', margin: 0 }}>הגדרות</h1>
        <p style={{ color: '#64748b', fontSize: 14, marginTop: 4, marginBottom: 0 }}>
          ניהול ערכי קונפיגורציה — ללא שינוי קוד
        </p>
      </div>

      {/* Live sections */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 28 }}>
        {SECTIONS.map((section) => {
          const items: NamedItem[] = data[section.key] ?? [];
          return (
            <div
              key={section.key}
              style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}
            >
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 22 }}>{section.icon}</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 15, color: '#0f172a' }}>{section.title}</div>
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{section.description}</div>
                  </div>
                </div>
              </div>

              <div style={{ padding: '12px 0' }}>
                {loading && (
                  <p style={{ padding: '8px 20px', color: '#94a3b8', fontSize: 13, margin: 0 }}>טוען...</p>
                )}
                {!loading && items.length === 0 && (
                  <p style={{ padding: '8px 20px', color: '#94a3b8', fontSize: 13, margin: 0 }}>
                    אין ערכים עדיין.
                  </p>
                )}
                {items.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      padding: '8px 20px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      borderBottom: '1px solid #f8fafc',
                    }}
                  >
                    <span style={{ fontSize: 14, color: '#374151' }}>{item.name}</span>
                    <span
                      style={{
                        fontSize: 11,
                        background: item.isActive ? '#dcfce7' : '#f1f5f9',
                        color: item.isActive ? '#16a34a' : '#94a3b8',
                        padding: '2px 8px',
                        borderRadius: 10,
                      }}
                    >
                      {item.isActive ? 'פעיל' : 'לא פעיל'}
                    </span>
                  </div>
                ))}
              </div>

              <div style={{ padding: '10px 20px', borderTop: '1px solid #f1f5f9' }}>
                <button
                  disabled
                  style={{
                    padding: '7px 16px',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: 7,
                    color: '#94a3b8',
                    fontSize: 13,
                    cursor: 'not-allowed',
                  }}
                >
                  + הוסף (בקרוב)
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Testing / mock settings */}
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: 12,
          padding: '20px 24px',
          marginBottom: 28,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 20,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 20 }}>🧪</span>
            <span style={{ fontWeight: 600, fontSize: 15, color: '#0f172a' }}>הצג משתתפות פיקטיביות</span>
          </div>
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
            כאשר כבוי — משתתפות פיקטיביות מוסתרות בכל מסכי המערכת. הגדרה זו נשמרת בדפדפן.
          </div>
        </div>
        <button
          onClick={() => toggleShowMock(!showMock)}
          style={{
            position: 'relative',
            width: 52,
            height: 28,
            borderRadius: 14,
            border: 'none',
            background: showMock ? '#2563eb' : '#cbd5e1',
            cursor: 'pointer',
            transition: 'background 0.2s',
            flexShrink: 0,
          }}
          aria-label="Toggle mock participants"
        >
          <span
            style={{
              position: 'absolute',
              top: 3,
              right: showMock ? 3 : 25,
              width: 22,
              height: 22,
              borderRadius: '50%',
              background: '#ffffff',
              boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              transition: 'right 0.2s',
            }}
          />
        </button>
      </div>

      {/* Placeholder sections */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
        {PLACEHOLDER_SECTIONS.map((s) => (
          <div
            key={s.title}
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 12,
              padding: '20px',
              opacity: 0.7,
            }}
          >
            <div style={{ fontSize: 28, marginBottom: 10 }}>{s.icon}</div>
            <div style={{ fontWeight: 600, fontSize: 14, color: '#374151' }}>{s.title}</div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{s.description}</div>
            <div
              style={{
                marginTop: 12,
                display: 'inline-block',
                background: '#f1f5f9',
                color: '#94a3b8',
                padding: '3px 10px',
                borderRadius: 20,
                fontSize: 11,
              }}
            >
              בקרוב
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
