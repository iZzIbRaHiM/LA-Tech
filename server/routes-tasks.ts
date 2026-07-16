import { Router } from 'express';
import { db, logActivity, notify } from './db.js';
import { requireAuth, requireCeo } from './auth.js';
import { taskVisibilityWhere, userCanSeeProject, canManageTask } from './policy.js';

export const tasksRouter = Router();

// Mirrors the CHECK constraints on the tasks table (db.ts) — validating
// here returns a clean 400 instead of letting a bad value hit the DB and
// surface as a raw constraint-violation error.
const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const TASK_STATUSES = ['todo', 'in_progress', 'blocked', 'done'];

const TASK_SELECT = `
  SELECT t.*, u.name AS assignee_name, c.name AS creator_name, d.name AS department_name,
         p.name AS project_name
  FROM tasks t
  LEFT JOIN users u ON u.id = t.assigned_to
  LEFT JOIN users c ON c.id = t.created_by
  LEFT JOIN departments d ON d.id = t.department_id
  LEFT JOIN projects p ON p.id = t.project_id
`;

// Visibility predicates live in policy.ts (the RLS layer).
tasksRouter.get('/tasks', requireAuth, async (req, res) => {
  const { where, params } = taskVisibilityWhere(req.user!);
  const rows = await db.prepare(`${TASK_SELECT} WHERE ${where} ORDER BY t.created_at DESC`).all(...params);
  res.json({ tasks: rows });
});

tasksRouter.get('/tasks/:id', requireAuth, async (req, res) => {
  const { where, params } = taskVisibilityWhere(req.user!);
  const task = await db.prepare(`${TASK_SELECT} WHERE t.id = ? AND ${where}`).get(Number(req.params.id), ...params);
  if (!task) return res.status(404).json({ error: 'Not found' });
  const comments = await db
    .prepare(
      `SELECT tc.*, u.name AS author_name FROM task_comments tc
       JOIN users u ON u.id = tc.author_id WHERE tc.task_id = ? ORDER BY tc.created_at`
    )
    .all(Number(req.params.id));
  // Sub-tasks are scoped by the same visibility predicate as the main list —
  // an employee viewing their own task must not see teammates' sub-tasks (§5).
  const subtasks = await db
    .prepare(`${TASK_SELECT} WHERE t.parent_task_id = ? AND ${where}`)
    .all(Number(req.params.id), ...params);
  res.json({ task, comments, subtasks });
});

tasksRouter.post('/tasks', requireAuth, async (req, res) => {
  const user = req.user!;
  const { title, description, priority, dueDate, projectId, departmentId, assignedTo, parentTaskId } = req.body ?? {};
  if (!title?.trim()) return res.status(400).json({ error: 'Title required' });
  if (priority !== undefined && !TASK_PRIORITIES.includes(priority)) {
    return res.status(400).json({ error: 'Invalid priority' });
  }

  let targetDept: number;
  let targetAssignee: number | null = null;

  if (user.isCeo) {
    // CEO → department (implicitly its head), PRD §4.2.
    targetDept = Number(departmentId);
    if (!targetDept) return res.status(400).json({ error: 'departmentId required' });
    const dept = await db.prepare('SELECT head_user_id FROM departments WHERE id = ? AND archived_at IS NULL').get(targetDept) as
      | { head_user_id: number | null }
      | undefined;
    if (!dept) return res.status(404).json({ error: 'Department not found' });
    targetAssignee = assignedTo ? Number(assignedTo) : dept.head_user_id;
  } else if (user.role === 'head') {
    // Head → members of their own department only, PRD §4.2/§5.
    targetDept = user.departmentId!;
    targetAssignee = Number(assignedTo);
    if (!targetAssignee) return res.status(400).json({ error: 'assignedTo required' });
    const member = await db
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
    const ok = await db
      .prepare('SELECT 1 FROM memberships WHERE user_id = ? AND department_id = ?')
      .get(targetAssignee, targetDept);
    if (!ok) return res.status(400).json({ error: 'Assignee does not belong to the task department' });
  }

  // Linking a project requires the creator to be able to see it.
  if (projectId && !(await userCanSeeProject(user, Number(projectId)))) {
    return res.status(403).json({ error: 'No access to that project' });
  }

  // A sub-task must hang off a task in the same department — otherwise the
  // parent's owner could never see it and the hierarchy silently forks.
  if (parentTaskId) {
    const parent = await db.prepare('SELECT department_id FROM tasks WHERE id = ?').get(Number(parentTaskId)) as
      | { department_id: number }
      | undefined;
    if (!parent) return res.status(404).json({ error: 'Parent task not found' });
    if (parent.department_id !== targetDept) {
      return res.status(400).json({ error: 'Sub-task must belong to the same department as its parent' });
    }
  }

  const info = await db
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
  await logActivity(user.id, 'task', taskId, 'created', { title, departmentId: targetDept });
  if (targetAssignee && targetAssignee !== user.id) {
    await notify(targetAssignee, 'task', `New task assigned: ${title.trim()}`, `/portal/tasks/${taskId}`);
  }
  res.json({ id: taskId });
});

