import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db, logActivity, notify } from './db.js';
import { requireAuth, requireCeo, issueSession, logoutAndRevoke, loadSessionUser, bumpTokenVersion } from './auth.js';
import { passwordPolicyError } from './validation.js';

export const orgRouter = Router();

// ---------- Auth ----------
// Brute-force guard: sliding 15-minute window per email+IP, backed by the
// database — an in-memory Map doesn't work here since Vercel serverless
// functions don't share memory across instances or survive cold starts.
const MAX_ATTEMPTS = 10;

async function tooManyAttempts(key: string): Promise<boolean> {
  const row = (await db
    .prepare("SELECT COUNT(*) AS c FROM login_attempts WHERE attempt_key = ? AND created_at > now() - INTERVAL '15 minutes'")
    .get(key)) as { c: string | number };
  return Number(row.c) >= MAX_ATTEMPTS;
}

async function recordAttempt(key: string) {
  await db.prepare('INSERT INTO login_attempts (attempt_key) VALUES (?)').run(key);
  // Opportunistic housekeeping so the table doesn't grow unbounded.
  await db.prepare("DELETE FROM login_attempts WHERE created_at < now() - INTERVAL '1 day'").run();
}

async function clearAttempts(key: string) {
  await db.prepare('DELETE FROM login_attempts WHERE attempt_key = ?').run(key);
}

orgRouter.post('/auth/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const key = `${String(email).toLowerCase()}|${req.ip}`;
  if (await tooManyAttempts(key)) {
    return res.status(429).json({ error: 'Too many attempts — try again in 15 minutes' });
  }
  const row = await db.prepare('SELECT id, password_hash, active FROM users WHERE email = ?').get(email) as
    | { id: number; password_hash: string; active: number }
    | undefined;
  // Deactivated accounts fail with the same message as bad credentials so
  // the response doesn't reveal which accounts exist or their status.
  if (!row || !row.active || !bcrypt.compareSync(password, row.password_hash)) {
    await recordAttempt(key);
    // Failed attempts on real accounts land in the audit trail.
    if (row) await logActivity(row.id, 'auth', row.id, 'login_failed');
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  await clearAttempts(key);
  await issueSession(res, row.id);
  await logActivity(row.id, 'auth', row.id, 'login');
  res.json({ user: await loadSessionUser(row.id) });
});

orgRouter.post('/auth/logout', async (req, res) => {
  await logoutAndRevoke(req, res);
  res.json({ ok: true });
});

