'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BASE_URL, apiFetch } from '@lib/api';
import type {
  Project,
  ProjectItem,
  ProjectItemType,
  ProjectLog,
  ProjectLogStatus,
  ProjectNote,
} from '@components/projects-board';

// ─── Styles ──────────────────────────────────────────────────────────────────

const C = {
  bg: '#f8fafc', card: '#ffffff', border: '#e2e8f0',
  borderStrong: '#cbd5e1', text: '#0f172a', muted: '#64748b', mutedLight: '#94a3b8',
  accent: '#2563eb', accentSoft: '#eff6ff',
  success: '#15803d', successSoft: '#dcfce7',
  warn: '#b45309', warnSoft: '#fef3c7',
  danger: '#b91c1c', dangerSoft: '#fef2f2',
};

const st = {
  toggleRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: 16, background: C.accentSoft, borderRadius: 10, marginBottom: 20,
  } as React.CSSProperties,
  input: {
    width: '100%', padding: '9px 12px', border: `1px solid ${C.borderStrong}`,
    borderRadius: 8, fontSize: 14, color: C.text, background: '#fff',
    boxSizing: 'border-box', fontFamily: 'inherit', outline: 'none',
  } as React.CSSProperties,
  textarea: {
    width: '100%', padding: '9px 12px', border: `1px solid ${C.borderStrong}`,
    borderRadius: 8, fontSize: 14, color: C.text, background: '#fff',
    boxSizing: 'border-box' as const, fontFamily: 'inherit', outline: 'none',
    minHeight: 80, resize: 'vertical' as const,
  } as React.CSSProperties,
  primaryBtn: {
    padding: '8px 14px', fontSize: 13, fontWeight: 600,
    background: C.accent, color: '#fff', border: 'none',
    borderRadius: 8, cursor: 'pointer',
  } as React.CSSProperties,
  ghostBtn: {
    padding: '7px 12px', fontSize: 12, fontWeight: 600,
    background: 'transparent', color: C.muted,
    border: `1px solid ${C.border}`, borderRadius: 8, cursor: 'pointer',
  } as React.CSSProperties,
  dangerBtn: {
    padding: '7px 12px', fontSize: 12, fontWeight: 600,
    background: 'transparent', color: C.danger,
    border: `1px solid ${C.dangerSoft}`, borderRadius: 8, cursor: 'pointer',
  } as React.CSSProperties,
  projectCard: {
    background: C.card, border: `1px solid ${C.border}`,
    borderRadius: 12, padding: 16, marginBottom: 12,
  } as React.CSSProperties,
  itemRow: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '10px 0', borderTop: `1px solid ${C.border}`,
  } as React.CSSProperties,
  chip: (bg: string, color: string): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px',
    borderRadius: 999, fontSize: 11, fontWeight: 700,
    background: bg, color,
  }),
  backdrop: {
    position: 'fixed' as const, inset: 0, background: 'rgba(15,23,42,0.4)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000, padding: 16,
  } as React.CSSProperties,
  modal: {
    background: C.card, borderRadius: 12, padding: 20,
    width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto' as const,
  } as React.CSSProperties,
  err: { fontSize: 12, color: C.danger, marginTop: 6 } as React.CSSProperties,
};

// ─── Types returned by the admin API ─────────────────────────────────────────

