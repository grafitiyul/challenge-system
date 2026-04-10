'use client';

/**
 * TaskBoardHeader — top header for the weekly task planner.
 *
 * Renders:
 *   1. Title row — "תכנון שבועי" + optional summary buttons
 *   2. Participant strip — avatar, name, subtitle
 *
 * Fully stateless / prop-driven. No internal fetching, no width constraints.
 * Used inside TaskBoard (task-board.tsx) when participantName is provided.
 */

export interface TaskBoardHeaderProps {
  participantName: string;
  onDailySummary: () => void;
  onWeeklySummary: () => void;
}

const btnSm: React.CSSProperties = {
  background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0',
  borderRadius: 8, padding: '7px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 500,
};

export function TaskBoardHeader({ participantName, onDailySummary, onWeeklySummary }: TaskBoardHeaderProps) {
  const firstLetter = participantName.trim().charAt(0);

  return (
    <div style={{ marginBottom: 20 }}>

      {/* ── Row 1: title + summary buttons ─────────────────────────────── */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
        flexWrap: 'wrap',
        gap: 8,
      }}>
        <h1 style={{
          fontSize: 24, fontWeight: 800, color: '#0f172a',
          margin: 0, letterSpacing: '-0.3px',
        }}>
          תכנון שבועי
        </h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onDailySummary} style={btnSm}>סיכום יומי</button>
          <button onClick={onWeeklySummary} style={btnSm}>סיכום שבועי</button>
        </div>
      </div>

      {/* ── Row 2: participant strip ─────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        background: 'linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%)',
        border: '1px solid #bfdbfe',
        borderRadius: 10,
        padding: '10px 16px',
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
      </div>

    </div>
  );
}
