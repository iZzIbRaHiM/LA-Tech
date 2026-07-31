import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MessageSquare,
  Plus,
  Pencil,
  Trash2,
  Send,
  Paperclip,
  FileText,
  Search,
  Phone,
  Info,
  Smile,
  Mic,
  Check,
  CheckCheck,
  CornerUpLeft,
  ArrowDown,
  ChevronLeft,
  X,
  Clock,
} from 'lucide-react';
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import { useNavigate } from 'react-router';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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
import { fmtTime, fmtDateTime, fmtDayLabel, fmtRelative, minutesBetween, dayKey } from '../formatTime';
import type { PortalUser } from './People';

interface ChatGroup {
  id: number;
  name: string;
  created_by: number;
  member_count: number;
  // Postgres COUNT() comes back as a string over JSON — coerce before compare.
  unread_count: number | string;
  last_body: string | null;
  last_attachment: string | null;
  last_at: string | null;
  last_sender: string | null;
}

interface Member {
  id: number;
  name: string;
  email: string;
  online?: boolean;
}

// Deterministic avatar hue from the name, so a group/user keeps its color
// across sessions without storing anything.
function avatarHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

function Avatar({ name, size }: { name: string; size: number }) {
  return (
    <span
      className="chat-avatar"
      style={{ width: size, height: size, fontSize: size * 0.36, ['--av' as string]: avatarHue(name) }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

const COMMON_EMOJI = ['👍', '❤️', '😂', '🎉', '👏', '🙏', '🔥', '💯', '😊', '😅', '🤝', '✅', '👀', '⏳', '😢', '💡'];

// Spec springs. 400/28 is the "launch from the input" feel; the softer
// 300/30 is for list reordering and layout shifts, where overshoot on a
// whole row reads as noise rather than physicality.
// Only the most recent messages participate in layout projection; see the
// `layout` prop on the message row for why.
const LAYOUT_WINDOW = 40;

const SPRING_SEND = { type: 'spring' as const, stiffness: 400, damping: 28 };
const SPRING_SOFT = { type: 'spring' as const, stiffness: 300, damping: 30 };
const SPRING_POP = { type: 'spring' as const, stiffness: 500, damping: 18 };

// Optimistic delivery state for a message the user just sent.
type SendState = 'sending' | 'sent';

// Sound-ready hooks: fire DOM events so audio (or haptics) can be attached
// later without touching this component.
function emitChatEvent(name: 'chat:send' | 'chat:receive', detail?: unknown) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

// Vertical number-roll for the unread badge: the old value slides up and
// out while the new one slides in from below.
function RollingCount({ value }: { value: number }) {
  const reduce = useReducedMotion();
  const label = value > 9 ? '10+' : String(value);
  return (
    <span className="relative inline-flex overflow-hidden h-4 items-center justify-center" style={{ minWidth: '1ch' }}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={label}
          initial={reduce ? { opacity: 0 } : { y: 12, opacity: 0 }}
          animate={reduce ? { opacity: 1 } : { y: 0, opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { y: -12, opacity: 0 }}
          transition={reduce ? { duration: 0.1 } : SPRING_POP}
          className="block leading-none"
        >
          {label}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

// Preview text crossfades when it changes, rather than snapping.
function CrossfadeText({ text, className }: { text: string; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <span className={`relative block ${className ?? ''}`}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={text}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0.1 : 0.18 }}
          className="block truncate"
        >
          {text}
        </motion.span>
      </AnimatePresence>
    </span>
  );
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
  // Phone layout only: false shows the chat list, true shows the conversation.
  // At md+ the classes force both panes visible and this is inert, so there is
  // no need to branch on a breakpoint in JS.
  const [showThread, setShowThread] = useState(false);

  // Opening a conversation means "show me the conversation" on a phone.
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
  const navigate = useNavigate();

  // Premium-chat state: read receipts, typing, header presence, in-chat
  // search, scroll position, and the initial-load skeleton flag.
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [readUpTo, setReadUpTo] = useState(0);
  const [typingNames, setTypingNames] = useState<string[]>([]);
  const [activeMembers, setActiveMembers] = useState<Member[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [msgQuery, setMsgQuery] = useState('');
  const [nearBottom, setNearBottom] = useState(true);
  const [hasNewBelow, setHasNewBelow] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastTypingPingRef = useRef(0);
  const reduce = useReducedMotion();

  // Optimistic outbox: a message appears instantly at 70% opacity with a
  // clock, then resolves to a real row once the server confirms. Keyed by a
  // temporary negative id so it can never collide with a real one.
  const [pending, setPending] = useState<Array<{ id: number; body: string; created_at: string; state: SendState }>>([]);
  const tempIdRef = useRef(-1);

  // Sticky date pill fades out ~1s after scrolling stops.
  const [scrolling, setScrolling] = useState(false);
  const scrollIdleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Throttled "I'm typing" ping — at most one request per 2.5s of typing,
  // matched to the server's 6-second liveness window.
  const pingTyping = useCallback(() => {
    if (!activeId) return;
    const now = Date.now();
    if (now - lastTypingPingRef.current < 2500) return;
    lastTypingPingRef.current = now;
    api(`/chat/groups/${activeId}/typing`, { method: 'POST' }).catch(() => {});
  }, [activeId]);

  // Header presence: fetched with the members list when the group changes,
  // then refreshed by the same poll cadence as messages (cheap, small query).
  const loadActiveMembers = useCallback(() => {
    if (!activeId) return;
    api<{ members: Member[] }>(`/chat/groups/${activeId}/members`)
      .then((r) => setActiveMembers(r.members))
      .catch(() => {});
  }, [activeId]);
  useEffect(loadActiveMembers, [loadActiveMembers]);

  const loadGroups = useCallback(() => {
    api<{ groups: ChatGroup[] }>('/chat/groups')
      .then((r) => {
        setGroups(r.groups);
        setGroupsLoaded(true);
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
  // Seeded on mount rather than in the initialiser: `useRef(Date.now())`
  // re-evaluates Date.now() on every render (the value is discarded after the
  // first, but the call is an impure read during render). 0 is never compared
  // before the mount effect runs — the idle check is on a 5s interval.
  const lastChangeRef = useRef(0);
  useEffect(() => {
    lastChangeRef.current = Date.now();
  }, []);
  const newestIdRef = useRef(0);

  // Which group the messages currently in state actually belong to. Compared
  // against activeId to tell "loaded" apart from "not fetched yet", so the pane
  // can show a skeleton instead of whatever the last chat left behind.
  const [loadedGroupId, setLoadedGroupId] = useState<number | null>(null);
  // Read inside async callbacks to check the user hasn't moved on since the
  // request went out. Synced in an effect rather than assigned during render —
  // a render that never commits must not leave the ref pointing at a chat the
  // user is not on. Declared above the fetch effect so it commits first.
  const activeIdRef = useRef<number | null>(null);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  /**
   * Switch chats.
   *
   * Every reset below is per-chat state that used to survive the switch: you
   * opened a conversation and saw the previous one's messages, its typing
   * indicator, its member list in the header, its unsent bubbles and its search
   * term, until the new fetch came back a few hundred milliseconds later.
   *
   * Done here rather than in an effect on activeId so it lands in the same
   * commit as the id change — an effect runs after render, which is one painted
   * frame of the wrong chat, exactly the flash being fixed.
   */
  const openThread = useCallback((id: number) => {
    setActiveId(id);
    // Set immediately, not just via the effect above: an in-flight response for
    // the previous chat could resolve before React commits, and the guard has
    // to already know the user has moved.
    activeIdRef.current = id;
    setShowThread(true);
    setLoadedGroupId(null);
    setMessages([]);
    setPending([]);
    setTypingNames([]);
    setActiveMembers([]);
    setReadUpTo(0);
    setMsgQuery('');
    setHasNewBelow(false);
    setEditingMessage(null);
    setDeletingMessage(null);
    // A fresh room starts at the bottom, and its newest id is not yet known —
    // leaving the previous chat's value made the first poll look like new
    // traffic and could raise the "new messages" chip on a chat just opened.
    newestIdRef.current = 0;
    nearBottomRef.current = true;
  }, []);

  // Called whenever the user does something that implies they're engaged, so
  // the poll goes back to fast even if the room has been quiet.
  const markActive = useCallback(() => {
    lastChangeRef.current = Date.now();
    setPollMs(POLL_FAST_MS);
  }, []);

  const loadMessages = useCallback(() => {
    const gid = activeId;
    if (!gid) return;
    api<{ messages: Message[]; readUpTo: number; typing: string[] }>(`/chat/groups/${gid}/messages`)
      .then((r) => {
        // Ignore a response for a chat the user has already left. Two requests
        // can be in flight across a quick switch, and without this the slower
        // one wins simply by finishing last — painting the wrong room's
        // messages under the right room's header.
        if (activeIdRef.current !== gid) return;
        setMessages(r.messages);
        setLoadedGroupId(gid);
        setReadUpTo(r.readUpTo ?? 0);
        setTypingNames(r.typing ?? []);
        // Only treat *new* traffic as activity — a poll returning the same
        // messages shouldn't keep the fast interval alive forever.
        const newest = r.messages.length ? r.messages[r.messages.length - 1].id : 0;
        if (newest !== newestIdRef.current) {
          const isIncoming =
            newestIdRef.current !== 0 && r.messages[r.messages.length - 1]?.sender_id !== user?.id;
          newestIdRef.current = newest;
          lastChangeRef.current = Date.now();
          setPollMs(POLL_FAST_MS);
          if (isIncoming) emitChatEvent('chat:receive', { id: newest });
          // If the reader is scrolled up in history, don't yank them down —
          // surface the floating "new messages" chip instead.
          if (!nearBottomRef.current) setHasNewBelow(true);
          // Anything new that arrived while this group is open counts as read.
          api(`/chat/groups/${gid}/read`, { method: 'POST' })
            .then(loadGroups)
            .catch(() => {});
        }
      })
      .catch(() => {});
  }, [activeId, loadGroups, user?.id]);

  // Poll BOTH: messages for the open group, and the group list so unread
  // badges appear as messages land elsewhere. Polling only messages meant
  // unread counts were stale until a manual reload.
  const refresh = useCallback(() => {
    loadMessages();
    loadGroups();
    loadActiveMembers(); // keeps the header's "N online" presence current
  }, [loadMessages, loadGroups, loadActiveMembers]);

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

  // Autoscroll only while the reader is already at the bottom; if they've
  // scrolled up into history, new arrivals must not yank the view down.
  // `pending` is a dependency too: an optimistic bubble is appended before the
  // server round-trip, so keying on `messages` alone left your own message
  // rendered below the fold for the ~200ms until the refetch landed — exactly
  // the latency the optimistic render exists to hide.
  useEffect(() => {
    if (nearBottomRef.current) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, pending]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    nearBottomRef.current = near;
    setNearBottom(near);
    if (near) setHasNewBelow(false);
    // Keep the floating date pill visible while scrolling, fade 1s after stop.
    setScrolling(true);
    if (scrollIdleRef.current) clearTimeout(scrollIdleRef.current);
    scrollIdleRef.current = setTimeout(() => setScrolling(false), 1000);
  }, []);

  useEffect(() => () => {
    if (scrollIdleRef.current) clearTimeout(scrollIdleRef.current);
  }, []);

  // `send()` clears its own optimistic row after refetching, but the background
  // poll runs on its own timer and can deliver the confirmed message first. In
  // that window both copies are mounted and the message visibly appears twice,
  // so drop any optimistic row the server has already echoed back to us.
  // Matching on body is a heuristic: sending the same text twice in quick
  // succession collapses the second bubble for the few ms until the refetch
  // lands, which is far less jarring than a duplicate.
  const visiblePending = useMemo(() => {
    if (!pending.length) return pending;
    return pending.filter(
      (pm) => !messages.some((m) => m.sender_id === user?.id && m.body === pm.body)
    );
  }, [pending, messages, user?.id]);

  const jumpToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'end' });
    setHasNewBelow(false);
  }, [reduce]);

  // Autogrow the composer up to ~5 lines (CSS caps max-height).
  const autogrow = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  const insertEmoji = useCallback(
    (e: string) => {
      setDraft((d) => d + e);
      inputRef.current?.focus();
    },
    []
  );

  // Reply = quote into the composer. Plain-text quoting works with the
  // existing message storage; a threaded reply model would need schema.
  const replyTo = useCallback((m: Message) => {
    const excerpt = m.attachment_filename ?? (m.body.length > 80 ? `${m.body.slice(0, 80)}…` : m.body);
    setDraft((d) => `> ${m.sender_name}: ${excerpt.replace(/\n/g, ' ')}\n${d}`);
    inputRef.current?.focus();
  }, []);

  const send = async () => {
    if (!activeId || !draft.trim() || sending) return;
    const body = draft;
    const tempId = tempIdRef.current--;
    setDraft('');
    if (inputRef.current) inputRef.current.style.height = 'auto'; // collapse the autogrown box
    setSending(true);
    markActive();
    emitChatEvent('chat:send', { body });

    // Show it immediately — perceived latency matters more than accuracy for
    // the ~200ms before the server answers.
    setPending((p) => [
      ...p,
      { id: tempId, body, created_at: new Date().toISOString().slice(0, 19).replace('T', ' '), state: 'sending' },
    ]);
    nearBottomRef.current = true; // sending always pulls you to the bottom

    try {
      await api(`/chat/groups/${activeId}/messages`, { method: 'POST', body: { body } });
      // Mark confirmed briefly so the clock → check transition is visible,
      // then let the real row from the server take over.
      setPending((p) => p.map((m) => (m.id === tempId ? { ...m, state: 'sent' } : m)));
      const r = await api<{ messages: Message[]; readUpTo: number; typing: string[] }>(
        `/chat/groups/${activeId}/messages`
      );
      setMessages(r.messages);
      setReadUpTo(r.readUpTo ?? 0);
      setPending((p) => p.filter((m) => m.id !== tempId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to send');
      setPending((p) => p.filter((m) => m.id !== tempId));
      setDraft(body); // hand the text back so nothing is lost
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
      openThread(r.id);
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
      if (activeId === deleting.id) {
        setActiveId(null);
        setShowThread(false);
      }
      setDeleting(null);
      loadGroups();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  // True from the moment a chat is selected until its own messages arrive.
  // Without it the pane fell through to the "say hello" empty state during the
  // fetch, so every switch flashed "No messages yet" at a room full of them.
  const messagesLoading = activeId !== null && loadedGroupId !== activeId;

  const activeGroup = groups.find((g) => g.id === activeId);
  const onlineCount = activeMembers.filter((m) => m.online).length;

  // In-chat search filters the rendered list; grouping/day dividers are
  // computed off the filtered set so a search result never shows a stale
  // "continuation" bubble with no head.
  const visibleMessages = useMemo(() => {
    const q = msgQuery.trim().toLowerCase();
    if (!q) return messages;
    return messages.filter(
      (m) => m.body.toLowerCase().includes(q) || (m.attachment_filename ?? '').toLowerCase().includes(q)
    );
  }, [messages, msgQuery]);

  return (
    <div className="chat-root flex h-full">
      {/* ---------------- Sidebar ----------------
          Phone layout is single-pane, like every native messenger: the list and
          the conversation occupy the whole width and you move between them. A
          288px sidebar rendered permanently left roughly 90px for messages on a
          375px screen. */}
      <aside
        className={`chat-sidebar shrink-0 flex-col w-full md:w-72 md:flex ${
          showThread ? 'hidden' : 'flex'
        }`}
      >
        <div className="px-3 pt-3 pb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#EDEDED] px-1">Chats</h2>
          {user?.isCeo && (
            <button
              onClick={openCreate}
              className="chat-iconbtn"
              style={{ color: '#E8C547' }}
              title="New chat"
              aria-label="New chat"
            >
              <Plus size={18} />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-auto px-2 pb-2 space-y-0.5">
          {/* Skeletons crossfade out rather than popping when data lands. */}
          <AnimatePresence initial={false}>
            {!groupsLoaded && (
              <motion.div
                key="skeletons"
                initial={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduce ? 0.1 : 0.2 }}
                aria-hidden="true"
              >
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 p-2">
                    <div className="chat-skel" style={{ width: 40, height: 40, borderRadius: 9999 }} />
                    <div className="flex-1 space-y-2">
                      <div className="chat-skel h-3 w-1/2" />
                      <div className="chat-skel h-2.5 w-3/4" />
                    </div>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {groupsLoaded &&
            groups.map((g, gi) => {
              const unread = Number(g.unread_count);
              const isActive = activeId === g.id;
              const preview = g.last_attachment
                ? `📎 ${g.last_attachment}`
                : g.last_body
                  ? `${g.last_sender ? `${g.last_sender.split(' ')[0]}: ` : ''}${g.last_body}`
                  : `${g.member_count} members`;
              return (
                <motion.div
                  key={g.id}
                  layout={reduce ? false : 'position'}
                  transition={reduce ? { duration: 0.1 } : SPRING_SOFT}
                  initial={reduce ? { opacity: 0 } : { opacity: 0, x: -8 }}
                  animate={reduce ? { opacity: 1 } : { opacity: 1, x: 0 }}
                  style={{ transitionDelay: `${Math.min(gi, 12) * 30}ms` }}
                  role="button"
                  tabIndex={0}
                  aria-current={isActive ? 'true' : undefined}
                  className={`chat-item group flex items-center gap-3 p-2 cursor-pointer ${isActive ? 'chat-item-active' : ''}`}
                  onClick={() => {
                    openThread(g.id);
                    markActive();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openThread(g.id);
                      markActive();
                    }
                  }}
                >
                  <Avatar name={g.name} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`truncate text-sm ${unread > 0 && !isActive ? 'font-semibold text-[#EDEDED]' : 'font-medium text-[#EDEDED]'}`}
                      >
                        {g.name}
                      </span>
                      <span className="ml-auto shrink-0 text-[11px] text-[#EDEDED]/[0.48] tabular-nums">
                        {fmtRelative(g.last_at)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CrossfadeText text={preview} className="min-w-0 flex-1 text-[13px] text-[#EDEDED]/55" />
                      <AnimatePresence initial={false}>
                        {unread > 0 && !isActive && (
                          <motion.span
                            key="unread"
                            initial={reduce ? { opacity: 0 } : { scale: 0, opacity: 0 }}
                            animate={reduce ? { opacity: 1 } : { scale: 1, opacity: 1 }}
                            exit={reduce ? { opacity: 0 } : { scale: 0, opacity: 0 }}
                            transition={reduce ? { duration: 0.1 } : SPRING_POP}
                            className="chat-unread ml-auto shrink-0 min-w-[20px] h-5 px-1.5 rounded-full text-[11px] flex items-center justify-center"
                            aria-label={`${unread} unread messages`}
                          >
                            <RollingCount value={unread} />
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                  {user?.isCeo && (
                    <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openEdit(g);
                        }}
                        className="chat-iconbtn"
                        style={{ width: 28, height: 28 }}
                        title="Edit group"
                        aria-label={`Edit ${g.name}`}
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleting(g);
                        }}
                        className="chat-iconbtn hover:!text-red-400"
                        style={{ width: 28, height: 28 }}
                        title="Delete group"
                        aria-label={`Delete ${g.name}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </motion.div>
              );
            })}

          {groupsLoaded && groups.length === 0 && (
            <p className="text-[13px] text-[#EDEDED]/55 p-3">
              {user?.isCeo ? 'No chats yet — create one.' : "You're not in any chats yet."}
            </p>
          )}
        </div>
      </aside>

      {/* ---------------- Conversation ---------------- */}
      <div
        className={`flex-1 flex-col min-w-0 relative md:flex ${showThread ? 'flex' : 'hidden'}`}
      >
        {activeGroup ? (
          <>
            <header className="chat-header sticky top-0 z-10 px-2 sm:px-4 py-2.5 flex items-center gap-2 sm:gap-3">
              {/* Only route back to the list on phones — on desktop both panes
                  are visible and there is nowhere to go back to. */}
              <button
                className="chat-iconbtn md:hidden shrink-0"
                onClick={() => setShowThread(false)}
                title="Back to chats"
                aria-label="Back to chats"
              >
                <ChevronLeft size={20} />
              </button>
              <Avatar name={activeGroup.name} size={36} />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-[#EDEDED] truncate">{activeGroup.name}</div>
                <div className="flex items-center gap-1.5 text-[11px] text-[#EDEDED]/[0.48]">
                  <span>{activeGroup.member_count} members</span>
                  {onlineCount > 0 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1">
                        <span className="chat-presence w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" aria-hidden="true" />
                        {onlineCount} online
                      </span>
                    </>
                  )}
                </div>
              </div>
              <div className="ml-auto flex items-center gap-1">
                <button
                  className="chat-iconbtn"
                  onClick={() => setSearchOpen((v) => !v)}
                  title="Search in conversation"
                  aria-label="Search in conversation"
                  aria-pressed={searchOpen}
                >
                  <Search size={17} />
                </button>
                <button
                  className="chat-iconbtn"
                  onClick={() => navigate('/portal/meetings')}
                  title="Start a call (Meetings)"
                  aria-label="Start a call"
                >
                  <Phone size={17} />
                </button>
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="chat-iconbtn" title="Conversation info" aria-label="Conversation info">
                      <Info size={17} />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-64 p-0 chat-elevated">
                    <div className="px-3 py-2 text-[13px] font-semibold text-[#EDEDED] border-b border-white/[0.06]">
                      Members
                    </div>
                    <div className="max-h-64 overflow-auto py-1">
                      {activeMembers.map((m) => (
                        <div key={m.id} className="flex items-center gap-2.5 px-3 py-1.5">
                          <Avatar name={m.name} size={28} />
                          <span className="text-[13px] text-[#EDEDED] truncate flex-1">{m.name}</span>
                          {m.online && (
                            <span
                              className="chat-presence w-1.5 h-1.5 rounded-full bg-emerald-400"
                              title="Online"
                              aria-label="Online"
                            />
                          )}
                        </div>
                      ))}
                      {activeMembers.length === 0 && (
                        <p className="px-3 py-2 text-[13px] text-[#EDEDED]/55">No members.</p>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </header>

            {searchOpen && (
              <div className="px-4 py-2 border-b border-white/[0.06] flex items-center gap-2">
                <Search size={14} className="text-[#EDEDED]/[0.48] shrink-0" />
                <input
                  autoFocus
                  value={msgQuery}
                  onChange={(e) => setMsgQuery(e.target.value)}
                  placeholder="Search in this conversation…"
                  aria-label="Search in this conversation"
                  className="flex-1 bg-transparent border-0 outline-none text-sm text-[#EDEDED] placeholder:text-[#EDEDED]/35"
                />
                <span className="text-[11px] text-[#EDEDED]/[0.48] tabular-nums">
                  {msgQuery.trim() ? `${visibleMessages.length} found` : ''}
                </span>
                <button
                  className="chat-iconbtn"
                  style={{ width: 28, height: 28 }}
                  onClick={() => {
                    setSearchOpen(false);
                    setMsgQuery('');
                  }}
                  aria-label="Close search"
                >
                  <X size={14} />
                </button>
              </div>
            )}

            <div
              ref={scrollRef}
              onScroll={onScroll}
              className={`chat-scroll flex-1 overflow-auto px-2 sm:px-4 py-4 ${scrolling ? 'chat-scrolling' : ''}`}
            >
              {/* Keyed on the group, so React drops the previous chat's subtree
                  the instant the id changes and the new one plays its entrance.
                  This was an AnimatePresence with mode="wait": the exiting pane
                  stayed mounted for the length of its exit, still holding the
                  old chat's rendered children, so every switch showed the
                  previous conversation for ~150ms before the new one appeared.
                  No exit animation here is the point — nothing outgoing should
                  linger on screen. */}
              <motion.div
                key={activeId}
                initial={reduce ? { opacity: 0 } : { opacity: 0, x: 8 }}
                animate={reduce ? { opacity: 1 } : { opacity: 1, x: 0 }}
                transition={{ duration: reduce ? 0.1 : 0.15 }}
                className="mx-auto w-full max-w-[720px]"
              >
              <LayoutGroup>
                {messagesLoading && (
                  <div className="space-y-3" aria-busy="true" aria-label="Loading messages">
                    {[62, 40, 74, 48, 56].map((w, i) => (
                      <div key={i} className={`flex ${i % 2 ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className="chat-skel"
                          style={{ width: `${w}%`, height: 34, borderRadius: 18 }}
                        />
                      </div>
                    ))}
                  </div>
                )}
                <AnimatePresence initial={false} mode="popLayout">
                {!messagesLoading && visibleMessages.map((m, i) => {
                  const mine = m.sender_id === user?.id;
                  const prev = visibleMessages[i - 1];
                  const next = visibleMessages[i + 1];
                  const sameDayAsPrev = prev && dayKey(prev.created_at) === dayKey(m.created_at);
                  // A "run" is consecutive messages from one sender inside a
                  // 2-minute window — they get a tighter gap and share one
                  // timestamp under the last bubble.
                  const contPrev =
                    !!prev && prev.sender_id === m.sender_id && !!sameDayAsPrev && minutesBetween(prev.created_at, m.created_at) <= 2;
                  const contNext =
                    !!next &&
                    next.sender_id === m.sender_id &&
                    dayKey(next.created_at) === dayKey(m.created_at) &&
                    minutesBetween(m.created_at, next.created_at) <= 2;
                  const showDay = !prev || !sameDayAsPrev;
                  const canModify = mine && !m.attachment_filename && (user?.isCeo || withinEditWindow(m.created_at));

                  return (
                    <motion.div
                      key={m.id}
                      // Layout projection costs a measurement per node on every
                      // layout pass, and the fetch caps at 200 messages. Only
                      // the recent tail can actually shift position (deletes,
                      // new arrivals), so older rows opt out and stop paying.
                      layout={reduce || i < visibleMessages.length - LAYOUT_WINDOW ? false : 'position'}
                      initial={
                        reduce
                          ? { opacity: 0 }
                          : mine
                            // Sent: launches from the composer — scales up and
                            // rises into place with the 400/28 spring.
                            ? { opacity: 0, scale: 0.85, y: 12 }
                            // Received: slides in from the left with a slight
                            // overshoot.
                            : { opacity: 0, x: -16 }
                      }
                      animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, x: 0, y: 0 }}
                      exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
                      // No `duration` on the spring branch: Framer ignores
                      // stiffness/damping the moment a duration is supplied, so
                      // the tuned 300/30 curve was being silently discarded.
                      transition={reduce ? { duration: 0.1 } : mine ? SPRING_SEND : SPRING_SOFT}
                    >
                      {showDay && (
                        <div className="chat-divider my-5 chat-daypill" role="separator">
                          <span className="px-3 py-1 rounded-full bg-[#1A1A1D] border border-white/[0.06] text-[11px] text-[#EDEDED]/[0.48]">
                            {fmtDayLabel(m.created_at)}
                          </span>
                        </div>
                      )}
                      <div
                        className={`group flex items-end gap-2 ${mine ? 'justify-end' : 'justify-start'}`}
                        style={{ marginTop: contPrev ? 4 : 12 }}
                      >
                        {/* Avatar gutter: rendered only on the LAST message of
                            a received run, so a run reads as one block. */}
                        {!mine && (
                          <div className="w-8 shrink-0" aria-hidden={contNext}>
                            {!contNext && <Avatar name={m.sender_name} size={32} />}
                          </div>
                        )}

                        <div className={`relative max-w-[85%] sm:max-w-[75%] ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
                          {!mine && !contPrev && (
                            <span className="text-[13px] font-medium mb-1 ml-1" style={{ color: '#E8C547' }}>
                              {m.sender_name}
                            </span>
                          )}

                          {/* Floating action pill on hover */}
                          <div className={`chat-pill ${mine ? 'right-0' : 'left-0'}`}>
                            <button onClick={() => replyTo(m)} title="Reply" aria-label="Reply to message">
                              <CornerUpLeft size={14} />
                            </button>
                            {canModify && (
                              <button
                                onClick={() => {
                                  setEditingMessage(m);
                                  setEditDraft(m.body);
                                }}
                                title="Edit"
                                aria-label="Edit message"
                              >
                                <Pencil size={14} />
                              </button>
                            )}
                            {canModify && (
                              <button
                                onClick={() => setDeletingMessage(m)}
                                title="Delete"
                                aria-label="Delete message"
                                className="hover:!text-red-400"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>

                          <div
                            className={`pbubble px-3.5 py-2 ${contPrev ? 'pbubble-cont' : ''} ${
                              mine ? 'pbubble-mine' : 'pbubble-theirs'
                            }`}
                          >
                            {m.attachment_filename ? (
                              <button
                                onClick={() => downloadAttachment(m)}
                                className="flex items-center gap-1.5 text-left hover:opacity-80 transition-opacity duration-150"
                              >
                                <FileText size={14} className="shrink-0" />
                                <span className="truncate max-w-52 underline decoration-dotted underline-offset-2">
                                  {m.attachment_filename}
                                </span>
                                {m.attachment_size != null && (
                                  <span className="text-[11px] opacity-70 shrink-0">{fmtSize(m.attachment_size)}</span>
                                )}
                              </button>
                            ) : (
                              <div className="whitespace-pre-wrap break-words">{m.body}</div>
                            )}
                          </div>

                          {/* One timestamp per run, under the last bubble. */}
                          {!contNext && (
                            <div
                              className="flex items-center gap-1 mt-1 px-1 text-[11px] text-[#EDEDED]/[0.48]"
                              title={fmtDateTime(m.created_at)}
                            >
                              <span className="tabular-nums">{fmtTime(m.created_at)}</span>
                              {m.edited_at && <span>· edited</span>}
                              {mine &&
                                (m.id <= readUpTo ? (
                                  <CheckCheck size={13} style={{ color: '#E8C547' }} aria-label="Read by everyone" />
                                ) : (
                                  <Check size={13} aria-label="Sent" />
                                ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
                </AnimatePresence>

                {/* Optimistic outbox — rendered instantly at 70% opacity with a
                    clock, snapping to full opacity + a single check the moment
                    the server confirms. Hidden while searching, since these
                    aren't real results yet. */}
                {!msgQuery.trim() &&
                  visiblePending.map((pm) => (
                    <motion.div
                      key={pm.id}
                      layout={reduce ? false : 'position'}
                      initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.85, y: 12 }}
                      animate={reduce ? { opacity: 1 } : { opacity: pm.state === 'sending' ? 0.7 : 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={reduce ? { duration: 0.1 } : SPRING_SEND}
                      className="flex items-end gap-2 justify-end"
                      style={{ marginTop: 12 }}
                    >
                      <div className="max-w-[85%] sm:max-w-[75%] flex flex-col items-end">
                        <div className="pbubble pbubble-mine px-3.5 py-2">
                          <div className="whitespace-pre-wrap break-words">{pm.body}</div>
                        </div>
                        <div className="flex items-center gap-1 mt-1 px-1 text-[11px] text-[#EDEDED]/[0.48]">
                          <span className="tabular-nums">{fmtTime(pm.created_at)}</span>
                          <AnimatePresence mode="wait" initial={false}>
                            <motion.span
                              key={pm.state}
                              initial={reduce ? { opacity: 0 } : { scale: 0.6, opacity: 0 }}
                              animate={reduce ? { opacity: 1 } : { scale: 1, opacity: 1 }}
                              exit={reduce ? { opacity: 0 } : { scale: 0.6, opacity: 0 }}
                              transition={reduce ? { duration: 0.1 } : SPRING_POP}
                              className="inline-flex"
                            >
                              {pm.state === 'sending' ? (
                                <Clock size={13} aria-label="Sending" />
                              ) : (
                                <Check size={13} aria-label="Sent" />
                              )}
                            </motion.span>
                          </AnimatePresence>
                        </div>
                      </div>
                    </motion.div>
                  ))}

                {!messagesLoading && visibleMessages.length === 0 && pending.length === 0 && !msgQuery.trim() && (
                  <EmptyState icon={MessageSquare} title="No messages yet — say hello 👋" />
                )}
                {!messagesLoading && visibleMessages.length === 0 && msgQuery.trim() && (
                  <EmptyState compact icon={Search} title={`No messages match "${msgQuery}"`} />
                )}
                <div ref={bottomRef} />
              </LayoutGroup>
              </motion.div>
            </div>

            {/* Floating jump-to-latest */}
            <AnimatePresence>
              {(!nearBottom || hasNewBelow) && (
                <motion.button
                  key="jump"
                  initial={reduce ? { opacity: 0 } : { opacity: 0, y: 20, scale: 0.9 }}
                  animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, y: 20, scale: 0.9 }}
                  transition={reduce ? { duration: 0.1 } : SPRING_POP}
                  className="chat-jump px-3 py-1.5 text-[13px] flex items-center gap-1.5"
                  onClick={jumpToBottom}
                >
                  <ArrowDown size={14} />
                  {hasNewBelow ? 'New messages' : 'Jump to latest'}
                </motion.button>
              )}
            </AnimatePresence>

            {/* Typing indicator sits directly above the composer */}
            <div className="px-4 min-h-[34px] flex items-end" aria-live="polite">
              <AnimatePresence initial={false}>
                {typingNames.length > 0 && (
                  <motion.div
                    key="typing"
                    initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.8, y: 6 }}
                    animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
                    exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.8, y: 6 }}
                    transition={reduce ? { duration: 0.1 } : SPRING_POP}
                    className="mx-auto w-full max-w-[720px] flex items-center gap-2 pb-1"
                  >
                    {/* Dots live in a mini received-style bubble */}
                    <span className="pbubble pbubble-theirs inline-flex items-center gap-1 px-3 py-2" aria-hidden="true">
                      <span className="chat-typing-dot" />
                      <span className="chat-typing-dot" />
                      <span className="chat-typing-dot" />
                    </span>
                    <span className="text-[11px] text-[#EDEDED]/55">
                      {typingNames.length === 1
                        ? `${typingNames[0]} is typing…`
                        : `${typingNames.length} people are typing…`}
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* ---------------- Composer ---------------- */}
            <div className="px-4 pb-4 pt-1">
              <div className="mx-auto w-full max-w-[720px] flex items-end gap-2">
                <div className="chat-inputwrap flex-1 flex items-end gap-1 px-2 py-1.5">
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0])}
                  />
                  <button
                    className="chat-iconbtn shrink-0"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                    title="Attach a file"
                    aria-label="Attach a file"
                  >
                    <Paperclip size={18} />
                  </button>

                  <textarea
                    ref={inputRef}
                    rows={1}
                    value={draft}
                    placeholder="Message…"
                    aria-label="Message"
                    className="flex-1 py-2 text-[#EDEDED] placeholder:text-[#EDEDED]/35"
                    onChange={(e) => {
                      setDraft(e.target.value);
                      autogrow();
                      pingTyping();
                    }}
                    onFocus={markActive}
                    onKeyDown={(e) => {
                      // Enter sends; Shift+Enter makes a new line.
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        send();
                      }
                    }}
                  />

                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="chat-iconbtn shrink-0" title="Emoji" aria-label="Insert emoji">
                        <Smile size={18} />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-56 p-2 chat-elevated">
                      <div className="grid grid-cols-8 gap-1">
                        {COMMON_EMOJI.map((e) => (
                          <button
                            key={e}
                            onClick={() => insertEmoji(e)}
                            className="h-7 w-7 rounded hover:bg-white/[0.07] transition-colors duration-150 text-base"
                            aria-label={`Insert ${e}`}
                          >
                            {e}
                          </button>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>

                {/* Mic ⇄ Send: both share one grid cell and rotate past each
                    other, so the swap never reflows the composer. */}
                <motion.button
                  onClick={() => draft.trim() && send()}
                  disabled={sending || !draft.trim()}
                  whileTap={reduce ? undefined : { scale: 0.9 }}
                  transition={SPRING_POP}
                  className={`chat-swap shrink-0 ${draft.trim() ? 'chat-send chat-send-on' : 'chat-iconbtn'}`}
                  style={{ width: 40, height: 40 }}
                  title={draft.trim() ? 'Send' : "Voice messages aren't supported yet"}
                  aria-label={draft.trim() ? 'Send message' : 'Voice message (unavailable)'}
                >
                  <span className={draft.trim() ? 'chat-swap-in' : 'chat-swap-out'}>
                    <Send size={17} />
                  </span>
                  <span className={draft.trim() ? 'chat-swap-out' : 'chat-swap-in'}>
                    <Mic size={18} />
                  </span>
                </motion.button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState icon={MessageSquare} title="Select a chat to start messaging" />
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
