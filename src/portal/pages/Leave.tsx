import { useCallback, useEffect, useState } from 'react';
import { Check, X, Plus, CalendarDays } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { useAuth } from '../AuthContext';
import { api } from '../api';

interface LeaveRequest {
  id: number;
  user_id: number;
  user_name?: string;
  type: string;
  start_date: string;
  end_date: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
}

const STATUS_BADGE: Record<LeaveRequest['status'], string> = {
  pending: 'text-[#A1A1AA] border-[#333]',
  approved: 'text-emerald-400 border-emerald-900',
  rejected: 'text-red-400 border-red-900',
};

function MonthCalendar({ leaves, month }: { leaves: LeaveRequest[]; month: string }) {
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const firstWeekday = new Date(y, m - 1, 1).getDay(); // 0 = Sun

  const onLeave = (day: number): string[] => {
    const date = `${month}-${String(day).padStart(2, '0')}`;
    return leaves.filter((l) => l.start_date <= date && l.end_date >= date).map((l) => l.user_name ?? 'You');
  };

  return (
    <div>
      <div className="grid grid-cols-7 text-center text-xs text-[#71717A] mb-1">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px bg-[#1f1f23] border border-[#1f1f23]">
        {Array.from({ length: firstWeekday }).map((_, i) => (
          <div key={`pad${i}`} className="bg-[#09090B] min-h-16" />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
          const people = onLeave(day);
          return (
            <div key={day} className="bg-[#0f0f12] min-h-16 p-1.5">
              <div className="text-xs text-[#71717A]">{day}</div>
              {people.slice(0, 3).map((p, i) => (
                <div key={i} className="text-[10px] bg-[#DFE104]/15 text-[#DFE104] px-1 mt-0.5 truncate" title={p}>
                  {p}
                </div>
              ))}
              {people.length > 3 && <div className="text-[10px] text-[#71717A] mt-0.5">+{people.length - 3}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Leave() {
  const { user } = useAuth();
  const [own, setOwn] = useState<LeaveRequest[]>([]);
  const [team, setTeam] = useState<LeaveRequest[]>([]);
  const [calendar, setCalendar] = useState<LeaveRequest[]>([]);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ type: 'vacation', startDate: '', endDate: '', reason: '' });

  const load = useCallback(() => {
    api<{ own: LeaveRequest[]; team: LeaveRequest[] }>('/leave')
      .then((r) => {
        setOwn(r.own);
        setTeam(r.team);
      })
      .catch((e) => toast.error(e.message));
  }, []);
  useEffect(load, [load]);

  useEffect(() => {
    api<{ leaves: LeaveRequest[] }>(`/leave/calendar?month=${month}`)
      .then((r) => setCalendar(r.leaves))
      .catch(() => {});
  }, [month, own, team]);

  const canSubmit = form.startDate !== '' && form.endDate !== '';

  const submit = async () => {
    if (!canSubmit) return;
    try {
      await api('/leave', { method: 'POST', body: form });
      setCreating(false);
      setForm({ type: 'vacation', startDate: '', endDate: '', reason: '' });
      load();
      toast.success('Leave request submitted');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  const decide = async (id: number, status: 'approved' | 'rejected') => {
    try {
      await api(`/leave/${id}/decide`, { method: 'POST', body: { status } });
      load();
      toast.success(`Request ${status}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  const isDecider = user?.isCeo || user?.role === 'head';
  const pending = team.filter((t) => t.status === 'pending');

  const shiftMonth = (delta: number) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-8">
        <h1 className="font-display font-bold text-2xl">Leave</h1>
        <Button onClick={() => setCreating(true)} className="bg-[#DFE104] text-black hover:bg-[#c9cb04]">
          <Plus size={15} className="mr-1" /> Request leave
        </Button>
      </div>

      {/* Approval queue */}
      {isDecider && (
        <section className="mb-10">
          <h2 className="text-sm font-medium text-[#A1A1AA] uppercase tracking-wide mb-3">
            Awaiting your decision ({pending.length})
          </h2>
          {pending.length === 0 ? (
            <p className="text-sm text-[#71717A]">Nothing pending.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="text-right">Decide</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.user_name}</TableCell>
                    <TableCell className="capitalize">{r.type}</TableCell>
                    <TableCell className="text-xs">
                      {r.start_date} → {r.end_date}
                    </TableCell>
                    <TableCell className="text-[#A1A1AA] max-w-48 truncate">{r.reason}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" className="text-emerald-400" onClick={() => decide(r.id, 'approved')}>
                        <Check size={14} />
                      </Button>
                      <Button variant="ghost" size="sm" className="text-red-400" onClick={() => decide(r.id, 'rejected')}>
                        <X size={14} />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      )}

      {/* Calendar (CEO sees company-wide, head sees dept, employee sees own) */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-[#A1A1AA] uppercase tracking-wide flex items-center gap-1.5">
            <CalendarDays size={13} /> Approved leave — {month}
          </h2>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" onClick={() => shiftMonth(-1)}>
              ←
            </Button>
            <Button variant="outline" size="sm" onClick={() => shiftMonth(1)}>
              →
            </Button>
          </div>
        </div>
        <MonthCalendar leaves={calendar} month={month} />
      </section>

      {/* Own requests */}
      <section>
        <h2 className="text-sm font-medium text-[#A1A1AA] uppercase tracking-wide mb-3">My requests</h2>
        {own.length === 0 ? (
          <p className="text-sm text-[#71717A]">No requests yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {own.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="capitalize">{r.type}</TableCell>
                  <TableCell className="text-xs">
                    {r.start_date} → {r.end_date}
                  </TableCell>
                  <TableCell className="text-[#A1A1AA] max-w-56 truncate">{r.reason}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-xs capitalize ${STATUS_BADGE[r.status]}`}>
                      {r.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Request leave</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {['vacation', 'sick', 'personal', 'other'].map((t) => (
                    <SelectItem key={t} value={t} className="capitalize">
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>From <span className="text-red-500">*</span></Label>
                <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>To <span className="text-red-500">*</span></Label>
                <Input
                  type="date"
                  min={form.startDate || undefined}
                  value={form.endDate}
                  onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Reason</Label>
              <Textarea rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={submit}
              disabled={!canSubmit}
              className="bg-[#DFE104] text-black hover:bg-[#c9cb04] disabled:opacity-50"
            >
              Submit request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
