import { Router } from 'express';
import { db, logActivity } from './db.js';
import { requireAuth, requireCeo } from './auth.js';

export const settingsRouter = Router();

// Company-wide attendance/payroll policy — CEO only, both read and write.
// Deduction amounts are financial data, same sensitivity bar as finance/salary.
settingsRouter.get('/settings/attendance', requireAuth, requireCeo, async (_req, res) => {
  const settings = await db.prepare('SELECT * FROM attendance_settings WHERE id = 1').get();
  res.json({ settings });
});

const DEDUCTION_TYPES = ['fixed', 'percentage'];

settingsRouter.patch('/settings/attendance', requireAuth, requireCeo, async (req, res) => {
  const {
    officeStartTime,
    officeEndTime,
    lateThresholdMinutes,
    halfDayThresholdMinutes,
    maxAbsentAllowed,
    lateDeductionType,
    lateDeductionAmount,
    halfDayDeductionType,
    halfDayDeductionAmount,
    absentDeductionType,
    absentDeductionAmount,
  } = req.body ?? {};

  const timeRe = /^([01]\d|2[0-3]):([0-5]\d)$/;
  if (officeStartTime !== undefined && !timeRe.test(officeStartTime)) {
    return res.status(400).json({ error: 'Office start time must be HH:MM (24h)' });
  }
  if (officeEndTime !== undefined && !timeRe.test(officeEndTime)) {
    return res.status(400).json({ error: 'Office end time must be HH:MM (24h)' });
  }
  for (const [label, val] of [
    ['lateDeductionType', lateDeductionType],
    ['halfDayDeductionType', halfDayDeductionType],
    ['absentDeductionType', absentDeductionType],
  ] as const) {
    if (val !== undefined && !DEDUCTION_TYPES.includes(val)) {
      return res.status(400).json({ error: `${label} must be 'fixed' or 'percentage'` });
    }
  }
  // Numeric fields: reject NaN/negatives up front — otherwise garbage input
  // 500s at the database and a negative threshold silently mis-categorizes
  // every future check-in.
  for (const [label, val] of [
    ['lateThresholdMinutes', lateThresholdMinutes],
    ['halfDayThresholdMinutes', halfDayThresholdMinutes],
    ['maxAbsentAllowed', maxAbsentAllowed],
    ['lateDeductionAmount', lateDeductionAmount],
    ['halfDayDeductionAmount', halfDayDeductionAmount],
    ['absentDeductionAmount', absentDeductionAmount],
  ] as const) {
    if (val !== undefined && (!Number.isFinite(Number(val)) || Number(val) < 0)) {
      return res.status(400).json({ error: `${label} must be a non-negative number` });
    }
  }
  const lateThresh = lateThresholdMinutes !== undefined ? Number(lateThresholdMinutes) : undefined;
  const halfThresh = halfDayThresholdMinutes !== undefined ? Number(halfDayThresholdMinutes) : undefined;
  if (lateThresh !== undefined && halfThresh !== undefined && halfThresh <= lateThresh) {
    return res.status(400).json({ error: 'Half-day threshold must be greater than the late threshold' });
  }

  const sets: Array<[string, unknown]> = [];
  if (officeStartTime !== undefined) sets.push(['office_start_time', officeStartTime]);
  if (officeEndTime !== undefined) sets.push(['office_end_time', officeEndTime]);
  if (lateThresholdMinutes !== undefined) sets.push(['late_threshold_minutes', Number(lateThresholdMinutes)]);
  if (halfDayThresholdMinutes !== undefined) sets.push(['half_day_threshold_minutes', Number(halfDayThresholdMinutes)]);
  if (maxAbsentAllowed !== undefined) sets.push(['max_absent_allowed', Number(maxAbsentAllowed)]);
  if (lateDeductionType !== undefined) sets.push(['late_deduction_type', lateDeductionType]);
  if (lateDeductionAmount !== undefined) sets.push(['late_deduction_amount', Number(lateDeductionAmount)]);
  if (halfDayDeductionType !== undefined) sets.push(['half_day_deduction_type', halfDayDeductionType]);
  if (halfDayDeductionAmount !== undefined) sets.push(['half_day_deduction_amount', Number(halfDayDeductionAmount)]);
  if (absentDeductionType !== undefined) sets.push(['absent_deduction_type', absentDeductionType]);
  if (absentDeductionAmount !== undefined) sets.push(['absent_deduction_amount', Number(absentDeductionAmount)]);

  if (sets.length === 0) return res.status(400).json({ error: 'No fields to update' });

  for (const [col, val] of sets) {
    await db.prepare(`UPDATE attendance_settings SET ${col} = ? WHERE id = 1`).run(val);
  }
  await db.prepare("UPDATE attendance_settings SET updated_by = ?, updated_at = datetime('now') WHERE id = 1").run(
    req.user!.id
  );
  await logActivity(req.user!.id, 'settings', 1, 'attendance_settings_updated', {
    fields: sets.map(([col]) => col),
  });

  const settings = await db.prepare('SELECT * FROM attendance_settings WHERE id = 1').get();
  res.json({ settings });
});
