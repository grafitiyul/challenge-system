'use client';

// Variable insertion bar for the communication-template body editor.
// Lives above WhatsAppEditor / RichContentEditor and calls their
// shared imperative `insertAtCursor` handle so clicking a chip drops
// the token at the current caret position.
//
// Token strings must match the server-side render keys in
// apps/api/src/modules/programs/template-render.ts.
//
// Two surfaces consume this module:
//   - VariableButtonBar — always-visible chip bar (template editors,
//     where vertical space is plentiful and discoverability matters)
//   - VariableInsertButton — a single "+ משתנים" trigger that opens
//     a popover with the same chips (chat composer, where vertical
//     space is precious — see participant-private-chat.tsx)

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface VariableEditorHandle {
  insertAtCursor: (text: string) => void;
  focus: () => void;
}

interface Props {
  editorRef: React.RefObject<VariableEditorHandle | null>;
}

interface Group {
  title: string;
  items: Array<{ label: string; token: string }>;
}

const GROUPS: Group[] = [
  {
    title: 'משתתפת',
    items: [
      { label: 'שם פרטי', token: '{firstName}' },
      { label: 'שם מלא', token: '{fullName}' },
      { label: 'טלפון', token: '{phoneNumber}' },
      { label: 'אימייל', token: '{email}' },
    ],
  },
  {
    title: 'תוכנית',
    items: [
      { label: 'שם תוכנית', token: '{productTitle}' },
    ],
  },
  {
    title: 'קבוצה',
    items: [
      { label: 'שם קבוצה', token: '{groupName}' },
    ],
  },
  {
    title: 'תשלום',
    items: [
      { label: 'שם הצעה', token: '{offerTitle}' },
      { label: 'סכום', token: '{offerAmount}' },
      { label: 'מטבע', token: '{offerCurrency}' },
    ],
  },
  {
    title: 'מערכת',
    // {portalLink} is intentionally NOT shown here — it's a legacy alias
    // of {tasksLink} kept server-side for old templates only. New templates
    // should pick the explicit {gameLink} / {tasksLink} above.
    items: [
      { label: 'לינק למשחק', token: '{gameLink}' },
      { label: 'לינק למשימות', token: '{tasksLink}' },
    ],
  },
];

