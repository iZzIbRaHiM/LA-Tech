// Read-only end-to-end check: does the schedule the DB now holds resolve
// through resolveSchedule() and grade a realistic check-in the way we expect?
// Writes nothing.
//   node --env-file=.env --import tsx server/schedule-check.selftest.ts
import { db } from './db.js';
import { resolveSchedule } from './routes-schedules.js';
import { computeCategory, isOvernightShift, resolveShift, shiftEndMs } from './attendance.js';
import { localWallClockToUtcMs, msToUtcString, localToday } from './timezone.js';

const people = await db
  .prepare("SELECT id, name FROM users WHERE active = 1 AND is_ceo = 0 ORDER BY name")
  .all() as Array<{ id: number; name: string }>;

console.log(`Local (Pakistan) today: ${localToday()}\n`);

for (const p of people) {
  const s = await resolveSchedule(p.id);
  const overnight = isOvernightShift(s);
  console.log(
    `${p.name} (#${p.id})  ${s.office_start_time}-${s.office_end_time}` +
      `${overnight ? ' [overnight]' : ''}  late>${s.late_threshold_minutes}m half>${s.half_day_threshold_minutes}m` +
      `  schedule=${s.schedule_name ?? 'company default'}`
  );

  // Grade a punctual arrival, and one an hour past the late threshold, on
  // today's instance of their own shift.
  const day = localToday();
  const onTimeUtc = msToUtcString(localWallClockToUtcMs(day, s.office_start_time) + 5 * 60000);
  const lateUtc = msToUtcString(
    localWallClockToUtcMs(day, s.office_start_time) + (s.late_threshold_minutes + 5) * 60000
  );
  const halfUtc = msToUtcString(
    localWallClockToUtcMs(day, s.office_start_time) + (s.half_day_threshold_minutes + 5) * 60000
  );
  console.log(
    `    +5m  -> ${computeCategory(onTimeUtc, s)}` +
      `   +${s.late_threshold_minutes + 5}m -> ${computeCategory(lateUtc, s)}` +
      `   +${s.half_day_threshold_minutes + 5}m -> ${computeCategory(halfUtc, s)}`
  );
  console.log(
    `    shift window: ${msToUtcString(resolveShift(onTimeUtc, s).startMs)}Z` +
      ` -> ${msToUtcString(shiftEndMs(day, s))}Z  (files under ${resolveShift(onTimeUtc, s).shiftDate})`
  );
}
process.exit(0);
