// Mirrors apps/api/src/modules/questionnaires/submission-taxonomy.ts.
// Kept in sync manually (no shared package in this monorepo).

export const SUBMISSION_PURPOSES = [
  'waitlist',
  'onboarding',
  'mid_program',
  'feedback',
  'internal',
] as const;
export type SubmissionPurpose = (typeof SUBMISSION_PURPOSES)[number];

export const SUBMISSION_PURPOSE_LABELS: Record<SubmissionPurpose, string> = {
  waitlist: 'רשימת המתנה',
  onboarding: 'הצטרפות למחזור',
  mid_program: 'באמצע תוכנית',
  feedback: 'משוב',
  internal: 'פנימי',
};

export const PARTICIPANT_MATCHING_MODES = [
  'match_by_phone',
  'always_create',
  'manual_review',
] as const;
export type ParticipantMatchingMode = (typeof PARTICIPANT_MATCHING_MODES)[number];

export const PARTICIPANT_MATCHING_MODE_LABELS: Record<ParticipantMatchingMode, string> = {
  match_by_phone: 'איתור לפי טלפון (ברירת מחדל)',
  always_create: 'יצירה חדשה תמיד',
  manual_review: 'בקרה ידנית — לא לגעת במשתתפות',
};
