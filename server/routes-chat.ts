import { Router } from 'express';
import { db, logActivity, notify } from './db.js';
import { requireAuth, requireCeo } from './auth.js';
import { isGroupMember } from './policy.js';

export const chatRouter = Router();

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
      `SELECT m.id, m.body, m.created_at, m.sender_id, u.name AS sender_name
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
