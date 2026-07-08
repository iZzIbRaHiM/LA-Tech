import { Router } from 'express';
import { db, logActivity, notify } from './db.js';
import { requireAuth, requireCeo, userCanSeeProject } from './auth.js';
import { isWeekday } from './attendance.js';

// Milestones (project timeline), CEO attendance reports, and the audit viewer.
export const extrasRouter = Router();

// ---------- Milestones ----------
// Read: anyone who can see the project. Create/delete: CEO (projects are his).
// Toggle complete: CEO or a head whose department has visibility (they do the work).
extrasRouter.get('/projects/:id/milestones', requireAuth, async (req, res) => {
  const projectId = Number(req.params.id);
  if (!userCanSeeProject(req.user!, projectId)) return res.status(404).json({ error: 'Not found' });
  const rows = await db
    .prepare('SELECT * FROM milestones WHERE project_id = ? ORDER BY position, due_date, id')
    .all(projectId);
  res.json({ milestones: rows });
});

extrasRouter.post('/projects/:id/milestones', requireAuth, requireCeo, async (req, res) => {
  const projectId = Number(req.params.id);
  const project = await db.prepare('SELECT id, name FROM projects WHERE id = ?').get(projectId);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const { title, dueDate } = req.body ?? {};
  if (!title?.trim()) return res.status(400).json({ error: 'Title required' });
  const max = await db
    .prepare('SELECT COALESCE(MAX(position), 0) AS p FROM milestones WHERE project_id = ?')
    .get(projectId) as { p: number };
  const info = await db
    .prepare('INSERT INTO milestones (project_id, title, due_date, position) VALUES (?, ?, ?, ?)')
    .run(projectId, title.trim(), dueDate ?? null, max.p + 1);
  await logActivity(req.user!.id, 'project', projectId, 'milestone_added', { title });
  res.json({ id: Number(info.lastInsertRowid) });
});

extrasRouter.patch('/milestones/:id', requireAuth, async (req, res) => {
  const user = req.user!;
  const milestone = await db.prepare('SELECT * FROM milestones WHERE id = ?').get(Number(req.params.id)) as
    | { id: number; project_id: number; title: string; completed_at: string | null }
    | undefined;
  if (!milestone || !userCanSeeProject(user, milestone.project_id)) {
    return res.status(404).json({ error: 'Not found' });
  }
  const canToggle = user.isCeo || user.role === 'head';
  if (!canToggle) return res.status(403).json({ error: 'Heads and the CEO update milestones' });

  const { completed, title, dueDate } = req.body ?? {};
  if (completed !== undefined) {
    await db.prepare("UPDATE milestones SET completed_at = ? WHERE id = ?").run(
      completed ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null,
      milestone.id
    );
    await logActivity(user.id, 'project', milestone.project_id, completed ? 'milestone_completed' : 'milestone_reopened', {
      title: milestone.title,
    });
  }
  if (user.isCeo) {
    if (title?.trim()) await db.prepare('UPDATE milestones SET title = ? WHERE id = ?').run(title.trim(), milestone.id);
    if (dueDate !== undefined) await db.prepare('UPDATE milestones SET due_date = ? WHERE id = ?').run(dueDate, milestone.id);
  }
  res.json({ ok: true });
});

