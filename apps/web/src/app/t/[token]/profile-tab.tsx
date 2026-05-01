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

// Avatar preview that suppresses the browser's broken-image icon and
// the harsh "no image yet" gap while the response loads. The <img> is
// rendered display:none until the load event fires; an inline spinner
// fills the same box in the meantime, an error placeholder takes over
// if onError fires (404 / mime mismatch / network drop). Cache-bust
// token bumps after a fresh upload, in case an intermediate cache is
// still holding a 404 from a pre-write request.
function AvatarPreview({ url, cacheBust }: { url: string; cacheBust: number }) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  // Reset states whenever the URL or the cache-bust token changes,
  // so a "replace" upload re-shows the spinner instead of flashing
  // the previous image's loaded state.
  useEffect(() => { setLoaded(false); setErrored(false); }, [url, cacheBust]);
  const src = cacheBust > 0
    ? `${url}${url.includes('?') ? '&' : '?'}cb=${cacheBust}`
    : url;
  const placeholder: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    minHeight: 160, borderRadius: 8, background: '#f1f5f9',
    color: '#64748b', fontSize: 13,
  };
  return (
    <>
      {!loaded && !errored && <div style={placeholder}>טוען תמונה...</div>}
      {errored && (
        <div style={{ ...placeholder, background: '#fef2f2', color: '#b91c1c' }}>
          התמונה לא זמינה
        </div>
      )}
      <img
        src={src}
        alt=""
        loading="eager"
        style={{
          display: loaded && !errored ? 'block' : 'none',
          maxWidth: '100%', maxHeight: 220, borderRadius: 8,
          objectFit: 'cover', margin: '0 auto',
        }}
        onLoad={() => setLoaded(true)}
        onError={() => setErrored(true)}
      />
    </>
  );
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

// Upload a single file with real upload progress + a hard timeout.
//
// Why XMLHttpRequest instead of fetch():
//   fetch() exposes ONLY the response body progress (via streams), not
//   the upload body progress. For multipart uploads of large videos
//   that's the entire problem — the user has nothing to look at while
//   the request body is being pushed to the server. XMLHttpRequest's
//   xhr.upload `progress` event reports `loaded` / `total` bytes as the
//   browser actually streams them out, which is the only way we can
//   render a real percent.
//
// The 120-second timeout (xhr.timeout) is preserved exactly. Optional
// AbortSignal is honored via xhr.abort() so callers that already wire
// AbortController stay compatible. Same /api-proxy URL pattern as
// apiFetch — the Next.js rewrite still routes to the API.
const UPLOAD_TIMEOUT_MS = 120_000;
interface UploadCallbacks {
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}
function uploadOneFile(
  token: string,
  file: File,
  cb?: UploadCallbacks,
): Promise<ProfileFileMeta> {
  return new Promise<ProfileFileMeta>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    xhr.responseType = 'json';

    xhr.upload.addEventListener('progress', (e) => {
      if (!e.lengthComputable || !cb?.onProgress) return;
      const pct = e.total > 0 ? Math.round((e.loaded / e.total) * 100) : 0;
      cb.onProgress(Math.min(99, pct)); // 100 only when the response lands
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const data = xhr.response ?? safeParseJson(xhr.responseText);
        if (data && typeof data === 'object' && typeof (data as { id?: unknown }).id === 'string') {
          cb?.onProgress?.(100);
          resolve(data as ProfileFileMeta);
        } else {
          reject({ message: 'תגובת השרת אינה תקינה.' });
        }
      } else {
        const data = xhr.response ?? safeParseJson(xhr.responseText);
        let message = 'העלאה נכשלה';
        if (data && typeof data === 'object') {
          const m = (data as Record<string, unknown>).message ?? (data as Record<string, unknown>).error;
          if (typeof m === 'string' && m) message = m;
        }
        reject({ status: xhr.status, message });
      }
    });
    xhr.addEventListener('timeout', () => reject({
      message:
        `ההעלאה ארכה זמן רב מדי (יותר מ-${Math.round(UPLOAD_TIMEOUT_MS / 1000)} שניות). ` +
        `בדקי את החיבור ונסי שוב.`,
    }));
    xhr.addEventListener('error', () => reject({ message: 'שגיאת רשת בזמן ההעלאה.' }));
    xhr.addEventListener('abort', () => reject({ message: 'ההעלאה בוטלה.' }));

    if (cb?.signal) {
      const onAbort = () => { try { xhr.abort(); } catch { /* xhr already done */ } };
      cb.signal.addEventListener('abort', onAbort, { once: true });
    }

    const fd = new FormData();
    fd.append('file', file);

    xhr.open('POST', `${BASE_URL}/public/participant/${token}/profile/upload`, true);
    xhr.withCredentials = true;
    xhr.send(fd);
  });
}
function safeParseJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

