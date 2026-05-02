'use client';

// MessageComposer — single composer reused across every WhatsApp-send
// surface in the admin UI:
//   - participant chat popup (ParticipantPrivateChatPopup → ParticipantPrivateChat)
//   - group participant-row WA popup (same component)
//   - group header "הודעה" button → GroupOneTimeMessageModal
//
// Each surface passes its own onSendNow / onSchedule callbacks plus an
// optional template loader. Composer itself is surface-agnostic.
//
// UX:
//   - WhatsAppEditor inside (bold/italic/strikethrough/bullets/emoji
//     +preview toggle), so the composer keeps every editing tool the
//     old send modal had. Auto-grows naturally with content because
//     contenteditable expands as content fills.
//   - Variables hidden behind a "+ משתנים" trigger (VariableInsertButton)
//   - Template picker shown only when loadTemplates is provided.
//     Loads on first open, cached for the rest of the popup lifetime.
//   - Mode pills (שלח עכשיו / תזמן) + datetime picker on a single
//     compact row above the editor.

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@lib/api';
import WhatsAppEditor, { type WhatsAppEditorHandle } from './whatsapp-editor';
import { VariableInsertButton } from './variable-button-bar';

// ─── Date helpers ──────────────────────────────────────────────────────────

function localInputToIso(local: string): string {
  return new Date(local).toISOString();
}

