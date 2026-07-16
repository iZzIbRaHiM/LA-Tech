import { Router } from 'express';
import { db, logActivity, notify } from './db.js';
import { requireAuth, requireCeo, userCanSeeProject } from './auth.js';

export const projectsRouter = Router();

// Mirrors the CHECK constraint on projects.status (db.ts).
const PROJECT_STATUSES = ['active', 'on_hold', 'completed', 'archived'];

// PRD §4.3: allow-list, not default-open. Non-granted departments must not
// even learn a project exists — so listing filters at the query level.
projectsRouter.get('/projects', requireAuth, async (req, res) => {
  const user = req.user!;
  let rows;
  if (user.isCeo) {
    rows = await db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
  } else if (user.departmentId != null) {
    rows = await db
      .prepare(
        `SELECT p.* FROM projects p
         JOIN project_visibility pv ON pv.project_id = p.id AND pv.department_id = ?
         ORDER BY p.created_at DESC`
      )
      .all(user.departmentId);
  } else {
    rows = [];
  }
  res.json({ projects: rows });
});

projectsRouter.get('/projects/:id', requireAuth, async (req, res) => {
  const user = req.user!;
  const id = Number(req.params.id);
  // 404 (not 403) when unauthorized: existence itself is confidential (PRD §4.3).
  if (!(await userCanSeeProject(user, id))) return res.status(404).json({ error: 'Not found' });
  const project = await db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!project) return res.status(404).json({ error: 'Not found' });

  const visibility = user.isCeo
    ? await db
        .prepare(
          `SELECT d.id, d.name FROM project_visibility pv JOIN departments d ON d.id = pv.department_id
           WHERE pv.project_id = ?`
        )
        .all(id)
    : undefined;

  // Linked tasks, still scoped by the viewer's task visibility (PRD §5).
  let tasks;
  if (user.isCeo) {
    tasks = await db.prepare('SELECT * FROM tasks WHERE project_id = ?').all(id);
  } else if (user.role === 'head') {
    tasks = await db.prepare('SELECT * FROM tasks WHERE project_id = ? AND department_id = ?').all(id, user.departmentId);
  } else {
    tasks = await db.prepare('SELECT * FROM tasks WHERE project_id = ? AND assigned_to = ?').all(id, user.id);
  }

  res.json({ project, visibility, tasks });
});

projectsRouter.post('/projects', requireAuth, requireCeo, async (req, res) => {
  const { name, description, startDate, endDate, departmentIds } = req.body ?? {};
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  if (!startDate || !endDate) return res.status(400).json({ error: 'Start date and end date are required' });
  if (String(endDate) < String(startDate)) return res.status(400).json({ error: 'End date must be on or after the start date' });
  const info = await db
    .prepare('INSERT INTO projects (name, description, owner_id, start_date, end_date) VALUES (?, ?, ?, ?, ?)')
    .run(name.trim(), description ?? '', req.user!.id, startDate, endDate);
  const projectId = Number(info.lastInsertRowid);

  for (const deptId of departmentIds ?? []) {
    await db.prepare('INSERT OR IGNORE INTO project_visibility (project_id, department_id) VALUES (?, ?)').run(
      projectId,
      Number(deptId)
    );
    const head = await db.prepare('SELECT head_user_id FROM departments WHERE id = ?').get(Number(deptId)) as
      | { head_user_id: number | null }
      | undefined;
    if (head?.head_user_id) {
      await notify(head.head_user_id, 'project', `Your department was granted access to project: ${name.trim()}`, `/portal/projects/${projectId}`);
    }
  }
  await logActivity(req.user!.id, 'project', projectId, 'created', { name, departmentIds });
  res.json({ id: projectId });
});

// Hard delete — CEO only. finance_entries, project_visibility, and
// milestones cascade at the FK level; linked tasks survive with
// project_id nulled (SET NULL) — deleting a project must not destroy the
// team's work items. Attachment rows for the cascaded finance entries are
// swept manually (polymorphic table, no FK).
projectsRouter.delete('/projects/:id', requireAuth, requireCeo, async (req, res) => {
  const id = Number(req.params.id);
  const project = await db.prepare('SELECT id, name FROM projects WHERE id = ?').get(id) as
    | { id: number; name: string }
    | undefined;
  if (!project) return res.status(404).json({ error: 'Not found' });

  const financeCount = (await db.prepare('SELECT COUNT(*) AS c FROM finance_entries WHERE project_id = ?').get(id)) as { c: number };
  const taskCount = (await db.prepare('SELECT COUNT(*) AS c FROM tasks WHERE project_id = ?').get(id)) as { c: number };

  await db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  await db
    .prepare("DELETE FROM attachments WHERE entity_type = 'finance' AND entity_id NOT IN (SELECT id FROM finance_entries)")
    .run();
  await logActivity(req.user!.id, 'project', id, 'deleted', {
    name: project.name,
    financeEntriesDeleted: Number(financeCount.c),
    tasksUnlinked: Number(taskCount.c),
  });
  res.json({ ok: true });
});

projectsRouter.patch('/projects/:id', requireAuth, requireCeo, async (req, res) => {
  const id = Number(req.params.id);
  const project = await db.prepare('SELECT id FROM projects WHERE id = ?').get(id);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const { name, description, status, startDate, endDate, departmentIds } = req.body ?? {};
  if (startDate !== undefined && endDate !== undefined && startDate && endDate && String(endDate) < String(startDate)) {
    return res.status(400).json({ error: 'End date must be on or after the start date' });
  }
  if (status !== undefined && !PROJECT_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const sets: Array<[string, unknown]> = [];
  if (name?.trim()) sets.push(['name', name.trim()]);
  if (description !== undefined) sets.push(['description', description]);
  if (status) sets.push(['status', status]);
  if (startDate !== undefined) sets.push(['start_date', startDate]);
  if (endDate !== undefined) sets.push(['end_date', endDate]);
  for (const [col, val] of sets) {
    await db.prepare(`UPDATE projects SET ${col} = ? WHERE id = ?`).run(val, id);
  }

  if (Array.isArray(departmentIds)) {
    const beforeRows = await db.prepare('SELECT department_id FROM project_visibility WHERE project_id = ?').all(id) as Array<{
      department_id: number;
    }>;
    const before = new Set(beforeRows.map((r) => r.department_id));
    const projectRow = await db.prepare('SELECT name FROM projects WHERE id = ?').get(id) as { name: string };
    const projectName = projectRow.name;
    await db.prepare('DELETE FROM project_visibility WHERE project_id = ?').run(id);
    for (const deptId of departmentIds) {
      await db.prepare('INSERT OR IGNORE INTO project_visibility (project_id, department_id) VALUES (?, ?)').run(
        id,
        Number(deptId)
      );
      // Newly granted departments get the same heads-up as on project creation.
      if (!before.has(Number(deptId))) {
        const head = await db.prepare('SELECT head_user_id FROM departments WHERE id = ?').get(Number(deptId)) as
          | { head_user_id: number | null }
          | undefined;
        if (head?.head_user_id) {
          await notify(
            head.head_user_id,
            'project',
            `Your department was granted access to project: ${projectName}`,
            `/portal/projects/${id}`
          );
        }
      }
    }
    await logActivity(req.user!.id, 'project', id, 'visibility_changed', { departmentIds });
  }
  if (sets.length) await logActivity(req.user!.id, 'project', id, 'updated');
  res.json({ ok: true });
});
