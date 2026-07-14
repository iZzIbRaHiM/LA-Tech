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
