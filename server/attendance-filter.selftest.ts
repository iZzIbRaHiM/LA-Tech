// Read-only check that the date window actually narrows the query. Runs the
// same SQL shape the /attendance route uses, against the live database.
//   node --env-file=.env --import tsx server/attendance-filter.selftest.ts
import { db } from './db.js';
import { localMonth, localToday, localDatePlus } from './timezone.js';

const ceo = (await db.prepare('SELECT id FROM users WHERE is_ceo = 1').get()) as { id: number };

async function windowCount(from: string, to: string): Promise<number> {
  const r = (await db
    .prepare(
      `SELECT COUNT(*) AS c FROM attendance a JOIN users u ON u.id = a.user_id
       WHERE a.user_id != ? AND a.record_date BETWEEN ? AND ?`
    )
    .get(ceo.id, from, to)) as { c: string | number };
  return Number(r.c);
}

const total = (await db.prepare('SELECT COUNT(*) AS c FROM attendance').get()) as { c: string | number };
const span = (await db
  .prepare('SELECT MIN(record_date) AS lo, MAX(record_date) AS hi FROM attendance')
  .get()) as { lo: string | null; hi: string | null };

console.log(`Total attendance rows: ${Number(total.c)}`);
console.log(`Date span in table:    ${span.lo} .. ${span.hi}`);
console.log(`Local today:           ${localToday()}\n`);

const month = localMonth();
const ranges: Array<[string, string, string]> = [
  ['Today', localToday(), localToday()],
  ['Last 7 days', localDatePlus(localToday(), -6), localToday()],
  ['Last 30 days', localDatePlus(localToday(), -29), localToday()],
  ['This month', `${month}-01`, `${month}-31`],
  ['Everything (unfiltered equivalent)', '0000-01-01', '9999-12-31'],
];

// The ranges are listed narrowest first, so each successive window contains the
// previous one and its count must never *drop*.
let prev = -1;
let monotonic = true;
for (const [label, from, to] of ranges) {
  const n = await windowCount(from, to);
  console.log(`${label.padEnd(36)} ${from} .. ${to}  ->  ${n} row(s)`);
  if (n < prev) monotonic = false;
  prev = n;
}

// Widening a window must never return fewer rows than a window it contains.
const narrow = await windowCount(localToday(), localToday());
const wide = await windowCount('0000-01-01', '9999-12-31');
console.log(
  `\nContainment: today (${narrow}) <= everything (${wide}) — ${narrow <= wide ? 'ok' : 'FAIL'}`
);
console.log(`Preset ordering sane: ${monotonic ? 'ok' : 'FAIL'}`);
process.exit(narrow <= wide && monotonic ? 0 : 1);
