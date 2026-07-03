import { Router } from 'express';
import { db, logActivity, notify } from './db';
import { requireAuth, userCanSeeProject } from './auth';

export const tasksRouter = Router();

const TASK_SELECT = `
  SELECT t.*, u.name AS assignee_name, c.name AS creator_name, d.name AS department_name,
         p.name AS project_name
  FROM tasks t
  LEFT JOIN users u ON u.id = t.assigned_to
  LEFT JOIN users c ON c.id = t.created_by
  LEFT JOIN departments d ON d.id = t.department_id
  LEFT JOIN projects p ON p.id = t.project_id
`;

// Visibility (PRD §5): CEO all; Head their department's tasks; Employee own assigned only.
function taskVisibilityWhere(user: NonNullable<Express.Request['user']>): { where: string; params: unknown[] } {
  if (user.isCeo) return { where: '1=1', params: [] };
  if (user.role === 'head') return { where: 't.department_id = ?', params: [user.departmentId] };
  return { where: 't.assigned_to = ?', params: [user.id] };
}

tasksRouter.get('/tasks', requireAuth, (req, res) => {
  const { where, params } = taskVisibilityWhere(req.user!);
  const rows = db.prepare(`${TASK_SELECT} WHERE ${where} ORDER BY t.created_at DESC`).all(...params);
  res.json({ tasks: rows });
});

tasksRouter.get('/tasks/:id', requireAuth, (req, res) => {
  const { where, params } = taskVisibilityWhere(req.user!);
  const task = db.prepare(`${TASK_SELECT} WHERE t.id = ? AND ${where}`).get(Number(req.params.id), ...params);
  if (!task) return res.status(404).json({ error: 'Not found' });
  const comments = db
    .prepare(
      `SELECT tc.*, u.name AS author_name FROM task_comments tc
       JOIN users u ON u.id = tc.author_id WHERE tc.task_id = ? ORDER BY tc.created_at`
    )
    .all(Number(req.params.id));
  const subtasks = db.prepare(`${TASK_SELECT} WHERE t.parent_task_id = ?`).all(Number(req.params.id));
  res.json({ task, comments, subtasks });
});

