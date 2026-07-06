import { useCallback, useEffect, useState } from 'react';
import { LogIn, LogOut, Check, X, Clock, Download, BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { api, downloadFile } from '../api';

interface AttendanceRecord {
  id: number;
  user_id: number;
  user_name?: string;
  check_in: string;
  check_out: string | null;
  validation_status: 'pending' | 'approved' | 'rejected';
  note: string;
}

const STATUS_BADGE: Record<AttendanceRecord['validation_status'], string> = {
  pending: 'text-[#A1A1AA] border-[#333]',
  approved: 'text-emerald-400 border-emerald-900',
  rejected: 'text-red-400 border-red-900',
};

function duration(a: string, b: string | null): string {
  if (!b) return '—';
  const ms = new Date(b.replace(' ', 'T') + 'Z').getTime() - new Date(a.replace(' ', 'T') + 'Z').getTime();
  const h = Math.floor(ms / 3600000);
  const m = Math.round((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}

export default function Attendance() {
  const { user } = useAuth();
  const [open, setOpen] = useState<AttendanceRecord | null>(null);
  const [own, setOwn] = useState<AttendanceRecord[]>([]);
  const [team, setTeam] = useState<AttendanceRecord[]>([]);
  const [busy, setBusy] = useState(false);

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

  const punch = async (dir: 'check-in' | 'check-out') => {
    setBusy(true);
    try {
      await api(`/attendance/${dir}`, { method: 'POST', body: {} });
      toast.success(dir === 'check-in' ? 'Checked in — have a good day!' : 'Checked out');
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const validate = async (id: number, status: 'approved' | 'rejected') => {
    try {
      await api(`/attendance/${id}/validate`, { method: 'POST', body: { status } });
      load();
      toast.success(`Record ${status}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  const isValidator = user?.isCeo || user?.role === 'head';
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

      {/* Check in/out card */}
      <div className="relative overflow-hidden border border-[#1f1f23] mb-10">
        <img
          src="/images/hero-network-fallback.webp"
          alt=""
          className="absolute inset-0 w-full h-full object-cover opacity-30 pointer-events-none"
        />
        <div className="relative flex items-center justify-between p-6">
          <div>
            <div className="text-sm text-[#A1A1AA] mb-1 flex items-center gap-1.5">
              <Clock size={13} />
              {open ? `Checked in at ${open.check_in}` : 'Not checked in'}
            </div>
            <div className="font-display font-bold text-xl">
              {open ? 'You are in the office' : 'Ready to start your day?'}
            </div>
          </div>
          {open ? (
            <Button onClick={() => punch('check-out')} disabled={busy} variant="outline" size="lg">
              <LogOut size={15} className="mr-1.5" /> Check out
            </Button>
          ) : (
            <Button
              onClick={() => punch('check-in')}
              disabled={busy}
              size="lg"
              className="bg-[#DFE104] text-black hover:bg-[#c9cb04]"
            >
              <LogIn size={15} className="mr-1.5" /> Check in
            </Button>
          )}
        </div>
      </div>

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
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-emerald-400"
                        onClick={() => validate(r.id, 'approved')}
                      >
                        <Check size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
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

      {/* Own history */}
      <section>
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
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {own.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs">{r.check_in}</TableCell>
                  <TableCell className="text-xs">{r.check_out ?? 'open'}</TableCell>
                  <TableCell>{duration(r.check_in, r.check_out)}</TableCell>
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
    </div>
  );
}
