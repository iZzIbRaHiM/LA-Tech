import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { seedCeo } from './db';
import { orgRouter } from './routes-org';
import { tasksRouter } from './routes-tasks';
import { projectsRouter } from './routes-projects';
import { financeRouter } from './routes-finance';
import { attendanceRouter } from './routes-attendance';
import { leaveRouter } from './routes-leave';
import { attachmentsRouter } from './routes-attachments';
import { extrasRouter, sendDueReminders } from './routes-extras';
import { miscRouter } from './routes-misc';

const app = express();
app.use(express.json());
app.use(cookieParser());

app.use('/api', orgRouter);
app.use('/api', tasksRouter);
app.use('/api', projectsRouter);
app.use('/api', financeRouter);
app.use('/api', attendanceRouter);
app.use('/api', leaveRouter);
app.use('/api', attachmentsRouter);
app.use('/api', extrasRouter);
app.use('/api', miscRouter);

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

seedCeo();

// Due-date reminders: once at boot, then hourly.
sendDueReminders();
setInterval(sendDueReminders, 60 * 60 * 1000);

const PORT = Number(process.env.PORT_API || 5184);
app.listen(PORT, () => console.log(`[portal-api] listening on http://localhost:${PORT}`));