tasksRouter.post('/tasks', requireAuth, (req, res) => {
  const user = req.user!;
  const { title, description, priority, dueDate, projectId, departmentId, assignedTo, parentTaskId } = req.body ?? {};
  if (!title?.trim()) return res.status(400).json({ error: 'Title required' });

  let targetDept: number;
  let targetAssignee: number | null = null;

  if (user.isCeo) {
    // CEO → department (implicitly its head), PRD §4.2.
    targetDept = Number(departmentId);
    if (!targetDept) return res.status(400).json({ error: 'departmentId required' });
    const dept = db.prepare('SELECT head_user_id FROM departments WHERE id = ? AND archived_at IS NULL').get(targetDept) as
      | { head_user_id: number | null }
      | undefined;
    if (!dept) return res.status(404).json({ error: 'Department not found' });
    targetAssignee = assignedTo ? Number(assignedTo) : dept.head_user_id;
  } else if (user.role === 'head') {
    // Head → members of their own department only, PRD §4.2/§5.
    targetDept = user.departmentId!;
    targetAssignee = Number(assignedTo);
    if (!targetAssignee) return res.status(400).json({ error: 'assignedTo required' });
    const member = db
      .prepare('SELECT 1 FROM memberships WHERE user_id = ? AND department_id = ?')
      .get(targetAssignee, targetDept);
    if (!member) {
      return res.status(403).json({ error: 'Heads can only assign tasks within their own department' });
    }
  } else {
    return res.status(403).json({ error: 'Only the CEO and department heads can create tasks' });
  }

  // §6 invariant: assignee must belong to the task's department.
  if (targetAssignee) {
    const ok = db
      .prepare('SELECT 1 FROM memberships WHERE user_id = ? AND department_id = ?')
      .get(targetAssignee, targetDept);
    if (!ok) return res.status(400).json({ error: 'Assignee does not belong to the task department' });
  }

  // Linking a project requires the creator to be able to see it.
  if (projectId && !userCanSeeProject(user, Number(projectId))) {
    return res.status(403).json({ error: 'No access to that project' });
  }

  const info = db
    .prepare(
      `INSERT INTO tasks (title, description, priority, due_date, project_id, department_id, assigned_to, created_by, parent_task_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      title.trim(),
      description ?? '',
      priority ?? 'medium',
      dueDate ?? null,
      projectId ?? null,
      targetDept,
      targetAssignee,
      user.id,
      parentTaskId ?? null
    );
  const taskId = Number(info.lastInsertRowid);
  logActivity(user.id, 'task', taskId, 'created', { title, departmentId: targetDept });
  if (targetAssignee && targetAssignee !== user.id) {
    notify(targetAssignee, 'task', `New task assigned: ${title.trim()}`, `/portal/tasks/${taskId}`);
  }
  res.json({ id: taskId });
});

tasksRouter.patch('/tasks/:id', requireAuth, (req, res) => {
  const user = req.user!;
  const id = Number(req.params.id);
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as
    | { id: number; department_id: number; assigned_to: number | null; title: string; status: string }
    | undefined;
  if (!task) return res.status(404).json({ error: 'Not found' });

  const canManage = user.isCeo || (user.role === 'head' && user.departmentId === task.department_id);
  const isAssignee = task.assigned_to === user.id;
  if (!canManage && !isAssignee) return res.status(403).json({ error: 'No access' });

  const { status, priority, dueDate, assignedTo, title, description } = req.body ?? {};

  // Assignees can only move status; managers can edit everything.
  if (!canManage && (priority || dueDate || assignedTo || title || description)) {
    return res.status(403).json({ error: 'Assignees can only update status' });
  }

  if (assignedTo !== undefined && canManage) {
    const newAssignee = assignedTo === null ? null : Number(assignedTo);
    if (newAssignee) {
      const ok = db
        .prepare('SELECT 1 FROM memberships WHERE user_id = ? AND department_id = ?')
        .get(newAssignee, task.department_id);
      if (!ok) return res.status(400).json({ error: 'Assignee does not belong to the task department' });
      notify(newAssignee, 'task', `Task reassigned to you: ${task.title}`, `/portal/tasks/${id}`);
    }
    db.prepare("UPDATE tasks SET assigned_to = ?, updated_at = datetime('now') WHERE id = ?").run(newAssignee, id);
    logActivity(user.id, 'task', id, 'reassigned', { assignedTo: newAssignee });
  }

  const fields: Array<[string, unknown]> = [];
  if (status) fields.push(['status', status]);
  if (canManage) {
    if (priority) fields.push(['priority', priority]);
    if (dueDate !== undefined) fields.push(['due_date', dueDate]);
    if (title?.trim()) fields.push(['title', title.trim()]);
    if (description !== undefined) fields.push(['description', description]);
  }
  for (const [col, val] of fields) {
    db.prepare(`UPDATE tasks SET ${col} = ?, updated_at = datetime('now') WHERE id = ?`).run(val, id);
  }
  if (status && status !== task.status) {
    logActivity(user.id, 'task', id, 'status_changed', { from: task.status, to: status });
  }
  res.json({ ok: true });
});

tasksRouter.post('/tasks/:id/comments', requireAuth, (req, res) => {
  const user = req.user!;
  const id = Number(req.params.id);
  const task = db.prepare('SELECT department_id, assigned_to, created_by, title FROM tasks WHERE id = ?').get(id) as
    | { department_id: number; assigned_to: number | null; created_by: number; title: string }
    | undefined;
  if (!task) return res.status(404).json({ error: 'Not found' });
  const canSee =
    user.isCeo ||
    (user.role === 'head' && user.departmentId === task.department_id) ||
    task.assigned_to === user.id;
  if (!canSee) return res.status(403).json({ error: 'No access' });

  const { body } = req.body ?? {};
  if (!body?.trim()) return res.status(400).json({ error: 'Comment body required' });
  db.prepare('INSERT INTO task_comments (task_id, author_id, body) VALUES (?, ?, ?)').run(id, user.id, body.trim());
  logActivity(user.id, 'task', id, 'commented');
  for (const uid of new Set([task.assigned_to, task.created_by])) {
    if (uid && uid !== user.id) notify(uid, 'comment', `New comment on: ${task.title}`, `/portal/tasks/${id}`);
  }
  res.json({ ok: true });
});
