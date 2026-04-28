'use client';

// Participant-portal "פרטים אישיים" tab. Rendered when the program has
// profileTabEnabled=true. Pure UI — server logic lives in
// apps/api/src/modules/participant-profile-portal/.
//
// Save model:
//   - text / textarea / number / date: debounced autosave on edit, status
//     pill near the field shows שומר... / נשמר / failure.
//   - image: the user picks a file → POST upload → resulting file id is
//     written via PATCH .../value immediately. No "save" button.
//   - imageGallery: same as image, append the new id to the array, then
//     persist the new array via PATCH .../value.
//
// All paths return a fresh ProfileSnapshot which the parent page swaps
// in. The bottom-nav badge re-renders from the parent's snapshot, so
// the "missing required" count stays in sync without polling.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BASE_URL, apiFetch } from '@lib/api';

export interface ProfileField {
  id: string;
  fieldKey: string;
  label: string;
  helperText: string | null;
  fieldType: 'text' | 'textarea' | 'number' | 'date' | 'image' | 'imageGallery';
  isRequired: boolean;
  isSystemField: boolean;
  sortOrder: number;
}
export interface ProfileFileMeta {
  id: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
}
export interface ProfileSnapshot {
  participant: {
    id: string;
    firstName: string;
    lastName: string | null;
    profileImageUrl: string | null;
  };
  program: { id: string; name: string; profileTabEnabled: boolean };
  fields: ProfileField[];
  values: Record<string, unknown>;
  files: Record<string, ProfileFileMeta>;
  missingRequiredCount: number;
  missingRequiredKeys: string[];
}

const API_BASE_FOR_IMG = '/api-proxy';
function srcOf(url: string): string {
  if (!url) return '';
  if (url.startsWith('/uploads')) return `${API_BASE_FOR_IMG}${url}`;
  return url;
}

// apiFetch throws an ApiError object (not a real Error), so the
// previous `e instanceof Error ? e.message : fallback` checks always
// fell through to the fallback string and the actual server message
// was hidden. Read .message off either shape.
function errMessage(e: unknown, fallback: string): string {
  if (typeof e === 'object' && e !== null && 'message' in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === 'string' && m) return m;
  }
  return fallback;
}

interface ProfileTabProps {
  token: string;
  snapshot: ProfileSnapshot;
  onSnapshotChanged: (next: ProfileSnapshot) => void;
}

