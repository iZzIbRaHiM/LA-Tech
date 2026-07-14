import { Router } from 'express';
import { db, logActivity, notify } from './db.js';
import { requireAuth, requireCeo } from './auth.js';

// Salary is CEO-only — deliberately not reusing the finance-delegate
// pattern (hasFinanceAccess). Personal payroll data is at least as
// sensitive as project finance, arguably more so, and the request was
// explicit: "ceo and only ceo."
export const salaryRouter = Router();
// Gate applied inline per route below. This router previously used
// router.use('/salary', requireAuth, requireCeo) and every /salary route
// 404'd in the running app (observed live 2026-07; the same symptom hit the
// new org-hierarchy router, while routes-finance.ts's identical-looking
// pattern worked — root cause never fully pinned down, a minimal two-router
// repro of the pattern works fine in isolation). Inline middleware is the
// pattern every other router here already uses, and is verified working.
const gate = [requireAuth, requireCeo] as const;

interface DeductionSettings {
  max_absent_allowed: number;
  late_deduction_type: 'fixed' | 'percentage';
  late_deduction_amount: number;
  half_day_deduction_type: 'fixed' | 'percentage';
  half_day_deduction_amount: number;
  absent_deduction_type: 'fixed' | 'percentage';
  absent_deduction_amount: number;
}

function computeDeduction(type: 'fixed' | 'percentage', amount: number, count: number, baseSalary: number): number {
  if (count <= 0) return 0;
  if (type === 'percentage') return (amount / 100) * baseSalary * count;
  return amount * count;
}

async function getSettings(): Promise<DeductionSettings> {
  return (await db.prepare('SELECT * FROM attendance_settings WHERE id = 1').get()) as DeductionSettings;
}

async function currentSalary(userId: number): Promise<number | null> {
  const row = (await db
    .prepare('SELECT amount FROM salaries WHERE user_id = ? ORDER BY effective_from DESC, id DESC LIMIT 1')
    .get(userId)) as { amount: number } | undefined;
  return row?.amount ?? null;
}

// Employee list with current salary — non-CEO active users only.
salaryRouter.get('/salary/employees', ...gate, async (_req, res) => {
  const users = await db
    .prepare(
      `SELECT u.id, u.name, u.email, d.name AS department_name
       FROM users u
       LEFT JOIN memberships m ON m.user_id = u.id
       LEFT JOIN departments d ON d.id = m.department_id
       WHERE u.is_ceo = 0 AND u.active = 1
       ORDER BY u.name`
    )
    .all() as Array<{ id: number; name: string; email: string; department_name: string | null }>;

  const withSalary = await Promise.all(
    users.map(async (u) => ({ ...u, salary: await currentSalary(u.id) }))
  );
  res.json({ employees: withSalary });
});

salaryRouter.post('/salary/:userId/assign', ...gate, async (req, res) => {
  const userId = Number(req.params.userId);
  const target = await db.prepare('SELECT id, is_ceo FROM users WHERE id = ?').get(userId) as
    | { id: number; is_ceo: number }
    | undefined;
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.is_ceo) return res.status(400).json({ error: 'The CEO does not have an assignable salary' });

  const { amount } = req.body ?? {};
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'Salary must be a positive number' });

  const today = new Date().toISOString().slice(0, 10);
  await db
    .prepare('INSERT INTO salaries (user_id, amount, effective_from, set_by) VALUES (?, ?, ?, ?)')
    .run(userId, amt, today, req.user!.id);
  await logActivity(req.user!.id, 'salary', userId, 'salary_assigned', { amount: amt });
  res.json({ ok: true, amount: amt });
});

// Preview: for a given employee + period, compute confirmed late/half-day/
// billable-absent counts and the suggested (not yet applied) deductions.
salaryRouter.get('/salary/:userId/preview', ...gate, async (req, res) => {
  const userId = Number(req.params.userId);
  const period = String(req.query.period ?? '');
  if (!/^\d{4}-\d{2}$/.test(period)) return res.status(400).json({ error: 'period must be YYYY-MM' });

  const baseSalary = await currentSalary(userId);
  if (baseSalary == null) return res.status(400).json({ error: 'No salary assigned to this employee yet' });

  const settings = await getSettings();
  // Only confirmed (approved) records count — a rejected "late" was never
  // established as true, and there's nothing left to dispute once approved.
  const counts = (await db
    .prepare(
      `SELECT
         COUNT(*) FILTER (WHERE category = 'late') AS late_count,
         COUNT(*) FILTER (WHERE category = 'half_day') AS half_day_count,
         COUNT(*) FILTER (WHERE category = 'absent') AS absent_count
       FROM attendance
       WHERE user_id = ? AND validation_status = 'approved' AND record_date LIKE ?`
    )
    .get(userId, `${period}%`)) as { late_count: number; half_day_count: number; absent_count: number };

  const lateCount = Number(counts.late_count);
  const halfDayCount = Number(counts.half_day_count);
  const billableAbsentCount = Math.max(0, Number(counts.absent_count) - settings.max_absent_allowed);

  const lateDeduction = computeDeduction(settings.late_deduction_type, settings.late_deduction_amount, lateCount, baseSalary);
  const halfDayDeduction = computeDeduction(
    settings.half_day_deduction_type,
    settings.half_day_deduction_amount,
    halfDayCount,
    baseSalary
  );
  const absentDeduction = computeDeduction(
    settings.absent_deduction_type,
    settings.absent_deduction_amount,
    billableAbsentCount,
    baseSalary
  );

  res.json({
    baseSalary,
    lateCount,
    halfDayCount,
    absentCount: Number(counts.absent_count),
    billableAbsentCount,
    maxAbsentAllowed: settings.max_absent_allowed,
    suggestedLateDeduction: lateDeduction,
    suggestedHalfDayDeduction: halfDayDeduction,
    suggestedAbsentDeduction: absentDeduction,
  });
});