orgRouter.get('/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

orgRouter.post('/auth/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  const policyError = passwordPolicyError(newPassword);
  if (policyError) return res.status(400).json({ error: policyError });
  const row = await db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user!.id) as {
    password_hash: string;
  };
  if (!bcrypt.compareSync(currentPassword ?? '', row.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  await db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(
    bcrypt.hashSync(newPassword, 12),
    req.user!.id
  );
  // Revoke every other session for this account, then re-issue this one so
  // the user changing their password stays signed in.
  await bumpTokenVersion(req.user!.id);
  await issueSession(res, req.user!.id);
  await logActivity(req.user!.id, 'auth', req.user!.id, 'password_changed');
  res.json({ ok: true });
});

// ---------- Departments (CEO only for mutations, PRD §5) ----------
orgRouter.get('/departments', requireAuth, async (req, res) => {
  // CEO: full view. Head/member: own dept in full + other dept names/heads
  // (PRD §2 assumption 2 — existence is visible, contents are not).
  const departments = await db
    .prepare(
      `SELECT d.id, d.name, d.head_user_id, d.archived_at, u.name AS head_name
       FROM departments d LEFT JOIN users u ON u.id = d.head_user_id
       WHERE d.archived_at IS NULL`
    )
    .all() as Array<{ id: number; name: string; head_user_id: number | null; head_name: string | null }>;

  const withMembers = await Promise.all(
    departments.map(async (d) => {
      const isOwn = req.user!.isCeo || req.user!.departmentId === d.id;
      if (!isOwn) return { ...d, members: null };
      const members = await db
        .prepare(
          `SELECT u.id, u.name, u.email, u.finance_access, m.role FROM memberships m
           JOIN users u ON u.id = m.user_id WHERE m.department_id = ?`
        )
        .all(d.id);
      return { ...d, members };
    })
  );
  res.json({ departments: withMembers });
});

orgRouter.post('/departments', requireAuth, requireCeo, async (req, res) => {
  const { name } = req.body ?? {};
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  const dup = await db
    .prepare('SELECT 1 FROM departments WHERE LOWER(name) = LOWER(?) AND archived_at IS NULL')
    .get(name.trim());
  if (dup) return res.status(409).json({ error: 'A department with this name already exists' });
  const info = await db
    .prepare('INSERT INTO departments (name, created_by) VALUES (?, ?)')
    .run(name.trim(), req.user!.id);
  await logActivity(req.user!.id, 'department', Number(info.lastInsertRowid), 'created', { name });
  res.json({ id: Number(info.lastInsertRowid) });
});

orgRouter.patch('/departments/:id', requireAuth, requireCeo, async (req, res) => {
  const id = Number(req.params.id);
  const { name, archive } = req.body ?? {};
  if (name?.trim()) {
    await db.prepare('UPDATE departments SET name = ? WHERE id = ?').run(name.trim(), id);
    await logActivity(req.user!.id, 'department', id, 'renamed', { name });
  }
  if (archive === true) {
    const openTasks = await db
      .prepare("SELECT COUNT(*) AS c FROM tasks WHERE department_id = ? AND status != 'done'")
      .get(id) as { c: number };
    if (openTasks.c > 0) {
      return res.status(409).json({ error: `Department has ${openTasks.c} open task(s); reassign or complete them first` });
    }
    // Archiving with members would strand them in a department that no
    // longer appears anywhere (memberships would point at a hidden row).
    const members = await db.prepare('SELECT COUNT(*) AS c FROM memberships WHERE department_id = ?').get(id) as {
      c: number;
    };
    if (members.c > 0) {
      return res.status(409).json({ error: `Department still has ${members.c} member(s); remove them first` });
    }
    await db.prepare("UPDATE departments SET archived_at = datetime('now') WHERE id = ?").run(id);
    await logActivity(req.user!.id, 'department', id, 'archived');
  }
  res.json({ ok: true });
});

// ---------- Members ----------
// Assignment only: users are created in the People section, then assigned
// here from the unassigned pool. Keeps account lifecycle and org placement
// as two separate, auditable steps.
orgRouter.post('/departments/:id/members', requireAuth, requireCeo, async (req, res) => {
  const departmentId = Number(req.params.id);
  const dept = await db.prepare('SELECT id FROM departments WHERE id = ? AND archived_at IS NULL').get(departmentId);
  if (!dept) return res.status(404).json({ error: 'Department not found' });

  const userId = Number(req.body?.userId ?? req.body?.existingUserId);
  if (!userId) return res.status(400).json({ error: 'userId required — create the user in People first' });

  const target = await db.prepare('SELECT id, is_ceo, active FROM users WHERE id = ?').get(userId) as
    | { id: number; is_ceo: number; active: number }
    | undefined;
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.is_ceo) return res.status(400).json({ error: 'The CEO is not assignable to a department' });
  if (!target.active) return res.status(400).json({ error: 'User is deactivated' });
  const already = await db.prepare('SELECT department_id FROM memberships WHERE user_id = ?').get(userId) as
    | { department_id: number }
    | undefined;
  if (already) {
    return res.status(409).json({ error: 'User already belongs to a department (one department per user in v1)' });
  }

  // 'head' stays exclusive to the dedicated /head endpoint so "exactly one
  // head per department" can't be bypassed by assigning it here.
  const requestedRole = req.body?.role === 'intern' ? 'intern' : 'member';

  await db.prepare('INSERT INTO memberships (user_id, department_id, role) VALUES (?, ?, ?)').run(
    userId,
    departmentId,
    requestedRole
  );
  await logActivity(req.user!.id, 'department', departmentId, 'member_added', { userId, role: requestedRole });
  await notify(userId, 'org', `You were added to a department`, '/portal/departments');
  res.json({ userId });
});

// Toggle an existing member between 'member' and 'intern' without a
// remove/re-add cycle. Head status changes only through /head.
orgRouter.patch('/departments/:id/members/:userId', requireAuth, requireCeo, async (req, res) => {
  const departmentId = Number(req.params.id);
  const userId = Number(req.params.userId);
  const role = req.body?.role;
  if (!['member', 'intern'].includes(role)) return res.status(400).json({ error: "role must be 'member' or 'intern'" });

  const membership = await db
    .prepare('SELECT role FROM memberships WHERE user_id = ? AND department_id = ?')
    .get(userId, departmentId) as { role: string } | undefined;
  if (!membership) return res.status(404).json({ error: 'Not a member of this department' });
  if (membership.role === 'head') return res.status(400).json({ error: 'Reassign the head via /head first' });

  await db.prepare('UPDATE memberships SET role = ? WHERE user_id = ? AND department_id = ?').run(role, userId, departmentId);
  await logActivity(req.user!.id, 'department', departmentId, 'member_role_changed', { userId, role });
  res.json({ ok: true });
});

