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
                width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 700,
                background: done ? '#2563eb' : active ? '#2563eb' : '#f1f5f9',
                color: done || active ? '#fff' : '#94a3b8',
                boxShadow: active ? '0 0 0 4px #dbeafe' : 'none',
                transition: 'all 0.2s',
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
                flex: 1,
                height: 2,
                background: done ? '#2563eb' : '#e2e8f0',
                margin: '0 8px',
                marginBottom: 28,
                borderRadius: 1,
                transition: 'background 0.2s',
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Mapping row (vertical layout) ────────────────────────────────────────────

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
    ? [...new Set(csvRows.map(r => r[colIdx]?.trim()).filter(Boolean))].slice(0, 3)
    : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>
        {label}
        {required && <span style={{ color: '#dc2626', marginRight: 3 }}>*</span>}
      </div>
      <select
        style={{
          width: '100%', padding: '9px 11px', fontSize: 13, borderRadius: 8,
          border: `1.5px solid ${mapped ? '#93c5fd' : '#e2e8f0'}`,
          background: mapped ? '#eff6ff' : '#fff',
          color: mapped ? '#1d4ed8' : '#374151',
          outline: 'none',
          cursor: 'pointer',
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
        <div style={{ fontSize: 11, color: '#94a3b8', paddingRight: 2 }}>
          לדוגמה: {samples.join(' · ')}
        </div>
      )}
      {helperText && (
        <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.5, paddingRight: 2 }}>
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

  // ─── Derived state ────────────────────────────────────────────────────────────

  const autoDetectedCount = Object.values(mapping).filter(v => v != null).length;
  const onlyPhoneMapped   = Object.values(mapping).filter(v => v != null).length === 1 && mapping.phone != null;

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div dir="rtl" style={{ minHeight: '100vh', background: '#f1f5f9' }}>
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '32px 20px 80px' }}>

        {/* ── Back link ── */}
        <Link
          href="/participants"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, color: '#64748b', textDecoration: 'none', marginBottom: 28 }}
        >
          ← חזרה למשתתפות
        </Link>

        {/* ── Page header ── */}
        <div style={{ marginBottom: 36 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', margin: '0 0 16px' }}>
            ייבוא משתתפות מקובץ CSV
          </h1>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[
              'מוסיף משתתפות חדשות לרשימה',
              'מעדכן משתתפות קיימות לפי מספר טלפון',
              'שומר עותק טופס לכל שורה',
            ].map((text, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 14, color: '#475569' }}>
                <span style={{
                  width: 18, height: 18, borderRadius: '50%', background: '#dbeafe',
                  color: '#2563eb', fontSize: 10, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>✓</span>
                {text}
              </div>
            ))}
          </div>
        </div>

        {/* ── Step indicator ── */}
        <StepIndicator current={step} />

        {/* ── Global error banner ── */}
        {error && (
          <div style={{
            background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10,
            padding: '12px 16px', color: '#dc2626', fontSize: 14,
            marginBottom: 24, lineHeight: 1.5,
            display: 'flex', alignItems: 'flex-start', gap: 10,
          }}>
            <span style={{ flexShrink: 0, marginTop: 1 }}>⚠</span>
            <span>{error}</span>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════════
            STEP 1 — UPLOAD
        ══════════════════════════════════════════════════════════════════════ */}
        {step === 'upload' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Hidden file input */}
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
                borderRadius: 16,
                padding: '64px 32px',
                textAlign: 'center',
                background: dragOver ? '#eff6ff' : '#ffffff',
                transition: 'border-color 0.15s, background 0.15s',
                cursor: detecting ? 'wait' : 'pointer',
              }}
            >
              {detecting ? (
                <>
                  <div style={{ fontSize: 40, marginBottom: 16, opacity: 0.5 }}>⏳</div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: '#374151' }}>מנתח את הקובץ...</div>
                  <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 6 }}>מזהה עמודות אוטומטית</div>
                </>
              ) : dragOver ? (
                <>
                  <div style={{ fontSize: 44, marginBottom: 12 }}>📂</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#2563eb' }}>שחרר כאן</div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 48, marginBottom: 16, lineHeight: 1 }}>⬆</div>
                  <div style={{ fontSize: 18, fontWeight: 600, color: '#1e293b', marginBottom: 8 }}>
                    גררי קובץ CSV לכאן
                  </div>
                  <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 6 }}>
                    או לחצי לבחור קובץ
                  </div>
                  <div style={{ fontSize: 12, color: '#cbd5e1', marginBottom: 24 }}>
                    CSV בלבד
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); fileRef.current?.click(); }}
                    style={{
                      padding: '10px 32px', background: '#2563eb', color: '#fff',
                      border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    בחרי קובץ
                  </button>
                </>
              )}
            </div>

            {/* Import title card */}
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '20px' }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>
                שם הייבוא
              </label>
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10 }}>
                יאוכלס אוטומטית משם הקובץ — ניתן לערוך
              </div>
              <input
                style={{
                  width: '100%', padding: '10px 12px',
                  border: '1px solid #e2e8f0', borderRadius: 8,
                  fontSize: 14, boxSizing: 'border-box',
                  background: '#f8fafc', color: '#0f172a',
                  outline: 'none',
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* File summary */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12,
              background: '#fff', border: '1px solid #e2e8f0',
              borderRadius: 10, padding: '12px 16px',
            }}>
              <span style={{ fontSize: 20 }}>📄</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{title || 'קובץ CSV'}</div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                  {csvHeaders.length} עמודות · {csvRows.length} שורות
                </div>
              </div>
              <button
                onClick={() => { setStep('upload'); setCsvHeaders([]); setCsvRows([]); setMapping({}); }}
                style={{
                  fontSize: 12, color: '#94a3b8', background: 'none',
                  border: '1px solid #e2e8f0', borderRadius: 6,
                  cursor: 'pointer', padding: '5px 10px',
                }}
              >
                החלפי קובץ
              </button>
            </div>

            {/* Auto-detect notice */}
            {autoDetectedCount > 0 && (
              <div style={{
                background: '#f0fdf4', border: '1px solid #bbf7d0',
                borderRadius: 10, padding: '10px 16px',
                fontSize: 13, color: '#15803d',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span>✓</span>
                <span>זוהו אוטומטית {autoDetectedCount} שדות — בדקי ותקני לפי הצורך</span>
              </div>
            )}

            {/* ── Identity fields card ── */}
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', padding: '14px 20px' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>שדות כרטיס משתתפת</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>
                  נשמרים ישירות על כרטיס המשתתפת. טלפון משמש לזיהוי — אין כפילויות.
                </div>
              </div>
              <div style={{ padding: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <MappingRow
                    label="טלפון" required
                    field="phone" mapping={mapping}
                    csvHeaders={csvHeaders} csvRows={csvRows}
                    onChange={updateMapping}
                  />
                </div>
                <MappingRow label="שם פרטי"  field="firstName" mapping={mapping} csvHeaders={csvHeaders} csvRows={csvRows} onChange={updateMapping} />
                <MappingRow label="שם משפחה" field="lastName"  mapping={mapping} csvHeaders={csvHeaders} csvRows={csvRows} onChange={updateMapping} />
                <div style={{ gridColumn: '1 / -1' }}>
                  <MappingRow
                    label="שם מלא" field="fullName"
                    mapping={mapping} csvHeaders={csvHeaders} csvRows={csvRows}
                    onChange={updateMapping}
                    helperText="אם ממפים 'שם מלא' — המילה הראשונה תהפוך לשם פרטי, והשאר לשם משפחה."
                  />
                </div>
                <MappingRow label="מייל" field="email" mapping={mapping} csvHeaders={csvHeaders} csvRows={csvRows} onChange={updateMapping} />
                <MappingRow label="עיר"  field="city"  mapping={mapping} csvHeaders={csvHeaders} csvRows={csvRows} onChange={updateMapping} />
              </div>
            </div>

            {/* ── Trust / duplicate explanation box ── */}
            <div style={{
              background: '#fffbeb', border: '1px solid #fde68a',
              borderRadius: 12, padding: '18px 20px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 }}>
                <span style={{ fontSize: 18 }}>🛡</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#92400e' }}>
                  מה קורה אם המשתתפת כבר קיימת?
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  { icon: '🚫', text: 'לא נוצרת כפילות — הזיהוי הוא לפי מספר טלפון' },
                  { icon: '✏️', text: 'הכרטיס מתעדכן לפי הצורך (מייל, עיר)' },
                  { icon: '📋', text: 'נוסף עותק טופס חדש עם כל הנתונים מהשורה' },
                ].map((item, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, color: '#78350f' }}>
                    <span style={{ fontSize: 15, flexShrink: 0, marginTop: 0 }}>{item.icon}</span>
                    <span style={{ lineHeight: 1.5 }}>{item.text}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Additional fields card ── */}
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', padding: '14px 20px' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>שדות נוספים</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>
                  נשמרים בעותק הטופס בלבד — לא מופיעים בכרטיס הראשי.
                </div>
              </div>
              <div style={{ padding: '20px' }}>
                <MappingRow label="הערות" field="notes" mapping={mapping} csvHeaders={csvHeaders} csvRows={csvRows} onChange={updateMapping} />
              </div>
            </div>

            {/* Only-phone-mapped warning */}
            {onlyPhoneMapped && (
              <div style={{
                background: '#fffbeb', border: '1px solid #fde68a',
                borderRadius: 10, padding: '10px 14px',
                fontSize: 13, color: '#92400e',
                display: 'flex', alignItems: 'flex-start', gap: 8,
              }}>
                <span style={{ flexShrink: 0 }}>ℹ</span>
                <span>לא מופו שדות נוספים — הנתונים יישמרו רק כעותק טופס.</span>
              </div>
            )}

            {/* Footer notes */}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#94a3b8' }}>
              <span>* שדה טלפון הוא שדה חובה. שורות ללא טלפון ידולגו.</span>
              <span>בתצוגה מקדימה יוצגו עד 30 שורות בלבד.</span>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8 }}>
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
                  padding: '11px 32px',
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Summary cards — 4 cards in a 2x2 grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {[
                { icon: '✨', label: 'משתתפות חדשות',  count: preview.filter(r => r.status === 'create').length, bg: '#f0fdf4', border: '#bbf7d0', color: '#15803d' },
                { icon: '🔄', label: 'קיימות שיעודכנו', count: preview.filter(r => r.status === 'update').length, bg: '#eff6ff', border: '#bfdbfe', color: '#1d4ed8' },
                { icon: '📋', label: 'עותקי טפסים',     count: preview.filter(r => r.status !== 'skip').length,  bg: '#f5f3ff', border: '#ddd6fe', color: '#7c3aed' },
                { icon: '⏭',  label: 'שורות שידולגו',   count: preview.filter(r => r.status === 'skip').length,  bg: '#f8fafc', border: '#e2e8f0', color: '#64748b' },
              ].map(s => (
                <div key={s.label} style={{
                  background: s.bg, border: `1px solid ${s.border}`,
                  borderRadius: 12, padding: '20px 16px', textAlign: 'center',
                }}>
                  <div style={{ fontSize: 20, marginBottom: 8 }}>{s.icon}</div>
                  <div style={{ fontSize: 30, fontWeight: 700, color: s.color, marginBottom: 5 }}>{s.count}</div>
                  <div style={{ fontSize: 12, color: s.color, fontWeight: 600 }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Info note */}
            <div style={{
              background: '#fff', border: '1px solid #e2e8f0',
              borderRadius: 10, padding: '12px 16px',
              fontSize: 13, color: '#475569', lineHeight: 1.6,
            }}>
              לכל שורה שתיובא יתווסף עותק טופס עם כל הנתונים מהשורה.
              {csvRows.length > 30 && (
                <span style={{ display: 'block', marginTop: 4, color: '#94a3b8', fontSize: 12 }}>
                  מוצגות 30 שורות ראשונות. הייבוא יכלול את כל {csvRows.length} השורות.
                </span>
              )}
            </div>

            {/* Preview table */}
            {preview.length > 0 && (
              <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                        {['#', 'שם', 'טלפון', 'מייל', 'סטטוס'].map(h => (
                          <th key={h} style={{
                            padding: '11px 14px', textAlign: 'right',
                            fontWeight: 600, color: '#374151', fontSize: 12,
                            position: 'sticky', top: 0, background: '#f8fafc',
                            borderBottom: '2px solid #e2e8f0',
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
                          <tr
                            key={row.rowIndex}
                            style={{ borderBottom: '1px solid #f1f5f9' }}
                          >
                            <td style={{ padding: '11px 14px', color: '#94a3b8', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                              {row.rowIndex + 2}
                            </td>
                            <td style={{ padding: '11px 14px', color: '#0f172a', fontWeight: 500 }}>
                              {[row.firstName, row.lastName].filter(Boolean).join(' ') || '—'}
                            </td>
                            <td style={{ padding: '11px 14px', color: '#374151', direction: 'ltr', textAlign: 'right' }}>
                              {row.phone || '—'}
                            </td>
                            <td style={{ padding: '11px 14px', color: '#374151', direction: 'ltr', textAlign: 'right' }}>
                              {row.email || '—'}
                            </td>
                            <td style={{ padding: '11px 14px' }}>
                              <span style={{
                                background: s.bg, color: s.color,
                                padding: '3px 10px', borderRadius: 20,
                                fontSize: 11, fontWeight: 600,
                                whiteSpace: 'nowrap',
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8 }}>
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
                  padding: '11px 32px',
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

            {/* Success header */}
            <div style={{
              background: '#fff', border: '1px solid #bbf7d0',
              borderRadius: 16, padding: '40px 32px',
              textAlign: 'center',
            }}>
              <div style={{
                width: 72, height: 72, borderRadius: '50%',
                background: '#dcfce7', margin: '0 auto 20px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 32,
              }}>
                ✓
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>
                הייבוא הושלם בהצלחה
              </div>
              <div style={{ fontSize: 14, color: '#64748b' }}>
                {title}
              </div>
            </div>

            {/* Stats 2×2 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {[
                { icon: '✨', label: 'משתתפות חדשות נוצרו',   count: result.created,                     bg: '#f0fdf4', border: '#bbf7d0', color: '#15803d' },
                { icon: '🔄', label: 'משתתפות קיימות עודכנו', count: result.updated,                     bg: '#eff6ff', border: '#bfdbfe', color: '#1d4ed8' },
                { icon: '📋', label: 'עותקי טפסים שנוספו',    count: result.created + result.updated,    bg: '#f5f3ff', border: '#ddd6fe', color: '#7c3aed' },
                { icon: '⏭',  label: 'שורות שדולגו',          count: result.skipped,                     bg: '#f8fafc', border: '#e2e8f0', color: '#64748b' },
              ].map(s => (
                <div key={s.label} style={{
                  background: s.bg, border: `1px solid ${s.border}`,
                  borderRadius: 12, padding: '22px 16px', textAlign: 'center',
                }}>
                  <div style={{ fontSize: 22, marginBottom: 10 }}>{s.icon}</div>
                  <div style={{ fontSize: 32, fontWeight: 700, color: s.color, marginBottom: 6 }}>
                    {s.count}
                  </div>
                  <div style={{ fontSize: 12, color: s.color, fontWeight: 600, lineHeight: 1.4 }}>
                    {s.label}
                  </div>
                </div>
              ))}
            </div>

            {/* Errors */}
            {result.errors.length > 0 && (
              <div style={{
                background: '#fef2f2', border: '1px solid #fecaca',
                borderRadius: 10, padding: '14px 16px',
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#dc2626', marginBottom: 8 }}>
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                onClick={() => router.push('/participants')}
                style={{
                  padding: '13px 24px', background: '#2563eb', color: '#fff',
                  border: 'none', borderRadius: 9, fontSize: 14, fontWeight: 600,
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
                  padding: '13px 24px', background: '#fff', color: '#374151',
                  border: '1px solid #e2e8f0', borderRadius: 9,
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