export function ProfileTab({ token, snapshot, onSnapshotChanged }: ProfileTabProps) {
  return (
    <div style={s.pane}>
      <div style={s.header}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#0f172a' }}>פרטים אישיים</div>
        {snapshot.missingRequiredCount > 0 ? (
          <div style={s.headerBadge}>
            חסרים {snapshot.missingRequiredCount} שדות חובה
          </div>
        ) : (
          <div style={s.headerOk}>הכל מולא ✓</div>
        )}
      </div>
      <p style={s.headerHelp}>
        מידע שתמלאי כאן נשמר בפרופיל שלך ומוצג בקבוצה ובמשחק. ניתן לעדכן בכל עת.
      </p>

      <div style={s.fieldsList}>
        {snapshot.fields.map((f) => (
          <FieldRow
            key={f.id}
            token={token}
            field={f}
            value={snapshot.values[f.fieldKey]}
            files={snapshot.files}
            isMissing={snapshot.missingRequiredKeys.includes(f.fieldKey)}
            onSnapshotChanged={onSnapshotChanged}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Single field row ──────────────────────────────────────────────────────

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

function FieldRow(props: {
  token: string;
  field: ProfileField;
  value: unknown;
  files: Record<string, ProfileFileMeta>;
  isMissing: boolean;
  onSnapshotChanged: (next: ProfileSnapshot) => void;
}) {
  const { token, field, value, files, isMissing, onSnapshotChanged } = props;

  // Local "pending" state so typing feels responsive while a debounced
  // autosave is in flight. Snapshot drives the source of truth.
  const initialDraft = useMemo(() => valueToDraft(value, field.fieldType), [value, field.fieldType]);
  const [draft, setDraft] = useState<string>(initialDraft);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [errMsg, setErrMsg] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Re-sync when the snapshot value changes from outside (e.g. after an
  // image upload also rendered server-side as a side effect).
  useEffect(() => { setDraft(initialDraft); }, [initialDraft]);

  async function persist(rawValue: unknown) {
    setStatus('saving');
    setErrMsg('');
    try {
      const next = await apiFetch<ProfileSnapshot>(
        `${BASE_URL}/public/participant/${token}/profile/value`,
        { method: 'PATCH', body: JSON.stringify({ fieldKey: field.fieldKey, value: rawValue }) },
      );
      onSnapshotChanged(next);
      setStatus('saved');
      setTimeout(() => { setStatus((cur) => cur === 'saved' ? 'idle' : cur); }, 1400);
    } catch (e) {
      setStatus('error');
      setErrMsg(errMessage(e, 'שמירה נכשלה'));
    }
  }

  function scheduleAutosave(rawValue: unknown) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void persist(rawValue); }, 700);
  }

  function commitText(next: string) {
    setDraft(next);
    if (field.fieldType === 'number') {
      // Empty string clears; otherwise convert to number for the API.
      if (next.trim() === '') scheduleAutosave(null);
      else {
        const n = Number(next);
        if (Number.isFinite(n)) scheduleAutosave(n);
      }
      return;
    }
    scheduleAutosave(next || null);
  }

  return (
    <div style={{
      ...s.fieldRow,
      borderColor: isMissing ? '#fde68a' : '#e2e8f0',
      background: isMissing ? '#fffbeb' : '#fff',
    }}>
      <div style={s.fieldHeader}>
        <label style={s.fieldLabel}>
          {field.label}
          {field.isRequired && <span style={s.requiredAsterisk}> *</span>}
        </label>
        <SaveStatusPill status={status} message={errMsg} />
      </div>
      {field.helperText && <p style={s.fieldHelper}>{field.helperText}</p>}

      {field.fieldType === 'text' && (
        <input
          style={s.input}
          value={draft}
          onChange={(e) => commitText(e.target.value)}
        />
      )}
      {field.fieldType === 'textarea' && (
        <textarea
          style={{ ...s.input, minHeight: 90, resize: 'vertical' }}
          value={draft}
          onChange={(e) => commitText(e.target.value)}
        />
      )}
      {field.fieldType === 'number' && (
        <input
          type="number"
          style={s.input}
          value={draft}
          onChange={(e) => commitText(e.target.value)}
          inputMode="decimal"
        />
      )}
      {field.fieldType === 'date' && (
        <input
          type="date"
          style={s.input}
          value={draft}
          onChange={(e) => commitText(e.target.value)}
        />
      )}
      {field.fieldType === 'image' && (
        <ImageField
          token={token}
          fieldKey={field.fieldKey}
          isSystemField={field.isSystemField}
          value={value}
          files={files}
          onSnapshotChanged={onSnapshotChanged}
        />
      )}
      {field.fieldType === 'imageGallery' && (
        <ImageGalleryField
          token={token}
          fieldKey={field.fieldKey}
          value={value}
          files={files}
          onSnapshotChanged={onSnapshotChanged}
        />
      )}
    </div>
  );
}

// ─── Image (single) ────────────────────────────────────────────────────────

function ImageField(props: {
  token: string;
  fieldKey: string;
  isSystemField: boolean;
  value: unknown;
  files: Record<string, ProfileFileMeta>;
  onSnapshotChanged: (next: ProfileSnapshot) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState('');

  // Resolve current preview URL: profileImageUrl (system) stores the
  // /uploads URL directly; custom image fields store a file id that we
  // look up in `files`.
  let previewUrl: string | null = null;
  if (typeof props.value === 'string' && props.value) {
    if (props.isSystemField) previewUrl = props.value;
    else previewUrl = props.files[props.value]?.url ?? null;
  }

  async function handleFile(file: File) {
    setBusy(true);
    setErrMsg('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const meta = await apiFetch<ProfileFileMeta>(
        `${BASE_URL}/public/participant/${props.token}/profile/upload`,
        { method: 'POST', body: fd },
      );
      // Both system and custom image fields take a file id — server
      // resolves the URL for the system column (profileImageUrl).
      const next = await apiFetch<ProfileSnapshot>(
        `${BASE_URL}/public/participant/${props.token}/profile/value`,
        { method: 'PATCH', body: JSON.stringify({ fieldKey: props.fieldKey, value: meta.id }) },
      );
      props.onSnapshotChanged(next);
    } catch (e) {
      setErrMsg(errMessage(e, 'העלאה נכשלה'));
    } finally {
      setBusy(false);
    }
  }

  async function clearImage() {
    setBusy(true);
    setErrMsg('');
    try {
      const next = await apiFetch<ProfileSnapshot>(
        `${BASE_URL}/public/participant/${props.token}/profile/value`,
        { method: 'PATCH', body: JSON.stringify({ fieldKey: props.fieldKey, value: null }) },
      );
      props.onSnapshotChanged(next);
    } catch (e) {
      setErrMsg(errMessage(e, 'הסרה נכשלה'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = ''; }}
      />
      {previewUrl ? (
        <div style={s.imagePreviewWrap}>
          <img src={srcOf(previewUrl)} alt="" style={s.imagePreview} />
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              style={s.imageBtn}
            >החלף תמונה</button>
            <button
              type="button"
              onClick={() => { void clearImage(); }}
              disabled={busy}
              style={{ ...s.imageBtn, color: '#b91c1c', borderColor: '#fecaca' }}
            >הסר</button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          style={s.uploadButton}
        >
          {busy ? 'מעלה...' : '📷 העלי תמונה'}
        </button>
      )}
      {errMsg && <p style={s.fieldErr}>{errMsg}</p>}
    </div>
  );
}

// ─── Image gallery ─────────────────────────────────────────────────────────

function ImageGalleryField(props: {
  token: string;
  fieldKey: string;
  value: unknown;
  files: Record<string, ProfileFileMeta>;
  onSnapshotChanged: (next: ProfileSnapshot) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState('');
  const ids: string[] = Array.isArray(props.value)
    ? (props.value as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];

  async function persist(nextIds: string[]) {
    setErrMsg('');
    const next = await apiFetch<ProfileSnapshot>(
      `${BASE_URL}/public/participant/${props.token}/profile/value`,
      { method: 'PATCH', body: JSON.stringify({ fieldKey: props.fieldKey, value: nextIds }) },
    );
    props.onSnapshotChanged(next);
  }

  async function handleFiles(fileList: FileList) {
    setBusy(true);
    setErrMsg('');
    try {
      const newIds: string[] = [];
      // Sequential upload to keep the multer disk-storage write order
      // deterministic for the participant; a parallel barrage could
      // also race with multipart parsing on small Railway instances.
      for (const file of Array.from(fileList)) {
        const meta = await apiFetch<ProfileFileMeta>(
          `${BASE_URL}/public/participant/${props.token}/profile/upload`,
          { method: 'POST', body: (() => { const fd = new FormData(); fd.append('file', file); return fd; })() },
        );
        newIds.push(meta.id);
      }
      await persist([...ids, ...newIds]);
    } catch (e) {
      setErrMsg(errMessage(e, 'העלאה נכשלה'));
    } finally {
      setBusy(false);
    }
  }

  async function removeAt(id: string) {
    setBusy(true);
    setErrMsg('');
    try {
      await persist(ids.filter((i) => i !== id));
    } catch (e) {
      setErrMsg(errMessage(e, 'הסרה נכשלה'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => { const fl = e.target.files; if (fl?.length) void handleFiles(fl); e.target.value = ''; }}
      />
      {ids.length > 0 && (
        <div style={s.galleryGrid}>
          {ids.map((id) => {
            const meta = props.files[id];
            if (!meta) return null;
            return (
              <div key={id} style={s.galleryItem}>
                <img src={srcOf(meta.url)} alt="" style={s.galleryImg} />
                <button
                  type="button"
                  onClick={() => { void removeAt(id); }}
                  disabled={busy}
                  aria-label="הסר"
                  style={s.galleryRemoveBtn}
                >×</button>
              </div>
            );
          })}
        </div>
      )}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        style={{ ...s.uploadButton, marginTop: ids.length > 0 ? 10 : 0 }}
      >
        {busy ? 'מעלה...' : '+ הוסיפי תמונות'}
      </button>
      {errMsg && <p style={s.fieldErr}>{errMsg}</p>}
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function valueToDraft(value: unknown, fieldType: ProfileField['fieldType']): string {
  if (value == null) return '';
  if (fieldType === 'date') {
    if (typeof value !== 'string') return '';
    // The server stores YYYY-MM-DD for custom date fields, and ISO
    // datetime for the system birthDate column. Trim either to YYYY-MM-DD.
    return value.length >= 10 ? value.slice(0, 10) : value;
  }
  if (fieldType === 'number') return String(value);
  if (typeof value === 'string') return value;
  return '';
}

function SaveStatusPill({ status, message }: { status: SaveStatus; message: string }) {
  if (status === 'idle') return null;
  if (status === 'saving') return <span style={s.pillSaving}>שומר...</span>;
  if (status === 'saved') return <span style={s.pillSaved}>נשמר ✓</span>;
  return <span style={s.pillError} title={message}>שגיאה</span>;
}

// ─── Hook used by the parent page to load + manage the snapshot ─────────────

export function useProfileSnapshot(token: string, profileTabEnabled: boolean) {
  const [snapshot, setSnapshot] = useState<ProfileSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    if (!profileTabEnabled) { setSnapshot(null); return; }
    setLoading(true);
    apiFetch<ProfileSnapshot>(`${BASE_URL}/public/participant/${token}/profile`, { cache: 'no-store' })
      .then((r) => { setSnapshot(r); setErr(''); })
      .catch((e) => setErr(errMessage(e, 'טעינה נכשלה')))
      .finally(() => setLoading(false));
  }, [token, profileTabEnabled]);

  useEffect(() => { load(); }, [load]);

  return { snapshot, setSnapshot, loading, err, reload: load };
}

// ─── Styles ────────────────────────────────────────────────────────────────

const s = {
  pane: { padding: '16px 16px 32px' } as React.CSSProperties,
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: 8, flexWrap: 'wrap' as const, marginBottom: 4,
  } as React.CSSProperties,
  headerBadge: {
    background: '#fef3c7', color: '#b45309', fontSize: 12, fontWeight: 700,
    padding: '4px 10px', borderRadius: 999,
  } as React.CSSProperties,
  headerOk: {
    background: '#dcfce7', color: '#15803d', fontSize: 12, fontWeight: 700,
    padding: '4px 10px', borderRadius: 999,
  } as React.CSSProperties,
  headerHelp: {
    fontSize: 13, color: '#64748b', margin: '4px 0 16px', lineHeight: 1.5,
  } as React.CSSProperties,
  fieldsList: { display: 'flex', flexDirection: 'column', gap: 10 } as React.CSSProperties,
  fieldRow: {
    background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12,
    padding: '12px 14px',
  } as React.CSSProperties,
  fieldHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
  } as React.CSSProperties,
  fieldLabel: {
    fontSize: 14, fontWeight: 700, color: '#0f172a', display: 'block',
  } as React.CSSProperties,
  requiredAsterisk: { color: '#dc2626' } as React.CSSProperties,
  fieldHelper: {
    fontSize: 12, color: '#64748b', margin: '4px 0 8px', lineHeight: 1.5,
  } as React.CSSProperties,
  input: {
    width: '100%', padding: '10px 12px', fontSize: 16,  // 16px prevents iOS auto-zoom
    border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff',
    color: '#0f172a', boxSizing: 'border-box' as const, fontFamily: 'inherit',
    outline: 'none',
  } as React.CSSProperties,
  pillSaving: {
    background: '#eef2ff', color: '#4338ca', fontSize: 11, fontWeight: 600,
    padding: '2px 8px', borderRadius: 999,
  } as React.CSSProperties,
  pillSaved: {
    background: '#dcfce7', color: '#15803d', fontSize: 11, fontWeight: 600,
    padding: '2px 8px', borderRadius: 999,
  } as React.CSSProperties,
  pillError: {
    background: '#fee2e2', color: '#b91c1c', fontSize: 11, fontWeight: 600,
    padding: '2px 8px', borderRadius: 999, cursor: 'help',
  } as React.CSSProperties,
  fieldErr: { color: '#b91c1c', fontSize: 12, margin: '6px 0 0' } as React.CSSProperties,
  imagePreviewWrap: {
    background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 10,
  } as React.CSSProperties,
  imagePreview: {
    display: 'block', maxWidth: '100%', maxHeight: 220, borderRadius: 8,
    objectFit: 'cover' as const, margin: '0 auto',
  } as React.CSSProperties,
  imageBtn: {
    padding: '7px 12px', fontSize: 13, fontWeight: 600,
    background: '#fff', color: '#1d4ed8', border: '1px solid #bfdbfe', borderRadius: 8,
    cursor: 'pointer',
  } as React.CSSProperties,
  uploadButton: {
    width: '100%', padding: '14px 16px', fontSize: 14, fontWeight: 700,
    background: '#eff6ff', color: '#1d4ed8',
    border: '1px dashed #93c5fd', borderRadius: 10, cursor: 'pointer',
  } as React.CSSProperties,
  galleryGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8,
  } as React.CSSProperties,
  galleryItem: {
    position: 'relative' as const, paddingTop: '100%',
    borderRadius: 10, overflow: 'hidden', background: '#f1f5f9',
  } as React.CSSProperties,
  galleryImg: {
    position: 'absolute' as const, inset: 0, width: '100%', height: '100%',
    objectFit: 'cover' as const,
  } as React.CSSProperties,
  galleryRemoveBtn: {
    position: 'absolute' as const, top: 4, insetInlineEnd: 4,
    width: 24, height: 24, borderRadius: '50%',
    background: 'rgba(15,23,42,0.7)', color: '#fff', border: 'none',
    fontSize: 16, lineHeight: 1, cursor: 'pointer', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
  } as React.CSSProperties,
};
