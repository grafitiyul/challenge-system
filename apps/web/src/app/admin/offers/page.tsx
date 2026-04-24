'use client';

import { useCallback, useEffect, useState } from 'react';
import { BASE_URL, apiFetch } from '@lib/api';

// Admin Offers catalog. "Offers" = buyable things (a program cycle, a
// coaching session, a package). The iCount payment page URL lives here
// so admin has one place to look up the link. Payments can optionally
// attach to an offer for business-context reporting.

interface Challenge { id: string; name: string; }
interface Program { id: string; name: string; }
interface Group { id: string; name: string; }

interface Offer {
  id: string;
  title: string;
  description: string | null;
  amount: string;           // Decimal serialized as string
  currency: string;
  iCountPaymentUrl: string | null;
  linkedChallenge: Challenge | null;
  linkedProgram: Program | null;
  defaultGroup: Group | null;
  isActive: boolean;
  createdAt: string;
  _count: { payments: number };
}

const INPUT: React.CSSProperties = {
  width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0',
  borderRadius: 8, fontSize: 14, background: '#fff', color: '#0f172a',
  boxSizing: 'border-box', fontFamily: 'inherit',
};
const LABEL: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4,
};

export default function OffersPage() {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState<Offer | 'new' | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await apiFetch<Offer[]>(`${BASE_URL}/offers`, { cache: 'no-store' });
      setOffers(rows);
      setErr('');
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'טעינה נכשלה');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  return (
    <div className="page-wrapper" style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', margin: 0 }}>הצעות מכר</h1>
          <p style={{ fontSize: 14, color: '#64748b', margin: '4px 0 0' }}>
            מוצרים / שירותים למכירה. כאן שומרים גם את קישור ה-iCount לכל הצעה.
          </p>
        </div>
        <button
          onClick={() => setEditing('new')}
          style={{ padding: '10px 22px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
        >+ הצעה חדשה</button>
      </div>

      {loading && <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>טוען...</div>}
      {err && <div style={{ padding: 20, textAlign: 'center', color: '#b91c1c' }}>{err}</div>}

      {!loading && !err && offers.length === 0 && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 40, textAlign: 'center', color: '#64748b' }}>
          עדיין אין הצעות. לחצי “הצעה חדשה” כדי ליצור אחת.
        </div>
      )}

      {!loading && offers.map((o) => (
        <div
          key={o.id}
          onClick={() => setEditing(o)}
          style={{
            background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10,
            padding: 16, marginBottom: 10, cursor: 'pointer',
            opacity: o.isActive ? 1 : 0.55,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>{o.title}</div>
                {!o.isActive && (
                  <span style={{ background: '#f1f5f9', color: '#64748b', padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600 }}>
                    לא פעיל
                  </span>
                )}
                <span style={{ background: '#dbeafe', color: '#1d4ed8', padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
                  {Number(o.amount).toLocaleString('he-IL')} {o.currency}
                </span>
                {o._count.payments > 0 && (
                  <span style={{ background: '#dcfce7', color: '#15803d', padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
                    💳 {o._count.payments} תשלומים
                  </span>
                )}
              </div>
              {o.description && <div style={{ fontSize: 13, color: '#475569', marginBottom: 6 }}>{o.description}</div>}
              <div style={{ display: 'flex', gap: 10, fontSize: 12, color: '#64748b', flexWrap: 'wrap' }}>
                {o.linkedChallenge && <span>אתגר: {o.linkedChallenge.name}</span>}
                {o.linkedProgram && <span>תוכנית: {o.linkedProgram.name}</span>}
                {o.defaultGroup && <span>קבוצת ברירת-מחדל: {o.defaultGroup.name}</span>}
                {o.iCountPaymentUrl && (
                  <a
                    href={o.iCountPaymentUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    style={{ color: '#2563eb' }}
                  >🔗 iCount</a>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}

      {editing && (
        <OfferModal
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void reload(); }}
        />
      )}
    </div>
  );
}

// ─── Modal ───────────────────────────────────────────────────────────────────

function OfferModal(props: { initial: Offer | null; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!props.initial;
  const [title, setTitle] = useState(props.initial?.title ?? '');
  const [description, setDescription] = useState(props.initial?.description ?? '');
  const [amount, setAmount] = useState(props.initial ? props.initial.amount : '');
  const [currency, setCurrency] = useState(props.initial?.currency ?? 'ILS');
  const [iCountPaymentUrl, setIcount] = useState(props.initial?.iCountPaymentUrl ?? '');
  const [isActive, setIsActive] = useState(props.initial?.isActive ?? true);
  const [linkedChallengeId, setChallengeId] = useState(props.initial?.linkedChallenge?.id ?? '');
  const [linkedProgramId, setProgramId] = useState(props.initial?.linkedProgram?.id ?? '');
  const [defaultGroupId, setGroupId] = useState(props.initial?.defaultGroup?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  useEffect(() => {
    void Promise.all([
      apiFetch<Challenge[]>(`${BASE_URL}/challenges`).then(setChallenges).catch(() => {}),
      apiFetch<Program[]>(`${BASE_URL}/programs`).then(setPrograms).catch(() => {}),
      apiFetch<Group[]>(`${BASE_URL}/groups`).then(setGroups).catch(() => {}),
    ]);
  }, []);

  async function submit() {
    if (!title.trim()) { setErr('כותרת חובה'); return; }
    const n = parseFloat(String(amount).replace(',', '.'));
    if (!isFinite(n) || n < 0) { setErr('סכום לא תקין'); return; }
    setBusy(true); setErr('');
    try {
      const body = {
        title: title.trim(),
        description: description.trim() || null,
        amount: n,
        currency: currency.trim() || 'ILS',
        iCountPaymentUrl: iCountPaymentUrl.trim() || null,
        linkedChallengeId: linkedChallengeId || null,
        linkedProgramId: linkedProgramId || null,
        defaultGroupId: defaultGroupId || null,
        isActive,
      };
      if (isEdit) {
        await apiFetch(`${BASE_URL}/offers/${props.initial!.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
      } else {
        await apiFetch(`${BASE_URL}/offers`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
      }
      props.onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'שמירה נכשלה');
    } finally { setBusy(false); }
  }

  async function deactivate() {
    if (!props.initial) return;
    if (!confirm('להפוך את ההצעה ללא-פעילה? תשלומים קיימים יישמרו.')) return;
    setBusy(true);
    try {
      await apiFetch(`${BASE_URL}/offers/${props.initial.id}`, { method: 'DELETE' });
      props.onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'שמירה נכשלה');
    } finally { setBusy(false); }
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !busy) props.onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
    >
      <div style={{ background: '#fff', borderRadius: 14, padding: 24, width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{isEdit ? 'עריכת הצעה' : 'הצעה חדשה'}</div>
          <button aria-label="סגור" onClick={props.onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>

        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            <label style={LABEL}>כותרת *</label>
            <input style={INPUT} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="לדוגמה: משחק הרגלי אכילה — מחזור מאי" />
          </div>
          <div>
            <label style={LABEL}>תיאור</label>
            <textarea
              style={{ ...INPUT, minHeight: 72, resize: 'vertical' as const }}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
            <div>
              <label style={LABEL}>סכום *</label>
              <input style={INPUT} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
            </div>
            <div>
              <label style={LABEL}>מטבע</label>
              <input style={INPUT} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
            </div>
          </div>
          <div>
            <label style={LABEL}>קישור iCount</label>
            <input style={INPUT} dir="ltr" value={iCountPaymentUrl} onChange={(e) => setIcount(e.target.value)} placeholder="https://..." />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={LABEL}>אתגר</label>
              <select style={INPUT} value={linkedChallengeId} onChange={(e) => setChallengeId(e.target.value)}>
                <option value="">— ללא —</option>
                {challenges.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label style={LABEL}>תוכנית</label>
              <select style={INPUT} value={linkedProgramId} onChange={(e) => setProgramId(e.target.value)}>
                <option value="">— ללא —</option>
                {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label style={LABEL}>קבוצת ברירת-מחדל (לשיוך מהיר אחרי תשלום)</label>
            <select style={INPUT} value={defaultGroupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">— ללא —</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#0f172a' }}>
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            הצעה פעילה (מופיעה בבוחרים של תשלומים)
          </label>
          {err && <div style={{ color: '#b91c1c', fontSize: 13 }}>{err}</div>}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 18, alignItems: 'center' }}>
          <div>
            {isEdit && props.initial?.isActive && (
              <button
                onClick={deactivate}
                disabled={busy}
                style={{ padding: '8px 14px', fontSize: 13, fontWeight: 600, background: 'transparent', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: 8, cursor: 'pointer' }}
              >השבת הצעה</button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={props.onClose} style={{ padding: '8px 18px', background: '#f1f5f9', border: '1px solid #e2e8f0', color: '#374151', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>ביטול</button>
            <button
              onClick={submit}
              disabled={busy}
              style={{ padding: '8px 22px', background: busy ? '#93c5fd' : '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer' }}
            >{busy ? 'שומר...' : 'שמירה'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
