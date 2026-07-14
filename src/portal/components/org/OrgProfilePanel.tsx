import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { ChevronsUpDown, KeyRound, UserX, UserCheck, Plus, Video } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api, type OrgNode, type Department, type Task } from '../../api';

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATUS_BADGE: Record<string, string> = {
  pending: 'text-[#A1A1AA] border-[#333]',
  approved: 'text-emerald-400 border-emerald-900',
  rejected: 'text-red-400 border-red-900',
};

const CATEGORY_BADGE: Record<string, string> = {
  on_time: 'text-emerald-400 border-emerald-900',
  late: 'text-amber-400 border-amber-900',
  half_day: 'text-orange-400 border-orange-900',
  absent: 'text-red-400 border-red-900',
};

const CATEGORY_LABEL: Record<string, string> = {
  on_time: 'On time',
  late: 'Late',
  half_day: 'Half day',
  absent: 'Absent',
};

interface AttendanceRecord {
  id: number;
  check_in: string | null;
  check_out: string | null;
  record_date: string;
  category: keyof typeof CATEGORY_LABEL | null;
  validation_status: string;
  note: string;
}

interface Payment {
  id: number;
  period: string;
  base_amount: number;
  net_amount: number;
  status: string;
}

// Everyone below `rootId` in the manager chain — used to keep the manager
// combobox from offering a cyclic assignment (the server enforces this too).
function descendantIds(rootId: number, nodes: OrgNode[]): Set<number> {
  const children = new Map<number, number[]>();
  nodes.forEach((n) => {
    if (n.manager_id != null) {
      const list = children.get(n.manager_id) ?? [];
      list.push(n.id);
      children.set(n.manager_id, list);
    }
  });
  const out = new Set<number>();
  const queue = [rootId];
  while (queue.length) {
    for (const child of children.get(queue.pop()!) ?? []) {
      if (!out.has(child)) {
        out.add(child);
        queue.push(child);
      }
    }
  }
  return out;
}

const passwordPolicyOk = (pw: string) =>
  pw.length >= 10 && /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw);

