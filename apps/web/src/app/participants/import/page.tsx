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

// ─── Step indicator ─────────────────────────────────────────────────────────────

const STEPS: { key: Step; label: string }[] = [
  { key: 'upload',  label: 'העלאת קובץ' },
  { key: 'map',     label: 'מיפוי שדות' },
  { key: 'preview', label: 'תצוגה מקדימה' },
  { key: 'result',  label: 'סיום' },
];

function StepIndicator({ current }: { current: Step }) {
  const idx = STEPS.findIndex(s => s.key === current);
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 40, flexWrap: 'wrap', gap: 4 }}>
      {STEPS.map((s, i) => {
        const done   = i < idx;
        const active = i === idx;
        return (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center' }}>
            {i > 0 && (
              <div style={{ width: 36, height: 2, background: done ? '#2563eb' : '#e2e8f0', margin: '0 6px', borderRadius: 1 }} />
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 700,
                background: done || active ? '#2563eb' : '#f1f5f9',
                color: done || active ? '#fff' : '#94a3b8',
              }}>
                {done ? '✓' : i + 1}
              </div>
              <span style={{
                fontSize: 13, fontWeight: active ? 700 : 400, whiteSpace: 'nowrap',
                color: active ? '#0f172a' : done ? '#64748b' : '#94a3b8',
              }}>
                {s.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Mapping row ──────────────────────────────────────────────────────────────

function MappingRow({
  label, required, field, mapping, csvHeaders, csvRows, onChange,
}: {
  label: string; required?: boolean; field: keyof ColumnMapping;
  mapping: ColumnMapping; csvHeaders: string[]; csvRows: string[][];
  onChange: (field: keyof ColumnMapping, value: number | null) => void;
}) {
  const colIdx = mapping[field];
  const mapped = colIdx != null && colIdx >= 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <div style={{ width: 110, flexShrink: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{label}</span>
        {required && <span style={{ color: '#dc2626', marginRight: 3, fontSize: 13 }}>*</span>}
      </div>
      <select
        style={{
          flex: 1, padding: '8px 10px', fontSize: 13, borderRadius: 7,
          border: `1.5px solid ${mapped ? '#93c5fd' : '#e2e8f0'}`,
          background: mapped ? '#eff6ff' : '#fff', color: '#0f172a', outline: 'none',
        }}
        value={colIdx ?? -1}
        onChange={e => onChange(field, Number(e.target.value) >= 0 ? Number(e.target.value) : null)}
      >
        <option value={-1}>— לא ממופה —</option>
        {csvHeaders.map((h, i) => {
          const samples = [...new Set(csvRows.map(r => r[i]?.trim()).filter(Boolean))].slice(0, 3);
          return (
            <option key={i} value={i}>
              {h || `עמודה ${i + 1}`}{samples.length ? ` (${samples.join(', ')})` : ''}
            </option>
          );
        })}
      </select>
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

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div dir="rtl" style={{ minHeight: '100vh', background: '#f8fafc' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 24px 64px' }}>

        {/* Back link */}
        <Link
          href="/participants"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#64748b', textDecoration: 'none', marginBottom: 24 }}
        >
          ← חזרה למשתתפות
        </Link>

        {/* Page title */}
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', margin: '0 0 6px' }}>
            ייבוא משתתפות מ-CSV
          </h1>
          <p style={{ fontSize: 14, color: '#64748b', margin: 0 }}>
            ייבאי רשימת משתתפות מקובץ גיליון אלקטרוני. שורות ייבדקו מול הרשימה הקיימת לפי מספר טלפון.
          </p>
        </div>

        {/* Step indicator */}
        <StepIndicator current={step} />

        {/* Global error */}
        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '12px 16px', color: '#dc2626', fontSize: 14, marginBottom: 24, lineHeight: 1.5 }}>
            {error}
          </div>
        )}

        {/* ── Step 1: Upload ────────────────────────────────────────────────── */}
        {step === 'upload' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

            {/* Drop zone */}
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.tsv,.txt"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
            />
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragEnter={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={e => { e.preventDefault(); setDragOver(false); }}
              onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
              onClick={() => !detecting && fileRef.current?.click()}
              style={{
                border: `2px dashed ${dragOver ? '#2563eb' : '#cbd5e1'}`,
                borderRadius: 16,
                padding: '56px 32px',
                textAlign: 'center',
                background: dragOver ? '#eff6ff' : '#ffffff',
                transition: 'border-color 0.15s, background 0.15s',
                cursor: detecting ? 'wait' : 'pointer',
              }}
            >
              {detecting ? (
                <>
                  <div style={{ fontSize: 36, marginBottom: 14 }}>⏳</div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: '#374151' }}>מנתח את הקובץ...</div>
                </>
              ) : dragOver ? (
                <>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>📂</div>
                  <div style={{ fontSize: 17, fontWeight: 700, color: '#2563eb' }}>שחרר כאן</div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 44, marginBottom: 14, color: '#cbd5e1' }}>📄</div>
                  <div style={{ fontSize: 17, fontWeight: 600, color: '#374151', marginBottom: 8 }}>גרור קובץ CSV לכאן</div>
                  <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 22 }}>CSV, TSV, TXT — כל גיליון אלקטרוני שיוצא עם עמודות</div>
                  <button
                    onClick={e => { e.stopPropagation(); fileRef.current?.click(); }}
                    style={{ padding: '10px 28px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                  >
                    בחר קובץ
                  </button>
                </>
              )}
            </div>

            {/* Import title */}
            <div>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
                שם הייבוא
                <span style={{ fontWeight: 400, color: '#94a3b8', fontSize: 12, marginRight: 6 }}>יאוכלס אוטומטית משם הקובץ</span>
              </label>
              <input
                style={{ width: '100%', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14, boxSizing: 'border-box', background: '#fff', color: '#0f172a' }}
                placeholder="לדוגמה: ייבוא נרשמות ינואר 2026"
                value={title}
                onChange={e => setTitle(e.target.value)}
              />
            </div>

          </div>
        )}

        {/* ── Step 2: Mapping ───────────────────────────────────────────────── */}
        {step === 'map' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

            {/* File summary */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 16px' }}>
              <span style={{ fontSize: 22 }}>📄</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{title || 'קובץ CSV'}</div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{csvHeaders.length} עמודות · {csvRows.length} שורות</div>
              </div>
              <button
                onClick={() => { setStep('upload'); setCsvHeaders([]); setCsvRows([]); setMapping({}); }}
                style={{ fontSize: 12, color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px', borderRadius: 6 }}
              >
                החלף קובץ
              </button>
            </div>

            {/* Auto-detect notice */}
            {Object.values(mapping).filter(v => v != null).length > 0 && (
              <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '12px 16px', fontSize: 13, color: '#1d4ed8' }}>
                ✓ זוהו אוטומטית {Object.values(mapping).filter(v => v != null).length} שדות. בדקי ותקני לפי הצורך.
              </div>
            )}

            {/* ── Identity fields ── */}
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', padding: '14px 20px' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginBottom: 2 }}>שדות כרטיס משתתפת</div>
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  שדות אלה יישמרו ישירות על כרטיס המשתתפת. מספר טלפון משמש לזיהוי — משתתפת קיימת לא תשוכפל.
                </div>
              </div>
              <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <MappingRow label="טלפון"    required field="phone"     mapping={mapping} csvHeaders={csvHeaders} csvRows={csvRows} onChange={updateMapping} />
                <MappingRow label="שם פרטי"  field="firstName" mapping={mapping} csvHeaders={csvHeaders} csvRows={csvRows} onChange={updateMapping} />
                <MappingRow label="שם משפחה" field="lastName"  mapping={mapping} csvHeaders={csvHeaders} csvRows={csvRows} onChange={updateMapping} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <MappingRow label="שם מלא" field="fullName" mapping={mapping} csvHeaders={csvHeaders} csvRows={csvRows} onChange={updateMapping} />
                  <div style={{ paddingRight: 124, fontSize: 12, color: '#94a3b8', lineHeight: 1.4 }}>
                    אם ממופה, המילה הראשונה תהפוך לשם פרטי, השאר לשם משפחה. ממלא רק כאשר שם פרטי ריק.
                  </div>
                </div>
                <MappingRow label="מייל"     field="email"     mapping={mapping} csvHeaders={csvHeaders} csvRows={csvRows} onChange={updateMapping} />
                <MappingRow label="עיר"      field="city"      mapping={mapping} csvHeaders={csvHeaders} csvRows={csvRows} onChange={updateMapping} />
              </div>
            </div>

            {/* ── Duplicate / update explanation ── */}
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12, padding: '16px 20px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#92400e', marginBottom: 10 }}>
                🔄 מה קורה עם משתתפת שכבר קיימת?
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {[
                  'לא תיווצר משתתפת כפולה — הזיהוי הוא לפי מספר טלפון',
                  'שדות ריקים בכרטיס הקיים יתעדכנו מהקובץ (מייל, עיר)',
                  'לכרטיס הקיים יתווסף עותק טופס חדש עם כל הנתונים מהשורה',
                ].map((t, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, color: '#78350f' }}>
                    <span style={{ flexShrink: 0, marginTop: 1 }}>✓</span>
                    <span>{t}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Additional fields ── */}
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', padding: '14px 20px' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginBottom: 2 }}>שדות נוספים</div>
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  שדות אלה יישמרו בעותק הטופס המצורף לכרטיס — לא יופיעו בעמוד הכרטיס הראשי.
                </div>
              </div>
              <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <MappingRow label="הערות" field="notes" mapping={mapping} csvHeaders={csvHeaders} csvRows={csvRows} onChange={updateMapping} />
              </div>
            </div>

            <div style={{ fontSize: 12, color: '#94a3b8' }}>
              * שדה טלפון הוא שדה חובה. שורות ללא מספר טלפון ידולגו.
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 4 }}>
              <button
                onClick={() => setStep('upload')}
                style={{ padding: '10px 20px', background: '#f1f5f9', border: 'none', borderRadius: 8, fontSize: 13, color: '#374151', cursor: 'pointer' }}
              >
                ← חזרה
              </button>
              <button
                onClick={handlePreview}
                disabled={previewing}
                style={{ padding: '11px 28px', background: previewing ? '#93c5fd' : '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: previewing ? 'not-allowed' : 'pointer' }}
              >
                {previewing ? 'טוען...' : 'המשך לתצוגה מקדימה ←'}
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Preview ───────────────────────────────────────────────── */}
        {step === 'preview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

            {/* Summary cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              {[
                { label: 'משתתפות חדשות',       count: preview.filter(r => r.status === 'create').length, bg: '#f0fdf4', border: '#bbf7d0', color: '#15803d' },
                { label: 'קיימות שיעודכנו',      count: preview.filter(r => r.status === 'update').length, bg: '#eff6ff', border: '#bfdbfe', color: '#1d4ed8' },
                { label: 'שורות שידולגו',         count: preview.filter(r => r.status === 'skip').length,  bg: '#fefce8', border: '#fde68a', color: '#854d0e' },
              ].map(s => (
                <div key={s.label} style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 12, padding: '18px 16px', textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: s.color, marginBottom: 4 }}>{s.count}</div>
                  <div style={{ fontSize: 12, color: s.color, fontWeight: 600 }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Form copies note */}
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 16px', fontSize: 13, color: '#475569', lineHeight: 1.6 }}>
              לכל שורה שתיובא — בין אם משתתפת חדשה ובין אם קיימת — יתווסף עותק טופס חדש עם כל הנתונים מהשורה.
              {csvRows.length > 30 && (
                <span style={{ display: 'block', marginTop: 6, color: '#94a3b8' }}>
                  מוצגות 30 שורות ראשונות. הייבוא עצמו יכלול את כל {csvRows.length} השורות.
                </span>
              )}
            </div>

            {/* Rows table */}
            {preview.length > 0 && (
              <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                      {['שורה', 'שם', 'טלפון', 'מייל', 'פעולה'].map(h => (
                        <th key={h} style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#374151', fontSize: 12 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map(row => {
                      const STATUS: Record<string, { bg: string; color: string; label: string }> = {
                        create: { bg: '#dcfce7', color: '#15803d', label: 'יצירה' },
                        update: { bg: '#dbeafe', color: '#1d4ed8', label: 'עדכון' },
                        skip:   { bg: '#fef9c3', color: '#854d0e', label: 'דילוג' },
                      };
                      const s = STATUS[row.status];
                      return (
                        <tr key={row.rowIndex} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '9px 14px', color: '#94a3b8', fontSize: 12 }}>{row.rowIndex + 2}</td>
                          <td style={{ padding: '9px 14px', color: '#0f172a' }}>{[row.firstName, row.lastName].filter(Boolean).join(' ') || '—'}</td>
                          <td style={{ padding: '9px 14px', color: '#374151', direction: 'ltr', textAlign: 'right' }}>{row.phone || '—'}</td>
                          <td style={{ padding: '9px 14px', color: '#374151', direction: 'ltr', textAlign: 'right' }}>{row.email || '—'}</td>
                          <td style={{ padding: '9px 14px' }}>
                            <span style={{ background: s.bg, color: s.color, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600 }}>
                              {s.label}{row.skipReason ? ` — ${row.skipReason}` : ''}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 4 }}>
              <button
                onClick={() => setStep('map')}
                style={{ padding: '10px 20px', background: '#f1f5f9', border: 'none', borderRadius: 8, fontSize: 13, color: '#374151', cursor: 'pointer' }}
              >
                ← חזרה למיפוי
              </button>
              <button
                onClick={handleRun}
                disabled={running}
                style={{ padding: '11px 28px', background: running ? '#86efac' : '#16a34a', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: running ? 'not-allowed' : 'pointer' }}
              >
                {running ? 'מייבא...' : `ייבאי ${csvRows.length} שורות ✓`}
              </button>
            </div>
          </div>
        )}

        {/* ── Step 4: Result ────────────────────────────────────────────────── */}
        {step === 'result' && result && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

            {/* Success header */}
            <div style={{ textAlign: 'center', padding: '12px 0 4px' }}>
              <div style={{ fontSize: 52, marginBottom: 16 }}>✅</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>הייבוא הושלם בהצלחה</div>
              <div style={{ fontSize: 14, color: '#64748b' }}>"{title}"</div>
            </div>

            {/* Stats grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
              {[
                { label: 'משתתפות חדשות נוצרו', count: result.created, bg: '#f0fdf4', border: '#bbf7d0', color: '#15803d' },
                { label: 'משתתפות קיימות עודכנו', count: result.updated, bg: '#eff6ff', border: '#bfdbfe', color: '#1d4ed8' },
                { label: 'עותקי טפסים שנוספו',    count: result.created + result.updated, bg: '#f5f3ff', border: '#ddd6fe', color: '#7c3aed' },
                { label: 'שורות שדולגו',           count: result.skipped, bg: '#f8fafc', border: '#e2e8f0', color: '#64748b' },
              ].map(s => (
                <div key={s.label} style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 12, padding: '18px 16px', textAlign: 'center' }}>
                  <div style={{ fontSize: 30, fontWeight: 700, color: s.color, marginBottom: 6 }}>{s.count}</div>
                  <div style={{ fontSize: 12, color: s.color, fontWeight: 600 }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Errors (if any) */}
            {result.errors.length > 0 && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '14px 16px' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#dc2626', marginBottom: 8 }}>שגיאות בשורות ספציפיות ({result.errors.length})</div>
                <div style={{ maxHeight: 120, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {result.errors.map((e, i) => (
                    <div key={i} style={{ fontSize: 12, color: '#991b1b' }}>• {e}</div>
                  ))}
                </div>
              </div>
            )}

            {/* Next actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 4 }}>
              <button
                onClick={() => router.push('/participants')}
                style={{ padding: '12px 24px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 9, fontSize: 14, fontWeight: 600, cursor: 'pointer', width: '100%' }}
              >
                חזרה לרשימת המשתתפות ←
              </button>
              <button
                onClick={() => { setStep('upload'); setTitle(''); setCsvHeaders([]); setCsvRows([]); setMapping({}); setPreview([]); setResult(null); setError(null); }}
                style={{ padding: '12px 24px', background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 9, fontSize: 14, cursor: 'pointer', width: '100%' }}
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
