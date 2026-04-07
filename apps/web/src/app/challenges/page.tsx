'use client';

import { useEffect, useState } from 'react';
import { BASE_URL, apiFetch } from '@lib/api';

interface ChallengeType {
  id: string;
  name: string;
}

interface Challenge {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  challengeType: ChallengeType;
}

interface Group {
  id: string;
  name: string;
  challengeId: string;
  startDate: string;
  endDate: string;
}

interface ChallengeFormState {
  name: string;
  challengeTypeId: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
}

interface Gender {
  id: string;
  name: string;
}

interface Participant {
  id: string;
  firstName: string;
  lastName?: string | null;
  phoneNumber: string;
  gender: Gender;
  isMock: boolean;
}

function displayName(p: { firstName: string; lastName?: string | null }): string {
  return [p.firstName, p.lastName].filter(Boolean).join(' ');
}

interface GroupFormState {
  name: string;
  startDate: string;
  endDate: string;
}

interface ParticipantFormState {
  firstName: string;
  lastName: string;
  phoneNumber: string;
  genderId: string;
}

const emptyChallengeForm: ChallengeFormState = {
  name: '',
  challengeTypeId: '',
  startDate: '',
  endDate: '',
  isActive: true,
};

const emptyGroupForm: GroupFormState = { name: '', startDate: '', endDate: '' };
const emptyParticipantForm: ParticipantFormState = { firstName: '', lastName: '', phoneNumber: '', genderId: '' };

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('he-IL');
}

