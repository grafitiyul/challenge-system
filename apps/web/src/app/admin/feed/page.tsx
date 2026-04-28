'use client';

// Admin feed audit page — full visibility into every FeedEvent.
// No 48-hour limit, no isPublic filter (hidden events shown alongside
// public ones with a clear chip), no truncation. Filters by program,
// group, participant, type, and visibility live above the list.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { BASE_URL, apiFetch } from '@lib/api';

interface FeedRow {
  id: string;
  type: string;
  message: string;
  points: number;
  isPublic: boolean;
  createdAt: string;
  logId: string | null;
  log: {
    id: string;
    value: string;
    status: string;
    actionName: string;
    actionInputType: string | null;
  } | null;
  participant: { id: string; firstName: string; lastName: string | null } | null;
  group: { id: string; name: string } | null;
  program: { id: string; name: string } | null;
}

// Page envelope returned by /api/admin/feed-events.
interface FeedPage {
  rows: FeedRow[];
  total: number;
  skip: number;
  take: number;
  hasMore: boolean;
}

interface ProgramLite { id: string; name: string }
interface GroupLite { id: string; name: string; programId?: string | null; program?: { id: string; name: string } | null }
interface ParticipantLite { id: string; firstName: string; lastName?: string | null }

const TYPE_LABEL: Record<string, string> = {
  action: 'דיווח פעולה',
  rare: 'בונוס נדיר',
  system: 'הודעת מערכת',
};

// Default page size matches the server default. Admin can pick a
// larger size from the dropdown to avoid pagination entirely on
// medium datasets, and the server hard ceiling of 2000 protects the
// payload against pathological values.
const PAGE_SIZE_OPTIONS = [200, 500, 1000, 2000] as const;
const DEFAULT_PAGE_SIZE = 500;

