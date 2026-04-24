'use client';

// iCount webhook review console. Lists audit rows the ingester created,
// lets admin attach unmatched logs manually, and re-run matching on
// logs that previously failed.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { BASE_URL, apiFetch } from '@lib/api';

interface LogRow {
  id: string;
  status: 'processed' | 'needs_review' | 'duplicate' | 'error';
  extDocNumber: string | null;
  extTransactionId: string | null;
  extAmount: string | null;
  extCurrency: string | null;
  extCustomerName: string | null;
  extCustomerPhone: string | null;
  extCustomerEmail: string | null;
  extPageId: string | null;
  extItemName: string | null;
  errorMessage: string | null;
  adminNotes: string | null;
  processedAt: string | null;
  createdAt: string;
  rawPayload: unknown;
  matchedOffer: { id: string; title: string; amount: string; currency: string } | null;
  matchedParticipant: {
    id: string; firstName: string; lastName: string | null;
    phoneNumber: string; email: string | null;
  } | null;
  matchedPayment: { id: string; itemName: string; amount: string; currency: string; paidAt: string } | null;
}

const STATUS_LABEL: Record<LogRow['status'], string> = {
  processed: 'עובד',
  needs_review: 'דורש בדיקה',
  duplicate: 'כפילות',
  error: 'שגיאה',
};
const STATUS_COLOR: Record<LogRow['status'], { bg: string; fg: string }> = {
  processed: { bg: '#dcfce7', fg: '#15803d' },
  needs_review: { bg: '#fef3c7', fg: '#b45309' },
  duplicate: { bg: '#f1f5f9', fg: '#64748b' },
  error: { bg: '#fef2f2', fg: '#b91c1c' },
};

