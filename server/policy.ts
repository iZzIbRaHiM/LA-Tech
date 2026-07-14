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
import { db } from './db.js';
import type { SessionUser } from './auth.js';
import { isAncestor } from './org-hierarchy.js';

// ---------- Finance ----------
export function hasFinanceAccess(user: SessionUser): boolean {
  return user.isCeo || user.financeAccess;
}

// ---------- Projects (allow-list, PRD §4.3/§6) ----------
export async function departmentCanSeeProject(departmentId: number | null, projectId: number): Promise<boolean> {
  if (departmentId == null) return false;
  const row = await db
    .prepare('SELECT 1 FROM project_visibility WHERE project_id = ? AND department_id = ?')
    .get(projectId, departmentId);
  return !!row;
}

export async function userCanSeeProject(user: SessionUser, projectId: number): Promise<boolean> {
  if (user.isCeo) return true;
  return await departmentCanSeeProject(user.departmentId, projectId);
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

// ---------- Attendance / Leave (manager-chain authority) ----------
// The CEO decides for anyone; any ancestor in the manager_id chain (not just
// the direct manager) may decide for a descendant; nobody decides for
// themselves. Since the CEO is the root of every chain (org-hierarchy.ts's
// backfill), a skip-level ancestor can always step in — "escalate to the
// CEO if unavailable" falls out of this for free, no special-casing needed.
// Departments/memberships are not consulted here at all.
async function decidesFor(actor: SessionUser, subjectUserId: number): Promise<boolean> {
  // The CEO outranks everyone, including themselves — nobody else could ever
  // decide a CEO's own record, so without this it would sit pending forever.
  if (actor.isCeo) return true;
  if (subjectUserId === actor.id) return false;
  return await isAncestor(actor.id, subjectUserId);
}

export async function canValidateAttendance(actor: SessionUser, record: { user_id: number }): Promise<boolean> {
  return await decidesFor(actor, record.user_id);
}

export async function canDecideLeave(actor: SessionUser, request: { user_id: number }): Promise<boolean> {
  return await decidesFor(actor, request.user_id);
}

// ---------- Attachments ----------
// An attachment inherits the permissions of the row it hangs off — finance
// files require finance access, task files require task visibility.
export async function canAccessAttachmentEntity(user: SessionUser, entityType: string, entityId: number): Promise<boolean> {
  if (entityType === 'finance') {
    if (!hasFinanceAccess(user)) return false;
    const row = await db.prepare('SELECT 1 FROM finance_entries WHERE id = ?').get(entityId);
    return !!row;
  }
  if (entityType === 'task') {
    const task = await db.prepare('SELECT department_id, assigned_to FROM tasks WHERE id = ?').get(entityId) as
      | { department_id: number; assigned_to: number | null }
      | undefined;
    if (!task) return false;
    return canManageTask(user, task) || task.assigned_to === user.id;
  }
  if (entityType === 'leave') {
    const request = await db.prepare('SELECT user_id FROM leave_requests WHERE id = ?').get(entityId) as
      | { user_id: number }
      | undefined;
    if (!request) return false;
    return request.user_id === user.id || (await canDecideLeave(user, request));
  }
  return false;
}

// ---------- Chat ----------
// A group's existence and messages are confidential to non-members, same
// posture as project visibility — CEO membership isn't automatic just from
// being CEO, only from actually being added (including auto-add on create).
export async function isGroupMember(userId: number, groupId: number): Promise<boolean> {
  const row = await db.prepare('SELECT 1 FROM chat_group_members WHERE group_id = ? AND user_id = ?').get(groupId, userId);
  return !!row;
}
