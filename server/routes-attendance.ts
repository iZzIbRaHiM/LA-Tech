import { Router } from 'express';
import { db, logActivity, notify } from './db.js';
import { requireAuth } from './auth.js';
import { canValidateAttendance } from './policy.js';
import { computeCategory, nowUtcString, resolveShift, SESSION_BEAT_CAP_MINUTES } from './attendance.js';
import { localMonth } from './timezone.js';
import { resolveSchedule } from './routes-schedules.js';

export const attendanceRouter = Router();

interface AttendanceRow {
  id: number;
  user_id: number;
  check_in: string | null;
  check_out: string | null;
  record_date: string;
  category: 'on_time' | 'late' | 'half_day' | 'absent' | null;
  validation_status: string;
  validated_by: number | null;
  validated_at: string | null;
  note: string;
}

attendanceRouter.get('/attendance/status', requireAuth, async (req, res) => {
  const open = await db
    .prepare('SELECT * FROM attendance WHERE user_id = ? AND check_out IS NULL AND check_in IS NOT NULL ORDER BY check_in DESC LIMIT 1')
    .get(req.user!.id);
  res.json({ open: open ?? null });
});

/**
 * Keepalive for the work-session clock.
 *
 * requireAuth already advances last_seen_at and tops up online_minutes on every
 * authenticated request, so this endpoint deliberately does nothing itself — it
 * exists so the client has something cheap to call on a timer that is *not*
 * gated on tab visibility.
 *
 * Why it is needed: usePolling stops every interval while document.hidden is
 * true (a deliberate free-tier measure), which meant a portal left open in a
 * background tab produced zero requests and therefore zero accrued time. A
 * full day logged in showed as a couple of hours of "active".
 */
attendanceRouter.post('/attendance/heartbeat', requireAuth, async (req, res) => {
  // Reported back so the client can beat slowly when there is no session to
  // credit, instead of paying for a fast keepalive all day for nothing.
  const open = await db
    .prepare(
      'SELECT 1 AS open FROM attendance WHERE user_id = ? AND check_out IS NULL AND check_in IS NOT NULL LIMIT 1'
    )
    .get(req.user!.id);
  res.json({ ok: true, sessionOpen: Boolean(open) });
});

attendanceRouter.post('/attendance/check-in', requireAuth, async (req, res) => {
  const user = req.user!;
  if (user.isCeo) return res.status(403).json({ error: 'Attendance tracking does not apply to the CEO account' });
  const checkInTime = nowUtcString();
  // Resolve the schedule first: the record's day is the date the *shift* began,
  // which for an overnight timing is not the calendar day of the check-in. A
  // 01:00 arrival on a 22:00-06:00 shift belongs to yesterday's row.
  const schedule = await resolveSchedule(user.id);
  const today = resolveShift(checkInTime, schedule).shiftDate;

  const existingToday = await db
    .prepare('SELECT id, validation_status FROM attendance WHERE user_id = ? AND record_date = ?')
    .get(user.id, today) as { id: number; validation_status: string } | undefined;
  if (existingToday) {
    if (existingToday.validation_status === 'rejected') {
      return res.status(409).json({ error: 'Your check-in for today was rejected — you cannot check in again today' });
    }
    return res.status(409).json({ error: 'You already have an attendance record for today' });
  }

  // Category comes from the user's assigned office timing (individual >
  // department > company default), and the record is auto-approved — the
  // session tracker (presence heartbeat accumulating online_minutes) is the
  // monitor now, not a manual head/CEO validation step. Validators keep the
  // /validate endpoint for after-the-fact corrections only.
  const category = computeCategory(checkInTime, schedule);
  const { note } = req.body ?? {};
  const info = await db
    .prepare(
      `INSERT INTO attendance (user_id, check_in, record_date, category, note, validation_status, validated_at, last_active_at)
       VALUES (?, ?, ?, ?, ?, 'approved', datetime('now'), ?)`
    )
    .run(user.id, checkInTime, today, category, note?.trim() ?? '', checkInTime);
  await logActivity(user.id, 'attendance', Number(info.lastInsertRowid), 'checked_in', {
    category,
    schedule: schedule.schedule_name ?? 'default',
  });
  res.json({ id: Number(info.lastInsertRowid), category, schedule });
});

