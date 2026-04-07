'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { use } from 'react';
import { useSearchParams } from 'next/navigation';
import { BASE_URL } from '@lib/api';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Gender { id: string; name: string; }
interface Challenge { id: string; name: string; }
interface Group { id: string; name: string; startDate: string; endDate: string; challenge: Challenge; }
interface ParticipantGroup { id: string; joinedAt: string; group: Group; }

interface Participant {
  id: string;
  firstName: string;
  lastName?: string | null;
  phoneNumber: string;
  email?: string;
  birthDate?: string;
  city?: string;
  profileImageUrl?: string;
  source?: string;
  status?: string;
  notes?: string;
  nextAction?: string;
  gender: Gender;
  joinedAt: string;
  isActive: boolean;
  participantGroups: ParticipantGroup[];
}

function displayName(p: { firstName: string; lastName?: string | null }): string {
  return [p.firstName, p.lastName].filter(Boolean).join(' ');
}

interface EditForm {
  firstName: string;
  lastName: string;
  phoneNumber: string;
  email: string;
  birthDate: string;
  city: string;
  status: string;
  notes: string;
  nextAction: string;
  source: string;
}

interface QuestionnaireTemplate { id: string; internalName: string; publicTitle: string; isActive: boolean; }

interface SubmissionAnswer {
  id: string;
  value: unknown;
  questionSnapshot: { label: string; questionType: string; sortOrder?: number; internalKey?: string } | null;
  question: { label: string; questionType: string; sortOrder?: number } | null;
}

interface Submission {
  id: string;
  createdAt: string;
  submittedByMode: string;
  template: { id: string; internalName: string; publicTitle: string };
  answers: SubmissionAnswer[];
}

type Tab = 'questionnaires' | 'goals' | 'collected' | 'communication' | 'reports' | 'payments' | 'history';

const VALID_TABS: Tab[] = ['questionnaires', 'goals', 'collected', 'communication', 'reports', 'payments', 'history'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(iso: string, opts?: Intl.DateTimeFormatOptions): string {
  return new Date(iso).toLocaleDateString('he-IL', opts ?? { year: 'numeric', month: 'short', day: 'numeric' });
}

const STATUS_OPTIONS = ['פעיל', 'זקוק למעקב', 'לא מגיב', 'סיים תוכנית', 'עצר'];

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  'פעיל':          { bg: '#dcfce7', color: '#15803d' },
  'זקוק למעקב':   { bg: '#fef9c3', color: '#854d0e' },
  'לא מגיב':      { bg: '#fef2f2', color: '#dc2626' },
  'סיים תוכנית':  { bg: '#f0fdf4', color: '#166534' },
  'עצר':          { bg: '#f1f5f9', color: '#475569' },
};

