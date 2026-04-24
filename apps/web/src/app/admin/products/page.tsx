'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { BASE_URL, apiFetch } from '@lib/api';

interface Product {
  id: string;
  title: string;
  description: string | null;
  kind: string;
  isActive: boolean;
  createdAt: string;
  _count: {
    offers: number;
    questionnaireTemplates: number;
    communicationTemplates: number;
    waitlistEntries: number;
  };
}

const KIND_LABELS: Record<string, string> = {
  game: 'משחק',
  challenge: 'אתגר',
  group_coaching: 'ליווי קבוצתי',
  personal_coaching: 'ליווי אישי',
  other: 'אחר',
};

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [creating, setCreating] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await apiFetch<Product[]>(`${BASE_URL}/products`, { cache: 'no-store' });
      setProducts(rows);
      setErr('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'טעינה נכשלה');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  return (
    <div className="page-wrapper" style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', margin: 0 }}>מוצרים</h1>
          <p style={{ fontSize: 14, color: '#64748b', margin: '4px 0 0' }}>
            היחידה הארגונית העליונה. לכל מוצר — הצעות מכר, רשימת המתנה, תבניות הודעה ושאלונים.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          style={{ padding: '10px 22px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
        >+ מוצר חדש</button>
      </div>

      {loading && <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>טוען...</div>}
      {err && <div style={{ padding: 20, textAlign: 'center', color: '#b91c1c' }}>{err}</div>}

      {!loading && !err && products.length === 0 && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 40, textAlign: 'center', color: '#64748b' }}>
          עדיין אין מוצרים. לחצי “מוצר חדש” כדי להתחיל.
        </div>
      )}

      {!loading && products.map((p) => (
        <Link
          key={p.id}
          href={`/admin/products/${p.id}`}
          style={{ textDecoration: 'none' }}
        >
          <div
            style={{
              background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10,
              padding: 16, marginBottom: 10, cursor: 'pointer',
              opacity: p.isActive ? 1 : 0.6,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>{p.title}</div>
                  <span style={{ background: '#f1f5f9', color: '#475569', padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600 }}>
                    {KIND_LABELS[p.kind] ?? p.kind}
                  </span>
                  {!p.isActive && (
                    <span style={{ background: '#fef3c7', color: '#92400e', padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600 }}>
                      לא פעיל
                    </span>
                  )}
                </div>
                {p.description && <div style={{ fontSize: 13, color: '#475569', marginBottom: 6 }}>{p.description}</div>}
                <div style={{ display: 'flex', gap: 12, fontSize: 12, color: '#64748b', flexWrap: 'wrap' }}>
                  <span>🏷 {p._count.offers} הצעות</span>
                  <span>📋 {p._count.questionnaireTemplates} שאלונים</span>
                  <span>💬 {p._count.communicationTemplates} תבניות</span>
                  <span>⏳ {p._count.waitlistEntries} ברשימת המתנה</span>
                </div>
              </div>
            </div>
          </div>
        </Link>
      ))}

      {creating && (
        <CreateProductModal
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); void reload(); }}
        />
      )}
    </div>
  );
}

// ─── Create modal ────────────────────────────────────────────────────────────

function CreateProductModal(props: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState('game');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    if (!title.trim()) { setErr('כותרת חובה'); return; }
    setBusy(true); setErr('');
    try {
      await apiFetch(`${BASE_URL}/products`, {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          kind,
        }),
      });
      props.onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'יצירה נכשלה');
    } finally { setBusy(false); }
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !busy) props.onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
    >
      <div style={{ background: '#fff', borderRadius: 14, padding: 22, width: '100%', maxWidth: 460, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>מוצר חדש</div>
          <button aria-label="סגור" onClick={props.onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>כותרת *</label>
            <input
              autoFocus
              style={{ width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="לדוגמה: משחק הרגלי אכילה"
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>תיאור</label>
            <textarea
              style={{ width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14, minHeight: 72, resize: 'vertical' as const, boxSizing: 'border-box', fontFamily: 'inherit' }}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>סוג</label>
            <select
              style={{ width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              {Object.entries(KIND_LABELS).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
          </div>
          {err && <div style={{ color: '#b91c1c', fontSize: 13 }}>{err}</div>}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={props.onClose} style={{ padding: '8px 18px', background: '#f1f5f9', border: '1px solid #e2e8f0', color: '#374151', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>ביטול</button>
          <button
            onClick={submit}
            disabled={busy}
            style={{ padding: '8px 22px', background: busy ? '#93c5fd' : '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer' }}
          >{busy ? 'יוצר...' : 'צור מוצר'}</button>
        </div>
      </div>
    </div>
  );
}
