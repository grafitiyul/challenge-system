'use client';

// Locked-modal wrapper around ParticipantPrivateChat. Used by the
// group page's per-participant WA button. Behaves like the rest of
// the project's "explicit-close" modals:
//   - backdrop click does nothing
//   - X button + close button route through attemptClose()
//   - if the inner composer has unsaved text, an in-app confirm
//     appears before the popup actually closes
//
// The popup never owns scheduled-message state — it just renders
// ParticipantPrivateChat which does its own data fetching keyed on
// participantId. So opening the popup from the group surface shows
// EXACTLY the same rows as the participant profile chat tab, with
// edits/cancels propagating both directions automatically.

import { useState } from 'react';
import { ParticipantPrivateChat } from './participant-private-chat';
import { WhatsAppIcon } from './icons/whatsapp-icon';

export function ParticipantPrivateChatPopup(props: {
  participantId: string;
  participantName: string;
  onClose: () => void;
}) {
  const [dirty, setDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  function attemptClose() {
    if (dirty) { setConfirmDiscard(true); return; }
    props.onClose();
  }

  return (
    <div
      // No onClick on the backdrop — clicks outside the dialog do nothing.
      // Same product rule as the group sched-msg edit modal: explicit X
      // / cancel only.
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(15,23,42,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1100, padding: 16,
      }}
    >
      <div
        style={{
          background: '#fff', borderRadius: 14,
          width: '100%', maxWidth: 720, height: '88vh',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 18px',
            borderBottom: '1px solid #e2e8f0',
            background: '#f8fafc',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: '#16a34a', display: 'inline-flex' }}>
              <WhatsAppIcon size={20} color="#16a34a" />
            </span>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>
              צ׳אט עם {props.participantName}
            </div>
          </div>
          <button
            type="button"
            onClick={attemptClose}
            aria-label="סגור"
            style={{
              background: 'none', border: 'none',
              color: '#94a3b8', fontSize: 22, cursor: 'pointer',
              lineHeight: 1, padding: 4,
            }}
          >×</button>
        </div>
        {/* The chat component owns its own internal scroll (chat area)
            and dock layout — we just give it the remaining height of
            the popup. No padding here so the conversation + composer
            fill the full popup width. */}
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <ParticipantPrivateChat
            participantId={props.participantId}
            selfScroll={true}
            onDirtyChange={setDirty}
          />
        </div>
      </div>

      {confirmDiscard && (
        <div
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(15,23,42,0.55)',
            zIndex: 1300,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16,
          }}
        >
          <div style={{ background: '#fff', borderRadius: 12, padding: 22, maxWidth: 420, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>
              לסגור בלי לשמור?
            </div>
            <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.6, margin: '0 0 14px' }}>
              יש שינויים שלא נשמרו. לסגור בלי לשמור?
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setConfirmDiscard(false)}
                style={{ background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 8, padding: '7px 14px', fontSize: 13, cursor: 'pointer' }}
              >המשך לערוך</button>
              <button
                onClick={() => { setConfirmDiscard(false); props.onClose(); }}
                style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
              >סגור בלי לשמור</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
