// Pure attendance business logic, shared between the check-in route and the
// validation (approve-with-edited-time) route so the two can't drift.
export type AttendanceCategory = 'on_time' | 'late' | 'half_day';

export interface CategorySettings {
  office_start_time: string; // 'HH:MM'
  late_threshold_minutes: number;
  half_day_threshold_minutes: number;
}

export function nowUtcString(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

// checkIn is 'YYYY-MM-DD HH:MI:SS', stored/compared as UTC (see db.ts's
// forced session timezone).
export function computeCategory(checkIn: string, settings: CategorySettings): AttendanceCategory {
  const datePart = checkIn.slice(0, 10);
  const checkInMs = new Date(`${checkIn.replace(' ', 'T')}Z`).getTime();
  const [h, m] = settings.office_start_time.split(':').map(Number);
  const officeStartMs = new Date(`${datePart}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`).getTime();
  const diffMinutes = (checkInMs - officeStartMs) / 60000;
  if (diffMinutes >= settings.half_day_threshold_minutes) return 'half_day';
  if (diffMinutes >= settings.late_threshold_minutes) return 'late';
  return 'on_time';
}

export function isWeekday(dateStr: string): boolean {
  const day = new Date(`${dateStr}T00:00:00Z`).getUTCDay(); // 0 = Sunday, 6 = Saturday
  return day >= 1 && day <= 5;
}