export default function AdminFeedPage() {
  const [rows, setRows] = useState<FeedRow[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const [programs, setPrograms] = useState<ProgramLite[]>([]);
  const [groups, setGroups] = useState<GroupLite[]>([]);
  const [participants, setParticipants] = useState<ParticipantLite[]>([]);

  const [programId, setProgramId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [participantId, setParticipantId] = useState('');
  const [type, setType] = useState('');
  const [visibility, setVisibility] = useState<'all' | 'public' | 'hidden'>('all');
  const [skip, setSkip] = useState(0);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);

  // Row-action modals — both locked: no backdrop close, explicit X.
  // The shape carries the row so the modal text can spell out exactly
  // what's being touched (log-linked vs standalone).
  const [voidTarget, setVoidTarget] = useState<FeedRow | null>(null);
  const [editTarget, setEditTarget] = useState<FeedRow | null>(null);

  // Load filter options once.
  useEffect(() => {
    apiFetch<ProgramLite[]>(`${BASE_URL}/programs`).then(setPrograms).catch(() => setPrograms([]));
    apiFetch<GroupLite[]>(`${BASE_URL}/groups?includeArchived=true`).then(setGroups).catch(() => setGroups([]));
    apiFetch<ParticipantLite[]>(`${BASE_URL}/participants`).then((r) => setParticipants(r.slice(0, 1000))).catch(() => setParticipants([]));
  }, []);

  const filteredGroups = useMemo(() => {
    if (!programId) return groups;
    return groups.filter((g) => (g.program?.id ?? g.programId) === programId);
  }, [groups, programId]);

  const reload = useCallback(() => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (programId) qs.set('programId', programId);
    if (groupId) qs.set('groupId', groupId);
    if (participantId) qs.set('participantId', participantId);
    if (type) qs.set('type', type);
    if (visibility !== 'all') qs.set('visibility', visibility);
    qs.set('take', String(pageSize));
    qs.set('skip', String(skip));
    apiFetch<FeedPage>(`${BASE_URL}/admin/feed-events?${qs.toString()}`, { cache: 'no-store' })
      .then((r) => {
        setRows(r.rows);
        setTotal(r.total);
        setHasMore(r.hasMore);
        setErr('');
      })
      .catch((e) => setErr(e instanceof Error ? e.message : 'טעינה נכשלה'))
      .finally(() => setLoading(false));
  }, [programId, groupId, participantId, type, visibility, skip, pageSize]);

  useEffect(() => { reload(); }, [reload]);

  function clearFilters() {
    setProgramId(''); setGroupId(''); setParticipantId(''); setType(''); setVisibility('all'); setSkip(0);
  }

  // Display range "X-Y מתוך Z". X and Y are 1-based for human readers.
  const fromIndex = total === 0 ? 0 : skip + 1;
  const toIndex = skip + rows.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  const currentPage = Math.floor(skip / pageSize) + 1;

  const select: React.CSSProperties = {
    padding: '7px 12px', fontSize: 13, border: '1px solid #e2e8f0',
    borderRadius: 8, background: '#fff', minWidth: 160, color: '#0f172a',
  };

  return (
    <div className="page-wrapper" style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>מבזק — תיעוד מלא</h1>
        <p style={{ color: '#64748b', fontSize: 14, margin: '4px 0 0' }}>
          כל אירועי הפיד במערכת, כולל אירועים מוסתרים (נמחקו / הוחלפו). אין מגבלת זמן. שורות מוסתרות מסומנות.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <select style={select} value={programId} onChange={(e) => { setProgramId(e.target.value); setGroupId(''); setSkip(0); }}>
          <option value="">תוכנית: הכל</option>
          {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select style={select} value={groupId} onChange={(e) => { setGroupId(e.target.value); setSkip(0); }}>
          <option value="">קבוצה: הכל</option>
          {filteredGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <select style={select} value={participantId} onChange={(e) => { setParticipantId(e.target.value); setSkip(0); }}>
          <option value="">משתתפת: הכל</option>
          {participants.map((p) => (
            <option key={p.id} value={p.id}>{p.firstName}{p.lastName ? ` ${p.lastName}` : ''}</option>
          ))}
        </select>
        <select style={select} value={type} onChange={(e) => { setType(e.target.value); setSkip(0); }}>
          <option value="">סוג: הכל</option>
          <option value="action">דיווח פעולה</option>
          <option value="rare">בונוס נדיר</option>
          <option value="system">הודעת מערכת</option>
        </select>
        <select style={select} value={visibility} onChange={(e) => { setVisibility(e.target.value as 'all' | 'public' | 'hidden'); setSkip(0); }}>
          <option value="all">נראות: הכל</option>
          <option value="public">גלוי</option>
          <option value="hidden">מוסתר</option>
        </select>
        <select
          style={select}
          value={pageSize}
          onChange={(e) => { setPageSize(Number(e.target.value)); setSkip(0); }}
          title="כמה רשומות לטעון בעת ובעונה אחת"
        >
          {PAGE_SIZE_OPTIONS.map((n) => (
            <option key={n} value={n}>{`גודל דף: ${n}`}</option>
          ))}
        </select>
        <button
          onClick={clearFilters}
          style={{ padding: '7px 14px', fontSize: 13, fontWeight: 600, background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 8, cursor: 'pointer', color: '#475569' }}
        >ניקוי סינון</button>
      </div>

      {/* Explicit results-summary strip — always visible (never relies
          on a full page to signal that more rows exist). Reads cleanly
          even when total < pageSize. */}
      {!loading && total > 0 && (
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 12, flexWrap: 'wrap',
            background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8,
            padding: '8px 12px', marginBottom: 10, fontSize: 12, color: '#475569',
          }}
        >
          <span>
            מציג <strong style={{ color: '#0f172a' }}>{fromIndex.toLocaleString('he-IL')}-{toIndex.toLocaleString('he-IL')}</strong>
            {' '}מתוך{' '}
            <strong style={{ color: '#0f172a' }}>{total.toLocaleString('he-IL')}</strong>
            {' '}רשומות (דף {currentPage} מתוך {totalPages})
          </span>
          <span style={{
            background: hasMore ? '#fef3c7' : '#dcfce7',
            color: hasMore ? '#92400e' : '#15803d',
            padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700,
          }}>
            {hasMore ? `יש עוד ${Math.max(0, total - toIndex).toLocaleString('he-IL')} רשומות` : 'נטענו כל הרשומות'}
          </span>
        </div>
      )}

      {loading && <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>טוען...</div>}
      {err && <div style={{ padding: 16, color: '#b91c1c' }}>{err}</div>}
      {!loading && rows.length === 0 && !err && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 40, textAlign: 'center', color: '#64748b' }}>
          לא נמצאו אירועי פיד תואמים.
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              {/* Column order תוכנית → קבוצה → משתתפת — wider context
                  reads left-to-right (in RTL, right-to-left visually):
                  program first, then group, then the specific participant. */}
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'right' }}>
                <th style={th}>זמן</th>
                <th style={th}>סוג</th>
                <th style={th}>תוכנית</th>
                <th style={th}>קבוצה</th>
                <th style={th}>משתתפת</th>
                <th style={th}>הודעה</th>
                <th style={th}>נקודות</th>
                <th style={th}>נראות</th>
                <th style={th}>logId</th>
                <th style={th}>פעולות</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  style={{
                    borderBottom: '1px solid #f1f5f9',
                    background: r.isPublic ? '#fff' : '#fff7ed',
                    opacity: r.isPublic ? 1 : 0.85,
                  }}
                >
                  <td style={td}>{formatWhen(r.createdAt)}</td>
                  <td style={td}>{TYPE_LABEL[r.type] ?? r.type}</td>
                  <td style={td}>
                    {r.program ? (
                      <Link href={`/admin/programs/${r.program.id}`} style={{ color: '#2563eb', textDecoration: 'none' }}>{r.program.name}</Link>
                    ) : '—'}
                  </td>
                  <td style={td}>
                    {r.group ? (
                      <Link href={`/admin/groups/${r.group.id}`} style={{ color: '#2563eb', textDecoration: 'none' }}>{r.group.name}</Link>
                    ) : '—'}
                  </td>
                  <td style={td}>
                    {r.participant ? (
                      <Link href={`/admin/participants/${r.participant.id}`} style={{ color: '#2563eb', textDecoration: 'none' }}>
                        {r.participant.firstName}{r.participant.lastName ? ` ${r.participant.lastName}` : ''}
                      </Link>
                    ) : '—'}
                  </td>
                  <td style={{ ...td, maxWidth: 320 }}>{r.message}</td>
                  <td style={td}>
                    {r.points !== 0 ? (
                      <span style={{ color: r.points > 0 ? '#15803d' : '#b91c1c', fontWeight: 600 }}>
                        {r.points > 0 ? `+${r.points}` : r.points}
                      </span>
                    ) : '—'}
                  </td>
                  <td style={td}>
                    <span style={{
                      background: r.isPublic ? '#dcfce7' : '#fed7aa',
                      color: r.isPublic ? '#15803d' : '#9a3412',
                      padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600,
                    }}>
                      {r.isPublic ? 'גלוי' : 'מוסתר'}
                    </span>
                  </td>
                  <td style={{ ...td, fontFamily: 'monospace', direction: 'ltr', fontSize: 11, color: '#64748b' }}>
                    {r.logId ?? '—'}
                  </td>
                  <td style={td}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      {/* Edit: only useful for log-linked rows or non-
                          hidden standalone rows. We keep it always
                          available — the modal explains the case. */}
                      <button
                        type="button"
                        onClick={() => setEditTarget(r)}
                        style={btnEdit}
                      >ערוך</button>
                      {/* Delete: a no-op for already-hidden rows
                          (server is idempotent for log-voided rows;
                          standalone hidden rows have nothing to do). */}
                      <button
                        type="button"
                        onClick={() => setVoidTarget(r)}
                        disabled={!r.isPublic && !r.logId}
                        title={!r.isPublic && !r.logId ? 'הרשומה כבר מוסתרת' : undefined}
                        style={{ ...btnDelete, ...(!r.isPublic && !r.logId ? btnDisabled : {}) }}
                      >מחק / הסתר</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination — always visible whenever there are matching rows.
          "Next" disabled when no more rows; "Prev" disabled on page 1.
          A clear counter is rendered in the summary strip above so the
          admin never has to guess whether silent truncation happened. */}
      {!loading && total > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 14 }}>
          <button
            onClick={() => setSkip((sk) => Math.max(0, sk - pageSize))}
            disabled={skip === 0}
            style={{ padding: '7px 14px', fontSize: 13, fontWeight: 600, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, cursor: skip === 0 ? 'not-allowed' : 'pointer', opacity: skip === 0 ? 0.5 : 1 }}
          >חדשים יותר →</button>
          <span style={{ fontSize: 12, color: '#64748b' }}>
            דף {currentPage} מתוך {totalPages}
          </span>
          <button
            onClick={() => setSkip((sk) => sk + pageSize)}
            disabled={!hasMore}
            style={{ padding: '7px 14px', fontSize: 13, fontWeight: 600, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, cursor: hasMore ? 'pointer' : 'not-allowed', opacity: hasMore ? 1 : 0.5 }}
          >← ישנים יותר</button>
        </div>
      )}

      {voidTarget && (
        <VoidModal
          row={voidTarget}
          onClose={() => setVoidTarget(null)}
          onDone={() => { setVoidTarget(null); reload(); }}
        />
      )}
      {editTarget && (
        <EditModal
          row={editTarget}
          onClose={() => setEditTarget(null)}
          onDone={() => { setEditTarget(null); reload(); }}
        />
      )}
    </div>
  );
}

