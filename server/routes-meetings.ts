import { Router } from 'express';
import { db, logActivity, notify } from './db.js';
import { requireAuth, requireCeo } from './auth.js';

// In-portal video meetings. Media is pure WebRTC peer-to-peer between the
// participants' browsers — these routes only carry the signaling handshake
// (SDP offers/answers, ICE candidates), polled by clients. That keeps the
// whole feature serverless-compatible: no websocket, no media server.
export const meetingsRouter = Router();

async function isParticipant(meetingId: number, userId: number): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 FROM meeting_participants WHERE meeting_id = ? AND user_id = ?')
    .get(meetingId, userId);
  return !!row;
}

// CEO creates a meeting with an explicit participant list (PRD: "with a
// single person or whoever he wants to add"). The creator is always a
// participant themselves.
meetingsRouter.post('/meetings', requireAuth, requireCeo, async (req, res) => {
  const user = req.user!;
  const { title, participantIds } = req.body ?? {};
  const ids = Array.isArray(participantIds) ? participantIds.map(Number).filter((n) => Number.isFinite(n) && n > 0) : [];
  if (ids.length === 0) return res.status(400).json({ error: 'At least one participant is required' });

  const info = await db
    .prepare('INSERT INTO meetings (title, created_by) VALUES (?, ?)')
    .run(String(title ?? '').trim() || 'Meeting', user.id);
  const meetingId = Number(info.lastInsertRowid);

  const unique = [...new Set([user.id, ...ids])];
  for (const uid of unique) {
    const target = await db.prepare('SELECT id, active FROM users WHERE id = ?').get(uid) as
      | { id: number; active: number }
      | undefined;
    if (!target?.active) continue;
    await db
      .prepare('INSERT OR IGNORE INTO meeting_participants (meeting_id, user_id) VALUES (?, ?)')
      .run(meetingId, uid);
    if (uid !== user.id) {
      await notify(uid, 'meeting', `${user.name} invited you to a meeting: ${String(title ?? '').trim() || 'Meeting'}`, `/portal/meetings/${meetingId}`);
    }
  }
  await logActivity(user.id, 'meeting', meetingId, 'created', { participantIds: unique });
  res.json({ id: meetingId });
});

// Active meetings I'm invited to (plus recently ended ones for context).
meetingsRouter.get('/meetings', requireAuth, async (req, res) => {
  const meetings = await db
    .prepare(
      `SELECT m.id, m.title, m.created_by, m.ended_at, m.created_at, u.name AS creator_name,
              (SELECT COUNT(*) FROM meeting_participants x WHERE x.meeting_id = m.id AND x.joined_at IS NOT NULL AND x.left_at IS NULL) AS in_room_count
       FROM meetings m
       JOIN meeting_participants p ON p.meeting_id = m.id AND p.user_id = ?
       JOIN users u ON u.id = m.created_by
       ORDER BY m.created_at DESC LIMIT 30`
    )
    .all(req.user!.id);
  res.json({ meetings });
});

meetingsRouter.get('/meetings/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!(await isParticipant(id, req.user!.id))) return res.status(404).json({ error: 'Not found' });
  const meeting = await db
    .prepare('SELECT m.*, u.name AS creator_name FROM meetings m JOIN users u ON u.id = m.created_by WHERE m.id = ?')
    .get(id);
  if (!meeting) return res.status(404).json({ error: 'Not found' });
  const participants = await db
    .prepare(
      `SELECT p.user_id, u.name, p.joined_at, p.left_at FROM meeting_participants p
       JOIN users u ON u.id = p.user_id WHERE p.meeting_id = ?`
    )
    .all(id);
  res.json({ meeting, participants });
});

// Join: flags me in-room and returns who's already in, so the newcomer can
// initiate one WebRTC offer per existing peer (newcomer-initiates keeps the
// handshake deterministic — no offer glare).
meetingsRouter.post('/meetings/:id/join', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const user = req.user!;
  if (!(await isParticipant(id, user.id))) return res.status(404).json({ error: 'Not found' });
  const meeting = await db.prepare('SELECT ended_at FROM meetings WHERE id = ?').get(id) as { ended_at: string | null };
  if (meeting.ended_at) return res.status(409).json({ error: 'Meeting has ended' });

  const peers = await db
    .prepare(
      `SELECT p.user_id, u.name FROM meeting_participants p JOIN users u ON u.id = p.user_id
       WHERE p.meeting_id = ? AND p.user_id != ? AND p.joined_at IS NOT NULL AND p.left_at IS NULL`
    )
    .all(id, user.id);

  await db
    .prepare("UPDATE meeting_participants SET joined_at = datetime('now'), left_at = NULL WHERE meeting_id = ? AND user_id = ?")
    .run(id, user.id);
  res.json({ peers });
});

