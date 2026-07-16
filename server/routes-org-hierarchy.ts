import { Router } from 'express';
import { db, logActivity, notify } from './db.js';
import { requireAuth, requireCeo } from './auth.js';
import { wouldCreateCycle } from './org-hierarchy.js';

export const orgHierarchyRouter = Router();

// CEO-only for v1, matching how People/Salary/Audit/Settings are already
// strictly CEO-only (not delegate-based) in this codebase. Middleware is
// applied inline per route: a router.use('/org-tree', ...) prefix-mount
// made every route here 404 in the running app (same symptom previously
// affected routes-salary.ts, now also fixed; root cause never fully pinned
// down — a minimal repro of the pattern works — but inline is the pattern
// the rest of the codebase uses and is verified working).

// Flat list, not nested — trivial O(n) client-side tree assembly at this
// scale (tens to low hundreds of employees), survives partial updates
// without find-and-splice, and maps directly onto a node/edge graph shape.
// Presence is folded in here rather than a separate poll endpoint.
orgHierarchyRouter.get('/org-tree', requireAuth, requireCeo, async (_req, res) => {
  const users = await db
    .prepare(
      `SELECT u.id, u.name, u.email, u.title, u.phone, u.manager_id, u.is_ceo,
              u.finance_access, u.active,
              (u.last_seen_at IS NOT NULL AND u.last_seen_at::timestamp > now() - INTERVAL '75 seconds') AS online,
              m.department_id, d.name AS department_name, m.role AS membership_role,
              (SELECT COUNT(*) FROM users r WHERE r.manager_id = u.id AND r.active = 1)::int AS direct_reports_count
       FROM users u
       LEFT JOIN memberships m ON m.user_id = u.id
       LEFT JOIN departments d ON d.id = m.department_id
       WHERE u.active = 1
       ORDER BY u.name`
    )
    .all();
  res.json({ users });
});

orgHierarchyRouter.patch('/org-tree/users/:id', requireAuth, requireCeo, async (req, res) => {
  const actor = req.user!;
  const id = Number(req.params.id);
  const target = await db.prepare('SELECT id, is_ceo, active, manager_id FROM users WHERE id = ?').get(id) as
    | { id: number; is_ceo: number; active: number; manager_id: number | null }
    | undefined;
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (!target.active) return res.status(400).json({ error: 'User is deactivated — reactivate first' });

  const { managerId, title, phone } = req.body ?? {};
  const sets: Array<[string, unknown]> = [];

  if (managerId !== undefined) {
    if (target.is_ceo) return res.status(400).json({ error: "The CEO's manager cannot be changed" });
    const newManagerId = managerId === null ? null : Number(managerId);
    if (newManagerId !== null) {
      const proposed = await db.prepare('SELECT id, active FROM users WHERE id = ?').get(newManagerId) as
        | { id: number; active: number }
        | undefined;
      if (!proposed) return res.status(404).json({ error: 'Proposed manager not found' });
      if (!proposed.active) return res.status(400).json({ error: 'Proposed manager is deactivated' });
      if (await wouldCreateCycle(id, newManagerId)) {
        return res.status(409).json({ error: 'That would create a reporting cycle' });
      }
    }
    sets.push(['manager_id', newManagerId]);
  }
  if (title !== undefined) sets.push(['title', String(title).trim()]);
  if (phone !== undefined) sets.push(['phone', String(phone).trim()]);

  for (const [col, val] of sets) {
    await db.prepare(`UPDATE users SET ${col} = ? WHERE id = ?`).run(val, id);
  }
  if (sets.length) {
    await logActivity(actor.id, 'user', id, 'org_updated', { managerId, title, phone });
  }
  if (managerId !== undefined && Number(managerId) !== target.manager_id) {
    await notify(id, 'org', 'Your manager has changed', '/portal/org');
  }
  res.json({ ok: true });
});
