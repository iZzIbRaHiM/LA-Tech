import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { db, logActivity, notify } from './db.js';
import { requireAuth } from './auth.js';
import { canCreateMeetings } from './policy.js';
import { getDescendantIds, getAncestorIds } from './org-hierarchy.js';

// CEO, department heads, and anyone with direct reports may start/edit a
// meeting (policy.ts's canCreateMeetings) — broader than requireCeo since a
// meeting room grants no authority over anyone's data.
async function requireMeetingCreator(req: Request, res: Response, next: NextFunction) {
  if (!(await canCreateMeetings(req.user!))) return res.status(403).json({ error: 'Not authorized to create meetings' });
  next();
}

// In-portal video meetings. Media is pure WebRTC peer-to-peer between the
// participants' browsers — these routes only carry the signaling handshake
// (SDP offers/answers, ICE candidates), polled by clients. That keeps the
// whole feature serverless-compatible: no websocket, no media server.
export const meetingsRouter = Router();

// ICE servers are vended by the server rather than baked into the client
// bundle: TURN credentials stay in env vars, reach authenticated users
// only, and can be rotated without a redeploy of the frontend.
// Who the current user is allowed to invite — everyone under them in the
// chain (the CEO's "under" is everyone active). Backs the participant
// picker in the create/edit dialog; also doubles as "can I create a
// meeting at all" for the UI (an empty list with no reports means no).
meetingsRouter.get('/meetings/eligible-participants', requireAuth, async (req, res) => {
  const user = req.user!;
  const ids = user.isCeo
    ? null
    : await getDescendantIds(user.id);
  if (ids !== null && ids.length === 0) return res.json({ users: [] });
  const rows = user.isCeo
    ? await db
        .prepare(
          `SELECT u.id, u.name, d.name AS department_name FROM users u
           LEFT JOIN memberships m ON m.user_id = u.id LEFT JOIN departments d ON d.id = m.department_id
           WHERE u.active = 1 AND u.is_ceo = 0 ORDER BY u.name`
        )
        .all()
    : await db
        .prepare(
          `SELECT u.id, u.name, d.name AS department_name FROM users u
           LEFT JOIN memberships m ON m.user_id = u.id LEFT JOIN departments d ON d.id = m.department_id
           WHERE u.active = 1 AND u.id IN (${ids!.map(() => '?').join(',')}) ORDER BY u.name`
        )
        .all(...ids!);
  res.json({ users: rows });
});

meetingsRouter.get('/meetings/ice-servers', requireAuth, (_req, res) => {
  const iceServers: Array<{ urls: string; username?: string; credential?: string }> = [
    { urls: 'stun:stun.l.google.com:19302' },
  ];
  if (process.env.TURN_URL) {
    iceServers.push({
      urls: process.env.TURN_URL,
      username: process.env.TURN_USERNAME || undefined,
      credential: process.env.TURN_CREDENTIAL || undefined,
    });
  }
  res.json({ iceServers });
});

async function isParticipant(meetingId: number, userId: number): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 FROM meeting_participants WHERE meeting_id = ? AND user_id = ?')
    .get(meetingId, userId);
  return !!row;
}

// You may only invite people under you in the reporting chain — the CEO's
// "under" is everyone. Throws with the offending id so the route can 400.
async function assertCanInvite(actor: { id: number; isCeo: boolean }, targetIds: number[]) {
  if (actor.isCeo) return;
  const allowed = new Set(await getDescendantIds(actor.id));
  const outside = targetIds.find((id) => id !== actor.id && !allowed.has(id));
  if (outside !== undefined) {
    const err = new Error('You can only invite people who report to you') as Error & { status: number };
    err.status = 400;
    throw err;
  }
}

// A scheduled time arrives from <input type="datetime-local"> as
// "YYYY-MM-DDTHH:MM"; stored with a space to match every other timestamp
// column in this schema.
function normalizeScheduledAt(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const s = String(raw).replace('T', ' ').trim();
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s)) return null;
  return s.slice(0, 16);
}

