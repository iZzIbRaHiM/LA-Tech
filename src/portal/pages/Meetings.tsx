import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import { Ban, CalendarClock, Pencil, Play, Plus, Video } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { useAuth } from '../AuthContext';
import { api, type Meeting } from '../api';
import { usePolling } from '../usePolling';
import type { PortalUser } from './People';

export default function Meetings() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Meeting | null>(null);
  const [cancelling, setCancelling] = useState<Meeting | null>(null);
  const [title, setTitle] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [people, setPeople] = useState<PortalUser[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<{ meetings: Meeting[] }>('/meetings').then((r) => setMeetings(r.meetings)).catch((e) => toast.error(e.message));
  }, []);

  usePolling(load, 6000);

  const loadPeople = () => {
    api<{ users: PortalUser[] }>('/users')
      .then((r) => setPeople(r.users.filter((u) => u.active && !u.is_ceo)))
      .catch((e) => toast.error(e.message));
  };

  const openCreate = () => {
    setTitle('');
    setScheduledAt('');
    setSelected(new Set());
    setCreating(true);
    loadPeople();
  };

  const openEdit = async (m: Meeting) => {
    setTitle(m.title);
    setScheduledAt((m.scheduled_at ?? '').replace(' ', 'T'));
    setEditing(m);
    loadPeople();
    try {
      const r = await api<{ participants: Array<{ user_id: number }> }>(`/meetings/${m.id}`);
      setSelected(new Set(r.participants.map((p) => p.user_id).filter((id) => id !== user?.id)));
    } catch {
      setSelected(new Set());
    }
  };

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const create = async () => {
    if (selected.size === 0 || busy) return;
    setBusy(true);
    try {
      const r = await api<{ id: number }>('/meetings', {
        method: 'POST',
        body: {
          title: title.trim() || 'Meeting',
          participantIds: [...selected],
          scheduledAt: scheduledAt || undefined,
        },
      });
      setCreating(false);
      if (scheduledAt) {
        toast.success('Meeting scheduled');
        load();
      } else {
        navigate(`/portal/meetings/${r.id}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!editing || selected.size === 0 || !scheduledAt || busy) return;
    setBusy(true);
    try {
      await api(`/meetings/${editing.id}`, {
        method: 'PATCH',
        body: { title: title.trim() || 'Meeting', scheduledAt, participantIds: [...selected] },
      });
      toast.success('Meeting updated');
      setEditing(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const startNow = async (m: Meeting) => {
    try {
      await api(`/meetings/${m.id}/start`, { method: 'POST' });
      navigate(`/portal/meetings/${m.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  const confirmCancel = async () => {
    if (!cancelling) return;
    try {
      await api(`/meetings/${cancelling.id}/cancel`, { method: 'POST' });
      toast.success('Meeting cancelled');
      setCancelling(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  const upcoming = meetings.filter((m) => !m.started_at && !m.ended_at);
  const rest = meetings.filter((m) => m.started_at || m.ended_at);

  const participantPicker = (
    <div className="space-y-1.5">
      <Label>Participants <span className="text-red-500">*</span></Label>
      <div className="max-h-56 overflow-y-auto border border-[#1f1f23] divide-y divide-[#141417]">
        {people.map((p) => (
          <label key={p.id} className="flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer hover:bg-[#141417]">
            <Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggle(p.id)} />
            <span className="flex-1 truncate">{p.name}</span>
            <span className="text-xs text-[#71717A] truncate">{p.department_name ?? ''}</span>
          </label>
        ))}
        {people.length === 0 && <div className="px-3 py-3 text-sm text-[#71717A]">Loading people…</div>}
      </div>
    </div>
  );

  return (
    <div className="p-4 sm:p-8 max-w-3xl">
      <div className="flex items-center justify-between mb-2">
        <h1 className="ptitle font-display font-bold text-2xl">Meetings</h1>
        {user?.isCeo && (
          <Button onClick={openCreate} className="bg-[#DFE104] text-black hover:bg-[#c9cb04]">
            <Plus size={15} className="mr-1" /> New meeting
          </Button>
        )}
      </div>
      <p className="text-sm text-[#A1A1AA] mb-8">
        Video calls run directly between participants' browsers — camera, microphone, and screen sharing.
      </p>

      {upcoming.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-medium text-[#A1A1AA] uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <CalendarClock size={13} /> Upcoming
          </h2>
          <div className="space-y-2 stagger">
            {upcoming.map((m) => (
              <div
                key={m.id}
                className="prow flex flex-wrap items-center gap-3 border border-[#1f1f23] bg-[#0f0f12] px-4 py-3"
              >
                <CalendarClock size={16} className="text-[#DFE104]" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{m.title}</div>
                  <div className="text-xs text-[#71717A]">
                    by {m.creator_name} · scheduled for {m.scheduled_at}
                  </div>
                </div>
                {m.created_by === user?.id ? (
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      onClick={() => startNow(m)}
                      className="press bg-[#DFE104] text-black hover:bg-[#c9cb04] hover:shadow-[0_0_16px_rgb(223_225_4/0.4)] transition-shadow"
                    >
                      <Play size={13} className="mr-1" /> Start now
                    </Button>
                    <Button size="sm" variant="ghost" title="Edit meeting" onClick={() => openEdit(m)}>
                      <Pencil size={13} />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Cancel meeting"
                      className="text-red-400"
                      onClick={() => setCancelling(m)}
                    >
                      <Ban size={13} />
                    </Button>
                  </div>
                ) : (
                  <Badge variant="outline" className="text-xs">Scheduled</Badge>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {meetings.length === 0 ? (
        <p className="text-sm text-[#71717A]">No meetings yet.</p>
      ) : (
        <div className="space-y-2 stagger">
          {rest.map((m) => {
            const live = !m.ended_at;
            return (
              <div
                key={m.id}
                className={`prow flex flex-wrap items-center gap-3 border border-[#1f1f23] bg-[#0f0f12] px-4 py-3 ${
                  live ? 'pcard-glow' : ''
                }`}
              >
                {live ? (
                  <span className="glow-pulse rounded-full flex">
                    <Video size={16} className="text-[#DFE104]" />
                  </span>
                ) : (
                  <Video size={16} className="text-[#3f3f46]" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{m.title}</div>
                  <div className="text-xs text-[#71717A]">
                    by {m.creator_name} · {m.created_at}
                  </div>
                </div>
                {live && m.in_room_count > 0 && (
                  <Badge variant="outline" className="text-xs text-emerald-400 border-emerald-900">
                    {m.in_room_count} in room
                  </Badge>
                )}
                {live ? (
                  <Button
                    size="sm"
                    onClick={() => navigate(`/portal/meetings/${m.id}`)}
                    className="press bg-[#DFE104] text-black hover:bg-[#c9cb04] hover:shadow-[0_0_16px_rgb(223_225_4/0.4)] transition-shadow"
                  >
                    Join
                  </Button>
                ) : (
                  <Badge variant="outline" className="text-xs">Ended</Badge>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-sm">
          <DialogHeader className="flex-row items-center gap-3 space-y-0">
            <span className="dialog-icon-badge">
              <Video size={16} />
            </span>
            <div>
              <DialogTitle>New meeting</DialogTitle>
              <DialogDescription className="mt-0.5">
                Starts instantly — or pick a time to schedule it.
              </DialogDescription>
            </div>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Weekly sync" />
            </div>
            <div className="space-y-1.5">
              <Label>Schedule for later (optional)</Label>
              <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
            </div>
            {participantPicker}
          </div>
          <DialogFooter>
            <Button onClick={create} disabled={selected.size === 0 || busy} className="bg-[#DFE104] text-black hover:bg-[#c9cb04] disabled:opacity-50">
              {scheduledAt ? 'Schedule meeting' : 'Start meeting'} {selected.size > 0 ? `(${selected.size})` : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader className="flex-row items-center gap-3 space-y-0">
            <span className="dialog-icon-badge">
              <Pencil size={16} />
            </span>
            <DialogTitle>Edit meeting</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Scheduled for <span className="text-red-500">*</span></Label>
              <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
            </div>
            {participantPicker}
          </div>
          <DialogFooter>
            <Button
              onClick={saveEdit}
              disabled={selected.size === 0 || !scheduledAt || busy}
              className="bg-[#DFE104] text-black hover:bg-[#c9cb04] disabled:opacity-50"
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!cancelling} onOpenChange={(o) => !o && setCancelling(null)}>
        <AlertDialogContent>
          <AlertDialogHeader className="flex-row items-center gap-3 space-y-0">
            <span className="dialog-icon-badge destructive">
              <Ban size={16} />
            </span>
            <AlertDialogTitle>Cancel "{cancelling?.title}"?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription>
            Every participant will be notified and the meeting disappears from their list. This cannot be undone.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={confirmCancel} className="bg-red-600 text-white hover:bg-red-700">
              Cancel meeting
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
