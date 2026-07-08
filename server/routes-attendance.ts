import { Router } from 'express';
import { db, logActivity, notify } from './db.js';
import { requireAuth } from './auth.js';
import { canValidateAttendance } from './policy.js';
import { computeCategory, nowUtcString, type CategorySettings } from './attendance.js';

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

async function getSettings(): Promise<CategorySettings & { max_absent_allowed: number }> {
  return (await db.prepare('SELECT * FROM attendance_settings WHERE id = 1').get()) as CategorySettings & {
    max_absent_allowed: number;
  };
}

attendanceRouter.get('/attendance/status', requireAuth, async (req, res) => {
  const open = await db
    .prepare('SELECT * FROM attendance WHERE user_id = ? AND check_out IS NULL AND check_in IS NOT NULL ORDER BY check_in DESC LIMIT 1')
    .get(req.user!.id);
  res.json({ open: open ?? null });
});

attendanceRouter.post('/attendance/check-in', requireAuth, async (req, res) => {
  const user = req.user!;
  if (user.isCeo) return res.status(403).json({ error: 'Attendance tracking does not apply to the CEO account' });
  const checkInTime = nowUtcString();
  const today = checkInTime.slice(0, 10);

  const existingToday = await db
    .prepare('SELECT id, validation_status FROM attendance WHERE user_id = ? AND record_date = ?')
    .get(user.id, today) as { id: number; validation_status: string } | undefined;
  if (existingToday) {
    if (existingToday.validation_status === 'rejected') {
      return res.status(409).json({ error: 'Your check-in for today was rejected — you cannot check in again today' });
    }
    return res.status(409).json({ error: 'You already have an attendance record for today' });
  }

  const settings = await getSettings();
  const category = computeCategory(checkInTime, settings);
  const { note } = req.body ?? {};
  const info = await db
    .prepare('INSERT INTO attendance (user_id, check_in, record_date, category, note) VALUES (?, ?, ?, ?, ?)')
    .run(user.id, checkInTime, today, category, note?.trim() ?? '');
  await logActivity(user.id, 'attendance', Number(info.lastInsertRowid), 'checked_in', { category });
  res.json({ id: Number(info.lastInsertRowid), category });
});

attendanceRouter.post('/attendance/check-out', requireAuth, async (req, res) => {
  const user = req.user!;
  if (user.isCeo) return res.status(403).json({ error: 'Attendance tracking does not apply to the CEO account' });
  const open = await db
    .prepare('SELECT id FROM attendance WHERE user_id = ? AND check_out IS NULL AND check_in IS NOT NULL')
    .get(user.id) as { id: number } | undefined;
  if (!open) return res.status(409).json({ error: 'No open check-in' });
  await db.prepare("UPDATE attendance SET check_out = datetime('now') WHERE id = ?").run(open.id);
  await logActivity(user.id, 'attendance', open.id, 'checked_out');

  // Tell the validator there's a completed record waiting — dept head, or
  // the CEO if unassigned/headless (same escalation as leave requests).
  const head = await db
    .prepare(
      `SELECT d.head_user_id FROM memberships m JOIN departments d ON d.id = m.department_id
       WHERE m.user_id = ?`
    )
    .get(user.id) as { head_user_id: number | null } | undefined;
  let validator = head?.head_user_id && head.head_user_id !== user.id ? head.head_user_id : null;
  if (!validator) {
    const ceo = await db.prepare('SELECT id FROM users WHERE is_ceo = 1').get() as { id: number } | undefined;
    validator = ceo && ceo.id !== user.id ? ceo.id : null;
  }
  if (validator) {
    await notify(validator, 'attendance', `${user.name} checked out — attendance awaiting validation`, '/portal/attendance');
  }
  res.json({ ok: true });
});

// Own history + (for validators) their team's records. Ordered by
// record_date (not check_in) since absence rows have no check_in.
attendanceRouter.get('/attendance', requireAuth, async (req, res) => {
  const user = req.user!;
  const own = await db
    .prepare('SELECT * FROM attendance WHERE user_id = ? ORDER BY record_date DESC LIMIT 60')
    .all(user.id);

  let team: unknown[] = [];
  if (user.isCeo) {
    team = await db
      .prepare(
        `SELECT a.*, u.name AS user_name FROM attendance a JOIN users u ON u.id = a.user_id
         WHERE a.user_id != ? ORDER BY a.record_date DESC LIMIT 100`
      )
      .all(user.id);
  } else if (user.role === 'head') {
    team = await db
      .prepare(
        `SELECT a.*, u.name AS user_name FROM attendance a
         JOIN users u ON u.id = a.user_id
         JOIN memberships m ON m.user_id = a.user_id AND m.department_id = ?
         WHERE a.user_id != ? ORDER BY a.record_date DESC LIMIT 100`
      )
      .all(user.departmentId, user.id);
  }
  res.json({ own, team });
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
    if (checkInTime.slice(0, 10) !== record.record_date) {
      return res.status(400).json({ error: "Corrected time must stay on the record's original date" });
    }
    const settings = await getSettings();
    const category = computeCategory(checkInTime, settings);
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
