// Client-side twin of isOvernightShift in server/attendance.ts. The two bundles
// can't share a module, so keep them in step if either changes — the server is
// the authority, this only labels the UI.
//
// A shift crosses local midnight when its end reads earlier than its start
// (22:00–06:00). Equal times count as same-day: a zero-length shift is a typo,
// not a request for 24-hour cover.
export function isOvernightShift(startTime: string, endTime: string): boolean {
  return toMinutes(endTime) < toMinutes(startTime);
}

function toMinutes(hhmm: string): number {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** e.g. "22:00 – 06:00 (overnight)" for display next to a schedule. */
export function formatShiftHours(startTime: string, endTime: string): string {
  return `${startTime} – ${endTime}${isOvernightShift(startTime, endTime) ? ' (overnight)' : ''}`;
}

/**
 * The local date a shift's end falls on, given the date it started — the next
 * day when the hours cross midnight. Mirrors shiftEndMs in
 * server/attendance.ts.
 *
 * Needed when composing a timestamp from a date plus a time: pinning both ends
 * of a 22:00–06:00 shift to the same date puts the check-out eight hours before
 * the check-in, which the API correctly rejects.
 */
export function shiftEndDate(shiftDate: string, startTime: string, endTime: string): string {
  if (!isOvernightShift(startTime, endTime)) return shiftDate;
  return new Date(Date.parse(`${shiftDate}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
}
