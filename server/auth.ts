import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db } from './db';

const JWT_SECRET = process.env.JWT_SECRET || 'latech-portal-dev-secret';
const COOKIE_NAME = 'portal_session';

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  isCeo: boolean;
  financeAccess: boolean;
  departmentId: number | null;
  role: 'ceo' | 'head' | 'member' | 'unassigned';
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

// Role is derived from org placement on every request (PRD §3), never
// stored in the token — so promoting/demoting a head takes effect immediately.
export function loadSessionUser(userId: number): SessionUser | null {
  const row = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.is_ceo, u.finance_access, m.department_id, m.role AS mrole
       FROM users u LEFT JOIN memberships m ON m.user_id = u.id
       WHERE u.id = ?`
    )
    .get(userId) as
    | {
        id: number;
        name: string;
        email: string;
        is_ceo: number;
        finance_access: number;
        department_id: number | null;
        mrole: string | null;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    isCeo: !!row.is_ceo,
    financeAccess: !!row.finance_access,
    departmentId: row.department_id,
    role: row.is_ceo ? 'ceo' : row.mrole === 'head' ? 'head' : row.mrole === 'member' ? 'member' : 'unassigned',
  };
}

export function issueSession(res: Response, userId: number) {
  const token = jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 3600 * 1000,
  });
}

export function clearSession(res: Response) {
  res.clearCookie(COOKIE_NAME);
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sub: number };
    const user = loadSessionUser(Number(payload.sub));
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Not authenticated' });
  }
}

export function requireCeo(req: Request, res: Response, next: NextFunction) {
  if (!req.user?.isCeo) return res.status(403).json({ error: 'CEO only' });
  next();
}

// Finance delegate role (PRD §4.4 anticipated this): the CEO can grant a
// specific user read/write finance access without making them CEO. All
// finance mutations remain audit-logged with the actor.
export function hasFinanceAccess(user: SessionUser): boolean {
  return user.isCeo || user.financeAccess;
}

export function requireFinance(req: Request, res: Response, next: NextFunction) {
  if (!req.user || !hasFinanceAccess(req.user)) return res.status(403).json({ error: 'Finance access only' });
  next();
}

// A department is visible on a project only via an allow-list row (PRD §6 invariant).
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