tasksRouter.patch('/tasks/:id', requireAuth, async (req, res) => {
  const user = req.user!;
  const id = Number(req.params.id);
  const task = await db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as
    | { id: number; department_id: number; assigned_to: number | null; title: string; status: string }
    | undefined;
  if (!task) return res.status(404).json({ error: 'Not found' });

  const canManage = canManageTask(user, task);
  const isAssignee = task.assigned_to === user.id;
  if (!canManage && !isAssignee) return res.status(403).json({ error: 'No access' });

  const { status, priority, dueDate, assignedTo, title, description } = req.body ?? {};
  if (status !== undefined && !TASK_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  if (priority !== undefined && !TASK_PRIORITIES.includes(priority)) {
    return res.status(400).json({ error: 'Invalid priority' });
  }

  // Assignees can only move status; managers can edit everything. Checked
  // against undefined (not truthiness) so clearing a field to null/'' by a
  // non-manager is rejected too, instead of silently no-op'ing below.
  if (
    !canManage &&
    (priority !== undefined || dueDate !== undefined || assignedTo !== undefined || title !== undefined || description !== undefined)
  ) {
    return res.status(403).json({ error: 'Assignees can only update status' });
  }

  if (assignedTo !== undefined && canManage) {
    const newAssignee = assignedTo === null ? null : Number(assignedTo);
    if (newAssignee) {
      const ok = await db
        .prepare('SELECT 1 FROM memberships WHERE user_id = ? AND department_id = ?')
        .get(newAssignee, task.department_id);
      if (!ok) return res.status(400).json({ error: 'Assignee does not belong to the task department' });
      await notify(newAssignee, 'task', `Task reassigned to you: ${task.title}`, `/portal/tasks/${id}`);
    }
    await db.prepare("UPDATE tasks SET assigned_to = ?, updated_at = datetime('now') WHERE id = ?").run(newAssignee, id);
    await logActivity(user.id, 'task', id, 'reassigned', { assignedTo: newAssignee });
  }

  const fields: Array<[string, unknown]> = [];
  if (status) fields.push(['status', status]);
  if (canManage) {
    if (priority) fields.push(['priority', priority]);
    if (dueDate !== undefined) {
      fields.push(['due_date', dueDate]);
      // A new due date deserves a new reminder.
      fields.push(['due_notified', 0]);
    }
    if (title?.trim()) fields.push(['title', title.trim()]);
    if (description !== undefined) fields.push(['description', description]);
  }
  for (const [col, val] of fields) {
    await db.prepare(`UPDATE tasks SET ${col} = ?, updated_at = datetime('now') WHERE id = ?`).run(val, id);
  }
  if (status && status !== task.status) {
    await logActivity(user.id, 'task', id, 'status_changed', { from: task.status, to: status });
  }
  res.json({ ok: true });
});

// Hard delete — CEO only ("complete control"). Heads/assignees keep their
// existing edit rights; destruction stays with the CEO. Sub-tasks go with
// the parent (no orphans), comments cascade, attachment rows are swept
// since the attachments table is polymorphic (no FK cascade).
tasksRouter.delete('/tasks/:id', requireAuth, requireCeo, async (req, res) => {
  const id = Number(req.params.id);
  const task = await db.prepare('SELECT id, title FROM tasks WHERE id = ?').get(id) as
    | { id: number; title: string }
    | undefined;
  if (!task) return res.status(404).json({ error: 'Not found' });

  const subtasks = await db.prepare('SELECT id FROM tasks WHERE parent_task_id = ?').all(id) as Array<{ id: number }>;
  const allIds = [id, ...subtasks.map((s) => s.id)];
  const ph = allIds.map(() => '?').join(',');
  await db.prepare(`DELETE FROM attachments WHERE entity_type = 'task' AND entity_id IN (${ph})`).run(...allIds);
  await db.prepare(`DELETE FROM tasks WHERE id IN (${ph})`).run(...allIds);
  await logActivity(req.user!.id, 'task', id, 'deleted', { title: task.title, subtasksDeleted: subtasks.length });
  res.json({ ok: true, subtasksDeleted: subtasks.length });
});

tasksRouter.post('/tasks/:id/comments', requireAuth, async (req, res) => {
  const user = req.user!;
  const id = Number(req.params.id);
  const task = await db.prepare('SELECT department_id, assigned_to, created_by, title FROM tasks WHERE id = ?').get(id) as
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
  await db.prepare('INSERT INTO task_comments (task_id, author_id, body) VALUES (?, ?, ?)').run(id, user.id, body.trim());
  await logActivity(user.id, 'task', id, 'commented');
  for (const uid of new Set([task.assigned_to, task.created_by])) {
    if (uid && uid !== user.id) await notify(uid, 'comment', `New comment on: ${task.title}`, `/portal/tasks/${id}`);
  }
  res.json({ ok: true });
});
