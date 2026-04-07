'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BASE_URL } from '@lib/api';

interface QuestionnaireTemplate {
  id: string;
  internalName: string;
  publicTitle: string;
  usageType: string;
  submitBehavior: string;
  isActive: boolean;
  createdAt: string;
  _count?: { questions: number; submissions: number };
}

interface CreateForm {
  internalName: string;
  publicTitle: string;
  usageType: string;
  submitBehavior: string;
}

const EMPTY_FORM: CreateForm = {
  internalName: '',
  publicTitle: '',
  usageType: 'both',
  submitBehavior: 'none',
};

const USAGE_LABELS: Record<string, string> = {
  internal: 'פנימי',
  external: 'חיצוני',
  both: 'שניהם',
};

const BEHAVIOR_LABELS: Record<string, string> = {
  none: 'שמירה בלבד',
  create_new_participant: 'יצירת משתתפת',
  attach_or_create: 'שיוך / יצירה',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  border: '1px solid #cbd5e1',
  borderRadius: 7,
  fontSize: 14,
  color: '#0f172a',
  background: '#ffffff',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: '#374151',
  marginBottom: 5,
  display: 'block',
};

function ConfirmModal({ title, message, confirmLabel = 'אישור', danger = false, onConfirm, onClose }: {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 20 }}
    >
      <div style={{ background: '#fff', borderRadius: 12, padding: 24, width: '100%', maxWidth: 400, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: '0 0 10px' }}>{title}</h3>
        <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 20px', lineHeight: 1.6 }}>{message}</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>ביטול</button>
          <button onClick={onConfirm} style={{ background: danger ? '#dc2626' : '#2563eb', color: '#fff', border: 'none', borderRadius: 7, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

function Badge({ text, color }: { text: string; color: 'blue' | 'purple' | 'gray' | 'red' }) {
  const styles: Record<string, React.CSSProperties> = {
    blue: { background: '#eff6ff', color: '#1d4ed8' },
    purple: { background: '#f5f3ff', color: '#6d28d9' },
    gray: { background: '#f1f5f9', color: '#64748b' },
    red: { background: '#fef2f2', color: '#dc2626' },
  };
  return (
    <span style={{ ...styles[color], padding: '2px 10px', borderRadius: 20, fontSize: 12, fontWeight: 500 }}>
      {text}
    </span>
  );
}

export default function QuestionnairesPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<QuestionnaireTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<QuestionnaireTemplate | null>(null);

  async function handleDelete(t: QuestionnaireTemplate) {
    await fetch(`${BASE_URL}/questionnaires/${t.id}`, {
      method: 'DELETE',
    });
    setTemplates((prev) => prev.filter((x) => x.id !== t.id));
    setDeleteTarget(null);
  }

  useEffect(() => {
    fetch(`${BASE_URL}/questionnaires`)
      .then((r) => r.json())
      .then((data: unknown) => setTemplates(data as QuestionnaireTemplate[]))
      .catch(() => setTemplates([]))
      .finally(() => setLoading(false));
  }, []);

  function openModal() {
    setForm(EMPTY_FORM);
    setFormError('');
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
  }

  function setField(field: keyof CreateForm, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.internalName.trim()) { setFormError('שם פנימי הוא שדה חובה'); return; }
    if (!form.publicTitle.trim()) { setFormError('כותרת ציבורית היא שדה חובה'); return; }
    setFormError('');
    setSubmitting(true);
    try {
      const res = await fetch(`${BASE_URL}/questionnaires`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) { setFormError('שגיאה ביצירת השאלון'); return; }
      const created = await res.json() as QuestionnaireTemplate;
      router.push(`/questionnaires/${created.id}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page-wrapper">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', margin: 0 }}>שאלונים</h1>
          <p style={{ color: '#64748b', fontSize: 14, marginTop: 4, marginBottom: 0 }}>
            בנאי שאלונים דינמי — כל שאלון נשלט מהממשק
          </p>
        </div>
        <button
          onClick={openModal}
          style={{
            background: '#2563eb',
            color: '#ffffff',
            border: 'none',
            borderRadius: 8,
            padding: '10px 20px',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          + צור שאלון חדש
        </button>
      </div>

      {/* Table */}
      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#64748b' }}>
            {loading ? 'טוען...' : `${templates.length} שאלונים`}
          </span>
        </div>

        {!loading && templates.length === 0 && (
          <div style={{ padding: '48px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
            <div style={{ color: '#374151', fontSize: 16, fontWeight: 500, marginBottom: 6 }}>אין שאלונים עדיין</div>
            <div style={{ color: '#94a3b8', fontSize: 14 }}>לחצי על &quot;צור שאלון חדש&quot; כדי להתחיל</div>
          </div>
        )}

        {templates.map((t, i) => (
          <div
            key={t.id}
            style={{
              padding: '16px 20px',
              borderBottom: i < templates.length - 1 ? '1px solid #f1f5f9' : 'none',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#0f172a', marginBottom: 4 }}>
                {t.internalName}
              </div>
              <div style={{ fontSize: 13, color: '#64748b', marginBottom: 6 }}>{t.publicTitle}</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Badge text={USAGE_LABELS[t.usageType] ?? t.usageType} color="blue" />
                <Badge text={BEHAVIOR_LABELS[t.submitBehavior] ?? t.submitBehavior} color="purple" />
                {t._count && (
                  <>
                    <Badge text={`${t._count.questions} שאלות`} color="gray" />
                    <Badge text={`${t._count.submissions} מענים`} color="gray" />
                  </>
                )}
                {!t.isActive && <Badge text="לא פעיל" color="red" />}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button
                onClick={() => router.push(`/questionnaires/${t.id}`)}
                style={{ background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 7, padding: '7px 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                ערוך
              </button>
              <button
                onClick={() => setDeleteTarget(t)}
                style={{ background: 'none', border: '1px solid #fecaca', color: '#dc2626', borderRadius: 7, padding: '7px 12px', fontSize: 13, cursor: 'pointer' }}
                title="מחק שאלון"
              >
                מחק
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Create modal */}
      {modalOpen && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}
        >
          <div style={{ background: '#fff', borderRadius: 14, padding: 28, width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: 0 }}>שאלון חדש</h2>
              <button onClick={closeModal} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#94a3b8', lineHeight: 1 }}>×</button>
            </div>

            <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={labelStyle}>שם פנימי *</label>
                <input
                  style={inputStyle}
                  value={form.internalName}
                  onChange={(e) => setField('internalName', e.target.value)}
                  placeholder="לדוגמה: שאלון מיון ראשוני"
                  autoFocus
                />
              </div>
              <div>
                <label style={labelStyle}>כותרת ציבורית *</label>
                <input
                  style={inputStyle}
                  value={form.publicTitle}
                  onChange={(e) => setField('publicTitle', e.target.value)}
                  placeholder="לדוגמה: ספרי לנו קצת על עצמך"
                />
              </div>
              <div>
                <label style={labelStyle}>סוג שימוש</label>
                <select style={inputStyle} value={form.usageType} onChange={(e) => setField('usageType', e.target.value)}>
                  <option value="both">שניהם (פנימי + חיצוני)</option>
                  <option value="internal">פנימי בלבד</option>
                  <option value="external">חיצוני בלבד</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>התנהגות בעת שליחה</label>
                <select style={inputStyle} value={form.submitBehavior} onChange={(e) => setField('submitBehavior', e.target.value)}>
                  <option value="none">שמירת מענה בלבד</option>
                  <option value="create_new_participant">יצירת משתתפת חדשה</option>
                  <option value="attach_or_create">שיוך למשתתפת קיימת / יצירה</option>
                </select>
              </div>

              {formError && (
                <div style={{ color: '#dc2626', fontSize: 13, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '8px 12px' }}>
                  {formError}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
                <button type="button" onClick={closeModal} style={{ background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 7, padding: '9px 18px', fontSize: 13, cursor: 'pointer' }}>
                  ביטול
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  style={{ background: submitting ? '#93c5fd' : '#2563eb', color: '#ffffff', border: 'none', borderRadius: 7, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: submitting ? 'not-allowed' : 'pointer' }}
                >
                  {submitting ? 'יוצר...' : 'צור ועבור לעריכה'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteTarget && (
        <ConfirmModal
          title="מחיקת שאלון"
          message={`השאלון "${deleteTarget.internalName}" יוסר מהמערכת, אך תשובות קיימות לא יימחקו.`}
          confirmLabel="מחק שאלון"
          danger
          onConfirm={() => handleDelete(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
