'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BASE_URL, apiFetch } from '@lib/api';

// Phase 5: YYYY-MM-DD format for midnight-UTC Date values.
function toIso(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// Phase 4: single media-query breakpoint shared by all project surfaces.
// ≥ 768 px → desktop row-based layout; below → mobile card layout.
const DESKTOP_MQ = '(min-width: 768px)';

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(DESKTOP_MQ).matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(DESKTOP_MQ);
    const onChange = () => setIsDesktop(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return isDesktop;
}

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
  // Phase 3: scheduling intent (boolean items only). Drives the per-week
  // status chip and "suggested days" picker — never counts toward completion.
  scheduleFrequencyType: 'none' | 'daily' | 'weekly';
  scheduleTimesPerWeek: number | null;
  schedulePreferredWeekdays: string | null; // CSV of 0..6
  // Phase 4: optional end date for the goal. null = indefinite.
  endDate: string | null;
  createdAt: string;
  logs: ProjectLog[];
}

export interface LinkableTask { id: string; title: string; }

// Phase 5: stats response shape (shared with admin-projects.tsx).
export interface StatsPerDay {
  date: string;              // YYYY-MM-DD
  completed: boolean;
  skipped: boolean;
  noteText: string | null;
}

export interface StatsItem {
  id: string;
  title: string;
  itemType: ProjectItemType;
  frequencyType: 'none' | 'daily' | 'weekly';
  completedCount: number;
  expectedCount: number;
  percentage: number | null; // null when expectedCount === 0
  colorBand: 'green' | 'yellow' | 'red' | null;
  perDay: StatsPerDay[];
}

export interface StatsProject {
  id: string;
  title: string;
  colorHex: string | null;
  items: StatsItem[];
}

export interface StatsResponse {
  range: { from: string; to: string };
  projects: StatsProject[];
}

// Phase 3: per-week scheduling status, keyed by item id in PortalBootstrap.
export interface ItemSchedulingStatus {
  frequencyType: 'daily' | 'weekly';
  expectedCount: number;
  actualCount: number;
  // Phase 4.1: # assignments that are isCompleted=true this week.
  // Used for the "X מתוך Y הושלמו השבוע" weekly clarity line.
  completedCount: number;
  missingCount: number;
  // Phase 4 adds 'ended' — emitted when today > endDate.
  state: 'planned' | 'missing' | 'suggested' | 'ended';
  preferredWeekdays: number[] | null;
  unscheduledCompletionCount: number;
  suggestedDates: string[]; // YYYY-MM-DD
}

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
  // Phase 3: per-item scheduling status for the current week. Missing entries
  // = goal has no schedule config (no chip shown).
  schedulingStatus: Record<string, ItemSchedulingStatus>;
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
  // Phase 4.1: parent (PlanTab) receives this to switch to the "התכנון שלי"
  // view when the participant taps the linked-task chip on a project goal.
  onViewLinkedTask?: (taskId: string) => void;
}

