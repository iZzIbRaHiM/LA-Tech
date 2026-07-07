import { Fragment, useEffect, useState } from 'react';
import { Wallet, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { api } from '../api';

interface Employee {
  id: number;
  name: string;
  email: string;
  department_name: string | null;
  salary: number | null;
}

interface Preview {
  baseSalary: number;
  lateCount: number;
  halfDayCount: number;
  absentCount: number;
  billableAbsentCount: number;
  maxAbsentAllowed: number;
  suggestedLateDeduction: number;
  suggestedHalfDayDeduction: number;
  suggestedAbsentDeduction: number;
}

interface Payment {
  id: number;
  period: string;
  base_amount: number;
  late_count: number;
  half_day_count: number;
  billable_absent_count: number;
  apply_late_deduction: number;
  apply_half_day_deduction: number;
  apply_absent_deduction: number;
  late_deduction_total: number;
  half_day_deduction_total: number;
  absent_deduction_total: number;
  net_amount: number;
  status: string;
}

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Salary() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [assigning, setAssigning] = useState<Employee | null>(null);
  const [salaryInput, setSalaryInput] = useState('');
  const [payingFor, setPayingFor] = useState<Employee | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);

  const load = () => {
    api<{ employees: Employee[] }>('/salary/employees').then((r) => setEmployees(r.employees)).catch((e) => toast.error(e.message));
  };
  useEffect(load, []);

  const assignSalary = async () => {
    if (!assigning) return;
    const amount = Number(salaryInput);
    if (!Number.isFinite(amount) || amount <= 0) return;
    try {
      await api(`/salary/${assigning.id}/assign`, { method: 'POST', body: { amount } });
      toast.success(`Salary set for ${assigning.name}`);
      setAssigning(null);
      setSalaryInput('');
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  const toggleHistory = async (emp: Employee) => {
    if (expanded === emp.id) {
      setExpanded(null);
      return;
    }
    try {
      const r = await api<{ payments: Payment[] }>(`/salary/${emp.id}/payments`);
      setPayments(r.payments);
      setExpanded(emp.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="font-display font-bold text-2xl mb-1">Salary</h1>
      <p className="text-sm text-[#A1A1AA] mb-8">Visible only to the CEO.</p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Employee</TableHead>
            <TableHead>Department</TableHead>
            <TableHead className="text-right">Salary</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {employees.map((emp) => (
            <Fragment key={emp.id}>
              <TableRow>
                <TableCell>{emp.name}</TableCell>
                <TableCell className="text-[#A1A1AA]">{emp.department_name ?? 'Unassigned'}</TableCell>
                <TableCell className="text-right">{emp.salary != null ? fmt(emp.salary) : '—'}</TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setAssigning(emp);
                      setSalaryInput(emp.salary != null ? String(emp.salary) : '');
                    }}
                    className="text-[#A1A1AA] hover:text-[#FAFAFA]"
                  >
                    {emp.salary != null ? 'Update salary' : 'Assign salary'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={emp.salary == null}
                    onClick={() => setPayingFor(emp)}
                    className="text-[#DFE104] disabled:opacity-40"
                  >
                    <Wallet size={13} className="mr-1" /> New payment
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => toggleHistory(emp)} className="text-[#A1A1AA]">
                    {expanded === emp.id ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  </Button>
                </TableCell>
              </TableRow>
              {expanded === emp.id && (
                <TableRow key={`${emp.id}-history`}>
                  <TableCell colSpan={4} className="bg-[#0c0c0f]">
                    {payments.length === 0 ? (
                      <p className="text-sm text-[#71717A] py-2">No payment records yet.</p>
                    ) : (
                      <div className="py-2 space-y-1">
                        {payments.map((p) => (
                          <div key={p.id} className="flex items-center justify-between text-sm px-2 py-1.5 border-b border-[#1f1f23] last:border-0">
                            <span>{p.period}</span>
                            <span className="text-xs text-[#71717A]">
                              base {fmt(p.base_amount)} · late {p.late_count} · half-day {p.half_day_count} · absent (billable){' '}
                              {p.billable_absent_count}
                            </span>
                            <Badge variant="outline" className="text-xs">
                              net {fmt(p.net_amount)}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          ))}
        </TableBody>
      </Table>
      {employees.length === 0 && <p className="text-sm text-[#71717A] mt-4">No employees yet.</p>}

      <Dialog open={!!assigning} onOpenChange={(o) => !o && setAssigning(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{assigning?.salary != null ? 'Update' : 'Assign'} salary — {assigning?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Monthly salary <span className="text-red-500">*</span></Label>
            <Input type="number" min={0} step="0.01" value={salaryInput} onChange={(e) => setSalaryInput(e.target.value)} />
          </div>
          <DialogFooter>
            <Button
              onClick={assignSalary}
              disabled={!salaryInput || Number(salaryInput) <= 0}
              className="bg-[#DFE104] text-black hover:bg-[#c9cb04] disabled:opacity-50"
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {payingFor && <PaymentDialog employee={payingFor} onClose={() => setPayingFor(null)} onSaved={load} />}
    </div>
  );
}

function PaymentDialog({
  employee,
  onClose,
  onSaved,
}: {
  employee: Employee;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [preview, setPreview] = useState<Preview | null>(null);
  const [applyLate, setApplyLate] = useState(true);
  const [applyHalfDay, setApplyHalfDay] = useState(true);
  const [applyAbsent, setApplyAbsent] = useState(true);
  const [lateOverride, setLateOverride] = useState('');
  const [halfDayOverride, setHalfDayOverride] = useState('');
  const [absentOverride, setAbsentOverride] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<Preview>(`/salary/${employee.id}/preview?period=${period}`)
      .then((r) => {
        setPreview(r);
        setLateOverride(String(r.suggestedLateDeduction));
        setHalfDayOverride(String(r.suggestedHalfDayDeduction));
        setAbsentOverride(String(r.suggestedAbsentDeduction));
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Failed'));
  }, [employee.id, period]);

  const lateAmt = Number(lateOverride) || 0;
  const halfDayAmt = Number(halfDayOverride) || 0;
  const absentAmt = Number(absentOverride) || 0;
  const netAmount = preview
    ? preview.baseSalary - (applyLate ? lateAmt : 0) - (applyHalfDay ? halfDayAmt : 0) - (applyAbsent ? absentAmt : 0)
    : 0;

  const save = async () => {
    setSaving(true);
    try {
      await api(`/salary/${employee.id}/payments`, {
        method: 'POST',
        body: {
          period,
          applyLateDeduction: applyLate,
          applyHalfDayDeduction: applyHalfDay,
          applyAbsentDeduction: applyAbsent,
          lateDeductionOverride: lateAmt,
          halfDayDeductionOverride: halfDayAmt,
          absentDeductionOverride: absentAmt,
          note,
        },
      });
      toast.success(`Payment recorded for ${employee.name}`);
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New salary payment — {employee.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Period</Label>
            <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          </div>

          {preview && (
            <>
              <div className="text-sm text-[#A1A1AA]">Base salary: <span className="text-[#FAFAFA]">{fmt(preview.baseSalary)}</span></div>

              <div className="space-y-2 border border-[#1f1f23] p-3">
                <div className="flex items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={applyLate} onCheckedChange={(c) => setApplyLate(!!c)} />
                    Late check-ins ({preview.lateCount})
                  </label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={lateOverride}
                    onChange={(e) => setLateOverride(e.target.value)}
                    className="w-28"
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={applyHalfDay} onCheckedChange={(c) => setApplyHalfDay(!!c)} />
                    Half days ({preview.halfDayCount})
                  </label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={halfDayOverride}
                    onChange={(e) => setHalfDayOverride(e.target.value)}
                    className="w-28"
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={applyAbsent} onCheckedChange={(c) => setApplyAbsent(!!c)} />
                    Billable absences ({preview.billableAbsentCount} of {preview.absentCount}, {preview.maxAbsentAllowed} free)
                  </label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={absentOverride}
                    onChange={(e) => setAbsentOverride(e.target.value)}
                    className="w-28"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between text-sm font-medium pt-2 border-t border-[#1f1f23]">
                <span>Net amount</span>
                <span className="text-[#DFE104] text-lg">{fmt(netAmount)}</span>
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label>Note (optional)</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={save}
            disabled={!preview || saving}
            className="bg-[#DFE104] text-black hover:bg-[#c9cb04] disabled:opacity-50"
          >
            Save payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
