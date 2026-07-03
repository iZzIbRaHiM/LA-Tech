// Row-level security policy — the single source of truth for who can see or
// touch which rows. This is the SQLite-stack equivalent of Postgres RLS:
// every route builds its queries and permission checks from the predicates
// in this file, so the whole authorization surface is auditable in one place
// and a rule change lands everywhere at once. The isolation suite
// (isolation-tests.mjs) attempts to violate each predicate from every role.
//
// Ground rules encoded here (PRD §5 permission matrix):
// - CEO sees and manages everything.
// - A department head's world is their own department.
// - An employee's world is rows tied to them personally.
// - Finance is CEO + explicitly granted delegates, nothing else.
// - Project existence itself is confidential outside the allow-list.
import { db } from './db';
import type { SessionUser } from './auth';

// ---------- Finance ----------
export function hasFinanceAccess(user: SessionUser): boolean {
  return user.isCeo || user.financeAccess;
}

// ---------- Projects (allow-list, PRD §4.3/§6) ----------
export function departmentCanSeeProject(departmentId: number | null, projectId: number): boolean {
  if (departmentId == null) return false;
  return !!db
    .prepare('SELECT 1 FROM project_visibility WHERE project_id = ? AND department_id = ?')
    .get(projectId, departmentId);
}

export function userCanSeeProject(user: SessionUser, projectId: number): boolean {
  if (user.isCeo) return true;
  return departmentCanSeeProject(user.departmentId, projectId);
}

// ---------- Tasks ----------
// WHERE-clause fragment applied to every task query (lists, detail,
// sub-tasks, search). CEO: all; head: own department; employee: own rows.
export function taskVisibilityWhere(user: SessionUser): { where: string; params: unknown[] } {
  if (user.isCeo) return { where: '1=1', params: [] };
  if (user.role === 'head') return { where: 't.department_id = ?', params: [user.departmentId] };
  return { where: 't.assigned_to = ?', params: [user.id] };
}

export function canManageTask(user: SessionUser, task: { department_id: number }): boolean {
  return user.isCeo || (user.role === 'head' && user.departmentId === task.department_id);
}

// ---------- Attendance / Leave (same authority model) ----------
// The CEO decides for anyone; a head decides for members of their own
// department; nobody decides for themselves (heads escalate to the CEO).
function decidesFor(actor: SessionUser, subjectUserId: number): boolean {
  if (subjectUserId === actor.id) return false;
  if (actor.isCeo) return true;
  if (actor.role !== 'head') return false;
  return !!db
    .prepare('SELECT 1 FROM memberships WHERE user_id = ? AND department_id = ?')
    .get(subjectUserId, actor.departmentId);
}

export function canValidateAttendance(actor: SessionUser, record: { user_id: number }): boolean {
  return decidesFor(actor, record.user_id);
}

export function canDecideLeave(actor: SessionUser, request: { user_id: number }): boolean {
  return decidesFor(actor, request.user_id);
}

// ---------- Attachments ----------
// An attachment inherits the permissions of the row it hangs off — finance
// files require finance access, task files require task visibility.
export function canAccessAttachmentEntity(user: SessionUser, entityType: string, entityId: number): boolean {
  if (entityType === 'finance') {
    if (!hasFinanceAccess(user)) return false;
    return !!db.prepare('SELECT 1 FROM finance_entries WHERE id = ?').get(entityId);
  }
  if (entityType === 'task') {
    const task = db.prepare('SELECT department_id, assigned_to FROM tasks WHERE id = ?').get(entityId) as
      | { department_id: number; assigned_to: number | null }
      | undefined;
    if (!task) return false;
    return canManageTask(user, task) || task.assigned_to === user.id;
  }
  return false;
}
