// Single source of truth for reasoning about the manager_id chain — backs
// both attendance/leave approval authority (policy.ts) and the cycle guard
// on reassignment (routes-org-hierarchy.ts). Kept in one place, same spirit
// as policy.ts's own "short and auditable" header comment.
import { db } from './db.js';

// Is `ancestorId` somewhere above `descendantId` in the manager chain?
export async function isAncestor(ancestorId: number, descendantId: number): Promise<boolean> {
  if (ancestorId === descendantId) return false;
  const row = await db
    .prepare(
      `WITH RECURSIVE chain AS (
         SELECT id, manager_id, 0 AS depth FROM users WHERE id = ?
         UNION ALL
         SELECT u.id, u.manager_id, c.depth + 1
         FROM users u JOIN chain c ON u.id = c.manager_id
         WHERE c.depth < 50
       )
       SELECT 1 FROM chain WHERE id = ? LIMIT 1`
    )
    .get(descendantId, ancestorId);
  return !!row;
}

// Would setting subject's manager to proposedManagerId create a loop?
// True if they're the same person, or if the subject is already an
// ancestor of the proposed manager (i.e. the proposed manager reports to
// the subject, directly or indirectly).
export async function wouldCreateCycle(subjectId: number, proposedManagerId: number): Promise<boolean> {
  if (subjectId === proposedManagerId) return true;
  return await isAncestor(subjectId, proposedManagerId);
}

// Does this person manage anyone at all? Used to extend authority (e.g.
// meeting creation) beyond department heads to anyone above them in the
// chain — "the person over them" — without hardcoding a role check.
export async function hasDirectReports(userId: number): Promise<boolean> {
  const row = await db.prepare('SELECT 1 FROM users WHERE manager_id = ? AND active = 1 LIMIT 1').get(userId);
  return !!row;
}

// Everyone below userId in the chain, any depth (their reports, their
// reports' reports, ...). Used to scope who someone may invite to a
// meeting — "only people under them".
export async function getDescendantIds(userId: number): Promise<number[]> {
  const rows = (await db
    .prepare(
      `WITH RECURSIVE chain AS (
         SELECT id FROM users WHERE manager_id = ?
         UNION ALL
         SELECT u.id FROM users u JOIN chain c ON u.manager_id = c.id
       )
       SELECT id FROM chain`
    )
    .all(userId)) as Array<{ id: number }>;
  return rows.map((r) => r.id);
}

// Everyone above userId in the chain, up to (and including) the CEO. Used
// to silently surface a meeting to the creator's whole reporting line, so
// "people above them" can see and join even though they weren't invited.
export async function getAncestorIds(userId: number): Promise<number[]> {
  const rows = (await db
    .prepare(
      `WITH RECURSIVE chain AS (
         SELECT manager_id FROM users WHERE id = ?
         UNION ALL
         SELECT u.manager_id FROM users u JOIN chain c ON u.id = c.manager_id
       )
       SELECT manager_id AS id FROM chain WHERE manager_id IS NOT NULL`
    )
    .all(userId)) as Array<{ id: number }>;
  return rows.map((r) => r.id);
}
