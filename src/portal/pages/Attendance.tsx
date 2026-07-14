import { useCallback, useEffect, useState } from 'react';
import { LogIn, LogOut, Check, X, Clock, Download, BarChart3, PencilLine, Trash2 } from 'lucide-react';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { useAuth } from '../AuthContext';
import { api, downloadFile, type ResolvedSchedule } from '../api';

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

function duration(a: string | null, b: string | null): string {
  if (!a || !b) return '—';
  const ms = new Date(b.replace(' ', 'T') + 'Z').getTime() - new Date(a.replace(' ', 'T') + 'Z').getTime();
  const h = Math.floor(ms / 3600000);
  const m = Math.round((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}

// 'YYYY-MM-DD HH:MM:SS' <-> the value a datetime-local input wants/gives.
const toInputValue = (checkIn: string) => checkIn.replace(' ', 'T').slice(0, 16);
const fromInputValue = (value: string) => `${value.replace('T', ' ')}:00`;

const formatMinutes = (mins: number) => {
  const m = Math.round(mins);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};

export default function Attendance() {
  const { user } = useAuth();
  const [open, setOpen] = useState<AttendanceRecord | null>(null);
  const [own, setOwn] = useState<AttendanceRecord[]>([]);
  const [team, setTeam] = useState<AttendanceRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [checkInNote, setCheckInNote] = useState('');
  const [editing, setEditing] = useState<AttendanceRecord | null>(null);
  const [editedTime, setEditedTime] = useState('');
  const [mySchedule, setMySchedule] = useState<ResolvedSchedule | null>(null);

  const load = useCallback(() => {
    api<{ open: AttendanceRecord | null }>('/attendance/status').then((r) => setOpen(r.open)).catch(() => {});
    api<{ own: AttendanceRecord[]; team: AttendanceRecord[] }>('/attendance')
      .then((r) => {
        setOwn(r.own);
        setTeam(r.team);
      })
      .catch((e) => toast.error(e.message));
  }, []);
  useEffect(load, [load]);

  useEffect(() => {
    if (user?.isCeo) return;
    api<{ schedule: ResolvedSchedule }>('/schedules/mine').then((r) => setMySchedule(r.schedule)).catch(() => {});
  }, [user]);

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

  const deleteAbsence = async (r: AttendanceRecord) => {
    try {
      await api(`/attendance/${r.id}`, { method: 'DELETE' });
      load();
      toast.success('Absence record removed');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  const isValidator = user?.isCeo || user?.role === 'head';
  // Attendance doesn't apply to the CEO at all — there's only one, and the
  // whole system is scoped to everyone else. No self-validation case to
  // handle here (unlike leave, where the CEO still requests/approves their
  // own).
  const pendingTeam = team.filter((t) => t.check_out && t.validation_status === 'pending');

  // CEO monthly report
  const [reportMonth, setReportMonth] = useState(new Date().toISOString().slice(0, 7));
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
    <div className="p-8 max-w-4xl">
      <h1 className="font-display font-bold text-2xl mb-8">Attendance</h1>

      {/* Check in/out card — doesn't apply to the CEO at all (there's only
          one, and attendance tracking is scoped to everyone else) */}
      {!user?.isCeo && (
        <div className="relative overflow-hidden border border-[#1f1f23] mb-10">
          <img
            src="/images/hero-network-fallback.webp"
            alt=""
            className="absolute inset-0 w-full h-full object-cover opacity-30 pointer-events-none"
          />
          <div className="relative flex items-center justify-between gap-4 p-6">
            <div className="min-w-0">
              <div className="text-sm text-[#A1A1AA] mb-1 flex items-center gap-1.5">
                <Clock size={13} />
                {open ? `Checked in at ${open.check_in}` : 'Not checked in'}
              </div>
              <div className="font-display font-bold text-xl mb-1">
                {open ? 'You are in the office' : 'Ready to start your day?'}
              </div>
              {mySchedule && (
                <div className="text-xs text-[#71717A] mb-2">
                  Your office hours: {mySchedule.office_start_time}–{mySchedule.office_end_time}
                  {mySchedule.schedule_name ? ` (${mySchedule.schedule_name})` : ' (company default)'}
                  {open ? ` · ${formatMinutes(open.online_minutes ?? 0)} online so far` : ''}
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
                className="bg-[#DFE104] text-black hover:bg-[#c9cb04] shrink-0"
              >
                <LogIn size={15} className="mr-1.5" /> Check in
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Validation queue for heads/CEO */}
      {isValidator && (
        <section className="mb-10">
          <h2 className="text-sm font-medium text-[#A1A1AA] uppercase tracking-wide mb-3">
            Awaiting your validation ({pendingTeam.length})
          </h2>
          {pendingTeam.length === 0 ? (
            <p className="text-sm text-[#71717A]">Nothing pending.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Check in</TableHead>
                  <TableHead>Check out</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead className="text-right">Validate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingTeam.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.user_name}</TableCell>
                    <TableCell className="text-xs text-[#A1A1AA]">{r.check_in}</TableCell>
                    <TableCell className="text-xs text-[#A1A1AA]">{r.check_out}</TableCell>
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
            <h2 className="text-sm font-medium text-[#A1A1AA] uppercase tracking-wide flex items-center gap-1.5">
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
            <p className="text-sm text-[#71717A]">No completed attendance records this month.</p>
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
          <h2 className="text-sm font-medium text-[#A1A1AA] uppercase tracking-wide mb-3">My history</h2>
          {own.length === 0 ? (
            <p className="text-sm text-[#71717A]">No records yet — check in to create your first one.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Check in</TableHead>
                  <TableHead>Check out</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Online time</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {own.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs">{r.check_in ?? '—'}</TableCell>
                    <TableCell className="text-xs">{r.check_in ? (r.check_out ?? 'open') : '—'}</TableCell>
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
          <h2 className="text-sm font-medium text-[#A1A1AA] uppercase tracking-wide mb-3">Team history</h2>
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
                  <TableCell className="text-xs text-[#A1A1AA]">{r.check_in ?? '—'}</TableCell>
                  <TableCell className="text-xs text-[#A1A1AA]">{r.check_in ? (r.check_out ?? 'open') : '—'}</TableCell>
                  <TableCell>
                    <CategoryBadge category={r.category} />
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-xs capitalize ${STATUS_BADGE[r.validation_status]}`}>
                      {r.validation_status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {r.category === 'absent' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Remove incorrect absence record"
                        className="text-red-400"
                        onClick={() => deleteAbsence(r)}
                      >
                        <Trash2 size={13} />
                      </Button>
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
          <DialogHeader>
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
    </div>
  );
}
