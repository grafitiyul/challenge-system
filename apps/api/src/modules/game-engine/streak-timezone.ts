// Day-bucketing helpers for the two-layer streak system.
//
//   - personalDayKey(log) — buckets by the log's snapshotted tz so a
//     participant's tz change does NOT retroactively shift past days.
//   - gameDayKey(at)      — always Asia/Jerusalem so leaderboards
//     stay consistent across participants regardless of their tz.
//   - isValidIanaTz(s)    — runtime check against the platform's
//     supported tz list. Used both at write time (DTO validation)
//     and at read time (defense-in-depth for legacy/corrupt data).
//
// All helpers return YYYY-MM-DD strings, suitable for set-based
// streak walks. en-CA locale is intentional — its short-date format
// produces ISO YYYY-MM-DD, which Intl gives us for free without
// reaching for a date library.

const SYSTEM_TZ = 'Asia/Jerusalem';
const FALLBACK_TZ = SYSTEM_TZ;

let _supportedTz: Set<string> | null = null;
function supportedTzSet(): Set<string> {
  if (_supportedTz) return _supportedTz;
  // `Intl.supportedValuesOf` is Node 18+. The cast is necessary
  // because TS lib.es2022 doesn't include this method yet on all
  // releases.
  const fn = (Intl as unknown as {
    supportedValuesOf?: (key: 'timeZone') => string[];
  }).supportedValuesOf;
  const list = typeof fn === 'function' ? fn('timeZone') : [];
  _supportedTz = new Set(list);
  return _supportedTz;
}

export function isValidIanaTz(value: string | null | undefined): value is string {
  if (!value || typeof value !== 'string') return false;
  // Try the supported-values list first (cheap set lookup). Some
  // older Node versions return a smaller list than browsers; if the
  // value isn't in the set, fall through to a constructor probe.
  if (supportedTzSet().has(value)) return true;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function safeTz(value: string | null | undefined): string {
  return isValidIanaTz(value) ? value : FALLBACK_TZ;
}

function formatYMD(at: Date, tz: string): string {
  // en-CA → ISO-style "YYYY-MM-DD" via short date. We don't use
  // toLocaleDateString('en-CA') directly because it can vary slightly
  // by Node version; building from parts is bulletproof.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTz(tz),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // formatToParts is stable across Node versions and bypasses any
  // locale quirks in joiner characters.
  const parts = fmt.formatToParts(at);
  const y = parts.find((p) => p.type === 'year')?.value ?? '0000';
  const m = parts.find((p) => p.type === 'month')?.value ?? '00';
  const d = parts.find((p) => p.type === 'day')?.value ?? '00';
  return `${y}-${m}-${d}`;
}

// PERSONAL layer — bucket by the log's frozen tz snapshot.
// Falls back to Asia/Jerusalem for legacy rows / corrupted snapshots.
export function personalDayKey(log: {
  occurredAt: Date | string;
  timezoneSnapshot: string | null;
}): string {
  const at = log.occurredAt instanceof Date ? log.occurredAt : new Date(log.occurredAt);
  return formatYMD(at, log.timezoneSnapshot ?? FALLBACK_TZ);
}

// GAME layer — always system tz. Leaderboard parity rule.
export function gameDayKey(at: Date | string): string {
  const d = at instanceof Date ? at : new Date(at);
  return formatYMD(d, SYSTEM_TZ);
}

// Anchor day for the streak walk. Returns YYYY-MM-DD in the supplied
// tz for "today" or "yesterday" (relative to the supplied instant —
// usually new Date()).
export function dayKeyAt(at: Date, tz: string): string {
  return formatYMD(at, tz);
}

export function previousDayKey(ymd: string): string {
  // Direct string math avoids round-tripping through Date in a
  // non-system tz. The keys are already tz-bucketed; "previous day"
  // means the calendar day before regardless of tz.
  const [y, m, d] = ymd.split('-').map(Number);
  // Anchor at noon UTC so DST-day arithmetic doesn't flip the date
  // when stepping back 24h.
  const anchor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  anchor.setUTCDate(anchor.getUTCDate() - 1);
  const yy = anchor.getUTCFullYear();
  const mm = String(anchor.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(anchor.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export const STREAK_SYSTEM_TZ = SYSTEM_TZ;
export const STREAK_FALLBACK_TZ = FALLBACK_TZ;
