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

import { useEffect, useRef, useState } from 'react';

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
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click + Escape. Mounted only while the popover
  // is open so we don't pay the listener cost in the common case.
  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (e.target instanceof Node && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
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

  return (
    <div ref={wrapperRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
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
      {open && (
        <div
          // Popover floats above the composer — high zIndex so it
          // overlays scheduled-strip pills + chat bubbles. The inset:
          // bottom anchor opens the popover ABOVE the button so it
          // doesn't get clipped when the composer is at the bottom of
          // a fixed-height chat container.
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            insetInlineStart: 0,
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 10,
            padding: 12,
            boxShadow: '0 10px 30px rgba(0,0,0,0.12)',
            minWidth: 320,
            maxWidth: 'min(420px, 85vw)',
            zIndex: 1500,
            display: 'flex', flexDirection: 'column', gap: 10,
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
        </div>
      )}
    </div>
  );
}
