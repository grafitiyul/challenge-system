'use client';

import { useCallback, useEffect, useState } from 'react';
import { BASE_URL, apiFetch } from '@lib/api';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Payment {
  id: string;
  provider: string;
  externalPaymentId: string | null;
  amount: string; // Prisma Decimal is serialized as string over JSON
  currency: string;
  paidAt: string;
  status: string;
  itemName: string;
  invoiceNumber: string | null;
  invoiceUrl: string | null;
  notes: string | null;
  verifiedAt: string | null;
  // Joined product/cohort context. Both optional — one-off manual payments
  // won't have them.
  offer: {
    id: string;
    title: string;
    currency: string;
    iCountPaymentUrl: string | null;
    linkedChallenge: { id: string; name: string } | null;
    linkedProgram: { id: string; name: string } | null;
    defaultGroup: { id: string; name: string } | null;
  } | null;
  group: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

interface OfferLite {
  id: string;
  title: string;
  amount: string;
  currency: string;
  iCountPaymentUrl: string | null;
  defaultGroup: { id: string; name: string } | null;
}

interface GroupLite {
  id: string;
  name: string;
  challenge?: { id: string; name: string } | null;
  isActive: boolean;
  _count?: { participantGroups: number };
}

// Shown on the status chip.
const STATUS_LABELS: Record<string, string> = {
  paid: 'שולם',
  pending: 'בהמתנה',
  refunded: 'הוחזר',
  failed: 'נכשל',
};
const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  paid:     { bg: '#dcfce7', fg: '#15803d' },
  pending:  { bg: '#fef3c7', fg: '#b45309' },
  refunded: { bg: '#f1f5f9', fg: '#64748b' },
  failed:   { bg: '#fef2f2', fg: '#b91c1c' },
};

const PROVIDER_LABELS: Record<string, string> = {
  manual: 'ידני',
  icount: 'iCount',
  other:  'אחר',
};

// ─── Props ───────────────────────────────────────────────────────────────────