extrasRouter.delete('/milestones/:id', requireAuth, requireCeo, async (req, res) => {
  const milestone = await db.prepare('SELECT id, project_id FROM milestones WHERE id = ?').get(Number(req.params.id)) as
    | { id: number; project_id: number }
    | undefined;
  if (!milestone) return res.status(404).json({ error: 'Not found' });
  await db.prepare('DELETE FROM milestones WHERE id = ?').run(milestone.id);
  await logActivity(req.user!.id, 'project', milestone.project_id, 'milestone_deleted');
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

async function attendanceReport(month: string): Promise<ReportRow[]> {
  return await db
    .prepare(
      `SELECT u.id AS user_id, u.name, d.name AS department,
        -- Rejected records don't count toward days/hours — that's the point of validation.
        COUNT(DISTINCT CASE WHEN a.validation_status != 'rejected' THEN date(a.check_in) END) AS days_present,
        COALESCE(SUM(CASE WHEN a.validation_status != 'rejected'
          THEN EXTRACT(EPOCH FROM (a.check_out::timestamp - a.check_in::timestamp)) / 60 ELSE 0 END), 0) AS total_minutes,
        SUM(CASE WHEN a.validation_status = 'approved' THEN 1 ELSE 0 END) AS approved,
        SUM(CASE WHEN a.validation_status = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN a.validation_status = 'rejected' THEN 1 ELSE 0 END) AS rejected
       FROM users u
       LEFT JOIN memberships m ON m.user_id = u.id
       LEFT JOIN departments d ON d.id = m.department_id
       JOIN attendance a ON a.user_id = u.id AND strftime('%Y-%m', a.check_in) = ? AND a.check_out IS NOT NULL
       WHERE u.is_ceo = 0
       GROUP BY u.id, u.name, d.name ORDER BY u.name`
    )
    .all(month) as ReportRow[];
}

const monthParam = (q: unknown) =>
  String(q ?? '').match(/^\d{4}-\d{2}$/) ? String(q) : new Date().toISOString().slice(0, 7);

extrasRouter.get('/reports/attendance', requireAuth, requireCeo, async (req, res) => {
  const month = monthParam(req.query.month);
  const rows = await attendanceReport(month);
  res.json({ month, rows });
});

extrasRouter.get('/reports/attendance.csv', requireAuth, requireCeo, async (req, res) => {
  const month = monthParam(req.query.month);
  const rows = await attendanceReport(month);
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
extrasRouter.get('/audit', requireAuth, requireCeo, async (req, res) => {
  const entityType = String(req.query.entity_type ?? '');
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Number(req.query.offset) || 0;
  const where = entityType ? 'WHERE a.entity_type = ?' : '';
  const params = entityType ? [entityType, limit, offset] : [limit, offset];
  const rows = await db
    .prepare(
      `SELECT a.*, u.name AS actor_name FROM activity_log a JOIN users u ON u.id = a.actor_id
       ${where} ORDER BY a.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params);
  const types = await db.prepare('SELECT DISTINCT entity_type FROM activity_log ORDER BY entity_type').all();
  res.json({ audit: rows, types });
});

// ---------- Due-date reminders ----------
// Called hourly from index.ts: notifies assignees of tasks due within 24h,
// once per task (due_notified flag).
export async function sendDueReminders() {
  const rows = await db
    .prepare(
      `SELECT id, title, assigned_to, due_date FROM tasks
       WHERE status != 'done' AND due_notified = 0 AND assigned_to IS NOT NULL
         AND due_date IS NOT NULL AND date(due_date) <= date('now', '+1 day')`
    )
    .all() as Array<{ id: number; title: string; assigned_to: number; due_date: string }>;
  for (const t of rows) {
    await notify(t.assigned_to, 'due', `Task due ${t.due_date}: ${t.title}`, `/portal/tasks/${t.id}`);
    await db.prepare('UPDATE tasks SET due_notified = 1 WHERE id = ?').run(t.id);
  }
  if (rows.length) console.log(`[reminders] sent ${rows.length} due-date reminder(s)`);
}

// ---------- Absence sweep ----------
// Runs once daily (piggybacking on the reminders cron, not a second Vercel
// cron slot — Hobby tier only allows one). Fires at 00:00 UTC, so "today" has
// just started and "yesterday" is the most recently fully-completed day —
// that's the day this sweep marks absences for, never same-day.
// A user is marked absent for a work day (Mon-Fri, §2 of the PRD addendum)
// only if they have no attendance record at all for that day AND no approved
// leave covering it. Marked pre-approved (nothing to dispute — there's no
// check-in to validate) but deletable by a validator if it's wrong.
// The CEO is excluded entirely — attendance tracking doesn't apply to them.
export async function sweepAbsences() {
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
  if (!isWeekday(yesterday)) return;

  const ceo = await db.prepare('SELECT id FROM users WHERE is_ceo = 1').get() as { id: number } | undefined;
  if (!ceo) return; // no CEO seeded yet — nothing to attribute the sweep's audit-log entries to

  const users = await db.prepare('SELECT id FROM users WHERE active = 1 AND is_ceo = 0').all() as Array<{ id: number }>;
  let created = 0;
  for (const u of users) {
    const hasRecord = await db
      .prepare('SELECT 1 FROM attendance WHERE user_id = ? AND record_date = ?')
      .get(u.id, yesterday);
    if (hasRecord) continue;

    const onLeave = await db
      .prepare(
        "SELECT 1 FROM leave_requests WHERE user_id = ? AND status = 'approved' AND start_date <= ? AND end_date >= ?"
      )
      .get(u.id, yesterday, yesterday);
    if (onLeave) continue;

    const info = await db
      .prepare(
        "INSERT INTO attendance (user_id, check_in, check_out, record_date, category, validation_status) VALUES (?, ?, ?, ?, 'absent', 'approved')"
      )
      .run(u.id, null, null, yesterday);
    await logActivity(ceo.id, 'attendance', Number(info.lastInsertRowid), 'marked_absent', { userId: u.id, date: yesterday });
    await notify(u.id, 'attendance', `You were marked absent for ${yesterday} — no check-in recorded`, '/portal/attendance');
    created++;
  }
  if (created) console.log(`[absence-sweep] marked ${created} absence(s) for ${yesterday}`);
}

// Secure Cron route for Vercel (invoked daily — see vercel.json; Hobby-tier
// cron jobs are limited to once per day)
extrasRouter.get('/cron/reminders', async (req, res) => {
  const authHeader = req.headers.authorization;
  const expectedSecret = process.env.CRON_SECRET;

  if (expectedSecret && authHeader !== `Bearer ${expectedSecret}`) {
    console.warn('[cron] Unauthorized reminder check attempt.');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('[cron] Running due-date reminders and absence sweep...');
  try {
    await sendDueReminders();
    await sweepAbsences();
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[cron] Reminders/absence-sweep execution error:', err);
    res.status(500).json({ error: 'Reminders execution failed', detail: err.message });
  }
});
