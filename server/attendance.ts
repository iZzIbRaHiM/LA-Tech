// Pure attendance business logic, shared between the check-in route and the
// validation (approve-with-edited-time) route so the two can't drift.
import { localDateOf, localWallClockToUtcMs, utcStringToMs } from './timezone.js';

export type AttendanceCategory = 'on_time' | 'late' | 'half_day';

/**
 * Most minutes a single heartbeat may add to online_minutes.
 *
 * The cap is what stops a closed laptop from being credited: whatever gap
 * elapsed since the last beat, at most this much of it counts. It has to sit
 * above the client's keepalive interval (60s) with room to spare, because a
 * backgrounded tab has its timers throttled by the browser and may be frozen
 * outright for minutes at a time — at 5 minutes those pauses were being
 * discarded as if the machine had been off. Ten tolerates ordinary
 * background throttling while still refusing to credit a genuine absence.
 *
 * Defined once because the accumulator (auth.ts) and the check-out finaliser
 * (routes-attendance.ts) must not drift apart.
 */
export const SESSION_BEAT_CAP_MINUTES = 10;

export interface CategorySettings {
  office_start_time: string; // 'HH:MM'
  late_threshold_minutes: number;
  half_day_threshold_minutes: number;
}

export function nowUtcString(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * checkIn is a stored 'YYYY-MM-DD HH:MI:SS' UTC string. office_start_time is a
 * *Pakistan* wall-clock 'HH:MM' — it is what the CEO typed into Settings.
 *
 * These were previously compared in the same breath: the office start was built
 * with a literal 'Z', so a 15:00 shift was treated as 15:00 UTC (20:00 PKT)
 * instead of 10:00 UTC. Every check-in therefore looked five hours early, no
 * one was ever marked late or half-day, and the late/half-day salary deductions
 * could not fire at all.
 *
 * The comparison is anchored to the local calendar day of the check-in, so a
 * shift is assumed to start and be joined on the same Pakistan date. A shift
 * that spans local midnight would need an explicit end-before-start marker on
 * the schedule; none of the current timings do.
 */
export function computeCategory(checkIn: string, settings: CategorySettings): AttendanceCategory {
  const checkInMs = utcStringToMs(checkIn);
  const localDay = localDateOf(checkInMs);
  const officeStartMs = localWallClockToUtcMs(localDay, settings.office_start_time);
  const diffMinutes = (checkInMs - officeStartMs) / 60000;
  if (diffMinutes >= settings.half_day_threshold_minutes) return 'half_day';
  if (diffMinutes >= settings.late_threshold_minutes) return 'late';
  return 'on_time';
}

/**
 * dateStr is already a calendar date, so reading its UTC weekday is correct —
 * there is no time component to shift. Callers must pass a *local* date though;
 * deriving one from a UTC instant is what localDateOf is for.
 */
export function isWeekday(dateStr: string): boolean {
  const day = new Date(`${dateStr}T00:00:00Z`).getUTCDay(); // 0 = Sunday, 6 = Saturday
  return day >= 1 && day <= 5;
}
