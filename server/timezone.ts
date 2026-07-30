// The company operates on Pakistan time. Every timestamp is *stored* as UTC
// (db.ts pins the connection to TimeZone=UTC), but the values a human enters —
// office_start_time, office_end_time — are local wall-clock times, and the
// calendar day an attendance record belongs to is the local day, not the UTC
// one. Mixing the two is a 5-hour error.
//
// Offsets are derived through Intl rather than hardcoded to +05:00. Pakistan
// currently observes no DST, but it has twice in the past (2002, 2008-09), and
// a hardcoded constant would silently mis-attribute every record if it returns.
export const COMPANY_TZ = 'Asia/Karachi';

/** Parse a stored 'YYYY-MM-DD HH:MM:SS' UTC string to epoch ms. */
export function utcStringToMs(stored: string): number {
  return new Date(`${stored.replace(' ', 'T')}Z`).getTime();
}

/** Format epoch ms back to the stored 'YYYY-MM-DD HH:MM:SS' UTC shape. */
export function msToUtcString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Minutes that `tz` is ahead of UTC at the given instant. Positive for east.
 * Works by formatting the instant in the zone and reading the wall clock back.
 */
function tzOffsetMinutes(atMs: number, tz: string = COMPANY_TZ): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(atMs));
  const at = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  // hour can format as 24 for midnight under hour12:false; normalise it.
  const asIfUtc = Date.UTC(at('year'), at('month') - 1, at('day'), at('hour') % 24, at('minute'), at('second'));
  return (asIfUtc - atMs) / 60000;
}

/** The local (Pakistan) calendar date of a UTC instant, as 'YYYY-MM-DD'. */
export function localDateOf(stored: string | number, tz: string = COMPANY_TZ): string {
  const ms = typeof stored === 'number' ? stored : utcStringToMs(stored);
  // 'en-CA' renders ISO-ordered YYYY-MM-DD.
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: tz });
}

/** Today's local (Pakistan) calendar date. */
export function localToday(tz: string = COMPANY_TZ): string {
  return localDateOf(Date.now(), tz);
}

/** Local calendar date `days` before the given local date. */
export function localDatePlus(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`) + days * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The UTC instant at which a local wall-clock time occurs on a local date.
 * e.g. ('2026-07-30', '15:00') in Asia/Karachi -> 2026-07-30T10:00:00Z.
 *
 * Resolved in two passes: the first offset lookup uses the naive instant, the
 * second re-checks using the corrected one, which settles the answer even when
 * the guess landed on the far side of a DST transition.
 */
export function localWallClockToUtcMs(date: string, hhmm: string, tz: string = COMPANY_TZ): number {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  const naive = Date.parse(
    `${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`
  );
  let utc = naive - tzOffsetMinutes(naive, tz) * 60000;
  utc = naive - tzOffsetMinutes(utc, tz) * 60000;
  return utc;
}