function statusStyle(status?: string): React.CSSProperties {
  const c = status ? (STATUS_COLORS[status] ?? { bg: '#f1f5f9', color: '#64748b' }) : { bg: '#f1f5f9', color: '#64748b' };
  return { background: c.bg, color: c.color, padding: '3px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600 };
}

// Returns { years, months, label } or null if no birthDate
function calcAge(birthDateIso?: string): { years: number; months: number; short: string; long: string } | null {
  if (!birthDateIso) return null;
  const birth = new Date(birthDateIso);
  const now = new Date();
  let years = now.getFullYear() - birth.getFullYear();
  let months = now.getMonth() - birth.getMonth();
  if (months < 0) { years--; months += 12; }
  if (now.getDate() < birth.getDate()) { months--; if (months < 0) { years--; months += 11; } }
  return { years, months, short: `${years}.${months}`, long: `${years} שנים ו-${months} חודשים` };
}

function AgeTooltip({ age }: { age: { short: string; long: string } }) {
  const [visible, setVisible] = useState(false);
  return (
    <span
      style={{ position: 'relative', cursor: 'default', display: 'inline-flex', alignItems: 'center' }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      גיל {age.short}
      {visible && (
        <span style={{
          position: 'absolute',
          bottom: 'calc(100% + 6px)',
          right: '50%',
          transform: 'translateX(50%)',
          background: '#0f172a',
          color: '#ffffff',
          fontSize: 12,
          padding: '5px 10px',
          borderRadius: 6,
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          zIndex: 100,
          boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
        }}>
          {age.long}
          <span style={{
            position: 'absolute',
            top: '100%',
            right: '50%',
            transform: 'translateX(50%)',
            borderLeft: '5px solid transparent',
            borderRight: '5px solid transparent',
            borderTop: '5px solid #0f172a',
          }} />
        </span>
      )}
    </span>
  );
}

// Proxy prefix — upload images and file requests route through /api-proxy (see next.config.ts).
const API_BASE = '/api-proxy';

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', border: '1px solid #cbd5e1',
  borderRadius: 7, fontSize: 14, color: '#0f172a', background: '#ffffff', boxSizing: 'border-box',
};
const labelStyle: React.CSSProperties = {
  fontSize: 12, color: '#94a3b8', fontWeight: 500, marginBottom: 4, display: 'block',
};

// ─── Submissions accordion ────────────────────────────────────────────────────

function SubmissionsAccordion({
  submissions, loading, onFillClick,
}: { submissions: Submission[]; loading: boolean; onFillClick: () => void; }) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>מענים לשאלונים</div>
          {!loading && <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>{submissions.length} מענים</div>}
        </div>
        <button onClick={onFillClick} style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          + מלא שאלון
        </button>
      </div>

      {loading && <div style={{ color: '#94a3b8', fontSize: 14, padding: '24px 0' }}>טוען...</div>}

      {!loading && submissions.length === 0 && (
        <div style={{ padding: '48px 24px', textAlign: 'center', border: '2px dashed #e2e8f0', borderRadius: 12, color: '#94a3b8', fontSize: 14 }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>📋</div>
          לא נמצאו מענים עבור משתתפת זו
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {submissions.map((sub) => {
          const isOpen = openId === sub.id;
          return (
            <div
              key={sub.id}
              style={{
                border: `1.5px solid ${isOpen ? '#93c5fd' : '#e2e8f0'}`,
                borderRadius: 12,
                background: '#fff',
                overflow: 'hidden',
                boxShadow: isOpen ? '0 2px 12px rgba(37,99,235,0.08)' : 'none',
                transition: 'border-color 0.15s, box-shadow 0.15s',
              }}
            >
              <button
                onClick={() => setOpenId(isOpen ? null : sub.id)}
                style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', background: isOpen ? '#f0f7ff' : '#fafafa', border: 'none', cursor: 'pointer', textAlign: 'right', gap: 12, fontFamily: 'inherit' }}
              >
                <div style={{ flex: 1, minWidth: 0, textAlign: 'right' }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>{sub.template.internalName}</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: '#64748b' }}>
                      {fmt(sub.createdAt, { year: 'numeric', month: 'short', day: 'numeric' })}
                    </span>
                    <span style={{
                      background: sub.submittedByMode === 'internal' ? '#eff6ff' : '#f0fdf4',
                      color: sub.submittedByMode === 'internal' ? '#1d4ed8' : '#15803d',
                      fontSize: 11, padding: '3px 10px', borderRadius: 20, fontWeight: 600,
                    }}>
                      {sub.submittedByMode === 'internal' ? 'פנימי' : 'חיצוני'}
                    </span>
                    <span style={{ fontSize: 12, color: '#94a3b8' }}>{sub.answers.length} תשובות</span>
                  </div>
                </div>
                <span style={{ fontSize: 18, color: '#94a3b8', flexShrink: 0, display: 'inline-block', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▾</span>
              </button>

              {isOpen && (
                <div style={{ borderTop: `1px solid ${isOpen ? '#bfdbfe' : '#f1f5f9'}`, padding: '20px 20px', display: 'flex', flexDirection: 'column', gap: 0 }}>
                  {sub.answers.length === 0 && <div style={{ fontSize: 13, color: '#94a3b8' }}>אין תשובות שמורות</div>}
                  {[...sub.answers].sort((a, b) =>
                    (a.questionSnapshot?.sortOrder ?? a.question?.sortOrder ?? 9999) -
                    (b.questionSnapshot?.sortOrder ?? b.question?.sortOrder ?? 9999)
                  ).map((ans, idx, arr) => {
                    const label = ans.questionSnapshot?.label ?? ans.question?.label ?? '—';
                    const qType = ans.questionSnapshot?.questionType ?? ans.question?.questionType ?? '';
                    const raw = ans.value;
                    const isImage = qType === 'image_upload' && typeof raw === 'string' && raw !== '';
                    const display = Array.isArray(raw) ? raw.join(', ') : raw != null ? String(raw) : '—';
                    const isLast = idx === arr.length - 1;
                    return (
                      <div key={ans.id} style={{ paddingBottom: isLast ? 0 : 20, marginBottom: isLast ? 0 : 20, borderBottom: isLast ? 'none' : '1px solid #f1f5f9' }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6, lineHeight: 1.4 }}>{label}</div>
                        <div style={{ paddingRight: 12, borderRight: '3px solid #e2e8f0' }}>
                          {isImage ? (
                            <img
                              src={display.startsWith('/uploads') ? `${API_BASE}${display}` : display}
                              alt="תשובה"
                              style={{ maxWidth: 200, maxHeight: 150, borderRadius: 8, objectFit: 'cover', display: 'block', cursor: 'pointer' }}
                              onClick={() => window.open(display.startsWith('/uploads') ? `${API_BASE}${display}` : display, '_blank')}
                            />
                          ) : (
                            <div style={{ fontSize: 14, color: display === '—' ? '#94a3b8' : '#0f172a', lineHeight: 1.6 }}>{display}</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── History timeline ─────────────────────────────────────────────────────────

interface TimelineEvent {
  date: string;
  type: 'joined' | 'group' | 'questionnaire';
  title: string;
  description: string;
}

function HistoryTimeline({ participant, submissions }: { participant: Participant; submissions: Submission[] }) {
  const events: TimelineEvent[] = [];

  events.push({
    date: participant.joinedAt,
    type: 'joined',
    title: 'הצטרפה למערכת',
    description: `נוספה כמשתתפת${participant.source ? ` · מקור: ${participant.source}` : ''}`,
  });

  for (const pg of participant.participantGroups ?? []) {
    events.push({
      date: pg.joinedAt,
      type: 'group',
      title: `הצטרפה לקבוצה: ${pg.group.name}`,
      description: `תוכנית: ${pg.group.challenge.name}`,
    });
  }

  for (const sub of submissions) {
    events.push({
      date: sub.createdAt,
      type: 'questionnaire',
      title: `מילאה שאלון: ${sub.template.internalName}`,
      description: sub.submittedByMode === 'internal' ? 'מולא ידנית על ידי הצוות' : 'מולא באופן עצמאי',
    });
  }

  events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const typeConfig: Record<TimelineEvent['type'], { icon: string; dotBg: string; dotBorder: string; accent: string }> = {
    joined:        { icon: '🌱', dotBg: '#f0fdf4', dotBorder: '#4ade80', accent: '#16a34a' },
    group:         { icon: '👥', dotBg: '#eff6ff', dotBorder: '#60a5fa', accent: '#2563eb' },
    questionnaire: { icon: '📋', dotBg: '#fdf4ff', dotBorder: '#c084fc', accent: '#7c3aed' },
  };

  if (events.length === 0) {
    return (
      <div style={{ color: '#94a3b8', fontSize: 14, textAlign: 'center', padding: '48px 0' }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>📅</div>
        אין אירועים להצגה
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', marginBottom: 24 }}>ציר זמן</div>
      <div style={{ position: 'relative', paddingRight: 56 }}>
        {/* Vertical line — RTL: position right side */}
        <div style={{ position: 'absolute', right: 19, top: 8, bottom: 8, width: 2, background: '#e2e8f0' }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {events.map((ev, i) => {
            const cfg = typeConfig[ev.type];
            const isLast = i === events.length - 1;
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 0, paddingBottom: isLast ? 0 : 28 }}>
                {/* Dot — positioned on the right vertical line */}
                <div style={{
                  position: 'absolute',
                  right: 0,
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  background: cfg.dotBg,
                  border: `2px solid ${cfg.dotBorder}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 17,
                  boxShadow: '0 0 0 3px #fff',
                }} />

                {/* Content card */}
                <div style={{ flex: 1, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '14px 18px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 6 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', lineHeight: 1.4 }}>{ev.title}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap', flexShrink: 0, marginTop: 2 }}>
                      {fmt(ev.date, { year: 'numeric', month: 'short', day: 'numeric' })}
                    </div>
                  </div>
                  <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>{ev.description}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Placeholder tab ─────────────────────────────────────────────────────────

function PlaceholderTab({ icon, title, subtitle }: { icon: string; title: string; subtitle: string }) {
  return (
    <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '48px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: 36, marginBottom: 12 }}>{icon}</div>
      <div style={{ color: '#374151', fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{title}</div>
      <div style={{ color: '#94a3b8', fontSize: 13 }}>{subtitle}</div>
    </div>
  );
}

// ─── Edit modal ───────────────────────────────────────────────────────────────

function EditModal({
  form, onChange, onSave, onClose, saving, saveError,
}: {
  form: EditForm;
  onChange: (field: keyof EditForm, value: string) => void;
  onSave: () => void;
  onClose: () => void;
  saving: boolean;
  saveError: string;
}) {
  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}
    >
      <div style={{ background: '#fff', borderRadius: 14, padding: 28, width: '100%', maxWidth: 520, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0 }}>עריכת פרטי משתתפת</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#94a3b8', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div>
            <label style={labelStyle}>שם פרטי *</label>
            <input style={inputStyle} value={form.firstName} onChange={(e) => onChange('firstName', e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>שם משפחה</label>
            <input style={inputStyle} value={form.lastName} onChange={(e) => onChange('lastName', e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>טלפון</label>
            <input style={{ ...inputStyle, direction: 'ltr' }} value={form.phoneNumber} onChange={(e) => onChange('phoneNumber', e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>אימייל</label>
            <input style={{ ...inputStyle, direction: 'ltr' }} type="email" value={form.email} onChange={(e) => onChange('email', e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>תאריך לידה</label>
            <input style={{ ...inputStyle, direction: 'ltr' }} type="date" value={form.birthDate} onChange={(e) => onChange('birthDate', e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>עיר</label>
            <input style={inputStyle} value={form.city} onChange={(e) => onChange('city', e.target.value)} placeholder="תל אביב, חיפה..." />
          </div>
          <div>
            <label style={labelStyle}>מקור</label>
            <input style={inputStyle} value={form.source} onChange={(e) => onChange('source', e.target.value)} placeholder="ממליצה, פייסבוק, אתר..." />
          </div>
          <div>
            <label style={labelStyle}>סטטוס</label>
            <select style={inputStyle} value={form.status} onChange={(e) => onChange('status', e.target.value)}>
              <option value="">— ללא סטטוס —</option>
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>פעולה הבאה</label>
            <input style={inputStyle} value={form.nextAction} onChange={(e) => onChange('nextAction', e.target.value)} placeholder="לדוגמה: לשלוח הודעת מעקב ביום שלישי" />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>הערות</label>
            <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} value={form.notes} onChange={(e) => onChange('notes', e.target.value)} placeholder="מידע נוסף, רקע, הערות..." />
          </div>
        </div>

        {saveError && <div style={{ color: '#dc2626', fontSize: 13, marginTop: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '8px 12px' }}>{saveError}</div>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={onClose} style={{ background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 7, padding: '8px 18px', fontSize: 13, cursor: 'pointer' }}>ביטול</button>
          <button onClick={onSave} disabled={saving} style={{ background: saving ? '#93c5fd' : '#2563eb', color: '#fff', border: 'none', borderRadius: 7, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer' }}>
            {saving ? 'שומר...' : 'שמירה'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ParticipantProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const searchParams = useSearchParams();

  const [participant, setParticipant] = useState<Participant | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const t = searchParams.get('tab') as Tab | null;
    return t && VALID_TABS.includes(t) ? t : 'questionnaires';
  });

  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<EditForm>({ firstName: '', lastName: '', phoneNumber: '', email: '', birthDate: '', city: '', status: '', notes: '', nextAction: '', source: '' });
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [submissionsLoaded, setSubmissionsLoaded] = useState(false);
  const [submissionsLoading, setSubmissionsLoading] = useState(false);

  const [templates, setTemplates] = useState<QuestionnaireTemplate[]>([]);
  const [pickModalOpen, setPickModalOpen] = useState(false);

  // Load participant
  useEffect(() => {
    fetch(`${BASE_URL}/participants/${id}`)
      .then((r) => { if (!r.ok) { setNotFound(true); return null; } return r.json(); })
      .then((data: unknown) => {
        if (data) {
          const p = data as Participant;
          setParticipant(p);
          setForm({ firstName: p.firstName, lastName: p.lastName ?? '', phoneNumber: p.phoneNumber, email: p.email ?? '', birthDate: p.birthDate ? p.birthDate.slice(0, 10) : '', city: p.city ?? '', status: p.status ?? '', notes: p.notes ?? '', nextAction: p.nextAction ?? '', source: p.source ?? '' });
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  // Prefetch submissions on page load — runs in background while user reads the page.
  // By the time they click the שאלונים or היסטוריה tab, data is already ready.
  useEffect(() => {
    if (submissionsLoaded) return;
    setSubmissionsLoading(true);
    fetch(`${BASE_URL}/submissions/by-participant/${id}`)
      .then((r) => r.json())
      .then((data: unknown) => { setSubmissions(data as Submission[]); setSubmissionsLoaded(true); })
      .catch(() => setSubmissions([]))
      .finally(() => setSubmissionsLoading(false));
  }, [id, submissionsLoaded]);

  async function openPickModal() {
    setPickModalOpen(true);
    if (templates.length > 0) return;
    const data = await fetch(`${BASE_URL}/questionnaires`).then((r) => r.json()) as QuestionnaireTemplate[];
    setTemplates(data.filter((t) => t.isActive));
  }

  function openEdit() {
    if (!participant) return;
    setForm({ firstName: participant.firstName, lastName: participant.lastName ?? '', phoneNumber: participant.phoneNumber, email: participant.email ?? '', birthDate: participant.birthDate ? participant.birthDate.slice(0, 10) : '', city: participant.city ?? '', status: participant.status ?? '', notes: participant.notes ?? '', nextAction: participant.nextAction ?? '', source: participant.source ?? '' });
    setSaveError('');
    setEditOpen(true);
  }

  async function handleSave() {
    if (!participant) return;
    setSaving(true);
    setSaveError('');
    try {
      const res = await fetch(`${BASE_URL}/participants/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: form.firstName,
          lastName: form.lastName || undefined,
          phoneNumber: form.phoneNumber,
          email: form.email || undefined,
          birthDate: form.birthDate || undefined,
          city: form.city || undefined,
          status: form.status || undefined,
          notes: form.notes || undefined,
          nextAction: form.nextAction || undefined,
          source: form.source || undefined,
        }),
      });
      if (!res.ok) { setSaveError('שגיאה בשמירה — נסי שוב'); return; }
      const updated = await res.json();
      setParticipant(updated as Participant);
      setEditOpen(false);
    } catch { setSaveError('שגיאת רשת — נסי שוב'); }
    finally { setSaving(false); }
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'questionnaires', label: 'שאלונים' },
    { key: 'goals',          label: 'מטרות והתקדמות' },
    { key: 'collected',      label: 'מידע שנאסף' },
    { key: 'communication',  label: 'תקשורת' },
    { key: 'reports',        label: 'דיווחים שוטפים' },
    { key: 'payments',       label: 'תשלומים וחשבונות' },
    { key: 'history',        label: 'היסטוריה' },
  ];

  if (loading) return <div className="page-wrapper" style={{ textAlign: 'center', paddingTop: 60, color: '#94a3b8' }}>טוען...</div>;
  if (notFound || !participant) {
    return (
      <div className="page-wrapper" style={{ textAlign: 'center', paddingTop: 60 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>😕</div>
        <div style={{ color: '#374151', fontSize: 16, fontWeight: 500 }}>משתתפת לא נמצאה</div>
        <Link href="/participants" style={{ color: '#2563eb', fontSize: 14, marginTop: 12, display: 'inline-block' }}>← חזרה לרשימה</Link>
      </div>
    );
  }

  const activeGroups = (participant.participantGroups ?? []).filter((pg) => {
    const end = new Date(pg.group.endDate);
    return end >= new Date();
  });

  const age = calcAge(participant.birthDate);

  async function handleProfileImageUpload(file: File) {
    setUploadingImage(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${API_BASE}/api/upload`, { method: 'POST', body: fd });
      if (!res.ok) return;
      const { url } = await res.json() as { url: string };
      const patchRes = await fetch(`${BASE_URL}/participants/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileImageUrl: url }),
      });
      if (!patchRes.ok) return;
      const updated = await patchRes.json();
      setParticipant(updated as Participant);
    } finally {
      setUploadingImage(false);
    }
  }

  return (
    <div className="page-wrapper" style={{ maxWidth: 960, margin: '0 auto' }}>
      <Link href="/participants" style={{ color: '#64748b', fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 18 }}>
        → חזרה לרשימה
      </Link>

      {/* ═══════════════════════════════════════════════════════════════
          LAYER 1 — Basic info
      ═══════════════════════════════════════════════════════════════ */}
      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '20px 24px', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 18, flexWrap: 'wrap' }}>
          {/* Avatar / profile image */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            {/* Hidden file input — triggered from modal or no-image click */}
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleProfileImageUpload(f); e.target.value = ''; }}
            />
            {participant.profileImageUrl ? (
              <div
                onClick={() => setImagePreviewOpen(true)}
                style={{ cursor: 'pointer', position: 'relative', display: 'block' }}
                title="לחץ לצפייה בתמונה"
              >
                <img
                  src={participant.profileImageUrl.startsWith('/uploads') ? `${API_BASE}${participant.profileImageUrl}` : participant.profileImageUrl}
                  alt={displayName(participant)}
                  style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover', border: '2px solid #e2e8f0', display: 'block' }}
                />
                {uploadingImage && (
                  <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#64748b' }}>...</div>
                )}
                <div style={{ position: 'absolute', bottom: 0, left: 0, width: 20, height: 20, borderRadius: '50%', background: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#fff', border: '2px solid #fff' }}>🔍</div>
              </div>
            ) : (
              <div
                onClick={() => imageInputRef.current?.click()}
                style={{ cursor: 'pointer', width: 64, height: 64, borderRadius: '50%', background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, border: '2px solid #bfdbfe', position: 'relative' }}
                title="לחץ להוספת תמונה"
              >
                {uploadingImage ? <span style={{ fontSize: 11, color: '#64748b' }}>...</span> : '👤'}
                <div style={{ position: 'absolute', bottom: 0, left: 0, width: 20, height: 20, borderRadius: '50%', background: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#fff', border: '2px solid #fff' }}>✏</div>
              </div>
            )}
          </div>

          {/* Image preview modal */}
          {imagePreviewOpen && participant.profileImageUrl && (
            <div
              onClick={() => setImagePreviewOpen(false)}
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{ background: '#ffffff', borderRadius: 16, padding: 24, maxWidth: 420, width: '100%', textAlign: 'center' }}
              >
                <img
                  src={participant.profileImageUrl.startsWith('/uploads') ? `${API_BASE}${participant.profileImageUrl}` : participant.profileImageUrl}
                  alt={displayName(participant)}
                  style={{ maxWidth: '100%', maxHeight: 320, borderRadius: 12, objectFit: 'contain', marginBottom: 18 }}
                />
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                  <button
                    onClick={() => { setImagePreviewOpen(false); imageInputRef.current?.click(); }}
                    style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                  >
                    החלף תמונה
                  </button>
                  <button
                    onClick={() => setImagePreviewOpen(false)}
                    style={{ background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 20px', fontSize: 14, cursor: 'pointer' }}
                  >
                    סגור
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Name + details */}
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
              <h1 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', margin: 0 }}>{displayName(participant)}</h1>
              {participant.status && <span style={statusStyle(participant.status)}>{participant.status}</span>}
              {!participant.isActive && <span style={{ background: '#f1f5f9', color: '#64748b', padding: '3px 10px', borderRadius: 20, fontSize: 12 }}>לא פעילה</span>}
            </div>

            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: '#64748b', alignItems: 'center' }}>
              <span dir="ltr">{participant.phoneNumber}</span>
              {participant.email && <span dir="ltr">{participant.email}</span>}
              {participant.city && <span>📍 {participant.city}</span>}
              {age && <AgeTooltip age={age} />}
            </div>

            {/* Active program/group assignments */}
            {activeGroups.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                {activeGroups.map((pg) => (
                  <div key={pg.id} style={{ display: 'flex', alignItems: 'center', gap: 0, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, overflow: 'hidden', fontSize: 12 }}>
                    <span style={{ padding: '5px 10px', color: '#64748b', background: '#f8fafc', borderLeft: '1px solid #bbf7d0', fontWeight: 500 }}>
                      תוכנית: <strong style={{ color: '#0f172a' }}>{pg.group.challenge.name}</strong>
                    </span>
                    <span style={{ padding: '5px 10px', color: '#15803d', fontWeight: 600 }}>
                      קבוצה: {pg.group.name}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick actions */}
          <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap', alignSelf: 'flex-start' }}>
            <button
              onClick={openPickModal}
              style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 18px', fontSize: 14, cursor: 'pointer', fontWeight: 600, minHeight: 42 }}
            >
              📋 מלא שאלון
            </button>
            <button
              onClick={openEdit}
              style={{ background: '#ffffff', color: '#374151', border: '1.5px solid #e2e8f0', borderRadius: 8, padding: '10px 18px', fontSize: 14, cursor: 'pointer', fontWeight: 500, minHeight: 42 }}
            >
              ✏️ עריכה
            </button>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          LAYER 2 — Snapshot / Brief
      ═══════════════════════════════════════════════════════════════ */}
      {(participant.notes || participant.status || participant.nextAction) && (
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '20px 24px', marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>
            סיכום מהיר
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {participant.status && (
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 16, width: 24, flexShrink: 0, marginTop: 1 }}>📈</span>
                <div>
                  <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, marginBottom: 2 }}>מצב נוכחי</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{participant.status}</div>
                </div>
              </div>
            )}
            {participant.notes && (
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 16, width: 24, flexShrink: 0, marginTop: 1 }}>🎯</span>
                <div>
                  <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, marginBottom: 2 }}>מטרה / הערה</div>
                  <div style={{ fontSize: 14, color: '#374151', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{participant.notes.split('\n').slice(0, 3).join('\n')}</div>
                </div>
              </div>
            )}
            {participant.nextAction && (
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px', marginTop: 4 }}>
                <span style={{ fontSize: 16, width: 24, flexShrink: 0, marginTop: 1 }}>👉</span>
                <div>
                  <div style={{ fontSize: 11, color: '#92400e', fontWeight: 700, marginBottom: 2 }}>פעולה הבאה</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#92400e' }}>{participant.nextAction}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          TABS
      ═══════════════════════════════════════════════════════════════ */}
      <div style={{ display: 'flex', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px 10px 0 0', overflow: 'hidden', overflowX: 'auto' }}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              flexShrink: 0,
              padding: '12px 16px',
              border: 'none',
              borderBottom: activeTab === tab.key ? '2px solid #2563eb' : '2px solid transparent',
              background: 'transparent',
              color: activeTab === tab.key ? '#2563eb' : '#64748b',
              fontWeight: activeTab === tab.key ? 600 : 400,
              fontSize: 13,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderTop: 'none', borderRadius: '0 0 10px 10px', padding: 24 }}>
        {activeTab === 'questionnaires' && (
          <SubmissionsAccordion submissions={submissions} loading={submissionsLoading} onFillClick={openPickModal} />
        )}
        {activeTab === 'goals' && (
          <PlaceholderTab icon="🎯" title="מטרות והתקדמות" subtitle="כאן יוצגו מטרות, אתגרים פעילים ומדדי התקדמות — בקרוב" />
        )}
        {activeTab === 'collected' && (
          <CollectedInfoTab participant={participant} />
        )}
        {activeTab === 'communication' && (
          <PlaceholderTab icon="💬" title="תקשורת" subtitle="היסטוריית שיחות WhatsApp, הודעות שנשלחו ותגובות — בקרוב" />
        )}
        {activeTab === 'reports' && (
          <PlaceholderTab icon="📅" title="דיווחים שוטפים" subtitle="כאן יוצגו נתוני דיווח יומי, הרגלים ועמידה ביעדים — בקרוב" />
        )}
        {activeTab === 'payments' && (
          <PlaceholderTab icon="💳" title="תשלומים וחשבונות" subtitle="מעקב תשלומים, חשבוניות וסטטוס פיננסי — בקרוב" />
        )}
        {activeTab === 'history' && (
          <HistoryTimeline participant={participant} submissions={submissions} />
        )}
      </div>

      {/* Edit modal */}
      {editOpen && (
        <EditModal
          form={form}
          onChange={(field, value) => setForm((prev) => ({ ...prev, [field]: value }))}
          onSave={handleSave}
          onClose={() => setEditOpen(false)}
          saving={saving}
          saveError={saveError}
        />
      )}

      {/* Template picker modal */}
      {pickModalOpen && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setPickModalOpen(false); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}
        >
          <div style={{ background: '#fff', borderRadius: 14, padding: 24, width: '100%', maxWidth: 460, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', maxHeight: '80vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0 }}>בחרי שאלון למילוי</h2>
              <button onClick={() => setPickModalOpen(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#94a3b8' }}>×</button>
            </div>
            {templates.length === 0 && <div style={{ color: '#94a3b8', fontSize: 14, textAlign: 'center', padding: '20px 0' }}>אין שאלונים פעילים</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {templates.map((t) => (
                <Link
                  key={t.id}
                  href={`/questionnaires/${t.id}/fill?participantId=${id}`}
                  onClick={() => setPickModalOpen(false)}
                  style={{ display: 'block', padding: '12px 16px', border: '1px solid #e2e8f0', borderRadius: 8, background: '#ffffff', cursor: 'pointer', textDecoration: 'none' }}
                >
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', marginBottom: 2 }}>{t.internalName}</div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>{t.publicTitle}</div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Collected info tab ───────────────────────────────────────────────────────

function CollectedInfoTab({ participant }: { participant: Participant }) {
  const age = calcAge(participant.birthDate);
  const fields = [
    { label: 'שם פרטי', value: participant.firstName },
    { label: 'שם משפחה', value: participant.lastName ?? '—' },
    { label: 'טלפון', value: participant.phoneNumber, ltr: true },
    { label: 'אימייל', value: participant.email, ltr: true },
    { label: 'מגדר', value: participant.gender?.name },
    { label: 'תאריך לידה', value: participant.birthDate ? `${fmt(participant.birthDate)}${age ? ` (גיל ${age.short})` : ''}` : undefined },
    { label: 'עיר', value: participant.city },
    { label: 'מקור', value: participant.source },
    { label: 'סטטוס', value: participant.status },
    { label: 'הצטרפה', value: fmt(participant.joinedAt) },
  ].filter((f) => f.value);

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {fields.map((f) => (
          <div key={f.label} style={{ padding: '12px 14px', background: '#f8fafc', borderRadius: 8, border: '1px solid #f1f5f9' }}>
            <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{f.label}</div>
            <div style={{ fontSize: 14, color: '#0f172a', fontWeight: 500 }} dir={f.ltr ? 'ltr' : undefined}>{f.value}</div>
          </div>
        ))}
      </div>
      {participant.notes && (
        <div style={{ marginTop: 16, padding: '14px 16px', background: '#f8fafc', borderRadius: 8, border: '1px solid #f1f5f9' }}>
          <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>הערות</div>
          <div style={{ fontSize: 14, color: '#374151', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{participant.notes}</div>
        </div>
      )}
    </div>
  );
}
