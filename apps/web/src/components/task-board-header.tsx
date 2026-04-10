'use client';

/**
 * TaskBoardHeader — shared top header for the weekly task planner.
 *
 * Used by TaskBoard (task-board.tsx) in both:
 *   - /tasks             (admin planner — shows summary buttons)
 *   - /tg/[token]        (participant portal — shows completion pills)
 *
 * Fully stateless / prop-driven. No internal fetching, no width constraints.
 *
 * Props:
 *   participantName     — always required (drives avatar letter + name display)
 *   onDailySummary      — optional; renders "סיכום יומי" button when provided
 *   onWeeklySummary     — optional; renders "סיכום שבועי" button when provided
 *   stats               — optional; renders יומי/שבועי completion pills when provided
 */

import type { BoardStats } from '@components/task-board';

export interface TaskBoardHeaderProps {
  participantName: string;
  onDailySummary?: () => void;
  onWeeklySummary?: () => void;
  stats?: BoardStats;
}

const btnSm: React.CSSProperties = {
  background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0',
  borderRadius: 8, padding: '7px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 500,
};

function PillStat({ label, done, total }: { label: string; done: number; total: number }) {
  const isDone = done === total;
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      fontSize: 11, fontWeight: 700, lineHeight: 1.2,
      color: isDone ? '#15803d' : '#1d4ed8',
      background: isDone ? 'rgba(34,197,94,0.12)' : 'rgba(37,99,235,0.08)',
      border: `1px solid ${isDone ? '#86efac' : '#bfdbfe'}`,
      borderRadius: 8, padding: '4px 9px', whiteSpace: 'nowrap' as const,
      flexShrink: 0,
    }}>
      <div style={{ fontSize: 9, opacity: 0.7, marginBottom: 1 }}>{label}</div>
      <div>{done}/{total}</div>
    </div>
  );
}

export function TaskBoardHeader({
  participantName,
  onDailySummary,
  onWeeklySummary,
  stats,
}: TaskBoardHeaderProps) {
  const firstLetter = participantName.trim().charAt(0);
  const showSummaryButtons = onDailySummary !== undefined || onWeeklySummary !== undefined;
  const showStats = stats && (stats.dayTotal > 0 || stats.weekTotal > 0);

  return (
    <div style={{ marginBottom: 20 }}>

      {/* ── Row 1: title + optional summary buttons ─────────────────────── */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 12, flexWrap: 'wrap', gap: 8,
      }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0f172a', margin: 0, letterSpacing: '-0.3px' }}>
          תכנון שבועי
        </h1>
        {showSummaryButtons && (
          <div style={{ display: 'flex', gap: 8 }}>
            {onDailySummary && <button onClick={onDailySummary} style={btnSm}>סיכום יומי</button>}
            {onWeeklySummary && <button onClick={onWeeklySummary} style={btnSm}>סיכום שבועי</button>}
          </div>
        )}
      </div>

      {/* ── Row 2: participant strip ─────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        background: 'linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%)',
        border: '1px solid #bfdbfe', borderRadius: 10, padding: '10px 16px',
      }}>
        {/* Avatar */}
        <div style={{
          width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
          background: 'linear-gradient(135deg, #2563eb, #0ea5e9)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontSize: 15, fontWeight: 700,
        }}>
          {firstLetter}
        </div>

        {/* Name + subtitle */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 15, fontWeight: 700, color: '#1e40af',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {participantName}
          </div>
          <div style={{ fontSize: 11, color: '#60a5fa', marginTop: 1 }}>מתכנן שבועי פעיל</div>
        </div>

        {/* Optional completion pills (participant portal) */}
        {showStats && (
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            {stats!.dayTotal > 0 && (
              <PillStat label="יומי" done={stats!.dayDone} total={stats!.dayTotal} />
            )}
            {stats!.weekTotal > 0 && (
              <PillStat label="שבועי" done={stats!.weekDone} total={stats!.weekTotal} />
            )}
          </div>
        )}
      </div>

    </div>
  );
}
