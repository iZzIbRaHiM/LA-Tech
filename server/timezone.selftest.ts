// Pure-function checks for the Pakistan-time helpers. Run:
//   npx tsx server/timezone.selftest.ts
import { localWallClockToUtcMs, localDateOf, msToUtcString, localDatePlus } from './timezone.js';
import { computeCategory } from './attendance.js';

let fail = 0;
const eq = (label: string, got: string, want: string) => {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? '  ok  ' : 'FAIL  '}${label}: got ${got}${ok ? '' : `  want ${want}`}`);
};

// PKT is UTC+5 with no DST today, so local wall clock minus five hours.
eq('15:00 PKT -> UTC', msToUtcString(localWallClockToUtcMs('2026-07-30', '15:00')), '2026-07-30 10:00:00');
eq('22:00 PKT -> UTC', msToUtcString(localWallClockToUtcMs('2026-07-30', '22:00')), '2026-07-30 17:00:00');
eq('09:00 PKT -> UTC', msToUtcString(localWallClockToUtcMs('2026-07-30', '09:00')), '2026-07-30 04:00:00');
// Local midnight belongs to the previous UTC day.
eq('00:30 PKT -> UTC', msToUtcString(localWallClockToUtcMs('2026-07-30', '00:30')), '2026-07-29 19:30:00');

// The local calendar day of a UTC instant flips at 19:00 UTC.
eq('18:59Z -> local date', localDateOf('2026-07-30 18:59:00'), '2026-07-30');
eq('19:00Z -> local date', localDateOf('2026-07-30 19:00:00'), '2026-07-31');
eq('21:00Z prev day -> local date', localDateOf('2026-07-29 21:00:00'), '2026-07-30');
eq('10:00Z -> local date', localDateOf('2026-07-30 10:00:00'), '2026-07-30');

eq('localDatePlus -1 over month', localDatePlus('2026-03-01', -1), '2026-02-28');
eq('localDatePlus +1 over year', localDatePlus('2026-12-31', 1), '2027-01-01');

// A wall-clock time converted to UTC must map back to the same local date.
for (const d of ['2026-01-15', '2026-07-30', '2026-11-02']) {
  for (const t of ['00:00', '05:30', '15:00', '23:59']) {
    eq(`roundtrip ${d} ${t}`, localDateOf(localWallClockToUtcMs(d, t)), d);
  }
}

// Late / half-day classification against the real 15:00 PKT shift. Before the
// timezone fix every one of these returned 'on_time', because a 15:00 start was
// compared as 15:00 UTC (20:00 PKT) and so every check-in looked hours early.
const shift = { office_start_time: '15:00', late_threshold_minutes: 15, half_day_threshold_minutes: 90 };
const cases: Array<[string, string, string]> = [
  ['2026-07-30 09:55:00', '14:55 PKT (5m early)', 'on_time'],
  ['2026-07-30 10:00:00', '15:00 PKT (on time)', 'on_time'],
  ['2026-07-30 10:14:00', '15:14 PKT (+14m)', 'on_time'],
  ['2026-07-30 10:15:00', '15:15 PKT (+15m)', 'late'],
  ['2026-07-30 11:29:00', '16:29 PKT (+89m)', 'late'],
  ['2026-07-30 11:30:00', '16:30 PKT (+90m)', 'half_day'],
];
for (const [utc, label, want] of cases) {
  eq(`category ${label}`, computeCategory(utc, shift), want);
}

console.log(fail === 0 ? '\nALL TZ TESTS PASS' : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