salaryRouter.post('/salary/:userId/payments', ...gate, async (req, res) => {
  const userId = Number(req.params.userId);
  const {
    period,
    applyLateDeduction,
    applyHalfDayDeduction,
    applyAbsentDeduction,
    lateDeductionOverride,
    halfDayDeductionOverride,
    absentDeductionOverride,
    note,
  } = req.body ?? {};
  if (!/^\d{4}-\d{2}$/.test(period ?? '')) return res.status(400).json({ error: 'period must be YYYY-MM' });

  const existing = await db.prepare('SELECT id FROM salary_payments WHERE user_id = ? AND period = ?').get(userId, period);
  if (existing) return res.status(409).json({ error: 'A payment record for this employee and period already exists' });

  const baseSalary = await currentSalary(userId);
  if (baseSalary == null) return res.status(400).json({ error: 'No salary assigned to this employee yet' });

  const settings = await getSettings();
  const counts = (await db
    .prepare(
      `SELECT
         COUNT(*) FILTER (WHERE category = 'late') AS late_count,
         COUNT(*) FILTER (WHERE category = 'half_day') AS half_day_count,
         COUNT(*) FILTER (WHERE category = 'absent') AS absent_count
       FROM attendance
       WHERE user_id = ? AND validation_status = 'approved' AND record_date LIKE ?`
    )
    .get(userId, `${period}%`)) as { late_count: number; half_day_count: number; absent_count: number };

  const lateCount = Number(counts.late_count);
  const halfDayCount = Number(counts.half_day_count);
  const billableAbsentCount = Math.max(0, Number(counts.absent_count) - settings.max_absent_allowed);

  // The CEO can override the suggested number outright; otherwise it's
  // recomputed server-side rather than trusting whatever the client sends.
  const lateDeductionTotal =
    lateDeductionOverride !== undefined
      ? Number(lateDeductionOverride)
      : computeDeduction(settings.late_deduction_type, settings.late_deduction_amount, lateCount, baseSalary);
  const halfDayDeductionTotal =
    halfDayDeductionOverride !== undefined
      ? Number(halfDayDeductionOverride)
      : computeDeduction(settings.half_day_deduction_type, settings.half_day_deduction_amount, halfDayCount, baseSalary);
  const absentDeductionTotal =
    absentDeductionOverride !== undefined
      ? Number(absentDeductionOverride)
      : computeDeduction(settings.absent_deduction_type, settings.absent_deduction_amount, billableAbsentCount, baseSalary);

  const applyLate = applyLateDeduction !== false;
  const applyHalfDay = applyHalfDayDeduction !== false;
  const applyAbsent = applyAbsentDeduction !== false;

  const netAmount =
    baseSalary -
    (applyLate ? lateDeductionTotal : 0) -
    (applyHalfDay ? halfDayDeductionTotal : 0) -
    (applyAbsent ? absentDeductionTotal : 0);

  const info = await db
    .prepare(
      `INSERT INTO salary_payments
        (user_id, period, base_amount, late_count, half_day_count, billable_absent_count,
         apply_late_deduction, apply_half_day_deduction, apply_absent_deduction,
         late_deduction_total, half_day_deduction_total, absent_deduction_total,
         net_amount, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId,
      period,
      baseSalary,
      lateCount,
      halfDayCount,
      billableAbsentCount,
      applyLate ? 1 : 0,
      applyHalfDay ? 1 : 0,
      applyAbsent ? 1 : 0,
      lateDeductionTotal,
      halfDayDeductionTotal,
      absentDeductionTotal,
      netAmount,
      note?.trim() ?? '',
      req.user!.id
    );

  await logActivity(req.user!.id, 'salary', Number(info.lastInsertRowid), 'payment_created', {
    userId,
    period,
    netAmount,
  });
  await notify(userId, 'salary', `Your salary payment for ${period} has been recorded`, '/portal/salary');
  res.json({ id: Number(info.lastInsertRowid), netAmount });
});

// Company-wide payment ledger, for Finance overview — CEO only (the router-
// level guard above already enforces this; salary stays stricter than the
// finance-delegate model, so this must never be surfaced anywhere a
// finance delegate could reach it).
// MUST be registered before /salary/:userId/payments — Express matches in
// order, and the param route would otherwise capture this path with
// userId="payments" (NaN → query error).
salaryRouter.get('/salary/payments', ...gate, async (req, res) => {
  const period = typeof req.query.period === 'string' ? req.query.period : undefined;
  const where = period ? 'WHERE sp.period = ?' : '';
  const params = period ? [period] : [];
  const payments = await db
    .prepare(
      `SELECT sp.*, u.name AS user_name FROM salary_payments sp
       JOIN users u ON u.id = sp.user_id
       ${where} ORDER BY sp.period DESC, sp.id DESC`
    )
    .all(...params) as Array<{ net_amount: number }>;
  const total = payments.reduce((sum, p) => sum + Number(p.net_amount), 0);
  res.json({ payments, total });
});

salaryRouter.get('/salary/:userId/payments', ...gate, async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId)) return res.status(400).json({ error: 'Invalid user id' });
  const payments = await db
    .prepare('SELECT * FROM salary_payments WHERE user_id = ? ORDER BY period DESC')
    .all(userId);
  res.json({ payments });
});
