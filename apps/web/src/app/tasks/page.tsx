'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { BASE_URL, apiFetch } from '@lib/api';
import { TaskBoard, toDateStr, weekSunday, addDays } from '@components/task-board';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Participant {
  id: string;
  firstName: string;
  lastName: string | null;
}

// ─── Style constants ──────────────────────────────────────────────────────────

const inputSt: React.CSSProperties = {
  width: '100%', padding: '9px 12px', border: '1px solid #cbd5e1', borderRadius: 8,
  fontSize: 14, color: '#0f172a', background: '#fff', boxSizing: 'border-box',
  fontFamily: 'inherit', outline: 'none',
};

// ─── Main page ────────────────────────────────────────────────────────────────

function TasksPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const participantIdParam = searchParams.get('participantId') ?? '';
  const weekParam = searchParams.get('week') ?? '';

  const [participants, setParticipants] = useState<Participant[]>([]);
  const [participantId, setParticipantId] = useState<string>(() => {
    if (participantIdParam) return participantIdParam;
    if (typeof window !== 'undefined') {
      return localStorage.getItem('tasks_participantId') ?? '';
    }
    return '';
  });
  const [currentSunday] = useState<Date>(() => {
    if (weekParam) return weekSunday(new Date(weekParam + 'T00:00:00'));
    return weekSunday(new Date());
  });

  // Load participants
  useEffect(() => {
    apiFetch<Participant[]>(`${BASE_URL}/participants?limit=200`, { cache: 'no-store' })
      .then((data) => { setParticipants(data); })
      .catch(() => {});
  }, []);

  // Sync URL + localStorage
  useEffect(() => {
    const params = new URLSearchParams();
    if (participantId) {
      params.set('participantId', participantId);
      localStorage.setItem('tasks_participantId', participantId);
    }
    params.set('week', toDateStr(currentSunday));
    router.replace(`/tasks?${params.toString()}`, { scroll: false });
  }, [participantId, currentSunday, router]);

  function handleChangeParticipant(id: string) {
    setParticipantId(id);
    if (id) localStorage.setItem('tasks_participantId', id);
    else localStorage.removeItem('tasks_participantId');
  }

  function handleWeekChange(sunday: Date) {
    const params = new URLSearchParams();
    if (participantId) params.set('participantId', participantId);
    params.set('week', toDateStr(sunday));
    router.replace(`/tasks?${params.toString()}`, { scroll: false });
  }

  const selectedParticipant = participants.find((p) => p.id === participantId);
  const participantName = selectedParticipant
    ? `${selectedParticipant.firstName} ${selectedParticipant.lastName ?? ''}`.trim()
    : '';

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>
      {/* Page header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0f172a', margin: '0 0 12px', letterSpacing: '-0.3px' }}>
          תכנון שבועי
        </h1>

        {/* Participant selector */}
        {participantId && selectedParticipant ? (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            background: 'linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%)',
            border: '1px solid #bfdbfe', borderRadius: 10,
            padding: '10px 16px',
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: '50%',
              background: 'linear-gradient(135deg, #2563eb, #0ea5e9)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: 15, fontWeight: 700, flexShrink: 0,
            }}>
              {selectedParticipant.firstName.charAt(0)}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1e40af' }}>{participantName}</div>
              <div style={{ fontSize: 11, color: '#60a5fa', marginTop: 1 }}>מתכנן שבועי פעיל</div>
            </div>
            <select
              value={participantId}
              onChange={(e) => handleChangeParticipant(e.target.value)}
              style={{ ...inputSt, width: 'auto', minWidth: 100, fontSize: 12, padding: '5px 8px', background: 'transparent', border: '1px solid #93c5fd', color: '#1d4ed8' }}
            >
              {participants.map((p) => (
                <option key={p.id} value={p.id}>{p.firstName} {p.lastName ?? ''}</option>
              ))}
            </select>
          </div>
        ) : (
          <div style={{
            background: '#fafafa', border: '2px dashed #cbd5e1', borderRadius: 12,
            padding: '20px 24px', textAlign: 'center' as const,
          }}>
            <div style={{ fontSize: 14, color: '#64748b', marginBottom: 12 }}>
              בחרי משתתפת כדי להתחיל את התכנון השבועי
            </div>
            <select
              value={participantId}
              onChange={(e) => handleChangeParticipant(e.target.value)}
              style={{ ...inputSt, width: 'auto', minWidth: 220, fontSize: 14, padding: '9px 12px', margin: '0 auto' }}
            >
              <option value="">— בחר משתתפת —</option>
              {participants.map((p) => (
                <option key={p.id} value={p.id}>{p.firstName} {p.lastName ?? ''}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Task board — only when participant selected */}
      {participantId && (
        <TaskBoard
          participantId={participantId}
          showSummaryButtons
          initialSunday={currentSunday}
          onWeekChange={handleWeekChange}
        />
      )}
    </div>
  );
}

export default function TasksPage() {
  return (
    <Suspense fallback={<div style={{ color: '#94a3b8', padding: 40, textAlign: 'center' }}>טוען...</div>}>
      <TasksPageInner />
    </Suspense>
  );
}
