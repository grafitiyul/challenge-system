'use client';

import { useEffect, useMemo, useState } from 'react';
import { BASE_URL, apiFetch } from '@lib/api';

// ─── Shared types (also consumed by the admin tab) ───────────────────────────

export type ProjectItemType = 'boolean' | 'number' | 'select';
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
  createdAt: string;
  logs: ProjectLog[];
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
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const COLORS = {
  bg: '#f8fafc',
  card: '#ffffff',
  border: '#e2e8f0',
  borderStrong: '#cbd5e1',
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
    borderRadius: 12, padding: 16, marginBottom: 12,
  } as React.CSSProperties,
  projectTitle: {
    fontSize: 17, fontWeight: 700, color: COLORS.text, marginBottom: 4,
  } as React.CSSProperties,
  projectDesc: {
    fontSize: 13, color: COLORS.muted, marginBottom: 12,
  } as React.CSSProperties,
  itemRow: {
    padding: '12px 0', borderTop: `1px solid ${COLORS.border}`,
  } as React.CSSProperties,
  itemTitle: {
    fontSize: 15, fontWeight: 600, color: COLORS.text, marginBottom: 8,
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

function statusPillFromLog(log: ProjectLog | null): { label: string; bg: string; color: string } {
  if (!log) return { label: 'לא דווח', bg: '#f1f5f9', color: COLORS.muted };
  switch (log.status) {
    case 'completed':
      return { label: 'הושלם', bg: COLORS.successSoft, color: COLORS.success };
    case 'value':
      return { label: 'דווח ערך', bg: COLORS.accentSoft, color: COLORS.accent };
    case 'skipped_today':
      return { label: 'דילוג ליום', bg: COLORS.warnSoft, color: COLORS.warn };
    case 'committed':
      return { label: 'מתחייבת', bg: COLORS.dangerSoft, color: COLORS.danger };
    default:
      return { label: log.status, bg: '#f1f5f9', color: COLORS.muted };
  }
}

// Whether an item's creation date is ≤ the given logDate. Used to hide the
// "not completed" state for items that didn't exist yet on that day.
function itemExistsOn(item: ProjectItem, date: string): boolean {
  // Take only the YYYY-MM-DD of item.createdAt in Asia/Jerusalem
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
  const [commitForItem, setCommitForItem] = useState<ProjectItem | null>(null);

  async function reload() {
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
  }

  useEffect(() => { void reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [token]);

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
      {/* Today / Yesterday toggle */}
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
          <div style={s.projectTitle}>{p.title}</div>
          {p.description && <div style={s.projectDesc}>{p.description}</div>}

          {p.items.filter((i) => !i.isArchived).length === 0 ? (
            <div style={{ color: COLORS.muted, fontSize: 13, padding: '8px 0' }}>
              {canManage ? 'אין פריטים עדיין — הוסיפי אחד למטה.' : 'אין פריטים לדווח עליהם.'}
            </div>
          ) : (
            p.items.filter((i) => !i.isArchived).map((item) => (
              <ItemReportRow
                key={item.id}
                token={token}
                item={item}
                date={dateStr}
                visible={itemExistsOn(item, dateStr)}
                onChanged={reload}
                onOpenSkip={() => setSkipForItem(item)}
                onOpenCommit={() => setCommitForItem(item)}
              />
            ))
          )}

          {canManage && (
            <div style={{ marginTop: 12 }}>
              <button style={s.ghostBtn} onClick={() => setAddItemForProject(p.id)}>+ הוסף פריט</button>
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
        <AddItemModal
          token={token}
          projectId={addItemForProject}
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
        <SkipCommitModal
          token={token}
          item={skipForItem}
          date={dateStr}
          kind="skipped_today"
          onClose={() => setSkipForItem(null)}
          onSaved={() => { setSkipForItem(null); void reload(); }}
        />
      )}

      {commitForItem && (
        <SkipCommitModal
          token={token}
          item={commitForItem}
          date={dateStr}
          kind="committed"
          onClose={() => setCommitForItem(null)}
          onSaved={() => { setCommitForItem(null); void reload(); }}
        />
      )}
    </div>
  );
}

// ─── Item row (per-day reporting UI) ─────────────────────────────────────────

function ItemReportRow(props: {
  token: string;
  item: ProjectItem;
  date: string;
  visible: boolean;
  onChanged: () => void;
  onOpenSkip: () => void;
  onOpenCommit: () => void;
}) {
  const { token, item, date, visible, onChanged, onOpenSkip, onOpenCommit } = props;
  const log = logForDate(item, date);
  const pill = statusPillFromLog(log);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Local editable state for number input
  const [numDraft, setNumDraft] = useState<string>(
    log?.numericValue !== null && log?.numericValue !== undefined ? String(log.numericValue) : '',
  );
  useEffect(() => {
    setNumDraft(log?.numericValue !== null && log?.numericValue !== undefined ? String(log.numericValue) : '');
  }, [log?.id, log?.numericValue]);

  if (!visible) {
    // The item didn't exist on this date — don't penalize with a "not completed" pill.
    return (
      <div style={s.itemRow}>
        <div style={{ ...s.itemTitle, color: COLORS.mutedLight }}>{item.title}</div>
        <div style={{ fontSize: 12, color: COLORS.mutedLight }}>נוצר אחרי תאריך זה</div>
      </div>
    );
  }

  async function upsert(body: Record<string, unknown>) {
    setBusy(true); setErr('');
    try {
      await apiFetch(`${BASE_URL}/public/projects/${token}/items/${item.id}/logs`, {
        method: 'POST',
        body: JSON.stringify({ logDate: date, ...body }),
      });
      onChanged();
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: string }).message) : 'שמירה נכשלה';
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={s.itemRow}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={s.itemTitle}>
            {item.title}
            {item.unit && <span style={{ fontWeight: 400, color: COLORS.muted, fontSize: 13, marginInlineStart: 6 }}>({item.unit})</span>}
            {item.targetValue !== null && item.targetValue !== undefined && (
              <span style={{ fontWeight: 400, color: COLORS.muted, fontSize: 13, marginInlineStart: 6 }}>
                יעד {item.targetValue}
              </span>
            )}
          </div>
        </div>
        <span style={s.statusChip(pill.bg, pill.color)}>{pill.label}</span>
      </div>

      {/* Type-appropriate input */}
      {item.itemType === 'boolean' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            style={{
              ...s.primaryBtn,
              background: log?.status === 'completed' ? COLORS.success : COLORS.accent,
              opacity: busy ? 0.5 : 1,
            }}
            disabled={busy}
            onClick={() => upsert({ status: 'completed' })}
          >
            ✓ סמני שבוצע
          </button>
          <button style={s.ghostBtn} disabled={busy} onClick={onOpenSkip}>דילוג ליום</button>
          <button style={s.ghostBtn} disabled={busy} onClick={onOpenCommit}>מתחייבת לפעם הבאה</button>
        </div>
      )}

      {item.itemType === 'number' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="number"
            inputMode="decimal"
            style={s.numInput}
            value={numDraft}
            onChange={(e) => setNumDraft(e.target.value)}
            disabled={busy}
          />
          <button
            style={{ ...s.primaryBtn, opacity: busy ? 0.5 : 1 }}
            disabled={busy || numDraft.trim() === '' || isNaN(parseFloat(numDraft))}
            onClick={() => upsert({ status: 'completed', numericValue: parseFloat(numDraft) })}
          >
            שמרי
          </button>
          <button style={s.ghostBtn} disabled={busy} onClick={onOpenSkip}>דילוג ליום</button>
          <button style={s.ghostBtn} disabled={busy} onClick={onOpenCommit}>מתחייבת</button>
        </div>
      )}

      {item.itemType === 'select' && item.selectOptions && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {item.selectOptions.map((o) => {
            const active = log?.selectValue === o.value;
            return (
              <button
                key={o.value}
                disabled={busy}
                style={{
                  padding: '10px 14px',
                  border: `2px solid ${active ? COLORS.accent : COLORS.border}`,
                  background: active ? COLORS.accentSoft : COLORS.card,
                  color: active ? COLORS.accent : COLORS.text,
                  borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer',
                  minHeight: 44,
                }}
                onClick={() => upsert({ status: 'completed', selectValue: o.value })}
              >
                {o.label}
              </button>
            );
          })}
          <button style={s.ghostBtn} disabled={busy} onClick={onOpenSkip}>דילוג ליום</button>
          <button style={s.ghostBtn} disabled={busy} onClick={onOpenCommit}>מתחייבת</button>
        </div>
      )}

      {log?.status === 'skipped_today' && log.skipNote && (
        <div style={{ fontSize: 12, color: COLORS.warn, marginTop: 6 }}>סיבה: {log.skipNote}</div>
      )}
      {log?.status === 'committed' && log.commitNote && (
        <div style={{ fontSize: 12, color: COLORS.danger, marginTop: 6 }}>התחייבות: {log.commitNote}</div>
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
    <div style={s.backdrop} onClick={props.onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>צור פרויקט חדש</div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 13, color: COLORS.muted, marginBottom: 4 }}>כותרת</label>
          <input style={s.textInput} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, color: COLORS.muted, marginBottom: 4 }}>תיאור (לא חובה)</label>
          <textarea style={s.textarea} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        {err && <div style={s.err}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <button style={s.ghostBtn} onClick={props.onClose} disabled={busy}>ביטול</button>
          <button style={s.primaryBtn} onClick={submit} disabled={busy}>שמרי</button>
        </div>
      </div>
    </div>
  );
}

