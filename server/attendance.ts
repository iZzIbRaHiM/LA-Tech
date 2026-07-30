// Pure attendance business logic, shared between the check-in route and the
// validation (approve-with-edited-time) route so the two can't drift.
import { localDateOf, localDatePlus, localWallClockToUtcMs, utcStringToMs } from './timezone.js';

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

export interface ShiftTimes {
  office_start_time: string; // 'HH:MM', Pakistan wall clock
  office_end_time: string; // 'HH:MM', Pakistan wall clock
}

export interface CategorySettings extends ShiftTimes {
  late_threshold_minutes: number;
  half_day_threshold_minutes: number;
}

export function nowUtcString(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * A shift crosses local midnight when its end reads earlier than its start —
 * 22:00–06:00, say. Derived from the times themselves rather than a separate
 * flag on the schedule: a flag can disagree with the hours next to it, and
 * whoever edits the hours would have to remember to keep it in step.
 *
 * Equal times are treated as same-day rather than a 24-hour shift; a zero-length
 * shift is a data-entry mistake, and reading it as a full day around the clock
 * would classify every check-in against the wrong instant.
 */
export function isOvernightShift(s: ShiftTimes): boolean {
  return toMinutes(s.office_end_time) < toMinutes(s.office_start_time);
}

function toMinutes(hhmm: string): number {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** The UTC instant a shift beginning on `shiftDate` (a local date) ends. */
export function shiftEndMs(shiftDate: string, s: ShiftTimes): number {
  const endDate = isOvernightShift(s) ? localDatePlus(shiftDate, 1) : shiftDate;
  return localWallClockToUtcMs(endDate, s.office_end_time);
}

/**
 * Which instance of a recurring shift a check-in belongs to, and when that
 * instance runs. `shiftDate` is the date the shift *started*, which is what
 * record_date stores — so a night is one row, not two half-rows either side of
 * midnight, and the one-record-per-day guard still means something to night
 * staff.
 *
 * A same-day shift keeps the plain rule: the local calendar date of the
 * check-in. Deliberately not the nearest-start search below — that would also
 * re-grade day shifts (a 00:30 arrival against a 15:00 start becomes "9h late"
 * rather than "early for today"), and changing how existing live records are
 * categorised is not something to do as a side effect of adding night support.
 *
 * Overnight shifts can't use the calendar date: someone joining a 22:00–06:00
 * shift at 01:00 is three hours into *yesterday's* shift, not twenty-one hours
 * early for tonight's. For those, the adjacent days are candidates too and the
 * closest start wins — with the midpoint between two consecutive starts as the
 * boundary. Ties go to the earlier start, since "very late" is the reading that
 * deserves a look.
 */
export function resolveShift(
  checkIn: string,
  s: ShiftTimes
): { shiftDate: string; startMs: number; endMs: number } {
  const checkInMs = utcStringToMs(checkIn);
  const today = localDateOf(checkInMs);

  let shiftDate = today;
  if (isOvernightShift(s)) {
    let bestDelta = Infinity;
    for (const offset of [-1, 0, 1]) {
      const candidate = localDatePlus(today, offset);
      const delta = Math.abs(checkInMs - localWallClockToUtcMs(candidate, s.office_start_time));
      if (delta < bestDelta) {
        bestDelta = delta;
        shiftDate = candidate;
      }
    }
  }
  return {
    shiftDate,
    startMs: localWallClockToUtcMs(shiftDate, s.office_start_time),
    endMs: shiftEndMs(shiftDate, s),
  };
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
 */
export function computeCategory(checkIn: string, settings: CategorySettings): AttendanceCategory {
  const { startMs } = resolveShift(checkIn, settings);
  const diffMinutes = (utcStringToMs(checkIn) - startMs) / 60000;
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
