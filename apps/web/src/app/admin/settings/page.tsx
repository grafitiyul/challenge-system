'use client';

import { useEffect, useState } from 'react';
import { BASE_URL, apiFetch } from '@lib/api';

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

export default function SettingsPage() {
  const [data, setData] = useState<Record<string, NamedItem[]>>({});
  const [loading, setLoading] = useState(true);
  const [mockEnabled, setMockEnabled] = useState(false);
  const [mockToggling, setMockToggling] = useState(false);

  const toggleMock = async (val: boolean) => {
    setMockToggling(true);
    try {
      await apiFetch(`${BASE_URL}/settings/mockParticipantsEnabled`, {
        method: 'PATCH',
        body: JSON.stringify({ value: String(val) }),
      });
      setMockEnabled(val);
    } catch {
      // ignore — UI stays unchanged on error
    } finally {
      setMockToggling(false);
    }
  };

  useEffect(() => {
    const load = async () => {
      try {
        const [systemSettings, ...listResults] = await Promise.all([
          apiFetch(`${BASE_URL}/settings`) as Promise<Record<string, string>>,
          ...SECTIONS.map((s) =>
            apiFetch(`${BASE_URL}${s.endpoint}`)
              .then((d: unknown) => [s.key, Array.isArray(d) ? d : []] as [string, NamedItem[]]),
          ),
        ]);
        setMockEnabled((systemSettings as Record<string, string>)['mockParticipantsEnabled'] === 'true');
        setData(Object.fromEntries(listResults as [string, NamedItem[]][]));
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
          onClick={() => !mockToggling && toggleMock(!mockEnabled)}
          disabled={mockToggling}
          style={{
            position: 'relative',
            width: 52,
            height: 28,
            borderRadius: 14,
            border: 'none',
            background: mockEnabled ? '#2563eb' : '#cbd5e1',
            cursor: mockToggling ? 'not-allowed' : 'pointer',
            opacity: mockToggling ? 0.7 : 1,
            transition: 'background 0.2s',
            flexShrink: 0,
          }}
          aria-label="Toggle mock participants"
        >
          <span
            style={{
              position: 'absolute',
              top: 3,
              right: mockEnabled ? 3 : 25,
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

      {/* Email sender — admin-editable identity for outbound mail. SMTP
          transport (host/port/user/pass) remains env-driven for security. */}
      <EmailSenderCard />

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

// ─── Email sender card ─────────────────────────────────────────────────────

function EmailSenderCard() {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<'name' | 'address' | null>(null);
  const [saved, setSaved] = useState<'name' | 'address' | null>(null);

  useEffect(() => {
    apiFetch<Record<string, string>>(`${BASE_URL}/settings`)
      .then((s) => {
        setName(s.emailSenderName ?? '');
        setAddress(s.emailSenderAddress ?? '');
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  async function save(key: 'emailSenderName' | 'emailSenderAddress', value: string) {
    const which = key === 'emailSenderName' ? 'name' : 'address';
    setBusy(which);
    try {
      await apiFetch(`${BASE_URL}/settings/${key}`, {
        method: 'PATCH',
        body: JSON.stringify({ value }),
      });
      setSaved(which);
      setTimeout(() => setSaved(null), 1500);
    } catch {
      // ignore — UI stays at its current value
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20, marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 22 }}>✉️</span>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15, color: '#0f172a' }}>זהות שולח המייל</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
            שם וכתובת שיופיעו בכותרת “מאת”. פרטי ה-SMTP (שרת, משתמש, סיסמה) מוגדרים כ-env ולא כאן.
          </div>
        </div>
      </div>
      {!loaded && <div style={{ fontSize: 13, color: '#94a3b8' }}>טוען...</div>}
      {loaded && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>שם השולח</label>
            <input
              style={{ width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => void save('emailSenderName', name)}
              placeholder="Challenge System"
            />
            {saved === 'name' && <div style={{ fontSize: 11, color: '#15803d', marginTop: 4 }}>✓ נשמר</div>}
            {busy === 'name' && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>שומר...</div>}
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>כתובת השולח</label>
            <input
              dir="ltr"
              style={{ width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onBlur={() => void save('emailSenderAddress', address)}
              placeholder="noreply@example.com"
            />
            {saved === 'address' && <div style={{ fontSize: 11, color: '#15803d', marginTop: 4 }}>✓ נשמר</div>}
            {busy === 'address' && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>שומר...</div>}
          </div>
        </div>
      )}
    </div>
  );
}
