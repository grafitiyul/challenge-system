'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BASE_URL, apiFetch } from '@lib/api';

type Mode = 'password' | 'code' | 'forgot';
type CodeStep = 'request' | 'verify';

interface AdminMe {
  id: string;
  email: string;
  fullName: string;
}

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const from = params.get('from') ?? '/dashboard';

  const [mode, setMode] = useState<Mode>('password');
  const [codeStep, setCodeStep] = useState<CodeStep>('request');

  // Password login
  const [pwEmail, setPwEmail] = useState('');
  const [pwPassword, setPwPassword] = useState('');

  // Code login
  const [codeEmail, setCodeEmail] = useState('');
  const [otp, setOtp] = useState('');

  // Forgot password
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotDone, setForgotDone] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // If already logged in, skip to dashboard
  useEffect(() => {
    apiFetch<AdminMe>(`${BASE_URL}/auth/me`)
      .then(() => router.replace(from))
      .catch(() => {}); // not logged in — stay on login page
  }, []);

  function resetErrors() { setError(''); setSuccess(''); }

  // ─── Password login ──────────────────────────────────────────────────────

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault();
    resetErrors();
    if (!pwEmail || !pwPassword) { setError('נא למלא אימייל וסיסמה'); return; }
    setLoading(true);
    try {
      await apiFetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        body: JSON.stringify({ email: pwEmail, password: pwPassword }),
      });
      router.replace(from);
    } catch (err: unknown) {
      setError(err instanceof Object && 'message' in err ? String((err as { message: string }).message) : 'שגיאה בכניסה');
    } finally { setLoading(false); }
  }

  // ─── Email code ──────────────────────────────────────────────────────────

  async function handleRequestCode(e: React.FormEvent) {
    e.preventDefault();
    resetErrors();
    if (!codeEmail) { setError('נא להכניס אימייל'); return; }
    setLoading(true);
    try {
      await apiFetch(`${BASE_URL}/auth/request-code`, {
        method: 'POST',
        body: JSON.stringify({ email: codeEmail }),
      });
      setSuccess('קוד נשלח לאימייל שלך');
      setCodeStep('verify');
    } catch {
      // Always show success — don't leak whether email exists
      setSuccess('קוד נשלח לאימייל שלך');
      setCodeStep('verify');
    } finally { setLoading(false); }
  }

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    resetErrors();
    if (!otp) { setError('נא להכניס את הקוד'); return; }
    setLoading(true);
    try {
      await apiFetch(`${BASE_URL}/auth/verify-code`, {
        method: 'POST',
        body: JSON.stringify({ email: codeEmail, code: otp }),
      });
      router.replace(from);
    } catch (err: unknown) {
      setError(err instanceof Object && 'message' in err ? String((err as { message: string }).message) : 'קוד שגוי או פג תוקף');
    } finally { setLoading(false); }
  }

  // ─── Forgot password ─────────────────────────────────────────────────────

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    resetErrors();
    if (!forgotEmail) { setError('נא להכניס אימייל'); return; }
    setLoading(true);
    try {
      await apiFetch(`${BASE_URL}/auth/forgot-password`, {
        method: 'POST',
        body: JSON.stringify({ email: forgotEmail }),
      });
      setForgotDone(true);
    } catch {
      setForgotDone(true); // Always show success
    } finally { setLoading(false); }
  }

  // ─── Styles ───────────────────────────────────────────────────────────────

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
    cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1,
    marginTop: 4,
  };
  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: '9px 0', fontSize: 13, fontWeight: active ? 700 : 500,
    background: active ? '#eff6ff' : 'transparent', color: active ? '#2563eb' : '#64748b',
    border: 'none', borderBottom: active ? '2px solid #2563eb' : '2px solid transparent',
    cursor: 'pointer',
  });

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={card}>
        {/* Logo / title */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>⚡</div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', margin: 0 }}>כניסה למערכת</h1>
          <p style={{ fontSize: 13, color: '#94a3b8', margin: '6px 0 0' }}>Challenge System — Admin</p>
        </div>

        {/* Mode tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', marginBottom: 24, gap: 0 }}>
          <button style={tabStyle(mode === 'password')} onClick={() => { setMode('password'); resetErrors(); setCodeStep('request'); }}>
            סיסמה
          </button>
          <button style={tabStyle(mode === 'code')} onClick={() => { setMode('code'); resetErrors(); setCodeStep('request'); }}>
            קוד במייל
          </button>
          <button style={tabStyle(mode === 'forgot')} onClick={() => { setMode('forgot'); resetErrors(); setForgotDone(false); }}>
            שכחתי סיסמה
          </button>
        </div>

        {/* Error / success */}
        {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', color: '#dc2626', fontSize: 13, marginBottom: 16 }}>{error}</div>}
        {success && <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 14px', color: '#15803d', fontSize: 13, marginBottom: 16 }}>{success}</div>}

        {/* ── Password mode ── */}
        {mode === 'password' && (
          <form onSubmit={handlePasswordLogin} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>אימייל</label>
              <input dir="ltr" type="email" value={pwEmail} onChange={e => setPwEmail(e.target.value)} style={input} placeholder="admin@example.com" autoComplete="email" />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>סיסמה</label>
              <input dir="ltr" type="password" value={pwPassword} onChange={e => setPwPassword(e.target.value)} style={input} placeholder="••••••••" autoComplete="current-password" />
            </div>
            <button type="submit" disabled={loading} style={btnPrimary}>
              {loading ? 'מתחבר...' : 'כניסה'}
            </button>
          </form>
        )}

        {/* ── Code mode ── */}
        {mode === 'code' && codeStep === 'request' && (
          <form onSubmit={handleRequestCode} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>אימייל</label>
              <input dir="ltr" type="email" value={codeEmail} onChange={e => setCodeEmail(e.target.value)} style={input} placeholder="admin@example.com" autoComplete="email" />
            </div>
            <button type="submit" disabled={loading} style={btnPrimary}>
              {loading ? 'שולח...' : 'שלח קוד'}
            </button>
          </form>
        )}

        {mode === 'code' && codeStep === 'verify' && (
          <form onSubmit={handleVerifyCode} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 4px' }}>הכניסי את הקוד שנשלח לכתובת <strong>{codeEmail}</strong></p>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>קוד בן 6 ספרות</label>
              <input dir="ltr" type="text" inputMode="numeric" maxLength={6} value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, ''))} style={{ ...input, fontSize: 24, textAlign: 'center', letterSpacing: '0.3em' }} placeholder="000000" />
            </div>
            <button type="submit" disabled={loading} style={btnPrimary}>
              {loading ? 'בודק...' : 'כניסה עם קוד'}
            </button>
            <button type="button" onClick={() => { setCodeStep('request'); setOtp(''); resetErrors(); }} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 13, cursor: 'pointer', textAlign: 'center' }}>
              שלח קוד חדש
            </button>
          </form>
        )}

        {/* ── Forgot password mode ── */}
        {mode === 'forgot' && !forgotDone && (
          <form onSubmit={handleForgotPassword} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 4px' }}>הכניסי את כתובת האימייל שלך ונשלח לך קישור לאיפוס הסיסמה.</p>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>אימייל</label>
              <input dir="ltr" type="email" value={forgotEmail} onChange={e => setForgotEmail(e.target.value)} style={input} placeholder="admin@example.com" autoComplete="email" />
            </div>
            <button type="submit" disabled={loading} style={btnPrimary}>
              {loading ? 'שולח...' : 'שלח קישור לאיפוס'}
            </button>
          </form>
        )}

        {mode === 'forgot' && forgotDone && (
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>📧</div>
            <p style={{ fontSize: 14, color: '#374151', lineHeight: 1.6 }}>
              אם האימייל קיים במערכת, קישור לאיפוס הסיסמה נשלח אליו.<br />
              <span style={{ fontSize: 13, color: '#94a3b8' }}>הקישור תקף לשעה אחת.</span>
            </p>
            <button type="button" onClick={() => { setMode('password'); setForgotDone(false); resetErrors(); }} style={{ marginTop: 16, background: 'none', border: 'none', color: '#2563eb', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
              חזרה לכניסה
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
