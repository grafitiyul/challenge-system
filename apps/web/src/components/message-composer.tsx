'use client';

// MessageComposer — single composer reused across every WhatsApp-send
// surface in the admin UI:
//   - participant chat popup (ParticipantPrivateChatPopup → ParticipantPrivateChat)
//   - group participant-row WA popup (same component)
//   - group header "הודעה" button → GroupOneTimeMessageModal
//
// Rather than each surface owning a copy of the editor + variables +
// mode toggle + send button, they all render <MessageComposer> with
// per-surface onSendNow / onSchedule callbacks. The composer itself is
// surface-agnostic — it doesn't know whether sending hits the private
// DM endpoint or the group send endpoint, only that the parent gave
// it functions to call.
//
// UX choices:
//   - WhatsApp-style auto-grow textarea pinned at the bottom of the
//     parent. Starts compact (one line) and grows up to maxRows; past
//     that it scrolls internally.
//   - Variables hidden behind a "+ משתנים" trigger (VariableInsertButton)
//     — no more always-visible chip bar crowding the composer.
//   - Mode pills (שלח עכשיו / תזמן) + datetime picker on a single
//     compact row above the textarea.
//   - Send button label flips between "שלח עכשיו" and "תזמן הודעה".

import { useEffect, useRef, useState } from 'react';
import {
  VariableInsertButton,
  type VariableEditorHandle,
} from './variable-button-bar';

// ─── Date helpers (local-wallclock ↔ ISO UTC, Asia/Jerusalem) ──────────────
// Same convention every admin form uses: the browser's datetime-local
// input returns wall-clock for the admin's locale (Israel), so we just
// round-trip via `new Date(local).toISOString()`. Display always uses
// he-IL locale.

function localInputToIso(local: string): string {
  return new Date(local).toISOString();
}

