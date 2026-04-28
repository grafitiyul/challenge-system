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
  participant: { id: string; firstName: string; lastName: string | null } | null;
  group: { id: string; name: string } | null;
  program: { id: string; name: string } | null;
}

interface ProgramLite { id: string; name: string }
interface GroupLite { id: string; name: string; programId?: string | null; program?: { id: string; name: string } | null }
interface ParticipantLite { id: string; firstName: string; lastName?: string | null }

const TYPE_LABEL: Record<string, string> = {
  action: 'דיווח פעולה',
  rare: 'בונוס נדיר',
  system: 'הודעת מערכת',
};

const PAGE_SIZE = 200;

export default function AdminFeedPage() {
  const [rows, setRows] = useState<FeedRow[]>([]);
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
    qs.set('take', String(PAGE_SIZE));
    qs.set('skip', String(skip));
    apiFetch<FeedRow[]>(`${BASE_URL}/admin/feed-events?${qs.toString()}`, { cache: 'no-store' })
      .then((r) => { setRows(r); setErr(''); })
      .catch((e) => setErr(e instanceof Error ? e.message : 'טעינה נכשלה'))
      .finally(() => setLoading(false));
  }, [programId, groupId, participantId, type, visibility, skip]);

  useEffect(() => { reload(); }, [reload]);

  function clearFilters() {
    setProgramId(''); setGroupId(''); setParticipantId(''); setType(''); setVisibility('all'); setSkip(0);
  }

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
        <button
          onClick={clearFilters}
          style={{ padding: '7px 14px', fontSize: 13, fontWeight: 600, background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 8, cursor: 'pointer', color: '#475569' }}
        >ניקוי סינון</button>
      </div>

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
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'right' }}>
                <th style={th}>זמן</th>
                <th style={th}>סוג</th>
                <th style={th}>משתתפת</th>
                <th style={th}>קבוצה</th>
                <th style={th}>תוכנית</th>
                <th style={th}>הודעה</th>
                <th style={th}>נקודות</th>
                <th style={th}>נראות</th>
                <th style={th}>logId</th>
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
                    {r.participant ? (
                      <Link href={`/admin/participants/${r.participant.id}`} style={{ color: '#2563eb', textDecoration: 'none' }}>
                        {r.participant.firstName}{r.participant.lastName ? ` ${r.participant.lastName}` : ''}
                      </Link>
                    ) : '—'}
                  </td>
                  <td style={td}>
                    {r.group ? (
                      <Link href={`/admin/groups/${r.group.id}`} style={{ color: '#2563eb', textDecoration: 'none' }}>{r.group.name}</Link>
                    ) : '—'}
                  </td>
                  <td style={td}>
                    {r.program ? (
                      <Link href={`/admin/programs/${r.program.id}`} style={{ color: '#2563eb', textDecoration: 'none' }}>{r.program.name}</Link>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination — only shown when the response filled the page,
          since we don't get a count back. Older rows are reachable by
          tapping "ישנים יותר". */}
      {!loading && rows.length === PAGE_SIZE && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14 }}>
          <button
            onClick={() => setSkip((s) => Math.max(0, s - PAGE_SIZE))}
            disabled={skip === 0}
            style={{ padding: '7px 14px', fontSize: 13, fontWeight: 600, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, cursor: skip === 0 ? 'not-allowed' : 'pointer', opacity: skip === 0 ? 0.5 : 1 }}
          >חדשים יותר →</button>
          <span style={{ fontSize: 12, color: '#64748b', alignSelf: 'center' }}>
            דף {Math.floor(skip / PAGE_SIZE) + 1}
          </span>
          <button
            onClick={() => setSkip((s) => s + PAGE_SIZE)}
            style={{ padding: '7px 14px', fontSize: 13, fontWeight: 600, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, cursor: 'pointer' }}
          >← ישנים יותר</button>
        </div>
      )}
    </div>
  );
}

const th: React.CSSProperties = { padding: '10px 12px', fontWeight: 700, color: '#374151', fontSize: 12 };
const td: React.CSSProperties = { padding: '10px 12px', verticalAlign: 'top', color: '#0f172a' };

function formatWhen(iso: string): string {
  const d = new Date(iso);
  // "27.04 14:32" — short, dense, sortable visually since list is desc.
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mn = String(d.getMinutes()).padStart(2, '0');
  return `${dd}.${mm} ${hh}:${mn}`;
}
