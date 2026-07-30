// The API stores and returns timestamps as UTC strings in the shape
// 'YYYY-MM-DD HH:MM:SS' — no timezone suffix, so `new Date(s)` would parse
// them as *local* time and silently shift everything. Appending 'Z' pins the
// parse to UTC, then we render in Pakistan time (the company's operating
// timezone). Without this the UI showed 12:40 for a message sent at 17:40 PKT.
const TZ = 'Asia/Karachi';

function toDate(stored: string | null | undefined): Date | null {
  if (!stored) return null;
  // Tolerate both 'YYYY-MM-DD HH:MM:SS' and ISO strings that already carry a zone.
  const hasZone = /[Zz]|[+-]\d{2}:?\d{2}$/.test(stored);
  const d = new Date(hasZone ? stored : `${stored.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Time only, e.g. "5:40 PM" — for chat bubbles. */
export function fmtTime(stored: string | null | undefined): string {
  const d = toDate(stored);
  if (!d) return '';
  return d.toLocaleTimeString('en-PK', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true });
}

/** Date + time, e.g. "29 Jul 2026, 5:40 PM" — for audit/activity rows. */
export function fmtDateTime(stored: string | null | undefined): string {
  const d = toDate(stored);
  if (!d) return '';
  return d.toLocaleString('en-PK', {
    timeZone: TZ,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/** Date only, e.g. "29 Jul 2026". */
export function fmtDate(stored: string | null | undefined): string {
  const d = toDate(stored);
  if (!d) return '';
  return d.toLocaleDateString('en-PK', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Day separator label for chat: "Today" / "Yesterday" / "29 Jul 2026".
 * Compared in Pakistan time so the boundary matches the user's actual day.
 */
export function fmtDayLabel(stored: string | null | undefined): string {
  const d = toDate(stored);
  if (!d) return '';
  const key = (x: Date) => x.toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD
  const now = new Date();
  const yest = new Date(now.getTime() - 86400000);
  if (key(d) === key(now)) return 'Today';
  if (key(d) === key(yest)) return 'Yesterday';
  return fmtDate(stored);
}

/**
 * Compact relative label for chat-list rows: "now", "5m", "2h", then
 * weekday for this week, then a short date. Matches messenger conventions.
 */
export function fmtRelative(stored: string | null | undefined): string {
  const d = toDate(stored);
  if (!d) return '';
  const mins = (Date.now() - d.getTime()) / 60000;
  if (mins < 1) return 'now';
  if (mins < 60) return `${Math.floor(mins)}m`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)}h`;
  if (mins < 7 * 24 * 60) return d.toLocaleDateString('en-PK', { timeZone: TZ, weekday: 'short' });
  return d.toLocaleDateString('en-PK', { timeZone: TZ, day: '2-digit', month: 'short' });
}

/** Minutes between two stored timestamps — for message grouping windows. */
export function minutesBetween(a: string, b: string): number {
  const da = toDate(a);
  const db_ = toDate(b);
  if (!da || !db_) return Infinity;
  return Math.abs(db_.getTime() - da.getTime()) / 60000;
}

/**
 * Stored UTC -> the value a <input type="datetime-local"> expects, in Pakistan
 * time. The input renders whatever wall clock it is given, so handing it the raw
 * UTC string made a validator read and edit times five hours off.
 */
export function toLocalInputValue(stored: string | null | undefined): string {
  const d = toDate(stored);
  if (!d) return '';
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(d);
  const at = (t: string) => p.find((x) => x.type === t)?.value ?? '00';
  // hour12:false can render midnight as 24; normalise for the input.
  const hh = String(Number(at('hour')) % 24).padStart(2, '0');
  return `${at('year')}-${at('month')}-${at('day')}T${hh}:${at('minute')}`;
}

/** Minutes Pakistan is ahead of UTC at a given instant (derived, not hardcoded). */
function tzOffsetMinutes(atMs: number): number {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(atMs));
  const at = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  const asIfUtc = Date.UTC(at('year'), at('month') - 1, at('day'), at('hour') % 24, at('minute'), at('second'));
  return (asIfUtc - atMs) / 60000;
}

/**
 * The inverse: a Pakistan-local 'YYYY-MM-DDTHH:MM' from the input back to the
 * stored 'YYYY-MM-DD HH:MM:SS' UTC shape. Mirrors localWallClockToUtcMs in
 * server/timezone.ts — the two bundles can't share a module, so keep them in
 * step if either changes.
 */
export function fromLocalInputValue(value: string): string {
  const naive = Date.parse(`${value}:00Z`);
  if (Number.isNaN(naive)) return '';
  let utc = naive - tzOffsetMinutes(naive) * 60000;
  utc = naive - tzOffsetMinutes(utc) * 60000;
  return new Date(utc).toISOString().slice(0, 19).replace('T', ' ');
}

/** Stable YYYY-MM-DD key in Pakistan time, for grouping messages by day. */
export function dayKey(stored: string | null | undefined): string {
  const d = toDate(stored);
  if (!d) return '';
  return d.toLocaleDateString('en-CA', { timeZone: TZ });
}