export default function ChallengesPage() {
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [challengeTypes, setChallengeTypes] = useState<ChallengeType[]>([]);
  const [genders, setGenders] = useState<Gender[]>([]);
  const [groups, setGroups] = useState<Record<string, Group[]>>({});
  const [participants, setParticipants] = useState<Record<string, Participant[]>>({});
  const [challengeForm, setChallengeForm] = useState<ChallengeFormState>(emptyChallengeForm);
  const [groupForms, setGroupForms] = useState<Record<string, GroupFormState>>({});
  const [participantForms, setParticipantForms] = useState<Record<string, ParticipantFormState>>({});
  const [openGroupFormId, setOpenGroupFormId] = useState<string | null>(null);
  const [openParticipantFormId, setOpenParticipantFormId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [groupSubmitting, setGroupSubmitting] = useState(false);
  const [participantSubmitting, setParticipantSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [participantError, setParticipantError] = useState<string | null>(null);

  const fetchGroupsForChallenge = async (challengeId: string) => {
    try {
      console.log('[API] GET', `${BASE_URL}/groups?challengeId=${challengeId}`);
      const data: unknown = await apiFetch(`${BASE_URL}/groups?challengeId=${challengeId}`);
      const groupList = Array.isArray(data) ? (data as Group[]) : [];
      setGroups((prev) => ({ ...prev, [challengeId]: groupList }));
      await Promise.all(groupList.map((g) => fetchParticipantsForGroup(g.id)));
    } catch {
      setGroups((prev) => ({ ...prev, [challengeId]: [] }));
    }
  };

  const fetchParticipantsForGroup = async (groupId: string) => {
    try {
      const includeMock = localStorage.getItem('showMockParticipants') === 'true';
      console.log('[API] GET', `${BASE_URL}/participants?groupId=${groupId}&includeMock=${includeMock}`);
      const data: unknown = await apiFetch(`${BASE_URL}/participants?groupId=${groupId}&includeMock=${includeMock}`);
      setParticipants((prev) => ({ ...prev, [groupId]: Array.isArray(data) ? (data as Participant[]) : [] }));
    } catch {
      setParticipants((prev) => ({ ...prev, [groupId]: [] }));
    }
  };

  useEffect(() => {
    const init = async () => {
      try {
        console.log('[API] GET', `${BASE_URL}/challenges`, `${BASE_URL}/challenge-types`, `${BASE_URL}/genders`);
        const [challengesData, typesData, gendersData] = await Promise.all([
          apiFetch(`${BASE_URL}/challenges`),
          apiFetch(`${BASE_URL}/challenge-types`),
          apiFetch(`${BASE_URL}/genders`),
        ]) as [Challenge[], ChallengeType[], Gender[]];
        setChallenges(challengesData);
        setChallengeTypes(typesData);
        setGenders(Array.isArray(gendersData) ? gendersData : []);
        if (typesData.length > 0) {
          setChallengeForm((prev) => ({ ...prev, challengeTypeId: typesData[0].id }));
        }
        await Promise.all(challengesData.map((c) => fetchGroupsForChallenge(c.id)));
      } catch {
        setError('שגיאה בטעינת הנתונים. ודא שהשרת פועל.');
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  const handleChallengeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      console.log('[API] POST', `${BASE_URL}/challenges`);
      const newChallenge = await apiFetch(`${BASE_URL}/challenges`, {
        method: 'POST',
        body: JSON.stringify(challengeForm),
      }) as Challenge;
      setChallengeForm({ ...emptyChallengeForm, challengeTypeId: challengeForm.challengeTypeId });
      setChallenges((prev) => [newChallenge, ...prev]);
      setGroups((prev) => ({ ...prev, [newChallenge.id]: [] }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה לא ידועה');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGroupSubmit = async (challengeId: string, e: React.FormEvent) => {
    e.preventDefault();
    const form = groupForms[challengeId] ?? emptyGroupForm;
    setGroupSubmitting(true);
    setGroupError(null);
    try {
      console.log('[API] POST', `${BASE_URL}/groups`);
      await apiFetch(`${BASE_URL}/groups`, {
        method: 'POST',
        body: JSON.stringify({ ...form, challengeId }),
      });
      setGroupForms((prev) => ({ ...prev, [challengeId]: emptyGroupForm }));
      setOpenGroupFormId(null);
      await fetchGroupsForChallenge(challengeId);
    } catch (err) {
      setGroupError(err instanceof Error ? err.message : 'שגיאה לא ידועה');
    } finally {
      setGroupSubmitting(false);
    }
  };

  const toggleGroupForm = (challengeId: string) => {
    setGroupError(null);
    setOpenGroupFormId((prev) => (prev === challengeId ? null : challengeId));
    if (!groupForms[challengeId]) {
      setGroupForms((prev) => ({ ...prev, [challengeId]: emptyGroupForm }));
    }
  };

  const toggleParticipantForm = (groupId: string) => {
    setParticipantError(null);
    setOpenParticipantFormId((prev) => (prev === groupId ? null : groupId));
    if (!participantForms[groupId]) {
      const defaultGenderId = genders.length > 0 ? genders[0].id : '';
      setParticipantForms((prev) => ({ ...prev, [groupId]: { ...emptyParticipantForm, genderId: defaultGenderId } }));
    }
  };

  const handleParticipantSubmit = async (groupId: string, e: React.FormEvent) => {
    e.preventDefault();
    const form = participantForms[groupId] ?? emptyParticipantForm;
    setParticipantSubmitting(true);
    setParticipantError(null);
    try {
      console.log('[API] POST', `${BASE_URL}/participants`);
      await apiFetch(`${BASE_URL}/participants`, {
        method: 'POST',
        body: JSON.stringify({ ...form, groupId }),
      });
      const defaultGenderId = genders.length > 0 ? genders[0].id : '';
      setParticipantForms((prev) => ({ ...prev, [groupId]: { ...emptyParticipantForm, genderId: defaultGenderId } }));
      setOpenParticipantFormId(null);
      await fetchParticipantsForGroup(groupId);
    } catch (err) {
      setParticipantError(err instanceof Error ? err.message : 'שגיאה לא ידועה');
    } finally {
      setParticipantSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '32px 24px', direction: 'rtl', fontFamily: 'Arial, sans-serif' }}>

      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 32, color: '#111827' }}>אתגרים</h1>

      {/* Create challenge form */}
      <section style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 24, marginBottom: 40 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 20, color: '#374151' }}>יצירת אתגר חדש</h2>
        <form onSubmit={handleChallengeSubmit}>
          <div style={{ display: 'grid', gap: 16 }}>
            <label style={labelStyle}>
              שם אתגר
              <input style={inputStyle} type="text" value={challengeForm.name}
                onChange={(e) => setChallengeForm({ ...challengeForm, name: e.target.value })}
                required placeholder="לדוגמה: אתגר כושר - מרץ 2026" />
            </label>

            <label style={labelStyle}>
              סוג אתגר
              <select style={inputStyle} value={challengeForm.challengeTypeId}
                onChange={(e) => setChallengeForm({ ...challengeForm, challengeTypeId: e.target.value })} required>
                {challengeTypes.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <label style={labelStyle}>
                תאריך התחלה
                <input style={inputStyle} type="date" value={challengeForm.startDate}
                  onChange={(e) => setChallengeForm({ ...challengeForm, startDate: e.target.value })} required />
              </label>
              <label style={labelStyle}>
                תאריך סיום
                <input style={inputStyle} type="date" value={challengeForm.endDate}
                  onChange={(e) => setChallengeForm({ ...challengeForm, endDate: e.target.value })} required />
              </label>
            </div>

            <label style={{ ...labelStyle, flexDirection: 'row', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={challengeForm.isActive}
                onChange={(e) => setChallengeForm({ ...challengeForm, isActive: e.target.checked })}
                style={{ width: 16, height: 16 }} />
              פעיל
            </label>
          </div>

          {error && <p style={{ color: '#dc2626', marginTop: 12, fontSize: 14 }}>{error}</p>}
          <button type="submit" disabled={submitting || challengeTypes.length === 0}
            style={btnStyle(submitting || challengeTypes.length === 0)}>
            {submitting ? 'שומר...' : 'צור אתגר'}
          </button>
        </form>
      </section>

      {/* Challenges list */}
      <section>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, color: '#374151' }}>אתגרים קיימים</h2>

        {loading && <p style={{ color: '#9ca3af' }}>טוען...</p>}
        {!loading && challenges.length === 0 && <p style={{ color: '#9ca3af' }}>אין אתגרים עדיין.</p>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {challenges.map((c) => {
            const challengeGroups = Array.isArray(groups[c.id]) ? groups[c.id] : [];
            const isFormOpen = openGroupFormId === c.id;
            const gForm = groupForms[c.id] ?? emptyGroupForm;

            return (
              <div key={c.id} style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>

                {/* Challenge header */}
                <div style={{ background: '#f9fafb', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, color: '#111827' }}>{c.name}</span>
                    <span style={{ color: '#6b7280', fontSize: 13 }}>{c.challengeType.name}</span>
                    <span style={{ color: '#6b7280', fontSize: 13 }}>{formatDate(c.startDate)} — {formatDate(c.endDate)}</span>
                    <span style={{
                      background: c.isActive ? '#dcfce7' : '#f3f4f6',
                      color: c.isActive ? '#16a34a' : '#6b7280',
                      padding: '2px 10px', borderRadius: 20, fontSize: 12,
                    }}>
                      {c.isActive ? 'פעיל' : 'לא פעיל'}
                    </span>
                  </div>
                  <button onClick={() => toggleGroupForm(c.id)} style={smallBtnStyle(isFormOpen)}>
                    {isFormOpen ? 'ביטול' : '+ צור קבוצה'}
                  </button>
                </div>

                {/* Create group form */}
                {isFormOpen && (
                  <div style={{ padding: '16px 20px', borderBottom: '1px solid #e5e7eb', background: '#fffbeb' }}>
                    <form onSubmit={(e) => handleGroupSubmit(c.id, e)}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, alignItems: 'end' }}>
                        <label style={labelStyle}>
                          שם קבוצה
                          <input style={inputStyle} type="text" value={gForm.name} required
                            onChange={(e) => setGroupForms((prev) => ({ ...prev, [c.id]: { ...gForm, name: e.target.value } }))}
                            placeholder="לדוגמה: קבוצה א׳" />
                        </label>
                        <label style={labelStyle}>
                          תאריך התחלה
                          <input style={inputStyle} type="date" value={gForm.startDate} required
                            onChange={(e) => setGroupForms((prev) => ({ ...prev, [c.id]: { ...gForm, startDate: e.target.value } }))} />
                        </label>
                        <label style={labelStyle}>
                          תאריך סיום
                          <input style={inputStyle} type="date" value={gForm.endDate} required
                            onChange={(e) => setGroupForms((prev) => ({ ...prev, [c.id]: { ...gForm, endDate: e.target.value } }))} />
                        </label>
                      </div>
                      {groupError && <p style={{ color: '#dc2626', fontSize: 13, marginTop: 8 }}>{groupError}</p>}
                      <button type="submit" disabled={groupSubmitting}
                        style={{ ...btnStyle(groupSubmitting), marginTop: 12 }}>
                        {groupSubmitting ? 'שומר...' : 'צור קבוצה'}
                      </button>
                    </form>
                  </div>
                )}

                {/* Groups list */}
                <div style={{ padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {challengeGroups.length === 0 ? (
                    <p style={{ color: '#9ca3af', fontSize: 13, margin: 0 }}>אין קבוצות עדיין.</p>
                  ) : (
                    challengeGroups.map((g) => {
                      const groupParticipants = Array.isArray(participants[g.id]) ? participants[g.id] : [];
                      const isPFormOpen = openParticipantFormId === g.id;
                      const pForm = participantForms[g.id] ?? { ...emptyParticipantForm, genderId: genders[0]?.id ?? '' };

                      return (
                        <div key={g.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>

                          {/* Group header */}
                          <div style={{ background: '#f3f4f6', padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                            <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                              <span style={{ fontWeight: 600, fontSize: 14, color: '#111827' }}>{g.name}</span>
                              <span style={{ color: '#6b7280', fontSize: 12 }}>{formatDate(g.startDate)} — {formatDate(g.endDate)}</span>
                              <span style={{ color: '#6b7280', fontSize: 12 }}>{groupParticipants.length} משתתפות</span>
                            </div>
                            <button onClick={() => toggleParticipantForm(g.id)} style={smallBtnStyle(isPFormOpen)}>
                              {isPFormOpen ? 'ביטול' : '+ הוסף משתתפת'}
                            </button>
                          </div>

                          {/* Add participant form */}
                          {isPFormOpen && (
                            <div style={{ padding: '14px 16px', borderBottom: '1px solid #e5e7eb', background: '#f0fdf4' }}>
                              <form onSubmit={(e) => handleParticipantSubmit(g.id, e)}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, alignItems: 'end' }}>
                                  <label style={labelStyle}>
                                    שם פרטי
                                    <input style={inputStyle} type="text" value={pForm.firstName} required
                                      onChange={(e) => setParticipantForms((prev) => ({ ...prev, [g.id]: { ...pForm, firstName: e.target.value } }))}
                                      placeholder="שם פרטי" />
                                  </label>
                                  <label style={labelStyle}>
                                    טלפון
                                    <input style={inputStyle} type="tel" value={pForm.phoneNumber} required
                                      onChange={(e) => setParticipantForms((prev) => ({ ...prev, [g.id]: { ...pForm, phoneNumber: e.target.value } }))}
                                      placeholder="05X-XXXXXXX" />
                                  </label>
                                  <label style={labelStyle}>
                                    מגדר
                                    <select style={inputStyle} value={pForm.genderId} required
                                      onChange={(e) => setParticipantForms((prev) => ({ ...prev, [g.id]: { ...pForm, genderId: e.target.value } }))}>
                                      {genders.map((gender) => (
                                        <option key={gender.id} value={gender.id}>{gender.name}</option>
                                      ))}
                                    </select>
                                  </label>
                                </div>
                                {participantError && openParticipantFormId === g.id && (
                                  <p style={{ color: '#dc2626', fontSize: 13, marginTop: 8 }}>{participantError}</p>
                                )}
                                <button type="submit" disabled={participantSubmitting}
                                  style={{ ...btnStyle(participantSubmitting), marginTop: 12 }}>
                                  {participantSubmitting ? 'שומר...' : 'הוסף משתתפת'}
                                </button>
                              </form>
                            </div>
                          )}

                          {/* Participants list */}
                          <div style={{ padding: '10px 16px' }}>
                            {groupParticipants.length === 0 ? (
                              <p style={{ color: '#9ca3af', fontSize: 12, margin: 0 }}>אין משתתפות עדיין.</p>
                            ) : (
                              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                <thead>
                                  <tr style={{ color: '#6b7280' }}>
                                    <th style={groupThStyle}>שם</th>
                                    <th style={groupThStyle}>טלפון</th>
                                    <th style={groupThStyle}>מגדר</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {groupParticipants.map((p) => (
                                    <tr key={p.id} style={{ borderTop: '1px solid #f3f4f6', background: p.isMock ? '#fffdf5' : 'transparent' }}>
                                      <td style={groupTdStyle}>
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                          {displayName(p)}
                                          {p.isMock && (
                                            <span style={{ background: '#fef3c7', color: '#92400e', fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 8, border: '1px solid #fde68a' }}>פיקטיבי</span>
                                          )}
                                        </span>
                                      </td>
                                      <td style={groupTdStyle}>{p.phoneNumber}</td>
                                      <td style={groupTdStyle}>{p.gender.name}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>

                        </div>
                      );
                    })
                  )}
                </div>

              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 6,
  fontSize: 14, fontWeight: 500, color: '#374151',
};

const inputStyle: React.CSSProperties = {
  padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6,
  fontSize: 14, color: '#111827', background: '#fff',
  width: '100%', boxSizing: 'border-box',
};

const btnStyle = (disabled: boolean): React.CSSProperties => ({
  marginTop: 20, padding: '10px 24px',
  background: disabled ? '#9ca3af' : '#2563eb',
  color: '#fff', border: 'none', borderRadius: 6,
  fontSize: 14, fontWeight: 600,
  cursor: disabled ? 'not-allowed' : 'pointer',
});

const smallBtnStyle = (isCancel: boolean): React.CSSProperties => ({
  padding: '6px 14px',
  background: isCancel ? '#6b7280' : '#2563eb',
  color: '#fff', border: 'none', borderRadius: 6,
  fontSize: 13, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap',
});

const groupThStyle: React.CSSProperties = {
  textAlign: 'right', padding: '6px 8px', fontWeight: 500,
};

const groupTdStyle: React.CSSProperties = {
  padding: '8px 8px', color: '#374151',
};