// CEO, department heads, and anyone with direct reports can create a
// meeting with an explicit participant list. The creator is always a
// participant themselves. Without scheduledAt the meeting starts instantly
// (the original behavior); with it, the room stays closed until the creator
// explicitly starts it.
meetingsRouter.post('/meetings', requireAuth, requireMeetingCreator, async (req, res) => {
  const user = req.user!;
  const { title, participantIds, scheduledAt } = req.body ?? {};
  const ids = Array.isArray(participantIds) ? participantIds.map(Number).filter((n) => Number.isFinite(n) && n > 0) : [];
  if (ids.length === 0) return res.status(400).json({ error: 'At least one participant is required' });

  try {
    await assertCanInvite(user, ids);
  } catch (e) {
    return res.status((e as { status?: number }).status ?? 400).json({ error: (e as Error).message });
  }

  const scheduled = normalizeScheduledAt(scheduledAt);
  if (scheduledAt !== undefined && scheduledAt !== null && scheduledAt !== '' && !scheduled) {
    return res.status(400).json({ error: 'scheduledAt must be YYYY-MM-DD HH:MM' });
  }

  const cleanTitle = String(title ?? '').trim() || 'Meeting';
  const info = scheduled
    ? await db.prepare('INSERT INTO meetings (title, created_by, scheduled_at) VALUES (?, ?, ?)').run(cleanTitle, user.id, scheduled)
    : await db.prepare("INSERT INTO meetings (title, created_by, started_at) VALUES (?, ?, datetime('now'))").run(cleanTitle, user.id);
  const meetingId = Number(info.lastInsertRowid);

  const invited = [...new Set([user.id, ...ids])];
  for (const uid of invited) {
    const target = await db.prepare('SELECT id, active FROM users WHERE id = ?').get(uid) as
      | { id: number; active: number }
      | undefined;
    if (!target?.active) continue;
    await db
      .prepare('INSERT OR IGNORE INTO meeting_participants (meeting_id, user_id) VALUES (?, ?)')
      .run(meetingId, uid);
    if (uid !== user.id) {
      const message = scheduled
        ? `${user.name} scheduled a meeting with you: ${cleanTitle} — ${scheduled}`
        : `${user.name} invited you to a meeting: ${cleanTitle}`;
      await notify(uid, 'meeting', message, `/portal/meetings/${meetingId}`);
    }
  }
  // Silently surface the meeting to everyone above the creator in the
  // reporting chain — they weren't invited, but they can see it and join
  // if they want to. No notification: this isn't an invite, just visibility.
  const ancestors = await getAncestorIds(user.id);
  for (const uid of ancestors) {
    const target = await db.prepare('SELECT id, active FROM users WHERE id = ?').get(uid) as
      | { id: number; active: number }
      | undefined;
    if (!target?.active) continue;
    await db.prepare('INSERT OR IGNORE INTO meeting_participants (meeting_id, user_id) VALUES (?, ?)').run(meetingId, uid);
  }
  await logActivity(user.id, 'meeting', meetingId, 'created', { participantIds: invited, scheduledAt: scheduled });
  res.json({ id: meetingId });
});