export function PortalProjectsBoard({ token, onViewLinkedTask }: PortalBoardProps) {
  const isDesktop = useIsDesktop();
  const [data, setData] = useState<PortalBootstrap | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [loading, setLoading] = useState(true);
  // Phase 5: extended from day-only to include range-level stats views.
  const [selectedView, setSelectedView] = useState<'today' | 'yesterday' | 'week' | 'month' | 'custom'>('today');
  const [customFrom, setCustomFrom] = useState<string>('');
  const [customTo, setCustomTo] = useState<string>('');
  const [statsData, setStatsData] = useState<StatsResponse | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsErr, setStatsErr] = useState('');
  const [statsDetail, setStatsDetail] = useState<StatsItem | null>(null);

  // Modal state
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [addItemForProject, setAddItemForProject] = useState<string | null>(null);
  const [noteForProject, setNoteForProject] = useState<string | null>(null);
  const [skipForItem, setSkipForItem] = useState<ProjectItem | null>(null);
  // Remove-confirmation (in-app modal; replaces browser confirm()).
  const [removeProject, setRemoveProject] = useState<Project | null>(null);
  const [removeGoalByItem, setRemoveGoalByItem] = useState<ProjectItem | null>(null);
  // Phase 3: "fill week" modal state
  const [fillWeekItem, setFillWeekItem] = useState<ProjectItem | null>(null);
  // Phase 4: after a goal with a frequency is created, auto-open the fill
  // modal the first time the goal appears in state after reload.
  const autoOpenPendingIdRef = useRef<string | null>(null);

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

  // Phase 4: after goal creation reload, auto-open FillWeekModal once for
  // the freshly-created goal. Runs whenever data changes; short-circuits
  // when no pending id is queued.
  useEffect(() => {
    if (!autoOpenPendingIdRef.current) return;
    if (!data) return;
    const pendingId = autoOpenPendingIdRef.current;
    const newly = data.projects
      .flatMap((p) => p.items)
      .find((it) => it.id === pendingId);
    if (newly) {
      autoOpenPendingIdRef.current = null;
      setFillWeekItem(newly);
    }
  }, [data]);

  const isStatsView = selectedView === 'week' || selectedView === 'month' || selectedView === 'custom';
  const dateStr = data ? (selectedView === 'today' ? data.today : selectedView === 'yesterday' ? data.yesterday : '') : '';

  // Phase 5: derive stats range from the selected view.
  const statsRange = useMemo(() => {
    if (!data || !isStatsView) return null;
    const todayIso = data.today;
    const [y, m, d] = todayIso.split('-').map((n) => parseInt(n, 10));
    const todayUtc = new Date(Date.UTC(y, m - 1, d));
    if (selectedView === 'week') {
      const dow = todayUtc.getUTCDay();
      const start = new Date(Date.UTC(y, m - 1, d - dow));
      const end = new Date(Date.UTC(y, m - 1, d - dow + 6));
      return { from: toIso(start), to: toIso(end) };
    }
    if (selectedView === 'month') {
      const start = new Date(Date.UTC(y, m - 1, 1));
      const end = new Date(Date.UTC(y, m, 0)); // last day of current month
      return { from: toIso(start), to: toIso(end) };
    }
    // custom
    if (customFrom && customTo && customFrom <= customTo) {
      return { from: customFrom, to: customTo };
    }
    return null;
  }, [data, selectedView, customFrom, customTo, isStatsView]);

  // Phase 5: fetch stats when the selected view is range-based.
  useEffect(() => {
    if (!isStatsView || !statsRange) { setStatsData(null); return; }
    setStatsLoading(true); setStatsErr('');
    apiFetch<StatsResponse>(
      `${BASE_URL}/public/projects/${token}/stats?from=${statsRange.from}&to=${statsRange.to}`,
      { cache: 'no-store' },
    )
      .then((r) => setStatsData(r))
      .catch((e: unknown) => {
        const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: string }).message) : 'טעינת סטטיסטיקה נכשלה';
        setStatsErr(msg);
      })
      .finally(() => setStatsLoading(false));
  }, [token, statsRange, isStatsView]);

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
        {/* Phase 5: day views + range-level stats views in one selector. */}
        <div style={{ ...s.toggleGroup, flexWrap: 'wrap' as const }}>
          {([
            ['today', 'היום'],
            ['yesterday', 'אתמול'],
            ['week', 'שבוע'],
            ['month', 'חודש'],
            ['custom', 'מותאם'],
          ] as const).map(([k, label]) => (
            <button
              key={k}
              style={s.toggleBtn(selectedView === k)}
              onClick={() => setSelectedView(k)}
            >{label}</button>
          ))}
        </div>
        {canManage && !isStatsView && (
          <button style={{ ...s.primaryBtn, marginInlineStart: 'auto' }} onClick={() => setCreateProjectOpen(true)}>
            + צור פרויקט חדש
          </button>
        )}
      </div>

      {/* Phase 5: custom date picker — only visible when 'custom' is selected. */}
      {selectedView === 'custom' && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' as const }}>
          <label style={{ fontSize: 12, color: COLORS.muted, display: 'flex', alignItems: 'center', gap: 6 }}>
            מ:
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
              style={{ ...s.textInput, width: 160, minHeight: 40 }} />
          </label>
          <label style={{ fontSize: 12, color: COLORS.muted, display: 'flex', alignItems: 'center', gap: 6 }}>
            עד:
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
              style={{ ...s.textInput, width: 160, minHeight: 40 }} />
          </label>
        </div>
      )}

      {/* Phase 5: stats view takes over when a range view is selected. */}
      {isStatsView && (
        <StatsView
          loading={statsLoading}
          err={statsErr}
          data={statsData}
          onOpenDetail={(it) => setStatsDetail(it)}
        />
      )}

      {!isStatsView && visibleProjects.length === 0 && (
        <div style={{ ...s.card, textAlign: 'center', color: COLORS.muted, padding: 32 }}>
          {canManage
            ? 'אין פרויקטים עדיין. לחצי "צור פרויקט חדש" כדי להתחיל.'
            : 'המאמנת עדיין לא הקצתה לך פרויקטים.'}
        </div>
      )}

      {!isStatsView && visibleProjects.map((p) => (
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
                today={data.today}
                visible={itemExistsOn(item, dateStr)}
                canManage={canManage}
                isDesktop={isDesktop}
                scheduledKeys={data.scheduledKeys}
                schedulingStatus={data.schedulingStatus[item.id] ?? null}
                onChanged={reload}
                onOpenSkip={() => setSkipForItem(item)}
                onOpenRemove={() => setRemoveGoalByItem(item)}
                onOpenFillWeek={() => setFillWeekItem(item)}
                onViewLinkedTask={onViewLinkedTask}
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
          onCreated={(newItem) => {
            setAddItemForProject(null);
            // Phase 4 auto-open flow: if the new goal has a frequency,
            // immediately open FillWeekModal so the participant doesn't
            // land on an action-less row.
            if (newItem && newItem.frequencyType !== 'none') {
              void reload().then(() => {
                // Wait for the reload so the fresh item appears in state
                // before we reference it from data.projects.
                // Find it after reload via a deferred effect.
                autoOpenPendingIdRef.current = newItem.id;
              });
            } else {
              void reload();
            }
          }}
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

      {/* Phase 5: stats detail modal with day-strip chart. */}
      {statsDetail && (
        <StatsDetailModal
          item={statsDetail}
          onClose={() => setStatsDetail(null)}
        />
      )}

      {fillWeekItem && (() => {
        const status = data.schedulingStatus[fillWeekItem.id];
        if (!status) { setFillWeekItem(null); return null; }
        // Build available week dates: Sun..Sat starting from this week's Sunday.
        const [ty, tm, td] = data.today.split('-').map((n) => parseInt(n, 10));
        const todayUtc = new Date(Date.UTC(ty, tm - 1, td));
        const dayOfWeek = todayUtc.getUTCDay();
        const weekStart = new Date(Date.UTC(ty, tm - 1, td - dayOfWeek));
        const scheduledSet = new Set(
          data.scheduledKeys.filter((k) => k.startsWith(`${fillWeekItem.id}|`)).map((k) => k.split('|')[1]),
        );
        const availableWeekDates = [] as { iso: string; weekdayLabel: string; alreadyScheduled: boolean; inPast: boolean }[];
        for (let i = 0; i < 7; i++) {
          const d = new Date(weekStart.getTime() + i * 86_400_000);
          const iso = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
          availableWeekDates.push({
            iso,
            weekdayLabel: WEEKDAY_LABELS[d.getUTCDay()],
            alreadyScheduled: scheduledSet.has(iso),
            inPast: iso < data.today,
          });
        }
        return (
          <FillWeekModal
            token={token}
            item={fillWeekItem}
            suggestedDates={status.suggestedDates}
            availableWeekDates={availableWeekDates}
            needsTaskTitle={status.state === 'suggested'}
            onClose={() => setFillWeekItem(null)}
            onSaved={() => { setFillWeekItem(null); void reload(); }}
          />
        );
      })()}
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
  today: string;              // ← Phase 4: pass today explicitly for the ended check
  visible: boolean;
  canManage: boolean;
  isDesktop: boolean;         // ← Phase 4: desktop layout switch at ≥ 768px
  scheduledKeys: string[];
  schedulingStatus: ItemSchedulingStatus | null;
  onChanged: () => void;
  onOpenSkip: () => void;
  onOpenRemove: () => void;
  onOpenFillWeek: () => void;
  // Phase 4.1: tapping "🔗 משימה בלו״ז" chip jumps to the linked task.
  onViewLinkedTask?: (taskId: string) => void;
}) {
  const { token, item, date, today, visible, canManage, isDesktop, scheduledKeys, schedulingStatus,
          onChanged, onOpenSkip, onOpenRemove, onOpenFillWeek, onViewLinkedTask } = props;
  const log = logForDate(item, date);
  const pill = statusPillFromLog(log);
  const isLinked = !!item.linkedPlanTaskId;
  const hasScheduledAssignment = isLinked && scheduledKeys.includes(`${item.id}|${date}`);
  const completedViaTask = log?.syncSource === 'task';
  const showNotScheduledHint = isLinked && log?.status === 'completed' && !hasScheduledAssignment;

  // Phase 4 strict single-primary-action dispatch (boolean goals only).
  //   'ended'       → disabled "המטרה הסתיימה"
  //   'complete'    → "✓ סמני שבוצע" (or its reversible variant)
  //   'fillMissing' → "📅 השלימי ימים"  (missing state, selected day not scheduled)
  //   'schedule'    → "🔗 הוסיפי ללוח השבוע"  (no/nothing on this day)
  //   'nonBoolean'  → falls through to the existing number/select UIs
  const isEnded =
    schedulingStatus?.state === 'ended'
    || (!!item.endDate && today > item.endDate);

  type PrimaryAction = 'ended' | 'complete' | 'fillMissing' | 'schedule' | 'nonBoolean';
  let primaryAction: PrimaryAction;
  if (item.itemType !== 'boolean') primaryAction = 'nonBoolean';
  else if (isEnded) primaryAction = 'ended';
  else if (hasScheduledAssignment) primaryAction = 'complete';
  else if (schedulingStatus?.state === 'missing') primaryAction = 'fillMissing';
  else primaryAction = 'schedule';

  // Phase 4 secondary: tertiary text link shown ONLY alongside 'complete' when
  // the week has gaps. Never alongside 'schedule' or 'fillMissing' (those are
  // themselves the primary fill action).
  const showFillMissingTertiary =
    primaryAction === 'complete' && schedulingStatus?.state === 'missing';

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

  // Phase 4 desktop layout: row (flex) with compact columns for title,
  // chips, info lines, and the single primary action cluster. Mobile
  // continues with the existing stacked card.
  return (
    <div
      style={{
        ...s.goalCard,
        ...(isDesktop ? {
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '10px 14px',
          marginBottom: 8,
        } : {}),
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        marginBottom: isDesktop ? 0 : 10,
        flex: isDesktop ? 1 : undefined,
        minWidth: 0,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...s.goalTitle, marginBottom: isDesktop ? 0 : 10 }}>
            {item.title}
            {item.unit && <span style={{ fontWeight: 400, color: COLORS.muted, fontSize: 13, marginInlineStart: 6 }}>({item.unit})</span>}
            {item.targetValue !== null && item.targetValue !== undefined && (
              <span style={{ fontWeight: 400, color: COLORS.muted, fontSize: 13, marginInlineStart: 6 }}>
                יעד {item.targetValue}
              </span>
            )}
            {/* Phase 4.1: clickable chip → opens the linked task in the
                 task planner (portal switches view; admin navigates). */}
            {isLinked && item.linkedPlanTaskId && (
              <button
                type="button"
                title="פתח את המשימה המקושרת"
                onClick={(e) => {
                  e.stopPropagation();
                  if (onViewLinkedTask) onViewLinkedTask(item.linkedPlanTaskId!);
                }}
                style={{
                  marginInlineStart: 6,
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '2px 8px', borderRadius: 999,
                  fontSize: 11, fontWeight: 600,
                  background: COLORS.accentSoft, color: COLORS.accent,
                  border: 'none', cursor: onViewLinkedTask ? 'pointer' : 'default',
                }}
              >🔗 למשימה</button>
            )}
            {/* Phase 4.2: exactly ONE status chip per goal row.
                 Precedence (highest wins):
                   1. ended       → 🏁 הסתיים
                   2. no assignments this week → ⚪ לא שובץ
                   3. state=planned → ✓ בתוכנית השבוע
                   4. state=missing → ⚠ חסרים N ימים השבוע
                 The separate 💡 "אפשר להוסיף לתוכנית" chip was removed —
                 "⚪ לא שובץ" is the single unscheduled indicator. */}
            {isEnded ? (
              <span style={{
                marginInlineStart: 6,
                display: 'inline-flex', alignItems: 'center',
                padding: '2px 8px', borderRadius: 999,
                fontSize: 11, fontWeight: 600,
                background: '#f1f5f9', color: COLORS.muted,
              }}>🏁 הסתיים</span>
            ) : schedulingStatus && schedulingStatus.actualCount === 0 ? (
              <span
                title="אין תאריכים בלוח הזמנים השבוע"
                style={{
                  marginInlineStart: 6,
                  display: 'inline-flex', alignItems: 'center',
                  padding: '2px 8px', borderRadius: 999,
                  fontSize: 11, fontWeight: 600,
                  background: '#f1f5f9', color: COLORS.mutedLight,
                }}
              >⏳ לא שובץ עדיין</span>
            ) : schedulingStatus && schedulingStatus.state === 'planned' ? (
              <span style={{
                marginInlineStart: 6,
                display: 'inline-flex', alignItems: 'center',
                padding: '2px 8px', borderRadius: 999,
                fontSize: 11, fontWeight: 600,
                background: COLORS.successSoft, color: COLORS.success,
              }}>✓ בתוכנית השבוע</span>
            ) : schedulingStatus && schedulingStatus.state === 'missing' ? (
              <span style={{
                marginInlineStart: 6,
                display: 'inline-flex', alignItems: 'center',
                padding: '2px 8px', borderRadius: 999,
                fontSize: 11, fontWeight: 600,
                background: COLORS.warnSoft, color: COLORS.warn,
              }}>⚠ {schedulingStatus.missingCount === 1 ? 'חסר יום אחד' : `חסרים ${schedulingStatus.missingCount} ימים`}</span>
            ) : null}
            {/* Phase 4: "עדיין לא שובץ בלו״ז" muted tag for boolean goals
                 that have NO scheduling config set — makes it feel like a
                 temporary state, not a separate mode. */}
            {item.itemType === 'boolean' && !isEnded
              && (!schedulingStatus || schedulingStatus.state === undefined) && (
              <span style={{
                marginInlineStart: 6,
                fontSize: 11, color: COLORS.mutedLight, fontStyle: 'italic' as const,
              }}>עדיין לא שובץ בלו״ז</span>
            )}
          </div>
          {completedViaTask && (
            <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 2 }}>סומן במשימה</div>
          )}
          {showNotScheduledHint && (
            <div style={{ fontSize: 12, color: COLORS.mutedLight, marginTop: 2 }}>
              לא נקבע להיום בלו״ז
            </div>
          )}
          {/* Phase 4.2: single-line weekly summary — compact form.
               Phase 4.3: encouraging wording when completedCount === 0.
               Phase 4.4: positive reinforcement when completedCount === expectedCount. */}
          {schedulingStatus && schedulingStatus.state !== 'ended' && (
            <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 3 }}>
              {schedulingStatus.completedCount === 0 ? (
                'עדיין לא התחלת השבוע'
              ) : schedulingStatus.expectedCount > 0
                  && schedulingStatus.completedCount >= schedulingStatus.expectedCount ? (
                <span style={{ color: COLORS.success, fontWeight: 700 }}>✔ הושלם השבוע</span>
              ) : (
                <>
                  {schedulingStatus.completedCount} מתוך {schedulingStatus.expectedCount} הושלמו
                  {schedulingStatus.missingCount > 0 && (
                    <span style={{ color: COLORS.warn }}>
                      {' · '}חסרים {schedulingStatus.missingCount}
                    </span>
                  )}
                </>
              )}
            </div>
          )}
          {/* Phase 4.2: ad-hoc completions line — shown ONLY when > 0.
               Kept smallest in the hierarchy (11 px, muted-light). */}
          {schedulingStatus && schedulingStatus.unscheduledCompletionCount > 0 && (
            <div style={{ fontSize: 11, color: COLORS.mutedLight, marginTop: 2 }}>
              עשית {schedulingStatus.unscheduledCompletionCount} פעמים בפועל (לא שובץ בלו״ז)
            </div>
          )}
          {/* Phase 4: old in-title fill CTA removed — the primary action now
               lives in the single action cluster below to enforce the
               "one primary per row" rule. */}
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

      {/* Phase 4 strict single-primary-action dispatch for boolean goals.
           Exactly ONE of {ended, complete, fillMissing, schedule} renders.
           On desktop this cluster sits as a right-aligned column; on mobile
           it sits under the title block. Not rendered for number/select —
           those types have their own action UIs below. */}
      {primaryAction !== 'nonBoolean' && (
      <div style={isDesktop
        ? { flexShrink: 0, minWidth: 200, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }
        : {}}>
        {primaryAction === 'ended' && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              disabled
              style={{
                ...s.primaryBtn,
                background: COLORS.mutedLight, color: '#fff',
                cursor: 'not-allowed', opacity: 0.75,
              }}
            >🏁 המטרה הסתיימה</button>
          </div>
        )}

        {primaryAction === 'complete' && (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
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
            {/* Phase 4 tertiary: text-only link. Never competes with the primary. */}
            {showFillMissingTertiary && (
              <button
                onClick={onOpenFillWeek}
                style={{
                  background: 'none', border: 'none', padding: 0,
                  color: COLORS.muted, fontSize: 12, cursor: 'pointer',
                  textDecoration: 'underline', marginTop: 4,
                }}
              >השלימי שאר הימים →</button>
            )}
            {SaveIndicator}
          </>
        )}

        {/* Phase 4.1: demoted from primary button to text link. The row no
             longer shows a competing blue CTA for the "missing" state —
             the weekly clarity line above already communicates the gap. */}
        {primaryAction === 'fillMissing' && (
          <button
            onClick={onOpenFillWeek}
            style={{
              background: 'none', border: 'none', padding: '4px 0',
              color: COLORS.accent, fontSize: 13, fontWeight: 600,
              cursor: 'pointer', textDecoration: 'underline',
            }}
          >הוסיפי ימים חסרים →</button>
        )}

        {primaryAction === 'schedule' && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={s.primaryBtn} onClick={onOpenFillWeek}>
              🔗 הוסיפי ללוח השבוע
            </button>
          </div>
        )}
      </div>
      )}

      {item.itemType === 'number' && (
        <div style={{
          display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center',
          ...(isDesktop ? { flexShrink: 0, minWidth: 200 } : {}),
        }}>
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
        <div style={isDesktop ? { flexShrink: 0, minWidth: 200 } : {}}>
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
        </div>
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
  // Phase 4: onCreated receives the new item so the board can auto-open
  // FillWeekModal when the goal was created with a frequency and has no
  // assignments yet.
  onCreated: (newItem?: { id: string; frequencyType: 'none' | 'daily' | 'weekly' }) => void;
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
  // Phase 3 scheduling fields (boolean only).
  const [freq, setFreq] = useState<'none' | 'daily' | 'weekly'>('none');
  const [timesPerWeek, setTimesPerWeek] = useState<number>(3);
  const [preferredDays, setPreferredDays] = useState<number[]>([]);
  // Phase 4: optional end date. '' = no end date, else "YYYY-MM-DD".
  const [endDate, setEndDate] = useState<string>('');
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
    if (itemType === 'boolean') {
      body.scheduleFrequencyType = freq;
      if (freq === 'weekly') body.scheduleTimesPerWeek = timesPerWeek;
      if (freq !== 'none' && preferredDays.length > 0) {
        body.schedulePreferredWeekdays = preferredDays.slice().sort((a, b) => a - b).join(',');
      }
      if (endDate.trim()) body.endDate = endDate.trim();
    }
    setBusy(true); setErr('');
    try {
      const created = await apiFetch<{ id: string }>(
        `${BASE_URL}/public/projects/${props.token}/projects/${props.projectId}/items`,
        { method: 'POST', body: JSON.stringify(body) },
      );
      props.onCreated({
        id: created.id,
        frequencyType: itemType === 'boolean' ? freq : 'none',
      });
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

      {itemType === 'boolean' && (
        <ScheduleSection
          freq={freq}
          timesPerWeek={timesPerWeek}
          preferredDays={preferredDays}
          onFreq={setFreq}
          onTimesPerWeek={setTimesPerWeek}
          onPreferredDays={setPreferredDays}
        />
      )}

      {itemType === 'boolean' && (
        <EndDateSection endDate={endDate} onEndDate={setEndDate} />
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

// ─── ScheduleSection ────────────────────────────────────────────────────────
// Reusable form section for "איך המטרה הזו מתבצעת?". Used in both
// AddGoalModal (portal) and the admin ItemFormModal (via export). Three
// frequency modes + optional preferred-weekdays pill row.

const WEEKDAY_LABELS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];

// ─── Phase 5 Stats ──────────────────────────────────────────────────────────
// Range-level roll-up rendered when the participant picks שבוע / חודש / מותאם.
// Shows per-item: title · "X מתוך Y (N%)" · color band. Tapping a row opens
// a detail modal with a day-strip chart.

export function StatsView(props: {
  loading: boolean;
  err: string;
  data: StatsResponse | null;
  onOpenDetail: (item: StatsItem) => void;
}) {
  if (props.loading) return <div style={{ padding: 20, color: COLORS.muted, textAlign: 'center' }}>טוען סטטיסטיקה...</div>;
  if (props.err) return <div style={{ padding: 20, color: COLORS.danger, textAlign: 'center' }}>{props.err}</div>;
  if (!props.data) return <div style={{ padding: 20, color: COLORS.muted, textAlign: 'center' }}>בחרי טווח תאריכים</div>;
  if (props.data.projects.length === 0) {
    return <div style={{ padding: 20, color: COLORS.muted, textAlign: 'center' }}>אין פרויקטים בטווח זה.</div>;
  }

  const hasAnyItem = props.data.projects.some((p) => p.items.length > 0);
  if (!hasAnyItem) {
    return <div style={{ padding: 20, color: COLORS.muted, textAlign: 'center' }}>אין נתונים בטווח זה</div>;
  }

  const bandColor = (b: StatsItem['colorBand']) => {
    if (b === 'green') return COLORS.success;
    if (b === 'yellow') return COLORS.warn;
    if (b === 'red') return COLORS.danger;
    return COLORS.mutedLight;
  };

  return (
    <div>
      {props.data.projects.map((p) => (
        <div
          key={p.id}
          style={{ ...s.card, borderInlineStartWidth: 4, borderInlineStartStyle: 'solid', borderInlineStartColor: p.colorHex ?? COLORS.accent }}
        >
          <div style={s.projectTitle}>{p.title}</div>
          {p.items.length === 0 ? (
            <div style={{ fontSize: 13, color: COLORS.muted, padding: '8px 0' }}>אין מטרות בטווח זה.</div>
          ) : p.items.map((it) => {
            const hasNotes = it.perDay.some((d) => d.noteText);
            return (
              <button
                key={it.id}
                onClick={() => props.onOpenDetail(it)}
                style={{
                  width: '100%',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: 8,
                  padding: '12px 14px',
                  background: COLORS.cardAlt,
                  border: `1px solid ${COLORS.borderSoft}`,
                  borderRadius: 10,
                  marginBottom: 8,
                  cursor: 'pointer',
                  textAlign: 'start' as const,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: COLORS.text }}>
                    {it.title}
                    {hasNotes && (
                      <span title="יש הערות בטווח זה" style={{ marginInlineStart: 6, fontSize: 12 }}>📝</span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 2 }}>
                    {it.percentage === null ? (
                      `${it.completedCount} דיווחים`
                    ) : (
                      <>
                        {it.completedCount} מתוך {it.expectedCount}
                        <span style={{ marginInlineStart: 6, fontWeight: 700, color: bandColor(it.colorBand) }}>
                          ({it.percentage}%)
                        </span>
                      </>
                    )}
                  </div>
                </div>
                {it.percentage !== null && (
                  <div
                    style={{
                      width: 12, height: 12, borderRadius: 999,
                      background: bandColor(it.colorBand),
                      flexShrink: 0,
                    }}
                    aria-label={`${it.percentage}%`}
                  />
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// Day-strip chart. Renders one dot per day in the item's perDay[]. Grouped
// into 7-column rows so ranges >1 week wrap nicely. Tapping a dot with a
// note surfaces the note inline.

export function StatsDetailModal(props: {
  item: StatsItem;
  onClose: () => void;
}) {
  const { item } = props;
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const bandColor = item.colorBand === 'green' ? COLORS.success
    : item.colorBand === 'yellow' ? COLORS.warn
    : item.colorBand === 'red' ? COLORS.danger
    : COLORS.mutedLight;

  const expandedDay = expandedDate ? item.perDay.find((d) => d.date === expandedDate) : null;

  return (
    <LockedModalShell
      title={item.title}
      onClose={props.onClose}
      footer={<button style={s.primaryBtn} onClick={props.onClose}>סגור</button>}
    >
      {item.percentage !== null ? (
        <div style={{ fontSize: 14, color: COLORS.text, marginBottom: 12 }}>
          {item.completedCount} מתוך {item.expectedCount}
          <span style={{ marginInlineStart: 8, fontWeight: 700, color: bandColor }}>
            ({item.percentage}%)
          </span>
        </div>
      ) : (
        <div style={{ fontSize: 14, color: COLORS.text, marginBottom: 12 }}>
          {item.completedCount} דיווחים בטווח זה
        </div>
      )}

      {item.perDay.length === 0 ? (
        <div style={{ fontSize: 13, color: COLORS.mutedLight }}>אין ימים בטווח.</div>
      ) : (
        <>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gap: 6,
          }}>
            {item.perDay.map((d) => {
              const hasNote = !!d.noteText;
              const filled = d.completed;
              const skipped = d.skipped;
              const selected = expandedDate === d.date;
              return (
                <button
                  key={d.date}
                  onClick={() => setExpandedDate(selected ? null : hasNote ? d.date : null)}
                  title={d.date + (d.noteText ? ` — ${d.noteText}` : '')}
                  style={{
                    width: '100%', aspectRatio: '1 / 1',
                    border: filled ? `none` : `1px solid ${skipped ? COLORS.warn : COLORS.border}`,
                    background: filled ? COLORS.success : skipped ? COLORS.warnSoft : COLORS.card,
                    borderRadius: 999,
                    cursor: hasNote ? 'pointer' : 'default',
                    position: 'relative' as const,
                    padding: 0,
                    boxShadow: selected ? `0 0 0 2px ${COLORS.accent}` : 'none',
                  }}
                  aria-label={`${d.date} ${filled ? 'הושלם' : skipped ? 'לא רלוונטי' : 'לא דווח'}`}
                >
                  {hasNote && (
                    <span style={{
                      position: 'absolute',
                      top: -4, insetInlineEnd: -4,
                      fontSize: 11, lineHeight: 1,
                      background: '#fff', borderRadius: 999,
                    }}>📝</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', gap: 12, marginTop: 12, fontSize: 11, color: COLORS.mutedLight, flexWrap: 'wrap' as const }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 10, height: 10, borderRadius: 999, background: COLORS.success, display: 'inline-block' }} />
              הושלם
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 10, height: 10, borderRadius: 999, background: COLORS.warnSoft, border: `1px solid ${COLORS.warn}`, display: 'inline-block' }} />
              לא רלוונטי
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 10, height: 10, borderRadius: 999, background: COLORS.card, border: `1px solid ${COLORS.border}`, display: 'inline-block' }} />
              לא דווח
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>📝 הערה</span>
          </div>

          {/* Note drawer */}
          {expandedDay && expandedDay.noteText && (
            <div style={{
              marginTop: 12,
              padding: '10px 12px',
              background: COLORS.warnSoft,
              border: `1px solid ${COLORS.warn}`,
              borderRadius: 8,
              fontSize: 13, color: COLORS.warn,
            }}>
              <div style={{ fontWeight: 700, marginBottom: 2 }}>{expandedDay.date}</div>
              <div style={{ whiteSpace: 'pre-wrap' as const }}>{expandedDay.noteText}</div>
            </div>
          )}
        </>
      )}
    </LockedModalShell>
  );
}

// Phase 4: reusable end-date picker for goal create/edit modals.
// Controls whether a goal has a bounded lifetime. Null/empty → indefinite.
export function EndDateSection(props: {
  endDate: string; // "YYYY-MM-DD" or ""
  onEndDate: (v: string) => void;
}) {
  const hasEnd = props.endDate !== '';
  return (
    <div style={{ marginBottom: 12, paddingTop: 10, borderTop: `1px dashed ${COLORS.border}` }}>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: COLORS.text, marginBottom: 6 }}>
        עד מתי המטרה רלוונטית?
      </label>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <button
          type="button"
          onClick={() => props.onEndDate('')}
          style={{
            flex: 1, padding: '8px 6px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            borderRadius: 8, minHeight: 40,
            border: `2px solid ${!hasEnd ? COLORS.accent : COLORS.border}`,
            background: !hasEnd ? COLORS.accentSoft : COLORS.card,
            color: !hasEnd ? COLORS.accent : COLORS.text,
          }}
        >ללא תאריך סיום</button>
        <button
          type="button"
          onClick={() => {
            if (!hasEnd) {
              // Default to 3 months from today when user first picks "עד תאריך".
              const d = new Date();
              d.setDate(d.getDate() + 90);
              const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
              props.onEndDate(iso);
            }
          }}
          style={{
            flex: 1, padding: '8px 6px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            borderRadius: 8, minHeight: 40,
            border: `2px solid ${hasEnd ? COLORS.accent : COLORS.border}`,
            background: hasEnd ? COLORS.accentSoft : COLORS.card,
            color: hasEnd ? COLORS.accent : COLORS.text,
          }}
        >עד תאריך</button>
      </div>
      {hasEnd && (
        <input
          type="date"
          style={s.textInput}
          value={props.endDate}
          onChange={(e) => props.onEndDate(e.target.value)}
        />
      )}
    </div>
  );
}

export function ScheduleSection(props: {
  freq: 'none' | 'daily' | 'weekly';
  timesPerWeek: number;
  preferredDays: number[];
  onFreq: (f: 'none' | 'daily' | 'weekly') => void;
  onTimesPerWeek: (n: number) => void;
  onPreferredDays: (d: number[]) => void;
}) {
  const { freq, timesPerWeek, preferredDays, onFreq, onTimesPerWeek, onPreferredDays } = props;
  return (
    <div style={{ marginBottom: 12, paddingTop: 10, borderTop: `1px dashed ${COLORS.border}` }}>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: COLORS.text, marginBottom: 6 }}>
        איך המטרה הזו מתבצעת?
      </label>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        {([
          { k: 'none' as const, label: 'עדיין לא שובץ בלו״ז' },
          { k: 'daily' as const, label: 'כל יום' },
          { k: 'weekly' as const, label: 'פעמים בשבוע' },
        ]).map((opt) => (
          <button
            key={opt.k}
            type="button"
            onClick={() => onFreq(opt.k)}
            style={{
              flex: 1, padding: '8px 6px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              borderRadius: 8, minHeight: 40,
              border: `2px solid ${freq === opt.k ? COLORS.accent : COLORS.border}`,
              background: freq === opt.k ? COLORS.accentSoft : COLORS.card,
              color: freq === opt.k ? COLORS.accent : COLORS.text,
            }}
          >{opt.label}</button>
        ))}
      </div>
      {freq === 'weekly' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 13, color: COLORS.muted }}>כמה פעמים בשבוע?</span>
          <input
            type="number" min={1} max={7}
            style={{ ...s.textInput, width: 80 }}
            value={timesPerWeek}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (Number.isFinite(n)) onTimesPerWeek(Math.max(1, Math.min(7, n)));
            }}
          />
        </div>
      )}
      {freq !== 'none' && (
        <div>
          <div style={{ fontSize: 12, color: COLORS.mutedLight, marginBottom: 6 }}>
            ימים מועדפים (לא חובה):
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {WEEKDAY_LABELS.map((lab, idx) => {
              const active = preferredDays.includes(idx);
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    if (active) onPreferredDays(preferredDays.filter((d) => d !== idx));
                    else onPreferredDays([...preferredDays, idx]);
                  }}
                  style={{
                    flex: 1, padding: '8px 2px', minHeight: 36, fontSize: 13, fontWeight: 600,
                    cursor: 'pointer', borderRadius: 8,
                    border: `1px solid ${active ? COLORS.accent : COLORS.border}`,
                    background: active ? COLORS.accentSoft : COLORS.card,
                    color: active ? COLORS.accent : COLORS.text,
                  }}
                >{lab}</button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── FillWeekModal ──────────────────────────────────────────────────────────
// Day picker for the "השלימי ימים" / "הוסיפי ללוח השבוע" CTAs. Pre-checks
// `initialDates` from the server-computed `suggestedDates`; participant can
// un-check freely. On submit, POSTs to the unified schedule endpoint.

export function FillWeekModal(props: {
  token: string | null;        // null → admin flow
  participantId?: string;      // required for admin flow
  item: ProjectItem;
  suggestedDates: string[];
  availableWeekDates: { iso: string; weekdayLabel: string; alreadyScheduled: boolean; inPast: boolean }[];
  needsTaskTitle: boolean;     // true for suggested state (no linked task yet)
  onClose: () => void;
  onSaved: () => void;
}) {
  const [picked, setPicked] = useState<string[]>(props.suggestedDates);
  const [taskTitle, setTaskTitle] = useState<string>(props.item.title);
  // Phase 4: scope. Defaults to "רק השבוע" (non-destructive).
  const [scope, setScope] = useState<'week' | 'recurring'>('week');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    if (picked.length === 0) { setErr('חובה לבחור לפחות יום אחד'); return; }
    if (props.needsTaskTitle && !taskTitle.trim()) { setErr('חובה למלא שם משימה'); return; }
    setBusy(true); setErr('');
    const body: Record<string, unknown> = { dates: picked, scope };
    if (props.needsTaskTitle) body.taskTitle = taskTitle.trim();
    try {
      if (props.token) {
        await apiFetch(
          `${BASE_URL}/public/projects/${props.token}/items/${props.item.id}/schedule`,
          { method: 'POST', body: JSON.stringify(body) },
        );
      } else if (props.participantId) {
        await apiFetch(
          `${BASE_URL}/projects/items/${props.item.id}/schedule?participantId=${encodeURIComponent(props.participantId)}`,
          { method: 'POST', body: JSON.stringify(body) },
        );
      }
      props.onSaved();
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: string }).message) : 'שמירה נכשלה';
      setErr(msg);
    } finally { setBusy(false); }
  }

  return (
    <LockedModalShell
      title={props.needsTaskTitle ? 'הוסיפי ללוח השבוע' : 'השלימי ימים'}
      onClose={props.onClose}
      footer={(
        <>
          <button style={s.ghostBtn} disabled={busy} onClick={props.onClose}>ביטול</button>
          <button style={s.primaryBtn} disabled={busy || picked.length === 0} onClick={submit}>
            {props.needsTaskTitle ? 'צרי ושבצי' : 'שבצי'}
          </button>
        </>
      )}
    >
      <div style={{ fontSize: 13, color: COLORS.muted, marginBottom: 10 }}>{props.item.title}</div>
      {props.needsTaskTitle && (
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 12, color: COLORS.muted, marginBottom: 4 }}>שם המשימה</label>
          <input style={s.textInput} value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} />
        </div>
      )}
      <div style={{ fontSize: 12, color: COLORS.muted, marginBottom: 6 }}>ימים השבוע:</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 14 }}>
        {props.availableWeekDates.map((d) => {
          const disabled = d.inPast || d.alreadyScheduled;
          const checked = picked.includes(d.iso);
          return (
            <button
              key={d.iso}
              type="button"
              disabled={disabled}
              onClick={() => {
                if (checked) setPicked(picked.filter((x) => x !== d.iso));
                else setPicked([...picked, d.iso]);
              }}
              style={{
                padding: '12px 2px', minHeight: 56, fontSize: 13, fontWeight: 600,
                borderRadius: 8,
                cursor: disabled ? 'not-allowed' : 'pointer',
                border: `2px solid ${checked ? COLORS.accent : d.alreadyScheduled ? COLORS.success : COLORS.border}`,
                background: checked ? COLORS.accentSoft
                  : d.alreadyScheduled ? COLORS.successSoft
                  : d.inPast ? '#f1f5f9' : COLORS.card,
                color: checked ? COLORS.accent
                  : d.alreadyScheduled ? COLORS.success
                  : d.inPast ? COLORS.mutedLight : COLORS.text,
                opacity: disabled && !d.alreadyScheduled ? 0.55 : 1,
              }}
              title={
                d.alreadyScheduled ? 'כבר מתוזמן'
                : d.inPast ? 'עבר' : ''
              }
            >
              {d.weekdayLabel}
              {d.alreadyScheduled && <div style={{ fontSize: 9, marginTop: 2 }}>מתוזמן</div>}
            </button>
          );
        })}
      </div>

      {/* Phase 4: scope choice — never silently assume one option. */}
      <div style={{ marginTop: 6, paddingTop: 12, borderTop: `1px dashed ${COLORS.border}` }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.text, marginBottom: 6 }}>היקף:</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 6, cursor: 'pointer' }}>
          <input
            type="radio"
            name="schedule-scope"
            checked={scope === 'week'}
            onChange={() => setScope('week')}
          />
          רק השבוע הזה
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
          <input
            type="radio"
            name="schedule-scope"
            checked={scope === 'recurring'}
            onChange={() => setScope('recurring')}
          />
          כל שבוע מהיום והלאה
        </label>
        {scope === 'recurring' && (
          <div style={{ fontSize: 11, color: COLORS.mutedLight, marginTop: 4, marginInlineStart: 24 }}>
            ניתן לשנות בהמשך דרך עריכת המשימה
          </div>
        )}
      </div>

      {err && <div style={{ ...s.err, marginTop: 10 }}>{err}</div>}
    </LockedModalShell>
  );
}
