'use client';

import { useEffect, useState, useRef } from 'react';
import { use } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { BASE_URL, apiFetch } from '@lib/api';
import dynamic from 'next/dynamic';

const RichTextEditor = dynamic(() => import('@components/rich-text-editor'), { ssr: false });

// ─── Types ───────────────────────────────────────────────────────────────────

interface QuestionOption {
  id: string;
  label: string;
  value: string;
  sortOrder: number;
}

interface Question {
  id: string;
  label: string;
  internalKey: string;
  questionType: string;
  helperText: string | null;
  sortOrder: number;
  isRequired: boolean;
  allowOther: boolean;
  fieldSize: string | null;
  isSystemField: boolean;
  isActive: boolean;
  options: QuestionOption[];
}

interface ExternalLink {
  id: string;
  internalName: string;
  slugOrToken: string;
  isActive: boolean;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
}

interface Template {
  id: string;
  internalName: string;
  publicTitle: string;
  introRichText: string | null;
  usageType: string;
  submitBehavior: string;
  displayMode: string;
  isActive: boolean;
  postIdentificationGreeting: string | null;
  questions: Question[];
}

type TabKey = 'settings' | 'questions' | 'links' | 'submissions';

// ─── Shared styles ───────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  border: '1px solid #cbd5e1',
  borderRadius: 7,
  fontSize: 14,
  color: '#0f172a',
  background: '#ffffff',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: '#374151',
  marginBottom: 5,
  display: 'block',
};

const QUESTION_TYPE_LABELS: Record<string, string> = {
  text: 'טקסט קצר',
  textarea: 'טקסט ארוך',
  number: 'מספר',
  choice: 'בחירה יחידה',
  multi: 'בחירה מרובה',
  dropdown: 'רשימה נפתחת',
  scale: 'סקאלה 1–10',
  rating: 'דירוג כוכבים (1–5)',
  slider: 'סרגל (טווח)',
  date: 'תאריך',
  time: 'שעה',
  datetime: 'תאריך ושעה',
  yesno: 'כן / לא',
  email: 'אימייל',
  phone: 'טלפון',
  url: 'קישור (URL)',
  static_text: 'בלוק טקסט / כותרת',
  file_upload: 'העלאת קובץ',
  image_upload: 'העלאת תמונה',
  matrix_simple: 'טבלה פשוטה',
};

// Default fieldSize per question type
const DEFAULT_FIELD_SIZE: Record<string, string> = {
  text: 'sm',
  textarea: 'lg',
  number: 'sm',
  email: 'sm',
  phone: 'sm',
  url: 'md',
  static_text: 'lg',
};

function defaultFieldSize(questionType: string): string {
  return DEFAULT_FIELD_SIZE[questionType] ?? 'md';
}

// Types that use options (choice/multi/dropdown)
const OPTION_TYPES = ['choice', 'multi', 'dropdown'];

// ─── Modal wrapper ────────────────────────────────────────────────────────────

