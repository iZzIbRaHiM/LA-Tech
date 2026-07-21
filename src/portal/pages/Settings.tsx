import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { api } from '../api';
import OfficeTimings from '../components/OfficeTimings';

interface AttendanceSettings {
  office_start_time: string;
  office_end_time: string;
  late_threshold_minutes: number;
  half_day_threshold_minutes: number;
  max_absent_allowed: number;
  late_deduction_type: 'fixed' | 'percentage';
  late_deduction_amount: number;
  half_day_deduction_type: 'fixed' | 'percentage';
  half_day_deduction_amount: number;
  absent_deduction_type: 'fixed' | 'percentage';
  absent_deduction_amount: number;
}

const DEDUCTION_LABEL: Record<string, string> = { fixed: 'Fixed amount', percentage: '% of salary' };

export default function Settings() {
  const [form, setForm] = useState<AttendanceSettings | null>(null);
  const [saving, setSaving] = useState(false);

  const load = () => {
    api<{ settings: AttendanceSettings }>('/settings/attendance')
      .then((r) => setForm(r.settings))
      .catch((e) => toast.error(e.message));
  };
  useEffect(load, []);

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      await api('/settings/attendance', {
        method: 'PATCH',
        body: {
          officeStartTime: form.office_start_time,
          officeEndTime: form.office_end_time,
          lateThresholdMinutes: form.late_threshold_minutes,
          halfDayThresholdMinutes: form.half_day_threshold_minutes,
          maxAbsentAllowed: form.max_absent_allowed,
          lateDeductionType: form.late_deduction_type,
          lateDeductionAmount: form.late_deduction_amount,
          halfDayDeductionType: form.half_day_deduction_type,
          halfDayDeductionAmount: form.half_day_deduction_amount,
          absentDeductionType: form.absent_deduction_type,
          absentDeductionAmount: form.absent_deduction_amount,
        },
      });
      toast.success('Settings saved');
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setSaving(false);
    }
  };

  if (!form) return <div className="p-8 text-sm text-[#71717A]">Loading…</div>;

  const DeductionRow = ({
    label,
    typeKey,
    amountKey,
  }: {
    label: string;
    typeKey: keyof AttendanceSettings;
    amountKey: keyof AttendanceSettings;
  }) => (
    <div className="grid grid-cols-[1fr_140px_120px] gap-3 items-end">
      <Label className="mb-2">{label}</Label>
      <Select
        value={form[typeKey] as string}
        onValueChange={(v) => setForm({ ...form, [typeKey]: v as 'fixed' | 'percentage' })}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(DEDUCTION_LABEL).map(([v, l]) => (
            <SelectItem key={v} value={v}>
              {l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        type="number"
        min={0}
        step="0.01"
        value={form[amountKey] as number}
        onChange={(e) => setForm({ ...form, [amountKey]: Number(e.target.value) })}
      />
    </div>
  );

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="ptitle font-display font-bold text-2xl mb-1">Settings</h1>
      <p className="text-sm text-[#A1A1AA] mb-8">
        Company-wide attendance and payroll policy. Changes apply to attendance categorization and salary
        deductions going forward — already-validated attendance records aren't retroactively recategorized.
      </p>

      <section className="mb-8">
        <h2 className="text-sm font-medium text-[#A1A1AA] uppercase tracking-wide mb-3">Office hours</h2>
        <div className="grid grid-cols-2 gap-3 max-w-md">
          <div className="space-y-1.5">
            <Label>Office start time</Label>
            <Input
              type="time"
              value={form.office_start_time}
              onChange={(e) => setForm({ ...form, office_start_time: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Office end time</Label>
            <Input
              type="time"
              value={form.office_end_time}
              onChange={(e) => setForm({ ...form, office_end_time: e.target.value })}
            />
          </div>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-sm font-medium text-[#A1A1AA] uppercase tracking-wide mb-3">Check-in categorization</h2>
        <div className="grid grid-cols-2 gap-3 max-w-md">
          <div className="space-y-1.5">
            <Label>Late after (minutes)</Label>
            <Input
              type="number"
              min={0}
              value={form.late_threshold_minutes}
              onChange={(e) => setForm({ ...form, late_threshold_minutes: Number(e.target.value) })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Half-day after (minutes)</Label>
            <Input
              type="number"
              min={0}
              value={form.half_day_threshold_minutes}
              onChange={(e) => setForm({ ...form, half_day_threshold_minutes: Number(e.target.value) })}
            />
          </div>
        </div>
        <p className="text-xs text-[#71717A] mt-2">
          Checked in at or before start = on time. After start by more than the late threshold = late. After
          start by more than the half-day threshold = half day.
        </p>
      </section>

      <OfficeTimings />

      <section className="mb-8">
        <h2 className="text-sm font-medium text-[#A1A1AA] uppercase tracking-wide mb-3">Absences</h2>
        <div className="space-y-1.5 max-w-xs">
          <Label>Max absences allowed / month (free, no deduction)</Label>
          <Input
            type="number"
            min={0}
            value={form.max_absent_allowed}
            onChange={(e) => setForm({ ...form, max_absent_allowed: Number(e.target.value) })}
          />
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-sm font-medium text-[#A1A1AA] uppercase tracking-wide mb-4">Salary deductions</h2>
        <div className="space-y-4 max-w-xl">
          <DeductionRow label="Late check-in (per occurrence)" typeKey="late_deduction_type" amountKey="late_deduction_amount" />
          <DeductionRow label="Half day (per occurrence)" typeKey="half_day_deduction_type" amountKey="half_day_deduction_amount" />
          <DeductionRow
            label="Absence beyond the allowance (per day)"
            typeKey="absent_deduction_type"
            amountKey="absent_deduction_amount"
          />
        </div>
        <p className="text-xs text-[#71717A] mt-3">
          These are suggested deductions only — the CEO can still accept, adjust, or waive each one individually
          when creating a salary payment.
        </p>
      </section>

      <Button onClick={save} disabled={saving} className="bg-[#DFE104] text-black hover:bg-[#c9cb04] disabled:opacity-50">
        Save settings
      </Button>
    </div>
  );
}