export default function IcountWebhookPage() {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | LogRow['status']>('needs_review');
  const [detail, setDetail] = useState<LogRow | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    const qs = statusFilter ? `?status=${statusFilter}` : '';
    apiFetch<LogRow[]>(`${BASE_URL}/icount-webhook/logs${qs}`, { cache: 'no-store' })
      .then((r) => { setRows(r); setErr(''); })
      .catch((e) => setErr(e instanceof Error ? e.message : 'טעינה נכשלה'))
      .finally(() => setLoading(false));
  }, [statusFilter]);
  useEffect(() => { reload(); }, [reload]);

  return (
    <div className="page-wrapper" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>iCount — יומן Webhooks</h1>
        <p style={{ color: '#64748b', fontSize: 14, margin: '4px 0 0' }}>
          כל POST שמגיע ל-<code style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: 4 }}>/api/webhooks/icount/:secret</code>
          נשמר כאן. רשומות ש&quot;דורשות בדיקה&quot; לא התאימו אוטומטית לאף הצעה או משתתפת — שייכי ידנית.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' as const, alignItems: 'center' }}>
        <span style={{ fontSize: 13, color: '#64748b' }}>סינון לפי סטטוס:</span>
        {(['', 'needs_review', 'processed', 'duplicate', 'error'] as const).map((s) => (
          <button
            key={s || 'all'}
            onClick={() => setStatusFilter(s as typeof statusFilter)}
            style={{
              padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              borderRadius: 999,
              border: `1px solid ${statusFilter === s ? '#2563eb' : '#e2e8f0'}`,
              background: statusFilter === s ? '#eff6ff' : '#fff',
              color: statusFilter === s ? '#1d4ed8' : '#475569',
            }}
          >
            {s === '' ? 'הכל' : STATUS_LABEL[s as LogRow['status']]}
          </button>
        ))}
      </div>

      {loading && <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>טוען...</div>}
      {err && <div style={{ padding: 20, color: '#b91c1c' }}>{err}</div>}
      {!loading && rows.length === 0 && !err && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 40, textAlign: 'center', color: '#64748b' }}>
          אין רשומות בסטטוס הנבחר.
        </div>
      )}
      {!loading && rows.map((r) => {
        const color = STATUS_COLOR[r.status];
        return (
          <div
            key={r.id}
            onClick={() => setDetail(r)}
            style={{
              background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10,
              padding: 14, marginBottom: 8, cursor: 'pointer',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const, marginBottom: 6 }}>
              <span style={{ background: color.bg, color: color.fg, padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
                {STATUS_LABEL[r.status]}
              </span>
              <span style={{ fontWeight: 700, color: '#0f172a', fontSize: 14 }}>
                {r.extCustomerName ?? r.matchedParticipant?.firstName ?? '— ללא שם —'}
              </span>
              {r.extAmount && (
                <span style={{ background: '#dbeafe', color: '#1d4ed8', padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
                  {Number(r.extAmount).toLocaleString('he-IL')} {r.extCurrency ?? 'ILS'}
                </span>
              )}
              {r.matchedOffer && (
                <span style={{ background: '#eef2ff', color: '#4338ca', padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600 }}>
                  🏷 {r.matchedOffer.title}
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, color: '#64748b', display: 'flex', gap: 14, flexWrap: 'wrap' as const }}>
              {r.extCustomerPhone && <span dir="ltr">{r.extCustomerPhone}</span>}
              {r.extCustomerEmail && <span dir="ltr">{r.extCustomerEmail}</span>}
              {r.extDocNumber && <span>חשבונית #{r.extDocNumber}</span>}
              <span>{new Date(r.createdAt).toLocaleString('he-IL')}</span>
            </div>
            {r.errorMessage && (
              <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 6 }}>
                ⚠ {r.errorMessage}
              </div>
            )}
          </div>
        );
      })}

      {detail && (
        <LogDetailModal
          log={detail}
          onClose={() => setDetail(null)}
          onChanged={() => { setDetail(null); reload(); }}
        />
      )}
    </div>
  );
}

// ─── Detail / attach modal ─────────────────────────────────────────────────

function LogDetailModal(props: { log: LogRow; onClose: () => void; onChanged: () => void }) {
  const [tab, setTab] = useState<'overview' | 'attach' | 'raw'>('overview');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function reprocess() {
    setBusy(true); setErr('');
    try {
      await apiFetch(`${BASE_URL}/icount-webhook/logs/${props.log.id}/reprocess`, { method: 'POST' });
      props.onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'הפעולה נכשלה');
    } finally { setBusy(false); }
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !busy) props.onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 16 }}
    >
      <div style={{ background: '#fff', borderRadius: 14, padding: 22, width: '100%', maxWidth: 640, maxHeight: '90vh', overflowY: 'auto' as const, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>Webhook #{props.log.id.slice(-6)}</div>
          <button aria-label="סגור" onClick={props.onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ display: 'flex', gap: 0, border: '1px solid #e2e8f0', borderRadius: 10, padding: 4, marginBottom: 14 }}>
          {(['overview', 'attach', 'raw'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              style={{
                flex: 1, padding: '8px 10px', fontSize: 13, fontWeight: 600,
                border: 'none', borderRadius: 7, cursor: 'pointer',
                background: tab === k ? '#eff6ff' : 'transparent',
                color: tab === k ? '#1d4ed8' : '#64748b',
              }}
            >
              {k === 'overview' ? 'סקירה' : k === 'attach' ? 'שיוך ידני' : 'JSON גולמי'}
            </button>
          ))}
        </div>

        {tab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 10 }}>
            <Field label="סטטוס" value={STATUS_LABEL[props.log.status]} />
            <Field label="תאריך קבלה" value={new Date(props.log.createdAt).toLocaleString('he-IL')} />
            <Field label="שם לקוח" value={props.log.extCustomerName} />
            <Field label="טלפון" value={props.log.extCustomerPhone} dir="ltr" />
            <Field label="אימייל" value={props.log.extCustomerEmail} dir="ltr" />
            <Field label="סכום" value={props.log.extAmount ? `${Number(props.log.extAmount).toLocaleString('he-IL')} ${props.log.extCurrency ?? ''}` : null} />
            <Field label="חשבונית" value={props.log.extDocNumber} />
            <Field label="מזהה עסקה" value={props.log.extTransactionId} dir="ltr" />
            <Field label="Page ID" value={props.log.extPageId} dir="ltr" />
            <Field label="שם פריט" value={props.log.extItemName} />
            {props.log.matchedOffer && (
              <Field label="הצעה משויכת" value={props.log.matchedOffer.title} />
            )}
            {props.log.matchedParticipant && (
              <Field
                label="משתתפת משויכת"
                value={`${props.log.matchedParticipant.firstName} ${props.log.matchedParticipant.lastName ?? ''}`.trim()}
                href={`/admin/participants/${props.log.matchedParticipant.id}`}
              />
            )}
            {props.log.errorMessage && (
              <Field label="שגיאה" value={props.log.errorMessage} danger />
            )}
            {err && <div style={{ color: '#b91c1c', fontSize: 13 }}>{err}</div>}
            {props.log.status !== 'processed' && (
              <button
                onClick={reprocess}
                disabled={busy}
                style={{ padding: '9px 18px', background: busy ? '#93c5fd' : '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer', marginTop: 8 }}
              >
                {busy ? 'מריץ...' : '🔁 הרץ שוב התאמה אוטומטית'}
              </button>
            )}
          </div>
        )}

        {tab === 'attach' && (
          <AttachPane log={props.log} onAttached={props.onChanged} />
        )}

        {tab === 'raw' && (
          <pre style={{ background: '#0f172a', color: '#e2e8f0', padding: 14, borderRadius: 8, overflow: 'auto', maxHeight: 420, fontSize: 12, direction: 'ltr' as const }}>
{JSON.stringify(props.log.rawPayload, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

function Field(props: { label: string; value: string | null; dir?: 'ltr' | 'rtl'; href?: string; danger?: boolean }) {
  if (!props.value) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, padding: '6px 0', borderBottom: '1px solid #f1f5f9' }}>
      <span style={{ fontSize: 12, color: '#64748b' }}>{props.label}</span>
      {props.href ? (
        <Link href={props.href} style={{ fontSize: 13, color: '#2563eb', textAlign: 'end' as const, fontWeight: 600 }}>
          {props.value} ←
        </Link>
      ) : (
        <span dir={props.dir} style={{ fontSize: 13, color: props.danger ? '#b91c1c' : '#0f172a', textAlign: 'end' as const, fontWeight: 500 }}>
          {props.value}
        </span>
      )}
    </div>
  );
}

// Manual attach: pick an active offer + search participants. On confirm
// we POST /icount-webhook/logs/:id/attach which creates the Payment,
// auto-joins the group, and marks the log processed.
function AttachPane(props: { log: LogRow; onAttached: () => void }) {
  const [offers, setOffers] = useState<Array<{ id: string; title: string; amount: string; currency: string }>>([]);
  const [offerId, setOfferId] = useState(props.log.matchedOffer?.id ?? '');
  const [participants, setParticipants] = useState<LogRow['matchedParticipant'][]>([]);
  const [participantId, setParticipantId] = useState(props.log.matchedParticipant?.id ?? '');
  const [search, setSearch] = useState(props.log.extCustomerPhone ?? props.log.extCustomerEmail ?? '');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    apiFetch<Array<{ id: string; title: string; amount: string; currency: string }>>(
      `${BASE_URL}/offers?active=true`,
    ).then(setOffers).catch(() => setOffers([]));
    apiFetch<LogRow['matchedParticipant'][]>(`${BASE_URL}/participants`)
      .then((rows) => setParticipants(rows))
      .catch(() => setParticipants([]));
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return participants.slice(0, 20);
    const q = search.toLowerCase();
    return participants.filter((p) => {
      if (!p) return false;
      const name = `${p.firstName} ${p.lastName ?? ''}`.toLowerCase();
      return name.includes(q)
        || (p.phoneNumber ?? '').includes(search)
        || (p.email ?? '').toLowerCase().includes(q);
    }).slice(0, 20);
  }, [participants, search]);

  async function submit() {
    if (!offerId || !participantId) { setErr('יש לבחור הצעה ומשתתפת'); return; }
    setBusy(true); setErr('');
    try {
      await apiFetch(`${BASE_URL}/icount-webhook/logs/${props.log.id}/attach`, {
        method: 'POST',
        body: JSON.stringify({ offerId, participantId, notes: notes.trim() || null }),
      });
      props.onAttached();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'שיוך נכשל');
    } finally { setBusy(false); }
  }

  const input: React.CSSProperties = {
    width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0',
    borderRadius: 8, fontSize: 14, background: '#fff', boxSizing: 'border-box',
  };
  const label: React.CSSProperties = {
    display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4,
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div>
        <label style={label}>הצעה *</label>
        <select style={input} value={offerId} onChange={(e) => setOfferId(e.target.value)}>
          <option value="">— בחרי —</option>
          {offers.map((o) => (
            <option key={o.id} value={o.id}>
              {o.title} · {Number(o.amount).toLocaleString('he-IL')} {o.currency}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label style={label}>משתתפת *</label>
        <input
          style={{ ...input, marginBottom: 6 }}
          placeholder="חיפוש לפי שם / טלפון / אימייל..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div style={{ maxHeight: 200, overflowY: 'auto' as const, border: '1px solid #e2e8f0', borderRadius: 8 }}>
          {filtered.map((p) => p && (
            <button
              key={p.id}
              type="button"
              onClick={() => setParticipantId(p.id)}
              style={{
                width: '100%', textAlign: 'start' as const, padding: '8px 12px',
                background: participantId === p.id ? '#eff6ff' : '#fff',
                border: 'none', borderBottom: '1px solid #f1f5f9', cursor: 'pointer',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}
            >
              <span style={{ fontWeight: 600, color: '#0f172a' }}>
                {[p.firstName, p.lastName].filter(Boolean).join(' ')}
              </span>
              <span dir="ltr" style={{ fontSize: 12, color: '#64748b' }}>
                {p.phoneNumber}
              </span>
            </button>
          ))}
          {filtered.length === 0 && (
            <div style={{ padding: 16, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>אין התאמות</div>
          )}
        </div>
      </div>
      <div>
        <label style={label}>הערות לשיוך</label>
        <textarea
          style={{ ...input, minHeight: 60, resize: 'vertical' as const, fontFamily: 'inherit' }}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      {err && <div style={{ color: '#b91c1c', fontSize: 13 }}>{err}</div>}
      <button
        onClick={submit}
        disabled={busy || !offerId || !participantId}
        style={{ padding: '9px 18px', background: busy ? '#93c5fd' : '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: busy || !offerId || !participantId ? 'not-allowed' : 'pointer' }}
      >
        {busy ? 'משייך...' : '🔗 שייכי ויצרי תשלום'}
      </button>
    </div>
  );
}
