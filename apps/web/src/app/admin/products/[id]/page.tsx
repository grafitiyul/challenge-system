'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { BASE_URL, apiFetch } from '@lib/api';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ProductDetail {
  id: string;
  title: string;
  description: string | null;
  kind: string;
  isActive: boolean;
  offers: Array<{
    id: string; title: string; amount: string; currency: string;
    iCountPaymentUrl: string | null;
    defaultGroup: { id: string; name: string } | null;
  }>;
  questionnaireTemplates: Array<{
    id: string; internalName: string; publicTitle: string; submissionPurpose: string;
  }>;
  communicationTemplates: Array<CommunicationTemplate>;
}

interface CommunicationTemplate {
  id: string;
  channel: 'email' | 'whatsapp';
  title: string;
  subject: string | null;
  body: string;
  isActive: boolean;
}

interface WaitlistEntry {
  id: string;
  source: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  participant: {
    id: string; firstName: string; lastName: string | null; phoneNumber: string; email: string | null;
    status: string | null;
  };
}

type Tab = 'settings' | 'offers' | 'waitlist' | 'templates';

// ─── Shared styles ───────────────────────────────────────────────────────────

const INPUT: React.CSSProperties = {
  width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0',
  borderRadius: 8, fontSize: 14, background: '#fff', color: '#0f172a',
  boxSizing: 'border-box', fontFamily: 'inherit',
};
const LABEL: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4,
};

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<Tab>('settings');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const p = await apiFetch<ProductDetail>(`${BASE_URL}/products/${id}`, { cache: 'no-store' });
      setProduct(p);
      setErr('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'טעינה נכשלה');
    } finally { setLoading(false); }
  }, [id]);
  useEffect(() => { void reload(); }, [reload]);

  if (loading) return <div className="page-wrapper" style={{ maxWidth: 1000, margin: '0 auto', padding: 40, textAlign: 'center', color: '#94a3b8' }}>טוען...</div>;
  if (err || !product) return (
    <div className="page-wrapper" style={{ maxWidth: 1000, margin: '0 auto' }}>
      <Link href="/admin/products" style={{ color: '#2563eb', fontSize: 14 }}>← חזרה לרשימה</Link>
      <div style={{ padding: 20, color: '#b91c1c', textAlign: 'center' }}>{err || 'לא נמצא'}</div>
    </div>
  );

  return (
    <div className="page-wrapper" style={{ maxWidth: 1000, margin: '0 auto' }}>
      <Link href="/admin/products" style={{ color: '#64748b', fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 18 }}>
        ← חזרה לרשימה
      </Link>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', margin: 0 }}>{product.title}</h1>
        {product.description && <p style={{ fontSize: 14, color: '#64748b', margin: '6px 0 0' }}>{product.description}</p>}
      </div>

      <div style={{ display: 'flex', gap: 0, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {([
          ['settings', 'הגדרות'],
          ['offers', 'הצעות מכר'],
          ['waitlist', 'רשימת המתנה'],
          ['templates', 'תבניות הודעה'],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            style={{
              padding: '9px 18px', fontSize: 14, fontWeight: 600,
              background: tab === k ? '#eff6ff' : 'transparent',
              color: tab === k ? '#1d4ed8' : '#64748b',
              border: 'none', borderRadius: 8, cursor: 'pointer',
            }}
          >{label}</button>
        ))}
      </div>

      {tab === 'settings' && <SettingsTab product={product} onSaved={() => void reload()} />}
      {tab === 'offers' && <OffersTab product={product} />}
      {tab === 'waitlist' && <WaitlistTab productId={product.id} />}
      {tab === 'templates' && <TemplatesTab productId={product.id} initial={product.communicationTemplates} onChanged={() => void reload()} />}
    </div>
  );
}

// ─── Settings tab ────────────────────────────────────────────────────────────

function SettingsTab(props: { product: ProductDetail; onSaved: () => void }) {
  const [title, setTitle] = useState(props.product.title);
  const [description, setDescription] = useState(props.product.description ?? '');
  const [kind, setKind] = useState(props.product.kind);
  const [isActive, setIsActive] = useState(props.product.isActive);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function save() {
    setBusy(true); setErr('');
    try {
      await apiFetch(`${BASE_URL}/products/${props.product.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          kind,
          isActive,
        }),
      });
      props.onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'שמירה נכשלה');
    } finally { setBusy(false); }
  }
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 20 }}>
      <div style={{ display: 'grid', gap: 12, maxWidth: 560 }}>
        <div>
          <label style={LABEL}>כותרת</label>
          <input style={INPUT} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label style={LABEL}>תיאור</label>
          <textarea
            style={{ ...INPUT, minHeight: 80, resize: 'vertical' as const }}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div>
          <label style={LABEL}>סוג</label>
          <select style={INPUT} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="game">משחק</option>
            <option value="challenge">אתגר</option>
            <option value="group_coaching">ליווי קבוצתי</option>
            <option value="personal_coaching">ליווי אישי</option>
            <option value="other">אחר</option>
          </select>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          פעיל
        </label>
        {err && <div style={{ color: '#b91c1c', fontSize: 13 }}>{err}</div>}
        <div>
          <button
            onClick={save}
            disabled={busy}
            style={{ padding: '9px 22px', background: busy ? '#93c5fd' : '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer' }}
          >{busy ? 'שומר...' : 'שמירה'}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Offers tab (read-only; edit happens in /admin/offers) ──────────────────

function OffersTab({ product }: { product: ProductDetail }) {
  if (product.offers.length === 0) {
    return (
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 20, color: '#64748b' }}>
        אין עדיין הצעות מכר למוצר זה.{' '}
        <Link href="/admin/offers" style={{ color: '#2563eb' }}>צרי הצעה</Link>
        {' '}ושייכי אותה למוצר.
      </div>
    );
  }
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
      {product.offers.map((o) => (
        <div key={o.id} style={{ padding: 14, borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{o.title}</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
              {Number(o.amount).toLocaleString('he-IL')} {o.currency}
              {o.defaultGroup && <> · ברירת מחדל: {o.defaultGroup.name}</>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {o.iCountPaymentUrl && (
              <a href={o.iCountPaymentUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#2563eb' }}>
                🔗 iCount
              </a>
            )}
            <Link href="/admin/offers" style={{ fontSize: 12, color: '#64748b' }}>ערכי</Link>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Waitlist tab ────────────────────────────────────────────────────────────

function WaitlistTab({ productId }: { productId: string }) {
  const [rows, setRows] = useState<WaitlistEntry[] | null>(null);
  const [err, setErr] = useState('');
  const reload = useCallback(() => {
    apiFetch<WaitlistEntry[]>(`${BASE_URL}/products/${productId}/waitlist`, { cache: 'no-store' })
      .then(setRows)
      .catch((e) => setErr(e instanceof Error ? e.message : 'טעינה נכשלה'));
  }, [productId]);
  useEffect(() => { reload(); }, [reload]);

  async function remove(participantId: string) {
    if (!confirm('להוריד את המשתתפת מהמתנה?')) return;
    await apiFetch(`${BASE_URL}/products/${productId}/waitlist/${participantId}`, { method: 'DELETE' });
    reload();
  }

  if (err) return <div style={{ color: '#b91c1c' }}>{err}</div>;
  if (!rows) return <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8' }}>טוען...</div>;
  if (rows.length === 0) return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 20, color: '#64748b' }}>
      אין משתתפות ברשימת המתנה למוצר זה.
    </div>
  );
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
      {rows.map((r) => (
        <div key={r.id} style={{ padding: 14, borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Link href={`/admin/participants/${r.participant.id}`} style={{ color: '#0f172a', textDecoration: 'none', fontWeight: 600 }}>
              {[r.participant.firstName, r.participant.lastName].filter(Boolean).join(' ')}
            </Link>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
              <span dir="ltr">{r.participant.phoneNumber}</span>
              {r.source && <> · מקור: {r.source}</>}
              {' · '}{new Date(r.createdAt).toLocaleDateString('he-IL')}
            </div>
          </div>
          <button
            onClick={() => remove(r.participant.id)}
            style={{ padding: '6px 12px', fontSize: 12, background: 'transparent', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: 7, cursor: 'pointer' }}
          >הסר</button>
        </div>
      ))}
    </div>
  );
}

// ─── Templates tab ──────────────────────────────────────────────────────────

function TemplatesTab(props: {
  productId: string;
  initial: CommunicationTemplate[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<CommunicationTemplate | 'new' | null>(null);
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 13, color: '#64748b' }}>
          {props.initial.length} תבניות פעילות. משתנים נתמכים:{' '}
          <code style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: 4, fontSize: 12 }}>
            {'{firstName} {productTitle} {offerTitle} {groupName} {portalLink}'}
          </code>
        </div>
        <button
          onClick={() => setEditing('new')}
          style={{ padding: '8px 14px', fontSize: 13, fontWeight: 600, background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}
        >+ תבנית</button>
      </div>

      {props.initial.length === 0 && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 20, color: '#64748b' }}>
          אין תבניות עדיין.
        </div>
      )}

      {props.initial.map((t) => (
        <div
          key={t.id}
          onClick={() => setEditing(t)}
          style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, marginBottom: 8, cursor: 'pointer' }}
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
            <span style={{
              background: t.channel === 'email' ? '#eff6ff' : '#dcfce7',
              color: t.channel === 'email' ? '#1d4ed8' : '#15803d',
              padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700,
            }}>
              {t.channel === 'email' ? 'מייל' : 'וואטסאפ'}
            </span>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{t.title}</div>
          </div>
          {t.subject && <div style={{ fontSize: 12, color: '#475569', marginBottom: 4 }}>נושא: {t.subject}</div>}
          <div style={{ fontSize: 12, color: '#64748b', whiteSpace: 'pre-wrap', maxHeight: 60, overflow: 'hidden' }}>
            {t.body.slice(0, 200)}{t.body.length > 200 ? '...' : ''}
          </div>
        </div>
      ))}

      {editing && (
        <TemplateModal
          productId={props.productId}
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); props.onChanged(); }}
        />
      )}
    </div>
  );
}

function TemplateModal(props: {
  productId: string;
  initial: CommunicationTemplate | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!props.initial;
  const [channel, setChannel] = useState<'email' | 'whatsapp'>(props.initial?.channel ?? 'whatsapp');
  const [title, setTitle] = useState(props.initial?.title ?? '');
  const [subject, setSubject] = useState(props.initial?.subject ?? '');
  const [body, setBody] = useState(props.initial?.body ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    if (!title.trim() || !body.trim()) { setErr('חובה למלא שם וגוף ההודעה'); return; }
    setBusy(true); setErr('');
    try {
      const payload = {
        channel,
        title: title.trim(),
        subject: channel === 'email' ? (subject.trim() || null) : null,
        body,
      };
      if (isEdit) {
        await apiFetch(`${BASE_URL}/communication-templates/${props.initial!.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetch(`${BASE_URL}/products/${props.productId}/templates`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      props.onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'שמירה נכשלה');
    } finally { setBusy(false); }
  }

  async function deactivate() {
    if (!props.initial) return;
    if (!confirm('להשבית את התבנית?')) return;
    await apiFetch(`${BASE_URL}/communication-templates/${props.initial.id}`, { method: 'DELETE' });
    props.onSaved();
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !busy) props.onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
    >
      <div style={{ background: '#fff', borderRadius: 14, padding: 22, width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>{isEdit ? 'עריכת תבנית' : 'תבנית חדשה'}</div>
          <button aria-label="סגור" onClick={props.onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            <label style={LABEL}>ערוץ</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['whatsapp', 'email'] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setChannel(c)}
                  style={{
                    flex: 1, padding: '9px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    border: `2px solid ${channel === c ? '#2563eb' : '#e2e8f0'}`,
                    background: channel === c ? '#eff6ff' : '#fff',
                    color: channel === c ? '#2563eb' : '#374151',
                    borderRadius: 7,
                  }}
                >{c === 'whatsapp' ? 'וואטסאפ' : 'מייל'}</button>
              ))}
            </div>
          </div>
          <div>
            <label style={LABEL}>שם התבנית *</label>
            <input style={INPUT} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="ברוכה הבאה אחרי תשלום" />
          </div>
          {channel === 'email' && (
            <div>
              <label style={LABEL}>נושא</label>
              <input style={INPUT} value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
          )}
          <div>
            <label style={LABEL}>גוף ההודעה *</label>
            <textarea
              style={{ ...INPUT, minHeight: 180, resize: 'vertical' as const, fontFamily: 'inherit' }}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="שלום {firstName}!&#10;ברוכה הבאה ל-{productTitle}.&#10;הקישור לפורטל: {portalLink}"
            />
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
              משתנים: {'{firstName}, {lastName}, {fullName}, {phoneNumber}, {email}, {productTitle}, {offerTitle}, {offerAmount}, {offerCurrency}, {groupName}, {portalLink}'}
            </div>
          </div>
          {err && <div style={{ color: '#b91c1c', fontSize: 13 }}>{err}</div>}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 18 }}>
          <div>
            {isEdit && (
              <button
                onClick={deactivate}
                style={{ padding: '8px 14px', fontSize: 13, fontWeight: 600, background: 'transparent', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: 8, cursor: 'pointer' }}
              >השבת</button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={props.onClose} style={{ padding: '8px 18px', background: '#f1f5f9', border: '1px solid #e2e8f0', color: '#374151', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>ביטול</button>
            <button
              onClick={save}
              disabled={busy}
              style={{ padding: '8px 22px', background: busy ? '#93c5fd' : '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer' }}
            >{busy ? 'שומר...' : 'שמירה'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