interface Props {
  participantId: string;
  // Groups the participant is already in — used to dim those in the picker
  // so admin doesn't accidentally re-add.
  currentGroupIds: string[];
  // Called after admin marks as paid / moves to group so the parent can
  // refresh the header chip + membership list.
  onParticipantChanged?: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PaymentsTab({ participantId, currentGroupIds, onParticipantChanged }: Props) {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // After a fresh add we surface a soft nudge bar ("סמני כשילמה" +
  // "העבירי לקבוצה"). Cleared on tab reopen, not persisted.
  const [nudgeAfter, setNudgeAfter] = useState<Payment | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await apiFetch<Payment[]>(
        `${BASE_URL}/participants/${participantId}/payments`,
        { cache: 'no-store' },
      );
      setPayments(rows);
      setLoadErr('');
    } catch (e: unknown) {
      setLoadErr(e instanceof Error ? e.message : 'טעינה נכשלה');
    } finally {
      setLoading(false);
    }
  }, [participantId]);

  useEffect(() => { void reload(); }, [reload]);

  async function removePayment(id: string) {
    if (!confirm('למחוק את התשלום הזה?')) return;
    try {
      await apiFetch(`${BASE_URL}/payments/${id}`, { method: 'DELETE' });
      await reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'מחיקה נכשלה');
    }
  }

  async function toggleVerified(p: Payment) {
    try {
      await apiFetch(`${BASE_URL}/payments/${p.id}/verify`, {
        method: 'POST',
        body: JSON.stringify({ verified: !p.verifiedAt }),
      });
      await reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'עדכון נכשל');
    }
  }

  async function markParticipantPaid() {
    setStatusBusy(true);
    try {
      await apiFetch(`${BASE_URL}/participants/${participantId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'paid' }),
      });
      setNudgeAfter(null);
      onParticipantChanged?.();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'עדכון הסטטוס נכשל');
    } finally {
      setStatusBusy(false);
    }
  }

  const cardStyle: React.CSSProperties = {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    padding: 16,
    marginBottom: 12,
  };
  const btnPrimary: React.CSSProperties = {
    padding: '9px 16px', fontSize: 13, fontWeight: 600,
    background: '#2563eb', color: '#fff', border: 'none',
    borderRadius: 8, cursor: 'pointer',
  };
  const btnGhost: React.CSSProperties = {
    padding: '7px 12px', fontSize: 12, fontWeight: 600,
    background: 'transparent', color: '#475569',
    border: '1px solid #e2e8f0', borderRadius: 8, cursor: 'pointer',
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#0f172a' }}>תשלומים וחשבונות</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
            הזנה ידנית. חיבור ל-iCount יבוא בשלב הבא.
          </div>
        </div>
        <button onClick={() => setAddOpen(true)} style={btnPrimary}>+ הוסף תשלום</button>
      </div>

      {/* After-add nudge — soft bar with the two convenience actions */}
      {nudgeAfter && (
        <div style={{
          background: '#ecfeff', border: '1px solid #a5f3fc', borderRadius: 10,
          padding: 14, marginBottom: 14,
        }}>
          <div style={{ fontSize: 14, color: '#164e63', marginBottom: 8 }}>
            ✓ התשלום נשמר. מה עכשיו?
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              onClick={markParticipantPaid}
              disabled={statusBusy}
              style={btnPrimary}
            >
              {statusBusy ? 'מעדכן...' : 'סמני את המשתתפת כשילמה'}
            </button>
            <button
              onClick={() => setPickerOpen(true)}
              style={{ ...btnPrimary, background: '#0891b2' }}
            >
              📂 העבירי לקבוצה
            </button>
            <button onClick={() => setNudgeAfter(null)} style={btnGhost}>
              סגור
            </button>
          </div>
        </div>
      )}

      {loading && <div style={{ ...cardStyle, textAlign: 'center', color: '#94a3b8' }}>טוען...</div>}
      {loadErr && <div style={{ ...cardStyle, textAlign: 'center', color: '#b91c1c' }}>{loadErr}</div>}

      {!loading && !loadErr && payments.length === 0 && (
        <div style={{ ...cardStyle, textAlign: 'center', color: '#64748b', padding: 32 }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>💳</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>עדיין אין תשלומים</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>
            לחצי “הוסף תשלום” כדי להזין תשלום ראשון.
          </div>
        </div>
      )}

      {!loading && payments.map((p) => {
        const sc = STATUS_COLORS[p.status] ?? { bg: '#f1f5f9', fg: '#64748b' };
        return (
          <div key={p.id} style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{p.itemName}</div>
                  <span style={{ background: sc.bg, color: sc.fg, padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
                    {STATUS_LABELS[p.status] ?? p.status}
                  </span>
                  <span style={{ background: '#f1f5f9', color: '#475569', padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600 }}>
                    {PROVIDER_LABELS[p.provider] ?? p.provider}
                  </span>
                  {p.verifiedAt && (
                    <span title={`אומת ב-${new Date(p.verifiedAt).toLocaleDateString('he-IL')}`} style={{ background: '#dcfce7', color: '#15803d', padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
                      ✓ מאומת
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: '#475569' }}>
                  <span style={{ fontWeight: 700, color: '#0f172a' }}>
                    {Number(p.amount).toLocaleString('he-IL')} {p.currency}
                  </span>
                  <span>שולם: {new Date(p.paidAt).toLocaleDateString('he-IL')}</span>
                  {p.invoiceNumber && <span>חשבונית #{p.invoiceNumber}</span>}
                  {p.invoiceUrl && (
                    <a href={p.invoiceUrl} target="_blank" rel="noreferrer" style={{ color: '#2563eb' }}>
                      פתח חשבונית ↗
                    </a>
                  )}
                </div>
                {(p.offer || p.group) && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                    {p.offer && (
                      <span style={{ background: '#eff6ff', color: '#1d4ed8', padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600 }}>
                        🏷 {p.offer.title}
                      </span>
                    )}
                    {p.offer?.linkedChallenge && (
                      <span style={{ background: '#f1f5f9', color: '#475569', padding: '3px 10px', borderRadius: 999, fontSize: 11 }}>
                        {p.offer.linkedChallenge.name}
                      </span>
                    )}
                    {p.offer?.linkedProgram && (
                      <span style={{ background: '#f1f5f9', color: '#475569', padding: '3px 10px', borderRadius: 999, fontSize: 11 }}>
                        {p.offer.linkedProgram.name}
                      </span>
                    )}
                    {p.group && (
                      <span style={{ background: '#ecfeff', color: '#0e7490', padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600 }}>
                        📂 {p.group.name}
                      </span>
                    )}
                  </div>
                )}
                {p.notes && <div style={{ fontSize: 12, color: '#64748b', marginTop: 6, whiteSpace: 'pre-wrap' }}>{p.notes}</div>}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button
                  onClick={() => toggleVerified(p)}
                  style={{
                    ...btnGhost,
                    color: p.verifiedAt ? '#b45309' : '#15803d',
                    borderColor: p.verifiedAt ? '#fde68a' : '#bbf7d0',
                  }}
                  title={p.verifiedAt ? 'בטל אימות' : 'סמני כמאומת (תואם לדף בנק / כספים)'}
                >
                  {p.verifiedAt ? 'בטל אימות' : '✓ אמת תשלום'}
                </button>
                <button onClick={() => removePayment(p.id)} style={{ ...btnGhost, color: '#b91c1c', borderColor: '#fecaca' }}>
                  מחק
                </button>
              </div>
            </div>
          </div>
        );
      })}

      {/* Standalone "move to group" button, reachable even without a fresh add */}
      {!loading && payments.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <button onClick={() => setPickerOpen(true)} style={btnGhost}>
            📂 העבירי לקבוצה / שיוך למחזור
          </button>
        </div>
      )}

      {addOpen && (
        <AddPaymentModal
          participantId={participantId}
          onClose={() => setAddOpen(false)}
          onCreated={(created) => {
            setAddOpen(false);
            setNudgeAfter(created);
            void reload();
          }}
        />
      )}

      {pickerOpen && (
        <GroupPickerModal
          participantId={participantId}
          excludeGroupIds={currentGroupIds}
          onClose={() => setPickerOpen(false)}
          onAssigned={() => {
            setPickerOpen(false);
            setNudgeAfter(null);
            onParticipantChanged?.();
          }}
        />
      )}
    </div>
  );
}

// ─── Add Payment modal ───────────────────────────────────────────────────────

function AddPaymentModal(props: {
  participantId: string;
  onClose: () => void;
  onCreated: (p: Payment) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [offers, setOffers] = useState<OfferLite[]>([]);
  const [offerId, setOfferId] = useState<string>('');
  const [itemName, setItemName] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('ILS');
  const [paidAt, setPaidAt] = useState(today);
  const [provider, setProvider] = useState<'manual' | 'icount' | 'other'>('manual');
  const [status, setStatus] = useState<'paid' | 'pending' | 'refunded' | 'failed'>('paid');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceUrl, setInvoiceUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Load active offers so admin can pick one instead of retyping amount +
  // title every time.
  useEffect(() => {
    apiFetch<OfferLite[]>(`${BASE_URL}/offers?active=true`)
      .then((rows) => setOffers(rows))
      .catch(() => setOffers([]));
  }, []);

  // When an offer is chosen, prefill amount / currency / itemName. Admin
  // can still edit afterwards before saving.
  function selectOffer(id: string) {
    setOfferId(id);
    const o = offers.find((x) => x.id === id);
    if (o) {
      setItemName(o.title);
      setAmount(String(o.amount));
      setCurrency(o.currency);
    }
  }

  async function submit() {
    if (!itemName.trim()) { setErr('חובה לרשום שם מוצר/שירות'); return; }
    const n = parseFloat(amount.replace(',', '.'));
    if (!isFinite(n) || n <= 0) { setErr('סכום לא תקין'); return; }
    setBusy(true); setErr('');
    try {
      const body: Record<string, unknown> = {
        itemName: itemName.trim(),
        amount: n,
        currency: currency.trim() || 'ILS',
        paidAt,
        provider,
        status,
      };
      if (offerId) body.offerId = offerId;
      if (invoiceNumber.trim()) body.invoiceNumber = invoiceNumber.trim();
      if (invoiceUrl.trim()) body.invoiceUrl = invoiceUrl.trim();
      if (notes.trim()) body.notes = notes.trim();
      const created = await apiFetch<Payment>(
        `${BASE_URL}/participants/${props.participantId}/payments`,
        { method: 'POST', body: JSON.stringify(body) },
      );
      props.onCreated(created);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'שמירה נכשלה');
    } finally {
      setBusy(false);
    }
  }

  const pickedOffer = offers.find((o) => o.id === offerId);

  const label: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 };
  const input: React.CSSProperties = {
    width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0',
    borderRadius: 8, fontSize: 14, background: '#fff', color: '#0f172a',
    boxSizing: 'border-box', fontFamily: 'inherit',
  };

  return (
    <ModalShell title="הוספת תשלום" onClose={props.onClose} onSave={submit} saveLabel={busy ? 'שומר...' : 'שמור תשלום'} saving={busy}>
      <div style={{ display: 'grid', gap: 12 }}>
        <div>
          <label style={label}>הצעה / מוצר</label>
          <select style={input} value={offerId} onChange={(e) => selectOffer(e.target.value)}>
            <option value="">— ללא הצעה (תשלום ידני) —</option>
            {offers.map((o) => (
              <option key={o.id} value={o.id}>
                {o.title} · {Number(o.amount).toLocaleString('he-IL')} {o.currency}
              </option>
            ))}
          </select>
          {pickedOffer?.iCountPaymentUrl && (
            <div style={{ fontSize: 12, marginTop: 6 }}>
              קישור iCount להצעה:{' '}
              <a href={pickedOffer.iCountPaymentUrl} target="_blank" rel="noreferrer" style={{ color: '#2563eb' }}>
                {pickedOffer.iCountPaymentUrl}
              </a>
            </div>
          )}
        </div>
        <div>
          <label style={label}>שם מוצר / שירות *</label>
          <input style={input} value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="לדוגמה: מחזור חדש — מרץ 2026" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
          <div>
            <label style={label}>סכום *</label>
            <input style={input} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" inputMode="decimal" />
          </div>
          <div>
            <label style={label}>מטבע</label>
            <input style={input} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={label}>תאריך תשלום *</label>
            <input type="date" style={input} value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
          </div>
          <div>
            <label style={label}>סטטוס</label>
            <select style={input} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="paid">שולם</option>
              <option value="pending">בהמתנה</option>
              <option value="refunded">הוחזר</option>
              <option value="failed">נכשל</option>
            </select>
          </div>
        </div>
        <div>
          <label style={label}>ספק</label>
          <select style={input} value={provider} onChange={(e) => setProvider(e.target.value as typeof provider)}>
            <option value="manual">ידני</option>
            <option value="icount">iCount</option>
            <option value="other">אחר</option>
          </select>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={label}>מספר חשבונית</label>
            <input style={input} value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
          </div>
          <div>
            <label style={label}>קישור לחשבונית</label>
            <input style={input} value={invoiceUrl} dir="ltr" onChange={(e) => setInvoiceUrl(e.target.value)} placeholder="https://..." />
          </div>
        </div>
        <div>
          <label style={label}>הערות</label>
          <textarea
            style={{ ...input, minHeight: 72, resize: 'vertical' as const, fontFamily: 'inherit' }}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        {err && <div style={{ color: '#b91c1c', fontSize: 13 }}>{err}</div>}
      </div>
    </ModalShell>
  );
}

// ─── Group picker modal ──────────────────────────────────────────────────────

function GroupPickerModal(props: {
  participantId: string;
  excludeGroupIds: string[];
  onClose: () => void;
  onAssigned: () => void;
}) {
  const [groups, setGroups] = useState<GroupLite[] | null>(null);
  const [err, setErr] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<GroupLite[]>(`${BASE_URL}/groups`, { cache: 'no-store' })
      .then((rows) => setGroups(rows))
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : 'טעינה נכשלה'));
  }, []);

  async function assign(g: GroupLite) {
    setBusyId(g.id);
    try {
      await apiFetch(`${BASE_URL}/groups/${g.id}/participants`, {
        method: 'POST',
        body: JSON.stringify({ participantId: props.participantId }),
      });
      props.onAssigned();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'הוספה נכשלה');
      setBusyId(null);
    }
  }

  const alreadyIn = new Set(props.excludeGroupIds);

  return (
    <ModalShell title="שיוך לקבוצה / מחזור" onClose={props.onClose}>
      {!groups && <div style={{ padding: 16, textAlign: 'center', color: '#94a3b8' }}>טוען...</div>}
      {err && <div style={{ color: '#b91c1c', fontSize: 13, marginBottom: 10 }}>{err}</div>}
      {groups && groups.length === 0 && (
        <div style={{ padding: 16, textAlign: 'center', color: '#64748b' }}>אין קבוצות זמינות.</div>
      )}
      {groups && groups.map((g) => {
        const inGroup = alreadyIn.has(g.id);
        return (
          <div key={g.id} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 10, padding: '10px 12px', borderBottom: '1px solid #f1f5f9',
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{g.name}</div>
              {g.challenge && (
                <div style={{ fontSize: 12, color: '#64748b' }}>{g.challenge.name}</div>
              )}
            </div>
            {inGroup ? (
              <span style={{ fontSize: 12, color: '#64748b' }}>כבר בקבוצה</span>
            ) : (
              <button
                onClick={() => assign(g)}
                disabled={busyId !== null}
                style={{
                  padding: '7px 14px', fontSize: 13, fontWeight: 600,
                  background: busyId === g.id ? '#93c5fd' : '#2563eb', color: '#fff',
                  border: 'none', borderRadius: 8, cursor: busyId !== null ? 'not-allowed' : 'pointer',
                }}
              >{busyId === g.id ? 'משייך...' : 'שיוך'}</button>
            )}
          </div>
        );
      })}
    </ModalShell>
  );
}

// ─── Modal shell ─────────────────────────────────────────────────────────────

function ModalShell(props: {
  title: string;
  onClose: () => void;
  onSave?: () => void;
  saveLabel?: string;
  saving?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !props.saving) props.onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
    >
      <div style={{ background: '#fff', borderRadius: 14, padding: 22, width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>{props.title}</div>
          <button
            aria-label="סגור"
            onClick={props.onClose}
            style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 22, cursor: 'pointer' }}
          >×</button>
        </div>
        {props.children}
        {props.onSave && (
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
            <button onClick={props.onClose} style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', color: '#374151', borderRadius: 8, padding: '8px 18px', fontSize: 13, cursor: 'pointer' }}>ביטול</button>
            <button
              onClick={props.onSave}
              disabled={props.saving}
              style={{ background: props.saving ? '#93c5fd' : '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 20px', fontSize: 13, fontWeight: 700, cursor: props.saving ? 'not-allowed' : 'pointer' }}
            >{props.saveLabel ?? 'שמירה'}</button>
          </div>
        )}
      </div>
    </div>
  );
}
