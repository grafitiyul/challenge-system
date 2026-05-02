'use client';

// ProfileTab — admin configuration for the participant-facing
// "פרטים אישיים" tab. The participant portal will only render this tab
// when program.profileTabEnabled === true; until then this admin screen
// is the only consumer of the new ProgramProfileField table.
//
// Capabilities:
//   - toggle profileTabEnabled (default false; flipping it true exposes
//     the tab to participants once the portal UI ships)
//   - list configured fields, sorted by sortOrder
//   - add field (system or custom), edit label/helper/required/active,
//     reorder via ↑ / ↓, soft-delete (isActive=false)
//   - "הוסף שדות בסיסיים למשחק" applies the Game Changer preset (upsert)

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BASE_URL, apiFetch } from '@lib/api';
import { StrongModal } from '@components/strong-modal';

const FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'image', 'imageGallery'] as const;
type FieldType = (typeof FIELD_TYPES)[number];

const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  text:         'טקסט קצר',
  textarea:     'טקסט ארוך',
  number:       'מספר',
  date:         'תאריך',
  image:        'תמונה אחת',
  imageGallery: 'גלריית תמונות',
};

// System-field metadata mirrors the API's SYSTEM_FIELD_META. Each key
// maps 1:1 to a Participant column; the API enforces the field type so
// the UI just locks the type on the modal.
const SYSTEM_FIELDS: Array<{ key: string; defaultLabel: string; fieldType: FieldType }> = [
  { key: 'firstName',       defaultLabel: 'שם פרטי',     fieldType: 'text' },
  { key: 'lastName',        defaultLabel: 'שם משפחה',    fieldType: 'text' },
  { key: 'phoneNumber',     defaultLabel: 'טלפון',       fieldType: 'text' },
  { key: 'email',           defaultLabel: 'אימייל',      fieldType: 'text' },
  { key: 'birthDate',       defaultLabel: 'תאריך לידה',  fieldType: 'date' },
  { key: 'city',            defaultLabel: 'עיר',         fieldType: 'text' },
  { key: 'profileImageUrl', defaultLabel: 'תמונת פרופיל', fieldType: 'image' },
];

interface Field {
  id: string;
  programId: string;
  fieldKey: string;
  label: string;
  helperText: string | null;
  fieldType: FieldType;
  isRequired: boolean;
  sortOrder: number;
  isSystemField: boolean;
  isActive: boolean;
}

interface Props {
  programId: string;
  profileTabEnabled: boolean;
  onProfileTabEnabledChanged: (next: boolean) => void;
}

