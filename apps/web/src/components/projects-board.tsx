'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BASE_URL, apiFetch } from '@lib/api';

// ─── Shared types (also consumed by the admin tab) ───────────────────────────

export type ProjectItemType = 'boolean' | 'number' | 'select';
// "committed" is retained in the type so historical rows round-trip through
// the client cleanly, but the UI no longer produces or displays it as a
// first-class state. New activity only emits completed | skipped_today | value.
export type ProjectLogStatus = 'completed' | 'skipped_today' | 'committed' | 'value';

export interface SelectOption { value: string; label: string; }

export interface ProjectLog {
  id: string;
  itemId: string;
  logDate: string;            // YYYY-MM-DD
  status: ProjectLogStatus;
  numericValue: number | null;
  selectValue: string | null;
  skipNote: string | null;
  commitNote: string | null;
  editedAt: string | null;
  editedByRole: string | null;
  // Phase 2 audit/presentation only. Drives subtitle text on the goal row
  // ("סומן במשימה"). NOT a correctness branch — server sync logic ignores it.
  syncSource?: 'direct' | 'task';
  createdAt: string;
}

export interface ProjectItem {
  id: string;
  projectId: string;
  title: string;
  itemType: ProjectItemType;
  unit: string | null;
  targetValue: number | null;
  selectOptions: SelectOption[] | null;
  sortOrder: number;
  isArchived: boolean;
  // Phase 2: optional bidirectional link. Only meaningful for boolean items.
  linkedPlanTaskId: string | null;
  createdAt: string;
  logs: ProjectLog[];
}

export interface LinkableTask { id: string; title: string; }

export interface Project {
  id: string;
  participantId: string;
  title: string;
  description: string | null;
  colorHex: string | null;
  status: string;
  createdByRole: string;
  createdAt: string;
  updatedAt: string;
  items: ProjectItem[];
}

export interface ProjectNote {
  id: string;
  projectId: string;
  participantId: string;
  content: string;
  authorRole: string;
  createdAt: string;
}

