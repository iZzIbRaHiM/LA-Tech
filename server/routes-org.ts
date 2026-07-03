import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db, logActivity, notify } from './db';
import { requireAuth, requireCeo, issueSession, clearSession, loadSessionUser } from './auth';

export const orgRouter = Router();

// ---------- Auth ----------
orgRouter.post('/auth/login', (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const row = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(email) as
    | { id: number; password_hash: string }
    | undefined;
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  issueSession(res, row.id);
  res.json({ user: loadSessionUser(row.id) });
});

orgRouter.post('/auth/logout', (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

orgRouter.get('/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

orgRouter.post('/auth/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (!newPassword || String(newPassword).length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user!.id) as {
    password_hash: string;
  };
  if (!bcrypt.compareSync(currentPassword ?? '', row.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(
    bcrypt.hashSync(newPassword, 10),
    req.user!.id
  );
  res.json({ ok: true });
});

// ---------- Departments (CEO only for mutations, PRD §5) ----------
orgRouter.get('/departments', requireAuth, (req, res) => {
  // CEO: full view. Head/member: own dept in full + other dept names/heads
  // (PRD §2 assumption 2 — existence is visible, contents are not).
  const departments = db
    .prepare(
      `SELECT d.id, d.name, d.head_user_id, d.archived_at, u.name AS head_name
       FROM departments d LEFT JOIN users u ON u.id = d.head_user_id
       WHERE d.archived_at IS NULL`
    )
    .all() as Array<{ id: number; name: string; head_user_id: number | null; head_name: string | null }>;

  const withMembers = departments.map((d) => {
    const isOwn = req.user!.isCeo || req.user!.departmentId === d.id;
    if (!isOwn) return { ...d, members: null };
    const members = db
      .prepare(
        `SELECT u.id, u.name, u.email, u.finance_access, m.role FROM memberships m
         JOIN users u ON u.id = m.user_id WHERE m.department_id = ?`
      )
      .all(d.id);
    return { ...d, members };
  });
  res.json({ departments: withMembers });
});

orgRouter.post('/departments', requireAuth, requireCeo, (req, res) => {
  const { name } = req.body ?? {};
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  const info = db
    .prepare('INSERT INTO departments (name, created_by) VALUES (?, ?)')
    .run(name.trim(), req.user!.id);
  logActivity(req.user!.id, 'department', Number(info.lastInsertRowid), 'created', { name });
  res.json({ id: Number(info.lastInsertRowid) });
});

orgRouter.patch('/departments/:id', requireAuth, requireCeo, (req, res) => {
  const id = Number(req.params.id);
  const { name, archive } = req.body ?? {};
  if (name?.trim()) {
    db.prepare('UPDATE departments SET name = ? WHERE id = ?').run(name.trim(), id);
    logActivity(req.user!.id, 'department', id, 'renamed', { name });
  }
  if (archive === true) {
    const openTasks = db
      .prepare("SELECT COUNT(*) AS c FROM tasks WHERE department_id = ? AND status != 'done'")
      .get(id) as { c: number };
    if (openTasks.c > 0) {
      return res.status(409).json({ error: `Department has ${openTasks.c} open task(s); reassign or complete them first` });
    }
    db.prepare("UPDATE departments SET archived_at = datetime('now') WHERE id = ?").run(id);
    logActivity(req.user!.id, 'department', id, 'archived');
  }
  res.json({ ok: true });
});

// ---------- Members ----------
orgRouter.post('/departments/:id/members', requireAuth, requireCeo, (req, res) => {
  const departmentId = Number(req.params.id);
  const { name, email, password, existingUserId } = req.body ?? {};

  let userId: number;
  if (existingUserId) {
    userId = Number(existingUserId);
    const already = db.prepare('SELECT department_id FROM memberships WHERE user_id = ?').get(userId) as
      | { department_id: number }
      | undefined;
    if (already) return res.status(409).json({ error: 'User already belongs to a department (one department per user in v1)' });
  } else {
    if (!name?.trim() || !email?.trim() || !password || String(password).length < 8) {
      return res.status(400).json({ error: 'Name, email, and a password of 8+ characters required' });
    }
    const dup = db.prepare('SELECT id FROM users WHERE email = ?').get(email.trim());
    if (dup) return res.status(409).json({ error: 'A user with this email already exists' });
    const info = db
      .prepare('INSERT INTO users (name, email, password_hash, must_change_password) VALUES (?, ?, ?, 1)')
      .run(name.trim(), email.trim(), bcrypt.hashSync(String(password), 10));
    userId = Number(info.lastInsertRowid);
  }

  db.prepare('INSERT INTO memberships (user_id, department_id, role) VALUES (?, ?, ?)').run(
    userId,
    departmentId,
    'member'
  );
  logActivity(req.user!.id, 'department', departmentId, 'member_added', { userId });
  notify(userId, 'org', `You were added to a department`, '/portal/departments');
  res.json({ userId });
});

orgRouter.delete('/departments/:id/members/:userId', requireAuth, requireCeo, (req, res) => {
  const departmentId = Number(req.params.id);
  const userId = Number(req.params.userId);
  const openTasks = db
    .prepare("SELECT COUNT(*) AS c FROM tasks WHERE assigned_to = ? AND status != 'done'")
    .get(userId) as { c: number };
  if (openTasks.c > 0) {
    return res.status(409).json({ error: `User has ${openTasks.c} open task(s); reassign them first (PRD §4.1)` });
  }
  const dept = db.prepare('SELECT head_user_id FROM departments WHERE id = ?').get(departmentId) as {
    head_user_id: number | null;
  };
  if (dept?.head_user_id === userId) {
    db.prepare('UPDATE departments SET head_user_id = NULL WHERE id = ?').run(departmentId);
  }
  db.prepare('DELETE FROM memberships WHERE user_id = ? AND department_id = ?').run(userId, departmentId);
  logActivity(req.user!.id, 'department', departmentId, 'member_removed', { userId });
  res.json({ ok: true });
});

orgRouter.post('/departments/:id/head', requireAuth, requireCeo, (req, res) => {
  const departmentId = Number(req.params.id);
  const { userId } = req.body ?? {};
  const membership = db
    .prepare('SELECT 1 FROM memberships WHERE user_id = ? AND department_id = ?')
    .get(Number(userId), departmentId);
  if (!membership) return res.status(400).json({ error: 'Head must be an existing member of the department' });

  // Exactly one head at a time (PRD §3): demote current head, promote new one.
  db.prepare("UPDATE memberships SET role = 'member' WHERE department_id = ? AND role = 'head'").run(departmentId);
  db.prepare("UPDATE memberships SET role = 'head' WHERE user_id = ? AND department_id = ?").run(
    Number(userId),
    departmentId
  );
  db.prepare('UPDATE departments SET head_user_id = ? WHERE id = ?').run(Number(userId), departmentId);
  logActivity(req.user!.id, 'department', departmentId, 'head_assigned', { userId });
  notify(Number(userId), 'org', 'You are now a department head', '/portal/departments');
  res.json({ ok: true });
});

orgRouter.get('/users', requireAuth, requireCeo, (_req, res) => {
  const users = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.is_ceo, u.finance_access, m.department_id, m.role
       FROM users u LEFT JOIN memberships m ON m.user_id = u.id ORDER BY u.name`
    )
    .all();
  res.json({ users });
});

// Finance delegate: CEO grants/revokes scoped finance access (PRD §4.4's
// anticipated future role). Changes take effect on the next request because
// roles are loaded per-request, never stored in the token.
orgRouter.post('/users/:id/finance-access', requireAuth, requireCeo, (req, res) => {
  const userId = Number(req.params.id);
  const target = db.prepare('SELECT id, is_ceo FROM users WHERE id = ?').get(userId) as
    | { id: number; is_ceo: number }
    | undefined;
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.is_ceo) return res.status(400).json({ error: 'CEO already has finance access' });
  const grant = req.body?.grant === true;
  db.prepare('UPDATE users SET finance_access = ? WHERE id = ?').run(grant ? 1 : 0, userId);
  logActivity(req.user!.id, 'finance', userId, grant ? 'delegate_granted' : 'delegate_revoked', { userId });
  notify(
    userId,
    'finance',
    grant ? 'You have been granted finance access' : 'Your finance access was revoked',
    grant ? '/portal/finance' : ''
  );
  res.json({ ok: true });
});
