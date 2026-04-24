// Shared taxonomy for QuestionnaireTemplate post-submit configuration.
// The values themselves are stored as free-form strings on the template
// row so legacy rows stay readable; this file is the normalized source
// of truth for the admin UI + the service dispatch.

export const SUBMISSION_PURPOSES = [
  'waitlist',
  'onboarding',
  'mid_program',
  'feedback',
  'internal',
] as const;
export type SubmissionPurpose = (typeof SUBMISSION_PURPOSES)[number];

// Participant matching mode — how an inbound submission resolves to a
// Participant row. `manual_review` is the explicit "don't touch
// participants" mode; admin attaches via /admin UI later.
export const PARTICIPANT_MATCHING_MODES = [
  'match_by_phone',
  'always_create',
  'manual_review',
] as const;
export type ParticipantMatchingMode = (typeof PARTICIPANT_MATCHING_MODES)[number];
