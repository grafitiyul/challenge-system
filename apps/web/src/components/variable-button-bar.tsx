'use client';

// Variable insertion bar for the communication-template body editor.
// Lives above WhatsAppEditor / RichContentEditor and calls their
// shared imperative `insertAtCursor` handle so clicking a chip drops
// the token at the current caret position.
//
// Token strings must match the server-side render keys in
// apps/api/src/modules/programs/template-render.ts.

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
    items: [
      { label: 'לינק למשחק', token: '{portalLink}' },
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