attendanceRouter.post('/attendance/check-out', requireAuth, async (req, res) => {
  const user = req.user!;
  if (user.isCeo) return res.status(403).json({ error: 'Attendance tracking does not apply to the CEO account' });
  const open = await db
    .prepare('SELECT id FROM attendance WHERE user_id = ? AND check_out IS NULL AND check_in IS NOT NULL')
    .get(user.id) as { id: number } | undefined;
  if (!open) return res.status(409).json({ error: 'No open check-in' });

  // Finalize the session: fold in the time since the last heartbeat (capped the
  // same as the heartbeat accumulator, so idle gaps don't count), stamp
  // check-out. The record was auto-approved at check-in — no
  // validator round-trip.
  // COALESCE to check_in covers records opened before session tracking
  // shipped (their last_active_at is NULL — they still get the capped
  // final increment instead of silently contributing zero).
  await db
    .prepare(
      `UPDATE attendance SET
         online_minutes = online_minutes + LEAST(GREATEST(EXTRACT(EPOCH FROM (now() - COALESCE(last_active_at, check_in)::timestamp)) / 60.0, 0), ${SESSION_BEAT_CAP_MINUTES}),
         last_active_at = datetime('now'),
         check_out = datetime('now')
       WHERE id = ?`
    )
    .run(open.id);
  const finished = await db.prepare('SELECT online_minutes FROM attendance WHERE id = ?').get(open.id) as {
    online_minutes: number;
  };
  await logActivity(user.id, 'attendance', open.id, 'checked_out', {
    onlineMinutes: Math.round(Number(finished.online_minutes)),
  });
  res.json({ ok: true, onlineMinutes: Math.round(Number(finished.online_minutes)) });
});

// Manual backfill for a missed day: the only prior remedy for a bad or
// missing record was deleting a system-generated absence, which left no
// record at all — no way to log that someone actually worked a day they
// forgot to check in for. Validator-authored, so it's auto-approved
// immediately (no separate approval round-trip needed for something the
// validator is entering themselves).
attendanceRouter.post('/attendance/manual', requireAuth, async (req, res) => {
  const user = req.user!;
  const { userId, checkIn, checkOut, note } = req.body ?? {};
  const targetId = Number(userId);
  if (!targetId || !checkIn || !checkOut) {
    return res.status(400).json({ error: 'userId, checkIn, and checkOut are required' });
  }
  if (!(await canValidateAttendance(user, { user_id: targetId }))) {
    return res.status(403).json({ error: 'Not authorized to log attendance for this person' });
  }
  const target = await db.prepare('SELECT is_ceo FROM users WHERE id = ? AND active = 1').get(targetId) as
    | { is_ceo: number }
    | undefined;
  if (!target) return res.status(404).json({ error: 'User not found or inactive' });
  if (target.is_ceo) return res.status(400).json({ error: 'Attendance tracking does not apply to the CEO account' });

  const checkInMs = new Date(`${String(checkIn).replace(' ', 'T')}Z`).getTime();
  const checkOutMs = new Date(`${String(checkOut).replace(' ', 'T')}Z`).getTime();
  if (!Number.isFinite(checkInMs) || !Number.isFinite(checkOutMs)) {
    return res.status(400).json({ error: 'Invalid check-in or check-out time' });
  }
  if (checkOutMs <= checkInMs) return res.status(400).json({ error: 'Check-out must be after check-in' });
  const schedule = await resolveSchedule(targetId);
  // Both ends must belong to the same *shift*, not the same calendar day: an
  // overnight shift legitimately starts and finishes on different dates, and
  // comparing dates would reject it. Comparing the resolved shift also still
  // rejects a genuine two-day span.
  const recordDate = resolveShift(String(checkIn), schedule).shiftDate;
  if (resolveShift(String(checkOut), schedule).shiftDate !== recordDate) {
    return res.status(400).json({ error: 'Check-in and check-out must belong to the same shift' });
  }

  const existing = await db.prepare('SELECT id FROM attendance WHERE user_id = ? AND record_date = ?').get(targetId, recordDate);
  if (existing) return res.status(409).json({ error: 'A record already exists for that date — edit or delete it instead' });

  const category = computeCategory(String(checkIn), schedule);
  const onlineMinutes = Math.round((checkOutMs - checkInMs) / 60000);
  const info = await db
    .prepare(
      `INSERT INTO attendance
         (user_id, check_in, check_out, record_date, category, note, validation_status, validated_by, validated_at, online_minutes, last_active_at)
       VALUES (?, ?, ?, ?, ?, ?, 'approved', ?, datetime('now'), ?, ?)`
    )
    .run(targetId, checkIn, checkOut, recordDate, category, note?.trim() ?? '', user.id, onlineMinutes, checkOut);
  await logActivity(user.id, 'attendance', Number(info.lastInsertRowid), 'manually_logged', {
    userId: targetId,
    recordDate,
    category,
  });
  await notify(targetId, 'attendance', `Attendance for ${recordDate} was logged on your behalf`, '/portal/attendance');
  res.json({ id: Number(info.lastInsertRowid), category });
});

