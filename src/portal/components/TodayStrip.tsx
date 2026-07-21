import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { CalendarClock, CheckCircle2, Circle, FileClock, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '../AuthContext';
import { api, type Task, type Meeting } from '../api';

interface OpenAttendance {
  id: number;
  check_in: string;
}

interface LeaveRow {
  id: number;
  status: string;
}

export default function TodayStrip({ tasks }: { tasks: Task[] }) {
  const { user } = useAuth();
  const [openAttendance, setOpenAttendance] = useState<OpenAttendance | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [ownPendingLeave, setOwnPendingLeave] = useState(0);
  const [teamPendingLeave, setTeamPendingLeave] = useState(0);

  const loadAttendance = useCallback(() => {
    if (user?.isCeo) return;
    api<{ open: OpenAttendance | null }>('/attendance/status')
      .then((r) => setOpenAttendance(r.open))
      .catch(() => {});
  }, [user?.isCeo]);

  useEffect(loadAttendance, [loadAttendance]);

  useEffect(() => {
    api<{ meetings: Meeting[] }>('/meetings').then((r) => setMeetings(r.meetings)).catch(() => {});
    api<{ own: LeaveRow[]; team: LeaveRow[] }>('/leave')
      .then((r) => {
        setOwnPendingLeave(r.own.filter((l) => l.status === 'pending').length);
        setTeamPendingLeave(r.team.filter((l) => l.status === 'pending').length);
      })
      .catch(() => {});
  }, []);

  const punch = async (dir: 'check-in' | 'check-out') => {
    setBusy(true);
    try {
      const r = await api<{ onlineMinutes?: number }>(`/attendance/${dir}`, { method: 'POST', body: {} });
      toast.success(
        dir === 'check-in' ? 'Checked in — have a good day!' : `Checked out — ${Math.round(r.onlineMinutes ?? 0)}m online today`
      );
      loadAttendance();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const today = new Date().toISOString().slice(0, 10);
  const dueToday = tasks.filter((t) => t.status !== 'done' && t.due_date === today);
  const liveMeeting = meetings.find((m) => !m.ended_at && m.in_room_count > 0);
  const canDecideLeave = user?.isCeo || user?.role === 'head';

  return (
    <div className="pcard mb-6 divide-y divide-[#1f1f23] sm:divide-y-0 sm:divide-x sm:flex">
      {!user?.isCeo && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 flex-1 min-w-0">
          <span className="flex items-center gap-2 text-sm min-w-0">
            {openAttendance ? (
              <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />
            ) : (
              <Circle size={15} className="text-[#71717A] shrink-0" />
            )}
            <span className="text-[#A1A1AA] truncate">
              {openAttendance === undefined
                ? 'Loading…'
                : openAttendance
                ? `Checked in at ${new Date(openAttendance.check_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                : 'Not checked in today'}
            </span>
          </span>
          {openAttendance !== undefined && (
            <Button
              size="sm"
              variant={openAttendance ? 'outline' : 'default'}
              className={openAttendance ? 'shrink-0' : 'shrink-0 bg-[#DFE104] text-black hover:bg-[#c9cb04]'}
              disabled={busy}
              onClick={() => punch(openAttendance ? 'check-out' : 'check-in')}
            >
              {openAttendance ? 'Check out' : 'Check in'}
            </Button>
          )}
        </div>
      )}

      <Link
        to="/portal/tasks"
        className="flex items-center gap-2 px-4 py-3 flex-1 min-w-0 text-sm hover:bg-[#141417] transition-colors"
      >
        <CalendarClock size={15} className={dueToday.length ? 'text-[#DFE104]' : 'text-[#71717A]'} />
        <span className="text-[#A1A1AA]">
          <span className={dueToday.length ? 'text-[#FAFAFA] font-medium' : ''}>{dueToday.length}</span> due today
        </span>
      </Link>

      {liveMeeting ? (
        <Link
          to={`/portal/meetings/${liveMeeting.id}`}
          className="flex items-center gap-2 px-4 py-3 flex-1 min-w-0 text-sm hover:bg-[#141417] transition-colors shadow-[inset_0_0_20px_rgb(52_211_153/0.05)]"
        >
          <span className="glow-pulse rounded-full shrink-0 flex">
            <Video size={15} className="text-emerald-400" />
          </span>
          <span className="text-[#FAFAFA] truncate">{liveMeeting.title}</span>
          <span className="text-[#71717A] shrink-0">live · join</span>
        </Link>
      ) : (
        <div className="flex items-center gap-2 px-4 py-3 flex-1 min-w-0 text-sm">
          <Video size={15} className="text-[#71717A] shrink-0" />
          <span className="text-[#71717A]">No meeting in progress</span>
        </div>
      )}

      {canDecideLeave ? (
        <Link
          to="/portal/leave"
          className="flex items-center gap-2 px-4 py-3 flex-1 min-w-0 text-sm hover:bg-[#141417] transition-colors"
        >
          <FileClock size={15} className={teamPendingLeave ? 'text-[#DFE104]' : 'text-[#71717A]'} />
          <span className="text-[#A1A1AA]">
            <span className={teamPendingLeave ? 'text-[#FAFAFA] font-medium' : ''}>{teamPendingLeave}</span> leave request
            {teamPendingLeave === 1 ? '' : 's'} to review
          </span>
        </Link>
      ) : (
        ownPendingLeave > 0 && (
          <Link
            to="/portal/leave"
            className="flex items-center gap-2 px-4 py-3 flex-1 min-w-0 text-sm hover:bg-[#141417] transition-colors"
          >
            <FileClock size={15} className="text-[#DFE104] shrink-0" />
            <span className="text-[#A1A1AA]">Your leave request is awaiting approval</span>
          </Link>
        )
      )}
    </div>
  );
}