orgRouter.delete('/departments/:id/members/:userId', requireAuth, requireCeo, async (req, res) => {
  const departmentId = Number(req.params.id);
  const userId = Number(req.params.userId);
  const openTasks = await db
    .prepare("SELECT COUNT(*) AS c FROM tasks WHERE assigned_to = ? AND status != 'done'")
    .get(userId) as { c: number };
  if (openTasks.c > 0) {
    return res.status(409).json({ error: `User has ${openTasks.c} open task(s); reassign them first (PRD §4.1)` });
  }
  const dept = await db.prepare('SELECT head_user_id FROM departments WHERE id = ?').get(departmentId) as {
    head_user_id: number | null;
  };
  if (dept?.head_user_id === userId) {
    await db.prepare('UPDATE departments SET head_user_id = NULL WHERE id = ?').run(departmentId);
  }
  await db.prepare('DELETE FROM memberships WHERE user_id = ? AND department_id = ?').run(userId, departmentId);
  await logActivity(req.user!.id, 'department', departmentId, 'member_removed', { userId });
  res.json({ ok: true });
});

orgRouter.post('/departments/:id/head', requireAuth, requireCeo, async (req, res) => {
  const departmentId = Number(req.params.id);
  const { userId } = req.body ?? {};
  const membership = await db
    .prepare('SELECT 1 FROM memberships WHERE user_id = ? AND department_id = ?')
    .get(Number(userId), departmentId);
  if (!membership) return res.status(400).json({ error: 'Head must be an existing member of the department' });

  // Exactly one head at a time (PRD §3): demote current head, promote new one.
  await db.prepare("UPDATE memberships SET role = 'member' WHERE department_id = ? AND role = 'head'").run(departmentId);
  await db.prepare("UPDATE memberships SET role = 'head' WHERE user_id = ? AND department_id = ?").run(
    Number(userId),
    departmentId
  );
  await db.prepare('UPDATE departments SET head_user_id = ? WHERE id = ?').run(Number(userId), departmentId);
  await logActivity(req.user!.id, 'department', departmentId, 'head_assigned', { userId });
  await notify(Number(userId), 'org', 'You are now a department head', '/portal/departments');
  res.json({ ok: true });
});

// ---------- Users (People section — CEO only) ----------
orgRouter.get('/users', requireAuth, requireCeo, async (_req, res) => {
  const users = await db
    .prepare(
      `SELECT u.id, u.name, u.email, u.is_ceo, u.finance_access, u.active, u.must_change_password,
              m.department_id, m.role, d.name AS department_name
       FROM users u
       LEFT JOIN memberships m ON m.user_id = u.id
       LEFT JOIN departments d ON d.id = m.department_id
       ORDER BY u.active DESC, u.name`
    )
    .all();
  res.json({ users });
});