const th: React.CSSProperties = { padding: '10px 12px', fontWeight: 700, color: '#374151', fontSize: 12 };
const td: React.CSSProperties = { padding: '10px 12px', verticalAlign: 'top', color: '#0f172a' };
const btnEdit: React.CSSProperties = {
  padding: '5px 10px', fontSize: 12, fontWeight: 600,
  background: '#eff6ff', color: '#1d4ed8',
  border: '1px solid #bfdbfe', borderRadius: 6, cursor: 'pointer',
};
const btnDelete: React.CSSProperties = {
  padding: '5px 10px', fontSize: 12, fontWeight: 600,
  background: '#fff', color: '#b91c1c',
  border: '1px solid #fecaca', borderRadius: 6, cursor: 'pointer',
};
const btnDisabled: React.CSSProperties = { opacity: 0.4, cursor: 'not-allowed' };

// ─── Locked in-app modal ─────────────────────────────────────────────────
// No backdrop close (clicks outside the card don't dismiss). Explicit X
// button. No browser confirm/alert anywhere in this surface.
function ModalShell(props: { title: string; busy?: boolean; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 16 }}
      role="dialog"
      aria-modal="true"
    >
      <div style={{ background: '#fff', borderRadius: 12, padding: 22, width: '100%', maxWidth: 460, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: '#0f172a' }}>{props.title}</h3>
          <button
            type="button"
            onClick={props.onClose}
            disabled={props.busy}
            aria-label="סגור"
            style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 22, cursor: props.busy ? 'not-allowed' : 'pointer', lineHeight: 1 }}
          >×</button>
        </div>
        {props.children}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
          {props.footer}
        </div>
      </div>
    </div>
  );
}