export function VariableButtonBar({ editorRef }: Props) {
  function insert(token: string, e: React.MouseEvent) {
    // mousedown prevents the browser from stealing focus + killing the
    // editor's selection; we still fire on click for accessibility.
    e.preventDefault();
    editorRef.current?.insertAtCursor(token);
  }
  const chipStyle: React.CSSProperties = {
    padding: '4px 10px', fontSize: 12, fontWeight: 600,
    background: '#f8fafc', color: '#0f172a',
    border: '1px solid #e2e8f0', borderRadius: 999,
    cursor: 'pointer', whiteSpace: 'nowrap' as const, fontFamily: 'inherit',
  };
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, marginBottom: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 8, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
        משתנים להוספה בלחיצה
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
        {GROUPS.map((g) => (
          <div key={g.title} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', minWidth: 64 }}>
              {g.title}:
            </div>
            {g.items.map((item) => (
              <button
                key={item.token}
                type="button"
                title={item.token}
                onMouseDown={(e) => insert(item.token, e)}
                onClick={(e) => e.preventDefault()}
                style={chipStyle}
              >
                {item.label}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// Compact variant — single "+ משתנים" trigger that opens a small
// popover with the same chips. Used in space-constrained surfaces
// (chat composer) where the always-visible bar would crowd the
// editor. Click outside / Escape closes the popover; click a chip
// inserts and closes.
export function VariableInsertButton({ editorRef }: Props) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  // Computed popover position in viewport (page) coordinates. Computed
  // from the button's getBoundingClientRect at open time + on
  // scroll/resize. Rendering via portal escapes any parent overflow
  // (StrongModal body has `overflow: hidden`) — without the portal
  // the popover got clipped by the modal chrome.
  const [coords, setCoords] = useState<{ top: number; insetInlineStart: number; width: number } | null>(null);

  // Re-position popover whenever it opens, the window resizes, or any
  // scrollable ancestor scrolls. We listen on capture so nested
  // scrollable containers (e.g. the chat conversation area) trigger
  // the recompute. Cleanup is symmetric.
  useLayoutEffect(() => {
    if (!open) return;
    function recompute() {
      const btn = buttonRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      // Anchor: place the popover ABOVE the button by default. If
      // there isn't enough headroom, fall back below. Width: clamp to
      // viewport so it never overflows on narrow screens.
      const popoverWidth = Math.min(420, window.innerWidth - 16);
      const popoverHeightEstimate = 260;
      const aboveTop = r.top - popoverHeightEstimate - 8;
      const belowTop = r.bottom + 8;
      const top = aboveTop > 8 ? aboveTop : belowTop;
      // RTL-aware horizontal anchor. The button is right-aligned in
      // the composer; we anchor the popover's right edge to the
      // button's right edge so it grows leftward.
      const right = window.innerWidth - r.right;
      const insetInlineStart = right; // logical "start" in RTL = right edge
      setCoords({ top, insetInlineStart, width: popoverWidth });
    }
    recompute();
    window.addEventListener('resize', recompute);
    window.addEventListener('scroll', recompute, true); // capture: catch nested scrolls
    return () => {
      window.removeEventListener('resize', recompute);
      window.removeEventListener('scroll', recompute, true);
    };
  }, [open]);

  // Close on outside click + Escape. The popover is in a portal, so
  // its DOM tree is detached — we explicitly include it in the
  // "inside" check below alongside the button wrapper.
  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      if (buttonRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function insert(token: string, e: React.MouseEvent) {
    // mousedown to avoid stealing focus (matches the chip-bar pattern).
    e.preventDefault();
    editorRef.current?.insertAtCursor(token);
    setOpen(false);
  }

  const chipStyle: React.CSSProperties = {
    padding: '4px 10px', fontSize: 12, fontWeight: 600,
    background: '#f8fafc', color: '#0f172a',
    border: '1px solid #e2e8f0', borderRadius: 999,
    cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit',
  };

  // Popover content. Rendered via a portal to document.body so any
  // ancestor `overflow: hidden` / `transform` doesn't clip it. The
  // RTL `insetInlineStart` from coords pins it to the button's
  // right edge regardless of the parent's writing direction.
  const popover = open && coords && typeof document !== 'undefined' ? createPortal(
    <div
      ref={popoverRef}
      style={{
        position: 'fixed',
        top: coords.top,
        insetInlineStart: coords.insetInlineStart,
        width: coords.width,
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 10,
        padding: 12,
        boxShadow: '0 10px 30px rgba(0,0,0,0.18)',
        // zIndex above StrongModal (1000) AND its confirm sub-modal
        // (1100), AND any nested popup zIndices we use. 2000 leaves
        // headroom for unusual stacks.
        zIndex: 2000,
        display: 'flex', flexDirection: 'column', gap: 10,
        maxHeight: '60vh',
        overflowY: 'auto',
      }}
    >
      {GROUPS.map((g) => (
        <div key={g.title} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', minWidth: 56 }}>
            {g.title}:
          </div>
              {g.items.map((item) => (
                <button
              key={item.token}
              type="button"
              title={item.token}
              onMouseDown={(e) => insert(item.token, e)}
              onClick={(e) => e.preventDefault()}
              style={chipStyle}
            >
              {item.label}
            </button>
          ))}
        </div>
      ))}
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          padding: '5px 12px', fontSize: 12, fontWeight: 600,
          background: open ? '#eff6ff' : '#fff',
          color: open ? '#1d4ed8' : '#475569',
          border: `1px solid ${open ? '#bfdbfe' : '#cbd5e1'}`,
          borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit',
        }}
        aria-expanded={open}
        aria-haspopup="true"
      >+ משתנים</button>
      {popover}
    </>
  );
}
