'use client';

export default function TasksPage() {
  const taskCategories = [
    {
      title: 'משימות אתגר',
      description: 'משימות קבועות שמשויכות לכל אתגר. רלוונטיות לכלל המשתתפות.',
      icon: '⚡',
      color: '#2563eb',
      bg: '#eff6ff',
      items: ['משימה יומית — תרגיל בוקר', 'דיווח יומי עד 20:00', 'שיתוף בקבוצת הווטסאפ'],
    },
    {
      title: 'משימות קבוצה',
      description: 'משימות ייחודיות לקבוצה ספציפית. יכולות להיות שונות בין קבוצות באותו אתגר.',
      icon: '👥',
      color: '#16a34a',
      bg: '#f0fdf4',
      items: ['אתגר שבועי מיוחד', 'מפגש זום שבועי', 'שיתוף תמונה שבועי'],
    },
    {
      title: 'משימות אישיות',
      description: 'משימות מותאמות אישית למשתתפת ספציפית. נקבעות על ידי המאמן.',
      icon: '👤',
      color: '#7c3aed',
      bg: '#faf5ff',
      items: ['יעד אישי — השלמה ב-30 יום', 'מעקב תזונה יומי', 'שיחת מעקב שבועית'],
    },
  ];

  return (
    <div className="page-wrapper" style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', margin: 0 }}>משימות</h1>
        <p style={{ color: '#64748b', fontSize: 14, marginTop: 4, marginBottom: 0 }}>
          ניהול משימות — לפי אתגר, קבוצה ומשתתפת
        </p>
      </div>

      {/* Coming soon banner */}
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
          מערכת המשימות בפיתוח. להלן מבנה המערכת המתוכנן.
        </span>
      </div>

      {/* Task category cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 20, marginBottom: 32 }}>
        {taskCategories.map((cat) => (
          <div
            key={cat.title}
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 12,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                background: cat.bg,
                padding: '20px',
                borderBottom: `2px solid ${cat.color}20`,
              }}
            >
              <div style={{ fontSize: 28, marginBottom: 8 }}>{cat.icon}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: cat.color }}>{cat.title}</div>
              <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>{cat.description}</div>
            </div>
            <div style={{ padding: '16px 20px' }}>
              <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600, marginBottom: 10, textTransform: 'uppercase' }}>
                דוגמאות
              </div>
              {cat.items.map((item) => (
                <div
                  key={item}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '7px 0',
                    borderBottom: '1px solid #f8fafc',
                    fontSize: 13,
                    color: '#374151',
                  }}
                >
                  <span style={{ color: cat.color, fontSize: 16 }}>✓</span>
                  {item}
                </div>
              ))}
              <button
                disabled
                style={{
                  marginTop: 14,
                  width: '100%',
                  padding: '9px',
                  background: '#f1f5f9',
                  border: 'none',
                  borderRadius: 7,
                  color: '#94a3b8',
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: 'not-allowed',
                }}
              >
                + הוסף משימה (בקרוב)
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Daily dynamic task section */}
      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ fontWeight: 600, fontSize: 15, color: '#0f172a' }}>משימת היום הדינמית</div>
            <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>
              משימה מיוחדת שניתן לשנות בכל עת — מוצגת לכל המשתתפות
            </div>
          </div>
          <span
            style={{
              background: '#f1f5f9',
              color: '#94a3b8',
              padding: '4px 12px',
              borderRadius: 20,
              fontSize: 12,
              fontWeight: 500,
            }}
          >
            בקרוב
          </span>
        </div>
        <div style={{ padding: '32px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>✨</div>
          <div style={{ color: '#374151', fontSize: 15, fontWeight: 500 }}>
            כאן תוכלי להגדיר משימה מיוחדת לכל יום
          </div>
          <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 6 }}>
            המשימה תוצג לכל המשתתפות בדף האישי ובהודעות הווטסאפ
          </div>
        </div>
      </div>
    </div>
  );
}
