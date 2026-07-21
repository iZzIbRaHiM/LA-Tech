import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import { Plus, Video } from 'lucide-react';
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
import { useAuth } from '../AuthContext';
import { api, type Meeting } from '../api';
import { usePolling } from '../usePolling';
import type { PortalUser } from './People';

export default function Meetings() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [people, setPeople] = useState<PortalUser[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<{ meetings: Meeting[] }>('/meetings').then((r) => setMeetings(r.meetings)).catch((e) => toast.error(e.message));
  }, []);

  usePolling(load, 6000);

  const openCreate = () => {
    setTitle('');
    setSelected(new Set());
    setCreating(true);
    api<{ users: PortalUser[] }>('/users')
      .then((r) => setPeople(r.users.filter((u) => u.active && !u.is_ceo)))
      .catch((e) => toast.error(e.message));
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
        body: { title: title.trim() || 'Meeting', participantIds: [...selected] },
      });
      setCreating(false);
      navigate(`/portal/meetings/${r.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

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

      {meetings.length === 0 ? (
        <p className="text-sm text-[#71717A]">No meetings yet.</p>
      ) : (
        <div className="space-y-2 stagger">
          {meetings.map((m) => {
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
              <DialogDescription className="mt-0.5">Starts instantly once created.</DialogDescription>
            </div>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Weekly sync" />
            </div>
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
          </div>
          <DialogFooter>
            <Button onClick={create} disabled={selected.size === 0 || busy} className="bg-[#DFE104] text-black hover:bg-[#c9cb04] disabled:opacity-50">
              Start meeting {selected.size > 0 ? `(${selected.size})` : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