meetingsRouter.post('/meetings/:id/leave', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const user = req.user!;
  if (!(await isParticipant(id, user.id))) return res.status(404).json({ error: 'Not found' });
  await db
    .prepare("UPDATE meeting_participants SET left_at = datetime('now') WHERE meeting_id = ? AND user_id = ?")
    .run(id, user.id);
  // Tell everyone still in the room to drop my peer connection.
  const others = await db
    .prepare('SELECT user_id FROM meeting_participants WHERE meeting_id = ? AND user_id != ? AND joined_at IS NOT NULL AND left_at IS NULL')
    .all(id, user.id) as Array<{ user_id: number }>;
  for (const o of others) {
    await db
      .prepare('INSERT INTO meeting_signals (meeting_id, from_user, to_user, type) VALUES (?, ?, ?, ?)')
      .run(id, user.id, o.user_id, 'peer-left');
  }
  res.json({ ok: true });
});

// Only the creator ends the meeting for everyone.
meetingsRouter.post('/meetings/:id/end', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const meeting = await db.prepare('SELECT created_by, ended_at FROM meetings WHERE id = ?').get(id) as
    | { created_by: number; ended_at: string | null }
    | undefined;
  if (!meeting || !(await isParticipant(id, req.user!.id))) return res.status(404).json({ error: 'Not found' });
  if (meeting.created_by !== req.user!.id) return res.status(403).json({ error: 'Only the meeting creator can end it' });
  if (!meeting.ended_at) {
    await db.prepare("UPDATE meetings SET ended_at = datetime('now') WHERE id = ?").run(id);
    await logActivity(req.user!.id, 'meeting', id, 'ended');
  }
  res.json({ ok: true });
});

// WebRTC signaling relay. Clients poll GET with their last-seen signal id;
// the response also carries the meeting-ended flag and current roster so a
// single poll drives the whole room state.
meetingsRouter.post('/meetings/:id/signals', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const user = req.user!;
  if (!(await isParticipant(id, user.id))) return res.status(404).json({ error: 'Not found' });
  const { toUser, type, payload } = req.body ?? {};
  const target = Number(toUser);
  if (!target || !['offer', 'answer', 'ice'].includes(type)) {
    return res.status(400).json({ error: 'toUser and a valid type (offer|answer|ice) are required' });
  }
  if (!(await isParticipant(id, target))) return res.status(400).json({ error: 'Recipient is not in this meeting' });
  const info = await db
    .prepare('INSERT INTO meeting_signals (meeting_id, from_user, to_user, type, payload) VALUES (?, ?, ?, ?, ?)')
    .run(id, user.id, target, type, JSON.stringify(payload ?? {}));
  // Opportunistic cleanup, same pattern as login_attempts housekeeping.
  await db.prepare("DELETE FROM meeting_signals WHERE created_at < now() - INTERVAL '1 hour'").run();
  res.json({ id: Number(info.lastInsertRowid) });
});

meetingsRouter.get('/meetings/:id/signals', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const user = req.user!;
  if (!(await isParticipant(id, user.id))) return res.status(404).json({ error: 'Not found' });
  const after = Number(req.query.after ?? 0);
  const signals = await db
    .prepare(
      `SELECT s.id, s.from_user, s.type, s.payload, u.name AS from_name
       FROM meeting_signals s JOIN users u ON u.id = s.from_user
       WHERE s.meeting_id = ? AND s.to_user = ? AND s.id > ? ORDER BY s.id LIMIT 200`
    )
    .all(id, user.id, after);
  const meeting = await db.prepare('SELECT ended_at FROM meetings WHERE id = ?').get(id) as { ended_at: string | null };
  const inRoom = await db
    .prepare(
      `SELECT p.user_id, u.name FROM meeting_participants p JOIN users u ON u.id = p.user_id
       WHERE p.meeting_id = ? AND p.joined_at IS NOT NULL AND p.left_at IS NULL`
    )
    .all(id);
  res.json({ signals, ended: !!meeting.ended_at, inRoom });
});
