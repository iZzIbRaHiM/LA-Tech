import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db } from './db.js';
import { hasFinanceAccess } from './policy.js';

// process.env.VERCEL is set on every Vercel deployment (dev, preview, and
// production alike) — a much more reliable "are we running for real"
// signal than NODE_ENV, which some hosts don't set consistently.
const IS_DEPLOYED = !!process.env.VERCEL || process.env.NODE_ENV === 'production';

if (IS_DEPLOYED && !process.env.JWT_SECRET) {
  // Failing loudly here is deliberate: the alternative is silently signing
  // every session with a secret that's sitting in this file, in a public
  // GitHub repo — anyone could forge a valid CEO cookie. Fail closed.
  throw new Error(
    '[SECURITY] JWT_SECRET is not set. Refusing to start with the public default secret in a deployed environment — set JWT_SECRET in your environment variables.'
  );
}

const JWT_SECRET = process.env.JWT_SECRET || 'latech-portal-dev-secret';
const JWT_ISSUER = 'latech-portal';
const COOKIE_NAME = 'portal_session';
// Internal tool handling PII and financial data — a week-long session is
// too long-lived for comfort. Configurable via env var without a redeploy.
const SESSION_MAX_AGE_MS = (Number(process.env.SESSION_MAX_AGE_HOURS) || 24) * 3600 * 1000;

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  isCeo: boolean;
  financeAccess: boolean;
  mustChangePassword: boolean;
  departmentId: number | null;
  role: 'ceo' | 'head' | 'member' | 'intern' | 'unassigned';
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
    // Intern behaves exactly like member everywhere taskVisibilityWhere/
    // canManageTask look at role — both route any non-'head' role into the
    // same rows-you're-assigned branch, so passing 'intern' through here
    // (instead of letting it fall to the more-restrictive 'unassigned') is
    // the only change needed to make the tier actually work as promised.
    role:
      row.is_ceo
        ? 'ceo'
        : row.mrole === 'head'
        ? 'head'
        : row.mrole === 'member'
        ? 'member'
        : row.mrole === 'intern'
        ? 'intern'
        : 'unassigned',
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

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: IS_DEPLOYED,
};

export async function issueSession(res: Response, userId: number) {
  const ver = await currentTokenVersion(userId);
  const token = jwt.sign({ sub: userId, ver }, JWT_SECRET, {
    algorithm: 'HS256',
    issuer: JWT_ISSUER,
    expiresIn: Math.floor(SESSION_MAX_AGE_MS / 1000),
  });
  res.cookie(COOKIE_NAME, token, { ...COOKIE_OPTIONS, maxAge: SESSION_MAX_AGE_MS });
}

export function clearSession(res: Response) {
  // Options must match what the cookie was set with, or some browsers won't
  // treat this as the same cookie and silently ignore the clear.
  res.clearCookie(COOKIE_NAME, COOKIE_OPTIONS);
}

// A "logout" that only clears the browser's cookie leaves the token itself
// still cryptographically valid for the rest of its life — if it were ever
// copied elsewhere (synced browser profile, shared machine, etc.) clicking
// logout wouldn't actually revoke it. Bump the token version too, so logout
// is a real revocation everywhere that token exists, not just here.
// Trade-off: this also signs the user out of any other device/browser they
// were concurrently logged in on — intentional, since "logout" should mean
// logout.
export async function logoutAndRevoke(req: Request, res: Response) {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'], issuer: JWT_ISSUER }) as unknown as {
        sub: number;
      };
      await bumpTokenVersion(Number(payload.sub));
    } catch {
      // Already invalid/expired — nothing to revoke.
    }
  }
  clearSession(res);
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
    // Presence heartbeat for the org-tree's "online now" indicator. Not
    // awaited — a hiccup here must never delay or fail a real request (the
    // one deliberate exception to this file's "await everything" norm).
    // Throttled to the DB so 6s client polling produces at most one write
    // per user per ~20s; the tree's online window is 75s, so the indicator
    // tracks reality within about a poll cycle.
    db.prepare(
      "UPDATE users SET last_seen_at = datetime('now') WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at::timestamp < now() - INTERVAL '20 seconds')"
    )
      .run(userId)
      .then((r) => {
        if (r.changes > 0) {
          // While checked in, this same heartbeat is the work-session
          // monitor: accumulate active time on the open attendance row.
          // Capped at 5 minutes per beat so time away (laptop closed,
          // browser shut) never counts as online time.
          return db
            .prepare(
              `UPDATE attendance SET
                 online_minutes = online_minutes + LEAST(GREATEST(EXTRACT(EPOCH FROM (now() - last_active_at::timestamp)) / 60.0, 0), 5),
                 last_active_at = datetime('now')
               WHERE user_id = ? AND check_out IS NULL AND check_in IS NOT NULL AND last_active_at IS NOT NULL`
            )
            .run(userId);
        }
      })
      .catch((err) => console.warn('[heartbeat] presence/session update failed:', err?.message ?? err));
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