// Own history + (for validators) their team's records. Ordered by
// record_date (not check_in) since absence rows have no check_in.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Hard ceiling per list, so a wide range can't return the whole table. */
const ATTENDANCE_MAX_ROWS = 500;

/**
 * Date window for a listing request.
 *
 * record_date is the local (Pakistan) shift date, so `from`/`to` compare
 * directly against it — no conversion, and the range the user picked is exactly
 * the range they get.
 *
 * Defaults to the current local month rather than "everything". The list used
 * to be an unfiltered LIMIT 60/100, so it simply accumulated until the page was
 * a wall of rows with no way to narrow it.
 */
function dateWindow(query: Record<string, unknown>): { from: string; to: string } {
  const raw = (k: string) => (DATE_RE.test(String(query[k] ?? '')) ? String(query[k]) : null);
  const month = localMonth();
  const from = raw('from') ?? `${month}-01`;
  // '-31' is a safe upper bound for a string comparison against 'YYYY-MM-DD':
  // no real date in the month sorts above it, and short months just match fewer.
  const to = raw('to') ?? `${month}-31`;
  // Tolerate a reversed range instead of silently returning nothing.
  return from <= to ? { from, to } : { from: to, to: from };
}

attendanceRouter.get('/attendance', requireAuth, async (req, res) => {
  const user = req.user!;
  const { from, to } = dateWindow(req.query as Record<string, unknown>);

  // CEO-only lookup for one specific employee — used by the org profile panel,
  // and by the team filter on the attendance page.
  const queriedUserId = req.query.userId ? Number(req.query.userId) : null;
  if (queriedUserId) {
    if (!user.isCeo) return res.status(403).json({ error: 'CEO only' });
    const rows = await db
      .prepare(
        `SELECT * FROM attendance WHERE user_id = ? AND record_date BETWEEN ? AND ?
         ORDER BY record_date DESC LIMIT ${ATTENDANCE_MAX_ROWS}`
      )
      .all(queriedUserId, from, to);
    return res.json({ own: rows, team: [], from, to });
  }

  const own = await db
    .prepare(
      `SELECT * FROM attendance WHERE user_id = ? AND record_date BETWEEN ? AND ?
       ORDER BY record_date DESC LIMIT ${ATTENDANCE_MAX_ROWS}`
    )
    .all(user.id, from, to);

  // Validators can narrow the team list to one person. Scoping is still done by
  // the queries below, so this only ever subtracts from what they may already
  // see — it is a filter, not a way to reach someone else's records.
  const teamMemberId = req.query.teamUserId ? Number(req.query.teamUserId) : null;
  const memberFilter = teamMemberId ? 'AND a.user_id = ?' : '';

  let team: unknown[] = [];
  if (user.isCeo) {
    const params: Array<string | number> = [user.id, from, to];
    if (teamMemberId) params.push(teamMemberId);
    team = await db
      .prepare(
        `SELECT a.*, u.name AS user_name FROM attendance a JOIN users u ON u.id = a.user_id
         WHERE a.user_id != ? AND a.record_date BETWEEN ? AND ? ${memberFilter}
         ORDER BY a.record_date DESC LIMIT ${ATTENDANCE_MAX_ROWS}`
      )
      .all(...params);
  } else if (user.role === 'head') {
    const params: Array<string | number> = [user.departmentId!, user.id, from, to];
    if (teamMemberId) params.push(teamMemberId);
    team = await db
      .prepare(
        `SELECT a.*, u.name AS user_name FROM attendance a
         JOIN users u ON u.id = a.user_id
         JOIN memberships m ON m.user_id = a.user_id AND m.department_id = ?
         WHERE a.user_id != ? AND a.record_date BETWEEN ? AND ? ${memberFilter}
         ORDER BY a.record_date DESC LIMIT ${ATTENDANCE_MAX_ROWS}`
      )
      .all(...params);
  }
  res.json({ own, team, from, to });
});