// Reschedule/rename/re-invite — only while the meeting hasn't started yet.
// Once a room is live (or done), its record is history, not a draft.
meetingsRouter.patch('/meetings/:id', requireAuth, requireMeetingCreator, async (req, res) => {
  const id = Number(req.params.id);
  const user = req.user!;
  const meeting = await db.prepare('SELECT * FROM meetings WHERE id = ?').get(id) as
    | { id: number; created_by: number; title: string; scheduled_at: string | null; started_at: string | null; ended_at: string | null; cancelled_at: string | null }
    | undefined;
  if (!meeting || !(await isParticipant(id, user.id))) return res.status(404).json({ error: 'Not found' });
  if (meeting.created_by !== user.id) return res.status(403).json({ error: 'Only the meeting creator can edit it' });
  if (meeting.started_at || meeting.ended_at) return res.status(409).json({ error: 'Meeting already started' });
  if (meeting.cancelled_at) return res.status(409).json({ error: 'Meeting was cancelled' });

  const { title, scheduledAt, participantIds } = req.body ?? {};
  if (title?.trim()) await db.prepare('UPDATE meetings SET title = ? WHERE id = ?').run(title.trim(), id);
  if (scheduledAt !== undefined) {
    const scheduled = normalizeScheduledAt(scheduledAt);
    if (!scheduled) return res.status(400).json({ error: 'scheduledAt must be YYYY-MM-DD HH:MM' });
    await db.prepare('UPDATE meetings SET scheduled_at = ? WHERE id = ?').run(scheduled, id);
  }
  if (Array.isArray(participantIds)) {
    const requested = participantIds.map(Number).filter((n) => Number.isFinite(n) && n > 0);
    try {
      await assertCanInvite(user, requested);
    } catch (e) {
      return res.status((e as { status?: number }).status ?? 400).json({ error: (e as Error).message });
    }
    const ids = new Set([user.id, ...requested]);
    if (ids.size < 2) return res.status(400).json({ error: 'At least one participant is required' });
    const before = await db.prepare('SELECT user_id FROM meeting_participants WHERE meeting_id = ?').all(id) as Array<{ user_id: number }>;
    const beforeIds = new Set(before.map((r) => r.user_id));
    await db.prepare('DELETE FROM meeting_participants WHERE meeting_id = ?').run(id);
    for (const uid of ids) {
      const target = await db.prepare('SELECT id, active FROM users WHERE id = ?').get(uid) as { id: number; active: number } | undefined;
      if (!target?.active) continue;
      await db.prepare('INSERT OR IGNORE INTO meeting_participants (meeting_id, user_id) VALUES (?, ?)').run(id, uid);
      if (uid !== user.id && !beforeIds.has(uid)) {
        await notify(uid, 'meeting', `${user.name} scheduled a meeting with you: ${meeting.title}`, `/portal/meetings/${id}`);
      }
    }
    // Ancestors were wiped by the DELETE above along with everyone else —
    // re-surface the meeting to them (silently, same as on creation).
    const ancestors = await getAncestorIds(user.id);
    for (const uid of ancestors) {
      const target = await db.prepare('SELECT id, active FROM users WHERE id = ?').get(uid) as { id: number; active: number } | undefined;
      if (!target?.active) continue;
      await db.prepare('INSERT OR IGNORE INTO meeting_participants (meeting_id, user_id) VALUES (?, ?)').run(id, uid);
    }
  }
  await logActivity(user.id, 'meeting', id, 'updated', { title, scheduledAt });
  res.json({ ok: true });
});

// Start a scheduled meeting — opens the room and pings everyone invited.
meetingsRouter.post('/meetings/:id/start', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const user = req.user!;
  const meeting = await db.prepare('SELECT * FROM meetings WHERE id = ?').get(id) as
    | { id: number; created_by: number; title: string; started_at: string | null; ended_at: string | null; cancelled_at: string | null }
    | undefined;
  if (!meeting || !(await isParticipant(id, user.id))) return res.status(404).json({ error: 'Not found' });
  if (meeting.created_by !== user.id) return res.status(403).json({ error: 'Only the meeting creator can start it' });
  if (meeting.cancelled_at) return res.status(409).json({ error: 'Meeting was cancelled' });
  if (meeting.ended_at) return res.status(409).json({ error: 'Meeting has ended' });
  if (!meeting.started_at) {
    await db.prepare("UPDATE meetings SET started_at = datetime('now') WHERE id = ?").run(id);
    const others = await db.prepare('SELECT user_id FROM meeting_participants WHERE meeting_id = ? AND user_id != ?').all(id, user.id) as Array<{ user_id: number }>;
    for (const o of others) {
      await notify(o.user_id, 'meeting', `Meeting starting now: ${meeting.title}`, `/portal/meetings/${id}`);
    }
    await logActivity(user.id, 'meeting', id, 'started');
  }
  res.json({ ok: true });
});