orgRouter.post('/users', requireAuth, requireCeo, async (req, res) => {
  const { name, email, password, managerId, title, phone } = req.body ?? {};
  if (!name?.trim() || !email?.trim()) return res.status(400).json({ error: 'Name and email required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return res.status(400).json({ error: 'Invalid email' });
  const createPolicyError = passwordPolicyError(password);
  if (createPolicyError) return res.status(400).json({ error: createPolicyError });
  const dup = await db.prepare('SELECT id FROM users WHERE email = ?').get(email.trim());
  if (dup) return res.status(409).json({ error: 'A user with this email already exists' });

  // Everyone needs a place in the reporting chain — default new hires under
  // the CEO so they're never orphaned; the org-tree "add report" flow
  // passes the clicked node's id instead.
  let resolvedManagerId: number | null = null;
  if (managerId !== undefined && managerId !== null) {
    const proposed = await db.prepare('SELECT id, active FROM users WHERE id = ?').get(Number(managerId)) as
      | { id: number; active: number }
      | undefined;
    if (!proposed || !proposed.active) return res.status(400).json({ error: 'Manager not found or inactive' });
    resolvedManagerId = proposed.id;
  } else {
    const ceo = await db.prepare('SELECT id FROM users WHERE is_ceo = 1').get() as { id: number } | undefined;
    resolvedManagerId = ceo?.id ?? null;
  }

  const info = await db
    .prepare(
      'INSERT INTO users (name, email, password_hash, must_change_password, manager_id, title, phone) VALUES (?, ?, ?, 1, ?, ?, ?)'
    )
    .run(name.trim(), email.trim(), bcrypt.hashSync(String(password), 12), resolvedManagerId, title?.trim() ?? '', phone?.trim() ?? '');
  await logActivity(req.user!.id, 'user', Number(info.lastInsertRowid), 'created', { email: email.trim() });
  res.json({ id: Number(info.lastInsertRowid) });
});

// Reset password: the only recovery path (no email-based reset by design —
// this is an internal tool and the CEO hands the temp password over directly).
orgRouter.post('/users/:id/reset-password', requireAuth, requireCeo, async (req, res) => {
  const userId = Number(req.params.id);
  const target = await db.prepare('SELECT id, is_ceo FROM users WHERE id = ?').get(userId) as
    | { id: number; is_ceo: number }
    | undefined;
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.is_ceo) return res.status(400).json({ error: 'Use change-password for your own account' });
  const { password } = req.body ?? {};
  const resetPolicyError = passwordPolicyError(password);
  if (resetPolicyError) return res.status(400).json({ error: resetPolicyError });
  await db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(
    bcrypt.hashSync(String(password), 12),
    userId
  );
  // A reset means the old credential is no longer trusted — end its sessions.
  await bumpTokenVersion(userId);
  await logActivity(req.user!.id, 'user', userId, 'password_reset');
  res.json({ ok: true });
});

// Deactivate/reactivate. Deactivation removes the membership (after the same
// open-task check as member removal) and kills any live session immediately,
// since sessions re-resolve the user on every request.
orgRouter.post('/users/:id/active', requireAuth, requireCeo, async (req, res) => {
  const userId = Number(req.params.id);
  const target = await db.prepare('SELECT id, is_ceo, active FROM users WHERE id = ?').get(userId) as
    | { id: number; is_ceo: number; active: number }
    | undefined;
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.is_ceo) return res.status(400).json({ error: 'The CEO account cannot be deactivated' });

  const activate = req.body?.active === true;
  if (!activate) {
    const openTasks = await db
      .prepare("SELECT COUNT(*) AS c FROM tasks WHERE assigned_to = ? AND status != 'done'")
      .get(userId) as { c: number };
    if (openTasks.c > 0) {
      return res.status(409).json({ error: `User has ${openTasks.c} open task(s); reassign them first` });
    }
    const membership = await db.prepare('SELECT department_id FROM memberships WHERE user_id = ?').get(userId) as
      | { department_id: number }
      | undefined;
    if (membership) {
      await db.prepare('UPDATE departments SET head_user_id = NULL WHERE id = ? AND head_user_id = ?').run(
        membership.department_id,
        userId
      );
      await db.prepare('DELETE FROM memberships WHERE user_id = ?').run(userId);
    }
  }
  if (!activate) {
    // Reports bubble up one level rather than being orphaned — the
    // deactivated user's own manager_id is left untouched (nothing about
    // them is erased, matching the soft-delete convention everywhere else
    // in this codebase). Reactivation needs no special handling since
    // manager_id was never touched.
    const current = await db.prepare('SELECT manager_id FROM users WHERE id = ?').get(userId) as {
      manager_id: number | null;
    };
    const reports = await db.prepare('SELECT id FROM users WHERE manager_id = ?').all(userId) as Array<{ id: number }>;
    if (reports.length > 0) {
      await db.prepare('UPDATE users SET manager_id = ? WHERE manager_id = ?').run(current.manager_id, userId);
      await logActivity(req.user!.id, 'user', userId, 'reports_bubbled_up', {
        count: reports.length,
        newManagerId: current.manager_id,
        affectedUserIds: reports.map((r) => r.id),
      });
    }
  }
  await db.prepare('UPDATE users SET active = ? WHERE id = ?').run(activate ? 1 : 0, userId);
  if (!activate) await bumpTokenVersion(userId); // belt-and-braces with the active check
  await logActivity(req.user!.id, 'user', userId, activate ? 'reactivated' : 'deactivated');
  res.json({ ok: true });
});

// Finance delegate: CEO grants/revokes scoped finance access (PRD §4.4's
// anticipated future role). Changes take effect on the next request because
// roles are loaded per-request, never stored in the token.
orgRouter.post('/users/:id/finance-access', requireAuth, requireCeo, async (req, res) => {
  const userId = Number(req.params.id);
  const target = await db.prepare('SELECT id, is_ceo FROM users WHERE id = ?').get(userId) as
    | { id: number; is_ceo: number }
    | undefined;
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.is_ceo) return res.status(400).json({ error: 'CEO already has finance access' });
  const grant = req.body?.grant === true;
  await db.prepare('UPDATE users SET finance_access = ? WHERE id = ?').run(grant ? 1 : 0, userId);
  await logActivity(req.user!.id, 'finance', userId, grant ? 'delegate_granted' : 'delegate_revoked', { userId });
  await notify(
    userId,
    'finance',
    grant ? 'You have been granted finance access' : 'Your finance access was revoked',
    grant ? '/portal/finance' : ''
  );
  res.json({ ok: true });
});