// ─── Void / hide ─────────────────────────────────────────────────────────
function VoidModal({ row, onClose, onDone }: { row: FeedRow; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const isLogLinked = !!row.logId;

  async function submit() {
    setBusy(true); setErr('');
    try {
      await apiFetch(`${BASE_URL}/admin/feed-events/${row.id}/void`, { method: 'POST' });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'הפעולה נכשלה');
    } finally { setBusy(false); }
  }

  return (
    <ModalShell
      title={isLogLinked ? 'מחיקת דיווח (משפיע על ניקוד)' : 'הסתרת מבזק בלבד'}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} disabled={busy} style={{ padding: '8px 16px', background: '#f1f5f9', border: '1px solid #e2e8f0', color: '#374151', borderRadius: 8, fontSize: 13, cursor: busy ? 'not-allowed' : 'pointer' }}>
            ביטול
          </button>
          <button onClick={submit} disabled={busy} style={{ padding: '8px 16px', background: busy ? '#fca5a5' : '#dc2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer' }}>
            {busy ? 'מבצע...' : (isLogLinked ? 'מחק את הדיווח' : 'הסתר מבזק')}
          </button>
        </>
      }
    >
      {isLogLinked ? (
        <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.6 }}>
          <p style={{ margin: '0 0 8px' }}>
            השורה הזו מקושרת לדיווח פעולה (<span dir="ltr" style={{ fontFamily: 'monospace' }}>logId={row.logId}</span>).
          </p>
          <p style={{ margin: '0 0 8px' }}>
            <strong>מה יקרה:</strong>
          </p>
          <ul style={{ margin: '0 0 0 18px', padding: 0 }}>
            <li>הניקוד של המשתתפת יתוקן (יבוטל הניקוד שהדיווח חישב).</li>
            <li>אם הדיווח שותף לכמה קבוצות (multi-group), כל הקבוצות הקשורות יקבלו תיקון.</li>
            <li>כל שורות המבזק שמקושרות לאותו logId יוסתרו אוטומטית.</li>
            <li>הפורטל של המשתתפת ידכן את עצמו בריענון הבא.</li>
          </ul>
          <p style={{ margin: '12px 0 0', color: '#92400e', background: '#fef3c7', border: '1px solid #fde68a', padding: '8px 10px', borderRadius: 6, fontSize: 12 }}>
            הפעולה משתמשת ב-voidLog הקיים — אותה לוגיקה שמשתתפת מפעילה כשהיא מוחקת דיווח שלה.
          </p>
        </div>
      ) : (
        <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.6 }}>
          <p style={{ margin: '0 0 8px' }}>
            השורה הזו אינה מקושרת לדיווח פעולה (אין logId).
          </p>
          <p style={{ margin: 0 }}>
            <strong>מה יקרה:</strong> הסתרת שורת המבזק בלבד (<code>isPublic = false</code>). אין שינוי ניקוד.
          </p>
        </div>
      )}
      {err && <p style={{ color: '#b91c1c', fontSize: 13, marginTop: 10 }}>{err}</p>}
    </ModalShell>
  );
}