function ConfirmModal({ title, message, confirmLabel = 'אישור', danger = false, onConfirm, onClose }: {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 20 }}
    >
      <div style={{ background: '#fff', borderRadius: 12, padding: 24, width: '100%', maxWidth: 400, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: '0 0 10px' }}>{title}</h3>
        <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 20px', lineHeight: 1.6 }}>{message}</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>ביטול</button>
          <button onClick={onConfirm} style={{ background: danger ? '#dc2626' : '#2563eb', color: '#fff', border: 'none', borderRadius: 7, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

function Modal({ onClose, title, children }: { onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}
    >
      <div style={{ background: '#fff', borderRadius: 14, padding: 28, width: '100%', maxWidth: 520, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', margin: 0 }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#94a3b8', lineHeight: 1 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function SaveBtn({ saving, onClick, label = 'שמירה' }: { saving: boolean; onClick: () => void; label?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={saving}
      style={{ background: saving ? '#93c5fd' : '#2563eb', color: '#fff', border: 'none', borderRadius: 7, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer' }}
    >
      {saving ? 'שומר...' : label}
    </button>
  );
}

// ─── TAB 1: Settings ─────────────────────────────────────────────────────────

const EMOJI_SHORTCUTS = ['😊', '🌟', '💪', '👋', '🎯', '✨', '🙏', '🎉', '❤️', '🌸'];

function SettingsTab({ template, onSaved }: { template: Template; onSaved: (t: Template) => void }) {
  const [form, setForm] = useState({
    internalName: template.internalName,
    publicTitle: template.publicTitle,
    introRichText: template.introRichText ?? '',
    usageType: template.usageType,
    submitBehavior: template.submitBehavior,
    displayMode: template.displayMode ?? 'step_by_step',
    isActive: template.isActive,
    postIdentificationGreeting: template.postIdentificationGreeting ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const greetingRef = useRef<HTMLTextAreaElement>(null);

  function insertIntoGreeting(text: string) {
    const el = greetingRef.current;
    const current = form.postIdentificationGreeting;
    if (!el) {
      setForm((prev) => ({ ...prev, postIdentificationGreeting: current + text }));
      return;
    }
    const start = el.selectionStart ?? current.length;
    const end = el.selectionEnd ?? start;
    const next = current.slice(0, start) + text + current.slice(end);
    setForm((prev) => ({ ...prev, postIdentificationGreeting: next }));
    setSaved(false);
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + text.length, start + text.length);
    }, 0);
  }

  function setField(field: string, value: string | boolean) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setSaved(false);
  }

  async function handleSave() {
    if (!form.internalName.trim() || !form.publicTitle.trim()) {
      setError('שם פנימי וכותרת ציבורית הם שדות חובה');
      return;
    }
    setError('');
    setSaving(true);
    try {
      const updated = await apiFetch<Template>(`${BASE_URL}/questionnaires/${template.id}`, {
        method: 'PATCH',
        body: JSON.stringify(form),
      });
      onSaved(updated);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <label style={labelStyle}>שם פנימי *</label>
          <input style={inputStyle} value={form.internalName} onChange={(e) => setField('internalName', e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>כותרת ציבורית *</label>
          <input style={inputStyle} value={form.publicTitle} onChange={(e) => setField('publicTitle', e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>סוג שימוש</label>
          <select style={inputStyle} value={form.usageType} onChange={(e) => setField('usageType', e.target.value)}>
            <option value="both">שניהם</option>
            <option value="internal">פנימי בלבד</option>
            <option value="external">חיצוני בלבד</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>התנהגות בעת שליחה</label>
          <select style={inputStyle} value={form.submitBehavior} onChange={(e) => setField('submitBehavior', e.target.value)}>
            <option value="none">שמירת מענה בלבד</option>
            <option value="create_new_participant">יצירת משתתפת חדשה</option>
            <option value="attach_or_create">שיוך / יצירה</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>תצוגת מילוי (חיצוני)</label>
          <select style={inputStyle} value={form.displayMode} onChange={(e) => setField('displayMode', e.target.value)}>
            <option value="step_by_step">שאלה אחת בכל פעם</option>
            <option value="full_list">כל השאלות ברצף</option>
          </select>
        </div>
      </div>

      <div>
        <label style={labelStyle}>טקסט פתיחה (אופציונלי)</label>
        <RichTextEditor
          value={form.introRichText}
          onChange={(html) => setField('introRichText', html)}
          placeholder="הכניסי טקסט הסבר שיופיע בתחילת השאלון..."
        />
      </div>

      <div>
        <label style={labelStyle}>ברכה אישית לאחר זיהוי (ציבורי בלבד)</label>
        {/* Helper buttons row */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => insertIntoGreeting('{firstName}')}
            style={{ background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'monospace' }}
          >
            + &#123;firstName&#125;
          </button>
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setShowEmoji((v) => !v)}
              style={{ background: showEmoji ? '#fef9c3' : '#f8fafc', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 6, padding: '4px 10px', fontSize: 13, cursor: 'pointer' }}
            >
              😊 אימוג&apos;י
            </button>
            {showEmoji && (
              <div
                style={{ position: 'absolute', top: 'calc(100% + 4px)', right: 0, background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 8, display: 'flex', gap: 4, flexWrap: 'wrap', width: 220, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 200 }}
              >
                {EMOJI_SHORTCUTS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => { insertIntoGreeting(emoji); setShowEmoji(false); }}
                    style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', padding: '2px 4px', borderRadius: 4, lineHeight: 1 }}
                    title={emoji}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>
          <span style={{ fontSize: 11, color: '#94a3b8', marginRight: 'auto' }}>לחצי על הכפתורים להכנסת טקסט בעמדת הסמן</span>
        </div>
        <textarea
          ref={greetingRef}
          rows={2}
          style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
          value={form.postIdentificationGreeting}
          onChange={(e) => setField('postIdentificationGreeting', e.target.value)}
          placeholder='היי {firstName} 😊 נעבור לכמה שאלות קצרות:'
          onClick={() => setShowEmoji(false)}
        />
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 5 }}>
          מוצג לאחר שהממלאת מזינה מספר טלפון מוכר. ריק = ברירת מחדל אוטומטית.
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <label style={{ ...labelStyle, margin: 0 }}>שאלון פעיל</label>
        <input
          type="checkbox"
          checked={form.isActive}
          onChange={(e) => setField('isActive', e.target.checked)}
          style={{ width: 16, height: 16, cursor: 'pointer' }}
        />
      </div>

      {error && <div style={{ color: '#dc2626', fontSize: 13, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '8px 12px' }}>{error}</div>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <SaveBtn saving={saving} onClick={handleSave} />
        {saved && <span style={{ color: '#16a34a', fontSize: 13 }}>✓ נשמר</span>}
      </div>
    </div>
  );
}

// ─── TAB 2: Questions ─────────────────────────────────────────────────────────

interface QuestionFormState {
  label: string;
  internalKey: string;
  questionType: string;
  helperText: string;
  isRequired: boolean;
  allowOther: boolean;
  fieldSize: string;
}

const EMPTY_Q_FORM: QuestionFormState = {
  label: '',
  internalKey: '',
  questionType: 'text',
  helperText: '',
  isRequired: false,
  allowOther: false,
  fieldSize: 'sm',
};

// Converts any label to a safe ASCII snake_case key (never Hebrew)
function slugifyLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[\s\-–—]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')   // strip anything that isn't ASCII alphanumeric or _
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

// Returns a unique key for a new/edited question
// Falls back to question_N if slugify yields nothing
function generateUniqueKey(label: string, existingKeys: string[], fallbackIndex: number): string {
  let base = slugifyLabel(label);
  if (!base) base = `question_${fallbackIndex}`;

  let candidate = base;
  let counter = 2;
  while (existingKeys.includes(candidate)) {
    candidate = `${base}_${counter}`;
    counter++;
  }
  return candidate;
}

// ─── Inline options editor for use inside QuestionModal ──────────────────────

// For edit mode: calls real API immediately.
// For add mode (no questionId): manages a local pending list.
function ModalOptionsEditor({
  templateId,
  questionId,
  options,
  onOptionsChange,
}: {
  templateId: string;
  questionId: string | null;  // null = new question, not yet saved
  options: { id: string; label: string }[];
  onOptionsChange: (opts: { id: string; label: string }[]) => void;
}) {
  const [newLabel, setNewLabel] = useState('');
  const [adding, setAdding] = useState(false);

  async function addOption() {
    if (!newLabel.trim()) return;
    setAdding(true);
    try {
      if (questionId) {
        // Edit mode — persist immediately
        const opt = await apiFetch(`${BASE_URL}/questionnaires/${templateId}/questions/${questionId}/options`, {
          method: 'POST',
          body: JSON.stringify({ label: newLabel.trim(), value: newLabel.trim() }),
        }) as { id: string; label: string };
        onOptionsChange([...options, opt]);
      } else {
        // Add mode — local pending list with temp id
        const tempId = `__pending_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        onOptionsChange([...options, { id: tempId, label: newLabel.trim() }]);
      }
      setNewLabel('');
    } finally { setAdding(false); }
  }

  async function removeOption(optId: string) {
    if (questionId && !optId.startsWith('__pending_')) {
      await apiFetch(
        `${BASE_URL}/questionnaires/${templateId}/questions/${questionId}/options/${optId}`,
        { method: 'DELETE' },
      );
    }
    onOptionsChange(options.filter((o) => o.id !== optId));
  }

  return (
    <div style={{ marginTop: 4, padding: '10px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 8 }}>
        אפשרויות ({options.length})
        {!questionId && options.length > 0 && (
          <span style={{ fontWeight: 400, color: '#94a3b8', marginRight: 6 }}>· יישמרו עם השאלה</span>
        )}
      </div>
      {options.map((opt) => (
        <div key={opt.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
          <span style={{ flex: 1, fontSize: 13, color: '#374151' }}>⚪ {opt.label}</span>
          <button
            type="button"
            onClick={() => removeOption(opt.id)}
            style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 4px' }}
          >×</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <input
          style={{ ...inputStyle, flex: 1, padding: '6px 10px', fontSize: 13 }}
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="אפשרות חדשה..."
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addOption(); } }}
        />
        <button
          type="button"
          onClick={addOption}
          disabled={adding}
          style={{ background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe', borderRadius: 7, padding: '6px 12px', fontSize: 13, cursor: 'pointer' }}
        >
          + הוסף
        </button>
      </div>
    </div>
  );
}

function QuestionModal({
  title,
  initial,
  existingKeys,
  questionId,
  initialOptions,
  templateId,
  onSave,
  onClose,
}: {
  title: string;
  initial: QuestionFormState;
  existingKeys: string[];
  questionId?: string;       // only for edit mode
  initialOptions?: { id: string; label: string }[];  // only for edit mode
  templateId: string;
  onSave: (form: QuestionFormState, pendingOptions: { label: string }[]) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<QuestionFormState>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Options state (for modal-inline editing)
  const [modalOptions, setModalOptions] = useState<{ id: string; label: string }[]>(initialOptions ?? []);
  // Track whether admin has manually overridden the key
  const [keyManuallySet, setKeyManuallySet] = useState(!!initial.internalKey);

  function setField(field: keyof QuestionFormState, value: string | boolean) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleLabelChange(value: string) {
    if (keyManuallySet) {
      // Key was manually edited — don't override it
      setForm((prev) => ({ ...prev, label: value }));
    } else {
      const autoKey = generateUniqueKey(value, existingKeys, existingKeys.length + 1);
      setForm((prev) => ({
        ...prev,
        label: value,
        internalKey: autoKey,
        // Also auto-set fieldSize when switching to a type that has a default
        fieldSize: prev.fieldSize || defaultFieldSize(prev.questionType),
      }));
    }
  }

  function handleTypeChange(newType: string) {
    setForm((prev) => ({
      ...prev,
      questionType: newType,
      // Auto-update fieldSize only if it matches the old default (not manually set)
      fieldSize: prev.fieldSize === defaultFieldSize(prev.questionType)
        ? defaultFieldSize(newType)
        : prev.fieldSize,
    }));
  }

  async function handleSave() {
    if (!form.label.trim()) { setError('תווית השאלה היא שדה חובה'); return; }
    const finalKey = form.internalKey.trim() || generateUniqueKey(form.label, existingKeys, existingKeys.length + 1);
    const finalForm: QuestionFormState = { ...form, internalKey: finalKey };
    // Pending options: only those with temp ids (add mode)
    const pending = modalOptions
      .filter((o) => o.id.startsWith('__pending_'))
      .map((o) => ({ label: o.label }));
    setError('');
    setSaving(true);
    try { await onSave(finalForm, pending); }
    catch { setError('שגיאה בשמירה'); }
    finally { setSaving(false); }
  }

  const showAllowOther = OPTION_TYPES.includes(form.questionType);
  const showOptionsEditor = OPTION_TYPES.includes(form.questionType);
  const previewKey = form.internalKey || generateUniqueKey(form.label, existingKeys, existingKeys.length + 1);

  return (
    <Modal title={title} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={labelStyle}>תווית שאלה *</label>
          <input
            style={inputStyle}
            value={form.label}
            onChange={(e) => handleLabelChange(e.target.value)}
            autoFocus
          />
        </div>
        <div>
          <label style={labelStyle}>סוג שאלה</label>
          <select style={inputStyle} value={form.questionType} onChange={(e) => handleTypeChange(e.target.value)}>
            {Object.entries(QUESTION_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>טקסט עזר (אופציונלי)</label>
          <input style={inputStyle} value={form.helperText} onChange={(e) => setField('helperText', e.target.value)} placeholder="הסבר קצר שיופיע מתחת לשאלה" />
        </div>
        {form.questionType !== 'static_text' && (
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#374151', cursor: 'pointer' }}>
              <input type="checkbox" checked={form.isRequired} onChange={(e) => setField('isRequired', e.target.checked)} />
              חובה
            </label>
            {showAllowOther && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#374151', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.allowOther} onChange={(e) => setField('allowOther', e.target.checked)} />
                אפשר &quot;אחר&quot;
              </label>
            )}
          </div>
        )}

        {/* Options editor — shown immediately when type is choice/multi/dropdown */}
        {showOptionsEditor && (
          <ModalOptionsEditor
            templateId={templateId}
            questionId={questionId ?? null}
            options={modalOptions}
            onOptionsChange={setModalOptions}
          />
        )}

        {/* Advanced settings */}
        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 12, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
          >
            {showAdvanced ? '▲ הסתר הגדרות מתקדמות' : '▼ הגדרות מתקדמות'}
          </button>
          {showAdvanced && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10, padding: '10px 12px', background: '#f8fafc', borderRadius: 7, border: '1px solid #e2e8f0' }}>
              <div>
                <label style={{ ...labelStyle, fontWeight: 400, fontSize: 12, color: '#64748b' }}>מפתח פנימי (ASCII בלבד)</label>
                <input
                  style={{ ...inputStyle, direction: 'ltr', fontSize: 13, color: '#475569' }}
                  value={form.internalKey || previewKey}
                  onChange={(e) => {
                    setKeyManuallySet(true);
                    setField('internalKey', e.target.value.replace(/[^a-z0-9_]/g, ''));
                  }}
                  placeholder="auto_generated"
                />
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>
                  {keyManuallySet ? 'מפתח מוגדר ידנית' : `יווצר אוטומטית: ${previewKey}`}
                </div>
              </div>
              <div>
                <label style={{ ...labelStyle, fontWeight: 400, fontSize: 12, color: '#64748b' }}>גודל שדה</label>
                <select
                  style={{ ...inputStyle, fontSize: 13 }}
                  value={form.fieldSize || defaultFieldSize(form.questionType)}
                  onChange={(e) => setField('fieldSize', e.target.value)}
                >
                  <option value="sm">קטן (שורה אחת)</option>
                  <option value="md">בינוני</option>
                  <option value="lg">גדול (טקסט ארוך)</option>
                </select>
              </div>
            </div>
          )}
        </div>

        {error && <div style={{ color: '#dc2626', fontSize: 13 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>ביטול</button>
          <SaveBtn saving={saving} onClick={handleSave} />
        </div>
      </div>
    </Modal>
  );
}

function OptionsPanel({ templateId, question, onChange }: { templateId: string; question: Question; onChange: (q: Question) => void }) {
  const [newLabel, setNewLabel] = useState('');
  const [adding, setAdding] = useState(false);

  async function addOption() {
    if (!newLabel.trim()) return;
    setAdding(true);
    try {
      const opt = await apiFetch(`${BASE_URL}/questionnaires/${templateId}/questions/${question.id}/options`, {
        method: 'POST',
        body: JSON.stringify({ label: newLabel.trim(), value: newLabel.trim() }),
      }) as QuestionOption;
      onChange({ ...question, options: [...question.options, opt] });
      setNewLabel('');
    } finally { setAdding(false); }
  }

  async function deleteOption(optId: string) {
    await apiFetch(`${BASE_URL}/questionnaires/${templateId}/questions/${question.id}/options/${optId}`, { method: 'DELETE' });
    onChange({ ...question, options: question.options.filter((o) => o.id !== optId) });
  }

  return (
    <div style={{ marginTop: 8, paddingRight: 16, borderRight: '3px solid #e0e7ff' }}>
      {question.options.map((opt) => (
        <div key={opt.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
          <span style={{ flex: 1, fontSize: 13, color: '#374151' }}>⚪ {opt.label}</span>
          <button
            onClick={() => deleteOption(opt.id)}
            style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 4px' }}
            title="מחק אפשרות"
          >×</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <input
          style={{ ...inputStyle, flex: 1, padding: '6px 10px', fontSize: 13 }}
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="אפשרות חדשה..."
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addOption(); } }}
        />
        <button
          onClick={addOption}
          disabled={adding}
          style={{ background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe', borderRadius: 7, padding: '6px 12px', fontSize: 13, cursor: 'pointer' }}
        >
          + הוסף
        </button>
      </div>
    </div>
  );
}

// ─── System fields definition ─────────────────────────────────────────────────

interface SystemFieldDef {
  key: string;
  defaultLabel: string;
  questionType: string;
  description: string;
}

const SYSTEM_FIELDS: SystemFieldDef[] = [
  { key: 'first_name',   defaultLabel: 'שם פרטי',      questionType: 'text',  description: 'שם פרטי של המשתתפת' },
  { key: 'last_name',    defaultLabel: 'שם משפחה',     questionType: 'text',  description: 'שם משפחה' },
  { key: 'phone_number', defaultLabel: 'מספר טלפון',   questionType: 'phone', description: 'מספר הטלפון — ישמש לזיהוי וקישור' },
  { key: 'email',        defaultLabel: 'כתובת מייל',   questionType: 'email', description: 'כתובת דוא"ל' },
  { key: 'birth_date',   defaultLabel: 'תאריך לידה',   questionType: 'date',  description: 'תאריך לידה — לחישוב גיל' },
  { key: 'city',         defaultLabel: 'עיר מגורים',   questionType: 'text',  description: 'עיר / ישוב' },
];

function SystemFieldModal({
  existingSystemKeys,
  onSave,
  onClose,
}: {
  existingSystemKeys: string[];
  onSave: (field: SystemFieldDef, customLabel: string, isRequired: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const available = SYSTEM_FIELDS.filter((f) => !existingSystemKeys.includes(f.key));
  const [selected, setSelected] = useState<SystemFieldDef | null>(available[0] ?? null);
  const [label, setLabel] = useState(available[0]?.defaultLabel ?? '');
  const [isRequired, setIsRequired] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function handleSelect(f: SystemFieldDef) {
    setSelected(f);
    setLabel(f.defaultLabel);
    setError('');
  }

  async function handleSave() {
    if (!selected) { setError('יש לבחור שדה מערכת'); return; }
    if (!label.trim()) { setError('תווית השאלה היא שדה חובה'); return; }
    setSaving(true);
    try { await onSave(selected, label.trim(), isRequired); }
    catch { setError('שגיאה בשמירה'); }
    finally { setSaving(false); }
  }

  return (
    <Modal title="הוסף שדה מערכת" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {available.length === 0 && (
          <div style={{ color: '#64748b', fontSize: 14, textAlign: 'center', padding: '16px 0' }}>כל שדות המערכת כבר נוספו לשאלון זה</div>
        )}
        {available.length > 0 && (
          <>
            <div>
              <label style={labelStyle}>שדה מערכת</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {available.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => handleSelect(f)}
                    style={{
                      textAlign: 'right',
                      padding: '10px 14px',
                      border: `1.5px solid ${selected?.key === f.key ? '#2563eb' : '#e2e8f0'}`,
                      borderRadius: 8,
                      background: selected?.key === f.key ? '#eff6ff' : '#ffffff',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    <div style={{ fontSize: 14, fontWeight: 600, color: selected?.key === f.key ? '#1d4ed8' : '#0f172a' }}>{f.defaultLabel}</div>
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{f.description}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2, direction: 'ltr', textAlign: 'left' }}>{f.key}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label style={labelStyle}>תווית שאלה (ניתן לשנות)</label>
              <input style={inputStyle} value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#374151', cursor: 'pointer' }}>
              <input type="checkbox" checked={isRequired} onChange={(e) => setIsRequired(e.target.checked)} />
              שדה חובה
            </label>

            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 12px', fontSize: 12, color: '#92400e' }}>
              🔒 המפתח הפנימי ({selected?.key}) הוא קבוע ואינו ניתן לשינוי. הוא משמש לזיהוי אוטומטי ולקישור לפרופיל המשתתפת.
            </div>

            {error && <div style={{ color: '#dc2626', fontSize: 13 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={onClose} style={{ background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>ביטול</button>
              <SaveBtn saving={saving} onClick={handleSave} label="הוסף שדה" />
            </div>
          </>
        )}
        {available.length === 0 && (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={onClose} style={{ background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>סגור</button>
          </div>
        )}
      </div>
    </Modal>
  );
}

function QuestionsTab({ template, onTemplateChange }: { template: Template; onTemplateChange: (t: Template) => void }) {
  const [questions, setQuestions] = useState<Question[]>(template.questions ?? []);
  const [expandedOptions, setExpandedOptions] = useState<Set<string>>(new Set());
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [systemFieldModalOpen, setSystemFieldModalOpen] = useState(false);
  const [editModal, setEditModal] = useState<Question | null>(null);
  const [inlineEditing, setInlineEditing] = useState<string | null>(null);
  const [inlineValue, setInlineValue] = useState('');
  const inlineRef = useRef<HTMLInputElement>(null);
  const [confirmDelete, setConfirmDelete] = useState<Question | null>(null);
  const dragIdx = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  function updateQuestions(qs: Question[]) {
    setQuestions(qs);
    onTemplateChange({ ...template, questions: qs });
  }

  async function toggleRequired(q: Question) {
    await apiFetch(`${BASE_URL}/questionnaires/${template.id}/questions/${q.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isRequired: !q.isRequired }),
    });
    updateQuestions(questions.map((x) => x.id === q.id ? { ...x, isRequired: !x.isRequired } : x));
  }

  async function toggleAllowOther(q: Question) {
    await apiFetch(`${BASE_URL}/questionnaires/${template.id}/questions/${q.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ allowOther: !q.allowOther }),
    });
    updateQuestions(questions.map((x) => x.id === q.id ? { ...x, allowOther: !x.allowOther } : x));
  }

  async function confirmDeleteQuestion(q: Question) {
    await apiFetch(`${BASE_URL}/questionnaires/${template.id}/questions/${q.id}`, { method: 'DELETE' });
    updateQuestions(questions.filter((x) => x.id !== q.id));
    setConfirmDelete(null);
  }

  function handleDragStart(idx: number) {
    dragIdx.current = idx;
  }

  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    setDragOverIdx(idx);
  }

  async function handleDrop(idx: number) {
    const from = dragIdx.current;
    dragIdx.current = null;
    setDragOverIdx(null);
    if (from === null || from === idx) return;
    const reordered = [...questions];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(idx, 0, moved);
    const items = reordered.map((x, i) => ({ id: x.id, sortOrder: (i + 1) * 10 }));
    updateQuestions(reordered.map((x, i) => ({ ...x, sortOrder: (i + 1) * 10 })));
    await apiFetch(`${BASE_URL}/questionnaires/${template.id}/questions/reorder`, {
      method: 'POST',
      body: JSON.stringify({ items }),
    });
  }

  function handleDragEnd() {
    dragIdx.current = null;
    setDragOverIdx(null);
  }

  function startInlineEdit(q: Question) {
    setInlineEditing(q.id);
    setInlineValue(q.label);
    setTimeout(() => inlineRef.current?.focus(), 50);
  }

  async function commitInlineEdit(q: Question) {
    setInlineEditing(null);
    if (!inlineValue.trim() || inlineValue === q.label) return;
    await apiFetch(`${BASE_URL}/questionnaires/${template.id}/questions/${q.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ label: inlineValue.trim() }),
    });
    updateQuestions(questions.map((x) => x.id === q.id ? { ...x, label: inlineValue.trim() } : x));
  }

  async function handleAddQuestion(form: QuestionFormState, pendingOptions: { label: string }[]) {
    const q = await apiFetch(`${BASE_URL}/questionnaires/${template.id}/questions`, {
      method: 'POST',
      body: JSON.stringify({
        ...form,
        helperText: form.helperText || undefined,
        fieldSize: form.fieldSize || defaultFieldSize(form.questionType),
      }),
    }) as Question;
    // Flush any pending options that were added inside the modal before save
    let finalOptions: QuestionOption[] = q.options ?? [];
    if (pendingOptions.length > 0) {
      for (const opt of pendingOptions) {
        try {
          const created = await apiFetch(`${BASE_URL}/questionnaires/${template.id}/questions/${q.id}/options`, {
            method: 'POST',
            body: JSON.stringify({ label: opt.label, value: opt.label }),
          }) as QuestionOption;
          finalOptions = [...finalOptions, created];
        } catch { /* skip failed option */ }
      }
    }
    updateQuestions([...questions, { ...q, options: finalOptions }]);
    setAddModalOpen(false);
  }

  async function handleAddSystemField(field: SystemFieldDef, customLabel: string, isRequired: boolean) {
    const q = await apiFetch(`${BASE_URL}/questionnaires/${template.id}/questions`, {
      method: 'POST',
      body: JSON.stringify({
        label: customLabel,
        internalKey: field.key,
        questionType: field.questionType,
        isRequired,
        isSystemField: true,
        fieldSize: defaultFieldSize(field.questionType),
      }),
    }) as Question;
    updateQuestions([...questions, q]);
    setSystemFieldModalOpen(false);
  }

  const existingSystemKeys = questions.filter((q) => q.isSystemField).map((q) => q.internalKey);

  async function handleEditQuestion(form: QuestionFormState) {
    if (!editModal) return;
    const updated = await apiFetch(`${BASE_URL}/questionnaires/${template.id}/questions/${editModal.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        ...form,
        helperText: form.helperText || undefined,
        fieldSize: form.fieldSize || defaultFieldSize(form.questionType),
      }),
    }) as Question;
    // Re-fetch fresh options from API (edit modal manages them live, so just use current state)
    const currentQuestion = questions.find((x) => x.id === editModal.id);
    updateQuestions(questions.map((x) => x.id === updated.id ? { ...updated, options: currentQuestion?.options ?? x.options } : x));
    setEditModal(null);
  }

  function toggleOptionsPanel(qId: string) {
    setExpandedOptions((prev) => {
      const next = new Set(prev);
      next.has(qId) ? next.delete(qId) : next.add(qId);
      return next;
    });
  }

  const hasOptions = (q: Question) => OPTION_TYPES.includes(q.questionType);
  const existingKeys = questions.map((q) => q.internalKey);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 10 }}>
        <span style={{ fontSize: 13, color: '#64748b', fontWeight: 500 }}>{questions.length} שאלות</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setSystemFieldModalOpen(true)}
            style={{ background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0', borderRadius: 7, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            🔒 הוסף שדה מערכת
          </button>
          <button
            onClick={() => setAddModalOpen(true)}
            style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 7, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            + הוסף שאלה
          </button>
        </div>
      </div>

      {questions.length === 0 && (
        <div style={{ padding: '40px 24px', textAlign: 'center', border: '2px dashed #e2e8f0', borderRadius: 10, color: '#94a3b8', fontSize: 14 }}>
          אין שאלות עדיין — לחצי &quot;הוסף שאלה&quot; להתחלה
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {questions.map((q, idx) => (
          <div
            key={q.id}
            draggable
            onDragStart={() => handleDragStart(idx)}
            onDragOver={(e) => handleDragOver(e, idx)}
            onDrop={() => handleDrop(idx)}
            onDragEnd={handleDragEnd}
            style={{
              border: `1px solid ${dragOverIdx === idx ? '#2563eb' : '#e2e8f0'}`,
              borderRadius: 10,
              overflow: 'hidden',
              background: '#ffffff',
              opacity: dragIdx.current === idx ? 0.5 : 1,
              transition: 'border-color 0.15s',
            }}
          >
            {/* Question row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', flexWrap: 'wrap' }}>
              {/* Drag handle */}
              <span
                title="גרור לשינוי סדר"
                style={{ fontSize: 16, color: '#cbd5e1', cursor: 'grab', userSelect: 'none', lineHeight: 1, padding: '0 2px' }}
              >⠿</span>
              {/* Sort order indicator */}
              <span style={{ fontSize: 12, color: '#94a3b8', minWidth: 20, textAlign: 'center', fontWeight: 600 }}>{idx + 1}</span>

              {/* Inline editable label */}
              {inlineEditing === q.id ? (
                <input
                  ref={inlineRef}
                  style={{ ...inputStyle, flex: 1, minWidth: 120, padding: '5px 8px', fontSize: 14, fontWeight: 500 }}
                  value={inlineValue}
                  onChange={(e) => setInlineValue(e.target.value)}
                  onBlur={() => commitInlineEdit(q)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitInlineEdit(q);
                    if (e.key === 'Escape') setInlineEditing(null);
                  }}
                />
              ) : (
                <span
                  onClick={() => startInlineEdit(q)}
                  title="לחצי לעריכת הכותרת"
                  style={{ flex: 1, fontSize: 14, fontWeight: 500, color: '#0f172a', cursor: 'text', minWidth: 120, padding: '5px 0' }}
                >
                  {q.label}
                  {q.isRequired && <span style={{ color: '#dc2626', marginRight: 4 }}>*</span>}
                </span>
              )}

              {/* Type badge */}
              <span style={{ background: '#f1f5f9', color: '#475569', fontSize: 12, padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap' }}>
                {QUESTION_TYPE_LABELS[q.questionType] ?? q.questionType}
              </span>

              {/* System field badge */}
              {q.isSystemField && (
                <span style={{ background: '#f0fdf4', color: '#15803d', fontSize: 11, padding: '3px 8px', borderRadius: 20, whiteSpace: 'nowrap', border: '1px solid #bbf7d0' }} title={`מפתח: ${q.internalKey}`}>
                  🔒 {q.internalKey}
                </span>
              )}

              {/* Required toggle */}
              <label title="חובה" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#64748b', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={q.isRequired} onChange={() => toggleRequired(q)} style={{ cursor: 'pointer' }} />
                חובה
              </label>

              {/* allowOther toggle — only for choice/multi */}
              {hasOptions(q) && (
                <label title="אפשר אחר" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#64748b', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  <input type="checkbox" checked={q.allowOther} onChange={() => toggleAllowOther(q)} style={{ cursor: 'pointer' }} />
                  אחר
                </label>
              )}

              {/* Options toggle */}
              {hasOptions(q) && (
                <button
                  onClick={() => toggleOptionsPanel(q.id)}
                  style={{ background: expandedOptions.has(q.id) ? '#eff6ff' : '#f8fafc', color: '#2563eb', border: '1px solid #bfdbfe', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}
                >
                  {expandedOptions.has(q.id) ? '▲ אפשרויות' : '▼ אפשרויות'} ({q.options.length})
                </button>
              )}

              {/* Edit full */}
              <button
                onClick={() => setEditModal(q)}
                style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: 6, padding: '4px 10px', fontSize: 12, color: '#64748b', cursor: 'pointer' }}
              >
                עריכה
              </button>

              {/* Delete */}
              <button
                onClick={() => setConfirmDelete(q)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 4px' }}
                title="מחק שאלה"
              >×</button>
            </div>

            {/* Options panel */}
            {hasOptions(q) && expandedOptions.has(q.id) && (
              <div style={{ padding: '0 16px 14px 16px', borderTop: '1px solid #f1f5f9' }}>
                <OptionsPanel
                  templateId={template.id}
                  question={q}
                  onChange={(updated) => updateQuestions(questions.map((x) => x.id === updated.id ? updated : x))}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {systemFieldModalOpen && (
        <SystemFieldModal
          existingSystemKeys={existingSystemKeys}
          onSave={handleAddSystemField}
          onClose={() => setSystemFieldModalOpen(false)}
        />
      )}

      {addModalOpen && (
        <QuestionModal
          title="שאלה חדשה"
          initial={{ ...EMPTY_Q_FORM, fieldSize: defaultFieldSize('text') }}
          existingKeys={existingKeys}
          templateId={template.id}
          onSave={handleAddQuestion}
          onClose={() => setAddModalOpen(false)}
        />
      )}

      {editModal && (
        <QuestionModal
          title="עריכת שאלה"
          initial={{
            label: editModal.label,
            internalKey: editModal.internalKey,
            questionType: editModal.questionType,
            helperText: editModal.helperText ?? '',
            isRequired: editModal.isRequired,
            allowOther: editModal.allowOther,
            fieldSize: editModal.fieldSize ?? defaultFieldSize(editModal.questionType),
          }}
          existingKeys={existingKeys.filter((k) => k !== editModal.internalKey)}
          templateId={template.id}
          questionId={editModal.id}
          initialOptions={editModal.options.map((o) => ({ id: o.id, label: o.label }))}
          onSave={(form) => handleEditQuestion(form)}
          onClose={() => setEditModal(null)}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title="מחיקת שאלה"
          message={`השאלה "${confirmDelete.label}" תוסר מהשאלון. תשובות קיימות לא יימחקו.`}
          confirmLabel="מחק שאלה"
          danger
          onConfirm={() => confirmDeleteQuestion(confirmDelete)}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

// ─── TAB 3: Links ─────────────────────────────────────────────────────────────

const WEB_BASE = typeof window !== 'undefined'
  ? window.location.origin
  : 'http://localhost:3000';

interface LinkFormState {
  internalName: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string;
  utmTerm: string;
}

const EMPTY_LINK_FORM: LinkFormState = {
  internalName: '',
  utmSource: '',
  utmMedium: '',
  utmCampaign: '',
  utmContent: '',
  utmTerm: '',
};

function LinksTab({ template }: { template: Template }) {
  const [links, setLinks] = useState<ExternalLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<LinkFormState>(EMPTY_LINK_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [confirmDeleteLink, setConfirmDeleteLink] = useState<ExternalLink | null>(null);

  useEffect(() => {
    apiFetch(`${BASE_URL}/questionnaires/${template.id}/links`, { cache: 'no-store' })
      .then((data: unknown) => setLinks(data as ExternalLink[]))
      .catch(() => setLinks([]))
      .finally(() => setLoading(false));
  }, [template.id]);

  function setField(field: keyof LinkFormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.internalName.trim()) { setFormError('שם פנימי הוא שדה חובה'); return; }
    setFormError('');
    setSaving(true);
    try {
      const link = await apiFetch(`${BASE_URL}/questionnaires/${template.id}/links`, {
        method: 'POST',
        body: JSON.stringify({
          internalName: form.internalName,
          ...(form.utmSource && { utmSource: form.utmSource }),
          ...(form.utmMedium && { utmMedium: form.utmMedium }),
          ...(form.utmCampaign && { utmCampaign: form.utmCampaign }),
          ...(form.utmContent && { utmContent: form.utmContent }),
          ...(form.utmTerm && { utmTerm: form.utmTerm }),
        }),
      }) as ExternalLink;
      setLinks((prev) => [link, ...prev]);
      setModalOpen(false);
      setForm(EMPTY_LINK_FORM);
    } finally { setSaving(false); }
  }

  async function toggleActive(link: ExternalLink) {
    await apiFetch(`${BASE_URL}/questionnaires/${template.id}/links/${link.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: !link.isActive }),
    });
    setLinks((prev) => prev.map((l) => l.id === link.id ? { ...l, isActive: !l.isActive } : l));
  }

  async function confirmDeleteLinkFn(link: ExternalLink) {
    // Soft delete — isActive: false. Submissions referencing this link remain intact.
    await apiFetch(`${BASE_URL}/questionnaires/${template.id}/links/${link.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: false }),
    });
    setLinks((prev) => prev.filter((l) => l.id !== link.id));
    setConfirmDeleteLink(null);
  }

  function copyUrl(token: string) {
    const url = `${WEB_BASE}/fill/${token}`;
    navigator.clipboard.writeText(url);
    setCopied(token);
    setTimeout(() => setCopied(null), 2000);
  }

  if (template.usageType === 'internal') {
    return (
      <div style={{ padding: '40px 24px', textAlign: 'center', border: '2px dashed #e2e8f0', borderRadius: 10, color: '#64748b', fontSize: 14 }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🔒</div>
        <div style={{ fontWeight: 600, color: '#374151', fontSize: 15, marginBottom: 6 }}>שאלון פנימי בלבד</div>
        <div>שאלון זה מוגדר לשימוש פנימי בלבד — לא ניתן ליצור עבורו לינקים חיצוניים.</div>
        <div style={{ marginTop: 8, fontSize: 13, color: '#94a3b8' }}>שנה את סוג השאלון ל&quot;שניהם&quot; או &quot;חיצוני&quot; בלשונית ההגדרות כדי לאפשר לינקים.</div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ fontSize: 13, color: '#64748b', fontWeight: 500 }}>
          {loading ? 'טוען...' : `${links.length} לינקים`}
        </span>
        <button
          onClick={() => { setForm(EMPTY_LINK_FORM); setFormError(''); setModalOpen(true); }}
          style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 7, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          + צור לינק
        </button>
      </div>

      {!loading && links.length === 0 && (
        <div style={{ padding: '40px 24px', textAlign: 'center', border: '2px dashed #e2e8f0', borderRadius: 10, color: '#94a3b8', fontSize: 14 }}>
          אין לינקים עדיין — צרי לינק חדש לשיתוף חיצוני
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {links.map((link) => {
          const publicUrl = `${WEB_BASE}/fill/${link.slugOrToken}`;
          const utms = [link.utmSource, link.utmMedium, link.utmCampaign].filter(Boolean);
          return (
            <div key={link.id} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: '14px 16px', background: link.isActive ? '#ffffff' : '#f8fafc' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{link.internalName}</span>
                    {!link.isActive && <span style={{ background: '#f1f5f9', color: '#64748b', fontSize: 11, padding: '2px 8px', borderRadius: 20 }}>לא פעיל</span>}
                  </div>
                  <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#64748b', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 5, padding: '4px 8px', marginBottom: 6, wordBreak: 'break-all', direction: 'ltr', textAlign: 'left' }}>
                    {publicUrl}
                  </div>
                  {utms.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {link.utmSource && <span style={{ background: '#eff6ff', color: '#1d4ed8', fontSize: 11, padding: '2px 8px', borderRadius: 20 }}>src: {link.utmSource}</span>}
                      {link.utmMedium && <span style={{ background: '#f0fdf4', color: '#15803d', fontSize: 11, padding: '2px 8px', borderRadius: 20 }}>med: {link.utmMedium}</span>}
                      {link.utmCampaign && <span style={{ background: '#fdf4ff', color: '#7e22ce', fontSize: 11, padding: '2px 8px', borderRadius: 20 }}>camp: {link.utmCampaign}</span>}
                      {link.utmContent && <span style={{ background: '#fff7ed', color: '#c2410c', fontSize: 11, padding: '2px 8px', borderRadius: 20 }}>cnt: {link.utmContent}</span>}
                      {link.utmTerm && <span style={{ background: '#fefce8', color: '#854d0e', fontSize: 11, padding: '2px 8px', borderRadius: 20 }}>term: {link.utmTerm}</span>}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
                  <button
                    onClick={() => copyUrl(link.slugOrToken)}
                    style={{ background: copied === link.slugOrToken ? '#f0fdf4' : '#f1f5f9', color: copied === link.slugOrToken ? '#15803d' : '#374151', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}
                  >
                    {copied === link.slugOrToken ? '✓ הועתק' : 'העתק URL'}
                  </button>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748b', cursor: 'pointer' }}>
                    <input type="checkbox" checked={link.isActive} onChange={() => toggleActive(link)} style={{ cursor: 'pointer' }} />
                    פעיל
                  </label>
                  <button
                    onClick={() => setConfirmDeleteLink(link)}
                    title="מחק לינק"
                    style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 4px' }}
                  >×</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {modalOpen && (
        <Modal title="לינק חדש" onClose={() => setModalOpen(false)}>
          <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={labelStyle}>שם פנימי *</label>
              <input style={inputStyle} value={form.internalName} onChange={(e) => setField('internalName', e.target.value)} autoFocus placeholder="לדוגמה: פייסבוק, ניוזלטר..." />
            </div>
            <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 14 }}>
              <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600, marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>UTM Values (אופציונלי)</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {(['utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'utmTerm'] as (keyof LinkFormState)[]).map((field) => (
                  <div key={field}>
                    <label style={{ ...labelStyle, fontWeight: 400, fontSize: 12, direction: 'ltr', textAlign: 'left', display: 'block' }}>
                      {field.replace('utm', 'utm_').replace(/([A-Z])/g, (m) => m.toLowerCase())}
                    </label>
                    <input
                      style={{ ...inputStyle, direction: 'ltr', fontSize: 13, padding: '7px 10px' }}
                      value={form[field]}
                      onChange={(e) => setField(field, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            </div>
            {formError && <div style={{ color: '#dc2626', fontSize: 13 }}>{formError}</div>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setModalOpen(false)} style={{ background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>ביטול</button>
              <SaveBtn saving={saving} onClick={() => {}} label="צור לינק" />
            </div>
          </form>
        </Modal>
      )}

      {confirmDeleteLink && (
        <ConfirmModal
          title="מחיקת לינק"
          message={`הלינק "${confirmDeleteLink.internalName}" יושבת. מענים שנשלחו דרכו ישמרו.`}
          confirmLabel="מחק לינק"
          danger
          onConfirm={() => confirmDeleteLinkFn(confirmDeleteLink)}
          onClose={() => setConfirmDeleteLink(null)}
        />
      )}
    </div>
  );
}

// ─── TAB 4: Submissions ──────────────────────────────────────────────────────

interface SubmissionAnswer {
  id: string;
  value: unknown;
  questionSnapshot: { label: string; questionType: string; sortOrder?: number; internalKey?: string } | null;
  question: { label: string; questionType: string; sortOrder?: number } | null;
}

interface TemplateSubmission {
  id: string;
  createdAt: string;
  submittedByMode: string;
  participant: { id: string; firstName: string; lastName?: string | null; phoneNumber: string } | null;
  answers: SubmissionAnswer[];
}

function submissionDisplayName(sub: TemplateSubmission): string {
  if (sub.participant) {
    return [sub.participant.firstName, sub.participant.lastName].filter(Boolean).join(' ');
  }
  // Fall back to identity answers in the snapshot
  const fnAns = sub.answers?.find((a) => a.questionSnapshot?.internalKey === 'first_name' || a.questionSnapshot?.internalKey === 'firstName');
  const lnAns = sub.answers?.find((a) => a.questionSnapshot?.internalKey === 'last_name' || a.questionSnapshot?.internalKey === 'lastName');
  if (fnAns && fnAns.value != null) {
    const fn = String(fnAns.value);
    const ln = lnAns && lnAns.value != null ? String(lnAns.value) : '';
    return [fn, ln].filter(Boolean).join(' ');
  }
  return '';
}

function sortedAnswers(answers: SubmissionAnswer[]): SubmissionAnswer[] {
  return [...answers].sort((a, b) =>
    (a.questionSnapshot?.sortOrder ?? a.question?.sortOrder ?? 9999) -
    (b.questionSnapshot?.sortOrder ?? b.question?.sortOrder ?? 9999)
  );
}

function SubmissionsTab({ template }: { template: Template }) {
  const [submissions, setSubmissions] = useState<TemplateSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<TemplateSubmission | null>(null);

  useEffect(() => {
    apiFetch(`${BASE_URL}/questionnaires/${template.id}/submissions`, { cache: 'no-store' })
      .then((data: unknown) => setSubmissions(data as TemplateSubmission[]))
      .catch(() => setSubmissions([]))
      .finally(() => setLoading(false));
  }, [template.id]);

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('he-IL', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <span style={{ fontSize: 13, color: '#64748b', fontWeight: 500 }}>
          {loading ? 'טוען...' : `${submissions.length} מענים`}
        </span>
      </div>

      {!loading && submissions.length === 0 && (
        <div style={{ padding: '40px 24px', textAlign: 'center', border: '2px dashed #e2e8f0', borderRadius: 10, color: '#94a3b8', fontSize: 14 }}>
          אין מענים עדיין לשאלון זה
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {submissions.map((sub) => (
          <div
            key={sub.id}
            style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: '14px 18px', background: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', marginBottom: 4 }}>
                {(() => { const name = submissionDisplayName(sub); return name || <span style={{ color: '#94a3b8', fontWeight: 400 }}>אנונימי</span>; })()}
                {sub.participant && (
                  <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 400, marginRight: 8 }}>{sub.participant.phoneNumber}</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: '#64748b' }}>{formatDate(sub.createdAt)}</span>
                <span style={{
                  background: sub.submittedByMode === 'internal' ? '#eff6ff' : '#f0fdf4',
                  color: sub.submittedByMode === 'internal' ? '#1d4ed8' : '#15803d',
                  fontSize: 11, padding: '2px 8px', borderRadius: 20, fontWeight: 500,
                }}>
                  {sub.submittedByMode === 'internal' ? 'פנימי' : 'חיצוני'}
                </span>
                <span style={{ fontSize: 12, color: '#94a3b8' }}>{sub.answers?.length ?? 0} תשובות</span>
              </div>
            </div>
            <button
              onClick={() => setDetail(sub)}
              style={{ background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 7, padding: '6px 14px', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              צפה
            </button>
          </div>
        ))}
      </div>

      {detail && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setDetail(null); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 20 }}
        >
          <div style={{ background: '#fff', borderRadius: 14, padding: 24, width: '100%', maxWidth: 560, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>
                  {submissionDisplayName(detail) || 'אנונימי'}
                </div>
                <div style={{ fontSize: 12, color: '#94a3b8' }}>
                  {formatDate(detail.createdAt)}
                  {' · '}
                  <span style={{
                    background: detail.submittedByMode === 'internal' ? '#eff6ff' : '#f0fdf4',
                    color: detail.submittedByMode === 'internal' ? '#1d4ed8' : '#15803d',
                    padding: '1px 7px', borderRadius: 20, fontWeight: 500,
                  }}>
                    {detail.submittedByMode === 'internal' ? 'פנימי' : 'חיצוני'}
                  </span>
                </div>
              </div>
              <button onClick={() => setDetail(null)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#94a3b8' }}>×</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {sortedAnswers(detail.answers ?? []).map((ans) => {
                const label = ans.questionSnapshot?.label ?? ans.question?.label ?? '—';
                const raw = ans.value;
                const display = Array.isArray(raw) ? raw.join(', ') : raw != null ? String(raw) : '—';
                return (
                  <div key={ans.id} style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: 12 }}>
                    <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 500, marginBottom: 4 }}>{label}</div>
                    <div style={{ fontSize: 14, color: '#0f172a', lineHeight: 1.5 }}>{display || '—'}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const VALID_TABS: TabKey[] = ['settings', 'questions', 'links', 'submissions'];

export default function TemplateEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();

  const [template, setTemplate] = useState<Template | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [confirmDeleteTemplate, setConfirmDeleteTemplate] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const rawTab = searchParams.get('tab') as TabKey | null;
  const [activeTab, setActiveTab] = useState<TabKey>(
    rawTab && VALID_TABS.includes(rawTab) ? rawTab : 'questions'
  );

  function switchTab(tab: TabKey) {
    setActiveTab(tab);
    router.replace(`/questionnaires/${id}?tab=${tab}`);
  }

  async function handleDeleteTemplate() {
    setDeleting(true);
    try {
      await apiFetch(`${BASE_URL}/questionnaires/${id}`, { method: 'DELETE' });
      router.push('/questionnaires');
    } finally {
      setDeleting(false);
    }
  }

  useEffect(() => {
    apiFetch(`${BASE_URL}/questionnaires/${id}`, { cache: 'no-store' })
      .then((data: unknown) => {
        const t = data as Template;
        setTemplate({ ...t, questions: t.questions ?? [] });
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'settings', label: 'הגדרות' },
    { key: 'questions', label: 'שאלות' },
    { key: 'links', label: 'לינקים' },
    { key: 'submissions', label: 'תגובות' },
  ];

  if (loading) return <div className="page-wrapper" style={{ color: '#94a3b8', paddingTop: 60, textAlign: 'center' }}>טוען...</div>;
  if (notFound || !template) return (
    <div className="page-wrapper" style={{ textAlign: 'center', paddingTop: 60 }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>😕</div>
      <div style={{ color: '#374151', fontSize: 16, fontWeight: 500, marginBottom: 12 }}>שאלון לא נמצא</div>
      <Link href="/questionnaires" style={{ color: '#2563eb', fontSize: 14 }}>← חזרה לרשימה</Link>
    </div>
  );

  return (
    <div className="page-wrapper" style={{ maxWidth: 900, margin: '0 auto' }}>
      {/* Back + header */}
      <Link href="/questionnaires" style={{ color: '#64748b', fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 16 }}>
        → חזרה לשאלונים
      </Link>
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', margin: 0 }}>{template.internalName}</h1>
            {!template.isActive && (
              <span style={{ background: '#fef2f2', color: '#dc2626', fontSize: 12, padding: '3px 10px', borderRadius: 20, fontWeight: 500 }}>לא פעיל</span>
            )}
          </div>
          <button
            onClick={() => setConfirmDeleteTemplate(true)}
            style={{ background: 'none', border: '1px solid #fecaca', color: '#dc2626', borderRadius: 7, padding: '6px 14px', fontSize: 13, cursor: 'pointer' }}
          >
            מחק שאלון
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <Link
            href={`/questionnaires/${id}/fill`}
            style={{ background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe', borderRadius: 7, padding: '6px 14px', fontSize: 13, fontWeight: 500 }}
          >
            ✏️ מלא שאלון (פנימי)
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px 10px 0 0', overflow: 'hidden', marginBottom: 0 }}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => switchTab(tab.key)}
            style={{
              flex: 1,
              padding: '13px 8px',
              border: 'none',
              borderBottom: activeTab === tab.key ? '2px solid #2563eb' : '2px solid transparent',
              background: 'transparent',
              color: activeTab === tab.key ? '#2563eb' : '#64748b',
              fontWeight: activeTab === tab.key ? 600 : 400,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderTop: 'none', borderRadius: '0 0 10px 10px', padding: 24 }}>
        {activeTab === 'settings' && (
          <SettingsTab template={template} onSaved={(updated) => setTemplate((prev) => prev ? { ...prev, ...updated, questions: prev.questions } : prev)} />
        )}
        {activeTab === 'questions' && (
          <QuestionsTab template={template} onTemplateChange={setTemplate} />
        )}
        {activeTab === 'links' && (
          <LinksTab template={template} />
        )}
        {activeTab === 'submissions' && (
          <SubmissionsTab template={template} />
        )}
      </div>

      {confirmDeleteTemplate && template && (
        <ConfirmModal
          title="מחיקת שאלון"
          message={`השאלון "${template.internalName}" יוסר מהמערכת. תשובות קיימות לא יימחקו.`}
          confirmLabel={deleting ? 'מוחק...' : 'מחק שאלון'}
          danger
          onConfirm={handleDeleteTemplate}
          onClose={() => setConfirmDeleteTemplate(false)}
        />
      )}
    </div>
  );
}