interface AdminListResponse {
  projects: Project[];
  notes: ProjectNote[];
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface AdminProjectsTabProps {
  participantId: string;
  canManageProjects: boolean;
  onPermissionChanged?: (next: boolean) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AdminProjectsTab({ participantId, canManageProjects, onPermissionChanged }: AdminProjectsTabProps) {
  const [data, setData] = useState<AdminListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');

  const [permBusy, setPermBusy] = useState(false);

  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [editProject, setEditProject] = useState<Project | null>(null);
  const [addItemForProject, setAddItemForProject] = useState<Project | null>(null);
  const [editItem, setEditItem] = useState<ProjectItem | null>(null);
  const [logItem, setLogItem] = useState<{ item: ProjectItem; date: string } | null>(null);
  const [noteProject, setNoteProject] = useState<Project | null>(null);

  const reload = useCallback(async () => {
    try {
      const d = await apiFetch<AdminListResponse>(
        `${BASE_URL}/projects/by-participant/${participantId}`,
        { cache: 'no-store' },
      );
      setData(d); setLoadErr('');
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: string }).message) : 'טעינה נכשלה';
      setLoadErr(msg);
    } finally { setLoading(false); }
  }, [participantId]);

  useEffect(() => { void reload(); }, [reload]);

  async function togglePermission() {
    setPermBusy(true);
    try {
      await apiFetch(`${BASE_URL}/projects/participants/${participantId}/permission`, {
        method: 'PATCH',
        body: JSON.stringify({ value: !canManageProjects }),
      });
      onPermissionChanged?.(!canManageProjects);
    } catch {
      // keep UI consistent with latest server state — reload the full participant
    } finally { setPermBusy(false); }
  }

  async function archiveProject(p: Project) {
    if (!confirm(`להעביר לארכיון את "${p.title}"?`)) return;
    await apiFetch(`${BASE_URL}/projects/${p.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'archived' }),
    });
    void reload();
  }

  async function unarchiveProject(p: Project) {
    await apiFetch(`${BASE_URL}/projects/${p.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'active' }),
    });
    void reload();
  }

  // Permanent, irreversible delete.
  // Two-step confirmation:
  //   1. Plain confirm with the destructive consequences.
  //   2. Type-to-confirm prompt with the project title to prevent
  //      accidental clicks.
  async function hardDeleteProject(p: Project) {
    const stepOne = confirm(
      `מחיקה מלאה של "${p.title}"?\n\n` +
      `⚠ פעולה בלתי-הפיכה.\n` +
      `תימחקו לצמיתות:\n` +
      `• הפרויקט\n` +
      `• כל המטרות שבו\n` +
      `• כל הדיווחים (היסטוריה)\n` +
      `• כל ההערות\n\n` +
      `להמשיך?`,
    );
    if (!stepOne) return;
    const typed = prompt(`לאישור סופי — רשמי את שם הפרויקט:\n"${p.title}"`);
    if (typed === null) return;
    if (typed.trim() !== p.title.trim()) {
      alert('השם שהוזן לא תואם. המחיקה בוטלה.');
      return;
    }
    try {
      await apiFetch(`${BASE_URL}/projects/${p.id}/hard`, { method: 'DELETE' });
      void reload();
    } catch (e: unknown) {
      alert(e && typeof e === 'object' && 'message' in e ? String((e as { message: string }).message) : 'מחיקה נכשלה');
    }
  }

  async function archiveItem(it: ProjectItem) {
    if (!confirm(`להעביר לארכיון את "${it.title}"?`)) return;
    await apiFetch(`${BASE_URL}/projects/items/${it.id}`, { method: 'DELETE' });
    void reload();
  }

  async function moveItem(projectId: string, items: ProjectItem[], fromIdx: number, dir: -1 | 1) {
    const toIdx = fromIdx + dir;
    if (toIdx < 0 || toIdx >= items.length) return;
    const next = [...items];
    [next[fromIdx], next[toIdx]] = [next[toIdx], next[fromIdx]];
    await apiFetch(`${BASE_URL}/projects/${projectId}/items/reorder`, {
      method: 'POST',
      body: JSON.stringify({ items: next.map((it, i) => ({ id: it.id, sortOrder: i })) }),
    });
    void reload();
  }

  const notesByProject = useMemo(() => {
    const m = new Map<string, ProjectNote[]>();
    if (!data) return m;
    for (const n of data.notes) {
      const arr = m.get(n.projectId) ?? [];
      arr.push(n);
      m.set(n.projectId, arr);
    }
    return m;
  }, [data]);

  if (loading) return <div style={{ padding: 20, color: C.muted }}>טוען...</div>;
  if (loadErr) return <div style={{ padding: 20, color: C.danger }}>{loadErr}</div>;
  if (!data) return null;

  return (
    <div>
      {/* Permission toggle */}
      <div style={st.toggleRow}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.text }}>רשאית לנהל פרויקטים</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
            כאשר פעיל, המשתתפת יכולה לפתוח פרויקטים משלה דרך הפורטל.
          </div>
        </div>
        <button
          style={{
            ...st.primaryBtn,
            background: canManageProjects ? C.success : C.mutedLight,
            minWidth: 80,
          }}
          disabled={permBusy}
          onClick={togglePermission}
        >
          {canManageProjects ? 'פעיל' : 'כבוי'}
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>פרויקטים</div>
        <button style={st.primaryBtn} onClick={() => setCreateProjectOpen(true)}>+ צור פרויקט חדש</button>
      </div>

      {data.projects.length === 0 && (
        <div style={{ ...st.projectCard, textAlign: 'center', color: C.muted, padding: 40 }}>
          עדיין אין פרויקטים למשתתפת זו.
        </div>
      )}

      {data.projects.map((p) => {
        const items = p.items.filter((it) => !it.isArchived);
        const archived = p.items.filter((it) => it.isArchived);
        const notes = notesByProject.get(p.id) ?? [];
        return (
          <div key={p.id} style={{ ...st.projectCard, borderInlineStartWidth: 4, borderInlineStartStyle: 'solid', borderInlineStartColor: p.colorHex ?? C.accent, opacity: p.status === 'active' ? 1 : 0.6 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>
                  {p.title}
                  <span style={{ marginInlineStart: 8, ...st.chip(
                    p.status === 'active' ? C.successSoft : C.warnSoft,
                    p.status === 'active' ? C.success : C.warn,
                  ) }}>
                    {p.status === 'active' ? 'פעיל' : p.status === 'archived' ? 'בארכיון' : 'בוטל'}
                  </span>
                  <span style={{ marginInlineStart: 6, ...st.chip(C.accentSoft, C.accent) }}>
                    נוצר על ידי {p.createdByRole === 'admin' ? 'מאמנת' : 'משתתפת'}
                  </span>
                </div>
                {p.description && (
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{p.description}</div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button style={st.ghostBtn} onClick={() => setEditProject(p)}>ערוך</button>
                {p.status === 'active' ? (
                  <button style={st.dangerBtn} onClick={() => archiveProject(p)}>לארכיון</button>
                ) : (
                  <button style={st.ghostBtn} onClick={() => unarchiveProject(p)}>שחזר</button>
                )}
                <button
                  style={{ ...st.dangerBtn, background: C.dangerSoft, borderColor: C.danger }}
                  onClick={() => hardDeleteProject(p)}
                  title="מחיקה מלאה — פעולה בלתי הפיכה"
                >
                  🗑 מחק פרויקט
                </button>
              </div>
            </div>

            {items.length === 0 ? (
              <div style={{ fontSize: 13, color: C.muted, padding: '12px 0', borderTop: `1px solid ${C.border}` }}>
                אין מטרות עדיין.
              </div>
            ) : (
              items.map((it, idx) => (
                <div key={it.id} style={st.itemRow}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>
                      {it.title}
                      <span style={{ marginInlineStart: 6, ...st.chip('#f1f5f9', C.muted) }}>
                        {it.itemType === 'boolean' ? 'בוצע/לא' : it.itemType === 'number' ? 'מספרי' : 'בחירה'}
                      </span>
                      {it.unit && <span style={{ color: C.muted, fontSize: 12, marginInlineStart: 6 }}>({it.unit})</span>}
                      {it.targetValue !== null && it.targetValue !== undefined && (
                        <span style={{ color: C.muted, fontSize: 12, marginInlineStart: 6 }}>יעד {it.targetValue}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: C.mutedLight, marginTop: 2 }}>
                      {it.logs.length} דיווחים בטווח
                    </div>
                  </div>
                  <button style={st.ghostBtn} title="הזז למעלה" disabled={idx === 0} onClick={() => moveItem(p.id, items, idx, -1)}>↑</button>
                  <button style={st.ghostBtn} title="הזז למטה" disabled={idx === items.length - 1} onClick={() => moveItem(p.id, items, idx, 1)}>↓</button>
                  <button style={st.ghostBtn} onClick={() => setLogItem({ item: it, date: todayStr() })}>דווח</button>
                  <button style={st.ghostBtn} onClick={() => setEditItem(it)}>ערוך</button>
                  <button style={st.dangerBtn} onClick={() => archiveItem(it)}>לארכיון</button>
                </div>
              ))
            )}

            {archived.length > 0 && (
              <details style={{ marginTop: 8 }}>
                <summary style={{ fontSize: 12, color: C.muted, cursor: 'pointer' }}>
                  מטרות בארכיון ({archived.length})
                </summary>
                {archived.map((it) => (
                  <div key={it.id} style={{ ...st.itemRow, color: C.mutedLight }}>
                    <div style={{ flex: 1 }}>{it.title}</div>
                    <button
                      style={st.ghostBtn}
                      onClick={async () => {
                        await apiFetch(`${BASE_URL}/projects/items/${it.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ isArchived: false }),
                        });
                        void reload();
                      }}
                    >
                      שחזר
                    </button>
                  </div>
                ))}
              </details>
            )}

            <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
              <button style={st.ghostBtn} onClick={() => setAddItemForProject(p)}>+ הוסף מטרה</button>
              <button style={st.ghostBtn} onClick={() => setNoteProject(p)}>+ הוסף הערה</button>
            </div>

            {notes.length > 0 && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.mutedLight, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>הערות</div>
                {notes.map((n) => (
                  <div key={n.id} style={{ fontSize: 13, padding: '6px 0', borderBottom: `1px dashed ${C.border}` }}>
                    <div style={{ fontSize: 11, color: C.mutedLight, marginBottom: 2 }}>
                      {n.authorRole === 'admin' ? 'מאמנת' : 'משתתפת'} · {new Date(n.createdAt).toLocaleDateString('he-IL')}
                    </div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{n.content}</div>
                  </div>
                ))}
              </div>
            )}

            {items.length > 0 && (
              <LogsMatrix items={items} />
            )}
          </div>
        );
      })}

      {createProjectOpen && (
        <ProjectFormModal
          participantId={participantId}
          onClose={() => setCreateProjectOpen(false)}
          onSaved={() => { setCreateProjectOpen(false); void reload(); }}
        />
      )}
      {editProject && (
        <ProjectFormModal
          participantId={participantId}
          project={editProject}
          onClose={() => setEditProject(null)}
          onSaved={() => { setEditProject(null); void reload(); }}
        />
      )}
      {addItemForProject && (
        <ItemFormModal
          projectId={addItemForProject.id}
          onClose={() => setAddItemForProject(null)}
          onSaved={() => { setAddItemForProject(null); void reload(); }}
        />
      )}
      {editItem && (
        <ItemFormModal
          projectId={editItem.projectId}
          item={editItem}
          onClose={() => setEditItem(null)}
          onSaved={() => { setEditItem(null); void reload(); }}
        />
      )}
      {logItem && (
        <AdminLogModal
          item={logItem.item}
          participantId={participantId}
          initialDate={logItem.date}
          onClose={() => setLogItem(null)}
          onSaved={() => { setLogItem(null); void reload(); }}
        />
      )}
      {noteProject && (
        <NoteModal
          projectId={noteProject.id}
          participantId={participantId}
          onClose={() => setNoteProject(null)}
          onSaved={() => { setNoteProject(null); void reload(); }}
        />
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function todayStr(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function statusLabel(s: ProjectLogStatus | null): { label: string; bg: string; color: string } {
  if (s === null) return { label: '—', bg: '#f1f5f9', color: C.muted };
  switch (s) {
    case 'completed': return { label: '✓', bg: C.successSoft, color: C.success };
    case 'value': return { label: '#', bg: C.accentSoft, color: C.accent };
    case 'skipped_today': return { label: 'ל״ר', bg: C.warnSoft, color: C.warn };
    // 'committed' is deprecated — legacy rows render as a neutral chip.
    case 'committed': return { label: '~', bg: '#f1f5f9', color: C.muted };
  }
}

// A compact recent-days matrix for quick admin scanning.
function LogsMatrix({ items }: { items: ProjectItem[] }) {
  // Determine the date range from logs present (fallback: last 7 days).
  const dates = useMemo(() => {
    const today = todayStr();
    const out: string[] = [];
    const [y, m, d] = today.split('-').map((n) => parseInt(n, 10));
    for (let i = 6; i >= 0; i--) {
      const dt = new Date(Date.UTC(y, m - 1, d - i));
      const iso = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
      out.push(iso);
    }
    return out;
  }, []);

  return (
    <div style={{ marginTop: 12, overflowX: 'auto' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.mutedLight, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>שבוע אחרון</div>
      <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'start', padding: '4px 8px', fontWeight: 600, color: C.muted }}>מטרה</th>
            {dates.map((d) => (
              <th key={d} style={{ textAlign: 'center', padding: '4px 6px', fontWeight: 600, color: C.muted }}>
                {d.slice(5)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id}>
              <td style={{ padding: '4px 8px', color: C.text, whiteSpace: 'nowrap' }}>{it.title}</td>
              {dates.map((d) => {
                const log = it.logs.find((l: ProjectLog) => l.logDate === d);
                const s = statusLabel(log ? log.status : null);
                return (
                  <td key={d} style={{ padding: '4px 6px', textAlign: 'center' }}>
                    <span style={st.chip(s.bg, s.color)}>{s.label}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Modals ──────────────────────────────────────────────────────────────────

function ProjectFormModal(props: {
  participantId: string;
  project?: Project;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { project } = props;
  const [title, setTitle] = useState(project?.title ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  const [colorHex, setColorHex] = useState(project?.colorHex ?? '#2563eb');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    if (!title.trim()) { setErr('חובה למלא כותרת'); return; }
    setBusy(true); setErr('');
    try {
      if (project) {
        await apiFetch(`${BASE_URL}/projects/${project.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            title: title.trim(),
            description: description.trim(),
            colorHex,
          }),
        });
      } else {
        await apiFetch(`${BASE_URL}/projects/participants/${props.participantId}`, {
          method: 'POST',
          body: JSON.stringify({
            title: title.trim(),
            description: description.trim() || undefined,
            colorHex,
          }),
        });
      }
      props.onSaved();
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: string }).message) : 'שמירה נכשלה';
      setErr(msg);
    } finally { setBusy(false); }
  }

  return (
    <div style={st.backdrop} onClick={props.onClose}>
      <div style={st.modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 16 }}>
          {project ? 'ערוך פרויקט' : 'צור פרויקט חדש'}
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={{ display: 'block', fontSize: 12, color: C.muted, marginBottom: 4 }}>כותרת</label>
          <input style={st.input} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={{ display: 'block', fontSize: 12, color: C.muted, marginBottom: 4 }}>תיאור (לא חובה)</label>
          <textarea style={st.textarea} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={{ display: 'block', fontSize: 12, color: C.muted, marginBottom: 4 }}>צבע</label>
          <input type="color" value={colorHex} onChange={(e) => setColorHex(e.target.value)} style={{ width: 60, height: 36, border: `1px solid ${C.border}`, borderRadius: 6, cursor: 'pointer' }} />
        </div>
        {err && <div style={st.err}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button style={st.ghostBtn} disabled={busy} onClick={props.onClose}>ביטול</button>
          <button style={st.primaryBtn} disabled={busy} onClick={submit}>שמור</button>
        </div>
      </div>
    </div>
  );
}

function ItemFormModal(props: {
  projectId: string;
  item?: ProjectItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = !!props.item;
  const [title, setTitle] = useState(props.item?.title ?? '');
  const [itemType, setItemType] = useState<ProjectItemType>(props.item?.itemType ?? 'boolean');
  const [unit, setUnit] = useState(props.item?.unit ?? '');
  const [targetValue, setTargetValue] = useState(
    props.item?.targetValue !== null && props.item?.targetValue !== undefined
      ? String(props.item.targetValue) : '',
  );
  // Phase 1: single-field per option (see AddGoalModal comment in projects-board.tsx).
  // Pre-seed from existing labels when editing so round-trip is clean.
  const [options, setOptions] = useState<string[]>(() => {
    const existing = props.item?.selectOptions;
    if (existing && existing.length > 0) return existing.map((o) => o.label);
    return [''];
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    if (!title.trim()) { setErr('חובה למלא כותרת'); return; }
    const body: Record<string, unknown> = { title: title.trim() };
    if (!editing) (body as { itemType: ProjectItemType }).itemType = itemType;
    if (itemType === 'number') {
      body.unit = unit.trim() || null;
      body.targetValue = targetValue.trim() && !isNaN(parseFloat(targetValue)) ? parseFloat(targetValue) : null;
    } else {
      body.unit = null;
      body.targetValue = null;
    }
    if (itemType === 'select') {
      const clean = options
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map((s) => ({ value: s, label: s }));
      if (clean.length === 0) { setErr('חובה לפחות אפשרות אחת'); return; }
      body.selectOptions = clean;
    }
    setBusy(true); setErr('');
    try {
      if (editing && props.item) {
        await apiFetch(`${BASE_URL}/projects/items/${props.item.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
      } else {
        await apiFetch(`${BASE_URL}/projects/${props.projectId}/items`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
      }
      props.onSaved();
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: string }).message) : 'שמירה נכשלה';
      setErr(msg);
    } finally { setBusy(false); }
  }

  return (
    <div style={st.backdrop} onClick={props.onClose}>
      <div style={st.modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 16 }}>
          {editing ? 'ערוך מטרה' : 'הוסף מטרה'}
        </div>

        <div style={{ marginBottom: 10 }}>
          <label style={{ display: 'block', fontSize: 12, color: C.muted, marginBottom: 4 }}>כותרת</label>
          <input style={st.input} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>

        {!editing && (
          <div style={{ marginBottom: 10 }}>
            <label style={{ display: 'block', fontSize: 12, color: C.muted, marginBottom: 4 }}>סוג</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['boolean', 'number', 'select'] as ProjectItemType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setItemType(t)}
                  style={{
                    flex: 1, padding: '8px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    borderRadius: 6, border: `2px solid ${itemType === t ? C.accent : C.border}`,
                    background: itemType === t ? C.accentSoft : '#fff',
                    color: itemType === t ? C.accent : C.text,
                  }}
                >
                  {t === 'boolean' ? 'בוצע/לא' : t === 'number' ? 'מספרי' : 'בחירה'}
                </button>
              ))}
            </div>
          </div>
        )}

        {itemType === 'number' && (
          <>
            <div style={{ marginBottom: 10 }}>
              <label style={{ display: 'block', fontSize: 12, color: C.muted, marginBottom: 4 }}>יחידה (לא חובה)</label>
              <input style={st.input} value={unit} onChange={(e) => setUnit(e.target.value)} />
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={{ display: 'block', fontSize: 12, color: C.muted, marginBottom: 4 }}>יעד (לא חובה)</label>
              <input type="number" style={st.input} value={targetValue} onChange={(e) => setTargetValue(e.target.value)} />
            </div>
          </>
        )}

        {itemType === 'select' && (
          <div style={{ marginBottom: 10 }}>
            <label style={{ display: 'block', fontSize: 12, color: C.muted, marginBottom: 4 }}>אפשרויות</label>
            {options.map((label, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <input
                  style={{ ...st.input, flex: 1 }}
                  placeholder="אפשרות"
                  value={label}
                  onChange={(e) => {
                    const next = [...options];
                    next[idx] = e.target.value;
                    setOptions(next);
                  }}
                />
                <button
                  type="button"
                  style={st.ghostBtn}
                  onClick={() => setOptions(options.filter((_, i) => i !== idx))}
                  disabled={options.length === 1}
                >×</button>
              </div>
            ))}
            <button
              type="button"
              style={st.ghostBtn}
              onClick={() => setOptions([...options, ''])}
            >+ הוסף אפשרות</button>
          </div>
        )}

        {err && <div style={st.err}>{err}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button style={st.ghostBtn} disabled={busy} onClick={props.onClose}>ביטול</button>
          <button style={st.primaryBtn} disabled={busy} onClick={submit}>שמור</button>
        </div>
      </div>
    </div>
  );
}

function AdminLogModal(props: {
  item: ProjectItem;
  participantId: string;
  initialDate: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { item } = props;
  const [date, setDate] = useState(props.initialDate);
  const [status, setStatus] = useState<ProjectLogStatus>('completed');
  const [num, setNum] = useState('');
  const [sel, setSel] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    const body: Record<string, unknown> = { logDate: date, status };
    if (item.itemType === 'number' && (status === 'completed' || status === 'value')) {
      if (!num.trim() || isNaN(parseFloat(num))) { setErr('ערך מספרי חסר'); return; }
      body.numericValue = parseFloat(num);
    }
    if (item.itemType === 'select' && (status === 'completed' || status === 'value')) {
      if (!sel) { setErr('בחרי אפשרות'); return; }
      body.selectValue = sel;
    }
    if (status === 'skipped_today') {
      // "לא רלוונטי להיום" — note is required (matches the participant UX)
      if (!note.trim()) { setErr('חובה לרשום למה זה לא רלוונטי היום'); return; }
      body.skipNote = note.trim();
    }
    setBusy(true); setErr('');
    try {
      await apiFetch(
        `${BASE_URL}/projects/items/${item.id}/logs?participantId=${props.participantId}`,
        { method: 'POST', body: JSON.stringify(body) },
      );
      props.onSaved();
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: string }).message) : 'שמירה נכשלה';
      setErr(msg);
    } finally { setBusy(false); }
  }

  return (
    <div style={st.backdrop} onClick={props.onClose}>
      <div style={st.modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>דיווח / עריכה</div>
        <div style={{ fontSize: 13, color: C.muted, marginBottom: 12 }}>{item.title}</div>
        <div style={{ marginBottom: 10 }}>
          <label style={{ display: 'block', fontSize: 12, color: C.muted, marginBottom: 4 }}>תאריך</label>
          <input type="date" style={st.input} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={{ display: 'block', fontSize: 12, color: C.muted, marginBottom: 4 }}>סטטוס</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(['completed', 'skipped_today'] as ProjectLogStatus[]).map((ss) => (
              <button
                key={ss}
                type="button"
                onClick={() => setStatus(ss)}
                style={{
                  flex: 1, minWidth: 100, padding: '8px 6px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  borderRadius: 6, border: `2px solid ${status === ss ? C.accent : C.border}`,
                  background: status === ss ? C.accentSoft : '#fff',
                  color: status === ss ? C.accent : C.text,
                }}
              >
                {ss === 'completed' ? 'הושלם' : 'לא רלוונטי להיום'}
              </button>
            ))}
          </div>
        </div>

        {item.itemType === 'number' && status === 'completed' && (
          <div style={{ marginBottom: 10 }}>
            <label style={{ display: 'block', fontSize: 12, color: C.muted, marginBottom: 4 }}>ערך</label>
            <input type="number" style={st.input} value={num} onChange={(e) => setNum(e.target.value)} />
          </div>
        )}
        {item.itemType === 'select' && status === 'completed' && item.selectOptions && (
          <div style={{ marginBottom: 10 }}>
            <label style={{ display: 'block', fontSize: 12, color: C.muted, marginBottom: 4 }}>אפשרות</label>
            <select style={st.input} value={sel} onChange={(e) => setSel(e.target.value)}>
              <option value="">— בחרי —</option>
              {item.selectOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        )}
        {status === 'skipped_today' && (
          <div style={{ marginBottom: 10 }}>
            <label style={{ display: 'block', fontSize: 12, color: C.muted, marginBottom: 4 }}>
              למה זה לא רלוונטי היום? <span style={{ color: C.danger }}>*</span>
            </label>
            <textarea style={st.textarea} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        )}

        {err && <div style={st.err}>{err}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button style={st.ghostBtn} disabled={busy} onClick={props.onClose}>ביטול</button>
          <button style={st.primaryBtn} disabled={busy} onClick={submit}>שמור</button>
        </div>
      </div>
    </div>
  );
}

function NoteModal(props: {
  projectId: string;
  participantId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function submit() {
    if (!content.trim()) { setErr('חובה למלא תוכן'); return; }
    setBusy(true); setErr('');
    try {
      await apiFetch(
        `${BASE_URL}/projects/${props.projectId}/notes?participantId=${props.participantId}`,
        { method: 'POST', body: JSON.stringify({ content: content.trim() }) },
      );
      props.onSaved();
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: string }).message) : 'שמירה נכשלה';
      setErr(msg);
    } finally { setBusy(false); }
  }
  return (
    <div style={st.backdrop} onClick={props.onClose}>
      <div style={st.modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 16 }}>הוסף הערה</div>
        <textarea style={st.textarea} value={content} onChange={(e) => setContent(e.target.value)} autoFocus />
        {err && <div style={st.err}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button style={st.ghostBtn} disabled={busy} onClick={props.onClose}>ביטול</button>
          <button style={st.primaryBtn} disabled={busy} onClick={submit}>שמור</button>
        </div>
      </div>
    </div>
  );
}
