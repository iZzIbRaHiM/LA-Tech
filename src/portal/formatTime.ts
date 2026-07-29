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

/** Stable YYYY-MM-DD key in Pakistan time, for grouping messages by day. */
export function dayKey(stored: string | null | undefined): string {
  const d = toDate(stored);
  if (!d) return '';
  return d.toLocaleDateString('en-CA', { timeZone: TZ });
}