export function ProfileTab({ programId, profileTabEnabled, onProfileTabEnabledChanged }: Props) {
  const [fields, setFields] = useState<Field[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState<Field | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [presetBusy, setPresetBusy] = useState(false);
  const [toggleBusy, setToggleBusy] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    apiFetch<Field[]>(
      `${BASE_URL}/programs/${programId}/profile-fields?includeInactive=true`,
      { cache: 'no-store' },
    )
      .then((rows) => { setFields(rows); setErr(''); })
      .catch((e) => setErr(e instanceof Error ? e.message : 'טעינה נכשלה'))
      .finally(() => setLoading(false));
  }, [programId]);

  useEffect(() => { reload(); }, [reload]);

  const visibleFields = useMemo(
    () => [...fields].sort((a, b) => a.sortOrder - b.sortOrder),
    [fields],
  );

  async function toggleEnabled(next: boolean) {
    setToggleBusy(true);
    try {
      await apiFetch(`${BASE_URL}/programs/${programId}`, {
        method: 'PATCH',
        body: JSON.stringify({ profileTabEnabled: next }),
      });
      onProfileTabEnabledChanged(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'שמירה נכשלה');
    } finally {
      setToggleBusy(false);
    }
  }

  async function applyPreset() {
    setPresetBusy(true);
    setErr('');
    try {
      const rows = await apiFetch<Field[]>(
        `${BASE_URL}/programs/${programId}/profile-fields/preset/game-changer`,
        { method: 'POST' },
      );
      setFields(rows);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'הפעלת תבנית נכשלה');
    } finally {
      setPresetBusy(false);
    }
  }

  async function deactivate(id: string) {
    try {
      await apiFetch(`${BASE_URL}/programs/${programId}/profile-fields/${id}`, { method: 'DELETE' });
      reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'הסרה נכשלה');
    }
  }

  async function moveField(id: string, direction: -1 | 1) {
    const list = visibleFields;
    const idx = list.findIndex((f) => f.id === id);
    const swapWith = list[idx + direction];
    if (idx < 0 || !swapWith) return;
    const items = [
      { id, sortOrder: swapWith.sortOrder },
      { id: swapWith.id, sortOrder: list[idx].sortOrder },
    ];
    try {
      await apiFetch(`${BASE_URL}/programs/${programId}/profile-fields/reorder`, {
        method: 'PATCH',
        body: JSON.stringify({ items }),
      });
      reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'סידור נכשל');
    }
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '0 0 10px 10px', padding: 24 }}>
      {/* Feature flag toggle */}
      <div
        style={{
          background: profileTabEnabled ? '#f0fdf4' : '#fef9c3',
          border: `1px solid ${profileTabEnabled ? '#bbf7d0' : '#fde68a'}`,
          borderRadius: 10, padding: '14px 16px', marginBottom: 20,
          display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginBottom: 2 }}>
            הצגת הלשונית למשתתפות
          </div>
          <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.5 }}>
            {profileTabEnabled
              ? 'הלשונית "פרטים אישיים" מוצגת למשתתפות בפורטל. ניתן לכבות בכל עת.'
              : 'הלשונית מוסתרת מהמשתתפות. הגדירי שדות, ולאחר מכן הפעילי את התצוגה.'}
          </div>
        </div>
        <button
          onClick={() => toggleEnabled(!profileTabEnabled)}
          disabled={toggleBusy}
          style={{
            padding: '8px 16px', fontSize: 13, fontWeight: 700,
            background: profileTabEnabled ? '#fff' : '#16a34a',
            color: profileTabEnabled ? '#b91c1c' : '#fff',
            border: `1px solid ${profileTabEnabled ? '#fecaca' : '#16a34a'}`,
            borderRadius: 8, cursor: toggleBusy ? 'not-allowed' : 'pointer',
          }}
        >
          {toggleBusy ? '...' : profileTabEnabled ? 'הסתר מהמשתתפות' : 'הפעל למשתתפות'}
        </button>
      </div>

      {/* Action row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0 }}>
          שדות בלשונית ({fields.filter((f) => f.isActive).length} פעילים)
        </h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={applyPreset}
            disabled={presetBusy}
            title="יוצר/מעדכן את שדות הבסיס למשחק (תמונה, מטרה, משקל, היקפים, תמונות לפני, עיר). לא יוצר כפילויות."
            style={{
              padding: '8px 14px', fontSize: 13, fontWeight: 600,
              background: '#eff6ff', color: '#1d4ed8',
              border: '1px solid #bfdbfe', borderRadius: 8,
              cursor: presetBusy ? 'not-allowed' : 'pointer',
            }}
          >
            {presetBusy ? 'מחיל...' : '⚡ הוסף שדות בסיסיים למשחק'}
          </button>
          <button
            onClick={() => setAddOpen(true)}
            style={{
              padding: '8px 14px', fontSize: 13, fontWeight: 700,
              background: '#2563eb', color: '#fff',
              border: 'none', borderRadius: 8, cursor: 'pointer',
            }}
          >
            + הוסף שדה
          </button>
        </div>
      </div>

      {err && <div style={{ color: '#b91c1c', fontSize: 13, marginBottom: 12 }}>{err}</div>}

      {loading ? (
        <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8' }}>טוען...</div>
      ) : visibleFields.length === 0 ? (
        <div style={{ background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: 10, padding: 28, textAlign: 'center', color: '#64748b' }}>
          אין שדות מוגדרים. הוסיפי שדה ראשון או הפעילי תבנית מוכנה.
        </div>
      ) : (
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
          {visibleFields.map((f, idx) => (
            <FieldRow
              key={f.id}
              field={f}
              isFirst={idx === 0}
              isLast={idx === visibleFields.length - 1}
              onEdit={() => setEditing(f)}
              onDeactivate={() => deactivate(f.id)}
              onMoveUp={() => moveField(f.id, -1)}
              onMoveDown={() => moveField(f.id, +1)}
            />
          ))}
        </div>
      )}

      {addOpen && (
        <FieldEditorModal
          mode="create"
          programId={programId}
          existingKeys={new Set(fields.map((f) => f.fieldKey))}
          onClose={() => setAddOpen(false)}
          onSaved={() => { setAddOpen(false); reload(); }}
        />
      )}
      {editing && (
        <FieldEditorModal
          mode="edit"
          programId={programId}
          field={editing}
          existingKeys={new Set(fields.map((f) => f.fieldKey))}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
    </div>
  );
}

// ─── Field row ─────────────────────────────────────────────────────────────

function FieldRow(props: {
  field: Field;
  isFirst: boolean;
  isLast: boolean;
  onEdit: () => void;
  onDeactivate: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const { field, isFirst, isLast, onEdit, onDeactivate, onMoveUp, onMoveDown } = props;
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 14px',
        background: field.isActive ? '#fff' : '#f8fafc',
        borderBottom: '1px solid #f1f5f9',
        opacity: field.isActive ? 1 : 0.6,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <button
          onClick={onMoveUp}
          disabled={isFirst}
          aria-label="הזז למעלה"
          style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 11, padding: '1px 5px', cursor: isFirst ? 'not-allowed' : 'pointer', color: '#64748b' }}
        >▲</button>
        <button
          onClick={onMoveDown}
          disabled={isLast}
          aria-label="הזז למטה"
          style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 11, padding: '1px 5px', cursor: isLast ? 'not-allowed' : 'pointer', color: '#64748b' }}
        >▼</button>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 2 }}>
          <span style={{ fontWeight: 700, color: '#0f172a' }}>{field.label}</span>
          <span style={{ background: '#f1f5f9', color: '#475569', padding: '1px 8px', fontSize: 11, borderRadius: 999 }}>
            {FIELD_TYPE_LABEL[field.fieldType] ?? field.fieldType}
          </span>
          {field.isSystemField && (
            <span style={{ background: '#eef2ff', color: '#4338ca', padding: '1px 8px', fontSize: 11, borderRadius: 999, fontWeight: 600 }}>
              שדה מערכת
            </span>
          )}
          {field.isRequired && (
            <span style={{ background: '#fee2e2', color: '#b91c1c', padding: '1px 8px', fontSize: 11, borderRadius: 999 }}>
              חובה
            </span>
          )}
          {!field.isActive && (
            <span style={{ background: '#f1f5f9', color: '#94a3b8', padding: '1px 8px', fontSize: 11, borderRadius: 999 }}>
              לא פעיל
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: '#64748b' }}>
          <span dir="ltr" style={{ fontFamily: 'monospace' }}>{field.fieldKey}</span>
          {field.helperText && <span> · {field.helperText}</span>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={onEdit}
          style={{ padding: '5px 12px', fontSize: 12, color: '#1d4ed8', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 6, cursor: 'pointer' }}
        >ערוך</button>
        {field.isActive && (
          <button
            onClick={onDeactivate}
            style={{ padding: '5px 12px', fontSize: 12, color: '#b91c1c', background: '#fff', border: '1px solid #fecaca', borderRadius: 6, cursor: 'pointer' }}
          >השבת</button>
        )}
      </div>
    </div>
  );
}

// ─── Editor modal (create + edit) ─────────────────────────────────────────

function FieldEditorModal(props: {
  mode: 'create' | 'edit';
  programId: string;
  field?: Field;
  existingKeys: Set<string>;
  onClose: () => void;
  onSaved: () => void;
}) {
  // create-mode picker: system field vs custom field. edit-mode is locked
  // to whatever the existing row already is — fieldKey + isSystemField
  // are immutable on the server (changing them would silently rebind
  // values to a different target).
  const i_origin: 'system' | 'custom' = props.field?.isSystemField ? 'system' : 'custom';
  const i_systemKey = props.field?.isSystemField ? props.field.fieldKey : 'firstName';
  const i_customKey = props.field && !props.field.isSystemField ? props.field.fieldKey : '';
  const i_label = props.field?.label ?? '';
  const i_helperText = props.field?.helperText ?? '';
  const i_fieldType: FieldType = props.field?.fieldType ?? 'text';
  const i_isRequired = props.field?.isRequired ?? false;
  const i_isActive = props.field?.isActive ?? true;

  const [origin, setOrigin] = useState<'system' | 'custom'>(i_origin);
  const [systemKey, setSystemKey] = useState<string>(i_systemKey);
  const [customKey, setCustomKey] = useState<string>(i_customKey);
  const [label, setLabel] = useState(i_label);
  const [helperText, setHelperText] = useState(i_helperText);
  const [fieldType, setFieldType] = useState<FieldType>(i_fieldType);
  const [isRequired, setIsRequired] = useState(i_isRequired);
  const [isActive, setIsActive] = useState(i_isActive);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const isDirty =
    origin !== i_origin ||
    systemKey !== i_systemKey ||
    customKey !== i_customKey ||
    label !== i_label ||
    helperText !== i_helperText ||
    fieldType !== i_fieldType ||
    isRequired !== i_isRequired ||
    isActive !== i_isActive;

  // When in create mode + system origin, lock fieldType to the system
  // metadata. Auto-fill the label if the admin hasn't typed one.
  useEffect(() => {
    if (props.mode !== 'create') return;
    if (origin !== 'system') return;
    const meta = SYSTEM_FIELDS.find((s) => s.key === systemKey);
    if (!meta) return;
    setFieldType(meta.fieldType);
    setLabel((prev) => prev || meta.defaultLabel);
  }, [origin, systemKey, props.mode]);

  const isCreate = props.mode === 'create';
  const isLockedSystem = !isCreate && props.field?.isSystemField;

  async function save() {
    setErr('');
    if (!label.trim()) { setErr('יש להזין תווית'); return; }
    let body: Record<string, unknown> = {
      label: label.trim(),
      helperText: helperText.trim() || null,
      isRequired,
      isActive,
    };

    if (isCreate) {
      const fieldKey = origin === 'system' ? systemKey : customKey.trim();
      if (!fieldKey) { setErr('יש להזין מפתח לשדה'); return; }
      if (origin === 'custom' && !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(fieldKey)) {
        setErr('מפתח שדה: אותיות לטיניות, ספרות וקו תחתון בלבד');
        return;
      }
      if (props.existingKeys.has(fieldKey)) {
        setErr(`השדה "${fieldKey}" כבר קיים בתוכנית זו`);
        return;
      }
      body = {
        ...body,
        fieldKey,
        isSystemField: origin === 'system',
        // For custom fields the user picks a type. For system fields the
        // server enforces the right type, but we send what the user saw.
        fieldType,
      };
    } else {
      // Edit mode — only mutable fields go up.
      body.fieldType = fieldType;
    }

    setBusy(true);
    try {
      const url = isCreate
        ? `${BASE_URL}/programs/${props.programId}/profile-fields`
        : `${BASE_URL}/programs/${props.programId}/profile-fields/${props.field!.id}`;
      await apiFetch(url, { method: isCreate ? 'POST' : 'PATCH', body: JSON.stringify(body) });
      props.onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'שמירה נכשלה');
    } finally {
      setBusy(false);
    }
  }

  const input: React.CSSProperties = {
    width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0',
    borderRadius: 8, fontSize: 14, background: '#fff', boxSizing: 'border-box', fontFamily: 'inherit',
  };
  const label_: React.CSSProperties = {
    display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4,
  };

  return (
    <StrongModal
      title={isCreate ? 'הוסף שדה לפרופיל' : `ערוך שדה: ${props.field!.label}`}
      isDirty={isDirty}
      onClose={props.onClose}
      busy={busy}
      maxWidth={480}
      zIndex={1100}
    >
      {({ attemptClose }) => (
      <>
        <div style={{ display: 'grid', gap: 12 }}>
          {isCreate && (
            <div>
              <label style={label_}>סוג שדה</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setOrigin('system')}
                  style={{
                    flex: 1, padding: '8px 12px', borderRadius: 8,
                    border: `1px solid ${origin === 'system' ? '#2563eb' : '#e2e8f0'}`,
                    background: origin === 'system' ? '#eff6ff' : '#fff',
                    color: origin === 'system' ? '#1d4ed8' : '#374151',
                    fontWeight: 600, fontSize: 13, cursor: 'pointer',
                  }}
                >שדה מערכת (מתחבר לפרופיל)</button>
                <button
                  type="button"
                  onClick={() => setOrigin('custom')}
                  style={{
                    flex: 1, padding: '8px 12px', borderRadius: 8,
                    border: `1px solid ${origin === 'custom' ? '#2563eb' : '#e2e8f0'}`,
                    background: origin === 'custom' ? '#eff6ff' : '#fff',
                    color: origin === 'custom' ? '#1d4ed8' : '#374151',
                    fontWeight: 600, fontSize: 13, cursor: 'pointer',
                  }}
                >שדה מותאם אישית</button>
              </div>
              <p style={{ fontSize: 11, color: '#64748b', margin: '6px 2px 0', lineHeight: 1.5 }}>
                שדות מערכת (שם, אימייל, טלפון, תמונת פרופיל וכו׳) מתעדכנים ישירות על פרופיל המשתתפת. שדות מותאמים נשמרים בנפרד פר-תוכנית.
              </p>
            </div>
          )}

          {isCreate && origin === 'system' && (
            <div>
              <label style={label_}>בחירת שדה מערכת</label>
              <select style={input} value={systemKey} onChange={(e) => setSystemKey(e.target.value)}>
                {SYSTEM_FIELDS.map((s) => (
                  <option key={s.key} value={s.key}>{s.defaultLabel} ({s.key})</option>
                ))}
              </select>
            </div>
          )}

          {isCreate && origin === 'custom' && (
            <div>
              <label style={label_}>מפתח שדה (אנגלית)</label>
              <input
                style={input}
                dir="ltr"
                placeholder="personalGoal"
                value={customKey}
                onChange={(e) => setCustomKey(e.target.value)}
              />
              <p style={{ fontSize: 11, color: '#64748b', margin: '4px 2px 0' }}>
                מזהה לקוד. משתמש באותיות לטיניות, ספרות וקו תחתון בלבד.
              </p>
            </div>
          )}

          {!isCreate && (
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#475569' }}>
              <div>
                <strong>מפתח:</strong>{' '}
                <span dir="ltr" style={{ fontFamily: 'monospace' }}>{props.field!.fieldKey}</span>
                {isLockedSystem && <span style={{ marginInlineStart: 8, color: '#4338ca' }}>(שדה מערכת)</span>}
              </div>
              <div style={{ marginTop: 4 }}>לא ניתן לשנות מפתח / סוג מקור — כדי למנוע איבוד נתונים קיימים. אם צריך, השביתי שדה זה והוסיפי חדש.</div>
            </div>
          )}

          <div>
            <label style={label_}>תווית (לתצוגה למשתתפת)</label>
            <input style={input} value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>

          <div>
            <label style={label_}>טקסט הסבר (אופציונלי)</label>
            <textarea
              style={{ ...input, minHeight: 60, resize: 'vertical' }}
              value={helperText}
              onChange={(e) => setHelperText(e.target.value)}
            />
          </div>

          <div>
            <label style={label_}>סוג נתון</label>
            <select
              style={input}
              value={fieldType}
              onChange={(e) => setFieldType(e.target.value as FieldType)}
              disabled={isCreate && origin === 'system'}
            >
              {FIELD_TYPES.map((t) => <option key={t} value={t}>{FIELD_TYPE_LABEL[t]}</option>)}
            </select>
            {isCreate && origin === 'system' && (
              <p style={{ fontSize: 11, color: '#64748b', margin: '4px 2px 0' }}>
                סוג הנתון נקבע על ידי המערכת לשדה זה.
              </p>
            )}
          </div>

          <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <input type="checkbox" checked={isRequired} onChange={(e) => setIsRequired(e.target.checked)} />
              שדה חובה
            </label>
            {!isCreate && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                פעיל
              </label>
            )}
          </div>

          {err && <div style={{ color: '#b91c1c', fontSize: 13 }}>{err}</div>}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
          <button onClick={attemptClose} disabled={busy} style={{ padding: '8px 16px', background: '#f1f5f9', border: '1px solid #e2e8f0', color: '#374151', borderRadius: 8, fontSize: 13, cursor: busy ? 'not-allowed' : 'pointer' }}>
            ביטול
          </button>
          <button
            onClick={save}
            disabled={busy}
            style={{ padding: '8px 18px', background: busy ? '#93c5fd' : '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer' }}
          >
            {busy ? 'שומר...' : isCreate ? 'הוסף' : 'שמור'}
          </button>
        </div>
      </>
      )}
    </StrongModal>
  );
}
