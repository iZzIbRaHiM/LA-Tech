// Pure-function checks for the Pakistan-time helpers. Run:
//   npx tsx server/timezone.selftest.ts
import { localWallClockToUtcMs, localDateOf, msToUtcString, localDatePlus } from './timezone.js';
import { computeCategory, isOvernightShift, resolveShift, shiftEndMs } from './attendance.js';

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
const shift = {
  office_start_time: '15:00',
  office_end_time: '22:00',
  late_threshold_minutes: 15,
  half_day_threshold_minutes: 90,
};
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

// ---- Overnight shifts (22:00-06:00 PKT) ----
// Detected from the hours themselves, so the whole chain has to agree that the
// shift belongs to the date it *started* on, not the date the clock happened to
// read when someone checked in.
const night = {
  office_start_time: '22:00',
  office_end_time: '06:00',
  late_threshold_minutes: 15,
  half_day_threshold_minutes: 90,
};
eq('overnight detected', String(isOvernightShift(night)), 'true');
eq('day shift not overnight', String(isOvernightShift(shift)), 'false');

// 22:00 PKT on the 29th is 17:00Z; 06:00 PKT on the 30th is 01:00Z.
eq('night shift end rolls to next day', msToUtcString(shiftEndMs('2026-07-29', night)), '2026-07-30 01:00:00');
eq('day shift end same day', msToUtcString(shiftEndMs('2026-07-29', shift)), '2026-07-29 17:00:00');

// Joining at 22:05 PKT on the 29th (17:05Z) -> that night's shift, on time.
eq('night 22:05 -> shift date', resolveShift('2026-07-29 17:05:00', night).shiftDate, '2026-07-29');
eq('night 22:05 -> on time', computeCategory('2026-07-29 17:05:00', night), 'on_time');

// Joining at 01:00 PKT on the 30th (20:00Z on the 29th) is three hours into the
// shift that began the previous evening — not 21 hours early for the next one.
eq('night 01:00 -> shift date', resolveShift('2026-07-29 20:00:00', night).shiftDate, '2026-07-29');
eq('night 01:00 -> half day', computeCategory('2026-07-29 20:00:00', night), 'half_day');

// 22:20 PKT is 20 minutes late for the same evening's shift.
eq('night 22:20 -> late', computeCategory('2026-07-29 17:20:00', night), 'late');

// A few minutes early still belongs to the shift about to start.
eq('night 21:50 -> shift date', resolveShift('2026-07-29 16:50:00', night).shiftDate, '2026-07-29');
eq('night 21:50 -> on time', computeCategory('2026-07-29 16:50:00', night), 'on_time');

// And the day-shift path must be unaffected by any of this — same-day shifts
// still resolve to the plain local calendar date, so no existing record changes
// how it is graded.
eq('day 15:05 -> shift date', resolveShift('2026-07-30 10:05:00', shift).shiftDate, '2026-07-30');
eq('day 00:30 local -> that local day', resolveShift('2026-07-29 19:30:00', shift).shiftDate, '2026-07-30');
eq('day 00:30 local -> still on_time', computeCategory('2026-07-29 19:30:00', shift), 'on_time');

// The overnight boundary is the midpoint between consecutive starts: for a
// 22:00 start that is 10:00 PKT. 09:00 PKT belongs to the night that began the
// evening before; 11:00 PKT to the one starting tonight.
eq('night 09:00 -> previous night', resolveShift('2026-07-30 04:00:00', night).shiftDate, '2026-07-29');
eq('night 11:00 -> tonight', resolveShift('2026-07-30 06:00:00', night).shiftDate, '2026-07-30');

console.log(fail === 0 ? '\nALL TZ TESTS PASS' : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
