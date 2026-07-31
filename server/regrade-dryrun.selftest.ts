// READ-ONLY dry run. Recomputes the category every existing attendance record
// *would* get under the corrected timezone logic and reports the difference.
// Writes nothing — deciding whether to re-grade historical payroll data is not
// this script's call.
//
// Historical records are graded against the company default shift on purpose:
// schedule_assignments was empty until the Outbound US timings were added, so
// every row already in the table was created when the default was the only
// schedule in force. Grading them against someone's *current* shift would swap
// one error for another.
//
//   node --env-file=.env --import tsx server/regrade-dryrun.selftest.ts
import { db } from './db.js';
import { computeCategory, type CategorySettings } from './attendance.js';
import { resolveSchedule } from './routes-schedules.js';

const settings = (await db
  .prepare(
    'SELECT office_start_time, office_end_time, late_threshold_minutes, half_day_threshold_minutes FROM attendance_settings WHERE id = 1'
  )
  .get()) as CategorySettings;

const rows = (await db
  .prepare(
    `SELECT a.id, a.user_id, u.name, a.record_date, a.check_in, a.category, a.validation_status
     FROM attendance a JOIN users u ON u.id = a.user_id
     WHERE a.check_in IS NOT NULL
     ORDER BY a.record_date, u.name`
  )
  .all()) as Array<{
  id: number;
  user_id: number;
  name: string;
  record_date: string;
  check_in: string;
  category: string | null;
  validation_status: string;
}>;

console.log(
  `Company default in force for all historical rows: ${settings.office_start_time}-${settings.office_end_time}, ` +
    `late>${settings.late_threshold_minutes}m half>${settings.half_day_threshold_minutes}m\n`
);

const changes: Record<string, number> = {};
let changed = 0;
for (const r of rows) {
  const want = computeCategory(r.check_in, settings);
  // Second opinion: the schedule this person is on *now*. Where the two
  // disagree, the record predates a timing that was created to describe hours
  // they were already working.
  const nowSched = await resolveSchedule(r.user_id);
  const wantNow = computeCategory(r.check_in, nowSched);
  if (want !== r.category) {
    changed++;
    const key = `${r.category ?? 'null'} -> ${want}`;
    changes[key] = (changes[key] ?? 0) + 1;
    console.log(
      `  #${String(r.id).padEnd(5)} ${r.record_date}  ${r.name.padEnd(16)} ` +
        `checked in ${r.check_in}Z  stored=${String(r.category).padEnd(9)} default=${String(want).padEnd(9)} ownShift=${wantNow}` +
        (r.validation_status === 'rejected' ? '  (rejected — excluded from payroll anyway)' : '')
    );
  }
}

console.log(`\n${changed} of ${rows.length} records with a check-in would change category.`);
for (const [k, n] of Object.entries(changes).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(24)} ${n}`);
}
console.log('\nNothing was written.');
process.exit(0);
