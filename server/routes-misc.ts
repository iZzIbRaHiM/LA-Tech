import { Router } from 'express';
import { db } from './db.js';
import { requireAuth } from './auth.js';

export const miscRouter = Router();

miscRouter.get('/notifications', requireAuth, async (req, res) => {
  const rows = await db
    .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50')
    .all(req.user!.id);
  res.json({ notifications: rows });
});

miscRouter.post('/notifications/read', requireAuth, async (req, res) => {
  await db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL").run(
    req.user!.id
  );
  res.json({ ok: true });
});

// Activity feed scoped to what the viewer may see (PRD §4.5):
// CEO everything; Head their department's tasks + own actions; Employee own tasks/actions.
miscRouter.get('/activity', requireAuth, async (req, res) => {
  const user = req.user!;
  let rows;
  if (user.isCeo) {
    rows = await db
      .prepare(
        `SELECT a.*, u.name AS actor_name FROM activity_log a JOIN users u ON u.id = a.actor_id
         ORDER BY a.created_at DESC LIMIT 50`
      )
      .all();
  } else if (user.role === 'head') {
    rows = await db
      .prepare(
        `SELECT a.*, u.name AS actor_name FROM activity_log a JOIN users u ON u.id = a.actor_id
         WHERE a.entity_type != 'finance' AND (
           a.actor_id = ?
           OR (a.entity_type = 'task' AND a.entity_id IN (SELECT id FROM tasks WHERE department_id = ?))
           OR (a.entity_type = 'department' AND a.entity_id = ?)
         )
         ORDER BY a.created_at DESC LIMIT 50`
      )
      .all(user.id, user.departmentId, user.departmentId);
  } else {
    rows = await db
      .prepare(
        `SELECT a.*, u.name AS actor_name FROM activity_log a JOIN users u ON u.id = a.actor_id
         WHERE a.entity_type != 'finance' AND (
           a.actor_id = ?
           OR (a.entity_type = 'task' AND a.entity_id IN (SELECT id FROM tasks WHERE assigned_to = ?))
         )
         ORDER BY a.created_at DESC LIMIT 50`
      )
      .all(user.id, user.id);
  }
  res.json({ activity: rows });
});

// Permission-scoped search (PRD §4.6): reuses the same visibility predicates
// as the list endpoints so search can never widen access.
miscRouter.get('/search', requireAuth, async (req, res) => {
  const user = req.user!;
  const q = `%${String(req.query.q ?? '').trim()}%`;
  if (q === '%%') return res.json({ tasks: [], projects: [] });

  let tasks;
  if (user.isCeo) {
    tasks = await db.prepare('SELECT id, title, status FROM tasks WHERE title LIKE ? LIMIT 10').all(q);
  } else if (user.role === 'head') {
    tasks = await db
      .prepare('SELECT id, title, status FROM tasks WHERE title LIKE ? AND department_id = ? LIMIT 10')
      .all(q, user.departmentId);
  } else {
    tasks = await db
      .prepare('SELECT id, title, status FROM tasks WHERE title LIKE ? AND assigned_to = ? LIMIT 10')
      .all(q, user.id);
  }

  let projects;
  if (user.isCeo) {
    projects = await db.prepare('SELECT id, name, status FROM projects WHERE name LIKE ? LIMIT 10').all(q);
  } else if (user.departmentId != null) {
    projects = await db
      .prepare(
        `SELECT p.id, p.name, p.status FROM projects p
         JOIN project_visibility pv ON pv.project_id = p.id AND pv.department_id = ?
         WHERE p.name LIKE ? LIMIT 10`
      )
      .all(user.departmentId, q);
  } else {
    projects = [];
  }

  res.json({ tasks, projects });
});
