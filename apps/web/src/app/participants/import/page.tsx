'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { BASE_URL, apiFetch } from '@lib/api';

// ─── CSV parser ────────────────────────────────────────────────────────────────

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
      } else { cur += ch; }
    }
    cols.push(cur);
    rows.push(cols);
  }
  return rows;
}

// ─── Types ─────────────────────────────────────────────────────────────────────

type Step = 'upload' | 'map' | 'preview' | 'result';

interface ColumnMapping {
  firstName?: number | null;
  lastName?: number | null;
  fullName?: number | null;
  phone?: number | null;
  email?: number | null;
  city?: number | null;
  notes?: number | null;
}

interface PreviewRow {
  rowIndex: number;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  status: 'create' | 'update' | 'skip';
  skipReason?: string;
  extraData: Record<string, string>;
}

interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
  participantIds: string[];
}

// ─── Step indicator ────────────────────────────────────────────────────────────

const STEPS: { key: Step; label: string }[] = [
  { key: 'upload',  label: 'העלאת קובץ' },
  { key: 'map',     label: 'מיפוי שדות' },
  { key: 'preview', label: 'תצוגה מקדימה' },
  { key: 'result',  label: 'סיום' },
];

function StepIndicator({ current }: { current: Step }) {
  const idx = STEPS.findIndex(s => s.key === current);
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 40 }}>
      {STEPS.map((s, i) => {
        const done   = i < idx;
        const active = i === idx;
        return (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? 1 : 'none' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 700,
                background: done || active ? '#2563eb' : '#f1f5f9',
                color: done || active ? '#fff' : '#94a3b8',
                boxShadow: active ? '0 0 0 4px #dbeafe' : 'none',
              }}>
                {done ? '✓' : i + 1}
              </div>
              <span style={{
                fontSize: 12, fontWeight: active ? 700 : 400,
                whiteSpace: 'nowrap',
                color: active ? '#1d4ed8' : done ? '#64748b' : '#94a3b8',
              }}>
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div style={{
                flex: 1, height: 2,
                background: done ? '#2563eb' : '#e2e8f0',
                margin: '0 8px', marginBottom: 28, borderRadius: 1,
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Mapping row ───────────────────────────────────────────────────────────────

function MappingRow({
  label, required, field, mapping, csvHeaders, csvRows, onChange, helperText,
}: {
  label: string;
  required?: boolean;
  field: keyof ColumnMapping;
  mapping: ColumnMapping;
  csvHeaders: string[];
  csvRows: string[][];
  onChange: (field: keyof ColumnMapping, value: number | null) => void;
  helperText?: string;
}) {
  const colIdx = mapping[field];
  const mapped = colIdx != null && colIdx >= 0;
  const samples = mapped && colIdx != null
    ? [...new Set(csvRows.map(r => r[colIdx]?.trim()).filter(Boolean))].slice(0, 4)
    : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>
          {label}
          {required && <span style={{ color: '#dc2626', marginRight: 3 }}>*</span>}
        </span>
        {mapped && (
          <span style={{
            fontSize: 11, fontWeight: 700, color: '#16a34a',
            background: '#dcfce7', borderRadius: 10,
            padding: '1px 7px', lineHeight: '18px',
          }}>
            ✓ ממופה
          </span>
        )}
      </div>
      <select
        style={{
          width: '100%', padding: '9px 12px', fontSize: 14, borderRadius: 8,
          border: `1.5px solid ${mapped ? '#86efac' : '#e2e8f0'}`,
          background: '#fff',
          color: '#0f172a',
          outline: 'none', cursor: 'pointer',
        }}
        value={colIdx ?? -1}
        onChange={e => onChange(field, Number(e.target.value) >= 0 ? Number(e.target.value) : null)}
      >
        <option value={-1}>— בחרי עמודה —</option>
        {csvHeaders.map((h, i) => (
          <option key={i} value={i}>{h || `עמודה ${i + 1}`}</option>
        ))}
      </select>
      {mapped && samples.length > 0 && (
        <div style={{ fontSize: 12, color: '#64748b', paddingRight: 2 }}>
          לדוגמה: {samples.join(', ')}
        </div>
      )}
      {helperText && (
        <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5, paddingRight: 2 }}>
          {helperText}
        </div>
      )}
    </div>
  );
}

// ─── Helper ────────────────────────────────────────────────────────────────────

function errMsg(err: unknown, fallback: string): string {
  return typeof err === 'object' && err !== null && 'message' in err
    ? String((err as { message: unknown }).message)
    : fallback;
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function ImportPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step,       setStep]       = useState<Step>('upload');
  const [title,      setTitle]      = useState('');
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows,    setCsvRows]    = useState<string[][]>([]);
  const [mapping,    setMapping]    = useState<ColumnMapping>({});
  const [preview,    setPreview]    = useState<PreviewRow[]>([]);
  const [result,     setResult]     = useState<ImportResult | null>(null);
  const [error,      setError]      = useState<string | null>(null);
  const [dragOver,   setDragOver]   = useState(false);
  const [detecting,  setDetecting]  = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [running,    setRunning]    = useState(false);

  function updateMapping(field: keyof ColumnMapping, value: number | null) {
    setMapping(m => ({ ...m, [field]: value }));
  }

  // ── Upload & detect ──────────────────────────────────────────────────────────

  async function handleFile(file: File) {
    setError(null);
    setDetecting(true);
    if (!title.trim()) {
      setTitle(file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '));
    }
    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = (e.target?.result as string) ?? '';
      const allRows = parseCsv(text);
      if (allRows.length < 2) {
        setError('הקובץ חייב להכיל לפחות שורת כותרות ושורת נתונים אחת');
        setDetecting(false);
        return;
      }
      const [headers, ...rows] = allRows;
      setCsvHeaders(headers);
      setCsvRows(rows);
      try {
        const res = await apiFetch(`${BASE_URL}/import/participants/detect`, {
          method: 'POST',
          body: JSON.stringify({ headers, sampleRows: rows.slice(0, 5) }),
        }) as { detected: ColumnMapping };
        setMapping(res.detected);
        setStep('map');
      } catch (err) {
        setError(errMsg(err, 'שגיאה בזיהוי עמודות'));
      } finally {
        setDetecting(false);
      }
    };
    reader.readAsText(file, 'utf-8');
  }

  // ── Preview ──────────────────────────────────────────────────────────────────

  async function handlePreview() {
    if (mapping.phone == null) {
      setError('יש למפות מספר טלפון לפני המשך לתצוגה מקדימה.');
      return;
    }
    setError(null);
    setPreviewing(true);
    try {
      const rows = await apiFetch(`${BASE_URL}/import/participants/preview`, {
        method: 'POST',
        body: JSON.stringify({ headers: csvHeaders, rows: csvRows.slice(0, 30), mapping }),
      }) as PreviewRow[];
      setPreview(rows);
      setStep('preview');
    } catch (err) {
      setError(errMsg(err, 'שגיאה בטעינת תצוגה מקדימה'));
    } finally {
      setPreviewing(false);
    }
  }

  // ── Run import ───────────────────────────────────────────────────────────────

  async function handleRun() {
    if (!title.trim()) { setError('יש להזין שם לייבוא'); return; }
    setError(null);
    setRunning(true);
    try {
      const res = await apiFetch(`${BASE_URL}/import/participants/run`, {
        method: 'POST',
        body: JSON.stringify({ title: title.trim(), headers: csvHeaders, rows: csvRows, mapping }),
      }) as ImportResult;
      setResult(res);
      setStep('result');
    } catch (err) {
      setError(errMsg(err, 'שגיאה בייבוא'));
    } finally {
      setRunning(false);
    }
  }

  // ─── Derived ─────────────────────────────────────────────────────────────────

  const autoDetectedCount = Object.values(mapping).filter(v => v != null).length;
  const onlyPhoneMapped   = Object.values(mapping).filter(v => v != null).length === 1 && mapping.phone != null;

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div dir="rtl" style={{ minHeight: '100vh', background: '#f1f5f9' }}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '32px 20px 80px' }}>

        {/* ── Back link ── */}
        <Link
          href="/participants"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, color: '#64748b', textDecoration: 'none', marginBottom: 28 }}
        >
          ← חזרה למשתתפות
        </Link>

        {/* ── Page header ── */}
        <div style={{ marginBottom: 36 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', margin: '0 0 8px' }}>
            ייבוא משתתפות מ-CSV
          </h1>
          <p style={{ fontSize: 14, color: '#64748b', margin: 0, lineHeight: 1.6 }}>
            משתתפות חדשות ייווצרו, קיימות יעודכנו לפי מספר טלפון — ללא כפילויות.
          </p>
        </div>

        {/* ── Step indicator ── */}
        <StepIndicator current={step} />

        {/* ── Global error banner ── */}
        {error && (
          <div style={{
            background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8,
            padding: '11px 16px', color: '#b91c1c', fontSize: 13,
            marginBottom: 20, lineHeight: 1.5,
          }}>
            {error}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════════
            STEP 1 — UPLOAD
        ══════════════════════════════════════════════════════════════════════ */}
        {step === 'upload' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            <input
              ref={fileRef}
              type="file"
              accept=".csv,.tsv,.txt"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
            />

            {/* Drop zone */}
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragEnter={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={e => { e.preventDefault(); setDragOver(false); }}
              onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
              onClick={() => !detecting && fileRef.current?.click()}
              style={{
                border: `2px dashed ${dragOver ? '#3b82f6' : '#cbd5e1'}`,
                borderRadius: 14,
                padding: '56px 32px',
                textAlign: 'center',
                background: dragOver ? '#eff6ff' : '#ffffff',
                transition: 'border-color 0.15s, background 0.15s',
                cursor: detecting ? 'default' : 'pointer',
              }}
            >
              {detecting ? (
                <>
                  <div style={{
                    width: 40, height: 40, borderRadius: '50%',
                    border: '3px solid #e2e8f0', borderTopColor: '#2563eb',
                    margin: '0 auto 16px',
                    animation: 'spin 0.8s linear infinite',
                  }} />
                  <div style={{ fontSize: 15, fontWeight: 600, color: '#374151' }}>מנתח את הקובץ...</div>
                  <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 5 }}>מזהה עמודות אוטומטית</div>
                </>
              ) : dragOver ? (
                <div style={{ fontSize: 16, fontWeight: 700, color: '#2563eb' }}>שחרר כאן</div>
              ) : (
                <>
                  <div style={{
                    width: 48, height: 48, borderRadius: 12,
                    background: '#f1f5f9', margin: '0 auto 18px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: '#1e293b', marginBottom: 6 }}>
                    גררי קובץ CSV לכאן
                  </div>
                  <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 20 }}>
                    או לחצי לבחור קובץ
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); fileRef.current?.click(); }}
                    style={{
                      padding: '9px 28px', background: '#2563eb', color: '#fff',
                      border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    בחרי קובץ
                  </button>
                </>
              )}
            </div>

            {/* Spin keyframe — injected inline once */}
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

            {/* Import title */}
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '18px 20px' }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 3 }}>
                שם הייבוא
              </label>
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10 }}>
                יאוכלס אוטומטית משם הקובץ — ניתן לשנות
              </div>
              <input
                style={{
                  width: '100%', padding: '9px 12px',
                  border: '1px solid #e2e8f0', borderRadius: 7,
                  fontSize: 14, boxSizing: 'border-box',
                  background: '#f8fafc', color: '#0f172a', outline: 'none',
                }}
                placeholder="לדוגמה: ייבוא נרשמות ינואר 2026"
                value={title}
                onChange={e => setTitle(e.target.value)}
              />
            </div>

          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════════
            STEP 2 — MAPPING
        ══════════════════════════════════════════════════════════════════════ */}
        {step === 'map' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* File summary */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12,
              background: '#fff', border: '1px solid #e2e8f0',
              borderRadius: 9, padding: '11px 16px',
            }}>
              <div style={{
                width: 34, height: 34, borderRadius: 7,
                background: '#f1f5f9', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {title || 'קובץ CSV'}
                </div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 1 }}>
                  {csvHeaders.length} עמודות · {csvRows.length} שורות
                </div>
              </div>
              <button
                onClick={() => { setStep('upload'); setCsvHeaders([]); setCsvRows([]); setMapping({}); }}
                style={{
                  fontSize: 12, color: '#64748b', background: 'none',
                  border: '1px solid #e2e8f0', borderRadius: 6,
                  cursor: 'pointer', padding: '4px 10px', flexShrink: 0,
                }}
              >
                החלפי
              </button>
            </div>

            {/* Auto-detect notice */}
            {autoDetectedCount > 0 && (
              <div style={{
                background: '#f0fdf4', border: '1px solid #bbf7d0',
                borderRadius: 8, padding: '9px 14px',
                fontSize: 13, color: '#15803d',
              }}>
                זוהו אוטומטית {autoDetectedCount} שדות — בדקי ותקני לפי הצורך.
              </div>
            )}

            {/* ── Identity fields ── */}
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ borderBottom: '1px solid #f1f5f9', padding: '14px 20px' }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>שדות כרטיס משתתפת</div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 3 }}>
                  נשמרים ישירות על הכרטיס. טלפון משמש לזיהוי — לא נוצרות כפילויות.
                </div>
              </div>
              <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
                <MappingRow label="טלפון" required field="phone" mapping={mapping} csvHeaders={csvHeaders} csvRows={csvRows} onChange={updateMapping} />
                <MappingRow label="שם פרטי"  field="firstName" mapping={mapping} csvHeaders={csvHeaders} csvRows={csvRows} onChange={updateMapping} />
                <MappingRow label="שם משפחה" field="lastName"  mapping={mapping} csvHeaders={csvHeaders} csvRows={csvRows} onChange={updateMapping} />
                <MappingRow
                  label="שם מלא" field="fullName"
                  mapping={mapping} csvHeaders={csvHeaders} csvRows={csvRows}
                  onChange={updateMapping}
                  helperText="המילה הראשונה → שם פרטי, השאר → שם משפחה. בשימוש רק כאשר שם פרטי לא ממופה."
                />
                <MappingRow label="מייל" field="email" mapping={mapping} csvHeaders={csvHeaders} csvRows={csvRows} onChange={updateMapping} />
                <MappingRow label="עיר"  field="city"  mapping={mapping} csvHeaders={csvHeaders} csvRows={csvRows} onChange={updateMapping} />
              </div>
            </div>

            {/* ── Additional fields ── */}
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ borderBottom: '1px solid #f1f5f9', padding: '14px 20px' }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>שדות נוספים</div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 3 }}>
                  נשמרים בעותק הטופס בלבד — לא מופיעים בכרטיס הראשי.
                </div>
              </div>
              <div style={{ padding: '20px' }}>
                <MappingRow label="הערות" field="notes" mapping={mapping} csvHeaders={csvHeaders} csvRows={csvRows} onChange={updateMapping} />
              </div>
            </div>

            {/* ── What will happen (confidence summary) ── */}
            <div style={{
              background: '#f8fafc', border: '1px solid #e2e8f0',
              borderRadius: 10, padding: '16px 20px',
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 10 }}>
                מה יקרה בייבוא?
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  'משתתפות חדשות ייווצרו אם לא נמצא מספר טלפון קיים',
                  'משתתפות קיימות יעודכנו לפי הצורך — ללא כפילות',
                  'לכל שורה יישמר עותק טופס עם כל הנתונים מהשורה',
                ].map((t, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, fontSize: 13, color: '#475569', lineHeight: 1.5 }}>
                    <span style={{ color: '#94a3b8', flexShrink: 0, marginTop: 1 }}>—</span>
                    <span>{t}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Only-phone warning */}
            {onlyPhoneMapped && (
              <div style={{
                background: '#fffbeb', border: '1px solid #fde68a',
                borderRadius: 8, padding: '9px 14px',
                fontSize: 13, color: '#92400e',
              }}>
                לא מופו שדות נוספים — הנתונים יישמרו רק כעותק טופס.
              </div>
            )}

            {/* Footer notes */}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#94a3b8' }}>
              <span>* שדה טלפון חובה. שורות ללא טלפון ידולגו.</span>
              <span>בתצוגה מקדימה יוצגו עד 30 שורות.</span>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 4 }}>
              <button
                onClick={() => setStep('upload')}
                style={{
                  padding: '10px 22px', background: '#fff',
                  border: '1px solid #e2e8f0', borderRadius: 8,
                  fontSize: 13, color: '#374151', cursor: 'pointer',
                }}
              >
                ← חזרה
              </button>
              <button
                onClick={handlePreview}
                disabled={previewing}
                style={{
                  padding: '10px 28px',
                  background: previewing ? '#93c5fd' : '#2563eb',
                  color: '#fff', border: 'none', borderRadius: 8,
                  fontSize: 14, fontWeight: 600,
                  cursor: previewing ? 'not-allowed' : 'pointer',
                }}
              >
                {previewing ? 'טוען...' : 'תצוגה מקדימה ←'}
              </button>
            </div>

          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════════
            STEP 3 — PREVIEW
        ══════════════════════════════════════════════════════════════════════ */}
        {step === 'preview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Summary cards */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[
                { label: 'משתתפות חדשות',  count: preview.filter(r => r.status === 'create').length, bg: '#f0fdf4', border: '#bbf7d0', color: '#15803d' },
                { label: 'קיימות שיעודכנו', count: preview.filter(r => r.status === 'update').length, bg: '#eff6ff', border: '#bfdbfe', color: '#1d4ed8' },
                { label: 'עותקי טפסים',     count: preview.filter(r => r.status !== 'skip').length,  bg: '#f5f3ff', border: '#ddd6fe', color: '#7c3aed' },
                { label: 'שורות שידולגו',   count: preview.filter(r => r.status === 'skip').length,  bg: '#f8fafc', border: '#e2e8f0', color: '#64748b' },
              ].map(s => (
                <div key={s.label} style={{
                  background: s.bg, border: `1px solid ${s.border}`,
                  borderRadius: 10, padding: '18px 14px', textAlign: 'center',
                }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: s.color, marginBottom: 5, lineHeight: 1 }}>
                    {s.count}
                  </div>
                  <div style={{ fontSize: 12, color: s.color, fontWeight: 500 }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Info note */}
            <div style={{
              background: '#fff', border: '1px solid #e2e8f0',
              borderRadius: 8, padding: '11px 16px',
              fontSize: 13, color: '#64748b', lineHeight: 1.6,
            }}>
              לכל שורה שתיובא יתווסף עותק טופס עם כל הנתונים.
              {csvRows.length > 30 && (
                <span style={{ display: 'block', marginTop: 3, fontSize: 12, color: '#94a3b8' }}>
                  מוצגות 30 שורות ראשונות. הייבוא יכלול את כל {csvRows.length} השורות.
                </span>
              )}
            </div>

            {/* Preview table */}
            {preview.length > 0 && (
              <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ maxHeight: 380, overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: '#f8fafc' }}>
                        {['#', 'שם', 'טלפון', 'מייל', 'סטטוס'].map(h => (
                          <th key={h} style={{
                            padding: '10px 14px', textAlign: 'right',
                            fontWeight: 600, color: '#374151', fontSize: 12,
                            position: 'sticky', top: 0, background: '#f8fafc',
                            borderBottom: '1px solid #e2e8f0',
                          }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map(row => {
                        const STATUS: Record<string, { bg: string; color: string; label: string }> = {
                          create: { bg: '#dcfce7', color: '#16a34a', label: 'יצירה' },
                          update: { bg: '#dbeafe', color: '#1d4ed8', label: 'עדכון' },
                          skip:   { bg: '#fef3c7', color: '#b45309', label: 'דילוג' },
                        };
                        const s = STATUS[row.status];
                        return (
                          <tr key={row.rowIndex} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '10px 14px', color: '#94a3b8', fontSize: 12 }}>{row.rowIndex + 2}</td>
                            <td style={{ padding: '10px 14px', color: '#0f172a', fontWeight: 500 }}>
                              {[row.firstName, row.lastName].filter(Boolean).join(' ') || '—'}
                            </td>
                            <td style={{ padding: '10px 14px', color: '#374151', direction: 'ltr', textAlign: 'right' }}>
                              {row.phone || '—'}
                            </td>
                            <td style={{ padding: '10px 14px', color: '#374151', direction: 'ltr', textAlign: 'right' }}>
                              {row.email || '—'}
                            </td>
                            <td style={{ padding: '10px 14px' }}>
                              <span style={{
                                background: s.bg, color: s.color,
                                padding: '3px 9px', borderRadius: 20,
                                fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
                              }}>
                                {s.label}{row.skipReason ? ` — ${row.skipReason}` : ''}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 4 }}>
              <button
                onClick={() => setStep('map')}
                style={{
                  padding: '10px 22px', background: '#fff',
                  border: '1px solid #e2e8f0', borderRadius: 8,
                  fontSize: 13, color: '#374151', cursor: 'pointer',
                }}
              >
                ← חזרה למיפוי
              </button>
              <button
                onClick={handleRun}
                disabled={running}
                style={{
                  padding: '10px 28px',
                  background: running ? '#86efac' : '#16a34a',
                  color: '#fff', border: 'none', borderRadius: 8,
                  fontSize: 14, fontWeight: 600,
                  cursor: running ? 'not-allowed' : 'pointer',
                }}
              >
                {running ? 'מייבא...' : `ייבאי ${csvRows.length} שורות ✓`}
              </button>
            </div>

          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════════
            STEP 4 — RESULT
        ══════════════════════════════════════════════════════════════════════ */}
        {step === 'result' && result && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Success header */}
            <div style={{
              background: '#fff', border: '1px solid #bbf7d0',
              borderRadius: 14, padding: '36px 28px',
              textAlign: 'center',
            }}>
              <div style={{
                width: 60, height: 60, borderRadius: '50%',
                background: '#dcfce7', margin: '0 auto 18px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 26, color: '#16a34a', fontWeight: 700,
              }}>
                ✓
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>
                הייבוא הושלם בהצלחה
              </div>
              <div style={{ fontSize: 13, color: '#94a3b8' }}>
                {title}
              </div>
            </div>

            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[
                { label: 'משתתפות חדשות נוצרו',   count: result.created,                  bg: '#f0fdf4', border: '#bbf7d0', color: '#15803d' },
                { label: 'קיימות עודכנו',           count: result.updated,                  bg: '#eff6ff', border: '#bfdbfe', color: '#1d4ed8' },
                { label: 'עותקי טפסים שנוספו',     count: result.created + result.updated, bg: '#f5f3ff', border: '#ddd6fe', color: '#7c3aed' },
                { label: 'שורות שדולגו',            count: result.skipped,                  bg: '#f8fafc', border: '#e2e8f0', color: '#64748b' },
              ].map(s => (
                <div key={s.label} style={{
                  background: s.bg, border: `1px solid ${s.border}`,
                  borderRadius: 10, padding: '20px 14px', textAlign: 'center',
                }}>
                  <div style={{ fontSize: 30, fontWeight: 700, color: s.color, marginBottom: 6, lineHeight: 1 }}>
                    {s.count}
                  </div>
                  <div style={{ fontSize: 12, color: s.color, fontWeight: 500, lineHeight: 1.4 }}>
                    {s.label}
                  </div>
                </div>
              ))}
            </div>

            {/* Errors */}
            {result.errors.length > 0 && (
              <div style={{
                background: '#fef2f2', border: '1px solid #fecaca',
                borderRadius: 9, padding: '13px 16px',
              }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#dc2626', marginBottom: 8 }}>
                  שגיאות בשורות ספציפיות ({result.errors.length})
                </div>
                <div style={{ maxHeight: 120, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {result.errors.map((e, i) => (
                    <div key={i} style={{ fontSize: 12, color: '#991b1b' }}>• {e}</div>
                  ))}
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                onClick={() => router.push('/participants')}
                style={{
                  padding: '12px', background: '#2563eb', color: '#fff',
                  border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600,
                  cursor: 'pointer', width: '100%',
                }}
              >
                חזרה למשתתפות ←
              </button>
              <button
                onClick={() => {
                  setStep('upload');
                  setTitle('');
                  setCsvHeaders([]);
                  setCsvRows([]);
                  setMapping({});
                  setPreview([]);
                  setResult(null);
                  setError(null);
                }}
                style={{
                  padding: '12px', background: '#fff', color: '#374151',
                  border: '1px solid #e2e8f0', borderRadius: 8,
                  fontSize: 14, cursor: 'pointer', width: '100%',
                }}
              >
                ייבוא נוסף
              </button>
            </div>

          </div>
        )}

      </div>
    </div>
  );
}
