// The overnight rule exists twice — server/attendance.ts for the authoritative
// decisions, src/portal/shift.ts for the labels — because the two bundles can't
// share a module. This asserts they agree, so a change to one that isn't
// mirrored fails here rather than in production.
//   npx tsx server/shift-parity.selftest.ts
import { isOvernightShift as serverIsOvernight, shiftEndMs } from './attendance.js';
import { localDateOf } from './timezone.js';
import { isOvernightShift as clientIsOvernight, shiftEndDate } from '../src/portal/shift.js';

let fail = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? '  ok  ' : 'FAIL  '}${label}${detail && !ok ? ` — ${detail}` : ''}`);
};

const times = ['00:00', '06:00', '09:00', '15:00', '18:00', '22:00', '23:59'];
const dates = ['2026-01-15', '2026-02-28', '2026-07-30', '2026-12-31'];

for (const start of times) {
  for (const end of times) {
    const s = { office_start_time: start, office_end_time: end };
    const a = serverIsOvernight(s);
    const b = clientIsOvernight(start, end);
    check(`isOvernight ${start}->${end}`, a === b, `server ${a}, client ${b}`);

    for (const d of dates) {
      // The server returns the end instant; the client returns the local date it
      // lands on. Comparing the server's instant back through localDateOf is the
      // only meaningful equivalence.
      const serverEndDate = localDateOf(shiftEndMs(d, s));
      const clientEndDate = shiftEndDate(d, start, end);
      check(
        `endDate ${d} ${start}->${end}`,
        serverEndDate === clientEndDate,
        `server ${serverEndDate}, client ${clientEndDate}`
      );
    }
  }
}

console.log(fail === 0 ? `\nSERVER/CLIENT SHIFT RULES AGREE (${times.length ** 2 * (dates.length + 1)} checks)` : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
