import { Router } from 'express';
import { db, logActivity, notify } from './db';
import { requireAuth } from './auth';
import { canValidateAttendance } from './policy';

export const attendanceRouter = Router();

interface AttendanceRow {
  id: number;
  user_id: number;
  check_in: string;
  check_out: string | null;
  validation_status: string;
  validated_by: number | null;
  validated_at: string | null;
  note: string;
}

attendanceRouter.get('/attendance/status', requireAuth, (req, res) => {
  const open = db
    .prepare('SELECT * FROM attendance WHERE user_id = ? AND check_out IS NULL ORDER BY check_in DESC LIMIT 1')
    .get(req.user!.id);
  res.json({ open: open ?? null });
});

attendanceRouter.post('/attendance/check-in', requireAuth, (req, res) => {
  const user = req.user!;
  const open = db.prepare('SELECT id FROM attendance WHERE user_id = ? AND check_out IS NULL').get(user.id);
  if (open) return res.status(409).json({ error: 'Already checked in — check out first' });
  const { note } = req.body ?? {};
  const info = db
    .prepare('INSERT INTO attendance (user_id, note) VALUES (?, ?)')
    .run(user.id, note?.trim() ?? '');
  logActivity(user.id, 'attendance', Number(info.lastInsertRowid), 'checked_in');
  res.json({ id: Number(info.lastInsertRowid) });
});

attendanceRouter.post('/attendance/check-out', requireAuth, (req, res) => {
  const user = req.user!;
  const open = db
    .prepare('SELECT id FROM attendance WHERE user_id = ? AND check_out IS NULL')
    .get(user.id) as { id: number } | undefined;
  if (!open) return res.status(409).json({ error: 'No open check-in' });
  db.prepare("UPDATE attendance SET check_out = datetime('now') WHERE id = ?").run(open.id);
  logActivity(user.id, 'attendance', open.id, 'checked_out');

  // Tell the validator there's a completed record waiting.
  const head = db
    .prepare(
      `SELECT d.head_user_id FROM memberships m JOIN departments d ON d.id = m.department_id
       WHERE m.user_id = ?`
    )
    .get(user.id) as { head_user_id: number | null } | undefined;
  const validator = head?.head_user_id && head.head_user_id !== user.id ? head.head_user_id : null;
  if (validator) {
    notify(validator, 'attendance', `${user.name} checked out — attendance awaiting validation`, '/portal/attendance');
  }
  res.json({ ok: true });
});

// Own history + (for validators) their team's records.
attendanceRouter.get('/attendance', requireAuth, (req, res) => {
  const user = req.user!;
  const own = db
    .prepare('SELECT * FROM attendance WHERE user_id = ? ORDER BY check_in DESC LIMIT 60')
    .all(user.id);

  let team: unknown[] = [];
  if (user.isCeo) {
    team = db
      .prepare(
        `SELECT a.*, u.name AS user_name FROM attendance a JOIN users u ON u.id = a.user_id
         WHERE a.user_id != ? ORDER BY a.check_in DESC LIMIT 100`
      )
      .all(user.id);
  } else if (user.role === 'head') {
    team = db
      .prepare(
        `SELECT a.*, u.name AS user_name FROM attendance a
         JOIN users u ON u.id = a.user_id
         JOIN memberships m ON m.user_id = a.user_id AND m.department_id = ?
         WHERE a.user_id != ? ORDER BY a.check_in DESC LIMIT 100`
      )
      .all(user.departmentId, user.id);
  }
  res.json({ own, team });
});

attendanceRouter.post('/attendance/:id/validate', requireAuth, (req, res) => {
  const user = req.user!;
  const record = db.prepare('SELECT * FROM attendance WHERE id = ?').get(Number(req.params.id)) as
    | AttendanceRow
    | undefined;
  if (!record) return res.status(404).json({ error: 'Not found' });
  if (!canValidateAttendance(user, record)) return res.status(403).json({ error: 'Not authorized to validate this record' });
  if (!record.check_out) return res.status(409).json({ error: 'Cannot validate an open check-in' });

  const { status } = req.body ?? {};
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status' });

  db.prepare(
    "UPDATE attendance SET validation_status = ?, validated_by = ?, validated_at = datetime('now') WHERE id = ?"
  ).run(status, user.id, record.id);
  logActivity(user.id, 'attendance', record.id, `validation_${status}`, { userId: record.user_id });
  notify(record.user_id, 'attendance', `Your attendance on ${record.check_in.slice(0, 10)} was ${status}`, '/portal/attendance');
  res.json({ ok: true });
});
