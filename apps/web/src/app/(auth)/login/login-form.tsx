'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BASE_URL, apiFetch } from '@lib/api';

interface AdminMe {
  id: string;
  email: string;
  fullName: string;
}

export default function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const from = params.get('from') ?? '/admin/dashboard';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [checkingSetup, setCheckingSetup] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);

  // First-run: check if any admin exists
  useEffect(() => {
    apiFetch<{ needsSetup: boolean }>(`${BASE_URL}/auth/setup-needed`)
      .then((res) => {
        if (res.needsSetup) {
          router.replace('/setup');
        } else {
          setCheckingSetup(false);
        }
      })
      .catch(() => setCheckingSetup(false));
  }, []);

  // Skip login if already authenticated
  useEffect(() => {
    apiFetch<AdminMe>(`${BASE_URL}/auth/me`)
      .then(() => router.replace(from))
      .catch(() => {});
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!email || !password) { setError('נא למלא אימייל וסיסמה'); return; }
    setLoading(true);
    try {
      await apiFetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      router.replace(from);
    } catch (err: unknown) {
      setError(err instanceof Object && 'message' in err ? String((err as { message: string }).message) : 'אימייל או סיסמה שגויים');
    } finally {
      setLoading(false);
    }
  }

  if (checkingSetup) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#64748b', fontSize: 14 }}>טוען...</div>
      </div>
    );
  }

  const card: React.CSSProperties = {
    background: '#fff', borderRadius: 16, padding: '36px 32px',
    boxShadow: '0 4px 24px rgba(0,0,0,0.08)', width: '100%', maxWidth: 400,
  };
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '11px 14px', fontSize: 15, borderRadius: 8,
    border: '1px solid #e2e8f0', outline: 'none', boxSizing: 'border-box',
    fontFamily: 'inherit',
  };
  const btnPrimary: React.CSSProperties = {
    width: '100%', padding: '12px', fontSize: 15, fontWeight: 700,
    background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8,
    cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1,
    marginTop: 4,
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={card}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>⚡</div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', margin: 0 }}>כניסה למערכת</h1>
          <p style={{ fontSize: 13, color: '#94a3b8', margin: '6px 0 0' }}>Challenge System — Admin</p>
        </div>

        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', color: '#dc2626', fontSize: 13, marginBottom: 16 }}>
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>אימייל</label>
            <input
              dir="ltr"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              style={inputStyle}
              placeholder="admin@example.com"
              autoComplete="email"
              autoFocus
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>סיסמה</label>
            <input
              dir="ltr"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              style={inputStyle}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>
          <button type="submit" disabled={loading} style={btnPrimary}>
            {loading ? 'מתחבר...' : 'כניסה'}
          </button>
        </form>
      </div>
    </div>
  );
}
