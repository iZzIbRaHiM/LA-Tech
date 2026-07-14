import { Router } from 'express';
import { db, logActivity, notify } from './db.js';
import { requireAuth, requireCeo } from './auth.js';

// Multiple office timings: CEO-managed schedules assigned to a department
// or an individual. Resolution order at check-in time (see resolveSchedule):
// individual assignment > department assignment > attendance_settings default.
export const schedulesRouter = Router();

export interface ResolvedSchedule {
  office_start_time: string;
  office_end_time: string;
  late_threshold_minutes: number;
  half_day_threshold_minutes: number;
  schedule_name: string | null; // null = company default
}

export async function resolveSchedule(userId: number): Promise<ResolvedSchedule> {
  const own = await db
    .prepare(
      `SELECT w.name, w.office_start_time, w.office_end_time, w.late_threshold_minutes, w.half_day_threshold_minutes
       FROM schedule_assignments a JOIN work_schedules w ON w.id = a.schedule_id
       WHERE a.target_type = 'user' AND a.target_id = ?`
    )
    .get(userId) as
    | { name: string; office_start_time: string; office_end_time: string; late_threshold_minutes: number; half_day_threshold_minutes: number }
    | undefined;
  if (own) return { ...own, schedule_name: own.name };

  const dept = await db
    .prepare(
      `SELECT w.name, w.office_start_time, w.office_end_time, w.late_threshold_minutes, w.half_day_threshold_minutes
       FROM memberships m
       JOIN schedule_assignments a ON a.target_type = 'department' AND a.target_id = m.department_id
       JOIN work_schedules w ON w.id = a.schedule_id
       WHERE m.user_id = ?`
    )
    .get(userId) as
    | { name: string; office_start_time: string; office_end_time: string; late_threshold_minutes: number; half_day_threshold_minutes: number }
    | undefined;
  if (dept) return { ...dept, schedule_name: dept.name };

  const fallback = await db
    .prepare('SELECT office_start_time, office_end_time, late_threshold_minutes, half_day_threshold_minutes FROM attendance_settings WHERE id = 1')
    .get() as { office_start_time: string; office_end_time: string; late_threshold_minutes: number; half_day_threshold_minutes: number };
  return { ...fallback, schedule_name: null };
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// List schedules with their assignments (names resolved for display).
schedulesRouter.get('/schedules', requireAuth, requireCeo, async (_req, res) => {
  const schedules = await db.prepare('SELECT * FROM work_schedules ORDER BY name').all();
  const assignments = await db
    .prepare(
      `SELECT a.schedule_id, a.target_type, a.target_id,
              CASE WHEN a.target_type = 'user' THEN u.name ELSE d.name END AS target_name
       FROM schedule_assignments a
       LEFT JOIN users u ON a.target_type = 'user' AND u.id = a.target_id
       LEFT JOIN departments d ON a.target_type = 'department' AND d.id = a.target_id`
    )
    .all();
  res.json({ schedules, assignments });
});

schedulesRouter.post('/schedules', requireAuth, requireCeo, async (req, res) => {
  const { name, officeStartTime, officeEndTime, lateThresholdMinutes, halfDayThresholdMinutes } = req.body ?? {};
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  if (!TIME_RE.test(officeStartTime ?? '') || !TIME_RE.test(officeEndTime ?? '')) {
    return res.status(400).json({ error: 'Times must be HH:MM (24h)' });
  }
  const info = await db
    .prepare(
      'INSERT INTO work_schedules (name, office_start_time, office_end_time, late_threshold_minutes, half_day_threshold_minutes, created_by) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(
      name.trim(),
      officeStartTime,
      officeEndTime,
      Number(lateThresholdMinutes) || 15,
      Number(halfDayThresholdMinutes) || 90,
      req.user!.id
    );
  await logActivity(req.user!.id, 'schedule', Number(info.lastInsertRowid), 'created', { name: name.trim() });
  res.json({ id: Number(info.lastInsertRowid) });
});

schedulesRouter.patch('/schedules/:id', requireAuth, requireCeo, async (req, res) => {
  const id = Number(req.params.id);
  const existing = await db.prepare('SELECT id FROM work_schedules WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { name, officeStartTime, officeEndTime, lateThresholdMinutes, halfDayThresholdMinutes } = req.body ?? {};
  if ((officeStartTime !== undefined && !TIME_RE.test(officeStartTime)) || (officeEndTime !== undefined && !TIME_RE.test(officeEndTime))) {
    return res.status(400).json({ error: 'Times must be HH:MM (24h)' });
  }
  if (
    (lateThresholdMinutes !== undefined && !Number.isFinite(Number(lateThresholdMinutes))) ||
    (halfDayThresholdMinutes !== undefined && !Number.isFinite(Number(halfDayThresholdMinutes)))
  ) {
    return res.status(400).json({ error: 'Thresholds must be numbers (minutes)' });
  }
  const sets: Array<[string, unknown]> = [];
  if (name?.trim()) sets.push(['name', name.trim()]);
  if (officeStartTime !== undefined) sets.push(['office_start_time', officeStartTime]);
  if (officeEndTime !== undefined) sets.push(['office_end_time', officeEndTime]);
  if (lateThresholdMinutes !== undefined) sets.push(['late_threshold_minutes', Number(lateThresholdMinutes)]);
  if (halfDayThresholdMinutes !== undefined) sets.push(['half_day_threshold_minutes', Number(halfDayThresholdMinutes)]);
  for (const [col, val] of sets) {
    await db.prepare(`UPDATE work_schedules SET ${col} = ? WHERE id = ?`).run(val, id);
  }
  if (sets.length) await logActivity(req.user!.id, 'schedule', id, 'updated', req.body);
  res.json({ ok: true });
});

schedulesRouter.delete('/schedules/:id', requireAuth, requireCeo, async (req, res) => {
  const id = Number(req.params.id);
  await db.prepare('DELETE FROM work_schedules WHERE id = ?').run(id); // assignments cascade
  await logActivity(req.user!.id, 'schedule', id, 'deleted');
  res.json({ ok: true });
});

// Assign to a department or individual. One schedule per target — assigning
// replaces any previous assignment for that target.
schedulesRouter.post('/schedules/:id/assign', requireAuth, requireCeo, async (req, res) => {
  const scheduleId = Number(req.params.id);
  const schedule = await db.prepare('SELECT id, name FROM work_schedules WHERE id = ?').get(scheduleId) as
    | { id: number; name: string }
    | undefined;
  if (!schedule) return res.status(404).json({ error: 'Not found' });

  const { targetType, targetId } = req.body ?? {};
  if (!['department', 'user'].includes(targetType)) return res.status(400).json({ error: "targetType must be 'department' or 'user'" });
  const tid = Number(targetId);
  if (!tid) return res.status(400).json({ error: 'targetId required' });

  if (targetType === 'user') {
    const target = await db.prepare('SELECT id, is_ceo, active FROM users WHERE id = ?').get(tid) as
      | { id: number; is_ceo: number; active: number }
      | undefined;
    if (!target || !target.active) return res.status(404).json({ error: 'User not found or inactive' });
    if (target.is_ceo) return res.status(400).json({ error: 'Attendance tracking does not apply to the CEO' });
  } else {
    const dept = await db.prepare('SELECT id FROM departments WHERE id = ? AND archived_at IS NULL').get(tid);
    if (!dept) return res.status(404).json({ error: 'Department not found' });
  }

  await db.prepare('DELETE FROM schedule_assignments WHERE target_type = ? AND target_id = ?').run(targetType, tid);
  await db.prepare('INSERT INTO schedule_assignments (schedule_id, target_type, target_id) VALUES (?, ?, ?)').run(scheduleId, targetType, tid);
  await logActivity(req.user!.id, 'schedule', scheduleId, 'assigned', { targetType, targetId: tid });
  if (targetType === 'user') {
    await notify(tid, 'org', `Your office timing is now "${schedule.name}"`, '/portal/attendance');
  }
  res.json({ ok: true });
});

schedulesRouter.post('/schedules/unassign', requireAuth, requireCeo, async (req, res) => {
  const { targetType, targetId } = req.body ?? {};
  if (!['department', 'user'].includes(targetType) || !Number(targetId)) {
    return res.status(400).json({ error: 'targetType and targetId required' });
  }
  await db.prepare('DELETE FROM schedule_assignments WHERE target_type = ? AND target_id = ?').run(targetType, Number(targetId));
  await logActivity(req.user!.id, 'schedule', Number(targetId), 'unassigned', { targetType });
  res.json({ ok: true });
});

// Any signed-in user: what timing applies to me today (shown on Attendance).
schedulesRouter.get('/schedules/mine', requireAuth, async (req, res) => {
  res.json({ schedule: await resolveSchedule(req.user!.id) });
});
