import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db } from './db.js';
import { hasFinanceAccess } from './policy.js';

const JWT_SECRET = process.env.JWT_SECRET || 'latech-portal-dev-secret';
const JWT_ISSUER = 'latech-portal';
const COOKIE_NAME = 'portal_session';

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  isCeo: boolean;
  financeAccess: boolean;
  mustChangePassword: boolean;
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
export async function loadSessionUser(userId: number): Promise<SessionUser | null> {
  const row = await db
    .prepare(
      `SELECT u.id, u.name, u.email, u.is_ceo, u.finance_access, u.must_change_password, u.active,
              m.department_id, m.role AS mrole
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
        must_change_password: number;
        active: number;
        department_id: number | null;
        mrole: string | null;
      }
    | undefined;
  // Deactivated users are cut off here, which also kills any live session
  // cookie they still hold — sessions resolve through this on every request.
  if (!row || !row.active) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    isCeo: !!row.is_ceo,
    financeAccess: !!row.finance_access,
    mustChangePassword: !!row.must_change_password,
    departmentId: row.department_id,
    role: row.is_ceo ? 'ceo' : row.mrole === 'head' ? 'head' : row.mrole === 'member' ? 'member' : 'unassigned',
  };
}

async function currentTokenVersion(userId: number): Promise<number> {
  const row = await db.prepare('SELECT token_version FROM users WHERE id = ?').get(userId) as
    | { token_version: number }
    | undefined;
  return row?.token_version ?? 0;
}

// Session revocation: bumping the version invalidates every JWT issued
// before the bump. Used on password change/reset and deactivation.
export async function bumpTokenVersion(userId: number) {
  await db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(userId);
}

export async function issueSession(res: Response, userId: number) {
  const ver = await currentTokenVersion(userId);
  const token = jwt.sign({ sub: userId, ver }, JWT_SECRET, {
    algorithm: 'HS256',
    issuer: JWT_ISSUER,
    expiresIn: '7d',
  });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 3600 * 1000,
  });
}

export function clearSession(res: Response) {
  res.clearCookie(COOKIE_NAME);
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    // Pin algorithm and issuer so a tampered header can't downgrade
    // verification or replay a token minted for something else.
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'], issuer: JWT_ISSUER }) as unknown as {
      sub: number;
      ver?: number;
    };
    const userId = Number(payload.sub);
    const ver = await currentTokenVersion(userId);
    if ((payload.ver ?? 0) !== ver) {
      return res.status(401).json({ error: 'Session expired — sign in again' });
    }
    const user = await loadSessionUser(userId);
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

export function requireFinance(req: Request, res: Response, next: NextFunction) {
  if (!req.user || !hasFinanceAccess(req.user)) return res.status(403).json({ error: 'Finance access only' });
  next();
}

// Re-exported so existing imports keep working; the definitions live in the
// policy layer (see policy.ts — single source of truth for row scoping).
export { hasFinanceAccess, userCanSeeProject, departmentCanSeeProject } from './policy.js';