// ─── Edit ────────────────────────────────────────────────────────────────
function EditModal({ row, onClose, onDone }: { row: FeedRow; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const isLogLinked = !!row.logId;
  // Pre-fill: log-linked rows take the current log value; standalone
  // rows take the current message text.
  const [valueDraft, setValueDraft] = useState(row.log?.value ?? '');
  const [messageDraft, setMessageDraft] = useState(row.message);
  const [isPublicDraft, setIsPublicDraft] = useState(row.isPublic);

  async function submit() {
    setBusy(true); setErr('');
    try {
      const body: Record<string, unknown> = isLogLinked
        ? { value: valueDraft }
        : { message: messageDraft, isPublic: isPublicDraft };
      await apiFetch(`${BASE_URL}/admin/feed-events/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'הפעולה נכשלה');
    } finally { setBusy(false); }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: 8,
    fontSize: 14, background: '#fff', color: '#0f172a', boxSizing: 'border-box', fontFamily: 'inherit',
  };
  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4,
  };

  return (
    <ModalShell
      title={isLogLinked ? 'עריכת דיווח (משפיע על ניקוד)' : 'עריכת מבזק (טקסט בלבד)'}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} disabled={busy} style={{ padding: '8px 16px', background: '#f1f5f9', border: '1px solid #e2e8f0', color: '#374151', borderRadius: 8, fontSize: 13, cursor: busy ? 'not-allowed' : 'pointer' }}>
            ביטול
          </button>
          <button onClick={submit} disabled={busy || (isLogLinked && !valueDraft.trim())} style={{ padding: '8px 16px', background: busy ? '#93c5fd' : '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer' }}>
            {busy ? 'מבצע...' : 'שמור'}
          </button>
        </>
      }
    >
      {isLogLinked ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ fontSize: 12, color: '#92400e', background: '#fef3c7', border: '1px solid #fde68a', padding: '8px 10px', borderRadius: 6, lineHeight: 1.5 }}>
            השורה מקושרת לדיווח <strong>{row.log?.actionName}</strong>. שינוי הערך משתמש ב-correctLog ויעדכן את הניקוד בכל הקבוצות הקשורות (multi-group fan-out).
          </div>
          <div>
            <label style={labelStyle}>ערך נוכחי בלוג</label>
            <input
              dir="ltr"
              style={{ ...inputStyle, fontFamily: 'monospace', background: '#f8fafc', color: '#64748b' }}
              value={row.log?.value ?? ''}
              readOnly
            />
          </div>
          <div>
            <label style={labelStyle}>ערך חדש</label>
            <input
              dir="ltr"
              style={inputStyle}
              type={row.log?.actionInputType === 'number' ? 'number' : 'text'}
              step={row.log?.actionInputType === 'number' ? 'any' : undefined}
              value={valueDraft}
              onChange={(e) => setValueDraft(e.target.value)}
              autoFocus
            />
            <p style={{ fontSize: 11, color: '#64748b', margin: '4px 2px 0' }}>
              לאחר השמירה, סטטוס הלוג הישן יעבור ל-superseded ולוג חדש ייווצר.
            </p>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ fontSize: 12, color: '#475569', background: '#f8fafc', border: '1px solid #e2e8f0', padding: '8px 10px', borderRadius: 6, lineHeight: 1.5 }}>
            השורה אינה מקושרת ללוג פעולה (אין logId). העריכה משפיעה רק על שורת המבזק; הניקוד אינו מושפע.
          </div>
          <div>
            <label style={labelStyle}>טקסט מבזק</label>
            <textarea
              style={{ ...inputStyle, minHeight: 90, resize: 'vertical' }}
              value={messageDraft}
              onChange={(e) => setMessageDraft(e.target.value)}
            />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#0f172a' }}>
            <input
              type="checkbox"
              checked={isPublicDraft}
              onChange={(e) => setIsPublicDraft(e.target.checked)}
            />
            השורה גלויה למשתתפות
          </label>
        </div>
      )}
      {err && <p style={{ color: '#b91c1c', fontSize: 13, marginTop: 10 }}>{err}</p>}
    </ModalShell>
  );
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  // "27.04 14:32" — short, dense, sortable visually since list is desc.
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mn = String(d.getMinutes()).padStart(2, '0');
  return `${dd}.${mm} ${hh}:${mn}`;
}
