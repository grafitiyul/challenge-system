'use client';

import { useEffect, useRef, useState, use } from 'react';
import { BASE_URL } from '@lib/api';

// ─── Types ───────────────────────────────────────────────────────────────────

interface QuestionOption {
  id: string;
  label: string;
  value: string;
}

interface Question {
  id: string;
  label: string;
  helperText: string | null;
  questionType: string;
  isRequired: boolean;
  allowOther: boolean;
  isSystemField: boolean;
  internalKey: string;
  options: QuestionOption[];
}

interface IdentifiedParticipant {
  id: string;
  firstName: string;
  lastName?: string | null;
  email?: string | null;
  birthDate?: string | null;
  city?: string | null;
  phoneNumber: string;
}

// Maps internalKey → participant field name (undefined = never auto-hide)
const SYSTEM_KEY_MAP: Record<string, keyof IdentifiedParticipant | undefined> = {
  first_name: 'firstName',
  firstName: 'firstName',
  last_name: 'lastName',
  lastName: 'lastName',
  email: 'email',
  birth_date: 'birthDate',
  birthDate: 'birthDate',
  city: 'city',
  // phone keys are NEVER hidden — they are the identifier
};

// Phone-number field: used as the identity gate, rendered separately in phone phase
const PHONE_KEYS = new Set(['phone_number', 'phone', 'phoneNumber']);

function isPhoneField(q: Question): boolean {
  return q.isSystemField && PHONE_KEYS.has(q.internalKey);
}

// Returns true when a participant is identified AND already has this field filled
function isKnownField(q: Question, participant: IdentifiedParticipant | null): boolean {
  if (!participant || !q.isSystemField) return false;
  const field = SYSTEM_KEY_MAP[q.internalKey];
  if (!field) return false; // phone keys → handled separately, never hidden here
  const val = participant[field];
  return val !== null && val !== undefined && val !== '';
}

// Resolve the greeting line shown after phone identification
function resolveGreeting(template: Template, participant: IdentifiedParticipant | null): string {
  const firstName = participant?.firstName?.trim() ?? '';
  if (!firstName) return 'נעבור לכמה שאלות קצרות:';
  const custom = template.postIdentificationGreeting?.trim();
  if (custom) return custom.replace('{firstName}', firstName);
  return `היי ${firstName} 😊 נעבור לכמה שאלות קצרות:`;
}

interface Template {
  id: string;
  publicTitle: string;
  introRichText: string | null;
  submitBehavior: string;
  displayMode: string;
  postIdentificationGreeting: string | null;
  questions: Question[];
}

interface LinkData {
  id: string;
  slugOrToken: string;
  isActive: boolean;
}

type AnswerValue = string | string[] | number | null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function storageKey(token: string) {
  return `q_draft_${token}`;
}

function loadDraft(token: string): Record<string, AnswerValue> {
  try {
    const raw = localStorage.getItem(storageKey(token));
    return raw ? (JSON.parse(raw) as Record<string, AnswerValue>) : {};
  } catch {
    return {};
  }
}

function saveDraft(token: string, answers: Record<string, AnswerValue>) {
  try { localStorage.setItem(storageKey(token), JSON.stringify(answers)); } catch { /* ignore */ }
}

function clearDraft(token: string) {
  try { localStorage.removeItem(storageKey(token)); } catch { /* ignore */ }
}

// ─── Input components ────────────────────────────────────────────────────────

const INPUT_BASE: React.CSSProperties = {
  width: '100%',
  padding: '14px 16px',
  border: '1.5px solid #cbd5e1',
  borderRadius: 10,
  fontSize: 16,
  color: '#0f172a',
  background: '#ffffff',
  boxSizing: 'border-box',
  outline: 'none',
  fontFamily: 'inherit',
};

function TextInput({ value, onChange, multiline }: { value: string; onChange: (v: string) => void; multiline?: boolean }) {
  if (multiline) {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        style={{ ...INPUT_BASE, resize: 'vertical', lineHeight: 1.6 }}
      />
    );
  }
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={INPUT_BASE}
    />
  );
}

function NumberInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ ...INPUT_BASE, direction: 'ltr', textAlign: 'left' }}
    />
  );
}

function EmailInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="email"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ ...INPUT_BASE, direction: 'ltr', textAlign: 'left' }}
      inputMode="email"
    />
  );
}

function PhoneInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="tel"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ ...INPUT_BASE, direction: 'ltr', textAlign: 'left' }}
      inputMode="tel"
    />
  );
}

function UrlInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="url"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ ...INPUT_BASE, direction: 'ltr', textAlign: 'left' }}
      inputMode="url"
    />
  );
}

function DateInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input type="date" value={value} onChange={(e) => onChange(e.target.value)} style={{ ...INPUT_BASE, direction: 'ltr' }} />;
}

function TimeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input type="time" value={value} onChange={(e) => onChange(e.target.value)} style={{ ...INPUT_BASE, direction: 'ltr' }} />;
}

function DateTimeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input type="datetime-local" value={value} onChange={(e) => onChange(e.target.value)} style={{ ...INPUT_BASE, direction: 'ltr' }} />;
}

function YesNoInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      {['כן', 'לא'].map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt === value ? '' : opt)}
          style={{
            flex: 1,
            minHeight: 56,
            border: `2px solid ${value === opt ? '#2563eb' : '#e2e8f0'}`,
            borderRadius: 10,
            background: value === opt ? '#eff6ff' : '#ffffff',
            color: value === opt ? '#1d4ed8' : '#374151',
            fontSize: 18,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function ChoiceInput({ question, value, onChange }: { question: Question; value: string; onChange: (v: string) => void }) {
  const [otherText, setOtherText] = useState('');
  const isOtherSelected = value === '__other__';

  function select(v: string) {
    if (v === '__other__') {
      onChange(isOtherSelected ? '' : '__other__');
    } else {
      onChange(value === v ? '' : v);
      setOtherText('');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {question.options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => select(opt.value)}
          style={{
            minHeight: 52,
            border: `2px solid ${value === opt.value ? '#2563eb' : '#e2e8f0'}`,
            borderRadius: 10,
            background: value === opt.value ? '#eff6ff' : '#ffffff',
            color: value === opt.value ? '#1d4ed8' : '#374151',
            fontSize: 16,
            textAlign: 'right',
            padding: '12px 16px',
            cursor: 'pointer',
            fontFamily: 'inherit',
            width: '100%',
          }}
        >
          {opt.label}
        </button>
      ))}
      {question.allowOther && (
        <>
          <button
            type="button"
            onClick={() => select('__other__')}
            style={{
              minHeight: 52,
              border: `2px solid ${isOtherSelected ? '#2563eb' : '#e2e8f0'}`,
              borderRadius: 10,
              background: isOtherSelected ? '#eff6ff' : '#ffffff',
              color: isOtherSelected ? '#1d4ed8' : '#374151',
              fontSize: 16,
              textAlign: 'right',
              padding: '12px 16px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              width: '100%',
            }}
          >
            אחר
          </button>
          {isOtherSelected && (
            <input
              type="text"
              value={otherText}
              onChange={(e) => { setOtherText(e.target.value); onChange(`__other__:${e.target.value}`); }}
              placeholder="פרטי..."
              style={{ ...INPUT_BASE, marginTop: 4 }}
              autoFocus
            />
          )}
        </>
      )}
    </div>
  );
}

function MultiInput({ question, value, onChange }: { question: Question; value: string[]; onChange: (v: string[]) => void }) {
  const [otherText, setOtherText] = useState('');
  const hasOther = value.some((v) => v.startsWith('__other__'));

  function toggle(v: string) {
    if (value.includes(v)) {
      onChange(value.filter((x) => x !== v));
    } else {
      onChange([...value, v]);
    }
  }

  function toggleOther() {
    if (hasOther) {
      onChange(value.filter((v) => !v.startsWith('__other__')));
      setOtherText('');
    } else {
      onChange([...value, '__other__']);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {question.options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => toggle(opt.value)}
          style={{
            minHeight: 52,
            border: `2px solid ${value.includes(opt.value) ? '#2563eb' : '#e2e8f0'}`,
            borderRadius: 10,
            background: value.includes(opt.value) ? '#eff6ff' : '#ffffff',
            color: value.includes(opt.value) ? '#1d4ed8' : '#374151',
            fontSize: 16,
            textAlign: 'right',
            padding: '12px 16px',
            cursor: 'pointer',
            fontFamily: 'inherit',
            width: '100%',
          }}
        >
          {opt.label}
        </button>
      ))}
      {question.allowOther && (
        <>
          <button
            type="button"
            onClick={toggleOther}
            style={{
              minHeight: 52,
              border: `2px solid ${hasOther ? '#2563eb' : '#e2e8f0'}`,
              borderRadius: 10,
              background: hasOther ? '#eff6ff' : '#ffffff',
              color: hasOther ? '#1d4ed8' : '#374151',
              fontSize: 16,
              textAlign: 'right',
              padding: '12px 16px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              width: '100%',
            }}
          >
            אחר
          </button>
          {hasOther && (
            <input
              type="text"
              value={otherText}
              onChange={(e) => {
                setOtherText(e.target.value);
                onChange([...value.filter((v) => !v.startsWith('__other__')), `__other__:${e.target.value}`]);
              }}
              placeholder="פרטי..."
              style={{ ...INPUT_BASE, marginTop: 4 }}
              autoFocus
            />
          )}
        </>
      )}
    </div>
  );
}

