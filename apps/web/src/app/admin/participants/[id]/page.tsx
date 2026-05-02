'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { use } from 'react';
import { useSearchParams } from 'next/navigation';
import { BASE_URL, apiFetch } from '@lib/api';
import { AdminProjectsTab } from '@components/admin-projects';
import { PaymentsTab } from '@components/payments-tab';
import { ParticipantPrivateChatPopup } from '@components/participant-private-chat-popup';
import { WhatsAppIcon } from '@components/icons/whatsapp-icon';
import {
  PARTICIPANT_LIFECYCLE_STATUSES,
  PARTICIPANT_SOURCES,
  PARTICIPANT_SOURCE_LABELS,
  PARTICIPANT_STATUS_COLORS,
  PARTICIPANT_STATUS_LABELS,
  isKnownLifecycleStatus,
} from '@lib/participant-lifecycle';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Gender { id: string; name: string; }
interface Challenge { id: string; name: string; }
interface Group { id: string; name: string; startDate: string; endDate: string; challenge: Challenge; program?: { id: string; name: string } | null; programId?: string | null; }
interface ParticipantGroup { id: string; joinedAt: string; accessToken: string | null; group: Group & { taskEngineEnabled: boolean }; }

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
  canManageProjects?: boolean;
  // Phase 8 — explicit opt-in for the participant-portal group switcher.
  // Default false; admin flips it via the toggle below the active-groups chips.
  multiGroupEnabled?: boolean;
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

// 'communication' was the old "צ׳אט" tab. Removed in favor of the
// header WhatsApp button which opens the unified chat popup. Kept
// out of Tab here so any old ?tab=communication URL falls back to
// the default (questionnaires) at validation time.
type Tab = 'questionnaires' | 'forms' | 'goals' | 'projects' | 'collected' | 'reports' | 'payments' | 'history' | 'profile';

const VALID_TABS: Tab[] = ['questionnaires', 'forms', 'goals', 'projects', 'collected', 'reports', 'payments', 'history', 'profile'];

