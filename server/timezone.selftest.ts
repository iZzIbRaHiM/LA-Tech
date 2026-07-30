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

// Day shifts: the ordinary cases are unchanged.
eq('day 15:05 -> shift date', resolveShift('2026-07-30 10:05:00', shift).shiftDate, '2026-07-30');
eq('day 14:30 (early) -> today', resolveShift('2026-07-30 09:30:00', shift).shiftDate, '2026-07-30');
eq('day 14:30 (early) -> on_time', computeCategory('2026-07-30 09:30:00', shift), 'on_time');
eq('day 09:00 -> today', resolveShift('2026-07-30 04:00:00', shift).shiftDate, '2026-07-30');
eq('day 09:00 -> on_time', computeCategory('2026-07-30 04:00:00', shift), 'on_time');

// The midnight loophole, now closed. 00:30 PKT against a 15:00 start used to be
// read as 14.5h *early* for that day, and early grades as on time — so checking
// in around midnight was recorded punctual and no deduction ever applied. It is
// now 9.5h late for the previous day's shift.
eq('day 00:30 local -> previous shift', resolveShift('2026-07-29 19:30:00', shift).shiftDate, '2026-07-29');
eq('day 00:30 local -> half_day', computeCategory('2026-07-29 19:30:00', shift), 'half_day');
// Boundary: the midpoint between consecutive 15:00 starts is 03:00 PKT.
eq('day 02:30 -> previous shift', resolveShift('2026-07-29 21:30:00', shift).shiftDate, '2026-07-29');
eq('day 03:30 -> today', resolveShift('2026-07-29 22:30:00', shift).shiftDate, '2026-07-30');

// The overnight boundary is the midpoint between consecutive starts: for a
// 22:00 start that is 10:00 PKT. 09:00 PKT belongs to the night that began the
// evening before; 11:00 PKT to the one starting tonight.
eq('night 09:00 -> previous night', resolveShift('2026-07-30 04:00:00', night).shiftDate, '2026-07-29');
eq('night 11:00 -> tonight', resolveShift('2026-07-30 06:00:00', night).shiftDate, '2026-07-30');


// ---- The two live Outbound US shifts, as configured in production ----
// Zukhruf 18:00-02:00, Usama 21:30-02:30, both late-after-30 / half-day-after-90.
const zukhruf = {
  office_start_time: '18:00',
  office_end_time: '02:00',
  late_threshold_minutes: 30,
  half_day_threshold_minutes: 90,
};
const usama = {
  office_start_time: '21:30',
  office_end_time: '02:30',
  late_threshold_minutes: 30,
  half_day_threshold_minutes: 90,
};

eq('zukhruf overnight', String(isOvernightShift(zukhruf)), 'true');
eq('usama overnight', String(isOvernightShift(usama)), 'true');
// 18:00 PKT = 13:00Z; 02:00 PKT next day = 21:00Z same UTC day.
eq('zukhruf end instant', msToUtcString(shiftEndMs('2026-07-30', zukhruf)), '2026-07-30 21:00:00');
// 21:30 PKT = 16:30Z; 02:30 PKT next day = 21:30Z same UTC day.
eq('usama end instant', msToUtcString(shiftEndMs('2026-07-30', usama)), '2026-07-30 21:30:00');

// Zukhruf on time at 18:10 PKT (13:10Z), late at 18:40, half-day at 19:35.
eq('zukhruf 18:10 -> on_time', computeCategory('2026-07-30 13:10:00', zukhruf), 'on_time');
eq('zukhruf 18:29 -> on_time', computeCategory('2026-07-30 13:29:00', zukhruf), 'on_time');
eq('zukhruf 18:30 -> late', computeCategory('2026-07-30 13:30:00', zukhruf), 'late');
eq('zukhruf 19:30 -> half_day', computeCategory('2026-07-30 14:30:00', zukhruf), 'half_day');
// 01:00 PKT on the 31st (20:00Z on the 30th) is 7h into the shift that began
// on the 30th — it must file under the 30th, not the 31st.
eq('zukhruf 01:00 -> shift of 30th', resolveShift('2026-07-30 20:00:00', zukhruf).shiftDate, '2026-07-30');
eq('zukhruf 01:00 -> half_day', computeCategory('2026-07-30 20:00:00', zukhruf), 'half_day');

// Usama on time at 21:40 PKT (16:40Z), late at 22:05, half-day at 23:05.
eq('usama 21:40 -> on_time', computeCategory('2026-07-30 16:40:00', usama), 'on_time');
eq('usama 21:59 -> on_time', computeCategory('2026-07-30 16:59:00', usama), 'on_time');
eq('usama 22:00 -> late', computeCategory('2026-07-30 17:00:00', usama), 'late');
eq('usama 23:00 -> half_day', computeCategory('2026-07-30 18:00:00', usama), 'half_day');
// 00:30 PKT on the 31st (19:30Z on the 30th) belongs to the 30th's shift.
eq('usama 00:30 -> shift of 30th', resolveShift('2026-07-30 19:30:00', usama).shiftDate, '2026-07-30');
// A few minutes early still counts as that night's shift.
eq('usama 21:20 -> shift of 30th', resolveShift('2026-07-30 16:20:00', usama).shiftDate, '2026-07-30');
eq('usama 21:20 -> on_time', computeCategory('2026-07-30 16:20:00', usama), 'on_time');

console.log(fail === 0 ? '\nALL TZ TESTS PASS' : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
