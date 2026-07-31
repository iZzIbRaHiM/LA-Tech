import { useCallback, useEffect, useState } from 'react';
import { LogIn, LogOut, Check, X, Clock, Download, BarChart3, PencilLine, Trash2, CalendarPlus, ChevronLeft, ChevronRight } from 'lucide-react';
import EmptyState from '../components/EmptyState';
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
  DialogDescription,
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
import { fmtTime, toLocalInputValue, fromLocalInputValue, localMonth, localToday } from '../formatTime';
import { useTickingUtcNow } from '../useTickingUtcNow';
import { formatShiftHours, isOvernightShift, shiftEndDate } from '../shift';
import { useAuth } from '../AuthContext';
import { api, downloadFile, type ResolvedSchedule, type Department } from '../api';

type Category = 'on_time' | 'late' | 'half_day' | 'absent' | null;

interface AttendanceRecord {
  id: number;
  user_id: number;
  user_name?: string;
  check_in: string | null;
  check_out: string | null;
  category: Category;
  validation_status: 'pending' | 'approved' | 'rejected';
  note: string;
  online_minutes?: number;
  /** 1 when the nightly sweep closed a session nobody checked out of. */
  auto_closed?: number;
}

const STATUS_BADGE: Record<AttendanceRecord['validation_status'], string> = {
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

function CategoryBadge({ category }: { category: Category }) {
  if (!category) return <span className="text-[#71717A]">—</span>;
  return (
    <Badge variant="outline" className={`text-xs ${CATEGORY_BADGE[category]}`}>
      {CATEGORY_LABEL[category]}
    </Badge>
  );
}

// Clock span: check-out minus check-in. Both operands are UTC so the arithmetic
// is timezone-independent — this is the "on the clock" figure, distinct from
// online_minutes, which only counts time the session was actually alive.
function duration(a: string | null, b: string | null): string {
  if (!a || !b) return '—';
  const ms = new Date(b.replace(' ', 'T') + 'Z').getTime() - new Date(a.replace(' ', 'T') + 'Z').getTime();
  const h = Math.floor(ms / 3600000);
  const m = Math.round((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}

// Stored UTC <-> the value a datetime-local input wants/gives, via Pakistan
// time. These used to be plain string surgery, which handed the input the raw
// UTC clock: a validator correcting an arrival time saw 10:00 for a 15:00 PKT
// check-in and "fixed" it into a five-hour error.
const toInputValue = toLocalInputValue;
const fromInputValue = fromLocalInputValue;

// Inclusive 'YYYY-MM-DD' bounds for a 'YYYY-MM' month. The upper bound is the
// real last day rather than a blunt '-31', so the displayed range never claims
// a day February doesn't have.
function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/** A window of the last `days` days, ending today (Pakistan). */
function recentRange(days: number): { from: string; to: string } {
  const to = localToday();
  const from = new Date(Date.parse(`${to}T00:00:00Z`) - (days - 1) * 86400000)
    .toISOString()
    .slice(0, 10);
  return { from, to };
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Quick ranges. Kept module-level so the identity is stable and the active-state
// comparison below is a plain string match on the built range.
const PRESETS: Array<{ label: string; build: () => { from: string; to: string } }> = [
  { label: 'Today', build: () => ({ from: localToday(), to: localToday() }) },
  { label: 'Last 7 days', build: () => recentRange(7) },
  { label: 'Last 30 days', build: () => recentRange(30) },
  { label: 'This month', build: () => monthRange(localMonth()) },
];

const formatMinutes = (mins: number) => {
  const m = Math.round(mins);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};

export default function Attendance() {
  const { user } = useAuth();
  // Ticks every 30s so the live "on the clock" figure advances while the page
  // is open, instead of freezing at whatever it read on mount.
  const nowUtc = useTickingUtcNow();
  const [open, setOpen] = useState<AttendanceRecord | null>(null);
  const [own, setOwn] = useState<AttendanceRecord[]>([]);
  const [team, setTeam] = useState<AttendanceRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [checkInNote, setCheckInNote] = useState('');
  const [editing, setEditing] = useState<AttendanceRecord | null>(null);
  const [editedTime, setEditedTime] = useState('');
  const [mySchedule, setMySchedule] = useState<ResolvedSchedule | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [logging, setLogging] = useState(false);
  const [logForm, setLogForm] = useState({ userId: '', date: '', checkInTime: '09:00', checkOutTime: '18:00', note: '' });
  const [loggingBusy, setLoggingBusy] = useState(false);

  // Date window for the listings. Defaults to the current Pakistan month; the
  // page used to fetch an unfiltered LIMIT 60/100 and simply grow until it was
  // a wall of rows. The window is sent to the API, so a narrow range is a
  // smaller query, not just a smaller render.
  const [range, setRange] = useState<{ from: string; to: string }>(() => monthRange(localMonth()));
  const [teamFilter, setTeamFilter] = useState<string>('all');

  // A whole calendar month reads as its name; anything else shows the span.
  const rangeLabel = (() => {
    const month = range.from.slice(0, 7);
    const whole = monthRange(month);
    if (range.from === whole.from && range.to === whole.to) {
      const [y, m] = month.split('-').map(Number);
      return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-PK', {
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      });
    }
    return `${range.from} → ${range.to}`;
  })();

  const load = useCallback(() => {
    api<{ open: AttendanceRecord | null }>('/attendance/status').then((r) => setOpen(r.open)).catch(() => {});
    const params = new URLSearchParams({ from: range.from, to: range.to });
    if (teamFilter !== 'all') params.set('teamUserId', teamFilter);
    api<{ own: AttendanceRecord[]; team: AttendanceRecord[] }>(`/attendance?${params}`)
      .then((r) => {
        setOwn(r.own);
        setTeam(r.team);
      })
      .catch((e) => toast.error(e.message));
  }, [range.from, range.to, teamFilter]);
  useEffect(load, [load]);

  useEffect(() => {
    if (user?.isCeo) return;
    api<{ schedule: ResolvedSchedule }>('/schedules/mine').then((r) => setMySchedule(r.schedule)).catch(() => {});
  }, [user]);

  const isValidator = user?.isCeo || user?.role === 'head';

  useEffect(() => {
    if (!isValidator) return;
    api<{ departments: Department[] }>('/departments').then((r) => setDepartments(r.departments)).catch(() => {});
  }, [isValidator]);

  // Whoever this validator can log attendance for: the CEO picks from any
  // department, a head only from their own — same scoping as canValidateAttendance
  // (manager-chain authority), department membership just gives the UI a
  // concrete, familiar list to pick from (mirrors Tasks.tsx's assignee picker).
  const loggableMembers = departments
    .filter((d) => user?.isCeo || d.id === user?.departmentId)
    .flatMap((d) => d.members ?? [])
    .filter((m) => m.id !== user?.id);

  const punch = async (dir: 'check-in' | 'check-out') => {
    setBusy(true);
    try {
      const r = await api<{ onlineMinutes?: number }>(`/attendance/${dir}`, {
        method: 'POST',
        body: dir === 'check-in' ? { note: checkInNote } : {},
      });
      toast.success(
        dir === 'check-in'
          ? 'Checked in — your session is now being tracked. Have a good day!'
          : `Checked out — ${formatMinutes(r.onlineMinutes ?? 0)} online today`
      );
      setCheckInNote('');
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const validate = async (id: number, status: 'approved' | 'rejected', checkInTime?: string) => {
    try {
      await api(`/attendance/${id}/validate`, { method: 'POST', body: { status, checkInTime } });
      load();
      toast.success(status === 'approved' ? 'Approved' : 'Rejected');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  const openEditDialog = (r: AttendanceRecord) => {
    setEditing(r);
    setEditedTime(r.check_in ? toInputValue(r.check_in) : '');
  };

  const approveWithEditedTime = async () => {
    if (!editing || !editedTime) return;
    await validate(editing.id, 'approved', fromInputValue(editedTime));
    setEditing(null);
  };

  const canSubmitLog = logForm.userId !== '' && logForm.date !== '' && logForm.checkInTime !== '' && logForm.checkOutTime !== '';

  const logAttendance = async () => {
    if (!canSubmitLog) return;
    setLoggingBusy(true);
    try {
      const r = await api<{ category: string }>('/attendance/manual', {
        method: 'POST',
        body: {
          userId: Number(logForm.userId),
          // The validator types Pakistan wall-clock times; the API stores UTC.
          // Concatenating them raw sent 09:00 PKT as 09:00 UTC — a five-hour
          // shift that also mis-categorised the record as on-time or late.
          checkIn: fromInputValue(`${logForm.date}T${logForm.checkInTime}`),
          // The end time rolls to the next date when the entered hours cross
          // midnight, so a night shift can actually be backfilled — pinning both
          // ends to one date put the check-out before the check-in.
          checkOut: fromInputValue(
            `${shiftEndDate(logForm.date, logForm.checkInTime, logForm.checkOutTime)}T${logForm.checkOutTime}`
          ),
          note: logForm.note,
        },
      });
      toast.success(`Attendance logged — categorized as ${CATEGORY_LABEL[r.category] ?? r.category}`);
      setLogging(false);
      setLogForm({ userId: '', date: '', checkInTime: '09:00', checkOutTime: '18:00', note: '' });
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoggingBusy(false);
    }
  };

  const deleteAbsence = async (r: AttendanceRecord) => {
    try {
      await api(`/attendance/${r.id}`, { method: 'DELETE' });
      load();
      toast.success('Absence record removed');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  // Attendance doesn't apply to the CEO at all — there's only one, and the
  // whole system is scoped to everyone else. No self-validation case to
  // handle here (unlike leave, where the CEO still requests/approves their
  // own).
  const pendingTeam = team.filter((t) => t.check_out && t.validation_status === 'pending');

  // CEO monthly report
  const [reportMonth, setReportMonth] = useState(localMonth());
  const [report, setReport] = useState<
    Array<{ user_id: number; name: string; department: string | null; days_present: number; total_minutes: number; approved: number; pending: number; rejected: number }>
  >([]);
  useEffect(() => {
    if (!user?.isCeo) return;
    api<{ rows: typeof report }>(`/reports/attendance?month=${reportMonth}`)
      .then((r) => setReport(r.rows))
      .catch(() => {});
  }, [user, reportMonth, own, team]);

  const shiftReportMonth = (delta: number) => {
    const [y, m] = reportMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setReportMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const downloadCsv = async (month: string) => {
    try {
      await downloadFile(`/reports/attendance.csv?month=${month}`, `attendance_${month}.csv`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed');
    }
  };

  return (
    <div className="p-4 sm:p-8 max-w-4xl">
      <h1 className="ptitle font-display font-bold text-2xl mb-8">Attendance</h1>

      {/* Check in/out card — doesn't apply to the CEO at all (there's only
          one, and attendance tracking is scoped to everyone else) */}
      {!user?.isCeo && (
        <div
          className={`pcard animate-fade-up relative overflow-hidden mb-10 ${
            open ? 'pcard-glow' : ''
          }`}
        >
          <img
            src="/images/hero-network-fallback.webp"
            alt=""
            className="absolute inset-0 w-full h-full object-cover opacity-30 pointer-events-none"
          />
          <div className="relative flex items-center justify-between gap-4 p-6">
            <div className="min-w-0">
              <div className="text-sm text-[#A1A1AA] mb-1 flex items-center gap-1.5">
                <Clock size={13} />
                {open ? `Checked in at ${fmtTime(open.check_in)}` : 'Not checked in'}
              </div>
              <div className="font-display font-bold text-xl mb-1">
                {open ? 'You are in the office' : 'Ready to start your day?'}
              </div>
              {mySchedule && (
                <div className="text-xs text-[#71717A] mb-2">
                  Your office hours: {formatShiftHours(mySchedule.office_start_time, mySchedule.office_end_time)}
                  {mySchedule.schedule_name ? ` (${mySchedule.schedule_name})` : ' (company default)'}
                  {open
                    ? ` · on the clock ${duration(open.check_in, nowUtc)} · active ${formatMinutes(open.online_minutes ?? 0)}`
                    : ''}
                </div>
              )}
              {open ? (
                open.note && <div className="text-sm text-[#A1A1AA]">Note: {open.note}</div>
              ) : (
                <Input
                  placeholder="Note (optional — e.g. WFH, on-site visit)"
                  value={checkInNote}
                  onChange={(e) => setCheckInNote(e.target.value)}
                  className="max-w-xs bg-[#09090B]/60"
                />
              )}
            </div>
            {open ? (
              <Button onClick={() => punch('check-out')} disabled={busy} variant="outline" size="lg" className="shrink-0">
                <LogOut size={15} className="mr-1.5" /> Check out
              </Button>
            ) : (
              <Button
                onClick={() => punch('check-in')}
                disabled={busy}
                size="lg"
                className="press bg-[#DFE104] text-black hover:bg-[#c9cb04] hover:shadow-[0_0_20px_rgb(223_225_4/0.45)] transition-shadow shrink-0"
              >
                <LogIn size={15} className="mr-1.5" /> Check in
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Date filter — drives the API query, not just the rendering, so a
          narrow range is genuinely less data rather than the same payload
          filtered client-side. */}
      <section className="pcard mb-6 p-3 sm:p-4">
        <div className="flex flex-wrap items-end gap-2 sm:gap-3">
          <div className="flex items-center gap-1 mr-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title="Previous month"
              onClick={() => setRange(monthRange(shiftMonth(range.from.slice(0, 7), -1)))}
            >
              <ChevronLeft size={15} />
            </Button>
            <span className="text-sm tabular-nums min-w-24 text-center">{rangeLabel}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title="Next month"
              onClick={() => setRange(monthRange(shiftMonth(range.from.slice(0, 7), 1)))}
            >
              <ChevronRight size={15} />
            </Button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => {
              const r = p.build();
              const active = r.from === range.from && r.to === range.to;
              return (
                <Button
                  key={p.label}
                  variant={active ? 'default' : 'outline'}
                  size="sm"
                  className="h-8"
                  onClick={() => setRange(p.build())}
                >
                  {p.label}
                </Button>
              );
            })}
          </div>

          <div className="flex items-end gap-2 ml-auto">
            <div className="space-y-1">
              <Label className="text-[11px] text-[#71717A]">From</Label>
              <Input
                type="date"
                className="h-8 w-[9.5rem]"
                value={range.from}
                max={range.to}
                onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-[#71717A]">To</Label>
              <Input
                type="date"
                className="h-8 w-[9.5rem]"
                value={range.to}
                min={range.from}
                onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })}
              />
            </div>
            {isValidator && loggableMembers.length > 0 && (
              <div className="space-y-1">
                <Label className="text-[11px] text-[#71717A]">Employee</Label>
                <Select value={teamFilter} onValueChange={setTeamFilter}>
                  <SelectTrigger className="h-8 w-[11rem]">
                    <SelectValue placeholder="Everyone" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Everyone</SelectItem>
                    {loggableMembers.map((m) => (
                      <SelectItem key={m.id} value={String(m.id)}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </div>
        <p className="text-[11px] text-[#71717A] mt-2">
          Showing {own.length} of your record{own.length === 1 ? '' : 's'}
          {isValidator ? ` and ${team.length} team record${team.length === 1 ? '' : 's'}` : ''} for {range.from} to{' '}
          {range.to}.
        </p>
      </section>

      {/* Validation queue for heads/CEO */}
      {isValidator && (
        <section className="mb-10">
          <div className="flex items-center justify-between mb-3">
            <h2 className="psection">
              Awaiting your validation ({pendingTeam.length})
            </h2>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLogging(true)}
              disabled={loggableMembers.length === 0}
              title={loggableMembers.length === 0 ? 'No one in your team yet' : 'Log a missed day for someone on your team'}
            >
              <CalendarPlus size={14} className="mr-1.5" /> Log attendance
            </Button>
          </div>
          {pendingTeam.length === 0 ? (
            <EmptyState compact icon={Check} title="Nothing pending." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Check in</TableHead>
                  <TableHead>Check out</TableHead>
                  <TableHead>On the clock</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead className="text-right">Validate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingTeam.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.user_name}</TableCell>
                    <TableCell className="text-xs text-[#A1A1AA]">{fmtTime(r.check_in)}</TableCell>
                    <TableCell className="text-xs text-[#A1A1AA]">{fmtTime(r.check_out)}</TableCell>
                    <TableCell>{duration(r.check_in, r.check_out)}</TableCell>
                    <TableCell>
                      <CategoryBadge category={r.category} />
                    </TableCell>
                    <TableCell className="text-xs text-[#A1A1AA] max-w-40 truncate" title={r.note}>
                      {r.note || '—'}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Approve as-is"
                        className="text-emerald-400"
                        onClick={() => validate(r.id, 'approved')}
                      >
                        <Check size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Correct the check-in time, then approve"
                        className="text-[#A1A1AA] hover:text-[#FAFAFA]"
                        onClick={() => openEditDialog(r)}
                      >
                        <PencilLine size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Reject (blocks re-checking-in today)"
                        className="text-red-400"
                        onClick={() => validate(r.id, 'rejected')}
                      >
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

      {/* CEO monthly report */}
      {user?.isCeo && (
        <section className="mb-10">
          <div className="flex items-center justify-between mb-3">
            <h2 className="psection flex items-center gap-1.5">
              <BarChart3 size={13} /> Monthly report — {reportMonth}
            </h2>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" onClick={() => shiftReportMonth(-1)}>
                ←
              </Button>
              <Button variant="outline" size="sm" onClick={() => shiftReportMonth(1)}>
                →
              </Button>
              <Button variant="outline" size="sm" onClick={() => downloadCsv(reportMonth)}>
                <Download size={13} className="mr-1" /> CSV
              </Button>
            </div>
          </div>
          {report.length === 0 ? (
            <EmptyState icon={Clock} title="No completed attendance records this month." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead className="text-right">Days</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
                  <TableHead className="text-right">Approved</TableHead>
                  <TableHead className="text-right">Pending</TableHead>
                  <TableHead className="text-right">Rejected</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.map((r) => (
                  <TableRow key={r.user_id}>
                    <TableCell>{r.name}</TableCell>
                    <TableCell className="text-[#A1A1AA]">{r.department ?? '—'}</TableCell>
                    <TableCell className="text-right">{r.days_present}</TableCell>
                    <TableCell className="text-right">{(r.total_minutes / 60).toFixed(1)}</TableCell>
                    <TableCell className="text-right text-emerald-400">{r.approved}</TableCell>
                    <TableCell className="text-right text-[#A1A1AA]">{r.pending}</TableCell>
                    <TableCell className="text-right text-red-400">{r.rejected}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      )}

      {/* Own history — doesn't apply to the CEO (no attendance records of their own) */}
      {!user?.isCeo && (
        <section className="mb-10">
          <h2 className="psection mb-3">My history</h2>
          {own.length === 0 ? (
            <EmptyState icon={Clock} title="No records yet — check in to create your first one." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Check in</TableHead>
                  <TableHead>Check out</TableHead>
                  <TableHead>On the clock</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {own.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs">{r.check_in ? fmtTime(r.check_in) : '—'}</TableCell>
                    <TableCell className="text-xs">
                      {r.check_in ? (r.check_out ? fmtTime(r.check_out) : 'open') : '—'}
                      {/* This check-out is the scheduled shift end, not something
                          the employee actually did — say so rather than letting
                          it read as a real punch. */}
                      {r.auto_closed ? (
                        <Badge
                          variant="outline"
                          className="ml-1.5 text-[10px] text-amber-400 border-amber-900"
                          title="You didn't check out — the session was closed at your scheduled shift end and sent for review"
                        >
                          estimated
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>{duration(r.check_in, r.check_out)}</TableCell>
                    <TableCell className="text-xs">
                      {r.check_in ? formatMinutes(r.online_minutes ?? 0) : '—'}
                    </TableCell>
                    <TableCell>
                      <CategoryBadge category={r.category} />
                    </TableCell>
                    <TableCell className="text-xs text-[#A1A1AA] max-w-40 truncate" title={r.note}>
                      {r.note || '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs capitalize ${STATUS_BADGE[r.validation_status]}`}>
                        {r.validation_status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      )}

      {/* Team history — validators only, and only if there's something to see */}
      {isValidator && team.length > 0 && (
        <section>
          <h2 className="psection mb-3">Team history</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Check in</TableHead>
                <TableHead>Check out</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {team.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.user_name}</TableCell>
                  <TableCell className="text-xs text-[#A1A1AA]">{r.check_in ? fmtTime(r.check_in) : '—'}</TableCell>
                  <TableCell className="text-xs text-[#A1A1AA]">{r.check_in ? (r.check_out ? fmtTime(r.check_out) : 'open') : '—'}</TableCell>
                  <TableCell>
                    <CategoryBadge category={r.category} />
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-xs capitalize ${STATUS_BADGE[r.validation_status]}`}>
                      {r.validation_status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {r.category === 'absent' ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Remove incorrect absence record"
                        className="text-red-400"
                        onClick={() => deleteAbsence(r)}
                      >
                        <Trash2 size={13} />
                      </Button>
                    ) : (
                      r.check_out && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Correct the check-in time and re-approve"
                            className="text-[#A1A1AA] hover:text-[#FAFAFA]"
                            onClick={() => openEditDialog(r)}
                          >
                            <PencilLine size={13} />
                          </Button>
                          {r.validation_status !== 'rejected' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Reject this record"
                              className="text-red-400"
                              onClick={() => validate(r.id, 'rejected')}
                            >
                              <X size={13} />
                            </Button>
                          )}
                          {r.validation_status !== 'approved' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Approve this record"
                              className="text-emerald-400"
                              onClick={() => validate(r.id, 'approved')}
                            >
                              <Check size={13} />
                            </Button>
                          )}
                        </>
                      )
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader className="flex-row items-center gap-3 space-y-0">
            <span className="dialog-icon-badge">
              <PencilLine size={16} />
            </span>
            <DialogTitle>Correct check-in time</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Actual check-in time</Label>
            <Input type="datetime-local" value={editedTime} onChange={(e) => setEditedTime(e.target.value)} />
            <p className="text-xs text-[#71717A]">Category (on time / late / half day) recomputes from this time.</p>
          </div>
          <DialogFooter>
            <Button
              onClick={approveWithEditedTime}
              disabled={!editedTime}
              className="bg-[#DFE104] text-black hover:bg-[#c9cb04] disabled:opacity-50"
            >
              Approve with this time
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={logging} onOpenChange={setLogging}>
        <DialogContent className="max-w-sm">
          <DialogHeader className="flex-row items-center gap-3 space-y-0">
            <span className="dialog-icon-badge">
              <CalendarPlus size={16} />
            </span>
            <div>
              <DialogTitle>Log attendance</DialogTitle>
              <DialogDescription className="mt-0.5">Backfill a missed day — auto-approved.</DialogDescription>
            </div>
          </DialogHeader>
          <div className="space-y-3 stagger">
            <div className="space-y-1.5">
              <Label>Employee <span className="text-red-500">*</span></Label>
              <Select value={logForm.userId} onValueChange={(v) => setLogForm({ ...logForm, userId: v })}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select person" />
                </SelectTrigger>
                <SelectContent>
                  {loggableMembers.map((m) => (
                    <SelectItem key={m.id} value={String(m.id)}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Date <span className="text-red-500">*</span></Label>
              <Input
                type="date"
                max={localToday()}
                value={logForm.date}
                onChange={(e) => setLogForm({ ...logForm, date: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Check in <span className="text-red-500">*</span></Label>
                <Input
                  type="time"
                  value={logForm.checkInTime}
                  onChange={(e) => setLogForm({ ...logForm, checkInTime: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Check out <span className="text-red-500">*</span></Label>
                <Input
                  type="time"
                  value={logForm.checkOutTime}
                  onChange={(e) => setLogForm({ ...logForm, checkOutTime: e.target.value })}
                />
              </div>
            </div>
            {/* Say out loud that the check-out landed on the following day, so an
                entered 22:00-06:00 doesn't look like it was misread. */}
            {isOvernightShift(logForm.checkInTime, logForm.checkOutTime) && (
              <p className="text-xs text-indigo-300">
                Crosses midnight — check-out is recorded on{' '}
                {logForm.date ? shiftEndDate(logForm.date, logForm.checkInTime, logForm.checkOutTime) : 'the next day'},
                and the record is filed under {logForm.date || 'the check-in date'}.
              </p>
            )}
            <div className="space-y-1.5">
              <Label>Note</Label>
              <Textarea
                rows={2}
                placeholder="e.g. Forgot to check in, confirmed with them directly"
                value={logForm.note}
                onChange={(e) => setLogForm({ ...logForm, note: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={logAttendance}
              disabled={!canSubmitLog || loggingBusy}
              className="bg-[#DFE104] text-black hover:bg-[#c9cb04] disabled:opacity-50"
            >
              Log attendance
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
