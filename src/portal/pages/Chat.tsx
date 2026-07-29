import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare, Plus, Pencil, Trash2, Send, Paperclip, FileText } from 'lucide-react';
import EmptyState from '../components/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
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
import { toast } from 'sonner';
import { useAuth } from '../AuthContext';
import { api, downloadFile } from '../api';
import { usePolling } from '../usePolling';
import { fmtTime, fmtDateTime, fmtDayLabel, dayKey } from '../formatTime';
import type { PortalUser } from './People';

interface ChatGroup {
  id: number;
  name: string;
  created_by: number;
  member_count: number;
  // Postgres COUNT() comes back as a string over JSON — coerce before compare.
  unread_count: number | string;
}

interface Member {
  id: number;
  name: string;
  email: string;
}

interface Message {
  id: number;
  sender_id: number;
  sender_name: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  attachment_filename: string | null;
  attachment_size: number | null;
}

const fmtSize = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

// Vercel's serverless runtime can't hold a websocket open, so chat is polled.
// A flat 6s felt laggy, but polling fast forever burns free-tier quota on an
// idle tab. So: poll fast while the conversation is actually moving, and back
// off once it goes quiet. Any new message, send, or group switch snaps it back
// to fast. usePolling already stops entirely when the tab is hidden.
// Defined at module scope, NOT inside Chat. As an inner function it was a new
// component *type* on every render, so React unmounted and remounted the whole
// picker each time the message poll fired — every 2s while a dialog was open,
// which is why editing members felt unreliable.
function MemberPicker({
  allUsers,
  selfId,
  selected,
  onToggle,
}: {
  allUsers: PortalUser[];
  selfId: number | undefined;
  selected: number[];
  onToggle: (id: number, checked: boolean) => void;
}) {
  const others = allUsers.filter((u) => u.id !== selfId);
  return (
    <div className="space-y-1.5">
      <Label>Members</Label>
      <div className="space-y-1.5 border border-[#1f1f23] p-3 max-h-56 overflow-auto">
        {others.map((u) => (
          <label
            key={u.id}
            className="flex items-center gap-2 text-sm cursor-pointer px-1 py-0.5 rounded transition-colors hover:bg-[#141417]"
          >
            <Checkbox checked={selected.includes(u.id)} onCheckedChange={(c) => onToggle(u.id, !!c)} />
            {u.name} <span className="text-[#71717A]">({u.email})</span>
          </label>
        ))}
        {others.length === 0 && <p className="text-xs text-[#71717A]">No other users yet.</p>}
      </div>
    </div>
  );
}

// Mirrors MESSAGE_EDIT_WINDOW_MINUTES in server/routes-chat.ts. The server is
// the authority; this only hides controls that would fail, so nobody is
// offered an edit/delete that then errors.
const EDIT_WINDOW_MINUTES = 15;

function withinEditWindow(createdAt: string): boolean {
  return (Date.now() - new Date(`${createdAt.replace(' ', 'T')}Z`).getTime()) / 60000 <= EDIT_WINDOW_MINUTES;
}

const POLL_FAST_MS = 2000;
const POLL_IDLE_MS = 10000;
const IDLE_AFTER_MS = 60000;