function ScaleInput({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          style={{
            width: 48,
            height: 48,
            border: `2px solid ${value === n ? '#2563eb' : '#e2e8f0'}`,
            borderRadius: '50%',
            background: value === n ? '#2563eb' : '#ffffff',
            color: value === n ? '#ffffff' : '#374151',
            fontSize: 16,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

function RatingInput({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  const [hovered, setHovered] = useState<number | null>(null);
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {Array.from({ length: 5 }, (_, i) => i + 1).map((n) => {
        const filled = n <= (hovered ?? value ?? 0);
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            onMouseEnter={() => setHovered(n)}
            onMouseLeave={() => setHovered(null)}
            style={{
              background: 'none',
              border: 'none',
              fontSize: 36,
              cursor: 'pointer',
              color: filled ? '#f59e0b' : '#e2e8f0',
              padding: '0 4px',
              lineHeight: 1,
            }}
          >
            ★
          </button>
        );
      })}
    </div>
  );
}

function SliderInput({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  const current = value ?? 50;
  return (
    <div>
      <input
        type="range"
        min={0}
        max={100}
        value={current}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%', height: 6, cursor: 'pointer' }}
      />
      <div style={{ textAlign: 'center', fontSize: 18, fontWeight: 600, color: '#2563eb', marginTop: 8 }}>{current}</div>
    </div>
  );
}

function DropdownInput({ question, value, onChange }: { question: Question; value: string; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ ...INPUT_BASE, cursor: 'pointer' }}
    >
      <option value="">בחרי...</option>
      {question.options.map((opt) => (
        <option key={opt.id} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  );
}

function ImageUploadInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  async function handleFile(file: File) {
    setUploading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      // BASE_URL ends with "/api" — use it directly for the upload endpoint
      const res = await fetch(`${BASE_URL}/upload`, { method: 'POST', body: fd });
      if (!res.ok) { setError('שגיאה בהעלאת התמונה'); return; }
      const data = await res.json() as { url: string };
      // Returned url is relative (/uploads/...) — prefix with API host
      const apiHost = BASE_URL.replace(/\/api$/, '');
      onChange(data.url.startsWith('http') ? data.url : `${apiHost}${data.url}`);
    } catch { setError('שגיאת רשת — לא ניתן להעלות תמונה'); }
    finally { setUploading(false); }
  }

  return (
    <div>
      <label style={{ display: 'block', cursor: 'pointer' }}>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
        />
        <div style={{
          border: `2px dashed ${value ? '#2563eb' : '#cbd5e1'}`,
          borderRadius: 12,
          padding: '24px 16px',
          textAlign: 'center',
          background: value ? '#eff6ff' : '#f8fafc',
          cursor: 'pointer',
        }}>
          {uploading ? (
            <div style={{ color: '#64748b', fontSize: 14 }}>מעלה תמונה...</div>
          ) : value ? (
            <div>
              <img src={value.startsWith('/uploads') ? `${BASE_URL.replace(/\/api$/, '')}${value}` : value} alt="uploaded" style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 8, marginBottom: 8, objectFit: 'cover' }} />
              <div style={{ fontSize: 13, color: '#2563eb' }}>לחצי להחלפת תמונה</div>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📷</div>
              <div style={{ fontSize: 15, color: '#374151', fontWeight: 600, marginBottom: 4 }}>לחצי לבחירת תמונה</div>
              <div style={{ fontSize: 13, color: '#94a3b8' }}>תמונה מהגלריה או ממצלמה</div>
            </div>
          )}
        </div>
      </label>
      {error && <div style={{ color: '#dc2626', fontSize: 13, marginTop: 6 }}>{error}</div>}
    </div>
  );
}

// ─── Question renderer ───────────────────────────────────────────────────────

function QuestionView({
  question,
  answer,
  onAnswer,
  error,
}: {
  question: Question;
  answer: AnswerValue;
  onAnswer: (v: AnswerValue) => void;
  error: string;
}) {
  const strVal = typeof answer === 'string' ? answer : '';
  const numVal = typeof answer === 'number' ? answer : null;
  const arrVal = Array.isArray(answer) ? answer : [];

  // static_text renders as content block, no input
  if (question.questionType === 'static_text') {
    return (
      <div
        style={{ padding: '20px 24px', background: '#f8fafc', borderRadius: 12, border: '1px solid #e2e8f0', lineHeight: 1.7, fontSize: 16, color: '#374151' }}
        dangerouslySetInnerHTML={{ __html: question.helperText ?? question.label }}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', lineHeight: 1.4, marginBottom: 6 }}>
          {question.label}
          {question.isRequired && <span style={{ color: '#dc2626', marginRight: 6 }}>*</span>}
        </div>
        {question.helperText && (
          <div style={{ fontSize: 14, color: '#64748b', lineHeight: 1.5 }}>{question.helperText}</div>
        )}
      </div>

      {question.questionType === 'text' && <TextInput value={strVal} onChange={onAnswer} />}
      {question.questionType === 'textarea' && <TextInput value={strVal} onChange={onAnswer} multiline />}
      {question.questionType === 'number' && <NumberInput value={strVal} onChange={onAnswer} />}
      {question.questionType === 'email' && <EmailInput value={strVal} onChange={onAnswer} />}
      {question.questionType === 'phone' && <PhoneInput value={strVal} onChange={onAnswer} />}
      {question.questionType === 'url' && <UrlInput value={strVal} onChange={onAnswer} />}
      {question.questionType === 'date' && <DateInput value={strVal} onChange={onAnswer} />}
      {question.questionType === 'time' && <TimeInput value={strVal} onChange={onAnswer} />}
      {question.questionType === 'datetime' && <DateTimeInput value={strVal} onChange={onAnswer} />}
      {question.questionType === 'yesno' && <YesNoInput value={strVal} onChange={onAnswer} />}
      {question.questionType === 'choice' && <ChoiceInput question={question} value={strVal} onChange={onAnswer} />}
      {question.questionType === 'dropdown' && <DropdownInput question={question} value={strVal} onChange={onAnswer} />}
      {question.questionType === 'multi' && <MultiInput question={question} value={arrVal} onChange={onAnswer} />}
      {question.questionType === 'scale' && <ScaleInput value={numVal} onChange={onAnswer} />}
      {question.questionType === 'rating' && <RatingInput value={numVal} onChange={onAnswer} />}
      {question.questionType === 'slider' && <SliderInput value={numVal} onChange={onAnswer} />}
      {(question.questionType === 'image_upload' || question.questionType === 'file_upload') && (
        <ImageUploadInput value={strVal} onChange={onAnswer} />
      )}

      {error && (
        <div style={{ color: '#dc2626', fontSize: 14, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 12px' }}>
          {error}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

type PageState = 'loading' | 'error' | 'fill' | 'done';
type FillPhase = 'phone' | 'questionnaire'; // phone = identity gate; questionnaire = the actual form

export default function PublicFillPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);

  // ── Page-level state ──
  const [pageState, setPageState] = useState<PageState>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [template, setTemplate] = useState<Template | null>(null);
  const [link, setLink] = useState<LinkData | null>(null);

  // ── Identity flow state ──
  const [fillPhase, setFillPhase] = useState<FillPhase>('phone');
  const [phoneValue, setPhoneValue] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [lookingUp, setLookingUp] = useState(false);
  const [identifiedParticipant, setIdentifiedParticipant] = useState<IdentifiedParticipant | null>(null);

  // ── Questionnaire state ──
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [fieldError, setFieldError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [autosaved, setAutosaved] = useState(false);

  // ── Load template + link ──
  useEffect(() => {
    fetch(`${BASE_URL}/public/q/${token}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({})) as { message?: string };
          setErrorMsg(body.message ?? 'הלינק אינו פעיל או לא קיים');
          setPageState('error');
          return;
        }
        const data = await r.json() as { link: LinkData; template: Template };
        setLink(data.link);
        setTemplate(data.template);
        // If questionnaire has no phone_number system field, skip the identity gate
        const hasPhoneField = data.template.questions.some(isPhoneField);
        if (!hasPhoneField) setFillPhase('questionnaire');
        // Restore draft answers
        const draft = loadDraft(token);
        setAnswers(draft);
        // Pre-fill phone input from draft if a phone question exists
        if (hasPhoneField) {
          const pq = data.template.questions.find(isPhoneField)!;
          const savedPhone = draft[pq.id];
          if (typeof savedPhone === 'string' && savedPhone.trim()) {
            setPhoneValue(savedPhone.trim());
          }
        }
        setPageState('fill');
      })
      .catch(() => {
        setErrorMsg('אירעה שגיאה בטעינת השאלון');
        setPageState('error');
      });
  }, [token]);

  // ── Derived: phone question + questionnaire questions (phone excluded) ──
  const phoneQuestion = template?.questions.find(isPhoneField) ?? null;
  // Non-phone questions are all the questions shown in questionnaire phase
  const nonPhoneQuestions = (template?.questions ?? []).filter((q) => !isPhoneField(q));
  // Visible questions = non-phone minus already-known fields
  const visibleQuestions = nonPhoneQuestions.filter((q) => !isKnownField(q, identifiedParticipant));

  // ── Phone phase: validate and look up participant ──
  async function handlePhoneContinue() {
    const cleaned = phoneValue.trim();
    if (cleaned.length < 9) {
      setPhoneError('יש להזין מספר טלפון תקין (לפחות 9 ספרות)');
      return;
    }
    setPhoneError('');
    setLookingUp(true);
    try {
      const res = await fetch(`${BASE_URL}/public/q/lookup-participant?phone=${encodeURIComponent(cleaned)}`);
      if (res.ok) {
        const data = await res.json() as IdentifiedParticipant | null;
        setIdentifiedParticipant(data);
      } else {
        setIdentifiedParticipant(null);
      }
    } catch {
      setIdentifiedParticipant(null);
    } finally {
      setLookingUp(false);
    }
    // Store phone as the answer to the phone_number question (included in submission payload)
    if (phoneQuestion) {
      setAnswers((prev) => {
        const next = { ...prev, [phoneQuestion.id]: cleaned };
        saveDraft(token, next);
        return next;
      });
    }
    setCurrentIndex(0);
    setFieldError('');
    setFillPhase('questionnaire');
  }

  function handleChangePhone() {
    setFillPhase('phone');
    setIdentifiedParticipant(null);
    setCurrentIndex(0);
    setFieldError('');
  }

  // ── Answer management ──
  function setAnswer(questionId: string, value: AnswerValue) {
    setAnswers((prev) => {
      const next = { ...prev, [questionId]: value };
      saveDraft(token, next);
      setAutosaved(true);
      setTimeout(() => setAutosaved(false), 2000);
      return next;
    });
    setFieldError('');
  }

  // ── Step-by-step validation + navigation ──
  const clampedIndex = Math.min(currentIndex, Math.max(0, visibleQuestions.length - 1));

  function validateCurrent(): boolean {
    const currentQ = visibleQuestions[clampedIndex];
    if (!currentQ || !currentQ.isRequired || currentQ.questionType === 'static_text') return true;
    const val = answers[currentQ.id];
    if (val === null || val === undefined || val === '') {
      setFieldError('שדה זה הוא חובה');
      return false;
    }
    if (Array.isArray(val) && val.length === 0) {
      setFieldError('יש לבחור לפחות אפשרות אחת');
      return false;
    }
    return true;
  }

  function goNext() {
    if (!validateCurrent()) return;
    setFieldError('');
    if (clampedIndex < visibleQuestions.length - 1) setCurrentIndex(clampedIndex + 1);
  }

  function goPrev() {
    setFieldError('');
    setCurrentIndex(Math.max(0, clampedIndex - 1));
  }

  // ── Build submission payload (always includes phone answer) ──
  function buildPayload(qs: Question[]): { questionId: string; value: AnswerValue }[] {
    const payload = qs
      .filter((q) => q.questionType !== 'static_text')
      .map((q) => ({ questionId: q.id, value: answers[q.id] ?? null }));
    // Include phone answer so the backend can find/create the participant
    if (phoneQuestion && phoneValue.trim()) {
      payload.push({ questionId: phoneQuestion.id, value: phoneValue.trim() });
    }
    return payload;
  }

  // ── Submit (step-by-step) ──
  async function handleSubmit() {
    if (!validateCurrent()) return;
    if (!template || !link) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${BASE_URL}/public/q/${token}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submittedByMode: 'external', answers: buildPayload(visibleQuestions) }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({})) as { message?: string };
        setFieldError(typeof errBody.message === 'string' ? errBody.message : 'שגיאה בשליחת השאלון. אנא נסי שוב.');
        return;
      }
      clearDraft(token);
      setPageState('done');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Static screens ──
  if (pageState === 'loading') {
    return (
      <div dir="rtl" style={{ minHeight: '100vh', background: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#94a3b8', fontSize: 16 }}>טוען...</div>
      </div>
    );
  }

  if (pageState === 'error') {
    return (
      <div dir="rtl" style={{ minHeight: '100vh', background: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ textAlign: 'center', maxWidth: 380 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>😕</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginBottom: 10 }}>הלינק אינו זמין</div>
          <div style={{ fontSize: 15, color: '#64748b', lineHeight: 1.6 }}>{errorMsg}</div>
        </div>
      </div>
    );
  }

  if (pageState === 'done') {
    return (
      <div dir="rtl" style={{ minHeight: '100vh', background: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ textAlign: 'center', maxWidth: 400 }}>
          <div style={{ fontSize: 56, marginBottom: 20 }}>✅</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', marginBottom: 12 }}>תודה!</div>
          <div style={{ fontSize: 16, color: '#64748b', lineHeight: 1.6 }}>תשובותך נשמרו בהצלחה.</div>
        </div>
      </div>
    );
  }

  if (!template) return null;

  // ── PHASE 1: Phone identity gate ──
  if (fillPhase === 'phone') {
    return (
      <div dir="rtl" style={{ minHeight: '100vh', background: '#f1f5f9', fontFamily: 'Arial, Helvetica, sans-serif', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 64, paddingLeft: 16, paddingRight: 16 }}>
        <div style={{ width: '100%', maxWidth: 420 }}>
          {/* Questionnaire title */}
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', margin: '0 0 10px' }}>{template.publicTitle}</h1>
            {template.introRichText && (
              <div style={{ fontSize: 14, color: '#64748b', lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: template.introRichText }} />
            )}
          </div>

          {/* Phone input card */}
          <div style={{ background: '#ffffff', borderRadius: 20, boxShadow: '0 2px 16px rgba(0,0,0,0.08)', padding: '36px 32px' }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#374151', marginBottom: 8 }}>מספר טלפון</div>
            <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 20 }}>הזיני את מספר הטלפון שלך להתחלה</div>
            <input
              type="tel"
              inputMode="tel"
              value={phoneValue}
              onChange={(e) => { setPhoneValue(e.target.value); setPhoneError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') handlePhoneContinue(); }}
              placeholder="05X-XXXXXXX"
              autoFocus
              style={{
                width: '100%',
                padding: '16px',
                border: `1.5px solid ${phoneError ? '#fca5a5' : '#cbd5e1'}`,
                borderRadius: 12,
                fontSize: 18,
                color: '#0f172a',
                background: '#ffffff',
                boxSizing: 'border-box',
                outline: 'none',
                direction: 'ltr',
                textAlign: 'left',
                fontFamily: 'inherit',
                marginBottom: phoneError ? 8 : 20,
              }}
            />
            {phoneError && (
              <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 16 }}>{phoneError}</div>
            )}
            <button
              onClick={handlePhoneContinue}
              disabled={lookingUp}
              style={{
                width: '100%',
                minHeight: 56,
                border: 'none',
                borderRadius: 14,
                background: lookingUp ? '#93c5fd' : '#2563eb',
                color: '#ffffff',
                fontSize: 17,
                fontWeight: 700,
                cursor: lookingUp ? 'default' : 'pointer',
                fontFamily: 'inherit',
                boxShadow: lookingUp ? 'none' : '0 4px 14px rgba(37,99,235,0.28)',
              }}
            >
              {lookingUp ? 'מחפש...' : 'המשך →'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── PHASE 2: Questionnaire ──
  const isFullList = template.displayMode === 'full_list';
  const greeting = template && phoneQuestion ? resolveGreeting(template, identifiedParticipant) : null;

  // Greeting + change-phone bar (shared between both display modes)
  const greetingBar = (phoneQuestion !== null) ? (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 12 }}>
      {greeting && (
        <span style={{ fontSize: 15, fontWeight: 600, color: '#374151' }}>{greeting}</span>
      )}
      <button
        onClick={handleChangePhone}
        style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 13, cursor: 'pointer', padding: '4px 0', fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0 }}
      >
        ← שנה מספר
      </button>
    </div>
  ) : null;

  // ── full_list mode ──
  if (isFullList) {
    function validateAll(): string | null {
      for (const q of visibleQuestions) {
        if (!q.isRequired || q.questionType === 'static_text') continue;
        const val = answers[q.id];
        if (val === null || val === undefined || val === '') return q.id;
        if (Array.isArray(val) && val.length === 0) return q.id;
      }
      return null;
    }

    async function handleSubmitAll() {
      const firstErrorId = validateAll();
      if (firstErrorId) {
        setFieldError(firstErrorId);
        document.getElementById(`q-${firstErrorId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      if (!template || !link) return;
      setSubmitting(true);
      try {
        const res = await fetch(`${BASE_URL}/public/q/${token}/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ submittedByMode: 'external', answers: buildPayload(visibleQuestions) }),
        });
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({})) as { message?: string };
          setFieldError(typeof errBody.message === 'string' ? errBody.message : 'שגיאה בשליחת השאלון');
          return;
        }
        clearDraft(token);
        setPageState('done');
      } finally {
        setSubmitting(false);
      }
    }

    const fillableQs = visibleQuestions.filter((q) => q.questionType !== 'static_text');
    const answeredCount = fillableQs.filter((q) => {
      const val = answers[q.id];
      return val !== null && val !== undefined && val !== '' && !(Array.isArray(val) && val.length === 0);
    }).length;
    const listProgress = fillableQs.length > 0 ? (answeredCount / fillableQs.length) * 100 : 0;

    return (
      <div dir="rtl" style={{ minHeight: '100vh', background: '#f1f5f9', fontFamily: 'Arial, Helvetica, sans-serif' }}>
        {/* Sticky progress bar */}
        <div style={{ position: 'sticky', top: 0, zIndex: 50, background: '#ffffff', borderBottom: '1px solid #e2e8f0' }}>
          <div style={{ maxWidth: 480, margin: '0 auto', padding: '10px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, height: 6, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${listProgress}%`, background: '#2563eb', borderRadius: 4, transition: 'width 0.3s ease' }} />
              </div>
              <span style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap' }}>{answeredCount} / {fillableQs.length}</span>
            </div>
          </div>
        </div>

        <div style={{ maxWidth: 480, margin: '0 auto', padding: '28px 16px 64px' }}>
          {/* Title + greeting */}
          <div style={{ background: '#ffffff', borderRadius: 18, boxShadow: '0 1px 6px rgba(0,0,0,0.07)', padding: '24px 28px', marginBottom: 20 }}>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', margin: '0 0 4px' }}>{template.publicTitle}</h1>
            {template.introRichText && (
              <div style={{ fontSize: 14, color: '#64748b', lineHeight: 1.7, marginBottom: 12 }} dangerouslySetInnerHTML={{ __html: template.introRichText }} />
            )}
            {greetingBar}
          </div>

          {/* Question cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {visibleQuestions.map((q) => (
              <div
                key={q.id}
                id={`q-${q.id}`}
                style={{
                  background: '#ffffff',
                  borderRadius: 16,
                  boxShadow: fieldError === q.id
                    ? '0 0 0 2px #fca5a5, 0 1px 6px rgba(0,0,0,0.06)'
                    : '0 1px 6px rgba(0,0,0,0.06)',
                  padding: '24px 24px 20px',
                  scrollMarginTop: 72,
                  transition: 'box-shadow 0.2s',
                }}
              >
                <QuestionView
                  question={q}
                  answer={answers[q.id] ?? (q.questionType === 'multi' ? [] : '')}
                  onAnswer={(v) => { setAnswer(q.id, v); if (fieldError === q.id) setFieldError(''); }}
                  error={fieldError === q.id ? 'שדה זה הוא חובה' : ''}
                />
              </div>
            ))}
          </div>

          {autosaved && <div style={{ marginTop: 14, fontSize: 12, color: '#94a3b8', textAlign: 'center' }}>נשמר אוטומטית ✓</div>}
          {fieldError && visibleQuestions.every((q) => q.id !== fieldError) && (
            <div style={{ marginTop: 14, color: '#dc2626', fontSize: 14, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 14px' }}>{fieldError}</div>
          )}

          <button
            onClick={handleSubmitAll}
            disabled={submitting}
            style={{ marginTop: 28, width: '100%', minHeight: 58, border: 'none', borderRadius: 14, background: submitting ? '#93c5fd' : '#2563eb', color: '#ffffff', fontSize: 18, fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer', fontFamily: 'inherit', boxShadow: submitting ? 'none' : '0 4px 14px rgba(37,99,235,0.28)', letterSpacing: 0.3 }}
          >
            {submitting ? 'שולח...' : 'שלח שאלון'}
          </button>
        </div>
      </div>
    );
  }

  // ── step_by_step mode ──
  const q = visibleQuestions[clampedIndex];
  const isLast = clampedIndex === visibleQuestions.length - 1;
  const progress = visibleQuestions.length > 0 ? (clampedIndex / visibleQuestions.length) * 100 : 0;

  return (
    <div dir="rtl" style={{ minHeight: '100vh', background: '#f1f5f9', fontFamily: 'Arial, Helvetica, sans-serif' }}>
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '32px 16px 150px' }}>
        {/* Title + greeting — shown on first question */}
        {clampedIndex === 0 && (
          <div style={{ marginBottom: 24 }}>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', margin: '0 0 6px' }}>{template.publicTitle}</h1>
            {template.introRichText && (
              <div style={{ fontSize: 14, color: '#64748b', lineHeight: 1.7, marginBottom: 12 }} dangerouslySetInnerHTML={{ __html: template.introRichText }} />
            )}
            {greetingBar}
          </div>
        )}

        {/* Current question card */}
        {q && (
          <div style={{ background: '#ffffff', borderRadius: 20, boxShadow: '0 2px 16px rgba(0,0,0,0.08)', padding: '32px 28px 28px' }}>
            <QuestionView
              question={q}
              answer={answers[q.id] ?? (q.questionType === 'multi' ? [] : '')}
              onAnswer={(v) => setAnswer(q.id, v)}
              error={fieldError}
            />
          </div>
        )}

        {autosaved && <div style={{ marginTop: 12, fontSize: 12, color: '#94a3b8', textAlign: 'center' }}>נשמר אוטומטית ✓</div>}
      </div>

      {/* Fixed bottom bar */}
      <div style={{ position: 'fixed', bottom: 0, right: 0, left: 0, background: '#ffffff', borderTop: '1px solid #e8edf2', boxShadow: '0 -4px 20px rgba(0,0,0,0.06)', padding: '14px 20px 30px', zIndex: 100 }}>
        <div style={{ maxWidth: 480, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <div style={{ flex: 1, height: 5, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progress}%`, background: '#2563eb', borderRadius: 4, transition: 'width 0.4s ease' }} />
            </div>
            <span style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap' }}>{clampedIndex + 1} / {visibleQuestions.length}</span>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={goPrev}
              disabled={clampedIndex === 0}
              style={{ flex: 1, minHeight: 52, border: '1.5px solid #e2e8f0', borderRadius: 12, background: clampedIndex === 0 ? '#f8fafc' : '#ffffff', color: clampedIndex === 0 ? '#cbd5e1' : '#475569', fontSize: 15, fontWeight: 500, cursor: clampedIndex === 0 ? 'default' : 'pointer', fontFamily: 'inherit' }}
            >
              הקודם
            </button>
            {isLast ? (
              <button
                onClick={handleSubmit}
                disabled={submitting}
                style={{ flex: 2, minHeight: 52, border: 'none', borderRadius: 12, background: submitting ? '#93c5fd' : '#2563eb', color: '#ffffff', fontSize: 16, fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer', fontFamily: 'inherit', boxShadow: submitting ? 'none' : '0 3px 10px rgba(37,99,235,0.25)' }}
              >
                {submitting ? 'שולח...' : 'שלח שאלון'}
              </button>
            ) : (
              <button
                onClick={goNext}
                style={{ flex: 2, minHeight: 52, border: 'none', borderRadius: 12, background: '#2563eb', color: '#ffffff', fontSize: 16, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 3px 10px rgba(37,99,235,0.25)' }}
              >
                הבא
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
