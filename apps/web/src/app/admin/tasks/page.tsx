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
      {/* Participant picker — compact dropdown when selected, empty-state when not */}
      {!participantId ? (
        <div style={{
          background: '#fafafa', border: '2px dashed #cbd5e1', borderRadius: 12,
          padding: '20px 24px', textAlign: 'center' as const, marginBottom: 20,
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
      ) : (
        /* Compact switcher — sits inside TaskBoardHeader's participant strip area */
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
          <select
            value={participantId}
            onChange={(e) => handleChangeParticipant(e.target.value)}
            style={{ ...inputSt, width: 'auto', minWidth: 160, fontSize: 12, padding: '5px 8px', border: '1px solid #e2e8f0', color: '#374151' }}
          >
            {participants.map((p) => (
              <option key={p.id} value={p.id}>{p.firstName} {p.lastName ?? ''}</option>
            ))}
          </select>
        </div>
      )}

      {/* Task board — only when participant selected */}
      {participantId && (
        <TaskBoard
          participantId={participantId}
          participantName={participantName}
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