export interface PortalBootstrap {
  participant: { id: string; firstName: string; lastName: string | null; canManageProjects: boolean };
  today: string;
  yesterday: string;
  projects: Project[];
  notes: ProjectNote[];
  // Phase 2: tasks the participant can link a new/edited boolean goal to.
  // Already filters out tasks that are currently linked to another goal.
  linkableTasks: LinkableTask[];
  // Phase 2: "itemId|YYYY-MM-DD" keys for (linked goal, date) pairs where
  // the linked task has an ACTIVE assignment. Used to decide the
  // "לא נקבע להיום בלו״ז" hint.
  scheduledKeys: string[];
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const COLORS = {
  bg: '#f8fafc',
  card: '#ffffff',
  cardAlt: '#fbfbfd',
  border: '#e2e8f0',
  borderStrong: '#cbd5e1',
  borderSoft: '#eef2f7',
  text: '#0f172a',
  muted: '#64748b',
  mutedLight: '#94a3b8',
  accent: '#2563eb',
  accentSoft: '#eff6ff',
  success: '#15803d',
  successSoft: '#dcfce7',
  warn: '#b45309',
  warnSoft: '#fef3c7',
  danger: '#b91c1c',
  dangerSoft: '#fef2f2',
  saving: '#0891b2',
  savingSoft: '#ecfeff',
};

const s = {
  tabHeader: {
    display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center',
  } as React.CSSProperties,
  toggleGroup: {
    display: 'inline-flex', borderRadius: 10, overflow: 'hidden', border: `1px solid ${COLORS.border}`,
  } as React.CSSProperties,
  toggleBtn: (active: boolean) => ({
    padding: '10px 18px', fontSize: 15, fontWeight: 600, cursor: 'pointer',
    border: 'none', background: active ? COLORS.accent : COLORS.card,
    color: active ? '#fff' : COLORS.text, minHeight: 44,
  }) as React.CSSProperties,
  primaryBtn: {
    padding: '10px 16px', fontSize: 14, fontWeight: 600,
    background: COLORS.accent, color: '#fff', border: 'none',
    borderRadius: 8, cursor: 'pointer', minHeight: 44,
  } as React.CSSProperties,
  ghostBtn: {
    padding: '8px 12px', fontSize: 13, fontWeight: 600,
    background: 'transparent', color: COLORS.muted,
    border: `1px solid ${COLORS.border}`, borderRadius: 8, cursor: 'pointer', minHeight: 40,
  } as React.CSSProperties,
  card: {
    background: COLORS.card, border: `1px solid ${COLORS.border}`,
    borderRadius: 12, padding: 16, marginBottom: 16,
  } as React.CSSProperties,
  projectTitle: {
    fontSize: 17, fontWeight: 700, color: COLORS.text, marginBottom: 4,
  } as React.CSSProperties,
  projectDesc: {
    fontSize: 13, color: COLORS.muted, marginBottom: 12,
  } as React.CSSProperties,
  // Each goal ("מטרה") is rendered as its own card-in-card with stronger
  // visual separation: alternate background, rounded border, vertical gap.
  goalCard: {
    background: COLORS.cardAlt,
    border: `1px solid ${COLORS.borderSoft}`,
    borderRadius: 10,
    padding: '14px 14px 12px',
    marginBottom: 12,
  } as React.CSSProperties,
  goalTitle: {
    fontSize: 15, fontWeight: 700, color: COLORS.text, marginBottom: 10,
  } as React.CSSProperties,
  statusChip: (bg: string, color: string): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px',
    borderRadius: 999, fontSize: 11, fontWeight: 700,
    background: bg, color,
  }),
  numInput: {
    width: 120, padding: '10px 12px', border: `1px solid ${COLORS.borderStrong}`,
    borderRadius: 8, fontSize: 16, color: COLORS.text, background: '#fff',
    fontFamily: 'inherit', outline: 'none', minHeight: 44,
  } as React.CSSProperties,
  textInput: {
    width: '100%', padding: '10px 12px', border: `1px solid ${COLORS.borderStrong}`,
    borderRadius: 8, fontSize: 16, color: COLORS.text, background: '#fff',
    fontFamily: 'inherit', outline: 'none', minHeight: 44, boxSizing: 'border-box',
  } as React.CSSProperties,
  textarea: {
    width: '100%', padding: '10px 12px', border: `1px solid ${COLORS.borderStrong}`,
    borderRadius: 8, fontSize: 16, color: COLORS.text, background: '#fff',
    fontFamily: 'inherit', outline: 'none', minHeight: 80, resize: 'vertical' as const,
    boxSizing: 'border-box' as const,
  } as React.CSSProperties,
  err: {
    fontSize: 12, color: COLORS.danger, marginTop: 6,
  } as React.CSSProperties,
  saveState: (state: 'idle' | 'saving' | 'saved' | 'error') => ({
    fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999,
    background: state === 'error' ? COLORS.dangerSoft
      : state === 'saving' ? COLORS.savingSoft
      : state === 'saved' ? COLORS.successSoft
      : 'transparent',
    color: state === 'error' ? COLORS.danger
      : state === 'saving' ? COLORS.saving
      : state === 'saved' ? COLORS.success
      : COLORS.mutedLight,
    transition: 'opacity 200ms ease',
    opacity: state === 'idle' ? 0 : 1,
  }) as React.CSSProperties,
  backdrop: {
    position: 'fixed' as const, inset: 0, background: 'rgba(15,23,42,0.4)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000, padding: 16,
  } as React.CSSProperties,
  modal: {
    background: COLORS.card, borderRadius: 16, padding: 20,
    width: '100%', maxWidth: 420, maxHeight: '90vh', overflowY: 'auto' as const,
  } as React.CSSProperties,
};

// ─── Utilities ───────────────────────────────────────────────────────────────

function logForDate(item: ProjectItem, date: string): ProjectLog | null {
  return item.logs.find((l) => l.logDate === date) ?? null;
}

function statusPillFromLog(log: ProjectLog | null): { label: string; bg: string; color: string } | null {
  if (!log) return { label: 'לא דווח', bg: '#f1f5f9', color: COLORS.muted };
  switch (log.status) {
    case 'completed':
      return { label: 'בוצע', bg: COLORS.successSoft, color: COLORS.success };
    case 'value':
      return { label: 'דווח ערך', bg: COLORS.accentSoft, color: COLORS.accent };
    case 'skipped_today':
      return { label: 'לא רלוונטי להיום', bg: COLORS.warnSoft, color: COLORS.warn };
    // 'committed' is deprecated in UI; treat legacy rows as neutral so they
    // are still visible but don't imply a committed-state workflow.
    case 'committed':
      return { label: 'דווח ישן', bg: '#f1f5f9', color: COLORS.muted };
    default:
      return null;
  }
}

function itemExistsOn(item: ProjectItem, date: string): boolean {
  const created = new Date(item.createdAt);
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(created);
  return iso <= date;
}

// ─── ProjectsBoard — portal (mobile) ─────────────────────────────────────────

interface PortalBoardProps {
  token: string;
}

