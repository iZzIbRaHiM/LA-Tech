import { Router } from 'express';
import express from 'express';
import crypto from 'crypto';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { db, logActivity, notify } from './db.js';
import { requireAuth, requireCeo } from './auth.js';
import { isGroupMember } from './policy.js';
import { r2, ATTACHMENTS_BUCKET } from './r2.js';

export const chatRouter = Router();

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15 MB, matches the generic attachments limit

// Groups the current user belongs to — a non-member can't discover a group
// exists at all, so every route below re-checks membership per group.
chatRouter.get('/chat/groups', requireAuth, async (req, res) => {
  const groups = await db
    .prepare(
      `SELECT g.id, g.name, g.created_by, g.created_at,
              (SELECT COUNT(*) FROM chat_group_members m WHERE m.group_id = g.id) AS member_count
       FROM chat_groups g
       JOIN chat_group_members gm ON gm.group_id = g.id AND gm.user_id = ?
       ORDER BY g.created_at DESC`
    )
    .all(req.user!.id);
  res.json({ groups });
});

chatRouter.get('/chat/groups/:id/members', requireAuth, async (req, res) => {
  const groupId = Number(req.params.id);
  if (!(await isGroupMember(req.user!.id, groupId))) return res.status(404).json({ error: 'Not found' });
  const members = await db
    .prepare(
      `SELECT u.id, u.name, u.email FROM chat_group_members m
       JOIN users u ON u.id = m.user_id WHERE m.group_id = ? ORDER BY u.name`
    )
    .all(groupId);
  res.json({ members });
});

chatRouter.post('/chat/groups', requireAuth, requireCeo, async (req, res) => {
  const { name, memberIds } = req.body ?? {};
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  const ids = new Set<number>((Array.isArray(memberIds) ? memberIds : []).map(Number));
  ids.add(req.user!.id); // creator can always participate in a group they made

  const info = await db.prepare('INSERT INTO chat_groups (name, created_by) VALUES (?, ?)').run(name.trim(), req.user!.id);
  const groupId = Number(info.lastInsertRowid);
  for (const uid of ids) {
    await db.prepare('INSERT INTO chat_group_members (group_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(
      groupId,
      uid
    );
  }
  await logActivity(req.user!.id, 'chat_group', groupId, 'created', { name, memberIds: [...ids] });
  for (const uid of ids) {
    if (uid !== req.user!.id) await notify(uid, 'chat', `You were added to a chat group: ${name.trim()}`, '/portal/chat');
  }
  res.json({ id: groupId });
});

chatRouter.patch('/chat/groups/:id', requireAuth, requireCeo, async (req, res) => {
  const groupId = Number(req.params.id);
  const group = await db.prepare('SELECT id FROM chat_groups WHERE id = ?').get(groupId);
  if (!group) return res.status(404).json({ error: 'Not found' });

  const { name, memberIds } = req.body ?? {};
  if (name?.trim()) {
    await db.prepare('UPDATE chat_groups SET name = ? WHERE id = ?').run(name.trim(), groupId);
  }
  if (Array.isArray(memberIds)) {
    const ids = new Set<number>(memberIds.map(Number));
    ids.add(req.user!.id);
    const before = await db.prepare('SELECT user_id FROM chat_group_members WHERE group_id = ?').all(groupId) as Array<{
      user_id: number;
    }>;
    const beforeIds = new Set(before.map((r) => r.user_id));
    await db.prepare('DELETE FROM chat_group_members WHERE group_id = ?').run(groupId);
    for (const uid of ids) {
      await db.prepare('INSERT INTO chat_group_members (group_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(
        groupId,
        uid
      );
      if (!beforeIds.has(uid)) {
        await notify(uid, 'chat', 'You were added to a chat group', '/portal/chat');
      }
    }
  }
  await logActivity(req.user!.id, 'chat_group', groupId, 'updated', { name, memberIds });
  res.json({ ok: true });
});

chatRouter.delete('/chat/groups/:id', requireAuth, requireCeo, async (req, res) => {
  const groupId = Number(req.params.id);
  const group = await db.prepare('SELECT id FROM chat_groups WHERE id = ?').get(groupId);
  if (!group) return res.status(404).json({ error: 'Not found' });
  await db.prepare('DELETE FROM chat_groups WHERE id = ?').run(groupId); // cascades members + messages
  await logActivity(req.user!.id, 'chat_group', groupId, 'deleted');
  res.json({ ok: true });
});

chatRouter.get('/chat/groups/:id/messages', requireAuth, async (req, res) => {
  const groupId = Number(req.params.id);
  if (!(await isGroupMember(req.user!.id, groupId))) return res.status(404).json({ error: 'Not found' });
  const messages = await db
    .prepare(
      `SELECT m.id, m.body, m.created_at, m.edited_at, m.sender_id, u.name AS sender_name,
              m.attachment_filename, m.attachment_size
       FROM chat_messages m JOIN users u ON u.id = m.sender_id
       WHERE m.group_id = ? ORDER BY m.created_at ASC LIMIT 200`
    )
    .all(groupId);
  res.json({ messages });
});

