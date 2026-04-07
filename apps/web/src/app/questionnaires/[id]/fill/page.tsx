'use client';

import { useEffect, useState, useRef, use } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
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
  internalKey: string;
  helperText: string | null;
  questionType: string;
  isRequired: boolean;
  allowOther: boolean;
  isSystemField: boolean;
  fieldSize: string | null;
  options: QuestionOption[];
}

interface Template {
  id: string;
  internalName: string;
  publicTitle: string;
  submitBehavior: string;
  questions: Question[];
}

interface Participant {
  id: string;
  firstName: string;
  lastName?: string | null;
  phoneNumber: string;
  email?: string | null;
  birthDate?: string | null;
  city?: string | null;
}

// Maps system field internalKey → participant field name
const SYSTEM_KEY_TO_PARTICIPANT_FIELD: Record<string, keyof Participant> = {
  first_name: 'firstName',
  firstName: 'firstName',
  last_name: 'lastName',
  lastName: 'lastName',
  phone_number: 'phoneNumber',
  phoneNumber: 'phoneNumber',
  email: 'email',
  birth_date: 'birthDate',
  birthDate: 'birthDate',
  city: 'city',
};

// Returns true if a system field's data is already populated on the participant
function isParticipantFieldKnown(q: Question, participant: Participant): boolean {
  if (!q.isSystemField) return false;
  const fieldKey = SYSTEM_KEY_TO_PARTICIPANT_FIELD[q.internalKey];
  if (!fieldKey) return false;
  const val = participant[fieldKey];
  return val != null && val !== '';
}

function displayName(p: { firstName: string; lastName?: string | null }): string {
  return [p.firstName, p.lastName].filter(Boolean).join(' ');
}

type AnswerValue = string | string[] | number | null;

