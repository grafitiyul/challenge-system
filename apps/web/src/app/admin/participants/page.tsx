'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BASE_URL, apiFetch } from '@lib/api';
import {
  PARTICIPANT_LIFECYCLE_STATUSES,
  PARTICIPANT_SOURCES,
  PARTICIPANT_SOURCE_LABELS,
  PARTICIPANT_STATUS_COLORS,
  PARTICIPANT_STATUS_LABELS,
  isKnownLifecycleStatus,
} from '@lib/participant-lifecycle';

// Fixed local options — no API dependency
const GENDER_OPTIONS = ['נקבה', 'זכר'];

interface Gender {
  id: string;
  name: string;
}

interface Participant {
  id: string;
  firstName: string;
  lastName?: string | null;
  phoneNumber: string;
  email?: string;
  gender: Gender;
  joinedAt: string;
  isActive: boolean;
  isMock: boolean;
  status: string | null;
  source: string | null;
  paymentsCount: number;
}

function displayName(p: { firstName: string; lastName?: string | null }): string {
  return [p.firstName, p.lastName].filter(Boolean).join(' ');
}

interface CreateForm {
  firstName: string;
  lastName: string;
  phoneNumber: string;
  genderName: string;
  email: string;
  birthDate: string;
  source: string;
}

const EMPTY_FORM: CreateForm = {
  firstName: '',
  lastName: '',
  phoneNumber: '',
  genderName: '',
  email: '',
  birthDate: '',
  source: '',
};

function MockBadge() {
  return (
    <span
      style={{
        background: '#fef3c7',
        color: '#92400e',
        fontSize: 11,
        fontWeight: 600,
        padding: '2px 7px',
        borderRadius: 10,
        border: '1px solid #fde68a',
        marginRight: 6,
        whiteSpace: 'nowrap',
      }}
    >
      פיקטיבי
    </span>
  );
}

