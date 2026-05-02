'use client';

// Reusable "strong modal" wrapper. Implements the project's
// modal/popup product rule:
//   - backdrop click does NOT close
//   - the only direct close control is the X button (top-right)
//   - X is rendered inside a sticky header so it stays visible while
//     the body scrolls
//   - close attempts route through attemptClose: if isDirty=true, an
//     in-app confirm appears with the standard
//     "יש שינויים שלא נשמרו. לסגור בלי לשמור?" copy and the two
//     buttons "המשך לערוך" / "סגור בלי לשמור"
//   - never uses window.confirm — the confirm is a layered fixed
//     overlay so it works inside any parent modal stack
//
// API: render-prop children. The wrapper passes `attemptClose` to
// children so the form's own ביטול button can route through the
// same gate the X button uses.
//
//   <StrongModal title="..." isDirty={dirty} onClose={() => ...}>
//     {({ attemptClose }) => (
//       <>
//         <div>...form fields...</div>
//         <div>
//           <button onClick={attemptClose}>ביטול</button>
//           <button onClick={save}>שמור</button>
//         </div>
//       </>
//     )}
//   </StrongModal>
//
// `busy` disables the X + the cancel pathway so a save in flight
// can't be aborted mid-write. Matches the previous per-modal pattern.

import React, { useState } from 'react';

export interface StrongModalProps {
  title: React.ReactNode;
  // True when the form has unsaved changes. The wrapper compares this
  // bool at every close attempt; parent components compute it however
  // they want (snapshot diff is the usual approach).
  isDirty: boolean;
  // Called when the modal should actually close — either from a clean
  // close attempt or from the user confirming "סגור בלי לשמור".
  onClose: () => void;
  // Set to true while a save is in flight. The X button is disabled
  // and attemptClose becomes a no-op. The confirm sub-modal cannot
  // be opened while busy.
  busy?: boolean;
  // Tuning knobs — defaults match the existing programs-page modals
  // so the visual change at retrofit time is minimal.
  maxWidth?: number;
  // zIndex base for the wrapper. Confirm sub-modal sits at zIndex+100.
  // Default 1000 matches the existing inline modals; popups that need
  // to layer above other modals (e.g. participant chat popup) bump it.
  zIndex?: number;
  children: (helpers: { attemptClose: () => void }) => React.ReactNode;
}

export function StrongModal({
  title,
  isDirty,
  onClose,
  busy = false,
  maxWidth = 560,
  zIndex = 1000,
  children,
}: StrongModalProps) {
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  function attemptClose() {
    if (busy) return;
    if (isDirty) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  }

  return (
    <div
      // No onClick on the backdrop — clicks outside the dialog do
      // nothing. This is the load-bearing "strong" property.
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,23,42,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex,
        padding: 16,
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 14,
          width: '100%',
          maxWidth,
          maxHeight: '92vh',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Sticky header — title + X. Sits above the scrolling body so
            the close control is always reachable, even on a 30-field
            game-engine modal that scrolls 800px down. */}
        <div
          style={{
            position: 'sticky',
            top: 0,
            background: '#fff',
            borderBottom: '1px solid #e2e8f0',
            padding: '14px 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
            zIndex: 1,
          }}
        >
          <div style={{ fontSize: 17, fontWeight: 700, color: '#0f172a' }}>
            {title}
          </div>
          <button
            type="button"
            onClick={attemptClose}
            disabled={busy}
            aria-label="סגור"
            style={{
              background: 'none',
              border: 'none',
              color: '#94a3b8',
              fontSize: 22,
              cursor: busy ? 'not-allowed' : 'pointer',
              lineHeight: 1,
              padding: 4,
            }}
          >×</button>
        </div>

        {/* Scrollable body. Padding matches the existing inline
            programs-page modal pattern (22px). */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 22 }}>
          {children({ attemptClose })}
        </div>
      </div>

      {/* Unsaved-changes confirm. zIndex + 100 so it always layers
          above this modal regardless of the wrapper's base zIndex. */}
      {confirmDiscard && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: zIndex + 100,
            padding: 16,
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 12,
              padding: 22,
              maxWidth: 420,
              width: '100%',
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
            }}
          >
            <div
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: '#0f172a',
                marginBottom: 8,
              }}
            >
              לסגור בלי לשמור?
            </div>
            <p
              style={{
                fontSize: 13,
                color: '#475569',
                lineHeight: 1.6,
                margin: '0 0 14px',
              }}
            >
              יש שינויים שלא נשמרו. לסגור בלי לשמור?
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setConfirmDiscard(false)}
                style={{
                  background: '#f1f5f9',
                  color: '#374151',
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                  padding: '7px 14px',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >המשך לערוך</button>
              <button
                onClick={() => {
                  setConfirmDiscard(false);
                  onClose();
                }}
                style={{
                  background: '#dc2626',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  padding: '7px 16px',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >סגור בלי לשמור</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