function ImageUploadField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  async function handleFile(file: File) {
    setUploading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${BASE_URL}/upload`, { method: 'POST', body: fd });
      if (!res.ok) { setError('שגיאה בהעלאה'); return; }
      const data = await res.json() as { url: string };
      const apiHost = BASE_URL.replace(/\/api$/, '');
      onChange(data.url.startsWith('http') ? data.url : `${apiHost}${data.url}`);
    } catch { setError('שגיאת רשת — לא ניתן להעלות קובץ'); }
    finally { setUploading(false); }
  }

  return (
    <div>
      <label style={{ display: 'block', cursor: 'pointer' }}>
        <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
        <div style={{ border: `2px dashed ${value ? '#2563eb' : '#e2e8f0'}`, borderRadius: 8, padding: '16px', textAlign: 'center', background: value ? '#eff6ff' : '#f8fafc', cursor: 'pointer' }}>
          {uploading ? (
            <div style={{ color: '#64748b', fontSize: 13 }}>מעלה...</div>
          ) : value ? (
            <div>
              <img src={value.startsWith('/uploads') ? `${BASE_URL.replace('/api', '')}${value}` : value} alt="uploaded" style={{ maxWidth: '100%', maxHeight: 150, borderRadius: 6, marginBottom: 6, objectFit: 'cover' }} />
              <div style={{ fontSize: 12, color: '#2563eb' }}>לחצי להחלפה</div>
            </div>
          ) : (
            <div style={{ color: '#64748b', fontSize: 13 }}>📷 לחצי לבחירת תמונה</div>
          )}
        </div>
      </label>
      {error && <div style={{ color: '#dc2626', fontSize: 12, marginTop: 4 }}>{error}</div>}
    </div>
  );
}

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
  fontFamily: 'inherit',
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: '#374151',
  marginBottom: 5,
  display: 'block',
};

// ─── Field components ────────────────────────────────────────────────────────

function TextareaField({ value, onChange, rows = 3 }: { value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }}
    />
  );
}

function ChoiceField({ question, value, onChange }: { question: Question; value: string; onChange: (v: string) => void }) {
  const [otherText, setOtherText] = useState(value.startsWith('__other__:') ? value.slice(10) : '');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {question.options.map((opt) => (
        <label key={opt.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '6px 0' }}>
          <input
            type="radio"
            checked={value === opt.value}
            onChange={() => onChange(opt.value)}
            style={{ width: 16, height: 16, cursor: 'pointer' }}
          />
          <span style={{ fontSize: 14, color: '#374151' }}>{opt.label}</span>
        </label>
      ))}
      {question.allowOther && (
        <>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '6px 0' }}>
            <input
              type="radio"
              checked={value.startsWith('__other__')}
              onChange={() => onChange(`__other__:${otherText}`)}
              style={{ width: 16, height: 16, cursor: 'pointer' }}
            />
            <span style={{ fontSize: 14, color: '#374151' }}>אחר</span>
          </label>
          {value.startsWith('__other__') && (
            <input
              type="text"
              value={otherText}
              onChange={(e) => { setOtherText(e.target.value); onChange(`__other__:${e.target.value}`); }}
              placeholder="פרטי..."
              style={inputStyle}
            />
          )}
        </>
      )}
    </div>
  );
}

function MultiField({ question, value, onChange }: { question: Question; value: string[]; onChange: (v: string[]) => void }) {
  const [otherText, setOtherText] = useState(value.find((v) => v.startsWith('__other__:'))?.slice(10) ?? '');

  function toggle(v: string) {
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  }

  function toggleOther() {
    if (value.some((v) => v.startsWith('__other__'))) {
      onChange(value.filter((v) => !v.startsWith('__other__')));
    } else {
      onChange([...value, `__other__:${otherText}`]);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {question.options.map((opt) => (
        <label key={opt.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '6px 0' }}>
          <input
            type="checkbox"
            checked={value.includes(opt.value)}
            onChange={() => toggle(opt.value)}
            style={{ width: 16, height: 16, cursor: 'pointer' }}
          />
          <span style={{ fontSize: 14, color: '#374151' }}>{opt.label}</span>
        </label>
      ))}
      {question.allowOther && (
        <>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '6px 0' }}>
            <input
              type="checkbox"
              checked={value.some((v) => v.startsWith('__other__'))}
              onChange={toggleOther}
              style={{ width: 16, height: 16, cursor: 'pointer' }}
            />
            <span style={{ fontSize: 14, color: '#374151' }}>אחר</span>
          </label>
          {value.some((v) => v.startsWith('__other__')) && (
            <input
              type="text"
              value={otherText}
              onChange={(e) => {
                setOtherText(e.target.value);
                onChange([...value.filter((v) => !v.startsWith('__other__')), `__other__:${e.target.value}`]);
              }}
              placeholder="פרטי..."
              style={inputStyle}
            />
          )}
        </>
      )}
    </div>
  );
}

function ScaleField({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          style={{
            width: 40,
            height: 40,
            border: `1.5px solid ${value === n ? '#2563eb' : '#e2e8f0'}`,
            borderRadius: '50%',
            background: value === n ? '#2563eb' : '#ffffff',
            color: value === n ? '#ffffff' : '#374151',
            fontSize: 14,
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

function RatingField({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  const [hovered, setHovered] = useState<number | null>(null);
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {Array.from({ length: 5 }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          onMouseEnter={() => setHovered(n)}
          onMouseLeave={() => setHovered(null)}
          style={{ background: 'none', border: 'none', fontSize: 28, cursor: 'pointer', color: n <= (hovered ?? value ?? 0) ? '#f59e0b' : '#e2e8f0', padding: '0 2px' }}
        >★</button>
      ))}
    </div>
  );
}

function SliderField({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  const current = value ?? 50;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <input
        type="range"
        min={0}
        max={100}
        value={current}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ flex: 1, height: 6, cursor: 'pointer' }}
      />
      <span style={{ fontSize: 16, fontWeight: 600, color: '#2563eb', minWidth: 32, textAlign: 'center' }}>{current}</span>
    </div>
  );
}

function YesNoField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      {['כן', 'לא'].map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(value === opt ? '' : opt)}
          style={{
            flex: 1,
            height: 44,
            border: `1.5px solid ${value === opt ? '#2563eb' : '#e2e8f0'}`,
            borderRadius: 8,
            background: value === opt ? '#eff6ff' : '#ffffff',
            color: value === opt ? '#1d4ed8' : '#374151',
            fontSize: 15,
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

// ─── Single question block ───────────────────────────────────────────────────

function QuestionBlock({
  index,
  question,
  answer,
  onAnswer,
  error,
  touched,
  onRef,
}: {
  index: number;
  question: Question;
  answer: AnswerValue;
  onAnswer: (v: AnswerValue) => void;
  error: string;
  touched: boolean;
  onRef: (el: HTMLDivElement | null) => void;
}) {
  const strVal = typeof answer === 'string' ? answer : '';
  const numVal = typeof answer === 'number' ? answer : null;
  const arrVal = Array.isArray(answer) ? answer : [];

  // static_text: render as content block
  if (question.questionType === 'static_text') {
    return (
      <div
        ref={onRef}
        style={{ padding: '20px 26px', background: '#f8fafc', borderRadius: 12, border: '1px solid #e5e7eb', lineHeight: 1.75, fontSize: 15, color: '#374151', borderRight: '4px solid #e2e8f0' }}
        dangerouslySetInnerHTML={{ __html: question.helperText ?? question.label }}
      />
    );
  }

  const hasError = touched && !!error;

  return (
    <div
      ref={onRef}
      style={{
        padding: '22px 26px',
        background: '#ffffff',
        borderRadius: 12,
        border: `1.5px solid ${hasError ? '#fca5a5' : '#e5e7eb'}`,
        borderRight: `4px solid ${hasError ? '#f87171' : question.isRequired ? '#2563eb' : '#e5e7eb'}`,
        transition: 'border-color 0.2s, box-shadow 0.2s',
        boxShadow: hasError ? '0 0 0 3px rgba(252,165,165,0.15)' : '0 1px 3px rgba(0,0,0,0.04)',
      }}
    >
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', marginBottom: 4, lineHeight: 1.45, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <span style={{ color: '#cbd5e1', fontWeight: 500, fontSize: 12, minWidth: 20, paddingTop: 2 }}>{index + 1}.</span>
          <span>
            {question.label}
            {question.isRequired && <span style={{ color: '#dc2626', marginRight: 4 }}>*</span>}
          </span>
        </div>
        {question.helperText && (
          <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5, paddingRight: 28 }}>{question.helperText}</div>
        )}
      </div>

      {question.questionType === 'text' && (
        <input type="text" value={strVal} onChange={(e) => onAnswer(e.target.value)} style={inputStyle} />
      )}
      {question.questionType === 'textarea' && (
        <TextareaField value={strVal} onChange={onAnswer} rows={4} />
      )}
      {question.questionType === 'number' && (
        <input type="number" value={strVal} onChange={(e) => onAnswer(e.target.value)} style={{ ...inputStyle, direction: 'ltr', textAlign: 'left' }} />
      )}
      {question.questionType === 'email' && (
        <input type="email" value={strVal} onChange={(e) => onAnswer(e.target.value)} style={{ ...inputStyle, direction: 'ltr', textAlign: 'left' }} inputMode="email" />
      )}
      {question.questionType === 'phone' && (
        <input type="tel" value={strVal} onChange={(e) => onAnswer(e.target.value)} style={{ ...inputStyle, direction: 'ltr', textAlign: 'left' }} inputMode="tel" />
      )}
      {question.questionType === 'url' && (
        <input type="url" value={strVal} onChange={(e) => onAnswer(e.target.value)} style={{ ...inputStyle, direction: 'ltr', textAlign: 'left' }} />
      )}
      {question.questionType === 'date' && (
        <input type="date" value={strVal} onChange={(e) => onAnswer(e.target.value)} style={{ ...inputStyle, direction: 'ltr' }} />
      )}
      {question.questionType === 'time' && (
        <input type="time" value={strVal} onChange={(e) => onAnswer(e.target.value)} style={{ ...inputStyle, direction: 'ltr' }} />
      )}
      {question.questionType === 'datetime' && (
        <input type="datetime-local" value={strVal} onChange={(e) => onAnswer(e.target.value)} style={{ ...inputStyle, direction: 'ltr' }} />
      )}
      {question.questionType === 'yesno' && <YesNoField value={strVal} onChange={onAnswer} />}
      {question.questionType === 'choice' && <ChoiceField question={question} value={strVal} onChange={onAnswer} />}
      {question.questionType === 'dropdown' && (
        <select value={strVal} onChange={(e) => onAnswer(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
          <option value="">בחרי...</option>
          {question.options.map((opt) => (
            <option key={opt.id} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      )}
      {question.questionType === 'multi' && <MultiField question={question} value={arrVal} onChange={onAnswer} />}
      {question.questionType === 'scale' && <ScaleField value={numVal} onChange={onAnswer} />}
      {question.questionType === 'rating' && <RatingField value={numVal} onChange={onAnswer} />}
      {question.questionType === 'slider' && <SliderField value={numVal} onChange={onAnswer} />}
      {(question.questionType === 'image_upload' || question.questionType === 'file_upload') && (
        <ImageUploadField value={strVal} onChange={onAnswer} />
      )}

      {hasError && (
        <div style={{ marginTop: 10, color: '#dc2626', fontSize: 13, display: 'flex', alignItems: 'center', gap: 5 }}>
          <span>⚠</span> {error}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function InternalFillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const router = useRouter();
  const participantId = searchParams.get('participantId');

  const [template, setTemplate] = useState<Template | null>(null);
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});

  // New participant fields (when no participantId)
  const [newFirstName, setNewFirstName] = useState('');
  const [newLastName, setNewLastName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newParticipantErrors, setNewParticipantErrors] = useState<{ firstName?: string; phone?: string }>({});

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // Map of question id → DOM element for scroll-to-error
  const questionElems = useRef<Map<string, HTMLDivElement | null>>(new Map());

  useEffect(() => {
    const fetchTemplate = fetch(`${BASE_URL}/questionnaires/${id}`, { cache: 'no-store' })
      .then((r) => { if (!r.ok) { setNotFound(true); return null; } return r.json(); })
      .then((data: unknown) => { if (data) setTemplate(data as Template); });

    const fetchParticipant = participantId
      ? fetch(`${BASE_URL}/participants/${participantId}`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((data: unknown) => setParticipant(data as Participant))
        .catch(() => {})
      : Promise.resolve();

    Promise.all([fetchTemplate, fetchParticipant])
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id, participantId]);

  function setQuestionRef(questionId: string, el: HTMLDivElement | null) {
    questionElems.current.set(questionId, el);
  }

  function setAnswer(questionId: string, value: AnswerValue) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
    setTouched((prev) => new Set(prev).add(questionId));
    // Clear error if now valid
    setErrors((prev) => {
      const next = { ...prev };
      delete next[questionId];
      return next;
    });
  }

  function validateAll(): boolean {
    if (!template) return false;
    const newErrors: Record<string, string> = {};
    const newTouched = new Set(touched);
    // Only validate visible questions (hidden ones are pre-filled from participant)
    const visibleQs = template.questions.filter((q) => !(participant && isParticipantFieldKnown(q, participant)));

    for (const q of visibleQs) {
      if (!q.isRequired || q.questionType === 'static_text') continue;
      newTouched.add(q.id);
      const val = answers[q.id];
      if (val === null || val === undefined || val === '') {
        newErrors[q.id] = 'שדה חובה';
      } else if (Array.isArray(val) && val.length === 0) {
        newErrors[q.id] = 'יש לבחור לפחות אפשרות אחת';
      }
    }

    setTouched(newTouched);
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  function validateNewParticipant(): boolean {
    const errs: { firstName?: string; phone?: string } = {};
    if (!newFirstName.trim()) errs.firstName = 'שם פרטי הוא שדה חובה';
    if (!newPhone.trim()) errs.phone = 'מספר טלפון הוא שדה חובה';
    setNewParticipantErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit() {
    if (!template) return;

    // Validate participant fields if no participantId
    if (!participantId && !validateNewParticipant()) return;

    if (!validateAll()) {
      // Scroll to first error
      const firstErrorId = template.questions.find((q) => errors[q.id])?.id;
      if (firstErrorId) {
        questionElems.current.get(firstErrorId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }

    setSubmitting(true);
    setSubmitError('');
    try {
      const answerPayload = template.questions
        .filter((q) => q.questionType !== 'static_text')
        .map((q) => ({ questionId: q.id, value: answers[q.id] ?? null }));

      const body: Record<string, unknown> = {
        submittedByMode: 'internal',
        answers: answerPayload,
      };

      if (participantId) {
        body.participantId = participantId;
      } else {
        body.newParticipant = { firstName: newFirstName.trim(), lastName: newLastName.trim() || undefined, phoneNumber: newPhone.trim() };
      }

      const res = await fetch(`${BASE_URL}/questionnaires/${id}/submissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        setSubmitError('שגיאה בשליחת השאלון');
        return;
      }

      const submission = await res.json() as { participantId?: string };
      const targetId = participantId ?? submission.participantId;
      if (targetId) {
        router.push(`/participants/${targetId}?tab=questionnaires`);
      } else {
        router.push('/questionnaires');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="page-wrapper" style={{ color: '#94a3b8', paddingTop: 60, textAlign: 'center' }}>
        טוען...
      </div>
    );
  }

  if (notFound || !template) {
    return (
      <div className="page-wrapper" style={{ textAlign: 'center', paddingTop: 60 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>😕</div>
        <div style={{ color: '#374151', fontSize: 16, fontWeight: 500, marginBottom: 12 }}>שאלון לא נמצא</div>
        <Link href="/questionnaires" style={{ color: '#2563eb', fontSize: 14 }}>← חזרה לרשימה</Link>
      </div>
    );
  }

  // Smart field hiding: skip system fields already populated on the identified participant
  const visibleQuestions = template.questions.filter((q) =>
    !(participant && isParticipantFieldKnown(q, participant))
  );
  const hiddenCount = template.questions.length - visibleQuestions.length;

  const answeredCount = visibleQuestions.filter(
    (q) => q.questionType !== 'static_text' && answers[q.id] != null && answers[q.id] !== '' && !(Array.isArray(answers[q.id]) && (answers[q.id] as string[]).length === 0)
  ).length;
  const totalFillable = visibleQuestions.filter((q) => q.questionType !== 'static_text').length;

  return (
    <div className="page-wrapper" style={{ maxWidth: 700, margin: '0 auto' }}>
      {/* Back link */}
      <Link
        href={participantId ? `/participants/${participantId}` : '/questionnaires'}
        style={{ color: '#64748b', fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 16 }}
      >
        → חזרה
      </Link>

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', margin: 0, marginBottom: 6 }}>
          {template.internalName}
        </h1>
        {participant ? (
          <div style={{ fontSize: 14, color: '#64748b', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 7, padding: '7px 14px', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span>ממלאת עבור:</span>
            <span style={{ fontWeight: 700, color: '#1d4ed8' }}>{displayName(participant)}</span>
            <span style={{ color: '#94a3b8' }}>{participant.phoneNumber}</span>
          </div>
        ) : (
          <div style={{ fontSize: 14, color: '#64748b' }}>
            <span style={{ background: '#fef9c3', color: '#92400e', border: '1px solid #fde68a', borderRadius: 6, padding: '4px 10px', fontSize: 13 }}>
              ממלאת עבור משתתפת חדשה
            </span>
          </div>
        )}

        {/* Progress */}
        <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, height: 4, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${totalFillable > 0 ? (answeredCount / totalFillable) * 100 : 0}%`, background: '#2563eb', borderRadius: 4, transition: 'width 0.3s ease' }} />
          </div>
          <span style={{ fontSize: 13, color: '#64748b', whiteSpace: 'nowrap' }}>{answeredCount} / {totalFillable}</span>
        </div>
      </div>

      {/* New participant fields (shown when no participantId) */}
      {!participantId && (
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '20px 24px', marginBottom: 24 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#374151', marginBottom: 16 }}>פרטי משתתפת חדשה</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <label style={labelStyle}>שם פרטי *</label>
              <input
                style={{ ...inputStyle, borderColor: newParticipantErrors.firstName ? '#fca5a5' : '#cbd5e1' }}
                value={newFirstName}
                onChange={(e) => { setNewFirstName(e.target.value); setNewParticipantErrors((p) => ({ ...p, firstName: undefined })); }}
                placeholder="רחל"
              />
              {newParticipantErrors.firstName && <div style={{ color: '#dc2626', fontSize: 12, marginTop: 3 }}>{newParticipantErrors.firstName}</div>}
            </div>
            <div>
              <label style={labelStyle}>שם משפחה</label>
              <input
                style={inputStyle}
                value={newLastName}
                onChange={(e) => setNewLastName(e.target.value)}
                placeholder="כהן"
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>טלפון *</label>
              <input
                style={{ ...inputStyle, direction: 'ltr', textAlign: 'left', borderColor: newParticipantErrors.phone ? '#fca5a5' : '#cbd5e1' }}
                value={newPhone}
                onChange={(e) => { setNewPhone(e.target.value); setNewParticipantErrors((p) => ({ ...p, phone: undefined })); }}
                placeholder="05X-XXXXXXX"
                inputMode="tel"
              />
              {newParticipantErrors.phone && <div style={{ color: '#dc2626', fontSize: 12, marginTop: 3 }}>{newParticipantErrors.phone}</div>}
            </div>
          </div>
        </div>
      )}

      {/* Smart hiding notice */}
      {hiddenCount > 0 && (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '8px 14px', marginBottom: 16, fontSize: 13, color: '#15803d', display: 'flex', alignItems: 'center', gap: 6 }}>
          ✓ {hiddenCount} שד{hiddenCount === 1 ? 'ה' : 'ות'} מולא{hiddenCount === 1 ? '' : 'ו'} אוטומטית מהפרופיל
        </div>
      )}

      {/* Questions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 32 }}>
        {visibleQuestions.map((q, idx) => (
          <QuestionBlock
            key={q.id}
            index={idx}
            question={q}
            answer={answers[q.id] ?? (q.questionType === 'multi' ? [] : '')}
            onAnswer={(v) => setAnswer(q.id, v)}
            error={errors[q.id] ?? ''}
            touched={touched.has(q.id)}
            onRef={(el) => setQuestionRef(q.id, el)}
          />
        ))}
      </div>

      {/* Submit */}
      {submitError && (
        <div style={{ color: '#dc2626', fontSize: 13, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
          {submitError}
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={submitting}
        style={{
          width: '100%',
          padding: '15px 0',
          background: submitting ? '#93c5fd' : '#2563eb',
          color: '#ffffff',
          border: 'none',
          borderRadius: 12,
          fontSize: 16,
          fontWeight: 700,
          cursor: submitting ? 'not-allowed' : 'pointer',
          fontFamily: 'inherit',
          boxShadow: submitting ? 'none' : '0 4px 12px rgba(37,99,235,0.25)',
        }}
      >
        {submitting ? 'שולח...' : 'שלח שאלון'}
      </button>
    </div>
  );
}
