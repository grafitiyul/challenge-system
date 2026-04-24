// Participant lifecycle + source taxonomy — shared between the admin
// participants list, the participant profile, and the Payments tab.
//
// Values mirror `apps/api/src/modules/participants/participant-lifecycle.ts`.
// Kept in sync manually (no shared package setup in this monorepo).

export const PARTICIPANT_LIFECYCLE_STATUSES = [
  'lead_waitlist',
  'payment_pending',
  'paid',
  'active',
  'inactive',
] as const;
export type ParticipantLifecycleStatus =
  (typeof PARTICIPANT_LIFECYCLE_STATUSES)[number];

export const PARTICIPANT_STATUS_LABELS: Record<ParticipantLifecycleStatus, string> = {
  lead_waitlist: 'רשימת המתנה',
  payment_pending: 'תשלום בתהליך',
  paid: 'שילמה',
  active: 'פעילה',
  inactive: 'לא פעילה',
};

// Chip color per status — used by the list and the profile header.
export const PARTICIPANT_STATUS_COLORS: Record<
  ParticipantLifecycleStatus,
  { bg: string; fg: string }
> = {
  lead_waitlist:   { bg: '#eef2ff', fg: '#4338ca' }, // indigo
  payment_pending: { bg: '#fef3c7', fg: '#b45309' }, // amber
  paid:            { bg: '#dcfce7', fg: '#15803d' }, // green
  active:          { bg: '#dbeafe', fg: '#1d4ed8' }, // blue
  inactive:        { bg: '#f1f5f9', fg: '#64748b' }, // slate
};

export function isKnownLifecycleStatus(value: string | null | undefined): value is ParticipantLifecycleStatus {
  return !!value && (PARTICIPANT_LIFECYCLE_STATUSES as readonly string[]).includes(value);
}

export const PARTICIPANT_SOURCES = [
  'waitlist_form',
  'manual_admin',
  'payment_import',
  'campaign',
] as const;
export type ParticipantSource = (typeof PARTICIPANT_SOURCES)[number];

export const PARTICIPANT_SOURCE_LABELS: Record<ParticipantSource, string> = {
  waitlist_form: 'רשימת המתנה',
  manual_admin: 'הוספה ידנית',
  payment_import: 'ייבוא תשלומים',
  campaign: 'קמפיין',
};
