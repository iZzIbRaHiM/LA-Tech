import { Router } from 'express';
import { db, logActivity, notify } from './db';
import { requireAuth, type SessionUser } from './auth';

export const leaveRouter = Router();

interface LeaveRow {
  id: number;
  user_id: number;
  type: string;
  start_date: string;
  end_date: string;
  reason: string;
  status: string;
}

// Same authority model as attendance: CEO decides anyone's request; a head
// decides their own department members'; nobody decides their own.
function canDecide(actor: SessionUser, request: LeaveRow): boolean {
  if (request.user_id === actor.id) return false;
  if (actor.isCeo) return true;
  if (actor.role !== 'head') return false;
  return !!db
    .prepare('SELECT 1 FROM memberships WHERE user_id = ? AND department_id = ?')
    .get(request.user_id, actor.departmentId);
}

leaveRouter.post('/leave', requireAuth, (req, res) => {
  const user = req.user!;
  const { type, startDate, endDate, reason } = req.body ?? {};
  if (!startDate || !endDate) return res.status(400).json({ error: 'Start and end dates required' });
  if (endDate < startDate) return res.status(400).json({ error: 'End date is before start date' });
  const leaveType = ['vacation', 'sick', 'personal', 'other'].includes(type) ? type : 'vacation';
  const info = db
    .prepare('INSERT INTO leave_requests (user_id, type, start_date, end_date, reason) VALUES (?, ?, ?, ?, ?)')
    .run(user.id, leaveType, startDate, endDate, reason?.trim() ?? '');
  logActivity(user.id, 'leave', Number(info.lastInsertRowid), 'requested', { startDate, endDate, type: leaveType });

  // Route the request to whoever can decide it: dept head, or CEO for heads/unassigned.
  const head = db
    .prepare(
      `SELECT d.head_user_id FROM memberships m JOIN departments d ON d.id = m.department_id
       WHERE m.user_id = ?`
    )
    .get(user.id) as { head_user_id: number | null } | undefined;
  let decider = head?.head_user_id && head.head_user_id !== user.id ? head.head_user_id : null;
  if (!decider) {
    const ceo = db.prepare('SELECT id FROM users WHERE is_ceo = 1').get() as { id: number } | undefined;
    decider = ceo && ceo.id !== user.id ? ceo.id : null;
  }
  if (decider) {
    notify(decider, 'leave', `${user.name} requested ${leaveType} leave (${startDate} → ${endDate})`, '/portal/leave');
  }
  res.json({ id: Number(info.lastInsertRowid) });
});

leaveRouter.get('/leave', requireAuth, (req, res) => {
  const user = req.user!;
  const own = db
    .prepare('SELECT * FROM leave_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 60')
    .all(user.id);

  let team: unknown[] = [];
  if (user.isCeo) {
    team = db
      .prepare(
        `SELECT l.*, u.name AS user_name FROM leave_requests l JOIN users u ON u.id = l.user_id
         WHERE l.user_id != ? ORDER BY l.created_at DESC LIMIT 200`
      )
      .all(user.id);
  } else if (user.role === 'head') {
    team = db
      .prepare(
        `SELECT l.*, u.name AS user_name FROM leave_requests l
         JOIN users u ON u.id = l.user_id
         JOIN memberships m ON m.user_id = l.user_id AND m.department_id = ?
         WHERE l.user_id != ? ORDER BY l.created_at DESC LIMIT 200`
      )
      .all(user.departmentId, user.id);
  }
  res.json({ own, team });
});

leaveRouter.post('/leave/:id/decide', requireAuth, (req, res) => {
  const user = req.user!;
  const request = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(Number(req.params.id)) as
    | LeaveRow
    | undefined;
  if (!request) return res.status(404).json({ error: 'Not found' });
  if (!canDecide(user, request)) return res.status(403).json({ error: 'Not authorized to decide this request' });
  if (request.status !== 'pending') return res.status(409).json({ error: 'Already decided' });

  const { status } = req.body ?? {};
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status' });

  db.prepare(
    "UPDATE leave_requests SET status = ?, decided_by = ?, decided_at = datetime('now') WHERE id = ?"
  ).run(status, user.id, request.id);
  logActivity(user.id, 'leave', request.id, `leave_${status}`, { userId: request.user_id });
  notify(
    request.user_id,
    'leave',
    `Your leave request (${request.start_date} → ${request.end_date}) was ${status}`,
    '/portal/leave'
  );
  res.json({ ok: true });
});

// Calendar feed: approved leaves overlapping the given month, scoped like
// everything else — CEO all, head own dept, employee self.
leaveRouter.get('/leave/calendar', requireAuth, (req, res) => {
  const user = req.user!;
  const month = String(req.query.month ?? '').match(/^\d{4}-\d{2}$/)
    ? String(req.query.month)
    : new Date().toISOString().slice(0, 7);
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-31`;

  let rows;
  if (user.isCeo) {
    rows = db
      .prepare(
        `SELECT l.*, u.name AS user_name FROM leave_requests l JOIN users u ON u.id = l.user_id
         WHERE l.status = 'approved' AND l.start_date <= ? AND l.end_date >= ?`
      )
      .all(monthEnd, monthStart);
  } else if (user.role === 'head') {
    rows = db
      .prepare(
        `SELECT l.*, u.name AS user_name FROM leave_requests l
         JOIN users u ON u.id = l.user_id
         JOIN memberships m ON m.user_id = l.user_id AND m.department_id = ?
         WHERE l.status = 'approved' AND l.start_date <= ? AND l.end_date >= ?`
      )
      .all(user.departmentId, monthEnd, monthStart);
  } else {
    rows = db
      .prepare(
        `SELECT l.*, ? AS user_name FROM leave_requests l
         WHERE l.user_id = ? AND l.status = 'approved' AND l.start_date <= ? AND l.end_date >= ?`
      )
      .all(user.name, user.id, monthEnd, monthStart);
  }
  res.json({ month, leaves: rows });
});