function AddItemModal(props: { token: string; projectId: string; onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [itemType, setItemType] = useState<ProjectItemType>('boolean');
  const [unit, setUnit] = useState('');
  const [targetValue, setTargetValue] = useState('');
  const [options, setOptions] = useState<SelectOption[]>([{ value: '', label: '' }]);
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
        .map((o) => ({ value: o.value.trim(), label: o.label.trim() || o.value.trim() }))
        .filter((o) => o.value);
      if (clean.length === 0) { setErr('חובה להגדיר לפחות אפשרות אחת'); return; }
      body.selectOptions = clean;
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
    <div style={s.backdrop} onClick={props.onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>הוסיפי פריט</div>

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

        {itemType === 'select' && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 13, color: COLORS.muted, marginBottom: 4 }}>אפשרויות</label>
            {options.map((o, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <input
                  style={{ ...s.textInput, flex: 1 }}
                  placeholder="ערך (באנגלית)"
                  value={o.value}
                  onChange={(e) => {
                    const next = [...options];
                    next[idx] = { ...next[idx], value: e.target.value };
                    setOptions(next);
                  }}
                />
                <input
                  style={{ ...s.textInput, flex: 1 }}
                  placeholder="תווית"
                  value={o.label}
                  onChange={(e) => {
                    const next = [...options];
                    next[idx] = { ...next[idx], label: e.target.value };
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
            <button style={s.ghostBtn} onClick={() => setOptions([...options, { value: '', label: '' }])}>
              + הוסיפי אפשרות
            </button>
          </div>
        )}

        {err && <div style={s.err}>{err}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <button style={s.ghostBtn} onClick={props.onClose} disabled={busy}>ביטול</button>
          <button style={s.primaryBtn} onClick={submit} disabled={busy}>שמרי</button>
        </div>
      </div>
    </div>
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
    <div style={s.backdrop} onClick={props.onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>הוסיפי הערה</div>
        <textarea style={s.textarea} value={content} onChange={(e) => setContent(e.target.value)} autoFocus />
        {err && <div style={s.err}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button style={s.ghostBtn} onClick={props.onClose} disabled={busy}>ביטול</button>
          <button style={s.primaryBtn} onClick={submit} disabled={busy}>שמרי</button>
        </div>
      </div>
    </div>
  );
}

function SkipCommitModal(props: {
  token: string;
  item: ProjectItem;
  date: string;
  kind: 'skipped_today' | 'committed';
  onClose: () => void;
  onSaved: () => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const title = props.kind === 'skipped_today' ? 'דילוג ליום הזה' : 'מתחייבת לפעם הבאה';
  const noteLabel = props.kind === 'skipped_today' ? 'סיבה (לא חובה)' : 'מה את מתחייבת (לא חובה)';

  async function submit() {
    setBusy(true); setErr('');
    try {
      const body: Record<string, unknown> = {
        logDate: props.date,
        status: props.kind,
      };
      if (note.trim()) {
        body[props.kind === 'skipped_today' ? 'skipNote' : 'commitNote'] = note.trim();
      }
      await apiFetch(
        `${BASE_URL}/public/projects/${props.token}/items/${props.item.id}/logs`,
        { method: 'POST', body: JSON.stringify(body) },
      );
      props.onSaved();
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: string }).message) : 'שמירה נכשלה';
      setErr(msg);
    } finally { setBusy(false); }
  }

  return (
    <div style={s.backdrop} onClick={props.onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 13, color: COLORS.muted, marginBottom: 12 }}>{props.item.title}</div>
        <label style={{ display: 'block', fontSize: 13, color: COLORS.muted, marginBottom: 4 }}>{noteLabel}</label>
        <textarea style={s.textarea} value={note} onChange={(e) => setNote(e.target.value)} />
        {err && <div style={s.err}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button style={s.ghostBtn} onClick={props.onClose} disabled={busy}>ביטול</button>
          <button style={s.primaryBtn} onClick={submit} disabled={busy}>אישור</button>
        </div>
      </div>
    </div>
  );
}

// ─── Utility to decide if the portal tab should be visible at all ────────────
// Exported so the portal page can call it without re-fetching twice: once
// the bootstrap has loaded, the page knows whether there are projects or
// whether the participant has management rights. If neither is true, hide
// the tab entirely (per the product spec).
export function shouldShowPortalTab(b: PortalBootstrap | null): boolean {
  if (!b) return false;
  if (b.participant.canManageProjects) return true;
  return b.projects.some((p) => p.status === 'active');
}
