import express from 'express';
import cookieParser from 'cookie-parser';
import { seedCeo } from './db';
import { orgRouter } from './routes-org';
import { tasksRouter } from './routes-tasks';
import { projectsRouter } from './routes-projects';
import { financeRouter } from './routes-finance';
import { miscRouter } from './routes-misc';

const app = express();
app.use(express.json());
app.use(cookieParser());

app.use('/api', orgRouter);
app.use('/api', tasksRouter);
app.use('/api', projectsRouter);
app.use('/api', financeRouter);
app.use('/api', miscRouter);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

seedCeo();

const PORT = Number(process.env.PORT_API || 5184);
app.listen(PORT, () => console.log(`[portal-api] listening on http://localhost:${PORT}`));