export default function OrgProfilePanel({
  employee,
  allNodes,
  onClose,
  onChanged,
  onAddReport,
}: {
  employee: OrgNode | null;
  allNodes: OrgNode[];
  onClose: () => void;
  onChanged: () => void;
  onAddReport: (managerId: number) => void;
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: '', phone: '' });
  const [managerOpen, setManagerOpen] = useState(false);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [salary, setSalary] = useState<number | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [salaryInput, setSalaryInput] = useState('');
  const [salaryOpen, setSalaryOpen] = useState(false);
  const [resetPw, setResetPw] = useState('');
  const [resetOpen, setResetOpen] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);

  const nodesById = useMemo(() => new Map(allNodes.map((n) => [n.id, n])), [allNodes]);
  const descendants = useMemo(
    () => (employee ? descendantIds(employee.id, allNodes) : new Set<number>()),
    [employee, allNodes]
  );
  const directReports = useMemo(
    () => (employee ? allNodes.filter((n) => n.manager_id === employee.id) : []),
    [employee, allNodes]
  );
  const manager = employee?.manager_id != null ? nodesById.get(employee.manager_id) : undefined;

  // Reset per-employee state whenever the panel targets someone new.
  useEffect(() => {
    if (!employee) return;
    setForm({ title: employee.title, phone: employee.phone });
    setTasks([]);
    setAttendance([]);
    setSalary(null);
    setPayments([]);
    api<{ departments: Department[] }>('/departments')
      .then((r) => setDepartments(r.departments))
      .catch(() => {});
    api<{ tasks: Task[] }>('/tasks')
      .then((r) => setTasks(r.tasks.filter((t) => t.assigned_to === employee.id)))
      .catch(() => {});
    if (!employee.is_ceo) {
      api<{ own: AttendanceRecord[] }>(`/attendance?userId=${employee.id}`)
        .then((r) => setAttendance(r.own))
        .catch(() => {});
      api<{ employees: Array<{ id: number; salary: number | null }> }>('/salary/employees')
        .then((r) => setSalary(r.employees.find((e) => e.id === employee.id)?.salary ?? null))
        .catch(() => {});
      api<{ payments: Payment[] }>(`/salary/${employee.id}/payments`)
        .then((r) => setPayments(r.payments))
        .catch(() => {});
    }
  }, [employee]);

  const run = useCallback(
    async (fn: () => Promise<void>, successMsg: string) => {
      if (busy) return;
      setBusy(true);
      try {
        await fn();
        toast.success(successMsg);
        onChanged();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed');
      } finally {
        setBusy(false);
      }
    },
    [busy, onChanged]
  );

  if (!employee) return null;
  const e = employee;

  const saveDetails = () =>
    run(async () => {
      await api(`/org-tree/users/${e.id}`, { method: 'PATCH', body: { title: form.title, phone: form.phone } });
    }, 'Details saved');

  const setManager = (managerId: number) =>
    run(async () => {
      await api(`/org-tree/users/${e.id}`, { method: 'PATCH', body: { managerId } });
    }, 'Manager updated');

  const setDepartment = async (deptIdStr: string) => {
    const deptId = Number(deptIdStr);
    await run(async () => {
      if (e.department_id != null) {
        await api(`/departments/${e.department_id}/members/${e.id}`, { method: 'DELETE' });
      }
      if (deptId) {
        await api(`/departments/${deptId}/members`, { method: 'POST', body: { userId: e.id } });
      }
    }, 'Department updated');
  };

  const toggleIntern = (intern: boolean) =>
    run(async () => {
      await api(`/departments/${e.department_id}/members/${e.id}`, {
        method: 'PATCH',
        body: { role: intern ? 'intern' : 'member' },
      });
    }, intern ? 'Marked as intern' : 'Marked as member');

  const toggleFinance = (grant: boolean) =>
    run(async () => {
      await api(`/users/${e.id}/finance-access`, { method: 'POST', body: { grant } });
    }, grant ? 'Finance access granted' : 'Finance access revoked');

  const resetPassword = () =>
    run(async () => {
      await api(`/users/${e.id}/reset-password`, { method: 'POST', body: { password: resetPw } });
      setResetOpen(false);
      setResetPw('');
    }, `Password reset — share the temp password once`);

  const deactivate = () =>
    run(async () => {
      await api(`/users/${e.id}/active`, { method: 'POST', body: { active: false } });
      setDeactivateOpen(false);
    }, `${e.name} deactivated`);

  const reactivate = () =>
    run(async () => {
      await api(`/users/${e.id}/active`, { method: 'POST', body: { active: true } });
    }, `${e.name} reactivated`);

  const assignSalary = () =>
    run(async () => {
      await api(`/salary/${e.id}/assign`, { method: 'POST', body: { amount: Number(salaryInput) } });
      setSalary(Number(salaryInput));
      setSalaryOpen(false);
      setSalaryInput('');
    }, 'Salary updated');

  const managerCandidates = allNodes.filter(
    (n) => n.active && n.id !== e.id && !descendants.has(n.id)
  );

  return (
    <Sheet open={!!employee} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto bg-[#0c0c0f] border-[#1f1f23]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {e.name}
            {e.is_ceo ? <span className="text-xs text-[#DFE104]">CEO</span> : null}
            {!e.active && (
              <Badge variant="outline" className="text-xs text-red-400 border-red-900">
                Deactivated
              </Badge>
            )}
            <span
              className={`h-2 w-2 rounded-full ${e.online ? 'bg-emerald-400' : 'bg-[#3f3f46]'}`}
              title={e.online ? 'Online now' : 'Offline'}
            />
          </SheetTitle>
          <SheetDescription className="text-[#71717A]">
            {e.email}
            {e.phone ? ` · ${e.phone}` : ''}
          </SheetDescription>
        </SheetHeader>

        <Tabs defaultValue="details" className="px-4 pb-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
            <TabsTrigger value="attendance" disabled={!!e.is_ceo}>
              Check-ins
            </TabsTrigger>
            <TabsTrigger value="salary" disabled={!!e.is_ceo}>
              Salary
            </TabsTrigger>
          </TabsList>

          {/* ---------- Details ---------- */}
          <TabsContent value="details" className="space-y-4 pt-4">
            <div className="space-y-1.5">
              <Label>Role / title</Label>
              <Input value={form.title} onChange={(ev) => setForm({ ...form, title: ev.target.value })} placeholder="e.g. Overall Manager" />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input value={form.phone} onChange={(ev) => setForm({ ...form, phone: ev.target.value })} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={saveDetails}
                disabled={busy || (form.title === e.title && form.phone === e.phone)}
                size="sm"
                className="bg-[#DFE104] text-black hover:bg-[#c9cb04] disabled:opacity-50"
              >
                Save details
              </Button>
              {!!e.is_ceo && (
                <Button variant="outline" size="sm" onClick={() => onAddReport(e.id)} disabled={busy}>
                  <Plus size={13} className="mr-1.5" /> Add direct report
                </Button>
              )}
            </div>

            {!e.is_ceo && (
              <>
                <div className="space-y-1.5 pt-2 border-t border-[#1f1f23]">
                  <Label>Reports to</Label>
                  <Popover open={managerOpen} onOpenChange={setManagerOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full justify-between font-normal" disabled={busy || !e.active}>
                        {manager?.name ?? 'No manager'}
                        <ChevronsUpDown size={14} className="text-[#71717A]" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72 p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search people…" />
                        <CommandList>
                          <CommandEmpty>No one found.</CommandEmpty>
                          <CommandGroup>
                            {managerCandidates.map((n) => (
                              <CommandItem
                                key={n.id}
                                value={`${n.name} ${n.email}`}
                                onSelect={() => {
                                  setManagerOpen(false);
                                  if (n.id !== e.manager_id) setManager(n.id);
                                }}
                              >
                                {n.name}
                                <span className="ml-2 text-xs text-[#71717A]">{n.title || n.email}</span>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  <p className="text-xs text-[#71717A]">
                    Their manager approves attendance and leave. People already reporting up to {e.name.split(' ')[0]} are
                    excluded (would create a cycle).
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label>Department</Label>
                  <Select value={e.department_id != null ? String(e.department_id) : '0'} onValueChange={setDepartment} disabled={busy || !e.active}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">Unassigned</SelectItem>
                      {departments.map((d) => (
                        <SelectItem key={d.id} value={String(d.id)}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {e.membership_role === 'head' && (
                    <p className="text-xs text-[#DFE104]">Department head — reassign the head from the Departments page before moving them.</p>
                  )}
                </div>

                {e.department_id != null && e.membership_role !== 'head' && (
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Intern</Label>
                      <p className="text-xs text-[#71717A]">Same access as a member — just a distinguishable tier.</p>
                    </div>
                    <Switch checked={e.membership_role === 'intern'} onCheckedChange={toggleIntern} disabled={busy || !e.active} />
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <div>
                    <Label>Finance access</Label>
                    <p className="text-xs text-[#71717A]">Full Finance module access (e.g. for an Overall Manager).</p>
                  </div>
                  <Switch checked={!!e.finance_access} onCheckedChange={toggleFinance} disabled={busy || !e.active} />
                </div>

                <div className="flex flex-wrap gap-2 pt-2 border-t border-[#1f1f23]">
                  <Button
                    size="sm"
                    onClick={async () => {
                      if (busy) return;
                      setBusy(true);
                      try {
                        const r = await api<{ id: number }>('/meetings', {
                          method: 'POST',
                          body: { title: `Meeting with ${e.name}`, participantIds: [e.id] },
                        });
                        navigate(`/portal/meetings/${r.id}`);
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : 'Failed');
                      } finally {
                        setBusy(false);
                      }
                    }}
                    disabled={busy || !e.active}
                    className="bg-[#DFE104] text-black hover:bg-[#c9cb04]"
                    title={`Start a video meeting with ${e.name}`}
                  >
                    <Video size={13} className="mr-1.5" /> Start meeting
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onAddReport(e.id)}
                    disabled={busy || !e.active}
                    title={`Create a new employee reporting to ${e.name}`}
                  >
                    <Plus size={13} className="mr-1.5" /> Add direct report
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setResetOpen(true)} disabled={busy || !e.active}>
                    <KeyRound size={13} className="mr-1.5" /> Reset password
                  </Button>
                  {e.active ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-400 border-red-900 hover:bg-red-950/40"
                      onClick={() => setDeactivateOpen(true)}
                      disabled={busy}
                    >
                      <UserX size={13} className="mr-1.5" /> Deactivate
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-emerald-400 border-emerald-900 hover:bg-emerald-950/40"
                      onClick={reactivate}
                      disabled={busy}
                    >
                      <UserCheck size={13} className="mr-1.5" /> Reactivate
                    </Button>
                  )}
                </div>
              </>
            )}
          </TabsContent>

          {/* ---------- Tasks ---------- */}
          <TabsContent value="tasks" className="pt-4">
            {tasks.length === 0 ? (
              <p className="text-sm text-[#71717A]">No tasks assigned.</p>
            ) : (
              <div className="space-y-1.5">
                {tasks.map((t) => (
                  <div key={t.id} className="flex items-center gap-2 border border-[#1f1f23] bg-[#0f0f12] px-3 py-2 text-sm">
                    <Badge
                      variant="outline"
                      className={`text-xs shrink-0 ${t.status === 'done' ? 'text-emerald-400 border-emerald-900' : 'text-[#A1A1AA] border-[#333]'}`}
                    >
                      {t.status.replace('_', ' ')}
                    </Badge>
                    <span className="truncate flex-1">{t.title}</span>
                    {t.due_date && <span className="text-xs text-[#71717A] shrink-0">due {t.due_date}</span>}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ---------- Attendance ---------- */}
          <TabsContent value="attendance" className="pt-4">
            {attendance.length === 0 ? (
              <p className="text-sm text-[#71717A]">No attendance records.</p>
            ) : (
              <div className="space-y-1.5">
                {attendance.map((r) => (
                  <div key={r.id} className="flex items-center gap-2 border border-[#1f1f23] bg-[#0f0f12] px-3 py-2 text-sm">
                    <span className="shrink-0 text-[#A1A1AA]">{r.record_date}</span>
                    {r.category && (
                      <Badge variant="outline" className={`text-xs shrink-0 ${CATEGORY_BADGE[r.category]}`}>
                        {CATEGORY_LABEL[r.category]}
                      </Badge>
                    )}
                    <span className="flex-1 truncate text-xs text-[#71717A]">
                      {r.check_in ? `${r.check_in.slice(11, 16)} → ${r.check_out ? r.check_out.slice(11, 16) : '…'}` : '—'}
                    </span>
                    <Badge variant="outline" className={`text-xs shrink-0 ${STATUS_BADGE[r.validation_status] ?? ''}`}>
                      {r.validation_status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ---------- Salary ---------- */}
          <TabsContent value="salary" className="pt-4 space-y-4">
            <div className="flex items-center justify-between border border-[#1f1f23] bg-[#0f0f12] px-3 py-2.5">
              <div>
                <div className="text-xs text-[#71717A]">Current monthly salary</div>
                <div className="font-display font-bold text-lg">{salary != null ? fmt(salary) : 'Not set'}</div>
              </div>
              <Button size="sm" onClick={() => { setSalaryInput(salary != null ? String(salary) : ''); setSalaryOpen(true); }} disabled={busy || !e.active} className="bg-[#DFE104] text-black hover:bg-[#c9cb04]">
                {salary != null ? 'Update' : 'Assign'}
              </Button>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-[#A1A1AA] mb-2">Payment history</div>
              {payments.length === 0 ? (
                <p className="text-sm text-[#71717A]">No payment records yet.</p>
              ) : (
                <div className="space-y-1">
                  {payments.map((p) => (
                    <div key={p.id} className="flex items-center justify-between border-b border-[#1f1f23] px-1 py-1.5 text-sm last:border-0">
                      <span>{p.period}</span>
                      <span className="text-xs text-[#71717A]">base {fmt(p.base_amount)}</span>
                      <Badge variant="outline" className="text-xs">
                        net {fmt(p.net_amount)}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-[#71717A] mt-2">Record monthly payments from the Salary page.</p>
            </div>
          </TabsContent>
        </Tabs>
      </SheetContent>

      {/* Assign/update salary */}
      <Dialog open={salaryOpen} onOpenChange={setSalaryOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{salary != null ? 'Update' : 'Assign'} salary — {e.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Monthly salary <span className="text-red-500">*</span></Label>
            <Input type="number" min={0} step="0.01" value={salaryInput} onChange={(ev) => setSalaryInput(ev.target.value)} />
          </div>
          <DialogFooter>
            <Button
              onClick={assignSalary}
              disabled={!salaryInput || Number(salaryInput) <= 0 || busy}
              className="bg-[#DFE104] text-black hover:bg-[#c9cb04] disabled:opacity-50"
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset password */}
      <Dialog open={resetOpen} onOpenChange={(o) => { setResetOpen(o); if (!o) setResetPw(''); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reset password for {e.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>New temporary password <span className="text-red-500">*</span></Label>
            <Input value={resetPw} onChange={(ev) => setResetPw(ev.target.value)} />
            <p className="text-xs text-[#71717A]">
              10+ characters, with uppercase, lowercase, a number, and a special character.
            </p>
          </div>
          <DialogFooter>
            <Button
              onClick={resetPassword}
              disabled={!passwordPolicyOk(resetPw) || busy}
              className="bg-[#DFE104] text-black hover:bg-[#c9cb04] disabled:opacity-50"
            >
              Reset password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deactivate confirmation with downstream impact */}
      <AlertDialog open={deactivateOpen} onOpenChange={setDeactivateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate {e.name}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Their session ends immediately and they can no longer sign in. Nothing is deleted — tasks, attendance,
                  and salary history are all kept, and they can be reactivated later.
                </p>
                {directReports.length > 0 ? (
                  <p>
                    <strong className="text-[#FAFAFA]">{directReports.length} direct report{directReports.length === 1 ? '' : 's'}</strong>{' '}
                    ({directReports.map((r) => r.name).join(', ')}) will move up to report to{' '}
                    <strong className="text-[#FAFAFA]">{manager?.name ?? 'the CEO'}</strong>.
                  </p>
                ) : (
                  <p>They have no direct reports.</p>
                )}
                <p className="text-[#71717A]">Blocked if they still have open tasks — reassign those first.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={deactivate} className="bg-red-600 text-white hover:bg-red-700">
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}
