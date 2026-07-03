import { Router } from 'express';
import { db, logActivity, notify } from './db';
import { requireAuth, requireCeo, userCanSeeProject } from './auth';

// Milestones (project timeline), CEO attendance reports, and the audit viewer.
export const extrasRouter = Router();

// ---------- Milestones ----------
// Read: anyone who can see the project. Create/delete: CEO (projects are his).
// Toggle complete: CEO or a head whose department has visibility (they do the work).
extrasRouter.get('/projects/:id/milestones', requireAuth, (req, res) => {
  const projectId = Number(req.params.id);
  if (!userCanSeeProject(req.user!, projectId)) return res.status(404).json({ error: 'Not found' });
  const rows = db
    .prepare('SELECT * FROM milestones WHERE project_id = ? ORDER BY position, due_date, id')
    .all(projectId);
  res.json({ milestones: rows });
});

extrasRouter.post('/projects/:id/milestones', requireAuth, requireCeo, (req, res) => {
  const projectId = Number(req.params.id);
  const project = db.prepare('SELECT id, name FROM projects WHERE id = ?').get(projectId);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const { title, dueDate } = req.body ?? {};
  if (!title?.trim()) return res.status(400).json({ error: 'Title required' });
  const max = db
    .prepare('SELECT COALESCE(MAX(position), 0) AS p FROM milestones WHERE project_id = ?')
    .get(projectId) as { p: number };
  const info = db
    .prepare('INSERT INTO milestones (project_id, title, due_date, position) VALUES (?, ?, ?, ?)')
    .run(projectId, title.trim(), dueDate ?? null, max.p + 1);
  logActivity(req.user!.id, 'project', projectId, 'milestone_added', { title });
  res.json({ id: Number(info.lastInsertRowid) });
});

extrasRouter.patch('/milestones/:id', requireAuth, (req, res) => {
  const user = req.user!;
  const milestone = db.prepare('SELECT * FROM milestones WHERE id = ?').get(Number(req.params.id)) as
    | { id: number; project_id: number; title: string; completed_at: string | null }
    | undefined;
  if (!milestone || !userCanSeeProject(user, milestone.project_id)) {
    return res.status(404).json({ error: 'Not found' });
  }
  const canToggle = user.isCeo || user.role === 'head';
  if (!canToggle) return res.status(403).json({ error: 'Heads and the CEO update milestones' });

  const { completed, title, dueDate } = req.body ?? {};
  if (completed !== undefined) {
    db.prepare("UPDATE milestones SET completed_at = ? WHERE id = ?").run(
      completed ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null,
      milestone.id
    );
    logActivity(user.id, 'project', milestone.project_id, completed ? 'milestone_completed' : 'milestone_reopened', {
      title: milestone.title,
    });
  }
  if (user.isCeo) {
    if (title?.trim()) db.prepare('UPDATE milestones SET title = ? WHERE id = ?').run(title.trim(), milestone.id);
    if (dueDate !== undefined) db.prepare('UPDATE milestones SET due_date = ? WHERE id = ?').run(dueDate, milestone.id);
  }
  res.json({ ok: true });
});

extrasRouter.delete('/milestones/:id', requireAuth, requireCeo, (req, res) => {
  const milestone = db.prepare('SELECT id, project_id FROM milestones WHERE id = ?').get(Number(req.params.id)) as
    | { id: number; project_id: number }
    | undefined;
  if (!milestone) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM milestones WHERE id = ?').run(milestone.id);
  logActivity(req.user!.id, 'project', milestone.project_id, 'milestone_deleted');
  res.json({ ok: true });
});

// ---------- Attendance reports (CEO only) ----------
interface ReportRow {
  user_id: number;
  name: string;
  department: string | null;
  days_present: number;
  total_minutes: number;
  approved: number;
  pending: number;
  rejected: number;
}

function attendanceReport(month: string): ReportRow[] {
  return db
    .prepare(
      `SELECT u.id AS user_id, u.name, d.name AS department,
        COUNT(DISTINCT date(a.check_in)) AS days_present,
        COALESCE(SUM((julianday(a.check_out) - julianday(a.check_in)) * 24 * 60), 0) AS total_minutes,
        SUM(CASE WHEN a.validation_status = 'approved' THEN 1 ELSE 0 END) AS approved,
        SUM(CASE WHEN a.validation_status = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN a.validation_status = 'rejected' THEN 1 ELSE 0 END) AS rejected
       FROM users u
       LEFT JOIN memberships m ON m.user_id = u.id
       LEFT JOIN departments d ON d.id = m.department_id
       JOIN attendance a ON a.user_id = u.id AND strftime('%Y-%m', a.check_in) = ? AND a.check_out IS NOT NULL
       GROUP BY u.id ORDER BY u.name`
    )
    .all(month) as ReportRow[];
}

const monthParam = (q: unknown) =>
  String(q ?? '').match(/^\d{4}-\d{2}$/) ? String(q) : new Date().toISOString().slice(0, 7);

extrasRouter.get('/reports/attendance', requireAuth, requireCeo, (req, res) => {
  const month = monthParam(req.query.month);
  res.json({ month, rows: attendanceReport(month) });
});

extrasRouter.get('/reports/attendance.csv', requireAuth, requireCeo, (req, res) => {
  const month = monthParam(req.query.month);
  const rows = attendanceReport(month);
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [
    'employee,department,days_present,total_hours,approved,pending,rejected',
    ...rows.map((r) =>
      [r.name, r.department ?? '', r.days_present, (r.total_minutes / 60).toFixed(2), r.approved, r.pending, r.rejected]
        .map(esc)
        .join(',')
    ),
  ];
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="attendance_${month}.csv"`);
  res.send(lines.join('\n'));
});

// ---------- Audit log viewer (CEO only) ----------
extrasRouter.get('/audit', requireAuth, requireCeo, (req, res) => {
  const entityType = String(req.query.entity_type ?? '');
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Number(req.query.offset) || 0;
  const where = entityType ? 'WHERE a.entity_type = ?' : '';
  const params = entityType ? [entityType, limit, offset] : [limit, offset];
  const rows = db
    .prepare(
      `SELECT a.*, u.name AS actor_name FROM activity_log a JOIN users u ON u.id = a.actor_id
       ${where} ORDER BY a.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params);
  const types = db.prepare('SELECT DISTINCT entity_type FROM activity_log ORDER BY entity_type').all();
  res.json({ audit: rows, types });
});

// ---------- Due-date reminders ----------
// Called hourly from index.ts: notifies assignees of tasks due within 24h,
// once per task (due_notified flag).
export function sendDueReminders() {
  const rows = db
    .prepare(
      `SELECT id, title, assigned_to, due_date FROM tasks
       WHERE status != 'done' AND due_notified = 0 AND assigned_to IS NOT NULL
         AND due_date IS NOT NULL AND date(due_date) <= date('now', '+1 day')`
    )
    .all() as Array<{ id: number; title: string; assigned_to: number; due_date: string }>;
  for (const t of rows) {
    notify(t.assigned_to, 'due', `Task due ${t.due_date}: ${t.title}`, `/portal/tasks/${t.id}`);
    db.prepare('UPDATE tasks SET due_notified = 1 WHERE id = ?').run(t.id);
  }
  if (rows.length) console.log(`[reminders] sent ${rows.length} due-date reminder(s)`);
}
