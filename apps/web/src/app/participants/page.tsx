'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BASE_URL, apiFetch } from '@lib/api';

// ─── CSV parsing ──────────────────────────────────────────────────────────────

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const cols: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if ((ch === ',' || ch === '\t' || ch === ';') && !inQ) {
        cols.push(cur); cur = '';
      } else {
        cur += ch;
      }
    }
    cols.push(cur);
    rows.push(cols);
  }
  return rows;
}

// ─── Import modal types ───────────────────────────────────────────────────────

type ImportStep = 'upload' | 'map' | 'preview' | 'result';

interface ColumnMapping { firstName?: number | null; lastName?: number | null; fullName?: number | null; phone?: number | null; email?: number | null; city?: number | null; gender?: number | null; notes?: number | null; }

interface PreviewRow { rowIndex: number; firstName: string; lastName: string; phone: string; email: string; status: 'create' | 'update' | 'skip'; skipReason?: string; extraData: Record<string, string>; }

interface ImportResult { created: number; updated: number; skipped: number; errors: string[]; participantIds: string[]; }

const MAPPING_LABELS: Record<keyof ColumnMapping, string> = {
  firstName: 'שם פרטי', lastName: 'שם משפחה', fullName: 'שם מלא',
  phone: 'טלפון', email: 'מייל', city: 'עיר', gender: 'מגדר', notes: 'הערות',
};

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
  // Read-only: fetched from backend (GET /api/settings), never written here
  const [isMockEnabled, setIsMockEnabled] = useState(false);

  // Create modal
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Partial<CreateForm>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);

  // ── Import state ────────────────────────────────────────────────────────────
  const [importOpen, setImportOpen] = useState(false);
  const [importStep, setImportStep] = useState<ImportStep>('upload');
  const [importTitle, setImportTitle] = useState('');
  const [csvText, setCsvText] = useState('');
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [importMapping, setImportMapping] = useState<ColumnMapping>({});
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [importRunning, setImportRunning] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const csvFileRef = useRef<HTMLInputElement>(null);

  // Mock actions
  const [mockBusy, setMockBusy] = useState<'one' | 'ten' | null>(null);
  const [mockMessage, setMockMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [mockBulkExpanded, setMockBulkExpanded] = useState(false);

  // Delete participant
  const [deleteTarget, setDeleteTarget] = useState<Participant | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // ── Import handlers ──────────────────────────────────────────────────────────

  function openImport() {
    setImportOpen(true);
    setImportStep('upload');
    setImportTitle('');
    setCsvText('');
    setCsvRows([]);
    setCsvHeaders([]);
    setImportMapping({});
    setPreviewRows([]);
    setImportResult(null);
    setImportError(null);
  }

  function closeImport() {
    setImportOpen(false);
  }

  function handleCsvFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string ?? '';
      setCsvText(text);
    };
    reader.readAsText(file, 'utf-8');
  }

  async function handleDetect() {
    setImportError(null);
    const allRows = parseCsv(csvText);
    if (allRows.length < 2) { setImportError('הקובץ חייב להכיל לפחות שורת כותרות ושורת נתונים אחת'); return; }
    const [headerRow, ...dataRows] = allRows;
    setCsvHeaders(headerRow);
    setCsvRows(dataRows);
    try {
      const result = await apiFetch(`${BASE_URL}/import/participants/detect`, {
        method: 'POST',
        body: JSON.stringify({ headers: headerRow, sampleRows: dataRows.slice(0, 5) }),
      }) as { detected: ColumnMapping };
      setImportMapping(result.detected);
      setImportStep('map');
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'שגיאה בזיהוי עמודות');
    }
  }

  async function handlePreview() {
    setImportError(null);
    setPreviewLoading(true);
    try {
      const rows = await apiFetch(`${BASE_URL}/import/participants/preview`, {
        method: 'POST',
        body: JSON.stringify({ headers: csvHeaders, rows: csvRows, mapping: importMapping }),
      }) as PreviewRow[];
      setPreviewRows(rows);
      setImportStep('preview');
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'שגיאה בתצוגה מקדימה');
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleRunImport() {
    if (!importTitle.trim()) { setImportError('יש להזין שם לייבוא'); return; }
    setImportError(null);
    setImportRunning(true);
    try {
      const result = await apiFetch(`${BASE_URL}/import/participants/run`, {
        method: 'POST',
        body: JSON.stringify({ title: importTitle.trim(), headers: csvHeaders, rows: csvRows, mapping: importMapping }),
      }) as ImportResult;
      setImportResult(result);
      setImportStep('result');
      fetchParticipants(isMockEnabled);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'שגיאה בייבוא');
    } finally {
      setImportRunning(false);
    }
  }

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

  const fetchParticipants = (includeMock: boolean) => {
    setLoading(true);
    apiFetch(`${BASE_URL}/participants?includeMock=${includeMock}`)
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
        fetchParticipants(mockOn);
      })
      .catch(() => {
        // Fall back to disabled if fetch fails
        setIsMockEnabled(false);
        fetchParticipants(false);
      });
  }, []);

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
      fetchParticipants(isMockEnabled);
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
      fetchParticipants(true);
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

          <button
            onClick={openImport}
            style={{ padding: '10px 18px', background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
          >
            📥 ייבוא CSV
          </button>

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

      {/* ── Search ── */}
      <div style={{ marginBottom: 20 }}>
        <input
          style={{ width: '100%', maxWidth: 360, padding: '9px 14px', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 14, background: '#fff', color: '#0f172a' }}
          placeholder="חיפוש לפי שם או טלפון..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* ── Participants table ── */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', marginBottom: 24 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
              {['שם מלא', 'טלפון', 'מגדר', 'תאריך הצטרפות', 'סטטוס', ''].map((h, i) => (
                <th key={h} style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: '#374151', fontSize: 13 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} style={{ padding: 28, textAlign: 'center', color: '#94a3b8' }}>טוען...</td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: 28, textAlign: 'center', color: '#94a3b8' }}>
                  {search ? 'לא נמצאו תוצאות.' : 'אין משתתפות עדיין.'}
                </td>
              </tr>
            )}
            {filtered.map((p) => (
              <tr
                key={p.id}
                onClick={() => router.push(`/participants/${p.id}`)}
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
                <td style={{ padding: '12px 16px', color: '#374151' }}>{p.gender?.name ?? '—'}</td>
                <td style={{ padding: '12px 16px', color: '#374151' }}>
                  {new Date(p.joinedAt).toLocaleDateString('he-IL')}
                </td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{ background: p.isActive ? '#dcfce7' : '#f1f5f9', color: p.isActive ? '#16a34a' : '#64748b', padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 500 }}>
                    {p.isActive ? 'פעילה' : 'לא פעילה'}
                  </span>
                </td>
                <td style={{ padding: '8px 16px' }} onClick={(e) => e.stopPropagation()}>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
                    <Link href={`/participants/${p.id}`} style={{ color: '#2563eb', fontSize: 13, textDecoration: 'none' }}>פרופיל →</Link>
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
            ))}
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

      {/* ── CSV Import modal ── */}
      {importOpen && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) closeImport(); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}
        >
          <div style={{ background: '#fff', borderRadius: 14, padding: 28, width: '100%', maxWidth: 640, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', maxHeight: '90vh', overflowY: 'auto' }}>

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: 0 }}>ייבוא משתתפות מ-CSV</h2>
              <button onClick={closeImport} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#94a3b8', lineHeight: 1 }}>×</button>
            </div>

            {/* Step indicator */}
            <div style={{ display: 'flex', gap: 0, marginBottom: 24, borderBottom: '2px solid #f1f5f9', paddingBottom: 16 }}>
              {(['upload', 'map', 'preview', 'result'] as ImportStep[]).map((step, i) => {
                const labels: Record<ImportStep, string> = { upload: 'העלאה', map: 'מיפוי', preview: 'תצוגה מקדימה', result: 'תוצאות' };
                const currentIdx = ['upload', 'map', 'preview', 'result'].indexOf(importStep);
                const isDone = i < currentIdx;
                const isActive = step === importStep;
                return (
                  <div key={step} style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                    {i > 0 && <div style={{ width: 28, height: 2, background: isDone ? '#22c55e' : '#e2e8f0', margin: '0 2px' }} />}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{
                        width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700,
                        background: isDone ? '#22c55e' : isActive ? '#2563eb' : '#e2e8f0',
                        color: isDone || isActive ? '#fff' : '#94a3b8',
                      }}>
                        {isDone ? '✓' : i + 1}
                      </div>
                      <span style={{ fontSize: 12, color: isActive ? '#2563eb' : '#94a3b8', fontWeight: isActive ? 700 : 400 }}>{labels[step]}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Step: Upload */}
            {importStep === 'upload' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>שם הייבוא *</label>
                  <input
                    style={{ width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 14, boxSizing: 'border-box' }}
                    placeholder="לדוגמה: ייבוא נרשמות ינואר 2026"
                    value={importTitle}
                    onChange={(e) => setImportTitle(e.target.value)}
                  />
                </div>

                <div>
                  <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>העלאת קובץ CSV</label>
                  <input
                    ref={csvFileRef}
                    type="file"
                    accept=".csv,.tsv,.txt"
                    style={{ display: 'none' }}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleCsvFile(f); e.target.value = ''; }}
                  />
                  <button
                    onClick={() => csvFileRef.current?.click()}
                    style={{ padding: '10px 18px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14, cursor: 'pointer', color: '#374151', marginBottom: 12 }}
                  >
                    📁 בחר קובץ
                  </button>
                </div>

                <div>
                  <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
                    או הדבק תוכן CSV כאן
                  </label>
                  <textarea
                    style={{ width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 13, minHeight: 140, boxSizing: 'border-box', fontFamily: 'monospace', resize: 'vertical' }}
                    placeholder={'שם פרטי,שם משפחה,טלפון,מייל\nרחל,כהן,0501234567,rachel@example.com'}
                    value={csvText}
                    onChange={(e) => setCsvText(e.target.value)}
                    dir="ltr"
                  />
                </div>

                {importError && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 7, padding: '10px 14px', color: '#dc2626', fontSize: 13 }}>{importError}</div>}

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    onClick={handleDetect}
                    disabled={!csvText.trim() || !importTitle.trim()}
                    style={{ padding: '10px 24px', background: !csvText.trim() || !importTitle.trim() ? '#e2e8f0' : '#2563eb', color: !csvText.trim() || !importTitle.trim() ? '#94a3b8' : '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: !csvText.trim() || !importTitle.trim() ? 'not-allowed' : 'pointer' }}
                  >
                    המשך לזיהוי עמודות ←
                  </button>
                </div>
              </div>
            )}

            {/* Step: Map */}
            {importStep === 'map' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ fontSize: 13, color: '#64748b', background: '#f8fafc', borderRadius: 8, padding: '10px 14px' }}>
                  זוהו <strong>{csvHeaders.length}</strong> עמודות ו-<strong>{csvRows.length}</strong> שורות.
                  בדקי את המיפוי הנ&quot;ל ותקני לפי הצורך.
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {(Object.keys(MAPPING_LABELS) as (keyof ColumnMapping)[]).map((field) => {
                    const colIdx = importMapping[field];
                    const samples = colIdx != null && colIdx >= 0
                      ? [...new Set(csvRows.map((r) => r[colIdx]?.trim()).filter(Boolean))].slice(0, 10)
                      : [];
                    const shown = samples.slice(0, 2);
                    const overflow = samples.length - shown.length;
                    return (
                      <div key={field}>
                        <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>
                          {MAPPING_LABELS[field]}
                          {field === 'phone' && <span style={{ color: '#dc2626' }}> *</span>}
                        </label>
                        <select
                          style={{ width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 13, background: '#fff' }}
                          value={importMapping[field] ?? -1}
                          onChange={(e) => setImportMapping((m) => ({ ...m, [field]: Number(e.target.value) >= 0 ? Number(e.target.value) : null }))}
                        >
                          <option value={-1}>— לא ממופה —</option>
                          {csvHeaders.map((h, i) => (
                            <option key={i} value={i}>{h || `עמודה ${i + 1}`}</option>
                          ))}
                        </select>
                        {shown.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
                            {shown.map((v, i) => (
                              <span key={i} style={{ background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', borderRadius: 5, padding: '2px 7px', fontSize: 11, maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={v}>
                                {v}
                              </span>
                            ))}
                            {overflow > 0 && (
                              <span style={{ background: '#e2e8f0', color: '#64748b', borderRadius: 5, padding: '2px 7px', fontSize: 11, whiteSpace: 'nowrap' }}>
                                +{overflow} נוספים
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {importError && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 7, padding: '10px 14px', color: '#dc2626', fontSize: 13 }}>{importError}</div>}

                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <button onClick={() => setImportStep('upload')} style={{ padding: '9px 18px', background: '#f1f5f9', border: 'none', borderRadius: 7, fontSize: 13, cursor: 'pointer', color: '#374151' }}>← חזרה</button>
                  <button
                    onClick={handlePreview}
                    disabled={previewLoading}
                    style={{ padding: '10px 24px', background: previewLoading ? '#93c5fd' : '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: previewLoading ? 'not-allowed' : 'pointer' }}
                  >
                    {previewLoading ? 'בודק...' : 'תצוגה מקדימה ←'}
                  </button>
                </div>
              </div>
            )}

            {/* Step: Preview */}
            {importStep === 'preview' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {[
                    { label: 'יצירה', count: previewRows.filter((r) => r.status === 'create').length, bg: '#f0fdf4', color: '#15803d' },
                    { label: 'עדכון', count: previewRows.filter((r) => r.status === 'update').length, bg: '#eff6ff', color: '#1d4ed8' },
                    { label: 'דילוג', count: previewRows.filter((r) => r.status === 'skip').length, bg: '#fef9c3', color: '#854d0e' },
                  ].map((s) => (
                    <div key={s.label} style={{ background: s.bg, borderRadius: 8, padding: '10px 18px', textAlign: 'center', minWidth: 90 }}>
                      <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.count}</div>
                      <div style={{ fontSize: 12, color: s.color, fontWeight: 600 }}>{s.label}</div>
                    </div>
                  ))}
                  <div style={{ background: '#f8fafc', borderRadius: 8, padding: '10px 18px', textAlign: 'center', minWidth: 90 }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: '#374151' }}>{csvRows.length}</div>
                    <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>סה&quot;כ</div>
                  </div>
                </div>

                <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 8, maxHeight: 300, overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead style={{ position: 'sticky', top: 0 }}>
                      <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                        {['שורה', 'שם', 'טלפון', 'מייל', 'פעולה'].map((h) => (
                          <th key={h} style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 600, color: '#374151', fontSize: 12 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row) => {
                        const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
                          create: { bg: '#dcfce7', color: '#15803d', label: 'יצירה' },
                          update: { bg: '#dbeafe', color: '#1d4ed8', label: 'עדכון' },
                          skip:   { bg: '#fef9c3', color: '#854d0e', label: 'דילוג' },
                        };
                        const s = STATUS_STYLE[row.status];
                        return (
                          <tr key={row.rowIndex} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '8px 12px', color: '#94a3b8', fontSize: 12 }}>{row.rowIndex + 2}</td>
                            <td style={{ padding: '8px 12px', color: '#0f172a' }}>{[row.firstName, row.lastName].filter(Boolean).join(' ') || '—'}</td>
                            <td style={{ padding: '8px 12px', color: '#374151', direction: 'ltr', textAlign: 'right' }}>{row.phone || '—'}</td>
                            <td style={{ padding: '8px 12px', color: '#374151', direction: 'ltr', textAlign: 'right' }}>{row.email || '—'}</td>
                            <td style={{ padding: '8px 12px' }}>
                              <span style={{ background: s.bg, color: s.color, padding: '3px 9px', borderRadius: 20, fontSize: 11, fontWeight: 600 }}>
                                {s.label}
                                {row.skipReason ? ` — ${row.skipReason}` : ''}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {csvRows.length > 30 && (
                  <div style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center' }}>
                    מוצגות 30 שורות ראשונות. הייבוא יכלול את כל {csvRows.length} השורות.
                  </div>
                )}

                {importError && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 7, padding: '10px 14px', color: '#dc2626', fontSize: 13 }}>{importError}</div>}

                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <button onClick={() => setImportStep('map')} style={{ padding: '9px 18px', background: '#f1f5f9', border: 'none', borderRadius: 7, fontSize: 13, cursor: 'pointer', color: '#374151' }}>← חזרה</button>
                  <button
                    onClick={handleRunImport}
                    disabled={importRunning}
                    style={{ padding: '10px 24px', background: importRunning ? '#93c5fd' : '#16a34a', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: importRunning ? 'not-allowed' : 'pointer' }}
                  >
                    {importRunning ? 'מייבא...' : `ייבא ${csvRows.length} שורות ✓`}
                  </button>
                </div>
              </div>
            )}

            {/* Step: Result */}
            {importStep === 'result' && importResult && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div style={{ textAlign: 'center', padding: '12px 0' }}>
                  <div style={{ fontSize: 40, marginBottom: 10 }}>✅</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>הייבוא הושלם</div>
                  <div style={{ fontSize: 13, color: '#64748b' }}>"{importTitle}"</div>
                </div>

                <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
                  {[
                    { label: 'נוצרו', count: importResult.created, bg: '#f0fdf4', color: '#15803d' },
                    { label: 'עודכנו', count: importResult.updated, bg: '#eff6ff', color: '#1d4ed8' },
                    { label: 'דולגו', count: importResult.skipped, bg: '#fef9c3', color: '#854d0e' },
                  ].map((s) => (
                    <div key={s.label} style={{ background: s.bg, borderRadius: 10, padding: '14px 24px', textAlign: 'center', minWidth: 100 }}>
                      <div style={{ fontSize: 28, fontWeight: 700, color: s.color }}>{s.count}</div>
                      <div style={{ fontSize: 13, color: s.color, fontWeight: 600 }}>{s.label}</div>
                    </div>
                  ))}
                </div>

                {importResult.errors.length > 0 && (
                  <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '12px 16px' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#dc2626', marginBottom: 8 }}>שגיאות ({importResult.errors.length})</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 120, overflowY: 'auto' }}>
                      {importResult.errors.map((err, i) => (
                        <div key={i} style={{ fontSize: 12, color: '#991b1b' }}>{err}</div>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <button
                    onClick={closeImport}
                    style={{ padding: '10px 28px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                  >
                    סגור
                  </button>
                </div>
              </div>
            )}
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