export default function Chat() {
  const { user } = useAuth();
  const [groups, setGroups] = useState<ChatGroup[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ChatGroup | null>(null);
  const [deleting, setDeleting] = useState<ChatGroup | null>(null);
  const [allUsers, setAllUsers] = useState<PortalUser[]>([]);
  const [groupName, setGroupName] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<number[]>([]);
  const [uploading, setUploading] = useState(false);
  // Two-part in-flight guard. The ref is what actually blocks a duplicate
  // request: it updates synchronously, so clicks arriving before React has
  // re-rendered still see it set. The state exists only to drive the UI
  // (disabled + "Saving…"), since a ref can't trigger a re-render. A
  // state-only guard is NOT enough — verified by triple-clicking Save with a
  // stubbed slow response, which fired three requests through a `busy` state
  // check because none of them had re-rendered yet.
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [deletingMessage, setDeletingMessage] = useState<Message | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadGroups = useCallback(() => {
    api<{ groups: ChatGroup[] }>('/chat/groups')
      .then((r) => {
        setGroups(r.groups);
        setActiveId((cur) => cur ?? r.groups[0]?.id ?? null);
      })
      .catch(() => {}); // silent: this now runs on a timer, so a blip shouldn't toast
  }, []);
  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    if (!user?.isCeo) return;
    api<{ users: PortalUser[] }>('/users').then((r) => setAllUsers(r.users)).catch(() => {});
  }, [user]);

  const [pollMs, setPollMs] = useState(POLL_FAST_MS);
  const lastChangeRef = useRef(Date.now());
  const newestIdRef = useRef(0);

  // Called whenever the user does something that implies they're engaged, so
  // the poll goes back to fast even if the room has been quiet.
  const markActive = useCallback(() => {
    lastChangeRef.current = Date.now();
    setPollMs(POLL_FAST_MS);
  }, []);

  const loadMessages = useCallback(() => {
    if (!activeId) return;
    api<{ messages: Message[] }>(`/chat/groups/${activeId}/messages`)
      .then((r) => {
        setMessages(r.messages);
        // Only treat *new* traffic as activity — a poll returning the same
        // messages shouldn't keep the fast interval alive forever.
        const newest = r.messages.length ? r.messages[r.messages.length - 1].id : 0;
        if (newest !== newestIdRef.current) {
          newestIdRef.current = newest;
          lastChangeRef.current = Date.now();
          setPollMs(POLL_FAST_MS);
          // Anything new that arrived while this group is open counts as read.
          api(`/chat/groups/${activeId}/read`, { method: 'POST' })
            .then(loadGroups)
            .catch(() => {});
        }
      })
      .catch(() => {});
  }, [activeId]);

  // Poll BOTH: messages for the open group, and the group list so unread
  // badges appear as messages land elsewhere. Polling only messages meant
  // unread counts were stale until a manual reload.
  const refresh = useCallback(() => {
    loadMessages();
    loadGroups();
  }, [loadMessages, loadGroups]);

  // Instant load when switching groups; visibility-aware refresh after —
  // a backgrounded chat tab generates zero requests.
  useEffect(loadMessages, [loadMessages]);
  usePolling(refresh, pollMs);

  // Demote to the slow interval once the room has been quiet for a while.
  useEffect(() => {
    const t = setInterval(() => {
      if (Date.now() - lastChangeRef.current > IDLE_AFTER_MS) setPollMs(POLL_IDLE_MS);
    }, 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  const send = async () => {
    if (!activeId || !draft.trim() || sending) return;
    const body = draft;
    setDraft('');
    setSending(true);
    markActive();
    try {
      await api(`/chat/groups/${activeId}/messages`, { method: 'POST', body: { body } });
      const r = await api<{ messages: Message[] }>(`/chat/groups/${activeId}/messages`);
      setMessages(r.messages);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to send');
      setDraft(body);
    } finally {
      setSending(false);
    }
  };

  const uploadFile = async (file: File) => {
    if (!activeId) return;
    setUploading(true);
    try {
      const res = await fetch(`/api/chat/groups/${activeId}/attachments?filename=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Requested-With': 'latech-portal' },
        body: file,
      });
      if (!res.ok) throw new Error((await res.json())?.error ?? 'Upload failed');
      const r = await api<{ messages: Message[] }>(`/chat/groups/${activeId}/messages`);
      setMessages(r.messages);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const saveMessageEdit = async () => {
    if (!activeId || !editingMessage || !editDraft.trim()) return;
    try {
      await api(`/chat/groups/${activeId}/messages/${editingMessage.id}`, {
        method: 'PATCH',
        body: { body: editDraft },
      });
      setEditingMessage(null);
      loadMessages();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  const confirmDeleteMessage = async () => {
    if (!activeId || !deletingMessage) return;
    try {
      await api(`/chat/groups/${activeId}/messages/${deletingMessage.id}`, { method: 'DELETE' });
      setDeletingMessage(null);
      loadMessages();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  const downloadAttachment = async (m: Message) => {
    if (!activeId || !m.attachment_filename) return;
    try {
      await downloadFile(`/chat/groups/${activeId}/messages/${m.id}/download`, m.attachment_filename);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Download failed');
    }
  };

  const openCreate = () => {
    setGroupName('');
    setSelectedMembers([]);
    setCreating(true);
  };

  const openEdit = async (g: ChatGroup) => {
    setGroupName(g.name);
    setEditing(g);
    try {
      const r = await api<{ members: Member[] }>(`/chat/groups/${g.id}/members`);
      setSelectedMembers(r.members.filter((m) => m.id !== user?.id).map((m) => m.id));
    } catch {
      setSelectedMembers([]);
    }
  };

  // Every group mutation shares one in-flight flag, and the buttons that
  // trigger them are disabled while it's set. Without this, a slow POST left
  // the dialog open with no feedback, so a second click sent the request
  // again and silently created a duplicate group (observed in production:
  // two identical "OBD PK" groups created 5s apart from one interaction).
  const createGroup = async () => {
    if (!groupName.trim() || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const r = await api<{ id: number }>('/chat/groups', {
        method: 'POST',
        body: { name: groupName, memberIds: selectedMembers },
      });
      toast.success('Group created');
      setCreating(false);
      loadGroups();
      setActiveId(r.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!editing || !groupName.trim() || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await api(`/chat/groups/${editing.id}`, {
        method: 'PATCH',
        body: { name: groupName, memberIds: selectedMembers },
      });
      toast.success('Group updated');
      setEditing(null);
      loadGroups();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const confirmDeleteGroup = async () => {
    if (!deleting || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await api(`/chat/groups/${deleting.id}`, { method: 'DELETE' });
      toast.success('Group deleted');
      if (activeId === deleting.id) setActiveId(null);
      setDeleting(null);
      loadGroups();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const activeGroup = groups.find((g) => g.id === activeId);

  return (
    <div className="flex h-full">
      <div className="w-64 shrink-0 border-r border-[#1f1f23] flex flex-col">
        <div className="px-4 py-3 flex items-center justify-between border-b border-[#1f1f23]">
          <h2 className="psection">Chats</h2>
          {user?.isCeo && (
            <Button variant="ghost" size="sm" onClick={openCreate} className="text-[#DFE104]">
              <Plus size={14} />
            </Button>
          )}
        </div>
        <div className="flex-1 overflow-auto">
          {groups.map((g) => (
            <div
              key={g.id}
              className={`prow flex items-center justify-between px-4 py-2.5 cursor-pointer text-sm border-b border-[#141417] ${
                activeId === g.id ? 'bg-[#1c1c20] shadow-[inset_2px_0_0_#DFE104]' : ''
              }`}
              onClick={() => {
                setActiveId(g.id);
                markActive();
              }}
            >
              <div className="min-w-0 flex-1">
                <div className={`truncate ${Number(g.unread_count) > 0 && activeId !== g.id ? 'font-semibold text-[#FAFAFA]' : ''}`}>
                  {g.name}
                </div>
                <div className="text-xs text-[#71717A]">{g.member_count} members</div>
              </div>
              {/* Unread pill: exact count up to 9, then "10+" so a very busy
                  group can't stretch the row. Hidden for the group you're
                  currently reading. */}
              {Number(g.unread_count) > 0 && activeId !== g.id && (
                <span className="punread shrink-0 mr-1.5 min-w-5 h-5 px-1.5 rounded-full text-[10px] flex items-center justify-center">
                  {Number(g.unread_count) > 9 ? '10+' : g.unread_count}
                </span>
              )}
              {user?.isCeo && (
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openEdit(g);
                    }}
                    className="text-[#71717A] hover:text-[#FAFAFA] p-1 transition-colors"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleting(g);
                    }}
                    className="text-[#71717A] hover:text-red-400 p-1 transition-colors"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              )}
            </div>
          ))}
          {groups.length === 0 && (
            <p className="text-sm text-[#71717A] p-4">
              {user?.isCeo ? 'No groups yet — create one.' : "You're not in any chat groups yet."}
            </p>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col">
        {activeGroup ? (
          <>
            <div className="px-4 py-3 border-b border-[#1f1f23] font-medium text-sm">{activeGroup.name}</div>
            <div className="flex-1 overflow-auto p-4 space-y-1">
              {messages.map((m, i) => {
                const mine = m.sender_id === user?.id;
                const prev = messages[i - 1];
                const next = messages[i + 1];
                // Group consecutive messages from the same sender on the same
                // day: only the first shows a name, only the last gets the
                // tail, and the gap between them tightens.
                const startsGroup = !prev || prev.sender_id !== m.sender_id || dayKey(prev.created_at) !== dayKey(m.created_at);
                const endsGroup = !next || next.sender_id !== m.sender_id || dayKey(next.created_at) !== dayKey(m.created_at);
                const showDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
                // Tail only on the last bubble of a run; the others stay fully
                // rounded so a group reads as one block of speech.
                const corner = mine
                  ? endsGroup
                    ? 'rounded-2xl rounded-br-md'
                    : 'rounded-2xl'
                  : endsGroup
                    ? 'rounded-2xl rounded-bl-md'
                    : 'rounded-2xl';
                return (
                  <div key={m.id}>
                    {showDay && (
                      <div className="flex items-center justify-center my-4">
                        <span className="px-3 py-1 rounded-full bg-[#141417] border border-[#1f1f23] text-[10px] uppercase tracking-wider text-[#71717A]">
                          {fmtDayLabel(m.created_at)}
                        </span>
                      </div>
                    )}
                    <div
                      className={`group flex items-end gap-1.5 ${mine ? 'justify-end' : 'justify-start'} ${
                        startsGroup ? 'mt-3' : 'mt-0.5'
                      }`}
                    >
                      {mine && !m.attachment_filename && (user?.isCeo || withinEditWindow(m.created_at)) && (
                        <span className="pmsg-actions flex items-center gap-1 mb-1.5">
                          <button
                            className="text-[#71717A] hover:text-[#DFE104] transition-colors"
                            onClick={() => {
                              setEditingMessage(m);
                              setEditDraft(m.body);
                            }}
                            title="Edit message"
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            className="text-[#71717A] hover:text-red-400 transition-colors"
                            onClick={() => setDeletingMessage(m)}
                            title="Delete message"
                          >
                            <Trash2 size={12} />
                          </button>
                        </span>
                      )}
                      <div
                        className={`pbubble ${corner} max-w-md px-3.5 py-2 text-sm ${
                          mine ? 'pbubble-mine bg-[#DFE104] text-black' : 'pbubble-theirs bg-[#141417] text-[#FAFAFA]'
                        }`}
                      >
                        {!mine && startsGroup && (
                          <div className="text-xs font-medium text-[#DFE104] mb-0.5">{m.sender_name}</div>
                        )}
                        {m.attachment_filename ? (
                          <button
                            onClick={() => downloadAttachment(m)}
                            className={`flex items-center gap-1.5 text-left transition-opacity hover:opacity-80 ${
                              mine ? 'text-black' : 'text-[#FAFAFA]'
                            }`}
                          >
                            <FileText size={14} className="shrink-0" />
                            <span className="truncate max-w-52 underline decoration-dotted underline-offset-2">
                              {m.attachment_filename}
                            </span>
                            {m.attachment_size != null && (
                              <span className="text-xs opacity-70 shrink-0">{fmtSize(m.attachment_size)}</span>
                            )}
                          </button>
                        ) : (
                          <div className="whitespace-pre-wrap break-words">{m.body}</div>
                        )}
                        <div
                          className={`text-[10px] mt-1 text-right ${mine ? 'text-black/55' : 'text-[#71717A]'}`}
                          title={fmtDateTime(m.created_at)}
                        >
                          {fmtTime(m.created_at)}
                          {m.edited_at && ' · edited'}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {messages.length === 0 && <EmptyState icon={MessageSquare} title="No messages yet — say hello." />}
              <div ref={bottomRef} />
            </div>
            <div className="p-3 border-t border-[#1f1f23] flex gap-2">
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0])}
              />
              <Button
                variant="outline"
                className="pattach"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                title="Attach a file"
              >
                <Paperclip size={14} />
              </Button>
              <Input
                placeholder="Message…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onFocus={markActive}
                onKeyDown={(e) => e.key === 'Enter' && send()}
              />
              <Button onClick={send} disabled={!draft.trim() || sending} className="psend bg-[#DFE104] text-black hover:bg-[#c9cb04] disabled:opacity-40">
                <Send size={14} />
              </Button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-[#71717A]">
            <MessageSquare size={16} className="mr-2" /> Select a chat
          </div>
        )}
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-sm">
          <DialogHeader className="flex-row items-center gap-3 space-y-0">
            <span className="dialog-icon-badge">
              <MessageSquare size={16} />
            </span>
            <DialogTitle>New group</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 stagger">
            <div className="space-y-1.5">
              <Label>Name <span className="text-red-500">*</span></Label>
              <Input value={groupName} onChange={(e) => setGroupName(e.target.value)} />
            </div>
            <MemberPicker
              allUsers={allUsers}
              selfId={user?.id}
              selected={selectedMembers}
              onToggle={(id, checked) =>
                setSelectedMembers((prev) => (checked ? [...prev, id] : prev.filter((x) => x !== id)))
              }
            />
          </div>
          <DialogFooter>
            <Button
              onClick={createGroup}
              disabled={!groupName.trim() || busy}
              className="bg-[#DFE104] text-black hover:bg-[#c9cb04] disabled:opacity-50"
            >
              {busy ? 'Creating…' : 'Create'}
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
            <DialogTitle>Edit group</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 stagger">
            <div className="space-y-1.5">
              <Label>Name <span className="text-red-500">*</span></Label>
              <Input value={groupName} onChange={(e) => setGroupName(e.target.value)} />
            </div>
            <MemberPicker
              allUsers={allUsers}
              selfId={user?.id}
              selected={selectedMembers}
              onToggle={(id, checked) =>
                setSelectedMembers((prev) => (checked ? [...prev, id] : prev.filter((x) => x !== id)))
              }
            />
          </div>
          <DialogFooter>
            <Button
              onClick={saveEdit}
              disabled={!groupName.trim() || busy}
              className="bg-[#DFE104] text-black hover:bg-[#c9cb04] disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader className="flex-row items-center gap-3 space-y-0">
            <span className="dialog-icon-badge destructive">
              <Trash2 size={16} />
            </span>
            <AlertDialogTitle>Delete "{deleting?.name}"?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription>
            This removes it for everyone, including its entire message history. This cannot be undone.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteGroup}
              disabled={busy}
              className="bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
            >
              {busy ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!editingMessage} onOpenChange={(o) => !o && setEditingMessage(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader className="flex-row items-center gap-3 space-y-0">
            <span className="dialog-icon-badge">
              <Pencil size={16} />
            </span>
            <DialogTitle>Edit message</DialogTitle>
          </DialogHeader>
          <Input
            value={editDraft}
            onChange={(e) => setEditDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveMessageEdit()}
          />
          <DialogFooter>
            <Button
              onClick={saveMessageEdit}
              disabled={!editDraft.trim()}
              className="bg-[#DFE104] text-black hover:bg-[#c9cb04] disabled:opacity-50"
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletingMessage} onOpenChange={(o) => !o && setDeletingMessage(null)}>
        <AlertDialogContent>
          <AlertDialogHeader className="flex-row items-center gap-3 space-y-0">
            <span className="dialog-icon-badge destructive">
              <Trash2 size={16} />
            </span>
            <AlertDialogTitle>Delete this message?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteMessage} className="bg-red-600 text-white hover:bg-red-700">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
