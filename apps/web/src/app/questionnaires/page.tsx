'use client';

const QUESTION_TYPES = [
  { type: 'text', label: 'טקסט חופשי', icon: '✏️', description: 'שדה טקסט לתשובה פתוחה' },
  { type: 'number', label: 'מספר', icon: '🔢', description: 'קלט מספרי (גיל, משקל, כמות)' },
  { type: 'choice', label: 'בחירה יחידה', icon: '⚪', description: 'רשימת אפשרויות — בחירה אחת' },
  { type: 'multi', label: 'בחירה מרובה', icon: '✅', description: 'רשימת אפשרויות — בחירה מרובה' },
  { type: 'scale', label: 'סקאלה', icon: '📊', description: 'דירוג מ-1 עד 10' },
  { type: 'date', label: 'תאריך', icon: '📅', description: 'בחירת תאריך' },
  { type: 'yesno', label: 'כן / לא', icon: '🔘', description: 'שאלת כן/לא פשוטה' },
  { type: 'file', label: 'העלאת קובץ', icon: '📎', description: 'תמונה או מסמך' },
];

const SAMPLE_QUESTIONS = [
  { id: 1, type: 'text', label: 'שם מלא', required: true },
  { id: 2, type: 'number', label: 'גיל', required: true },
  { id: 3, type: 'choice', label: 'מה המטרה העיקרית שלך?', required: true },
  { id: 4, type: 'scale', label: 'מה רמת המוטיבציה שלך (1-10)?', required: false },
  { id: 5, type: 'text', label: 'ספרי לנו על עצמך', required: false },
];

export default function QuestionnairesPage() {
  return (
    <div className="page-wrapper" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', margin: 0 }}>שאלונים</h1>
        <p style={{ color: '#64748b', fontSize: 14, marginTop: 4, marginBottom: 0 }}>
          בנאי שאלונים דינמי — שאלון ייחודי לכל אתגר
        </p>
      </div>

      <div
        style={{
          background: '#fffbeb',
          border: '1px solid #fde68a',
          borderRadius: 10,
          padding: '14px 20px',
          marginBottom: 28,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <span style={{ fontSize: 18 }}>🚧</span>
        <span style={{ fontSize: 14, color: '#92400e' }}>
          בנאי השאלונים בפיתוח. להלן מבנה הממשק המתוכנן.
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20 }}>
        {/* Builder area */}
        <div>
          {/* Questionnaire header */}
          <div
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 12,
              overflow: 'hidden',
              marginBottom: 16,
            }}
          >
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid #e2e8f0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span style={{ fontWeight: 600, fontSize: 15, color: '#0f172a' }}>
                שאלון הרשמה — דוגמה
              </span>
              <span
                style={{
                  background: '#f1f5f9',
                  color: '#94a3b8',
                  padding: '3px 10px',
                  borderRadius: 20,
                  fontSize: 12,
                }}
              >
                טיוטה
              </span>
            </div>

            {/* Question list */}
            <div style={{ padding: '12px 0' }}>
              {SAMPLE_QUESTIONS.map((q, idx) => (
                <div
                  key={q.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 20px',
                    borderBottom: '1px solid #f8fafc',
                  }}
                >
                  <span
                    style={{
                      width: 24,
                      height: 24,
                      background: '#f1f5f9',
                      borderRadius: 6,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 12,
                      color: '#64748b',
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    {idx + 1}
                  </span>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 14, color: '#0f172a' }}>{q.label}</span>
                    {q.required && (
                      <span style={{ color: '#ef4444', marginRight: 4, fontSize: 14 }}>*</span>
                    )}
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      background: '#eff6ff',
                      color: '#2563eb',
                      padding: '2px 8px',
                      borderRadius: 10,
                    }}
                  >
                    {QUESTION_TYPES.find((t) => t.type === q.type)?.label}
                  </span>
                  <span style={{ color: '#cbd5e1', cursor: 'grab', fontSize: 16 }}>⋮⋮</span>
                </div>
              ))}
            </div>

            <div style={{ padding: '12px 20px', borderTop: '1px solid #f1f5f9' }}>
              <button
                disabled
                style={{
                  width: '100%',
                  padding: '10px',
                  background: '#f8fafc',
                  border: '1px dashed #cbd5e1',
                  borderRadius: 8,
                  color: '#94a3b8',
                  fontSize: 14,
                  cursor: 'not-allowed',
                }}
              >
                + הוסף שאלה
              </button>
            </div>
          </div>
        </div>

        {/* Question type palette */}
        <div>
          <div
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 12,
              overflow: 'hidden',
            }}
          >
            <div style={{ padding: '14px 16px', borderBottom: '1px solid #e2e8f0' }}>
              <span style={{ fontWeight: 600, fontSize: 14, color: '#374151' }}>סוגי שאלות</span>
            </div>
            <div style={{ padding: '8px' }}>
              {QUESTION_TYPES.map((qt) => (
                <div
                  key={qt.type}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '9px 10px',
                    borderRadius: 7,
                    cursor: 'not-allowed',
                    opacity: 0.6,
                  }}
                >
                  <span style={{ fontSize: 18, flexShrink: 0 }}>{qt.icon}</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>{qt.label}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>{qt.description}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
