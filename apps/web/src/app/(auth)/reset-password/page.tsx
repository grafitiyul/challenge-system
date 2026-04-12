'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BASE_URL, apiFetch } from '@lib/api';

function ResetPasswordInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) setError('קישור לא תקין — לא נמצא טוקן');
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!password || password.length < 8) { setError('הסיסמה חייבת להיות לפחות 8 תווים'); return; }
    if (password !== confirm) { setError('הסיסמאות אינן תואמות'); return; }
    setLoading(true);
    try {
      await apiFetch(`${BASE_URL}/auth/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      });
      setDone(true);
    } catch (err: unknown) {
      setError(err instanceof Object && 'message' in err ? String((err as { message: string }).message) : 'הקישור אינו בתוקף או כבר נוצל');
    } finally { setLoading(false); }
  }

  const card: React.CSSProperties = {
    background: '#fff', borderRadius: 16, padding: '36px 32px',
    boxShadow: '0 4px 24px rgba(0,0,0,0.08)', width: '100%', maxWidth: 400,
  };
  const input: React.CSSProperties = {
    width: '100%', padding: '11px 14px', fontSize: 15, borderRadius: 8,
    border: '1px solid #e2e8f0', outline: 'none', boxSizing: 'border-box' as const,
    fontFamily: 'inherit',
  };
  const btnPrimary: React.CSSProperties = {
    width: '100%', padding: '12px', fontSize: 15, fontWeight: 700,
    background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8,
    cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1, marginTop: 4,
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={card}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🔑</div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', margin: 0 }}>איפוס סיסמה</h1>
        </div>

        {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', color: '#dc2626', fontSize: 13, marginBottom: 16 }}>{error}</div>}

        {done ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>✅</div>
            <p style={{ fontSize: 14, color: '#374151', marginBottom: 20 }}>הסיסמה עודכנה בהצלחה!</p>
            <button onClick={() => router.push('/login')} style={{ ...btnPrimary, marginTop: 0 }}>
              כניסה למערכת
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>סיסמה חדשה</label>
              <input dir="ltr" type="password" value={password} onChange={e => setPassword(e.target.value)} style={input} placeholder="לפחות 8 תווים" autoComplete="new-password" />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>אימות סיסמה</label>
              <input dir="ltr" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} style={input} placeholder="חזרה על הסיסמה" autoComplete="new-password" />
            </div>
            <button type="submit" disabled={loading || !token} style={btnPrimary}>
              {loading ? 'שומר...' : 'שמור סיסמה'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordInner />
    </Suspense>
  );
}