function defaultScheduleSlot(): string {
  // "in 1 hour" rounded up to the next 5 minutes — sensible default
  // that's always in the future + matches the existing chat behavior.
  const d = new Date(Date.now() + 60 * 60_000);
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ─── Auto-grow plain-text editor ─────────────────────────────────────────
// We deliberately use a plain <textarea> rather than the WhatsApp
// markdown editor here. Reasons:
//   - WhatsApp-like input at the bottom of a chat is expected to be a
//     simple growing textarea, not a styled editor.
//   - The bridge sends raw text to WhatsApp — formatting via *bold* /
//     _italic_ markers still works because that's WhatsApp protocol,
//     not our HTML.
//   - Auto-grow on a contenteditable is fiddly across browsers; on a
//     textarea it's a one-line height-recompute on input.
// The textarea exposes the same { insertAtCursor, focus } imperative
// handle that VariableInsertButton expects.

interface AutoGrowTextareaHandle extends VariableEditorHandle {}

function useAutoGrowTextarea(
  value: string,
  maxRows: number,
): {
  ref: React.RefObject<HTMLTextAreaElement | null>;
  recalc: () => void;
} {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  function recalc() {
    const el = ref.current;
    if (!el) return;
    // Reset to auto first so the scrollHeight reflects content size,
    // then clamp to maxRows × line-height. The line-height is read
    // from computed style so theme changes don't desync this from the
    // textarea's actual rendering.
    el.style.height = 'auto';
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20;
    const padding =
      parseFloat(getComputedStyle(el).paddingTop) +
      parseFloat(getComputedStyle(el).paddingBottom);
    const max = lineHeight * maxRows + padding;
    el.style.height = Math.min(el.scrollHeight, max) + 'px';
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }
  useEffect(() => { recalc(); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ref, recalc };
}

// ─── Public API ───────────────────────────────────────────────────────────

export interface MessageComposerProps {
  // Parent owns the actual API call; composer only reports the text
  // (and, for schedule, the chosen UTC ISO time). Parent should
  // throw on failure so the composer can surface the error.
  onSendNow: (text: string) => Promise<void>;
  onSchedule: (text: string, scheduledAtIso: string) => Promise<void>;
  placeholder?: string;
  // Some surfaces (group header) hide the schedule pill if the parent
  // explicitly opts out. Default: schedule visible.
  allowSchedule?: boolean;
}

export function MessageComposer({
  onSendNow,
  onSchedule,
  placeholder = 'הקלידי הודעה...',
  allowSchedule = true,
}: MessageComposerProps) {
  const [content, setContent] = useState('');
  const [mode, setMode] = useState<'now' | 'schedule'>('now');
  const [scheduledAt, setScheduledAt] = useState(defaultScheduleSlot);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  // Auto-grow up to ~6 rows; past that the textarea scrolls internally.
  // Six rows is enough to read most outbound DMs at a glance without
  // pushing the chat history out of view.
  const { ref: textareaRef, recalc } = useAutoGrowTextarea(content, 6);

  // Imperative handle for VariableInsertButton.insertAtCursor.
  // Uses the textarea's selectionStart/End so the token replaces the
  // current selection (or just inserts at the caret if there isn't one).
  const handleRef = useRef<AutoGrowTextareaHandle>({
    insertAtCursor(token: string) {
      const el = textareaRef.current;
      if (!el) return;
      const start = el.selectionStart ?? content.length;
      const end = el.selectionEnd ?? content.length;
      const next = content.slice(0, start) + token + content.slice(end);
      setContent(next);
      // Restore caret after the inserted token on the next tick — by
      // then React has flushed the new value into the DOM.
      requestAnimationFrame(() => {
        if (!el) return;
        const pos = start + token.length;
        el.focus();
        el.setSelectionRange(pos, pos);
        recalc();
      });
    },
    focus() { textareaRef.current?.focus(); },
  });
  // Keep the ref's closure in sync with the latest `content` so a click
  // mid-edit inserts at the right place.
  useEffect(() => {
    handleRef.current.insertAtCursor = (token: string) => {
      const el = textareaRef.current;
      if (!el) return;
      const start = el.selectionStart ?? content.length;
      const end = el.selectionEnd ?? content.length;
      const next = content.slice(0, start) + token + content.slice(end);
      setContent(next);
      requestAnimationFrame(() => {
        if (!el) return;
        const pos = start + token.length;
        el.focus();
        el.setSelectionRange(pos, pos);
        recalc();
      });
    };
  }, [content, recalc, textareaRef]);

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

  // Clear the success flash after a couple of seconds — it's a
  // confirmation, not a permanent state.
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
      {/* Mode + (when scheduling) datetime picker. Schedule pill +
          datetime are hidden in surfaces that opt out (allowSchedule=false). */}
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
        <VariableInsertButton editorRef={handleRef} />
        {ok && (
          <span style={{ color: '#15803d', fontSize: 11, fontWeight: 600, marginInlineStart: 'auto' }}>{ok}</span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter inserts a newline. Matches the
            // input convention WhatsApp Web uses.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (!sendDisabled) void send();
            }
          }}
          placeholder={placeholder}
          rows={1}
          style={{
            flex: 1,
            resize: 'none',
            minHeight: 38,
            padding: '8px 12px',
            border: '1px solid #cbd5e1',
            borderRadius: 18,
            fontSize: 14,
            lineHeight: '20px',
            fontFamily: 'inherit',
            background: '#fff',
            color: '#0f172a',
            outline: 'none',
            boxSizing: 'border-box',
            // Vertical scrollbar appears only when content exceeds maxRows.
            overflowY: 'hidden',
          }}
        />
        <button
          type="button"
          onClick={() => { void send(); }}
          disabled={sendDisabled}
          style={{
            padding: '0 14px', height: 38, fontSize: 13, fontWeight: 700,
            background: sendBg,
            color: '#fff', border: 'none', borderRadius: 18,
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
      {err && (
        <div style={{ color: '#dc2626', fontSize: 12, marginTop: 6 }}>{err}</div>
      )}
    </div>
  );
}

// Re-export the date helper because GroupOneTimeMessageModal computes
// its own ISO conversion for the schedule callback. Saves duplicating
// the trivial wall-clock helper.
export { localInputToIso };