// Phase-1 quick win: shrink phone-camera photos in the browser before
// upload. A 12 MB straight-from-camera JPEG drops to ~400-900 KB at
// 2000px / quality 0.85 with no visible quality loss for our gallery
// thumbnails — that's a 10-30× reduction in bytes on the wire and the
// dominant factor in upload wall-clock time on slow mobile.
//
// Skip rules (return original file unchanged):
//   - non-images (videos pass through; we don't transcode in-browser)
//   - GIFs (canvas would lose animation)
//   - already small (<= minSize, default 1 MB) — not worth re-encoding
//   - canvas/encode errors — fall back to the original; the server's
//     15 MB image cap still catches the truly-huge ones
//
// Note: Phase 2 will move uploads to direct-to-R2/S3 via signed URLs;
// this helper is still useful there because smaller bytes = faster
// even on direct upload. It just isn't a permanent workaround.
async function compressImage(
  file: File,
  opts?: { maxDim?: number; quality?: number; minSize?: number },
): Promise<File> {
  if (!/^image\//i.test(file.type)) return file;
  if (/\/gif$/i.test(file.type)) return file;
  const minSize = opts?.minSize ?? 1024 * 1024;
  if (file.size <= minSize) return file;

  const maxDim = opts?.maxDim ?? 2000;
  const quality = opts?.quality ?? 0.85;

  try {
    // imageOrientation: 'from-image' applies the EXIF rotation tag so
    // portrait phone shots land upright on the canvas — without it,
    // iOS uploads come out sideways after re-encode.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    let width = bitmap.width;
    let height = bitmap.height;
    const scale = Math.min(1, maxDim / Math.max(width, height));
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) { bitmap.close(); return file; }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((res) => {
      canvas.toBlob((b) => res(b), 'image/jpeg', quality);
    });
    if (!blob) return file;
    // Belt-and-braces: if the encoded JPEG is somehow larger than the
    // original (already-tiny images, weird color profiles), keep the
    // original — never make a file bigger.
    if (blob.size >= file.size) return file;

    const baseName = file.name.replace(/\.[^.]+$/, '');
    return new File([blob], `${baseName}.jpg`, {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
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

  // Local draft so typing feels responsive while a debounced autosave
  // is in flight. The snapshot is authoritative for the *first* render
  // and for genuine external updates (admin edit, another tab), but we
  // CANNOT blindly copy it into local state on every prop change —
  // that would overwrite characters the user typed AFTER the save
  // request was sent. lastSavedDraftRef remembers what came back from
  // the server so we can tell "external update" (sync) from "echo of
  // our own save" (ignore).
  const initialDraft = useMemo(() => valueToDraft(value, field.fieldType), [value, field.fieldType]);
  const [draft, setDraft] = useState<string>(initialDraft);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [errMsg, setErrMsg] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedDraftRef = useRef<string>(initialDraft);

  // Pure-external-update sync: only swap the local draft when the
  // snapshot brings a value DIFFERENT from the one we last wrote
  // ourselves. This kills the lost-character bug where the snapshot
  // echo of our own save overwrote ongoing typing.
  useEffect(() => {
    if (initialDraft !== lastSavedDraftRef.current) {
      setDraft(initialDraft);
      lastSavedDraftRef.current = initialDraft;
    }
    // Intentionally only depends on initialDraft — see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDraft]);

  // Cancel any pending debounced save when the field unmounts.
  // Otherwise the timer fires after the modal is gone and a stale
  // PATCH lands → "ghost saves" that look like phantom edits.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  async function persist(rawValue: unknown) {
    setStatus('saving');
    setErrMsg('');
    try {
      const next = await apiFetch<ProfileSnapshot>(
        `${BASE_URL}/public/participant/${token}/profile/value`,
        { method: 'PATCH', body: JSON.stringify({ fieldKey: field.fieldKey, value: rawValue }) },
      );
      onSnapshotChanged(next);
      // Stamp what came back so the sync effect knows that the next
      // snapshot prop change is the echo of THIS save and not an
      // external one. Without this, every successful save would race
      // ongoing typing.
      lastSavedDraftRef.current = valueToDraft(
        next.values[field.fieldKey],
        field.fieldType,
      );
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
    // Date inputs fire one onChange per pick — there's no
    // "user is still typing" window, so the 700ms debounce that
    // protects text-field saves only creates a window where a
    // quick close (modal dismiss / route change) cancels the
    // save before it fires. Persist immediately for dates so the
    // value is durably stored regardless of how fast the user
    // leaves the screen. Cancels any pending debounced save from
    // a prior text edit on the same row (defensive — date and
    // text fields don't share a row in practice).
    if (field.fieldType === 'date') {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      void persist(next || null);
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
          // step="any" disables the integer-only enforcement that
          // <input type="number"> applies by default. Without it,
          // values like 67.5 are flagged as invalid by the browser
          // and can be silently coerced to 67 on blur.
          step="any"
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
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  // Cache-bust token. We append ?cb=<token> to the avatar URL ONLY
  // when this component just performed an upload; subsequent renders
  // (and other tabs) leave the URL alone so the browser cache keeps
  // working normally. Each fresh upload also produces a new filename
  // server-side, so this is belt-and-braces protection against any
  // intermediate cache that might still hold a stale 404.
  const [cacheBust, setCacheBust] = useState<number>(0);
  // Instant preview from the picked File via URL.createObjectURL —
  // shown the moment the user picks a file, BEFORE compression and
  // upload start. On slow mobile this is the difference between
  // "I picked nothing happened" and "I picked, I see it instantly".
  // The blob URL is revoked when state changes or the component
  // unmounts (the useEffect cleanup below).
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    return () => { if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl); };
  }, [localPreviewUrl]);

  // Resolve current preview URL: profileImageUrl (system) stores the
  // /uploads URL directly; custom image fields store a file id that we
  // look up in `files`.
  let previewUrl: string | null = null;
  if (typeof props.value === 'string' && props.value) {
    if (props.isSystemField) previewUrl = props.value;
    else previewUrl = props.files[props.value]?.url ?? null;
  }

  async function handleFile(file: File) {
    // Instant local preview BEFORE compression/upload — the user sees
    // the image they just picked immediately, even on a slow connection.
    setLocalPreviewUrl(URL.createObjectURL(file));
    setBusy(true);
    setErrMsg('');
    setUploadPct(0);
    try {
      // Phase-1: shrink large camera photos in the browser before
      // sending. Videos and small images pass through unchanged.
      const upload = await compressImage(file);
      const meta = await uploadOneFile(props.token, upload, {
        onProgress: (p) => setUploadPct(p),
      });
      // Both system and custom image fields take a file id — server
      // resolves the URL for the system column (profileImageUrl).
      const next = await apiFetch<ProfileSnapshot>(
        `${BASE_URL}/public/participant/${props.token}/profile/value`,
        { method: 'PATCH', body: JSON.stringify({ fieldKey: props.fieldKey, value: meta.id }) },
      );
      props.onSnapshotChanged(next);
      // New filename → new URL anyway, but bumping cb defeats any
      // intermediate proxy/CDN that might briefly hold a 404 from a
      // pre-write request.
      setCacheBust(Date.now());
    } catch (e) {
      setErrMsg(errMessage(e, 'העלאה נכשלה'));
    } finally {
      // Always clear the busy state, even on timeout / network error,
      // so the button never stays stuck on "מעלה...".
      setBusy(false);
      // Hold the 100% pill briefly so the user sees the success state,
      // and keep the local blob preview for the same beat so AvatarPreview
      // can swap to the server URL without a flash.
      setTimeout(() => {
        setUploadPct(null);
        setLocalPreviewUrl(null);
      }, 600);
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
      {(localPreviewUrl || previewUrl) ? (
        <div style={s.imagePreviewWrap}>
          {/* localPreviewUrl wins while present so the picked File is
              visible instantly. AvatarPreview takes over once the upload
              completes and we drop the blob URL. */}
          {localPreviewUrl ? (
            <img
              src={localPreviewUrl}
              alt=""
              style={{
                display: 'block',
                maxWidth: '100%', maxHeight: 220, borderRadius: 8,
                objectFit: 'cover', margin: '0 auto',
                opacity: busy ? 0.85 : 1,
                transition: 'opacity 200ms',
              }}
            />
          ) : (
            <AvatarPreview url={srcOf(previewUrl!)} cacheBust={cacheBust} />
          )}
          {busy && uploadPct !== null && (
            <div style={{
              marginTop: 8, fontSize: 12, fontWeight: 600, color: '#475569',
              textAlign: 'center',
            }}>
              {uploadPct >= 95 ? 'מעבד...' : `מעלה... ${uploadPct}%`}
            </div>
          )}
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
          style={{ ...s.uploadButton, position: 'relative' }}
        >
          <span style={{ position: 'relative', zIndex: 1 }}>
            {busy
              ? ((uploadPct ?? 0) >= 95 ? 'מעבד...' : `מעלה... ${uploadPct ?? 0}%`)
              : '📷 העלי תמונה'}
          </span>
          {/* Live progress fill — driven by the XHR upload event so a
              50 MB image actually animates instead of sitting still. */}
          {busy && (
            <span
              aria-hidden="true"
              style={{
                position: 'absolute', insetInlineStart: 0, top: 0, bottom: 0,
                width: `${uploadPct ?? 0}%`,
                background: 'rgba(29, 78, 216, 0.18)',
                transition: 'width 120ms linear',
                borderRadius: 'inherit',
                pointerEvents: 'none',
              }}
            />
          )}
        </button>
      )}
      {errMsg && <p style={s.fieldErr}>{errMsg}</p>}
    </div>
  );
}

// ─── Mixed-media gallery (images + videos) ────────────────────────────────
// fieldType is still called "imageGallery" for back-compat with existing
// configs, but the rendering now branches on each file's mimeType so a
// before-photos field can hold a mix of stills and short clips.

// Caps mirror server constants (see participant-profile-portal.service +
// participant-profile-portal.controller).
const GALLERY_MAX_FILES   = 30;                  // server hard ceiling
const GALLERY_VISIBLE     = 10;                  // initially-rendered cells; "load more" reveals the rest
const MAX_IMAGE_BYTES     = 15 * 1024 * 1024;    // 15 MB per image
const MAX_VIDEO_BYTES     = 50 * 1024 * 1024;    // 50 MB per video

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
  const [showAll, setShowAll] = useState(false);
  // Per-file upload progress — drives the inline status list so a
  // 50 MB video uploading shows real bytes-pushed feedback instead of
  // an opaque spinner. Cleared shortly after the batch completes
  // (or on the next batch start).
  type UploadStatus = 'queued' | 'uploading' | 'done' | 'error';
  interface UploadingFile {
    name: string;
    sizeBytes: number;
    percent: number;
    status: UploadStatus;
    error?: string;
    // Blob URL of the picked File — shown as a tiny thumbnail next to
    // each row so the participant sees "yes, that's the file I picked"
    // before any bytes leave the device. Revoked when the row clears.
    localPreviewUrl?: string;
    isVideo: boolean;
  }
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  // All blob URLs we've created for the current batch. Held in a ref
  // so cleanup paths (batch end, unmount, next batch starting) can
  // revoke them all without re-reading state. URL.revokeObjectURL is
  // a noop if the URL is already revoked, so double-revoke is safe.
  const activeBlobUrlsRef = useRef<string[]>([]);
  useEffect(() => {
    return () => {
      activeBlobUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      activeBlobUrlsRef.current = [];
    };
  }, []);
  const ids: string[] = Array.isArray(props.value)
    ? (props.value as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];
  const slotsLeft = Math.max(0, GALLERY_MAX_FILES - ids.length);
  // Render newest-first. The server stores append-order, so reverse to
  // surface the latest cell at the top. Cap visible cells unless the
  // participant taps "הצג את כולן" — keeps mobile scrolling sane on
  // big galleries without losing access to older entries.
  const orderedIds = [...ids].reverse();
  const visibleIds = showAll ? orderedIds : orderedIds.slice(0, GALLERY_VISIBLE);
  const hiddenCount = Math.max(0, orderedIds.length - visibleIds.length);

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
    // Revoke any leftover blob URLs from a previous batch before we
    // mint new ones — keeps memory bounded if the participant taps
    // upload twice in quick succession.
    activeBlobUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    activeBlobUrlsRef.current = [];
    try {
      // Client-side preflight: per-mime size budget + cap check. Server
      // enforces both for real; we surface the message immediately so
      // the participant doesn't wait for the round-trip.
      const incoming = Array.from(fileList);
      if (incoming.length > slotsLeft) {
        throw { message: `ניתן להוסיף עוד ${slotsLeft} קבצים בלבד (מקסימום ${GALLERY_MAX_FILES}).` };
      }
      for (const f of incoming) {
        const isVideo = /^video\//i.test(f.type);
        const limit = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
        if (f.size > limit) {
          const limitMb = Math.round(limit / 1024 / 1024);
          throw { message: `הקובץ "${f.name}" חורג מ-${limitMb}MB (${isVideo ? 'וידאו' : 'תמונה'}).` };
        }
      }

      const newIds: string[] = [];
      // Seed the per-file status list with INSTANT local previews —
      // each file gets a blob URL the participant can see right now,
      // before any byte hits the network. Sequential upload keeps
      // multer disk-storage write order deterministic and avoids
      // racing multipart parsing on small Railway instances.
      setUploadingFiles(incoming.map((f) => {
        const isVideo = /^video\//i.test(f.type);
        const localPreviewUrl = URL.createObjectURL(f);
        activeBlobUrlsRef.current.push(localPreviewUrl);
        return {
          name: f.name, sizeBytes: f.size, percent: 0, status: 'queued',
          localPreviewUrl, isVideo,
        };
      }));

      // Continue past per-file failures so a single bad file doesn't
      // discard the successful uploads. THIS WAS THE PERSISTENCE BUG:
      // the previous version threw out of the loop on first error,
      // skipping the persist() below — so files that uploaded fine
      // never landed in ParticipantProfileValue and "disappeared"
      // after refresh. Now we collect all successes, surface a clear
      // summary message about failures, and always persist whatever
      // worked.
      const failures: { name: string; error: string }[] = [];
      for (let i = 0; i < incoming.length; i++) {
        const file = incoming[i];
        const isVideo = /^video\//i.test(file.type);
        setUploadingFiles((curr) =>
          curr.map((u, idx) => idx === i ? { ...u, status: 'uploading' } : u),
        );
        try {
          // Phase-1: shrink large camera photos before uploading.
          // Videos pass through (we don't transcode in-browser); small
          // images pass through too (compressImage skips files <= 1 MB).
          const upload = isVideo ? file : await compressImage(file);
          const meta = await uploadOneFile(props.token, upload, {
            onProgress: (pct) => {
              setUploadingFiles((curr) =>
                curr.map((u, idx) => idx === i ? { ...u, percent: pct } : u),
              );
            },
          });
          newIds.push(meta.id);
          setUploadingFiles((curr) =>
            curr.map((u, idx) => idx === i ? { ...u, percent: 100, status: 'done' } : u),
          );
        } catch (e) {
          const msg = errMessage(e, 'העלאה נכשלה');
          failures.push({ name: file.name, error: msg });
          setUploadingFiles((curr) =>
            curr.map((u, idx) => idx === i ? { ...u, status: 'error', error: msg } : u),
          );
          // Do NOT throw — keep the loop running so the next file gets
          // its own attempt. The summary error below tells the user
          // exactly which files failed and why.
        }
      }
      // Always persist the successes, even if some files failed.
      // This is the critical fix: without it, a partial-success batch
      // left orphan ParticipantUploadedFile rows that never linked to
      // the field, and the gallery looked empty after refresh.
      if (newIds.length > 0) {
        await persist([...ids, ...newIds]);
      }
      if (failures.length > 0) {
        const summary = failures.length === incoming.length
          ? `כל ההעלאות נכשלו (${failures.length}). שגיאה ראשונה: ${failures[0].error}`
          : `הועלו ${newIds.length} בהצלחה, ${failures.length} נכשלו. שגיאה ראשונה: ${failures[0].error}`;
        setErrMsg(summary);
      }
    } catch (e) {
      // Outer catch handles preflight rejections (cap, oversize) +
      // catastrophic persist failures.
      setErrMsg(errMessage(e, 'העלאה נכשלה'));
    } finally {
      setBusy(false);
      // Hold the per-file list a touch longer when there were errors
      // so the participant has time to read which file failed and why.
      const hadError = (
        await new Promise<boolean>((res) => {
          setUploadingFiles((curr) => {
            res(curr.some((u) => u.status === 'error'));
            return curr;
          });
        })
      );
      const wait = hadError ? 5000 : 1200;
      setTimeout(() => {
        // Revoke and clear blob URLs along with the row state, so a
        // gallery sitting open for a long time doesn't leak memory.
        activeBlobUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
        activeBlobUrlsRef.current = [];
        setUploadingFiles([]);
      }, wait);
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

  const atCap = slotsLeft === 0;

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        // image/* + video/* — the OS picker shows both. Server enforces
        // exact extensions + mimes, so a sneaky file gets rejected.
        accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime,video/webm"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => { const fl = e.target.files; if (fl?.length) void handleFiles(fl); e.target.value = ''; }}
      />
      {ids.length > 0 && (
        <div style={s.galleryGrid}>
          {visibleIds.map((id) => {
            const meta = props.files[id];
            if (!meta) return null;
            const isVideo = /^video\//i.test(meta.mimeType);
            return (
              <div key={id} style={s.galleryItem}>
                {isVideo ? (
                  <video
                    src={srcOf(meta.url)}
                    style={s.galleryImg}
                    controls
                    preload="metadata"
                    playsInline
                  />
                ) : (
                  <img src={srcOf(meta.url)} alt="" style={s.galleryImg} />
                )}
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
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          style={{
            display: 'block', width: '100%', marginTop: 8, padding: '8px 12px',
            fontSize: 13, fontWeight: 600, color: '#1d4ed8',
            background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8,
            cursor: 'pointer',
          }}
        >
          הצג את כולן ({hiddenCount} נוספות)
        </button>
      )}
      {/* Per-file progress list — visible during the upload sequence
          and held briefly afterward so ✓ / שגיאה are readable. */}
      {uploadingFiles.length > 0 && (
        <div
          style={{
            marginTop: 10,
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 10,
            padding: '10px 12px',
            display: 'flex', flexDirection: 'column', gap: 8,
          }}
          role="status"
          aria-live="polite"
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>
            {(() => {
              const activeIdx = uploadingFiles.findIndex((u) => u.status === 'uploading');
              const idx = activeIdx >= 0 ? activeIdx : uploadingFiles.length - 1;
              return `מעלה ${idx + 1} מתוך ${uploadingFiles.length}`;
            })()}
          </div>
          {uploadingFiles.map((u, i) => {
            const sizeMb = (u.sizeBytes / 1024 / 1024).toFixed(1);
            const barColor =
              u.status === 'error' ? '#dc2626' :
              u.status === 'done'  ? '#16a34a' :
                                     '#1d4ed8';
            // Once bytes hit 95%, the server is processing the multipart
            // body + writing to disk + recording the row. Showing a
            // misleading "99%" for that whole stretch reads as "stuck".
            // Switch to "מעבד..." so the participant knows progress IS
            // happening, just on the server side.
            const statusText =
              u.status === 'queued'    ? 'ממתין'   :
              u.status === 'uploading'
                ? (u.percent >= 95 ? 'מעבד...' : `מעלה... ${u.percent}%`)
              : u.status === 'done'    ? 'הועלה ✓' :
                                         (u.error ? `שגיאה: ${u.error}` : 'שגיאה');
            return (
              <div key={`${i}-${u.name}`} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                {/* Instant thumb from the local File. Images render via
                    <img>; videos render a muted <video> so the first
                    frame is visible without any network fetch. The
                    participant can confirm what they picked without
                    waiting for the upload to finish. */}
                {u.localPreviewUrl && (
                  u.isVideo ? (
                    <video
                      src={u.localPreviewUrl}
                      style={s.uploadThumb}
                      muted
                      playsInline
                      preload="metadata"
                    />
                  ) : (
                    <img src={u.localPreviewUrl} alt="" style={s.uploadThumb} />
                  )
                )}
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, color: '#0f172a' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>
                      {u.name} <span style={{ color: '#94a3b8' }}>({sizeMb}MB)</span>
                    </span>
                    <span
                      style={{
                        fontWeight: 600,
                        color: u.status === 'error' ? '#b91c1c' :
                               u.status === 'done'  ? '#15803d' :
                                                      '#475569',
                      }}
                    >
                      {statusText}
                    </span>
                  </div>
                  <div
                    style={{
                      width: '100%', height: 6, borderRadius: 999,
                      background: '#e2e8f0', overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${u.status === 'done' ? 100 : u.percent}%`,
                        height: '100%',
                        background: barColor,
                        transition: 'width 120ms linear',
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy || atCap}
        style={{
          ...s.uploadButton,
          marginTop: ids.length > 0 || uploadingFiles.length > 0 ? 10 : 0,
          ...(atCap ? { opacity: 0.55, cursor: 'not-allowed' } : {}),
        }}
      >
        {busy
          ? (() => {
              const activeIdx = uploadingFiles.findIndex((u) => u.status === 'uploading');
              const active = activeIdx >= 0 ? uploadingFiles[activeIdx] : null;
              if (!active) return 'מעלה...';
              const tail = active.percent >= 95 ? 'מעבד...' : `${active.percent}%`;
              return `מעלה ${activeIdx + 1}/${uploadingFiles.length} — ${tail}`;
            })()
          : atCap
            ? `מקסימום ${GALLERY_MAX_FILES} קבצים`
            : '+ הוסיפי תמונות / וידאו'}
      </button>
      <p style={{ fontSize: 11, color: '#94a3b8', margin: '6px 2px 0', lineHeight: 1.5 }}>
        עד {GALLERY_MAX_FILES} קבצים. תמונות עד 15MB (jpg/png/gif/webp), וידאו עד 50MB (mp4/mov/webm).
      </p>
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
  uploadThumb: {
    width: 48, height: 48, borderRadius: 8, objectFit: 'cover' as const,
    flexShrink: 0, background: '#e2e8f0',
  } as React.CSSProperties,
  galleryRemoveBtn: {
    position: 'absolute' as const, top: 4, insetInlineEnd: 4,
    width: 24, height: 24, borderRadius: '50%',
    background: 'rgba(15,23,42,0.7)', color: '#fff', border: 'none',
    fontSize: 16, lineHeight: 1, cursor: 'pointer', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
  } as React.CSSProperties,
};