interface FormSubmission {
  id: string;
  source: string;
  title: string;
  data: Record<string, string>;
  createdAt: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(iso: string, opts?: Intl.DateTimeFormatOptions): string {
  return new Date(iso).toLocaleDateString('he-IL', opts ?? { year: 'numeric', month: 'short', day: 'numeric' });
}

// Strict DD/MM/YYYY formatter for date-only fields (birthDate, custom
// `date` profile fields). Accepts:
//   - canonical YYYY-MM-DD       ("1995-04-13" → "13/04/1995")
//   - legacy ISO datetime prefix ("1995-04-13T00:00:00.000Z" → "13/04/1995")
// Returns the original string when the input doesn't match either shape,
// so unexpected legacy values surface as themselves rather than as an
// empty cell. Pure string parse — never goes through `new Date()`, so
// no UTC↔local drift can shift the displayed day.
function formatDateOnly(value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return value;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

// Legacy freetext values kept for backwards compatibility — rows created
// before the lifecycle refactor use these Hebrew strings. The edit modal
// renders them as an extra "(ערך קודם)" option when the current value
// doesn't match a canonical lifecycle key.
const LEGACY_STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  'פעיל':          { bg: '#dcfce7', color: '#15803d' },
  'זקוק למעקב':   { bg: '#fef9c3', color: '#854d0e' },
  'לא מגיב':      { bg: '#fef2f2', color: '#dc2626' },
  'סיים תוכנית':  { bg: '#f0fdf4', color: '#166534' },
  'עצר':          { bg: '#f1f5f9', color: '#475569' },
};

function statusStyle(status?: string): React.CSSProperties {
  const fallback = { bg: '#f1f5f9', fg: '#64748b' };
  let c = fallback;
  if (status) {
    if (isKnownLifecycleStatus(status)) {
      c = PARTICIPANT_STATUS_COLORS[status];
    } else {
      const legacy = LEGACY_STATUS_COLORS[status];
      if (legacy) c = { bg: legacy.bg, fg: legacy.color };
    }
  }
  return { background: c.bg, color: c.fg, padding: '3px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600 };
}

function statusLabel(status?: string | null): string {
  if (!status) return '—';
  if (isKnownLifecycleStatus(status)) return PARTICIPANT_STATUS_LABELS[status];
  return status;
}

function sourceLabel(source?: string | null): string {
  if (!source) return '—';
  if ((PARTICIPANT_SOURCES as readonly string[]).includes(source)) {
    return PARTICIPANT_SOURCE_LABELS[source as keyof typeof PARTICIPANT_SOURCE_LABELS];
  }
  return source;
}

// Returns { years, months, label } or null if no birthDate.
// Accepts either YYYY-MM-DD (canonical wire shape) or ISO datetime
// (legacy stored values). Parses the YMD components directly so the
// age computation never depends on the server/browser timezone — the
// previous version went through `new Date(...)` and then `.getDate()`
// (local), so a UTC midnight birthDate could read as the wrong day on
// browsers west of UTC.
function calcAge(birthDateIso?: string): { years: number; months: number; short: string; long: string } | null {
  if (!birthDateIso) return null;
  const m = birthDateIso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const by = Number(m[1]);
  const bm = Number(m[2]);
  const bd = Number(m[3]);
  const now = new Date();
  let years = now.getFullYear() - by;
  let months = now.getMonth() + 1 - bm; // getMonth is 0-indexed
  if (months < 0) { years--; months += 12; }
  if (now.getDate() < bd) { months--; if (months < 0) { years--; months += 11; } }
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

// ─── Goals tab ────────────────────────────────────────────────────────────────

function GoalsTab({ participantId, participantGroups }: {
  participantId: string;
  participantGroups: ParticipantGroup[];
}) {
  const [copied, setCopied] = useState<string | null>(null);

  // Find groups that have task engine enabled and have an accessToken
  const taskGroups = participantGroups.filter((pg) => pg.group.taskEngineEnabled);

  function copyLink(token: string) {
    const url = `${window.location.origin}/tg/${token}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(token);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Participant link — PRIMARY: this is what gets sent to the participant ── */}
      {taskGroups.length > 0 ? (
        <div>
          {/* Section header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>📱 קישור לשליחה למשתתפת</div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>— הפורטל האישי שלה</div>
          </div>
          {/* Instructional note */}
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: '#15803d', lineHeight: 1.5 }}>
            שלחי את הקישור הזה למשתתפת. היא תפתח אותו בנייד ותוכל לנהל את תוכנית העבודה האישית שלה.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {taskGroups.map((pg) => {
              const token = pg.accessToken;
              const url = token ? `${window.location.origin}/tg/${token}` : null;
              return (
                <div key={pg.id} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
                  {/* Group name bar */}
                  <div style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', padding: '8px 14px', fontSize: 12, fontWeight: 600, color: '#374151' }}>
                    {pg.group.name}
                  </div>
                  <div style={{ padding: '12px 14px' }}>
                    {url ? (
                      <>
                        {/* URL display */}
                        <div style={{ fontSize: 12, color: '#64748b', fontFamily: 'monospace', direction: 'ltr' as const, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '7px 10px', marginBottom: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                          {url}
                        </div>
                        {/* Primary CTA */}
                        <button
                          onClick={() => copyLink(token!)}
                          style={{
                            width: '100%', padding: '11px 16px',
                            background: copied === token ? '#f0fdf4' : '#16a34a',
                            border: `1px solid ${copied === token ? '#86efac' : '#16a34a'}`,
                            borderRadius: 8, cursor: 'pointer',
                            fontSize: 14, fontWeight: 700,
                            color: copied === token ? '#15803d' : '#fff',
                          }}
                        >
                          {copied === token ? '✓ הועתק ללוח — שלחי בוואטסאפ' : '📋 העתיקי קישור לשליחה למשתתפת'}
                        </button>
                      </>
                    ) : (
                      <div style={{ fontSize: 13, color: '#f59e0b' }}>
                        טרם נוצר קישור — כנסי לפרופיל הקבוצה ולחצי &ldquo;+ צרי קישור אישי&rdquo;
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1.5px dashed #e2e8f0', borderRadius: 10, padding: '32px 24px', textAlign: 'center' as const, color: '#94a3b8' }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>📅</div>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, color: '#374151' }}>תכנון שבועי לא פעיל עדיין</div>
          <div style={{ fontSize: 13 }}>כדי לאפשר פורטל תכנון אישי, הפעילי את מערכת המשימות בהגדרות הקבוצה</div>
        </div>
      )}

      {/* ── Admin view link — SECONDARY ── */}
      <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 8, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>כלי מנהל</div>
        <a
          href={`/admin/tasks/portal/${participantId}`}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: '#f8fafc', border: '1px solid #e2e8f0',
            borderRadius: 8, padding: '10px 14px',
            color: '#374151', fontSize: 13, fontWeight: 500, textDecoration: 'none',
          }}
        >
          📅 פתח תוכנית שבועית כמנהל
          <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400, marginRight: 'auto' }}>צפייה בלבד — אפשרות עריכה מוגנת</span>
          <span style={{ fontSize: 11, color: '#94a3b8' }}>↗</span>
        </a>
      </div>

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
            <select style={inputStyle} value={form.source} onChange={(e) => onChange('source', e.target.value)}>
              <option value="">— ללא מקור —</option>
              {PARTICIPANT_SOURCES.map((s) => (
                <option key={s} value={s}>{PARTICIPANT_SOURCE_LABELS[s]}</option>
              ))}
              {/* Preserve any pre-lifecycle freetext value so it stays selected
                  until the admin explicitly picks a canonical one. */}
              {form.source && !(PARTICIPANT_SOURCES as readonly string[]).includes(form.source) && (
                <option value={form.source}>{`(ערך קודם: ${form.source})`}</option>
              )}
            </select>
          </div>
          <div>
            <label style={labelStyle}>סטטוס</label>
            <select style={inputStyle} value={form.status} onChange={(e) => onChange('status', e.target.value)}>
              <option value="">— ללא סטטוס —</option>
              {PARTICIPANT_LIFECYCLE_STATUSES.map((s) => (
                <option key={s} value={s}>{PARTICIPANT_STATUS_LABELS[s]}</option>
              ))}
              {form.status && !isKnownLifecycleStatus(form.status) && (
                <option value={form.status}>{`(ערך קודם: ${form.status})`}</option>
              )}
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
  // The WhatsApp send modal is being retired — header now opens the
  // unified chat popup (same component the צ׳אט tab embeds + the
  // group participant-row WA button uses). Old WhatsAppComposeModal
  // stays defined below for backward compat with anything that still
  // imports it, but is no longer triggered from this header.
  const [chatPopupOpen, setChatPopupOpen] = useState(false);
  // Pending PrivateScheduledMessage count for THIS participant.
  // Drives the small "⏰ N" badge next to the header WhatsApp button
  // so the admin sees at a glance there are upcoming DMs queued —
  // same data the צ׳אט tab + group-list badge read from. Refetched
  // when the chat popup closes so cancellations/edits inside the
  // popup update the badge here.
  const [scheduledCount, setScheduledCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<EditForm>({ firstName: '', lastName: '', phoneNumber: '', email: '', birthDate: '', city: '', status: '', notes: '', nextAction: '', source: '' });
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  // Phase 8 — multi-group toggle inline state.
  const [multiGroupBusy, setMultiGroupBusy] = useState(false);
  const [multiGroupErr, setMultiGroupErr] = useState('');

  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [submissionsLoaded, setSubmissionsLoaded] = useState(false);
  const [submissionsLoading, setSubmissionsLoading] = useState(false);

  const [templates, setTemplates] = useState<QuestionnaireTemplate[]>([]);
  const [pickModalOpen, setPickModalOpen] = useState(false);

  const [formSubmissions, setFormSubmissions] = useState<FormSubmission[]>([]);
  const [formSubmissionsLoaded, setFormSubmissionsLoaded] = useState(false);
  const [formSubmissionsLoading, setFormSubmissionsLoading] = useState(false);

  // Load participant
  const reloadParticipant = useCallback(async () => {
    try {
      const data = await apiFetch(`${BASE_URL}/participants/${id}`);
      const p = data as Participant;
      setParticipant(p);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 404) {
        setNotFound(true);
      } else {
        setNotFound(true);
      }
    }
  }, [id]);

  useEffect(() => {
    apiFetch(`${BASE_URL}/participants/${id}`)
      .then((data: unknown) => {
        const p = data as Participant;
        setParticipant(p);
        setForm({ firstName: p.firstName, lastName: p.lastName ?? '', phoneNumber: p.phoneNumber, email: p.email ?? '', birthDate: p.birthDate ? p.birthDate.slice(0, 10) : '', city: p.city ?? '', status: p.status ?? '', notes: p.notes ?? '', nextAction: p.nextAction ?? '', source: p.source ?? '' });
      })
      .catch((err: unknown) => {
        if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 404) {
          setNotFound(true);
        } else {
          setNotFound(true);
        }
      })
      .finally(() => setLoading(false));
  }, [id]);

  // Pending PrivateScheduledMessage count for the header badge.
  // Refetched whenever the chat popup closes (because edits/cancels
  // inside the popup change this number) and on initial mount.
  // Decorative — silent failure is fine, no badge rendered.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await apiFetch<Array<{ status: string }>>(
          `${BASE_URL}/participants/${id}/scheduled-messages`,
          { cache: 'no-store' },
        );
        if (cancelled) return;
        setScheduledCount(list.filter((r) => r.status === 'pending').length);
      } catch {
        if (!cancelled) setScheduledCount(0);
      }
    })();
    return () => { cancelled = true; };
  }, [id, chatPopupOpen]);

  // Prefetch submissions on page load — runs in background while user reads the page.
  // By the time they click the שאלונים or היסטוריה tab, data is already ready.
  useEffect(() => {
    if (submissionsLoaded) return;
    setSubmissionsLoading(true);
    apiFetch(`${BASE_URL}/submissions/by-participant/${id}`)
      .then((data: unknown) => { setSubmissions(data as Submission[]); setSubmissionsLoaded(true); })
      .catch(() => setSubmissions([]))
      .finally(() => setSubmissionsLoading(false));
  }, [id, submissionsLoaded]);

  useEffect(() => {
    if (activeTab !== 'forms' || formSubmissionsLoaded) return;
    setFormSubmissionsLoading(true);
    apiFetch(`${BASE_URL}/participants/${id}/form-submissions`)
      .then((data: unknown) => { setFormSubmissions(data as FormSubmission[]); setFormSubmissionsLoaded(true); })
      .catch(() => setFormSubmissions([]))
      .finally(() => setFormSubmissionsLoading(false));
  }, [id, activeTab, formSubmissionsLoaded]);

  async function openPickModal() {
    setPickModalOpen(true);
    if (templates.length > 0) return;
    const data = await apiFetch(`${BASE_URL}/questionnaires`) as QuestionnaireTemplate[];
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
      const updated = await apiFetch(`${BASE_URL}/participants/${id}`, {
        method: 'PATCH',
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
      setParticipant(updated as Participant);
      setEditOpen(false);
    } catch { setSaveError('שגיאת רשת — נסי שוב'); }
    finally { setSaving(false); }
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'questionnaires', label: 'שאלונים' },
    { key: 'forms',          label: 'טפסים' },
    { key: 'goals',          label: 'מטרות והתקדמות' },
    { key: 'projects',       label: 'פרויקטים' },
    { key: 'collected',      label: 'מידע שנאסף' },
    { key: 'reports',        label: 'דיווחים שוטפים' },
    { key: 'payments',       label: 'תשלומים וחשבונות' },
    { key: 'profile',        label: 'פרופיל' },
    { key: 'history',        label: 'היסטוריה' },
  ];

  if (loading) return <div className="page-wrapper" style={{ textAlign: 'center', paddingTop: 60, color: '#94a3b8' }}>טוען...</div>;
  if (notFound || !participant) {
    return (
      <div className="page-wrapper" style={{ textAlign: 'center', paddingTop: 60 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>😕</div>
        <div style={{ color: '#374151', fontSize: 16, fontWeight: 500 }}>משתתפת לא נמצאה</div>
        <Link href="/admin/participants" style={{ color: '#2563eb', fontSize: 14, marginTop: 12, display: 'inline-block' }}>← חזרה לרשימה</Link>
      </div>
    );
  }

  const activeGroups = (participant.participantGroups ?? []).filter((pg) => {
    const end = new Date(pg.group.endDate);
    return end >= new Date();
  });

  const age = calcAge(participant.birthDate);

  // Phase 8 — flip Participant.multiGroupEnabled. The participant-portal
  // server gates the group switcher on this flag; flipping it on (or off)
  // takes effect on the participant's next page load of /t/:token.
  async function toggleMultiGroup(next: boolean) {
    setMultiGroupBusy(true);
    setMultiGroupErr('');
    try {
      const updated = await apiFetch(`${BASE_URL}/participants/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ multiGroupEnabled: next }),
      });
      setParticipant((prev) => prev ? { ...(updated as Participant), participantGroups: prev.participantGroups } : prev);
    } catch (e) {
      setMultiGroupErr(e instanceof Error ? e.message : 'שמירה נכשלה');
    } finally {
      setMultiGroupBusy(false);
    }
  }

  async function handleProfileImageUpload(file: File) {
    setUploadingImage(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { url } = await apiFetch(`${BASE_URL}/upload`, { method: 'POST', body: fd }) as { url: string };
      const updated = await apiFetch(`${BASE_URL}/participants/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ profileImageUrl: url }),
      });
      setParticipant(updated as Participant);
    } finally {
      setUploadingImage(false);
    }
  }

  return (
    <div className="page-wrapper" style={{ maxWidth: 960, margin: '0 auto' }}>
      <Link href="/admin/participants" style={{ color: '#64748b', fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 18 }}>
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
              {participant.status && <span style={statusStyle(participant.status)}>{statusLabel(participant.status)}</span>}
              {participant.source && (
                <span style={{ background: '#f1f5f9', color: '#475569', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 500 }}>
                  מקור: {sourceLabel(participant.source)}
                </span>
              )}
              {!participant.isActive && <span style={{ background: '#f1f5f9', color: '#64748b', padding: '3px 10px', borderRadius: 20, fontSize: 12 }}>לא פעילה</span>}
            </div>

            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: '#64748b', alignItems: 'center' }}>
              <span dir="ltr">{participant.phoneNumber}</span>
              {participant.email && <span dir="ltr">{participant.email}</span>}
              {participant.city && <span>📍 {participant.city}</span>}
              {age && <AgeTooltip age={age} />}
            </div>

            {/* Active program/group assignments. We surface a warning chip
                for every group that shares its program (or challenge, when
                no program link exists) with another active group — duplicates
                shouldn't normally happen, and when they do, the admin needs
                to see them clearly so they can deactivate the wrong row. */}
            {activeGroups.length > 0 && (() => {
              // Bucket groups by program id (fall back to challenge id) so
              // we know which entries are part of a duplicate set.
              const ctxCount = new Map<string, number>();
              for (const pg of activeGroups) {
                const ctx = pg.group.program?.id ?? pg.group.programId ?? `challenge:${pg.group.challenge.id}`;
                ctxCount.set(ctx, (ctxCount.get(ctx) ?? 0) + 1);
              }
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {activeGroups.map((pg) => {
                      const ctx = pg.group.program?.id ?? pg.group.programId ?? `challenge:${pg.group.challenge.id}`;
                      const isDup = (ctxCount.get(ctx) ?? 0) > 1;
                      return (
                        <div
                          key={pg.id}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 0,
                            background: isDup ? '#eff6ff' : '#f0fdf4',
                            border: `1px solid ${isDup ? '#bfdbfe' : '#bbf7d0'}`,
                            borderRadius: 8, overflow: 'hidden', fontSize: 12,
                          }}
                          title={isDup ? 'המשתתפת רשומה לכמה קבוצות בתוכנית זו (תמיכה במנהלות / צוות).' : undefined}
                        >
                          <span style={{ padding: '5px 10px', color: '#64748b', background: '#f8fafc', borderLeft: `1px solid ${isDup ? '#bfdbfe' : '#bbf7d0'}`, fontWeight: 500 }}>
                            {isDup && <span style={{ marginInlineEnd: 4 }}>👥</span>}
                            תוכנית: <strong style={{ color: '#0f172a' }}>{pg.group.challenge.name}</strong>
                          </span>
                          <span style={{ padding: '5px 10px', color: isDup ? '#1d4ed8' : '#15803d', fontWeight: 600 }}>
                            קבוצה: {pg.group.name}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  {/* Phase 8 — explicit multi-group toggle. Always visible so
                      the admin can opt-in proactively before adding the second
                      group, but the contextual hint only appears when the
                      participant actually has multiple active memberships. */}
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: 12, flexWrap: 'wrap',
                    fontSize: 12,
                    background: participant.multiGroupEnabled ? '#eff6ff' : '#f8fafc',
                    border: `1px solid ${participant.multiGroupEnabled ? '#bfdbfe' : '#e2e8f0'}`,
                    borderRadius: 8, padding: '8px 12px',
                  }}>
                    <div style={{ flex: 1, minWidth: 240 }}>
                      <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: 2 }}>
                        מצב ריבוי קבוצות
                      </div>
                      <div style={{ color: '#475569', lineHeight: 1.5 }}>
                        מאפשר למשתתפת עם כמה קבוצות פעילות באותה תוכנית לעבור ביניהן באפליקציה בלי להחליף לינק.
                      </div>
                      {[...ctxCount.values()].some((n) => n > 1) && participant.multiGroupEnabled && (
                        <div style={{ marginTop: 6, color: '#1d4ed8', fontWeight: 600 }}>
                          👥 כעת מוצג מתג מעבר בין הקבוצות בפורטל המשתתפת.
                        </div>
                      )}
                      {[...ctxCount.values()].some((n) => n > 1) && !participant.multiGroupEnabled && (
                        <div style={{ marginTop: 6, color: '#92400e', fontWeight: 600 }}>
                          המשתתפת חברה בכמה קבוצות אבל המתג כבוי — הפורטל מציג רק את הקבוצה הראשית.
                        </div>
                      )}
                      {multiGroupErr && (
                        <div style={{ marginTop: 6, color: '#b91c1c', fontWeight: 600 }}>{multiGroupErr}</div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => { void toggleMultiGroup(!participant.multiGroupEnabled); }}
                      disabled={multiGroupBusy}
                      aria-pressed={participant.multiGroupEnabled ?? false}
                      style={{
                        padding: '6px 14px', fontSize: 12, fontWeight: 700,
                        background: participant.multiGroupEnabled ? '#fff' : '#1d4ed8',
                        color: participant.multiGroupEnabled ? '#1d4ed8' : '#fff',
                        border: `1px solid ${participant.multiGroupEnabled ? '#bfdbfe' : '#1d4ed8'}`,
                        borderRadius: 999,
                        cursor: multiGroupBusy ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {multiGroupBusy ? '...' : participant.multiGroupEnabled ? 'מופעל — כבי' : 'הפעלי'}
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Quick actions */}
          <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap', alignSelf: 'flex-start' }}>
            {/* WhatsApp action — opens the unified chat popup
                (same component that powers the צ׳אט tab + group
                participant-row WA button). The clock pill on top
                of the green button surfaces upcoming
                PrivateScheduledMessage rows for this participant
                so the admin sees them without having to open the
                tab — same data the chat popup itself shows. */}
            <div style={{ position: 'relative', display: 'inline-flex' }}>
              <button
                onClick={() => setChatPopupOpen(true)}
                title={scheduledCount > 0
                  ? `שליחת WhatsApp · ${scheduledCount} מתוזמנות`
                  : 'שליחת WhatsApp'}
                aria-label="שליחת WhatsApp"
                style={{
                  background: '#16a34a', color: '#fff', border: 'none',
                  borderRadius: '50%', width: 36, height: 36,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 16, cursor: 'pointer', flexShrink: 0,
                }}
              >
                <WhatsAppIcon size={18} color="#fff" />
              </button>
              {scheduledCount > 0 && (
                <button
                  type="button"
                  onClick={() => setChatPopupOpen(true)}
                  title="פתח צ׳אט להציג הודעות מתוזמנות"
                  style={{
                    position: 'absolute',
                    top: -6,
                    insetInlineEnd: -6,
                    background: '#f59e0b',
                    color: '#fff',
                    fontSize: 10,
                    fontWeight: 700,
                    borderRadius: 999,
                    padding: '2px 6px',
                    border: '2px solid #fff',
                    cursor: 'pointer',
                    lineHeight: 1,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 2,
                  }}
                >
                  ⏰ {scheduledCount}
                </button>
              )}
            </div>
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
        {activeTab === 'forms' && (
          <FormsTab submissions={formSubmissions} loading={formSubmissionsLoading} />
        )}
        {activeTab === 'goals' && (
          <GoalsTab participantId={participant.id} participantGroups={participant.participantGroups} />
        )}
        {activeTab === 'projects' && (
          <AdminProjectsTab
            participantId={participant.id}
            canManageProjects={participant.canManageProjects ?? false}
            onPermissionChanged={(next) => {
              // Update local participant state so the toggle reflects the new
              // value without a full refetch. Refetching the whole participant
              // would reset the user's scroll position and feels jumpy.
              setParticipant((prev) => prev ? { ...prev, canManageProjects: next } : prev);
            }}
          />
        )}
        {activeTab === 'collected' && (
          <CollectedInfoTab participant={participant} />
        )}
        {activeTab === 'reports' && (
          <PlaceholderTab icon="📅" title="דיווחים שוטפים" subtitle="כאן יוצגו נתוני דיווח יומי, הרגלים ועמידה ביעדים — בקרוב" />
        )}
        {activeTab === 'payments' && (
          <PaymentsTab
            participantId={participant.id}
            currentGroupIds={participant.participantGroups.map((pg) => pg.group.id)}
            onParticipantChanged={() => void reloadParticipant()}
          />
        )}
        {activeTab === 'profile' && (
          <AdminProfileTab participant={participant} />
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

      {/* WhatsApp chat popup. Replaces the legacy WhatsappComposeModal
          (which is no longer rendered from this surface). Same component
          the צ׳אט tab embeds + the group-list WA button opens — single
          source of truth, single composer, single scheduled-message
          list. */}
      {chatPopupOpen && (
        <ParticipantPrivateChatPopup
          participantId={participant.id}
          participantName={displayName(participant)}
          onClose={() => setChatPopupOpen(false)}
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
                  href={`/admin/questionnaires/${t.id}/fill?participantId=${id}`}
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

// ─── Forms tab ───────────────────────────────────────────────────────────────

function FormsTab({ submissions, loading }: { submissions: FormSubmission[]; loading: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (loading) {
    return <div style={{ color: '#94a3b8', fontSize: 14, padding: '24px 0' }}>טוען...</div>;
  }

  if (submissions.length === 0) {
    return (
      <div style={{ padding: '48px 24px', textAlign: 'center', border: '2px dashed #e2e8f0', borderRadius: 12, color: '#94a3b8', fontSize: 14 }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>📂</div>
        לא נמצאו טפסים מיובאים עבור משתתפת זו
        <div style={{ fontSize: 12, marginTop: 8 }}>ייבא משתתפות מ-CSV בדף המשתתפות כדי לראות כאן נתונים</div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', marginBottom: 20 }}>
        טפסים מיובאים
        <span style={{ fontSize: 13, fontWeight: 400, color: '#64748b', marginRight: 8 }}>{submissions.length} רשומות</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {submissions.map((sub) => {
          const isOpen = openId === sub.id;
          const entries = Object.entries(sub.data);
          return (
            <div
              key={sub.id}
              style={{ border: `1.5px solid ${isOpen ? '#93c5fd' : '#e2e8f0'}`, borderRadius: 12, background: '#fff', overflow: 'hidden' }}
            >
              <button
                onClick={() => setOpenId(isOpen ? null : sub.id)}
                style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', background: isOpen ? '#f0f7ff' : '#fafafa', border: 'none', cursor: 'pointer', textAlign: 'right', gap: 12, fontFamily: 'inherit' }}
              >
                <div style={{ flex: 1, textAlign: 'right' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginBottom: 5 }}>{sub.title}</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, color: '#64748b' }}>
                      {new Date(sub.createdAt).toLocaleDateString('he-IL', { year: 'numeric', month: 'short', day: 'numeric' })}
                    </span>
                    <span style={{ background: '#f0fdf4', color: '#15803d', fontSize: 11, padding: '3px 10px', borderRadius: 20, fontWeight: 600 }}>
                      {sub.source === 'import' ? 'ייבוא CSV' : sub.source}
                    </span>
                    <span style={{ fontSize: 12, color: '#94a3b8' }}>{entries.length} שדות</span>
                  </div>
                </div>
                <span style={{ fontSize: 18, color: '#94a3b8', flexShrink: 0, display: 'inline-block', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▾</span>
              </button>

              {isOpen && (
                <div style={{ borderTop: '1px solid #bfdbfe', padding: '20px 20px' }}>
                  {entries.length === 0 && <div style={{ fontSize: 13, color: '#94a3b8' }}>אין שדות שמורים</div>}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
                    {entries.map(([key, value]) => (
                      <div key={key} style={{ padding: '10px 12px', background: '#f8fafc', borderRadius: 8, border: '1px solid #f1f5f9' }}>
                        <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{key}</div>
                        <div style={{ fontSize: 13, color: '#0f172a', fontWeight: 500, wordBreak: 'break-word' }}>{value || '—'}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
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
    { label: 'תאריך לידה', value: participant.birthDate ? `${formatDateOnly(participant.birthDate)}${age ? ` (גיל ${age.short})` : ''}` : undefined, ltr: true },
    { label: 'עיר', value: participant.city },
    { label: 'מקור', value: sourceLabel(participant.source) },
    { label: 'סטטוס', value: statusLabel(participant.status) },
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

// ─── Admin profile tab — read-only program-by-program snapshot ─────────────
//
// Calls GET /api/admin/participants/:id/profile/:programId for every
// active group's program the participant belongs to. Mirrors what the
// participant herself sees in the portal so admin and participant
// always look at identical data.

interface AdminProfileSnapshot {
  participant: { id: string; firstName: string; lastName: string | null; profileImageUrl: string | null };
  program: { id: string; name: string; profileTabEnabled: boolean };
  fields: Array<{
    id: string; fieldKey: string; label: string; helperText: string | null;
    fieldType: string; isRequired: boolean; isSystemField: boolean; sortOrder: number;
  }>;
  values: Record<string, unknown>;
  files: Record<string, { id: string; url: string; mimeType: string; sizeBytes: number; uploadedAt: string }>;
  missingRequiredCount: number;
  missingRequiredKeys: string[];
}

function AdminProfileTab({ participant }: { participant: Participant }) {
  // Programs the participant is currently active in. We dedupe by
  // program.id (a participant could in theory be in two groups under
  // the same program, though autoJoinGroup now prevents that).
  const programIds = useMemo<string[]>(() => {
    const ids = new Set<string>();
    for (const pg of participant.participantGroups ?? []) {
      const pid = pg.group.program?.id ?? pg.group.programId ?? null;
      if (pid) ids.add(pid);
    }
    return Array.from(ids);
  }, [participant.participantGroups]);

  const [snapshots, setSnapshots] = useState<Record<string, AdminProfileSnapshot | { error: string }>>({});
  const [loading, setLoading] = useState(false);

  // Reload all program snapshots for this participant. Pulled out as
  // a callable so the file-delete button can refresh after a
  // successful DELETE without forcing the admin to reload the page.
  const reloadSnapshots = useCallback(async () => {
    if (programIds.length === 0) return;
    setLoading(true);
    const rows = await Promise.all(programIds.map(async (pid) => {
      try {
        const r = await apiFetch<AdminProfileSnapshot>(
          `${BASE_URL}/admin/participants/${participant.id}/profile/${pid}`,
          { cache: 'no-store' },
        );
        return [pid, r] as const;
      } catch (e) {
        return [pid, { error: e instanceof Error ? e.message : 'טעינה נכשלה' }] as const;
      }
    }));
    const next: Record<string, AdminProfileSnapshot | { error: string }> = {};
    for (const [pid, snap] of rows) next[pid] = snap;
    setSnapshots(next);
    setLoading(false);
  }, [programIds, participant.id]);

  useEffect(() => {
    void reloadSnapshots();
  }, [reloadSnapshots]);

  if (programIds.length === 0) {
    return (
      <div style={{ padding: 28, textAlign: 'center', color: '#64748b' }}>
        המשתתפת אינה משויכת לאף תוכנית פעילה. הוסיפי אותה לקבוצה כדי לראות פרופיל.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {loading && Object.keys(snapshots).length === 0 && (
        <div style={{ color: '#94a3b8', textAlign: 'center', padding: 24 }}>טוען...</div>
      )}
      {programIds.map((pid) => {
        const snap = snapshots[pid];
        if (!snap) return null;
        if ('error' in snap) {
          return (
            <div key={pid} style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: 14, color: '#b91c1c', fontSize: 13 }}>
              שגיאה בטעינת פרופיל לתוכנית {pid}: {snap.error}
            </div>
          );
        }
        return (
          <AdminProfileProgramCard
            key={pid}
            snapshot={snap}
            participantId={participant.id}
            onChanged={() => { void reloadSnapshots(); }}
          />
        );
      })}
    </div>
  );
}

function AdminProfileProgramCard({ snapshot, participantId, onChanged }: {
  snapshot: AdminProfileSnapshot;
  participantId: string;
  onChanged: () => void;
}) {
  // Programs without configured fields show an empty-state message
  // rather than render a card with nothing in it.
  if (snapshot.fields.length === 0) {
    return (
      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>{snapshot.program.name}</div>
        <div style={{ fontSize: 12, color: '#64748b' }}>לא הוגדרו שדות פרופיל לתוכנית זו.</div>
      </div>
    );
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        padding: '12px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0',
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{snapshot.program.name}</div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {!snapshot.program.profileTabEnabled && (
            <span style={{ background: '#f1f5f9', color: '#64748b', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999 }}>
              לשונית מוסתרת מהמשתתפת
            </span>
          )}
          {snapshot.missingRequiredCount > 0 ? (
            <span style={{ background: '#fef3c7', color: '#b45309', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999 }}>
              חסרים {snapshot.missingRequiredCount} שדות חובה
            </span>
          ) : (
            <span style={{ background: '#dcfce7', color: '#15803d', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999 }}>
              הכל מולא
            </span>
          )}
        </div>
      </div>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {snapshot.fields.map((f) => (
          <AdminProfileField
            key={f.id}
            field={f}
            value={snapshot.values[f.fieldKey]}
            files={snapshot.files}
            isMissing={snapshot.missingRequiredKeys.includes(f.fieldKey)}
            participantId={participantId}
            onChanged={onChanged}
          />
        ))}
      </div>
    </div>
  );
}

function AdminProfileField(props: {
  field: AdminProfileSnapshot['fields'][number];
  value: unknown;
  files: AdminProfileSnapshot['files'];
  isMissing: boolean;
  participantId: string;
  onChanged: () => void;
}) {
  const { field, value, files, isMissing, participantId, onChanged } = props;
  const display = renderAdminValue(
    field.fieldType, value, field.isSystemField, files, participantId, onChanged,
  );
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      padding: '10px 12px',
      background: isMissing ? '#fffbeb' : '#fff',
      border: `1px solid ${isMissing ? '#fde68a' : '#e2e8f0'}`,
      borderRadius: 8,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>
          {field.label}
          {field.isRequired && <span style={{ color: '#dc2626', marginInlineStart: 4 }}>*</span>}
          {field.isSystemField && (
            <span style={{ marginInlineStart: 8, background: '#eef2ff', color: '#4338ca', fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 999 }}>שדה מערכת</span>
          )}
          {isMissing && (
            <span style={{ marginInlineStart: 8, background: '#fee2e2', color: '#b91c1c', fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 999 }}>חסר</span>
          )}
        </div>
        {display}
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4, fontFamily: 'monospace' }} dir="ltr">
          {field.fieldKey}
        </div>
      </div>
    </div>
  );
}

function renderAdminValue(
  fieldType: string,
  value: unknown,
  isSystemField: boolean,
  files: AdminProfileSnapshot['files'],
  participantId: string,
  onChanged: () => void,
): React.ReactNode {
  const empty = <span style={{ color: '#94a3b8', fontSize: 13, fontStyle: 'italic' }}>— ריק —</span>;

  if (fieldType === 'text' || fieldType === 'textarea') {
    if (typeof value !== 'string' || !value) return empty;
    return <div style={{ fontSize: 13, color: '#0f172a', whiteSpace: 'pre-wrap' }}>{value}</div>;
  }
  if (fieldType === 'date') {
    if (typeof value !== 'string' || !value) return empty;
    // Defensive: format both canonical YYYY-MM-DD and any legacy ISO
    // datetime that may already be persisted (the wire shape is now
    // canonicalized server-side, but this keeps stale data readable
    // until a re-save canonicalizes it). dir=ltr keeps "13/04/1995"
    // visually adjacent across the row's RTL flow.
    return (
      <div dir="ltr" style={{ fontSize: 13, color: '#0f172a', textAlign: 'right' }}>
        {formatDateOnly(value)}
      </div>
    );
  }
  if (fieldType === 'number') {
    if (typeof value !== 'number') return empty;
    return <div style={{ fontSize: 13, color: '#0f172a' }}>{value.toLocaleString('he-IL')}</div>;
  }
  if (fieldType === 'image') {
    if (typeof value !== 'string' || !value) return empty;
    const url = isSystemField ? value : files[value]?.url;
    if (!url) return empty;
    const src = url.startsWith('/uploads') ? `${API_BASE}${url}` : url;
    // Delete affordance only when the value is a file id (custom
    // image fields). The system profileImageUrl stores a raw URL
    // string, not a file id — so we can't reach the catalog row
    // from here. Operators wanting to remove the avatar should do
    // it via the existing system-field clear flow.
    return (
      <div style={{ position: 'relative', display: 'inline-block' }}>
        <a href={src} target="_blank" rel="noopener noreferrer">
          <img src={src} alt="" style={{ maxHeight: 120, borderRadius: 8, border: '1px solid #e2e8f0' }} />
        </a>
        {!isSystemField && typeof value === 'string' && (
          <FileDeleteButton
            participantId={participantId}
            fileId={value}
            onChanged={onChanged}
          />
        )}
      </div>
    );
  }
  if (fieldType === 'imageGallery') {
    // Mixed media: gallery can hold images OR videos. Render each
    // entry per its file mimeType — videos get a small inline player
    // with controls; images stay as before. Same dimensions either
    // way so the strip layout doesn't reflow.
    if (!Array.isArray(value) || value.length === 0) return empty;
    return (
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {value.map((id) => {
          if (typeof id !== 'string') return null;
          const meta = files[id];
          if (!meta) return null;
          const src = meta.url.startsWith('/uploads') ? `${API_BASE}${meta.url}` : meta.url;
          const isVideo = /^video\//i.test(meta.mimeType);
          return (
            <div key={id} style={{ position: 'relative' }}>
              {isVideo ? (
                <video
                  src={src}
                  style={{ height: 80, width: 80, objectFit: 'cover', borderRadius: 8, border: '1px solid #e2e8f0', background: '#0f172a' }}
                  controls
                  preload="metadata"
                  playsInline
                />
              ) : (
                <a href={src} target="_blank" rel="noopener noreferrer">
                  <img src={src} alt="" style={{ height: 80, width: 80, objectFit: 'cover', borderRadius: 8, border: '1px solid #e2e8f0' }} />
                </a>
              )}
              <FileDeleteButton
                participantId={participantId}
                fileId={id}
                onChanged={onChanged}
              />
            </div>
          );
        })}
      </div>
    );
  }
  return empty;
}

// Admin-only delete button overlaid on a profile / gallery file. On
// confirm, calls DELETE /api/admin/participants/:id/files/:fileId
// which: drops the catalog row, strips dangling references in
// profile values + the avatar column, and (for R2-backed uploads)
// physically removes the underlying R2 object. This is the ONLY UI
// path that triggers a physical R2 delete — the participant portal
// "remove from gallery" flow is detach-only by design.
function FileDeleteButton({
  participantId, fileId, onChanged,
}: { participantId: string; fileId: string; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function onClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    if (!window.confirm('למחוק קובץ זה? המחיקה אינה הפיכה ותמחק גם את הקובץ מהאחסון.')) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(
        `${BASE_URL}/admin/participants/${participantId}/files/${fileId}`,
        { method: 'DELETE' },
      );
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'מחיקה נכשלה');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        type="button"
        onClick={(e) => { void onClick(e); }}
        disabled={busy}
        title="מחיקה"
        aria-label="מחיקה"
        style={{
          position: 'absolute', top: -6, right: -6,
          width: 22, height: 22, borderRadius: 999,
          background: busy ? '#fca5a5' : '#dc2626', color: '#fff',
          border: '2px solid #fff', cursor: busy ? 'not-allowed' : 'pointer',
          fontSize: 13, lineHeight: 1, padding: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
        }}
      >×</button>
      {error && (
        <div style={{
          position: 'absolute', top: 18, right: 0,
          background: '#fee2e2', color: '#991b1b', fontSize: 11,
          padding: '3px 6px', borderRadius: 6,
          border: '1px solid #fecaca', whiteSpace: 'nowrap',
          zIndex: 10,
        }}>{error}</div>
      )}
    </>
  );
}