function FieldError({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return <span style={{ fontSize: 12, color: '#dc2626', marginTop: 3, display: 'block' }}>{msg}</span>;
}

export default function ParticipantsPage() {
  const router = useRouter();
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  // Public registration Phase 1: server-side filters for lifecycle + source +
  // payment presence. Empty string = no filter.
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [sourceFilter, setSourceFilter] = useState<string>('');
  const [paymentsFilter, setPaymentsFilter] = useState<'' | 'true' | 'false'>('');
  // Read-only: fetched from backend (GET /api/settings), never written here
  const [isMockEnabled, setIsMockEnabled] = useState(false);

  // Create modal
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Partial<CreateForm>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);

  // Mock actions
  const [mockBusy, setMockBusy] = useState<'one' | 'ten' | null>(null);
  const [mockMessage, setMockMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [mockBulkExpanded, setMockBulkExpanded] = useState(false);

  // Delete participant
  const [deleteTarget, setDeleteTarget] = useState<Participant | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDeleteParticipant() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await apiFetch(`${BASE_URL}/participants/${deleteTarget.id}`, { method: 'DELETE' });
      setParticipants((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(
        typeof err === 'object' && err !== null && 'message' in err
          ? String((err as { message: unknown }).message)
          : 'שגיאה במחיקה',
      );
    } finally {
      setDeleting(false);
    }
  }

  const fetchParticipants = (includeMock: boolean, status: string, source: string, hasPayments: string) => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('includeMock', String(includeMock));
    if (status) params.set('status', status);
    if (source) params.set('source', source);
    if (hasPayments) params.set('hasPayments', hasPayments);
    apiFetch(`${BASE_URL}/participants?${params.toString()}`)
      .then((data: unknown) => setParticipants(Array.isArray(data) ? (data as Participant[]) : []))
      .catch(() => setParticipants([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    // Fetch the setting from backend — source of truth is the database
    apiFetch(`${BASE_URL}/settings`)
      .then((s: unknown) => {
        const settings = s as Record<string, string>;
        const mockOn = settings['mockParticipantsEnabled'] === 'true';
        setIsMockEnabled(mockOn);
        fetchParticipants(mockOn, statusFilter, sourceFilter, paymentsFilter);
      })
      .catch(() => {
        // Fall back to disabled if fetch fails
        setIsMockEnabled(false);
        fetchParticipants(false, statusFilter, sourceFilter, paymentsFilter);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refetch whenever a server-side filter changes.
  useEffect(() => {
    fetchParticipants(isMockEnabled, statusFilter, sourceFilter, paymentsFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, sourceFilter, paymentsFilter]);

  useEffect(() => {
    if (modalOpen) {
      setTimeout(() => firstInputRef.current?.focus(), 50);
    }
  }, [modalOpen]);

  const openModal = () => {
    setForm(EMPTY_FORM);
    setFormErrors({});
    setSubmitError(null);
    setModalOpen(true);
  };

  const closeModal = () => setModalOpen(false);

  const validateForm = (): boolean => {
    const errors: Partial<CreateForm> = {};
    if (!form.firstName.trim()) errors.firstName = 'שם פרטי הוא שדה חובה';
    if (!form.phoneNumber.trim()) {
      errors.phoneNumber = 'מספר טלפון הוא שדה חובה';
    } else if (!/^0\d{9}$/.test(form.phoneNumber.replace(/[-\s]/g, ''))) {
      errors.phoneNumber = 'מספר טלפון לא תקין (10 ספרות, מתחיל ב-0)';
    }
    if (!form.genderName) errors.genderName = 'יש לבחור מגדר';
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      errors.email = 'כתובת מייל לא תקינה';
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const body: Record<string, string> = {
        firstName: form.firstName.trim(),
        phoneNumber: form.phoneNumber.replace(/[-\s]/g, ''),
        genderName: form.genderName,
      };
      if (form.lastName.trim()) body.lastName = form.lastName.trim();
      if (form.email.trim()) body.email = form.email.trim();
      if (form.birthDate) body.birthDate = form.birthDate;
      if (form.source.trim()) body.source = form.source.trim();

      console.log('[API] POST', `${BASE_URL}/participants`);
      await apiFetch(`${BASE_URL}/participants`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      closeModal();
      fetchParticipants(isMockEnabled, statusFilter, sourceFilter, paymentsFilter);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'שגיאה לא ידועה');
    } finally {
      setSubmitting(false);
    }
  };

  const handleMock = async (count: number) => {
    const key: 'one' | 'ten' = count === 1 ? 'one' : 'ten';
    setMockBusy(key);
    setMockMessage(null);
    try {
      console.log('[API] POST', `${BASE_URL}/participants/mock?count=${count}`);
      const created = await apiFetch(`${BASE_URL}/participants/mock?count=${count}`, { method: 'POST' }) as unknown[];
      fetchParticipants(true, statusFilter, sourceFilter, paymentsFilter);
      setMockMessage({ type: 'success', text: `נוצרו ${Array.isArray(created) ? created.length : count} משתתפות פיקטיביות` });
    } catch (err) {
      setMockMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'שגיאה לא ידועה',
      });
    } finally {
      setMockBusy(null);
    }
  };

  const filtered = participants.filter(
    (p) =>
      displayName(p).toLowerCase().includes(search.toLowerCase()) ||
      p.phoneNumber.includes(search),
  );

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '9px 12px',
    border: '1px solid #e2e8f0',
    borderRadius: 7,
    fontSize: 14,
    background: '#fff',
    color: '#0f172a',
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 600,
    color: '#374151',
    marginBottom: 5,
    display: 'block',
  };

  return (
    <div className="page-wrapper" style={{ maxWidth: 1200, margin: '0 auto' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', margin: 0 }}>משתתפות</h1>
          {!loading && (
            <p style={{ color: '#64748b', fontSize: 14, marginTop: 4, marginBottom: 0 }}>
              {participants.length} משתתפות{isMockEnabled ? ' (כולל פיקטיביות)' : ''}
            </p>
          )}
        </div>

        {/* Primary actions */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Mock add button — only when feature is enabled in Settings */}
          {isMockEnabled && (
            <button
              onClick={() => handleMock(1)}
              disabled={mockBusy !== null}
              style={{
                padding: '10px 18px',
                background: mockBusy === 'one' ? '#9ca3af' : '#f8fafc',
                color: mockBusy === 'one' ? '#fff' : '#374151',
                border: '1px solid #e2e8f0',
                borderRadius: 8, fontSize: 14, fontWeight: 500,
                cursor: mockBusy !== null ? 'not-allowed' : 'pointer',
              }}
            >
              {mockBusy === 'one' ? 'יוצר...' : '+ הוסף פיקטיבית'}
            </button>
          )}

          <Link
            href="/admin/participants/import"
            style={{ padding: '10px 18px', background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', textDecoration: 'none', display: 'inline-block' }}
          >
            📥 ייבוא CSV
          </Link>

          <button
            onClick={openModal}
            style={{ padding: '10px 22px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
          >
            + הוסף משתתפת
          </button>
        </div>
      </div>

      {/* Mock feedback (inline, non-blocking) — only when feature enabled */}
      {isMockEnabled && mockMessage && (
        <div
          style={{
            background: mockMessage.type === 'success' ? '#f0fdf4' : '#fef2f2',
            border: `1px solid ${mockMessage.type === 'success' ? '#bbf7d0' : '#fecaca'}`,
            borderRadius: 8,
            padding: '10px 16px',
            marginBottom: 16,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span style={{ fontSize: 13, color: mockMessage.type === 'success' ? '#15803d' : '#dc2626' }}>
            {mockMessage.type === 'success' ? '✓' : '⚠️'} {mockMessage.text}
            {mockMessage.type === 'error' && (
              <span style={{ color: '#991b1b', fontSize: 12, display: 'block', marginTop: 2 }}>
                הרשימה לא הושפעה. ייתכן שהשרת לא הופעל מחדש.
              </span>
            )}
          </span>
          <button
            onClick={() => setMockMessage(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 18, padding: '0 4px' }}
          >
            ×
          </button>
        </div>
      )}

      {/* ── Search + filters ── */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          style={{ flex: '1 1 220px', maxWidth: 360, padding: '9px 14px', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 14, background: '#fff', color: '#0f172a' }}
          placeholder="חיפוש לפי שם או טלפון..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 13, background: '#fff', color: '#0f172a' }}
        >
          <option value="">כל הסטטוסים</option>
          {PARTICIPANT_LIFECYCLE_STATUSES.map((s) => (
            <option key={s} value={s}>{PARTICIPANT_STATUS_LABELS[s]}</option>
          ))}
        </select>
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          style={{ padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 13, background: '#fff', color: '#0f172a' }}
        >
          <option value="">כל המקורות</option>
          {PARTICIPANT_SOURCES.map((s) => (
            <option key={s} value={s}>{PARTICIPANT_SOURCE_LABELS[s]}</option>
          ))}
        </select>
        <select
          value={paymentsFilter}
          onChange={(e) => setPaymentsFilter(e.target.value as '' | 'true' | 'false')}
          style={{ padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 13, background: '#fff', color: '#0f172a' }}
        >
          <option value="">כל התשלומים</option>
          <option value="true">עם תשלומים</option>
          <option value="false">ללא תשלומים</option>
        </select>
      </div>

      {/* ── Participants table ── */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', marginBottom: 24 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
              {['שם מלא', 'טלפון', 'סטטוס חיים', 'מקור', 'תשלומים', 'הצטרפות', ''].map((h) => (
                <th key={h} style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: '#374151', fontSize: 13 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} style={{ padding: 28, textAlign: 'center', color: '#94a3b8' }}>טוען...</td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: 28, textAlign: 'center', color: '#94a3b8' }}>
                  {search ? 'לא נמצאו תוצאות.' : 'אין משתתפות עדיין.'}
                </td>
              </tr>
            )}
            {filtered.map((p) => {
              const knownStatus = isKnownLifecycleStatus(p.status);
              const statusColors = knownStatus
                ? PARTICIPANT_STATUS_COLORS[p.status as keyof typeof PARTICIPANT_STATUS_COLORS]
                : { bg: '#f1f5f9', fg: '#64748b' };
              const statusLabel = knownStatus
                ? PARTICIPANT_STATUS_LABELS[p.status as keyof typeof PARTICIPANT_STATUS_LABELS]
                : (p.status ?? '—');
              const sourceLabel = p.source && (p.source in PARTICIPANT_SOURCE_LABELS)
                ? PARTICIPANT_SOURCE_LABELS[p.source as keyof typeof PARTICIPANT_SOURCE_LABELS]
                : (p.source ?? '—');
              return (
              <tr
                key={p.id}
                onClick={() => router.push(`/admin/participants/${p.id}`)}
                style={{
                  borderBottom: '1px solid #f1f5f9',
                  background: p.isMock ? '#fffdf5' : 'transparent',
                  cursor: 'pointer',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = p.isMock ? '#fff8e1' : '#f8fafc'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = p.isMock ? '#fffdf5' : 'transparent'; }}
              >
                <td style={{ padding: '12px 16px', fontWeight: 500, color: '#0f172a' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {displayName(p)}
                    {p.isMock && <MockBadge />}
                  </div>
                </td>
                <td style={{ padding: '12px 16px', color: '#374151' }} dir="ltr">{p.phoneNumber}</td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{ background: statusColors.bg, color: statusColors.fg, padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>
                    {statusLabel}
                  </span>
                </td>
                <td style={{ padding: '12px 16px', color: '#475569', fontSize: 13 }}>{sourceLabel}</td>
                <td style={{ padding: '12px 16px', color: p.paymentsCount > 0 ? '#15803d' : '#94a3b8', fontWeight: p.paymentsCount > 0 ? 600 : 400, fontSize: 13 }}>
                  {p.paymentsCount > 0 ? `💳 ${p.paymentsCount}` : '—'}
                </td>
                <td style={{ padding: '12px 16px', color: '#374151', fontSize: 13 }}>
                  {new Date(p.joinedAt).toLocaleDateString('he-IL')}
                </td>
                <td style={{ padding: '8px 16px' }} onClick={(e) => e.stopPropagation()}>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
                    <Link href={`/admin/participants/${p.id}`} style={{ color: '#2563eb', fontSize: 13, textDecoration: 'none' }}>פרופיל →</Link>
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget(p); setDeleteError(null); }}
                      title="מחיקת משתתפת"
                      style={{ background: 'none', border: '1px solid #fecaca', borderRadius: 6, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 14, color: '#ef4444', flexShrink: 0 }}
                    >
                      🗑
                    </button>
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Secondary: bulk mock (collapsible) — only when feature is enabled in Settings ── */}
      {isMockEnabled && <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
        <button
          onClick={() => { setMockBulkExpanded((v) => !v); }}
          style={{ width: '100%', padding: '11px 20px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}
        >
          <span style={{ fontSize: 14 }}>🧪</span>
          <span style={{ fontSize: 13, color: '#64748b', flex: 1, textAlign: 'right' }}>כלי פיתוח — הוספת 10 פיקטיביות בבת אחת</span>
          <span style={{ fontSize: 11, color: '#94a3b8' }}>{mockBulkExpanded ? '▲' : '▼'}</span>
        </button>

        {mockBulkExpanded && (
          <div style={{ padding: '0 20px 16px', borderTop: '1px solid #f1f5f9' }}>
            <p style={{ fontSize: 13, color: '#94a3b8', margin: '12px 0' }}>
              יוצר 10 משתתפות פיקטיביות בבת אחת לצורך בדיקות מהירות.
            </p>
            <button
              onClick={() => handleMock(10)}
              disabled={mockBusy !== null}
              style={{
                padding: '8px 16px',
                background: mockBusy === 'ten' ? '#9ca3af' : '#fffbeb',
                color: mockBusy === 'ten' ? '#fff' : '#92400e',
                border: '1px solid #fde68a',
                borderRadius: 7,
                fontSize: 13,
                fontWeight: 600,
                cursor: mockBusy !== null ? 'not-allowed' : 'pointer',
              }}
            >
              {mockBusy === 'ten' ? 'יוצר...' : '+ הוסף 10 פיקטיביות'}
            </button>
          </div>
        )}
      </div>}

      {/* ── Delete participant modal ── */}
      {deleteTarget && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget && !deleting) setDeleteTarget(null); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}
        >
          <div style={{ background: '#fff', borderRadius: 14, padding: 28, width: '100%', maxWidth: 400, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', margin: '0 0 10px' }}>מחיקת משתתפת</h2>
            <p style={{ fontSize: 14, color: '#374151', margin: '0 0 6px' }}>
              האם למחוק את <strong>{displayName(deleteTarget)}</strong>?
            </p>
            <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 20px', lineHeight: 1.5 }}>
              המשתתפת תסומן כלא פעילה. כל הנתונים, קבוצות וטפסים נשמרים.
            </p>
            {deleteError && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 7, padding: '8px 12px', color: '#dc2626', fontSize: 13, marginBottom: 16 }}>
                {deleteError}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                style={{ padding: '9px 20px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, color: '#374151', cursor: 'pointer' }}
              >
                ביטול
              </button>
              <button
                onClick={handleDeleteParticipant}
                disabled={deleting}
                style={{ padding: '9px 22px', background: deleting ? '#fca5a5' : '#ef4444', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: deleting ? 'not-allowed' : 'pointer' }}
              >
                {deleting ? 'מוחק...' : 'מחק משתתפת'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Create participant modal ── */}
      {modalOpen && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}
        >
          <div
            style={{ background: '#fff', borderRadius: 14, padding: 28, width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', maxHeight: '90vh', overflowY: 'auto' }}
          >
            {/* Modal header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: 0 }}>הוספת משתתפת</h2>
              <button
                onClick={closeModal}
                style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#94a3b8', padding: '0 4px', lineHeight: 1 }}
                aria-label="סגור"
              >
                ×
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

              {/* Name fields */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={labelStyle}>שם פרטי *</label>
                  <input
                    ref={firstInputRef}
                    style={{ ...inputStyle, borderColor: formErrors.firstName ? '#fca5a5' : '#e2e8f0' }}
                    placeholder="רחל"
                    value={form.firstName}
                    onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                  />
                  <FieldError msg={formErrors.firstName ?? null} />
                </div>
                <div>
                  <label style={labelStyle}>שם משפחה</label>
                  <input
                    style={inputStyle}
                    placeholder="כהן"
                    value={form.lastName}
                    onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                  />
                </div>
              </div>

              {/* Phone */}
              <div>
                <label style={labelStyle}>מספר טלפון *</label>
                <input
                  style={{ ...inputStyle, borderColor: formErrors.phoneNumber ? '#fca5a5' : '#e2e8f0' }}
                  placeholder="0501234567"
                  value={form.phoneNumber}
                  dir="ltr"
                  inputMode="tel"
                  onChange={(e) => setForm((f) => ({ ...f, phoneNumber: e.target.value }))}
                />
                <FieldError msg={formErrors.phoneNumber ?? null} />
              </div>

              {/* Gender — fixed local options, no API */}
              <div>
                <label style={labelStyle}>מגדר *</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {GENDER_OPTIONS.map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, genderName: g }))}
                      style={{
                        flex: 1,
                        padding: '9px 12px',
                        border: `2px solid ${form.genderName === g ? '#2563eb' : '#e2e8f0'}`,
                        borderRadius: 7,
                        background: form.genderName === g ? '#eff6ff' : '#fff',
                        color: form.genderName === g ? '#2563eb' : '#374151',
                        fontWeight: form.genderName === g ? 600 : 400,
                        fontSize: 14,
                        cursor: 'pointer',
                      }}
                    >
                      {g}
                    </button>
                  ))}
                </div>
                <FieldError msg={formErrors.genderName ?? null} />
              </div>

              {/* Email */}
              <div>
                <label style={labelStyle}>
                  מייל <span style={{ fontWeight: 400, color: '#94a3b8', fontSize: 12 }}>(אופציונלי)</span>
                </label>
                <input
                  style={{ ...inputStyle, borderColor: formErrors.email ? '#fca5a5' : '#e2e8f0' }}
                  placeholder="rachel@example.com"
                  value={form.email}
                  dir="ltr"
                  inputMode="email"
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                />
                <FieldError msg={formErrors.email ?? null} />
              </div>

              {/* Birth date */}
              <div>
                <label style={labelStyle}>
                  תאריך לידה <span style={{ fontWeight: 400, color: '#94a3b8', fontSize: 12 }}>(אופציונלי)</span>
                </label>
                <input
                  type="date"
                  style={{ ...inputStyle, borderColor: '#e2e8f0' }}
                  value={form.birthDate}
                  dir="ltr"
                  onChange={(e) => setForm((f) => ({ ...f, birthDate: e.target.value }))}
                />
              </div>

              {/* Source */}
              <div>
                <label style={labelStyle}>
                  מקור הגעה <span style={{ fontWeight: 400, color: '#94a3b8', fontSize: 12 }}>(אופציונלי)</span>
                </label>
                <input
                  style={{ ...inputStyle, borderColor: '#e2e8f0' }}
                  placeholder="לדוגמה: פייסבוק, חברה, אינסטגרם"
                  value={form.source}
                  onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
                />
              </div>
            </div>

            {submitError && (
              <div style={{ marginTop: 16, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 7, padding: '10px 14px' }}>
                <p style={{ color: '#dc2626', fontSize: 13, margin: 0 }}>⚠️ {submitError}</p>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 24, justifyContent: 'flex-end' }}>
              <button
                onClick={closeModal}
                style={{ padding: '9px 18px', background: '#f1f5f9', border: 'none', borderRadius: 7, fontSize: 14, color: '#374151', cursor: 'pointer' }}
              >
                ביטול
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                style={{ padding: '9px 22px', background: submitting ? '#93c5fd' : '#2563eb', color: '#fff', border: 'none', borderRadius: 7, fontSize: 14, fontWeight: 600, cursor: submitting ? 'not-allowed' : 'pointer' }}
              >
                {submitting ? 'שומר...' : 'הוסף משתתפת'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