export function PortalProjectsBoard({ token }: PortalBoardProps) {
  const [data, setData] = useState<PortalBootstrap | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<'today' | 'yesterday'>('today');

  // Modal state
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [addItemForProject, setAddItemForProject] = useState<string | null>(null);
  const [noteForProject, setNoteForProject] = useState<string | null>(null);
  const [skipForItem, setSkipForItem] = useState<ProjectItem | null>(null);
  // Remove-confirmation (in-app modal; replaces browser confirm()).
  const [removeProject, setRemoveProject] = useState<Project | null>(null);
  const [removeGoalByItem, setRemoveGoalByItem] = useState<ProjectItem | null>(null);

  const reload = useCallback(async () => {
    try {
      const d = await apiFetch<PortalBootstrap>(
        `${BASE_URL}/public/projects/${token}`,
        { cache: 'no-store' },
      );
      setData(d);
      setLoadErr('');
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e
        ? String((e as { message: string }).message) : 'טעינה נכשלה';
      setLoadErr(msg);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void reload(); }, [reload]);

  const dateStr = data ? (selectedDay === 'today' ? data.today : data.yesterday) : '';
  const notesByProject = useMemo(() => {
    const m = new Map<string, ProjectNote[]>();
    if (!data) return m;
    for (const n of data.notes) {
      const list = m.get(n.projectId) ?? [];
      list.push(n);
      m.set(n.projectId, list);
    }
    return m;
  }, [data]);

  if (loading) return <div style={{ padding: 20, color: COLORS.muted, textAlign: 'center' }}>טוען...</div>;
  if (loadErr) return <div style={{ padding: 20, color: COLORS.danger, textAlign: 'center' }}>{loadErr}</div>;
  if (!data) return null;

  const visibleProjects = data.projects.filter((p) => p.status === 'active');
  const canManage = data.participant.canManageProjects;

  return (
    <div style={{ padding: 12 }}>
      <div style={s.tabHeader}>
        <div style={s.toggleGroup}>
          <button style={s.toggleBtn(selectedDay === 'today')} onClick={() => setSelectedDay('today')}>
            היום
          </button>
          <button style={s.toggleBtn(selectedDay === 'yesterday')} onClick={() => setSelectedDay('yesterday')}>
            אתמול
          </button>
        </div>
        {canManage && (
          <button style={{ ...s.primaryBtn, marginInlineStart: 'auto' }} onClick={() => setCreateProjectOpen(true)}>
            + צור פרויקט חדש
          </button>
        )}
      </div>

      {visibleProjects.length === 0 && (
        <div style={{ ...s.card, textAlign: 'center', color: COLORS.muted, padding: 32 }}>
          {canManage
            ? 'אין פרויקטים עדיין. לחצי "צור פרויקט חדש" כדי להתחיל.'
            : 'המאמנת עדיין לא הקצתה לך פרויקטים.'}
        </div>
      )}

      {visibleProjects.map((p) => (
        <div key={p.id} style={{ ...s.card, borderInlineStartWidth: 4, borderInlineStartStyle: 'solid', borderInlineStartColor: p.colorHex ?? COLORS.accent }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={s.projectTitle}>{p.title}</div>
              {p.description && <div style={s.projectDesc}>{p.description}</div>}
            </div>
            {canManage && (
              <button
                style={{ ...s.ghostBtn, color: COLORS.danger, borderColor: COLORS.dangerSoft, minHeight: 36, padding: '6px 10px', fontSize: 12 }}
                onClick={() => setRemoveProject(p)}
              >
                🗑 הסר
              </button>
            )}
          </div>

          {p.items.filter((i) => !i.isArchived).length === 0 ? (
            <div style={{ color: COLORS.muted, fontSize: 13, padding: '8px 0' }}>
              {canManage ? 'אין מטרות עדיין — הוסיפי אחת למטה.' : 'אין מטרות לדווח עליהן.'}
            </div>
          ) : (
            p.items.filter((i) => !i.isArchived).map((item) => (
              <GoalRow
                key={item.id}
                token={token}
                item={item}
                date={dateStr}
                visible={itemExistsOn(item, dateStr)}
                canManage={canManage}
                scheduledKeys={data.scheduledKeys}
                onChanged={reload}
                onOpenSkip={() => setSkipForItem(item)}
                onOpenRemove={() => setRemoveGoalByItem(item)}
              />
            ))
          )}

          {canManage && (
            <div style={{ marginTop: 12 }}>
              <button style={s.ghostBtn} onClick={() => setAddItemForProject(p.id)}>+ הוסף מטרה</button>
            </div>
          )}

          <NotesSection
            projectId={p.id}
            notes={notesByProject.get(p.id) ?? []}
            onAdd={() => setNoteForProject(p.id)}
          />
        </div>
      ))}

      {createProjectOpen && (
        <CreateProjectModal
          token={token}
          onClose={() => setCreateProjectOpen(false)}
          onCreated={() => { setCreateProjectOpen(false); void reload(); }}
        />
      )}

      {addItemForProject && (
        <AddGoalModal
          token={token}
          projectId={addItemForProject}
          linkableTasks={data.linkableTasks}
          onClose={() => setAddItemForProject(null)}
          onCreated={() => { setAddItemForProject(null); void reload(); }}
        />
      )}

      {noteForProject && (
        <AddNoteModal
          token={token}
          projectId={noteForProject}
          onClose={() => setNoteForProject(null)}
          onCreated={() => { setNoteForProject(null); void reload(); }}
        />
      )}

      {skipForItem && (
        <SkipModal
          token={token}
          item={skipForItem}
          date={dateStr}
          onClose={() => setSkipForItem(null)}
          onSaved={() => { setSkipForItem(null); void reload(); }}
        />
      )}

      {removeProject && (
        <ConfirmRemoveModal
          title="להסיר פרויקט?"
          body="הפעולה תסיר את הפרויקט מהרשימה, אך תשמור את ההיסטוריה."
          confirmLabel="הסר"
          onClose={() => setRemoveProject(null)}
          onConfirm={async () => {
            try {
              await apiFetch(`${BASE_URL}/public/projects/${token}/projects/${removeProject.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ status: 'archived' }),
              });
              setRemoveProject(null);
              void reload();
            } catch (e: unknown) {
              throw e;
            }
          }}
        />
      )}

      {removeGoalByItem && (
        <ConfirmRemoveModal
          title="להסיר מטרה?"
          body="הפעולה תסיר את המטרה מהרשימה, אך תשמור את ההיסטוריה."
          confirmLabel="הסר"
          onClose={() => setRemoveGoalByItem(null)}
          onConfirm={async () => {
            await apiFetch(`${BASE_URL}/public/projects/${token}/items/${removeGoalByItem.id}`, { method: 'DELETE' });
            setRemoveGoalByItem(null);
            void reload();
          }}
        />
      )}
    </div>
  );
}

// ─── In-app modal primitives ────────────────────────────────────────────────
// LockedModalShell: backdrop click does NOT close. Explicit × button and a
// configurable footer. All destructive confirmations use this — no more
// browser confirm()/prompt() anywhere in the UI.

function LockedModalShell(props: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div style={s.backdrop} onClick={(e) => e.stopPropagation()}>
      <div style={s.modal} role="dialog" aria-modal="true">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{props.title}</div>
          <button
            aria-label="סגור"
            onClick={props.onClose}
            style={{
              width: 32, height: 32, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              border: 'none', background: 'transparent', color: COLORS.muted, cursor: 'pointer',
              fontSize: 20, lineHeight: 1, borderRadius: 8,
            }}
          >×</button>
        </div>
        {props.children}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          {props.footer}
        </div>
      </div>
    </div>
  );
}

function ConfirmRemoveModal(props: {
  title: string;
  body: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function run() {
    setBusy(true); setErr('');
    try {
      await props.onConfirm();
    } catch (e: unknown) {
      setErr(e && typeof e === 'object' && 'message' in e ? String((e as { message: string }).message) : 'הפעולה נכשלה');
    } finally {
      setBusy(false);
    }
  }
  return (
    <LockedModalShell
      title={props.title}
      onClose={props.onClose}
      footer={(
        <>
          <button style={s.ghostBtn} disabled={busy} onClick={props.onClose}>ביטול</button>
          <button
            style={{ ...s.primaryBtn, background: COLORS.danger, opacity: busy ? 0.65 : 1 }}
            disabled={busy}
            onClick={run}
          >
            {props.confirmLabel}
          </button>
        </>
      )}
    >
      <div style={{ fontSize: 14, color: COLORS.text, lineHeight: 1.6 }}>{props.body}</div>
      {err && <div style={{ ...s.err, marginTop: 10 }}>{err}</div>}
    </LockedModalShell>
  );
}

// ─── Goal row (per-day reporting UI) ─────────────────────────────────────────
// Auto-saves on every action. No Save button anywhere on this row.
// ① boolean: "✓ בוצע" is a two-way toggle (click again → clear).
// ② number: debounced save on input change (500ms after last keystroke).
// ③ select: save immediately on option choice.
// Every variant shares the same "lo rel'vanti l'hayom" affordance, which
// opens a modal that REQUIRES a note.

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function GoalRow(props: {
  token: string;
  item: ProjectItem;
  date: string;
  visible: boolean;
  canManage: boolean;
  scheduledKeys: string[];
  onChanged: () => void;
  onOpenSkip: () => void;
  onOpenRemove: () => void;
}) {
  const { token, item, date, visible, canManage, scheduledKeys, onChanged, onOpenSkip, onOpenRemove } = props;
  const log = logForDate(item, date);
  const pill = statusPillFromLog(log);
  const isLinked = !!item.linkedPlanTaskId;
  const hasScheduledAssignment = isLinked && scheduledKeys.includes(`${item.id}|${date}`);
  const completedViaTask = log?.syncSource === 'task';
  const showNotScheduledHint = isLinked && log?.status === 'completed' && !hasScheduledAssignment;

  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [err, setErr] = useState('');

  // Local editable state for number input (debounced).
  const [numDraft, setNumDraft] = useState<string>(
    log?.numericValue !== null && log?.numericValue !== undefined ? String(log.numericValue) : '',
  );
  useEffect(() => {
    setNumDraft(log?.numericValue !== null && log?.numericValue !== undefined ? String(log.numericValue) : '');
  }, [log?.id, log?.numericValue]);

  // Debounce timer for the numeric input.
  const numTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (numTimer.current) clearTimeout(numTimer.current);
  }, []);

  // Save-state chip auto-clears back to 'idle' after success.
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);
  function transientSuccess() {
    setSaveState('saved');
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setSaveState('idle'), 1600);
  }

  async function run(body: Record<string, unknown>) {
    setSaveState('saving'); setErr('');
    try {
      await apiFetch(`${BASE_URL}/public/projects/${token}/items/${item.id}/logs`, {
        method: 'POST',
        body: JSON.stringify({ logDate: date, ...body }),
      });
      transientSuccess();
      onChanged();
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e
        ? String((e as { message: string }).message) : 'שמירה נכשלה';
      setErr(msg);
      setSaveState('error');
    }
  }

  async function clearLog() {
    setSaveState('saving'); setErr('');
    try {
      await apiFetch(
        `${BASE_URL}/public/projects/${token}/items/${item.id}/logs?logDate=${encodeURIComponent(date)}`,
        { method: 'DELETE' },
      );
      transientSuccess();
      onChanged();
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e
        ? String((e as { message: string }).message) : 'שמירה נכשלה';
      setErr(msg);
      setSaveState('error');
    }
  }

  if (!visible) {
    return (
      <div style={s.goalCard}>
        <div style={{ ...s.goalTitle, color: COLORS.mutedLight }}>{item.title}</div>
        <div style={{ fontSize: 12, color: COLORS.mutedLight }}>נוצר אחרי תאריך זה</div>
      </div>
    );
  }

  const isCompleted = log?.status === 'completed';
  const saveLabel = saveState === 'saving' ? 'שומר…' : saveState === 'saved' ? 'נשמר' : saveState === 'error' ? 'שמירה נכשלה' : '';

  // Save indicator lives directly under the control area so the feedback
  // is physically associated with whatever the user just interacted with.
  // Shared across all item types (one interactive area per row).
  const SaveIndicator = (
    <div
      style={{
        minHeight: 18,
        marginTop: 6,
        display: 'flex',
        alignItems: 'center',
      }}
      aria-live="polite"
    >
      <span style={s.saveState(saveState)}>{saveLabel}</span>
    </div>
  );

  return (
    <div style={s.goalCard}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={s.goalTitle}>
            {item.title}
            {item.unit && <span style={{ fontWeight: 400, color: COLORS.muted, fontSize: 13, marginInlineStart: 6 }}>({item.unit})</span>}
            {item.targetValue !== null && item.targetValue !== undefined && (
              <span style={{ fontWeight: 400, color: COLORS.muted, fontSize: 13, marginInlineStart: 6 }}>
                יעד {item.targetValue}
              </span>
            )}
            {isLinked && (
              <span
                title="מטרה זו מקושרת למשימה ברשימת התכנון"
                style={{
                  marginInlineStart: 6,
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '2px 8px', borderRadius: 999,
                  fontSize: 11, fontWeight: 600,
                  background: COLORS.accentSoft, color: COLORS.accent,
                }}
              >🔗 מקושר למשימה</span>
            )}
          </div>
          {completedViaTask && (
            <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 2 }}>סומן במשימה</div>
          )}
          {showNotScheduledHint && !completedViaTask && (
            <div style={{ fontSize: 12, color: COLORS.mutedLight, marginTop: 2 }}>
              לא נקבע להיום בלו״ז
            </div>
          )}
          {showNotScheduledHint && completedViaTask && (
            // Extremely rare (completed via task BUT no active assignment —
            // would require an assignment to have been deleted after sync).
            // Still render the hint for consistency.
            <div style={{ fontSize: 12, color: COLORS.mutedLight, marginTop: 2 }}>
              לא נקבע להיום בלו״ז
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {pill && <span style={s.statusChip(pill.bg, pill.color)}>{pill.label}</span>}
          {canManage && (
            <button
              title="הסר מטרה"
              onClick={onOpenRemove}
              style={{
                padding: '2px 8px', fontSize: 12, lineHeight: 1,
                background: 'transparent', color: COLORS.mutedLight,
                border: `1px solid ${COLORS.border}`, borderRadius: 6,
                cursor: 'pointer',
              }}
            >×</button>
          )}
        </div>
      </div>

      {item.itemType === 'boolean' && (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              style={{
                ...s.primaryBtn,
                background: isCompleted ? COLORS.success : COLORS.accent,
                opacity: saveState === 'saving' ? 0.65 : 1,
              }}
              disabled={saveState === 'saving'}
              onClick={() => { if (isCompleted) void clearLog(); else void run({ status: 'completed' }); }}
            >
              {isCompleted ? '✓ בוצע (לחצי לבטל)' : '✓ סמני שבוצע'}
            </button>
            <button style={s.ghostBtn} disabled={saveState === 'saving'} onClick={onOpenSkip}>לא רלוונטי להיום</button>
          </div>
          {SaveIndicator}
        </>
      )}

      {item.itemType === 'number' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="number"
            inputMode="decimal"
            style={s.numInput}
            value={numDraft}
            onChange={(e) => {
              const v = e.target.value;
              setNumDraft(v);
              if (numTimer.current) clearTimeout(numTimer.current);
              // Empty input while a log exists = clear the row (undo).
              if (v.trim() === '') {
                if (log) numTimer.current = setTimeout(() => { void clearLog(); }, 500);
                return;
              }
              const parsed = parseFloat(v);
              if (isNaN(parsed)) return;
              numTimer.current = setTimeout(() => {
                void run({ status: 'completed', numericValue: parsed });
              }, 500);
            }}
            disabled={false /* always allow typing — debounce handles in-flight saves */}
          />
          <button style={s.ghostBtn} disabled={saveState === 'saving'} onClick={onOpenSkip}>לא רלוונטי להיום</button>
        </div>
      )}
      {item.itemType === 'number' && SaveIndicator}

      {item.itemType === 'select' && item.selectOptions && (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {item.selectOptions.map((o) => {
              const active = log?.selectValue === o.value && log?.status !== 'skipped_today';
              return (
                <button
                  key={o.value}
                  disabled={saveState === 'saving'}
                  style={{
                    padding: '10px 14px',
                    border: `2px solid ${active ? COLORS.accent : COLORS.border}`,
                    background: active ? COLORS.accentSoft : COLORS.card,
                    color: active ? COLORS.accent : COLORS.text,
                    borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer',
                    minHeight: 44,
                  }}
                  onClick={() => {
                    // Tapping the already-selected option clears the log (undo).
                    if (active) void clearLog();
                    else void run({ status: 'completed', selectValue: o.value });
                  }}
                >
                  {o.label}
                </button>
              );
            })}
            <button style={s.ghostBtn} disabled={saveState === 'saving'} onClick={onOpenSkip}>לא רלוונטי להיום</button>
          </div>
          {SaveIndicator}
        </>
      )}

      {log?.status === 'skipped_today' && log.skipNote && (
        <div style={{ fontSize: 12, color: COLORS.warn, marginTop: 8 }}>
          <strong>למה לא רלוונטי:</strong> {log.skipNote}
        </div>
      )}
      {err && <div style={s.err}>{err}</div>}
    </div>
  );
}

// ─── Notes section ───────────────────────────────────────────────────────────

function NotesSection(props: {
  projectId: string;
  notes: ProjectNote[];
  onAdd: () => void;
}) {
  const { notes, onAdd } = props;
  return (
    <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${COLORS.border}` }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: COLORS.mutedLight, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          הערות
        </div>
        <button style={s.ghostBtn} onClick={onAdd}>+ הוסיפי הערה</button>
      </div>
      {notes.length === 0 && (
        <div style={{ fontSize: 12, color: COLORS.mutedLight }}>אין הערות עדיין.</div>
      )}
      {notes.map((n) => (
        <div key={n.id} style={{ fontSize: 13, color: COLORS.text, padding: '6px 0', borderBottom: `1px dashed ${COLORS.border}` }}>
          <div style={{ fontSize: 11, color: COLORS.mutedLight, marginBottom: 2 }}>
            {n.authorRole === 'admin' ? 'מאמנת' : 'אני'} · {new Date(n.createdAt).toLocaleDateString('he-IL')}
          </div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{n.content}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Modals ──────────────────────────────────────────────────────────────────

function CreateProjectModal(props: { token: string; onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    if (!title.trim()) { setErr('חובה למלא כותרת'); return; }
    setBusy(true); setErr('');
    try {
      await apiFetch(`${BASE_URL}/public/projects/${props.token}/projects`, {
        method: 'POST',
        body: JSON.stringify({ title: title.trim(), description: description.trim() || undefined }),
      });
      props.onCreated();
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: string }).message) : 'שמירה נכשלה';
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <LockedModalShell
      title="צור פרויקט חדש"
      onClose={props.onClose}
      footer={(
        <>
          <button style={s.ghostBtn} onClick={props.onClose} disabled={busy}>ביטול</button>
          <button style={s.primaryBtn} onClick={submit} disabled={busy}>שמרי</button>
        </>
      )}
    >
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontSize: 13, color: COLORS.muted, marginBottom: 4 }}>כותרת</label>
        <input style={s.textInput} value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 13, color: COLORS.muted, marginBottom: 4 }}>תיאור (לא חובה)</label>
        <textarea style={s.textarea} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      {err && <div style={s.err}>{err}</div>}
    </LockedModalShell>
  );
}

function AddGoalModal(props: {
  token: string;
  projectId: string;
  linkableTasks: LinkableTask[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [itemType, setItemType] = useState<ProjectItemType>('boolean');
  const [unit, setUnit] = useState('');
  const [targetValue, setTargetValue] = useState('');
  // Phase 1: admins enter ONE label per option (what the participant sees).
  // The API still requires value + label; we use the label as both under the
  // hood so admins never deal with an internal "English value" field.
  const [options, setOptions] = useState<string[]>(['']);
  // Phase 2 link picker. Only shown when itemType='boolean'. Empty string
  // means "no link".
  const [linkedTaskId, setLinkedTaskId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    if (!title.trim()) { setErr('חובה למלא כותרת'); return; }
    const body: Record<string, unknown> = { title: title.trim(), itemType };
    if (itemType === 'number') {
      if (unit.trim()) body.unit = unit.trim();
      if (targetValue.trim() && !isNaN(parseFloat(targetValue))) body.targetValue = parseFloat(targetValue);
    }
    if (itemType === 'select') {
      const clean = options
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map((s) => ({ value: s, label: s }));
      if (clean.length === 0) { setErr('חובה להגדיר לפחות אפשרות אחת'); return; }
      body.selectOptions = clean;
    }
    if (itemType === 'boolean' && linkedTaskId) {
      body.linkedPlanTaskId = linkedTaskId;
    }
    setBusy(true); setErr('');
    try {
      await apiFetch(
        `${BASE_URL}/public/projects/${props.token}/projects/${props.projectId}/items`,
        { method: 'POST', body: JSON.stringify(body) },
      );
      props.onCreated();
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: string }).message) : 'שמירה נכשלה';
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <LockedModalShell
      title="הוסיפי מטרה"
      onClose={props.onClose}
      footer={(
        <>
          <button style={s.ghostBtn} onClick={props.onClose} disabled={busy}>ביטול</button>
          <button style={s.primaryBtn} onClick={submit} disabled={busy}>שמרי</button>
        </>
      )}
    >
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontSize: 13, color: COLORS.muted, marginBottom: 4 }}>כותרת</label>
        <input style={s.textInput} value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontSize: 13, color: COLORS.muted, marginBottom: 4 }}>סוג</label>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['boolean', 'number', 'select'] as ProjectItemType[]).map((t) => (
            <button
              key={t}
              onClick={() => setItemType(t)}
              style={{
                flex: 1,
                padding: '10px 8px',
                border: `2px solid ${itemType === t ? COLORS.accent : COLORS.border}`,
                background: itemType === t ? COLORS.accentSoft : COLORS.card,
                color: itemType === t ? COLORS.accent : COLORS.text,
                borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', minHeight: 44,
              }}
            >
              {t === 'boolean' ? 'בוצע/לא' : t === 'number' ? 'מספרי' : 'בחירה'}
            </button>
          ))}
        </div>
      </div>

      {itemType === 'number' && (
        <>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 13, color: COLORS.muted, marginBottom: 4 }}>יחידה (לא חובה)</label>
            <input style={s.textInput} placeholder="למשל: כוסות" value={unit} onChange={(e) => setUnit(e.target.value)} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 13, color: COLORS.muted, marginBottom: 4 }}>יעד יומי (לא חובה)</label>
            <input type="number" style={s.textInput} value={targetValue} onChange={(e) => setTargetValue(e.target.value)} />
          </div>
        </>
      )}

      {itemType === 'boolean' && props.linkableTasks.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 13, color: COLORS.muted, marginBottom: 4 }}>קשר למשימה</label>
          <select
            style={s.textInput}
            value={linkedTaskId}
            onChange={(e) => setLinkedTaskId(e.target.value)}
          >
            <option value="">ללא קישור</option>
            {props.linkableTasks.map((t) => (
              <option key={t.id} value={t.id}>{t.title}</option>
            ))}
          </select>
        </div>
      )}

      {itemType === 'select' && (
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 13, color: COLORS.muted, marginBottom: 4 }}>אפשרויות</label>
          {options.map((label, idx) => (
            <div key={idx} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <input
                style={{ ...s.textInput, flex: 1 }}
                placeholder="אפשרות"
                value={label}
                onChange={(e) => {
                  const next = [...options];
                  next[idx] = e.target.value;
                  setOptions(next);
                }}
              />
              <button
                style={s.ghostBtn}
                onClick={() => setOptions(options.filter((_, i) => i !== idx))}
                disabled={options.length === 1}
              >×</button>
            </div>
          ))}
          <button style={s.ghostBtn} onClick={() => setOptions([...options, ''])}>
            + הוסיפי אפשרות
          </button>
        </div>
      )}

      {err && <div style={s.err}>{err}</div>}
    </LockedModalShell>
  );
}

