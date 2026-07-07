import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { initDb } from './db.js';
import { orgRouter } from './routes-org.js';
import { tasksRouter } from './routes-tasks.js';
import { projectsRouter } from './routes-projects.js';
import { financeRouter } from './routes-finance.js';
import { attendanceRouter } from './routes-attendance.js';
import { leaveRouter } from './routes-leave.js';
import { attachmentsRouter } from './routes-attachments.js';
import { extrasRouter, sendDueReminders } from './routes-extras.js';
import { miscRouter } from './routes-misc.js';
import { settingsRouter } from './routes-settings.js';

// VERCEL is set on every Vercel deployment (dev/preview/prod alike) — a more
// reliable "are we actually deployed" signal than NODE_ENV alone.
const isVercel = !!process.env.VERCEL;
const isDeployed = isVercel || process.env.NODE_ENV === 'production';

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());

// Security headers on every response.
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (isDeployed) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// CSRF: browsers can't attach custom headers cross-origin without a CORS
// preflight this server never approves, so requiring one on every mutation
// (belt) on top of sameSite=lax cookies (braces) shuts down cross-site
// request forgery. GETs stay header-free so plain links (CSV exports,
// attachment downloads) keep working.
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'latech-portal') {
    return res.status(403).json({ error: 'Missing request header' });
  }
  next();
});

app.use('/api', orgRouter);
app.use('/api', tasksRouter);
app.use('/api', projectsRouter);
app.use('/api', financeRouter);
app.use('/api', attendanceRouter);
app.use('/api', leaveRouter);
app.use('/api', attachmentsRouter);
app.use('/api', extrasRouter);
app.use('/api', miscRouter);
app.use('/api', settingsRouter);

// Production: serve the built frontend from this same process, with an SPA
// fallback so client routes like /portal/tasks/3 load index.html. In dev,
// Vite serves the frontend and proxies /api here — dist/ may not exist.
const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      return res.sendFile(path.join(DIST, 'index.html'));
    }
    next();
  });
  console.log('[portal-api] serving built frontend from dist/');
}

// The unused 4th arg is required: Express only treats 4-arity middleware as an error handler.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

if (!isVercel) {
  // Local or traditional server: initialize DB and run background reminder loop
  await initDb().catch((err) => {
    console.error('[portal-api] Failed to initialize database:', err);
    process.exit(1);
  });

  // Due-date reminders: once at boot, then hourly.
  sendDueReminders().catch((err) => console.error('[reminders] error:', err));
  setInterval(() => {
    sendDueReminders().catch((err) => console.error('[reminders] error:', err));
  }, 60 * 60 * 1000);

  const PORT = Number(process.env.PORT_API || 5184);
  app.listen(PORT, () => console.log(`[portal-api] listening on http://localhost:${PORT}`));
}

// JWT_SECRET is enforced at import time in auth.ts (throws in any deployed
// environment if unset) — no need to duplicate that check here.

export default app;