chatRouter.post('/chat/groups/:id/messages', requireAuth, async (req, res) => {
  const groupId = Number(req.params.id);
  if (!(await isGroupMember(req.user!.id, groupId))) return res.status(404).json({ error: 'Not found' });
  const { body } = req.body ?? {};
  if (!body?.trim()) return res.status(400).json({ error: 'Message body required' });
  const info = await db
    .prepare('INSERT INTO chat_messages (group_id, sender_id, body) VALUES (?, ?, ?)')
    .run(groupId, req.user!.id, body.trim());
  res.json({ id: Number(info.lastInsertRowid) });
});

// A file "message" — one message optionally carries a file instead of (or
// alongside) text, rather than a separate polymorphic attachments table:
// chat is a stream of messages, not "one entity with a list of files"
// like tasks/finance/leave, so this fits its shape better.
chatRouter.post(
  '/chat/groups/:id/attachments',
  requireAuth,
  express.raw({ type: '*/*', limit: MAX_FILE_SIZE }),
  async (req, res) => {
    const groupId = Number(req.params.id);
    if (!(await isGroupMember(req.user!.id, groupId))) return res.status(404).json({ error: 'Not found' });
    const filename = String(req.query.filename ?? 'file').replace(/[^\w.\- ]/g, '_').slice(0, 120);
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) return res.status(400).json({ error: 'Empty file' });

    const storedName = `chat/${crypto.randomUUID()}-${filename}`;
    try {
      await r2.send(
        new PutObjectCommand({ Bucket: ATTACHMENTS_BUCKET, Key: storedName, Body: body, ContentType: 'application/octet-stream' })
      );
    } catch (err) {
      console.error('[chat] upload failed:', err);
      return res.status(500).json({ error: 'Upload failed' });
    }

    const info = await db
      .prepare(
        `INSERT INTO chat_messages (group_id, sender_id, body, attachment_filename, attachment_stored_name, attachment_size)
         VALUES (?, ?, '', ?, ?, ?)`
      )
      .run(groupId, req.user!.id, filename, storedName, body.length);
    res.json({ id: Number(info.lastInsertRowid) });
  }
);

chatRouter.get('/chat/groups/:id/messages/:messageId/download', requireAuth, async (req, res) => {
  const groupId = Number(req.params.id);
  if (!(await isGroupMember(req.user!.id, groupId))) return res.status(404).json({ error: 'Not found' });
  const message = await db
    .prepare('SELECT attachment_filename, attachment_stored_name FROM chat_messages WHERE id = ? AND group_id = ?')
    .get(Number(req.params.messageId), groupId) as
    | { attachment_filename: string | null; attachment_stored_name: string | null }
    | undefined;
  if (!message?.attachment_stored_name) return res.status(404).json({ error: 'Not found' });
  try {
    const object = await r2.send(new GetObjectCommand({ Bucket: ATTACHMENTS_BUCKET, Key: message.attachment_stored_name }));
    const bytes = await object.Body?.transformToByteArray();
    if (!bytes) return res.status(404).json({ error: 'File missing' });
    res.setHeader('Content-Disposition', `attachment; filename="${message.attachment_filename}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(Buffer.from(bytes));
  } catch {
    res.status(404).json({ error: 'File missing' });
  }
});

// Edit/delete are author-only — even the CEO can't rewrite someone else's
// words (group management is CEO-only, but a message belongs to whoever
// sent it). Only text messages can be edited; a file "message" has nothing
// to rewrite.
chatRouter.patch('/chat/groups/:id/messages/:messageId', requireAuth, async (req, res) => {
  const groupId = Number(req.params.id);
  if (!(await isGroupMember(req.user!.id, groupId))) return res.status(404).json({ error: 'Not found' });
  const message = await db
    .prepare('SELECT id, sender_id, attachment_stored_name FROM chat_messages WHERE id = ? AND group_id = ?')
    .get(Number(req.params.messageId), groupId) as
    | { id: number; sender_id: number; attachment_stored_name: string | null }
    | undefined;
  if (!message) return res.status(404).json({ error: 'Not found' });
  if (message.sender_id !== req.user!.id) return res.status(403).json({ error: 'You can only edit your own messages' });
  if (message.attachment_stored_name) return res.status(400).json({ error: 'File messages cannot be edited' });

  const { body } = req.body ?? {};
  if (!body?.trim()) return res.status(400).json({ error: 'Message body required' });
  await db
    .prepare("UPDATE chat_messages SET body = ?, edited_at = to_char(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS') WHERE id = ?")
    .run(body.trim(), message.id);
  res.json({ ok: true });
});

chatRouter.delete('/chat/groups/:id/messages/:messageId', requireAuth, async (req, res) => {
  const groupId = Number(req.params.id);
  if (!(await isGroupMember(req.user!.id, groupId))) return res.status(404).json({ error: 'Not found' });
  const message = await db
    .prepare('SELECT id, sender_id FROM chat_messages WHERE id = ? AND group_id = ?')
    .get(Number(req.params.messageId), groupId) as { id: number; sender_id: number } | undefined;
  if (!message) return res.status(404).json({ error: 'Not found' });
  if (message.sender_id !== req.user!.id) return res.status(403).json({ error: 'You can only delete your own messages' });
  await db.prepare('DELETE FROM chat_messages WHERE id = ?').run(message.id);
  res.json({ ok: true });
});