function defaultScheduleSlot(): string {
  const d = new Date(Date.now() + 60 * 60_000);
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ─── Template types ────────────────────────────────────────────────────────

export interface TemplateGroup {
  programId: string;
  programName: string;
  templates: Array<{ id: string; title: string; body: string }>;
}

// Helpers exposed to the parent so it doesn't have to repeat the URL
// shape. Each surface picks the appropriate one.
export function loadParticipantTemplates(participantId: string): () => Promise<TemplateGroup[]> {
  return () =>
    apiFetch<TemplateGroup[]>(`/api-proxy/api/participants/${participantId}/whatsapp-templates`, {
      cache: 'no-store',
    });
}
export function loadProgramTemplates(programId: string): () => Promise<TemplateGroup[]> {
  return async () => {
    const rows = await apiFetch<Array<{ id: string; title: string; body: string }>>(
      `/api-proxy/api/programs/${programId}/communication-templates?channel=whatsapp`,
      { cache: 'no-store' },
    );
    return [
      {
        programId,
        programName: '',
        templates: rows,
      },
    ];
  };
}

// ─── Public API ────────────────────────────────────────────────────────────

export interface MessageComposerProps {
  onSendNow: (text: string) => Promise<void>;
  onSchedule: (text: string, scheduledAtIso: string) => Promise<void>;
  // Optional template loader. Composer fetches lazily when picker opens.
  // Returns groups by program. If undefined, picker isn't rendered.
  loadTemplates?: () => Promise<TemplateGroup[]>;
  placeholder?: string;
  allowSchedule?: boolean;
  // Reports whether the editor currently holds typed-but-not-sent text.
  // Optional — surfaces that need to gate close on dirty composer state
  // (popup wrappers) listen via this; standalone usage ignores it.
  onDirtyChange?: (dirty: boolean) => void;
}

export function MessageComposer({
  onSendNow,
  onSchedule,
  loadTemplates,
  placeholder = 'הקלידי הודעה...',
  allowSchedule = true,
  onDirtyChange,
}: MessageComposerProps) {
  const [content, setContent] = useState('');
  const [mode, setMode] = useState<'now' | 'schedule'>('now');
  const [scheduledAt, setScheduledAt] = useState(defaultScheduleSlot);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  // Editor handle — used by both VariableInsertButton and the template
  // picker so token / template insertion lands at the caret.
  const editorHandleRef = useRef<WhatsAppEditorHandle | null>(null);

  // Bubble dirty state up. Only flips when the editor has trimmed
  // content; clears as soon as a successful send empties it.
  useEffect(() => {
    onDirtyChange?.(content.trim().length > 0);
  }, [content, onDirtyChange]);

  // ── Template picker state ──────────────────────────────────────────────
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [templateGroups, setTemplateGroups] = useState<TemplateGroup[] | null>(null);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateLoadErr, setTemplateLoadErr] = useState('');
  // When user picks a template while composer has existing text, gate
  // the swap behind a confirm so they don't lose work.
  const [pendingTemplate, setPendingTemplate] = useState<{ title: string; body: string } | null>(null);

  // Load templates on first picker open. Cached for the rest of the
  // composer's lifetime — the same templates list rarely changes mid-
  // conversation, and re-fetching on every open feels janky.
  async function openTemplatePicker() {
    setTemplatePickerOpen((v) => !v);
    if (templateGroups !== null || !loadTemplates) return;
    setTemplateLoading(true);
    setTemplateLoadErr('');
    try {
      const groups = await loadTemplates();
      setTemplateGroups(groups);
    } catch (e) {
      const m = e instanceof Error ? e.message :
        (typeof e === 'object' && e !== null && typeof (e as { message?: unknown }).message === 'string')
          ? (e as { message: string }).message : 'טעינת תבניות נכשלה';
      setTemplateLoadErr(m);
    } finally {
      setTemplateLoading(false);
    }
  }

  function pickTemplate(body: string, title: string) {
    setTemplatePickerOpen(false);
    if (content.trim().length > 0) {
      setPendingTemplate({ title, body });
      return;
    }
    setContent(body);
  }

  function confirmReplaceWithTemplate() {
    if (!pendingTemplate) return;
    setContent(pendingTemplate.body);
    setPendingTemplate(null);
  }

  // ── Send ─────────────────────────────────────────────────────────────
  async function send() {
    const text = content.trim();
    if (!text) { setErr('תוכן ההודעה הוא שדה חובה'); return; }
    setBusy(true);
    setErr('');
    setOk('');
    try {
      if (mode === 'now') {
        await onSendNow(text);
        setOk('נשלח ✓');
      } else {
        const iso = localInputToIso(scheduledAt);
        await onSchedule(text, iso);
        setOk('תוזמן ✓');
      }
      setContent('');
    } catch (e) {
      const m = e instanceof Error ? e.message :
        (typeof e === 'object' && e !== null && typeof (e as { message?: unknown }).message === 'string')
          ? (e as { message: string }).message : 'שליחה נכשלה';
      setErr(m);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!ok) return;
    const t = setTimeout(() => setOk(''), 2400);
    return () => clearTimeout(t);
  }, [ok]);

  const sendDisabled = busy || !content.trim();
  const sendBg = sendDisabled
    ? '#cbd5e1'
    : (mode === 'now' ? '#16a34a' : '#2563eb');

  return (
    <div
      style={{
        flexShrink: 0,
        borderTop: '1px solid #e2e8f0',
        background: '#fff',
        padding: 10,
      }}
    >
      {/* Mode + datetime picker + template trigger + variables trigger
          all on one compact row above the editor. */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
        {allowSchedule && (
          <>
            <button
              type="button"
              onClick={() => setMode('now')}
              style={{
                padding: '4px 10px', fontSize: 11, fontWeight: 600,
                background: mode === 'now' ? '#16a34a' : '#fff',
                color: mode === 'now' ? '#fff' : '#475569',
                border: `1px solid ${mode === 'now' ? '#16a34a' : '#cbd5e1'}`,
                borderRadius: 999, cursor: 'pointer',
              }}
            >שלח עכשיו</button>
            <button
              type="button"
              onClick={() => setMode('schedule')}
              style={{
                padding: '4px 10px', fontSize: 11, fontWeight: 600,
                background: mode === 'schedule' ? '#2563eb' : '#fff',
                color: mode === 'schedule' ? '#fff' : '#475569',
                border: `1px solid ${mode === 'schedule' ? '#2563eb' : '#cbd5e1'}`,
                borderRadius: 999, cursor: 'pointer',
              }}
            >תזמן</button>
            {mode === 'schedule' && (
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                style={{
                  padding: '4px 8px', fontSize: 12, direction: 'ltr',
                  border: '1px solid #cbd5e1', borderRadius: 7,
                  fontFamily: 'inherit',
                }}
              />
            )}
          </>
        )}

        {/* Template picker — only rendered when a loader is provided.
            The dropdown floats above the editor; click outside or
            re-click the trigger to close. */}
        {loadTemplates && (
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => { void openTemplatePicker(); }}
              style={{
                padding: '4px 10px', fontSize: 11, fontWeight: 600,
                background: templatePickerOpen ? '#dbeafe' : '#fff',
                color: templatePickerOpen ? '#1d4ed8' : '#475569',
                border: `1px solid ${templatePickerOpen ? '#bfdbfe' : '#cbd5e1'}`,
                borderRadius: 999, cursor: 'pointer',
              }}
              aria-expanded={templatePickerOpen}
            >📋 בחר נוסח</button>
            {templatePickerOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 6px)',
                  insetInlineStart: 0,
                  background: '#fff',
                  border: '1px solid #e2e8f0',
                  borderRadius: 10,
                  boxShadow: '0 10px 30px rgba(0,0,0,0.12)',
                  minWidth: 320,
                  maxWidth: 'min(420px, 85vw)',
                  maxHeight: 320,
                  overflowY: 'auto',
                  zIndex: 1500,
                }}
              >
                {templateLoading && (
                  <div style={{ padding: 14, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>טוען תבניות...</div>
                )}
                {templateLoadErr && !templateLoading && (
                  <div style={{ padding: 14, color: '#b91c1c', fontSize: 12 }}>{templateLoadErr}</div>
                )}
                {!templateLoading && !templateLoadErr && (templateGroups ?? []).every((g) => g.templates.length === 0) && (
                  <div style={{ padding: 14, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>
                    אין תבניות זמינות
                  </div>
                )}
                {!templateLoading && !templateLoadErr && (templateGroups ?? []).map((g) => (
                  g.templates.length === 0 ? null : (
                    <div key={g.programId}>
                      {g.programName && (
                        <div style={{
                          padding: '6px 12px', fontSize: 10, fontWeight: 700,
                          color: '#94a3b8', textTransform: 'uppercase',
                          letterSpacing: '0.05em', background: '#f8fafc',
                          borderBottom: '1px solid #f1f5f9',
                        }}>
                          {g.programName}
                        </div>
                      )}
                      {g.templates.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => pickTemplate(t.body, t.title)}
                          style={{
                            display: 'block', width: '100%', textAlign: 'right',
                            padding: '10px 12px',
                            background: 'none', border: 'none',
                            borderBottom: '1px solid #f1f5f9',
                            cursor: 'pointer', fontSize: 13,
                          }}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#f8fafc'; }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
                        >
                          <div style={{ fontWeight: 600, color: '#0f172a', marginBottom: 2 }}>{t.title}</div>
                          <div style={{
                            color: '#64748b', fontSize: 12,
                            overflow: 'hidden', textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap', direction: 'rtl',
                          }}>{t.body}</div>
                        </button>
                      ))}
                    </div>
                  )
                ))}
              </div>
            )}
          </div>
        )}

        <VariableInsertButton editorRef={editorHandleRef} />

        {ok && (
          <span style={{ color: '#15803d', fontSize: 11, fontWeight: 600, marginInlineStart: 'auto' }}>{ok}</span>
        )}
      </div>

      {/* WhatsAppEditor: bold/italic/strikethrough/bullets/emoji + WA
          preview toggle + auto-growing contenteditable. minHeight kept
          tight (60px) so the chat conversation above stays the focal
          area; the editor expands naturally as the admin types. */}
      <WhatsAppEditor
        ref={editorHandleRef}
        value={content}
        onChange={setContent}
        placeholder={placeholder}
        minHeight={60}
      />

      {err && (
        <div style={{ color: '#dc2626', fontSize: 12, marginTop: 6 }}>{err}</div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
        <button
          type="button"
          onClick={() => { void send(); }}
          disabled={sendDisabled}
          style={{
            padding: '7px 18px', fontSize: 13, fontWeight: 700,
            background: sendBg,
            color: '#fff', border: 'none', borderRadius: 999,
            cursor: sendDisabled ? 'not-allowed' : 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {busy
            ? '...'
            : mode === 'now' || !allowSchedule
              ? 'שלח עכשיו'
              : 'תזמן הודעה'}
        </button>
      </div>

      {/* Replace-with-template confirm. Locked overlay, no backdrop
          close — same convention as the rest of the strong modals. */}
      {pendingTemplate && (
        <div
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(15,23,42,0.55)',
            zIndex: 1400,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16,
          }}
        >
          <div style={{ background: '#fff', borderRadius: 12, padding: 22, maxWidth: 380, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>
              להחליף את הטקסט הקיים?
            </div>
            <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.6, margin: '0 0 14px' }}>
              יש טקסט שכבר נכתב. החלפה לתבנית &ldquo;{pendingTemplate.title}&rdquo; תדרוס אותו.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setPendingTemplate(null)}
                style={{ background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 8, padding: '7px 14px', fontSize: 13, cursor: 'pointer' }}
              >ביטול</button>
              <button
                onClick={confirmReplaceWithTemplate}
                style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
              >החלף</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export { localInputToIso };
