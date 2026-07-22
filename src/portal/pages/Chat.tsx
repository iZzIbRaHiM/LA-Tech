import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare, Plus, Pencil, Trash2, Send, Paperclip, FileText } from 'lucide-react';
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
import type { PortalUser } from './People';

interface ChatGroup {
  id: number;
  name: string;
  created_by: number;
  member_count: number;
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

const POLL_MS = 6000;

export default function Chat() {
  const { user } = useAuth();
  const [groups, setGroups] = useState<ChatGroup[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ChatGroup | null>(null);
  const [deleting, setDeleting] = useState<ChatGroup | null>(null);
  const [allUsers, setAllUsers] = useState<PortalUser[]>([]);
  const [groupName, setGroupName] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<number[]>([]);
  const [uploading, setUploading] = useState(false);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [deletingMessage, setDeletingMessage] = useState<Message | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadGroups = () => {
    api<{ groups: ChatGroup[] }>('/chat/groups')
      .then((r) => {
        setGroups(r.groups);
        setActiveId((cur) => cur ?? r.groups[0]?.id ?? null);
      })
      .catch((e) => toast.error(e.message));
  };
  useEffect(loadGroups, []);

  useEffect(() => {
    if (!user?.isCeo) return;
    api<{ users: PortalUser[] }>('/users').then((r) => setAllUsers(r.users)).catch(() => {});
  }, [user]);

  const loadMessages = useCallback(() => {
    if (!activeId) return;
    api<{ messages: Message[] }>(`/chat/groups/${activeId}/messages`)
      .then((r) => setMessages(r.messages))
      .catch(() => {});
  }, [activeId]);

  // Instant load when switching groups; visibility-aware refresh after —
  // a backgrounded chat tab generates zero requests.
  useEffect(loadMessages, [loadMessages]);
  usePolling(loadMessages, POLL_MS);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  const send = async () => {
    if (!activeId || !draft.trim()) return;
    const body = draft;
    setDraft('');
    try {
      await api(`/chat/groups/${activeId}/messages`, { method: 'POST', body: { body } });
      const r = await api<{ messages: Message[] }>(`/chat/groups/${activeId}/messages`);
      setMessages(r.messages);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to send');
      setDraft(body);
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

  const createGroup = async () => {
    if (!groupName.trim()) return;
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
    }
  };

  const saveEdit = async () => {
    if (!editing || !groupName.trim()) return;
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
    }
  };

  const confirmDeleteGroup = async () => {
    if (!deleting) return;
    try {
      await api(`/chat/groups/${deleting.id}`, { method: 'DELETE' });
      toast.success('Group deleted');
      if (activeId === deleting.id) setActiveId(null);
      setDeleting(null);
      loadGroups();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  const activeGroup = groups.find((g) => g.id === activeId);

  const MemberPicker = () => (
    <div className="space-y-1.5">
      <Label>Members</Label>
      <div className="space-y-1.5 border border-[#1f1f23] p-3 max-h-56 overflow-auto">
        {allUsers
          .filter((u) => u.id !== user?.id)
          .map((u) => (
            <label key={u.id} className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={selectedMembers.includes(u.id)}
                onCheckedChange={(c) =>
                  setSelectedMembers((prev) => (c ? [...prev, u.id] : prev.filter((id) => id !== u.id)))
                }
              />
              {u.name} <span className="text-[#71717A]">({u.email})</span>
            </label>
          ))}
        {allUsers.length === 0 && <p className="text-xs text-[#71717A]">No other users yet.</p>}
      </div>
    </div>
  );

  return (
    <div className="flex h-full">
      <div className="w-64 shrink-0 border-r border-[#1f1f23] flex flex-col">
        <div className="px-4 py-3 flex items-center justify-between border-b border-[#1f1f23]">
          <h2 className="font-medium text-sm">Chats</h2>
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
              onClick={() => setActiveId(g.id)}
            >
              <div className="min-w-0">
                <div className="truncate">{g.name}</div>
                <div className="text-xs text-[#71717A]">{g.member_count} members</div>
              </div>
              {user?.isCeo && (
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openEdit(g);
                    }}
                    className="text-[#71717A] hover:text-[#FAFAFA] p-1"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleting(g);
                    }}
                    className="text-[#71717A] hover:text-red-400 p-1"
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
            <div className="flex-1 overflow-auto p-4 space-y-3">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`group flex items-end gap-1.5 ${m.sender_id === user?.id ? 'justify-end' : 'justify-start'}`}
                >
                  {m.sender_id === user?.id && !m.attachment_filename && (
                    <span className="opacity-0 group-hover:opacity-100 flex items-center gap-1.5 transition-opacity mb-1">
                      <button
                        className="text-[#71717A] hover:text-[#DFE104]"
                        onClick={() => {
                          setEditingMessage(m);
                          setEditDraft(m.body);
                        }}
                      >
                        <Pencil size={12} />
                      </button>
                      <button className="text-[#71717A] hover:text-red-400" onClick={() => setDeletingMessage(m)}>
                        <Trash2 size={12} />
                      </button>
                    </span>
                  )}
                  <div
                    className={`animate-scale-in max-w-md px-3 py-2 text-sm transition-shadow ${
                      m.sender_id === user?.id
                        ? 'bg-[#DFE104] text-black shadow-[0_2px_12px_rgb(223_225_4/0.15)] hover:shadow-[0_2px_18px_rgb(223_225_4/0.3)]'
                        : 'bg-[#141417] text-[#FAFAFA] shadow-[0_2px_8px_rgb(0_0_0/0.4)] hover:shadow-[0_2px_14px_rgb(0_0_0/0.6)]'
                    }`}
                  >
                    {m.sender_id !== user?.id && (
                      <div className="text-xs text-[#A1A1AA] mb-0.5">{m.sender_name}</div>
                    )}
                    {m.attachment_filename ? (
                      <button
                        onClick={() => downloadAttachment(m)}
                        className={`flex items-center gap-1.5 text-left hover:opacity-80 ${
                          m.sender_id === user?.id ? 'text-black' : 'text-[#FAFAFA]'
                        }`}
                      >
                        <FileText size={14} className="shrink-0" />
                        <span className="truncate max-w-52">{m.attachment_filename}</span>
                        {m.attachment_size != null && (
                          <span className="text-xs opacity-70 shrink-0">{fmtSize(m.attachment_size)}</span>
                        )}
                      </button>
                    ) : (
                      <div className="whitespace-pre-wrap">{m.body}</div>
                    )}
                    <div className={`text-[10px] mt-1 ${m.sender_id === user?.id ? 'text-black/60' : 'text-[#71717A]'}`}>
                      {m.created_at}
                      {m.edited_at && ' · edited'}
                    </div>
                  </div>
                </div>
              ))}
              {messages.length === 0 && <p className="text-sm text-[#71717A]">No messages yet — say hello.</p>}
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
                onKeyDown={(e) => e.key === 'Enter' && send()}
              />
              <Button onClick={send} disabled={!draft.trim()} className="bg-[#DFE104] text-black hover:bg-[#c9cb04]">
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
            <MemberPicker />
          </div>
          <DialogFooter>
            <Button
              onClick={createGroup}
              disabled={!groupName.trim()}
              className="bg-[#DFE104] text-black hover:bg-[#c9cb04] disabled:opacity-50"
            >
              Create
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
            <MemberPicker />
          </div>
          <DialogFooter>
            <Button
              onClick={saveEdit}
              disabled={!groupName.trim()}
              className="bg-[#DFE104] text-black hover:bg-[#c9cb04] disabled:opacity-50"
            >
              Save
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
            <AlertDialogAction onClick={confirmDeleteGroup} className="bg-red-600 text-white hover:bg-red-700">
              Delete
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