function AddNoteModal(props: { token: string; projectId: string; onClose: () => void; onCreated: () => void }) {
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    if (!content.trim()) { setErr('חובה למלא תוכן'); return; }
    setBusy(true); setErr('');
    try {
      await apiFetch(
        `${BASE_URL}/public/projects/${props.token}/projects/${props.projectId}/notes`,
        { method: 'POST', body: JSON.stringify({ content: content.trim() }) },
      );
      props.onCreated();
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: string }).message) : 'שמירה נכשלה';
      setErr(msg);
    } finally { setBusy(false); }
  }

  return (
    <LockedModalShell
      title="הוסיפי הערה"
      onClose={props.onClose}
      footer={(
        <>
          <button style={s.ghostBtn} onClick={props.onClose} disabled={busy}>ביטול</button>
          <button style={s.primaryBtn} onClick={submit} disabled={busy}>שמרי</button>
        </>
      )}
    >
      <textarea style={s.textarea} value={content} onChange={(e) => setContent(e.target.value)} autoFocus />
      {err && <div style={s.err}>{err}</div>}
    </LockedModalShell>
  );
}

// "לא רלוונטי להיום" modal — the skip_today state now REQUIRES a note.
// Submit button stays disabled until the textarea has non-whitespace content.
function SkipModal(props: {
  token: string;
  item: ProjectItem;
  date: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    if (!note.trim()) { setErr('חובה לרשום למה זה לא רלוונטי היום'); return; }
    setBusy(true); setErr('');
    try {
      await apiFetch(
        `${BASE_URL}/public/projects/${props.token}/items/${props.item.id}/logs`,
        {
          method: 'POST',
          body: JSON.stringify({
            logDate: props.date,
            status: 'skipped_today',
            skipNote: note.trim(),
          }),
        },
      );
      props.onSaved();
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: string }).message) : 'שמירה נכשלה';
      setErr(msg);
    } finally { setBusy(false); }
  }

  const canSubmit = note.trim().length > 0 && !busy;

  return (
    <LockedModalShell
      title="לא רלוונטי להיום"
      onClose={props.onClose}
      footer={(
        <>
          <button style={s.ghostBtn} onClick={props.onClose} disabled={busy}>ביטול</button>
          <button
            style={{ ...s.primaryBtn, opacity: canSubmit ? 1 : 0.55, cursor: canSubmit ? 'pointer' : 'not-allowed' }}
            onClick={submit}
            disabled={!canSubmit}
          >
            אישור
          </button>
        </>
      )}
    >
      <div style={{ fontSize: 13, color: COLORS.muted, marginBottom: 12 }}>{props.item.title}</div>
      <label style={{ display: 'block', fontSize: 13, color: COLORS.muted, marginBottom: 4 }}>
        למה זה לא רלוונטי היום? <span style={{ color: COLORS.danger }}>*</span>
      </label>
      <textarea style={s.textarea} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
      {err && <div style={s.err}>{err}</div>}
    </LockedModalShell>
  );
}

// Kept exported for any consumer that still wants a visibility predicate.
// The portal itself no longer uses this — the tab is always rendered and
// the board shows empty-state inside the panel.
export function shouldShowPortalTab(b: PortalBootstrap | null): boolean {
  if (!b) return false;
  if (b.participant.canManageProjects) return true;
  return b.projects.some((p) => p.status === 'active');
}
