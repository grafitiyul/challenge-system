'use client';

import { useState, useEffect, useCallback } from 'react';
import { BASE_URL, apiFetch } from '@lib/api';

interface AdminUser {
  id: string;
  fullName: string;
  email: string;
  isActive: boolean;
  createdAt: string;
}

interface ModalState {
  type: 'create' | 'edit' | 'password';
  user?: AdminUser;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function AdminUsersPage() {
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<AdminUser[]>(`${BASE_URL}/admin-users`);
      setAdmins(data);
    } catch {
      setError('שגיאה בטעינת רשימת המנהלים');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggleActive(user: AdminUser) {
    try {
      await apiFetch(`${BASE_URL}/admin-users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !user.isActive }),
      });
      await load();
    } catch {
      setError('שגיאה בעדכון סטטוס');
    }
  }

  const th: React.CSSProperties = { padding: '10px 14px', textAlign: 'right', fontSize: 12, fontWeight: 700, color: '#64748b', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' };
  const td: React.CSSProperties = { padding: '12px 14px', fontSize: 14, color: '#1e293b', borderBottom: '1px solid #f1f5f9' };

  return (
    <div className="page-wrapper">
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: 0 }}>ניהול מנהלים</h1>
            <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0' }}>רשימת כל חשבונות המנהל במערכת</p>
          </div>
          <button
            onClick={() => setModal({ type: 'create' })}
            style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 18px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
          >
            + הוסף מנהל
          </button>
        </div>

        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', color: '#dc2626', fontSize: 13, marginBottom: 16 }}>
            {error}
            <button onClick={() => setError('')} style={{ marginRight: 8, background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontWeight: 700 }}>✕</button>
          </div>
        )}

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>טוען...</div>
        ) : (
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>שם מלא</th>
                  <th style={th}>אימייל</th>
                  <th style={th}>תאריך יצירה</th>
                  <th style={th}>סטטוס</th>
                  <th style={{ ...th, textAlign: 'center' }}>פעולות</th>
                </tr>
              </thead>
              <tbody>
                {admins.length === 0 ? (
                  <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: '#94a3b8' }}>אין מנהלים</td></tr>
                ) : admins.map(admin => (
                  <tr key={admin.id}>
                    <td style={td}><span style={{ fontWeight: 600 }}>{admin.fullName}</span></td>
                    <td style={{ ...td, direction: 'ltr', textAlign: 'right' }}>{admin.email}</td>
                    <td style={td}>{formatDate(admin.createdAt)}</td>
                    <td style={td}>
                      <span style={{
                        display: 'inline-block', padding: '2px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                        background: admin.isActive ? '#dcfce7' : '#fee2e2',
                        color: admin.isActive ? '#16a34a' : '#dc2626',
                      }}>
                        {admin.isActive ? 'פעיל' : 'מושהה'}
                      </span>
                    </td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                        <button
                          onClick={() => setModal({ type: 'edit', user: admin })}
                          style={{ background: '#f1f5f9', border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer', color: '#374151' }}
                        >
                          ערוך
                        </button>
                        <button
                          onClick={() => setModal({ type: 'password', user: admin })}
                          style={{ background: '#f1f5f9', border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer', color: '#374151' }}
                        >
                          סיסמה
                        </button>
                        <button
                          onClick={() => toggleActive(admin)}
                          style={{
                            background: admin.isActive ? '#fef2f2' : '#f0fdf4',
                            border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer',
                            color: admin.isActive ? '#dc2626' : '#16a34a',
                          }}
                        >
                          {admin.isActive ? 'השהה' : 'הפעל'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal && (
        <AdminModal
          modal={modal}
          onClose={() => setModal(null)}
          onSuccess={() => { setModal(null); load(); }}
        />
      )}
    </div>
  );
}

function AdminModal({ modal, onClose, onSuccess }: {
  modal: ModalState;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const user = modal.user;
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (modal.type === 'password') {
      if (password.length < 8) { setError('הסיסמה חייבת להכיל לפחות 8 תווים'); return; }
      if (password !== confirm) { setError('הסיסמאות אינן תואמות'); return; }
      setLoading(true);
      try {
        await apiFetch(`${BASE_URL}/admin-users/${user!.id}/set-password`, {
          method: 'POST',
          body: JSON.stringify({ password }),
        });
        onSuccess();
      } catch (err: unknown) {
        setError(err instanceof Object && 'message' in err ? String((err as { message: string }).message) : 'שגיאה');
      } finally { setLoading(false); }
      return;
    }

    if (modal.type === 'create') {
      if (!fullName || !email || !password) { setError('נא למלא את כל השדות'); return; }
      if (password.length < 8) { setError('הסיסמה חייבת להכיל לפחות 8 תווים'); return; }
      if (password !== confirm) { setError('הסיסמאות אינן תואמות'); return; }
      setLoading(true);
      try {
        await apiFetch(`${BASE_URL}/admin-users`, {
          method: 'POST',
          body: JSON.stringify({ fullName, email, password }),
        });
        onSuccess();
      } catch (err: unknown) {
        setError(err instanceof Object && 'message' in err ? String((err as { message: string }).message) : 'שגיאה');
      } finally { setLoading(false); }
      return;
    }

    // edit
    if (!fullName || !email) { setError('נא למלא שם ואימייל'); return; }
    setLoading(true);
    try {
      await apiFetch(`${BASE_URL}/admin-users/${user!.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ fullName, email }),
      });
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Object && 'message' in err ? String((err as { message: string }).message) : 'שגיאה');
    } finally { setLoading(false); }
  }

  const titles = { create: 'הוספת מנהל חדש', edit: 'עריכת מנהל', password: 'שינוי סיסמה' };
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 12px', fontSize: 14, borderRadius: 8,
    border: '1px solid #e2e8f0', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: '28px 28px', width: '100%', maxWidth: 420 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#0f172a' }}>{titles[modal.type]}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#94a3b8', lineHeight: 1 }}>✕</button>
        </div>

        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 12px', color: '#dc2626', fontSize: 13, marginBottom: 14 }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {modal.type !== 'password' && (
            <>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 5 }}>שם מלא</label>
                <input type="text" value={fullName} onChange={e => setFullName(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 5 }}>אימייל</label>
                <input dir="ltr" type="email" value={email} onChange={e => setEmail(e.target.value)} style={inputStyle} />
              </div>
            </>
          )}

          {(modal.type === 'create' || modal.type === 'password') && (
            <>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 5 }}>
                  {modal.type === 'password' ? 'סיסמה חדשה' : 'סיסמה'} (לפחות 8 תווים)
                </label>
                <input dir="ltr" type="password" value={password} onChange={e => setPassword(e.target.value)} style={inputStyle} autoComplete="new-password" />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 5 }}>אימות סיסמה</label>
                <input dir="ltr" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} style={inputStyle} autoComplete="new-password" />
              </div>
            </>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button
              type="submit"
              disabled={loading}
              style={{ flex: 1, padding: '11px', fontSize: 14, fontWeight: 700, background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}
            >
              {loading ? 'שומר...' : 'שמור'}
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{ flex: 1, padding: '11px', fontSize: 14, fontWeight: 600, background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 8, cursor: 'pointer' }}
            >
              ביטול
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
