// Participant lifecycle & source taxonomy — shared across backend modules.
//
// Values are stored as free-form strings on the Participant row (see
// Participant.status / Participant.source in schema.prisma) so legacy
// pre-Phase-1 records with unknown values stay readable. The admin UI
// normalizes to the canonical values below going forward.

export const PARTICIPANT_LIFECYCLE_STATUSES = [
  'lead_waitlist',
  'payment_pending',
  'paid',
  'active',
  'inactive',
] as const;
export type ParticipantLifecycleStatus =
  (typeof PARTICIPANT_LIFECYCLE_STATUSES)[number];

export const PARTICIPANT_SOURCES = [
  'waitlist_form',
  'manual_admin',
  'payment_import',
  'campaign',
] as const;
export type ParticipantSource = (typeof PARTICIPANT_SOURCES)[number];