// Cancel a scheduled meeting before it starts. Soft flag — the record
// survives for the audit trail, it just leaves everyone's list.
meetingsRouter.post('/meetings/:id/cancel', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const user = req.user!;
  const meeting = await db.prepare('SELECT * FROM meetings WHERE id = ?').get(id) as
    | { id: number; created_by: number; title: string; started_at: string | null; ended_at: string | null; cancelled_at: string | null }
    | undefined;
  if (!meeting || !(await isParticipant(id, user.id))) return res.status(404).json({ error: 'Not found' });
  if (meeting.created_by !== user.id) return res.status(403).json({ error: 'Only the meeting creator can cancel it' });
  if (meeting.started_at || meeting.ended_at) return res.status(409).json({ error: 'Meeting already started — end it instead' });
  if (!meeting.cancelled_at) {
    await db.prepare("UPDATE meetings SET cancelled_at = datetime('now') WHERE id = ?").run(id);
    const others = await db.prepare('SELECT user_id FROM meeting_participants WHERE meeting_id = ? AND user_id != ?').all(id, user.id) as Array<{ user_id: number }>;
    for (const o of others) {
      await notify(o.user_id, 'meeting', `Meeting cancelled: ${meeting.title}`, '/portal/meetings');
    }
    await logActivity(user.id, 'meeting', id, 'cancelled');
  }
  res.json({ ok: true });
});

// Meetings I'm invited to: live and upcoming plus recently ended for
// context. Cancelled ones drop out of everyone's list (the cancellation
// notification is the goodbye).
meetingsRouter.get('/meetings', requireAuth, async (req, res) => {
  const meetings = await db
    .prepare(
      `SELECT m.id, m.title, m.created_by, m.ended_at, m.created_at, m.scheduled_at, m.started_at, u.name AS creator_name,
              (SELECT COUNT(*) FROM meeting_participants x WHERE x.meeting_id = m.id AND x.joined_at IS NOT NULL AND x.left_at IS NULL) AS in_room_count
       FROM meetings m
       JOIN meeting_participants p ON p.meeting_id = m.id AND p.user_id = ?
       JOIN users u ON u.id = m.created_by
       WHERE m.cancelled_at IS NULL
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
  const meeting = await db.prepare('SELECT ended_at, started_at, cancelled_at FROM meetings WHERE id = ?').get(id) as
    { ended_at: string | null; started_at: string | null; cancelled_at: string | null };
  if (meeting.cancelled_at) return res.status(409).json({ error: 'Meeting was cancelled' });
  if (meeting.ended_at) return res.status(409).json({ error: 'Meeting has ended' });
  if (!meeting.started_at) return res.status(409).json({ error: 'Meeting has not started yet' });

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

// Host mic control. Media is peer-to-peer, so the server can't reach into
// someone's hardware — this sends a 'force-mute' signal the target's own
// client honors by disabling its local mic track (a soft mute, the same
// model Zoom/Meet use: the host can silence you, you can still unmute
// yourself again afterward — this isn't a lock, it's "please mute").
meetingsRouter.post('/meetings/:id/mute', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const user = req.user!;
  const meeting = await db.prepare('SELECT created_by, ended_at FROM meetings WHERE id = ?').get(id) as
    | { created_by: number; ended_at: string | null }
    | undefined;
  if (!meeting || !(await isParticipant(id, user.id))) return res.status(404).json({ error: 'Not found' });
  if (meeting.created_by !== user.id) return res.status(403).json({ error: 'Only the meeting creator can mute participants' });
  if (meeting.ended_at) return res.status(409).json({ error: 'Meeting has ended' });
  const target = Number(req.body?.userId);
  if (!target || target === user.id) return res.status(400).json({ error: 'A valid target participant is required' });
  if (!(await isParticipant(id, target))) return res.status(400).json({ error: 'That person is not in this meeting' });
  await db
    .prepare('INSERT INTO meeting_signals (meeting_id, from_user, to_user, type, payload) VALUES (?, ?, ?, ?, ?)')
    .run(id, user.id, target, 'force-mute', '{}');
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
