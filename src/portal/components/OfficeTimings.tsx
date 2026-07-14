import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Pencil, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api, type WorkSchedule, type ScheduleAssignment, type Department } from '../api';
import type { PortalUser } from '../pages/People';

const EMPTY = { name: '', office_start_time: '09:00', office_end_time: '18:00', late_threshold_minutes: 15, half_day_threshold_minutes: 90 };

// CEO section on the Settings page: define multiple office timings and
// assign each to whole departments or specific people. Check-ins resolve
// individual > department > the company default above this section.
export default function OfficeTimings() {
  const [schedules, setSchedules] = useState<WorkSchedule[]>([]);
  const [assignments, setAssignments] = useState<ScheduleAssignment[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [users, setUsers] = useState<PortalUser[]>([]);
  const [editing, setEditing] = useState<(typeof EMPTY & { id?: number }) | null>(null);
  const [assigning, setAssigning] = useState<WorkSchedule | null>(null);
  const [assignType, setAssignType] = useState<'department' | 'user'>('department');
  const [assignTarget, setAssignTarget] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<{ schedules: WorkSchedule[]; assignments: ScheduleAssignment[] }>('/schedules')
      .then((r) => {
        setSchedules(r.schedules);
        setAssignments(r.assignments);
      })
      .catch((e) => toast.error(e.message));
    api<{ departments: Department[] }>('/departments').then((r) => setDepartments(r.departments)).catch(() => {});
    api<{ users: PortalUser[] }>('/users').then((r) => setUsers(r.users.filter((u) => u.active && !u.is_ceo))).catch(() => {});
  }, []);
  useEffect(load, [load]);

  const run = async (fn: () => Promise<void>, msg: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      toast.success(msg);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const saveSchedule = () => {
    if (!editing) return;
    const body = {
      name: editing.name,
      officeStartTime: editing.office_start_time,
      officeEndTime: editing.office_end_time,
      lateThresholdMinutes: editing.late_threshold_minutes,
      halfDayThresholdMinutes: editing.half_day_threshold_minutes,
    };
    run(async () => {
      if (editing.id) await api(`/schedules/${editing.id}`, { method: 'PATCH', body });
      else await api('/schedules', { method: 'POST', body });
      setEditing(null);
    }, editing.id ? 'Timing updated' : 'Timing created');
  };

  const deleteSchedule = (s: WorkSchedule) =>
    run(async () => {
      await api(`/schedules/${s.id}`, { method: 'DELETE' });
    }, `"${s.name}" deleted — affected people fall back to the company default`);

  const assign = () => {
    if (!assigning || !assignTarget) return;
    run(async () => {
      await api(`/schedules/${assigning.id}/assign`, {
        method: 'POST',
        body: { targetType: assignType, targetId: Number(assignTarget) },
      });
      setAssigning(null);
      setAssignTarget('');
    }, 'Timing assigned');
  };

  const unassign = (a: ScheduleAssignment) =>
    run(async () => {
      await api('/schedules/unassign', { method: 'POST', body: { targetType: a.target_type, targetId: a.target_id } });
    }, 'Assignment removed');

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-[#A1A1AA] uppercase tracking-wide">Office timings (shifts)</h2>
        <Button size="sm" variant="outline" onClick={() => setEditing({ ...EMPTY })}>
          <Plus size={13} className="mr-1" /> New timing
        </Button>
      </div>
      <p className="text-xs text-[#71717A] mb-3">
        Assign a timing to a whole department or a specific person — a person's own assignment beats their
        department's, and anyone without one uses the company default office hours above.
      </p>

      {schedules.length === 0 ? (
        <p className="text-sm text-[#71717A]">No custom timings yet — everyone uses the company default.</p>
      ) : (
        <div className="space-y-3">
          {schedules.map((s) => {
            const assigned = assignments.filter((a) => a.schedule_id === s.id);
            return (
              <div key={s.id} className="border border-[#1f1f23] bg-[#0f0f12] px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{s.name}</span>
                  <Badge variant="outline" className="text-xs">
                    {s.office_start_time} – {s.office_end_time}
                  </Badge>
                  <span className="text-xs text-[#71717A]">
                    late after {s.late_threshold_minutes}m · half-day after {s.half_day_threshold_minutes}m
                  </span>
                  <div className="ml-auto flex gap-1">
                    <Button variant="ghost" size="sm" title="Assign to department/person" onClick={() => { setAssigning(s); setAssignType('department'); setAssignTarget(''); }}>
                      <Plus size={13} />
                    </Button>
                    <Button variant="ghost" size="sm" title="Edit" onClick={() => setEditing({ ...s })}>
                      <Pencil size={13} />
                    </Button>
                    <Button variant="ghost" size="sm" title="Delete" className="text-red-400" onClick={() => deleteSchedule(s)}>
                      <Trash2 size={13} />
                    </Button>
                  </div>
                </div>
                {assigned.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {assigned.map((a) => (
                      <Badge key={`${a.target_type}-${a.target_id}`} variant="outline" className="text-xs gap-1">
                        {a.target_type === 'department' ? 'Dept: ' : ''}
                        {a.target_name ?? `#${a.target_id}`}
                        <button onClick={() => unassign(a)} title="Remove assignment" className="hover:text-red-400">
                          <X size={11} />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create / edit timing */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editing?.id ? 'Edit timing' : 'New office timing'}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Name <span className="text-red-500">*</span></Label>
                <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. Night shift" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Start</Label>
                  <Input type="time" value={editing.office_start_time} onChange={(e) => setEditing({ ...editing, office_start_time: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>End</Label>
                  <Input type="time" value={editing.office_end_time} onChange={(e) => setEditing({ ...editing, office_end_time: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Late after (min)</Label>
                  <Input type="number" min={0} value={editing.late_threshold_minutes} onChange={(e) => setEditing({ ...editing, late_threshold_minutes: Number(e.target.value) })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Half-day after (min)</Label>
                  <Input type="number" min={0} value={editing.half_day_threshold_minutes} onChange={(e) => setEditing({ ...editing, half_day_threshold_minutes: Number(e.target.value) })} />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={saveSchedule} disabled={!editing?.name.trim() || busy} className="bg-[#DFE104] text-black hover:bg-[#c9cb04] disabled:opacity-50">
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign timing */}
      <Dialog open={!!assigning} onOpenChange={(o) => !o && setAssigning(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Assign "{assigning?.name}"</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Assign to</Label>
              <Select value={assignType} onValueChange={(v) => { setAssignType(v as 'department' | 'user'); setAssignTarget(''); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="department">A whole department</SelectItem>
                  <SelectItem value="user">A specific person</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{assignType === 'department' ? 'Department' : 'Person'}</Label>
              <Select value={assignTarget} onValueChange={setAssignTarget}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {assignType === 'department'
                    ? departments.map((d) => (
                        <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                      ))
                    : users.map((u) => (
                        <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
                      ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={assign} disabled={!assignTarget || busy} className="bg-[#DFE104] text-black hover:bg-[#c9cb04] disabled:opacity-50">
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
