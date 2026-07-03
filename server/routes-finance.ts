import { Router } from 'express';
import { db, logActivity } from './db';
import { requireAuth, requireFinance } from './auth';

// PRD §4.4 / §6 invariant: finance is CEO-only at the API layer — plus any
// explicit finance delegates the CEO has granted (requireFinance). The guard
// covers every /finance path structurally: there is no other code path into
// finance data. Path-scoped because the routers share one /api mount: an
// unscoped use() here would also intercept unrelated routes mounted after
// this router (e.g. /search, /notifications).
export const financeRouter = Router();
financeRouter.use('/finance', requireAuth, requireFinance);

financeRouter.get('/finance/overview', (_req, res) => {
  const perProject = db
    .prepare(
      `SELECT p.id, p.name, p.status,
        COALESCE(SUM(CASE WHEN f.type = 'budget' THEN f.amount END), 0) AS budget,
        COALESCE(SUM(CASE WHEN f.type = 'expense' THEN f.amount END), 0) AS expenses,
        COALESCE(SUM(CASE WHEN f.type = 'income' THEN f.amount END), 0) AS income
       FROM projects p LEFT JOIN finance_entries f ON f.project_id = p.id
       GROUP BY p.id ORDER BY p.created_at DESC`
    )
    .all() as Array<{ id: number; name: string; status: string; budget: number; expenses: number; income: number }>;
  const totals = perProject.reduce(
    (acc, p) => ({
      budget: acc.budget + p.budget,
      expenses: acc.expenses + p.expenses,
      income: acc.income + p.income,
    }),
    { budget: 0, expenses: 0, income: 0 }
  );
  res.json({ perProject, totals });
});

financeRouter.get('/finance/projects/:projectId', (req, res) => {
  const projectId = Number(req.params.projectId);
  const project = db.prepare('SELECT id, name FROM projects WHERE id = ?').get(projectId);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const entries = db
    .prepare(
      `SELECT f.*, u.name AS created_by_name FROM finance_entries f
       JOIN users u ON u.id = f.created_by
       WHERE f.project_id = ? ORDER BY f.created_at DESC`
    )
    .all(projectId);
  res.json({ project, entries });
});

financeRouter.post('/finance/projects/:projectId/entries', (req, res) => {
  const projectId = Number(req.params.projectId);
  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const { type, amount, category, note } = req.body ?? {};
  if (!['expense', 'income', 'budget'].includes(type)) return res.status(400).json({ error: 'Invalid type' });
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'Amount must be a positive number' });
  const info = db
    .prepare('INSERT INTO finance_entries (project_id, type, amount, category, note, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(projectId, type, amt, category?.trim() || 'general', note ?? '', req.user!.id);
  // All finance mutations audit-logged (PRD §4.4).
  logActivity(req.user!.id, 'finance', Number(info.lastInsertRowid), 'entry_created', {
    projectId,
    type,
    amount: amt,
    category,
  });
  res.json({ id: Number(info.lastInsertRowid) });
});

financeRouter.delete('/finance/entries/:id', (req, res) => {
  const id = Number(req.params.id);
  const entry = db.prepare('SELECT * FROM finance_entries WHERE id = ?').get(id) as
    | { project_id: number; type: string; amount: number }
    | undefined;
  if (!entry) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM finance_entries WHERE id = ?').run(id);
  logActivity(req.user!.id, 'finance', id, 'entry_deleted', {
    projectId: entry.project_id,
    type: entry.type,
    amount: entry.amount,
  });
  res.json({ ok: true });
});

// CSV export (PRD §4.4 — PDF deferred, CSV covers the "CEO's own use" need).
financeRouter.get('/finance/projects/:projectId/export.csv', (req, res) => {
  const projectId = Number(req.params.projectId);
  const project = db.prepare('SELECT name FROM projects WHERE id = ?').get(projectId) as { name: string } | undefined;
  if (!project) return res.status(404).json({ error: 'Not found' });
  const entries = db
    .prepare(
      `SELECT f.created_at, f.type, f.amount, f.category, f.note, u.name AS created_by
       FROM finance_entries f JOIN users u ON u.id = f.created_by
       WHERE f.project_id = ? ORDER BY f.created_at`
    )
    .all(projectId) as Array<Record<string, string | number>>;
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const header = 'date,type,amount,category,note,created_by';
  const lines = entries.map((e) =>
    [e.created_at, e.type, e.amount, e.category, e.note, e.created_by].map(esc).join(',')
  );
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${project.name.replace(/[^a-z0-9]/gi, '_')}_finance.csv"`);
  res.send([header, ...lines].join('\n'));
});
