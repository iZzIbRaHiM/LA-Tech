import { Router } from 'express';
import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { db, logActivity } from './db';
import { requireAuth } from './auth';
import { canAccessAttachmentEntity as canAccessEntity } from './policy';

export const attachmentsRouter = Router();

const UPLOAD_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_SIZE = 15 * 1024 * 1024; // 15 MB

// Every attachment operation re-checks the OWNING entity's permission via the
// policy layer — there is no public file serving, so finance receipts stay
// finance-only and task files stay within the task's visibility.

attachmentsRouter.get('/attachments', requireAuth, async (req, res) => {
  const entityType = String(req.query.entity_type ?? '');
  const entityId = Number(req.query.entity_id);
  if (!(await canAccessEntity(req.user!, entityType, entityId))) return res.status(404).json({ error: 'Not found' });
  const rows = await db
    .prepare(
      `SELECT a.id, a.filename, a.size, a.created_at, u.name AS uploaded_by_name
       FROM attachments a JOIN users u ON u.id = a.uploaded_by
       WHERE a.entity_type = ? AND a.entity_id = ? ORDER BY a.created_at`
    )
    .all(entityType, entityId);
  res.json({ attachments: rows });
});

attachmentsRouter.post(
  '/attachments',
  requireAuth,
  express.raw({ type: '*/*', limit: MAX_SIZE }),
  async (req, res) => {
    const entityType = String(req.query.entity_type ?? '');
    const entityId = Number(req.query.entity_id);
    const filename = String(req.query.filename ?? 'file').replace(/[^\w.\- ]/g, '_').slice(0, 120);
    if (!(await canAccessEntity(req.user!, entityType, entityId))) return res.status(404).json({ error: 'Not found' });
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) return res.status(400).json({ error: 'Empty file' });

    const storedName = `${crypto.randomUUID()}-${filename}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, storedName), body);
    const info = await db
      .prepare(
        'INSERT INTO attachments (entity_type, entity_id, filename, stored_name, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(entityType, entityId, filename, storedName, body.length, req.user!.id);
    await logActivity(req.user!.id, entityType, entityId, 'attachment_added', { filename, size: body.length });
    res.json({ id: Number(info.lastInsertRowid) });
  }
);

attachmentsRouter.get('/attachments/:id/download', requireAuth, async (req, res) => {
  const row = await db.prepare('SELECT * FROM attachments WHERE id = ?').get(Number(req.params.id)) as
    | { entity_type: string; entity_id: number; filename: string; stored_name: string }
    | undefined;
  if (!row || !(await canAccessEntity(req.user!, row.entity_type, row.entity_id))) {
    return res.status(404).json({ error: 'Not found' });
  }
  const file = path.join(UPLOAD_DIR, row.stored_name);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'File missing' });
  res.setHeader('Content-Disposition', `attachment; filename="${row.filename}"`);
  res.sendFile(file);
});

attachmentsRouter.delete('/attachments/:id', requireAuth, async (req, res) => {
  const row = await db.prepare('SELECT * FROM attachments WHERE id = ?').get(Number(req.params.id)) as
    | { id: number; entity_type: string; entity_id: number; stored_name: string; uploaded_by: number }
    | undefined;
  if (!row || !(await canAccessEntity(req.user!, row.entity_type, row.entity_id))) {
    return res.status(404).json({ error: 'Not found' });
  }
  if (!req.user!.isCeo && row.uploaded_by !== req.user!.id) {
    return res.status(403).json({ error: 'Only the uploader or the CEO can delete an attachment' });
  }
  await db.prepare('DELETE FROM attachments WHERE id = ?').run(row.id);
  try {
    fs.unlinkSync(path.join(UPLOAD_DIR, row.stored_name));
  } catch {
    /* already gone */
  }
  await logActivity(req.user!.id, row.entity_type, row.entity_id, 'attachment_deleted');
  res.json({ ok: true });
});