attendanceRouter.post('/attendance/:id/validate', requireAuth, async (req, res) => {
  const user = req.user!;
  const record = await db.prepare('SELECT * FROM attendance WHERE id = ?').get(Number(req.params.id)) as
    | AttendanceRow
    | undefined;
  if (!record) return res.status(404).json({ error: 'Not found' });
  if (!(await canValidateAttendance(user, record))) return res.status(403).json({ error: 'Not authorized to validate this record' });
  if (record.category === 'absent') {
    return res.status(409).json({ error: 'Absence records have nothing to validate — delete them instead if incorrect' });
  }
  if (!record.check_out) return res.status(409).json({ error: 'Cannot validate an open check-in' });

  const { status, checkInTime } = req.body ?? {};
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status' });

  // Approving can come with a corrected check-in time (validator knows the
  // employee's real arrival time didn't match what the app recorded).
  if (status === 'approved' && checkInTime) {
    // Categorise against the record owner's own timing, not the company
    // default: check-in resolves the individual > department > default chain, so
    // using getSettings() here re-graded anyone on a custom shift against hours
    // they don't work.
    const schedule = await resolveSchedule(record.user_id);
    // Compared as a shift, not a date. An overnight shift's corrected time can
    // legitimately fall on the following calendar day while still belonging to
    // this record.
    if (resolveShift(checkInTime, schedule).shiftDate !== record.record_date) {
      return res.status(400).json({ error: "Corrected time must stay within the record's original shift" });
    }
    const category = computeCategory(checkInTime, schedule);
    await db.prepare('UPDATE attendance SET check_in = ?, category = ? WHERE id = ?').run(checkInTime, category, record.id);
  }

  await db.prepare(
    "UPDATE attendance SET validation_status = ?, validated_by = ?, validated_at = datetime('now') WHERE id = ?"
  ).run(status, user.id, record.id);
  await logActivity(user.id, 'attendance', record.id, `validation_${status}`, { userId: record.user_id, checkInTime });
  await notify(record.user_id, 'attendance', `Your attendance on ${record.record_date} was ${status}`, '/portal/attendance');
  res.json({ ok: true });
});

// Absences are system-generated (no check-in to dispute) — a validator
// corrects a wrong one by deleting it, not by approving/rejecting.
attendanceRouter.delete('/attendance/:id', requireAuth, async (req, res) => {
  const user = req.user!;
  const record = await db.prepare('SELECT * FROM attendance WHERE id = ?').get(Number(req.params.id)) as
    | AttendanceRow
    | undefined;
  if (!record) return res.status(404).json({ error: 'Not found' });
  if (record.category !== 'absent') return res.status(400).json({ error: 'Only absence records can be deleted this way' });
  if (!(await canValidateAttendance(user, record))) return res.status(403).json({ error: 'Not authorized' });
  await db.prepare('DELETE FROM attendance WHERE id = ?').run(record.id);
  await logActivity(user.id, 'attendance', record.id, 'absence_corrected', { userId: record.user_id, recordDate: record.record_date });
  res.json({ ok: true });
});
