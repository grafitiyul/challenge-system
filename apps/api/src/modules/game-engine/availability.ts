/**
 * Shared availability helper for game actions AND completion-mode (מצב השלמה).
 *
 * Single source of truth for "is this action / catch-up button available
 * on this calendar date?". Used by:
 *   - participant-portal.service.ts when listing actions for the portal
 *   - participant-portal.service.ts when accepting a /log submission
 *   - participant-portal.service.ts when the catch-up `availableToday`
 *     flag is computed and when a catch-up session is started
 *
 * Timezone policy: ALL dates evaluated in Asia/Jerusalem business-day
 * terms — the same TZ used everywhere else in the participant portal
 * (catch-up sessions, daily aggregates, log times). Never use UTC
 * `getDay()` / `toISOString()` for these checks: a Friday-only rule
 * would otherwise leak into Thursday after 22:00 UTC, or skip Friday
 * after midnight Israel-local before midnight UTC.
 *
 * Defaults — preserved from the pre-feature world:
 *   - Game actions: both arrays empty → available every day.
 *   - Catch-up mode: both arrays empty → unavailable. The master
 *     `catchUpEnabled` switch is the explicit opt-in for the feature
 *     itself; admins must then list dates and/or weekdays before the
 *     button surfaces. This keeps the "I just toggled enabled, why
 *     does the button suddenly appear every day?" foot-gun closed.
 */

const PARTICIPANT_TZ = 'Asia/Jerusalem';

/** YYYY-MM-DD for the local Asia/Jerusalem calendar day of `d`. */
export function jerusalemDateString(d: Date): string {
  // 'en-CA' renders as YYYY-MM-DD; combined with timeZone it gives the
  // local calendar day regardless of the server's wall-clock TZ.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PARTICIPANT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/**
 * JS-style weekday number (0=Sun..6=Sat) for `d` in Asia/Jerusalem.
 * Computed from the local YMD string via UTC reconstruction so the
 * returned number matches Israel's calendar day, not the server's.
 */
export function jerusalemWeekday(d: Date): number {
  const ymd = jerusalemDateString(d);
  const [y, m, day] = ymd.split('-').map(Number);
  // UTC anchor for that calendar day; getUTCDay() returns 0=Sun..6=Sat.
  return new Date(Date.UTC(y, (m as number) - 1, day)).getUTCDay();
}

/**
 * Validate a YYYY-MM-DD string. Returns true for "2026-04-30"-shape
 * inputs only. Used by the helpers below to ignore garbage entries
 * instead of crashing the availability check.
 */
function isValidYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export type AvailabilityDefault = 'available' | 'unavailable';

export interface AvailabilityRule {
  allowedWeekdays: number[] | null | undefined;
  extraAllowedDates: string[] | null | undefined;
  /**
   * Behavior when BOTH arrays are empty.
   *   'available'    — game-action semantics (no restriction → available).
   *   'unavailable'  — catch-up semantics (admin must opt-in via lists).
   */
  whenUnconfigured: AvailabilityDefault;
}

/** Result tag returned by the inspector form below — useful for log lines. */
export type AvailabilityReason =
  | 'unrestricted'        // both arrays empty + whenUnconfigured='available'
  | 'weekday_match'
  | 'extra_date_match'
  | 'no_rule_unavailable' // both arrays empty + whenUnconfigured='unavailable'
  | 'weekday_mismatch'
  | 'date_not_listed';

/**
 * Decide whether the date falls within the given availability rule.
 * `localYmd` MUST already be in Asia/Jerusalem terms — call
 * jerusalemDateString(new Date()) to derive it for "today".
 *
 * Both arrays are normalised to `[]` if null/undefined so legacy rows
 * that never had the columns populate cleanly.
 */
export function isAvailableOnLocalDate(
  localYmd: string,
  rule: AvailabilityRule,
): boolean {
  return inspectAvailability(localYmd, rule).ok;
}

/**
 * Same decision as isAvailableOnLocalDate but also returns the reason
 * tag, so callers can log the precise branch that fired without
 * recomputing it.
 */
export function inspectAvailability(
  localYmd: string,
  rule: AvailabilityRule,
): { ok: boolean; reason: AvailabilityReason } {
  const weekdays = (rule.allowedWeekdays ?? []).filter(
    (n) => Number.isInteger(n) && n >= 0 && n <= 6,
  );
  const dates = (rule.extraAllowedDates ?? []).filter(isValidYmd);

  if (weekdays.length === 0 && dates.length === 0) {
    return rule.whenUnconfigured === 'available'
      ? { ok: true, reason: 'unrestricted' }
      : { ok: false, reason: 'no_rule_unavailable' };
  }

  if (dates.includes(localYmd)) {
    return { ok: true, reason: 'extra_date_match' };
  }

  if (weekdays.length > 0) {
    const [y, m, d] = localYmd.split('-').map(Number);
    const weekday = new Date(Date.UTC(y, (m as number) - 1, d)).getUTCDay();
    if (weekdays.includes(weekday)) {
      return { ok: true, reason: 'weekday_match' };
    }
    return { ok: false, reason: 'weekday_mismatch' };
  }

  return { ok: false, reason: 'date_not_listed' };
}

/**
 * Hebrew weekday labels keyed by the same 0..6 scheme. Exposed for
 * any backend layer that needs to render a human-readable schedule
 * description (none today, but the front-end uses identical labels
 * so we keep the source of truth aligned).
 */
export const WEEKDAY_LABELS_HE: Record<number, string> = {
  0: 'ראשון',
  1: 'שני',
  2: 'שלישי',
  3: 'רביעי',
  4: 'חמישי',
  5: 'שישי',
  6: 'שבת',
};
