import { useEffect, useState, useCallback } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import {
  LayoutDashboard,
  Users,
  CheckSquare,
  FolderKanban,
  Wallet,
  Bell,
  Search,
  LogOut,
  Clock,
  KeyRound,
  CalendarDays,
  ScrollText,
  UserCog,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Kbd } from '@/components/ui/kbd';
import { useAuth } from './AuthContext';
import { api } from './api';

interface Notification {
  id: number;
  message: string;
  link: string;
  read_at: string | null;
  created_at: string;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function Layout() {
  const { user, logout, refresh } = useAuth();
  const navigate = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query, 200);
  const [results, setResults] = useState<{
    tasks: Array<{ id: number; title: string; status: string }>;
    projects: Array<{ id: number; name: string; status: string }>;
  }>({ tasks: [], projects: [] });
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [pwOpen, setPwOpen] = useState(false);
  const [pwForm, setPwForm] = useState({ current: '', next: '' });

  const changePassword = async () => {
    try {
      await api('/auth/change-password', {
        method: 'POST',
        body: { currentPassword: pwForm.current, newPassword: pwForm.next },
      });
      setPwOpen(false);
      setPwForm({ current: '', next: '' });
      toast.success('Password changed');
      refresh(); // clears the temp-password banner
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!debounced.trim()) return;
    api<typeof results>(`/search?q=${encodeURIComponent(debounced)}`).then(setResults).catch(() => {});
  }, [debounced]);

  // Stale results are filtered at render instead of cleared in the effect.
  const shownResults = debounced.trim() ? results : { tasks: [], projects: [] };

  const loadNotifications = useCallback(() => {
    api<{ notifications: Notification[] }>('/notifications')
      .then((r) => setNotifications(r.notifications))
      .catch(() => {});
  }, []);

  useEffect(loadNotifications, [loadNotifications]);

  const unread = notifications.filter((n) => !n.read_at).length;

  const nav = [
    { to: '/portal', label: 'Dashboard', icon: LayoutDashboard, end: true },
    ...(user?.isCeo ? [{ to: '/portal/people', label: 'People', icon: UserCog }] : []),
    { to: '/portal/departments', label: 'Departments', icon: Users },
    { to: '/portal/tasks', label: 'Tasks', icon: CheckSquare },
    { to: '/portal/projects', label: 'Projects', icon: FolderKanban },
    { to: '/portal/attendance', label: 'Attendance', icon: Clock },
    { to: '/portal/leave', label: 'Leave', icon: CalendarDays },
    ...(user?.isCeo || user?.financeAccess ? [{ to: '/portal/finance', label: 'Finance', icon: Wallet }] : []),
    ...(user?.isCeo ? [{ to: '/portal/audit', label: 'Audit Log', icon: ScrollText }] : []),
  ];

  return (
    <div className="flex h-screen bg-[#09090B] text-[#FAFAFA]">
      {/* Notion-style sidebar */}
      <aside className="w-60 shrink-0 border-r border-[#1f1f23] flex flex-col">
        <div className="px-4 py-4 font-display font-bold uppercase tracking-tight text-lg">
          LATech <span className="text-[#DFE104]">Portal</span>
        </div>
        <nav className="flex-1 px-2 space-y-0.5">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-2.5 py-1.5 text-sm transition-colors ${
                  isActive
                    ? 'bg-[#1c1c20] text-[#FAFAFA]'
                    : 'text-[#A1A1AA] hover:bg-[#141417] hover:text-[#FAFAFA]'
                }`
              }
            >
              <Icon size={15} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="px-3 py-3 border-t border-[#1f1f23] flex items-center justify-between">
          <div className="min-w-0">
            <div className="text-sm truncate">{user?.name}</div>
            <div className="text-xs text-[#A1A1AA] capitalize">{user?.role}</div>
          </div>
          <div className="flex">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setPwOpen(true)}
              title="Change password"
            >
              <KeyRound size={15} />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => logout()} title="Sign out">
              <LogOut size={15} />
            </Button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-12 shrink-0 border-b border-[#1f1f23] flex items-center justify-between px-4 gap-3">
          <button
            onClick={() => setSearchOpen(true)}
            className="flex items-center gap-2 text-sm text-[#A1A1AA] hover:text-[#FAFAFA] transition-colors"
          >
            <Search size={14} />
            Search
            <Kbd className="ml-1">Ctrl K</Kbd>
          </button>
          <Popover onOpenChange={(open) => {
            if (open && unread > 0) {
              api('/notifications/read', { method: 'POST' }).then(loadNotifications).catch(() => {});
            }
          }}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="relative">
                <Bell size={15} />
                {unread > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 bg-[#DFE104] text-black text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                    {unread}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-0">
              <div className="px-3 py-2 text-sm font-medium border-b border-[#1f1f23]">Notifications</div>
              <div className="max-h-80 overflow-auto">
                {notifications.length === 0 && (
                  <div className="px-3 py-6 text-sm text-[#A1A1AA] text-center">Nothing yet</div>
                )}
                {notifications.map((n) => (
                  <button
                    key={n.id}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-[#141417] border-b border-[#141417]"
                    onClick={() => n.link && navigate(n.link.replace(/^\/portal/, '/portal'))}
                  >
                    <div className={n.read_at ? 'text-[#A1A1AA]' : ''}>{n.message}</div>
                    <div className="text-xs text-[#71717A] mt-0.5">{n.created_at}</div>
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </header>
        {/* Temp-password banner: users onboard with a CEO-issued password and
            must not keep using it — soft-enforced until they change it. */}
        {user?.mustChangePassword && (
          <div className="shrink-0 bg-[#DFE104]/10 border-b border-[#DFE104]/30 px-4 py-2 text-sm text-[#DFE104] flex items-center justify-between">
            <span>You are using a temporary password — set your own to secure your account.</span>
            <Button
              size="sm"
              variant="outline"
              className="border-[#DFE104]/40 text-[#DFE104] hover:bg-[#DFE104]/10"
              onClick={() => setPwOpen(true)}
            >
              Change password
            </Button>
          </div>
        )}
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>

      {/* Cmd+K search */}
      <CommandDialog open={searchOpen} onOpenChange={setSearchOpen}>
        <CommandInput placeholder="Search tasks and projects…" value={query} onValueChange={setQuery} />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          {shownResults.tasks.length > 0 && (
            <CommandGroup heading="Tasks">
              {shownResults.tasks.map((t) => (
                <CommandItem
                  key={`t${t.id}`}
                  onSelect={() => {
                    setSearchOpen(false);
                    navigate(`/portal/tasks/${t.id}`);
                  }}
                >
                  <CheckSquare size={14} className="mr-2" />
                  {t.title}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {shownResults.projects.length > 0 && (
            <CommandGroup heading="Projects">
              {shownResults.projects.map((p) => (
                <CommandItem
                  key={`p${p.id}`}
                  onSelect={() => {
                    setSearchOpen(false);
                    navigate(`/portal/projects/${p.id}`);
                  }}
                >
                  <FolderKanban size={14} className="mr-2" />
                  {p.name}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>

      {/* Change password */}
      <Dialog open={pwOpen} onOpenChange={setPwOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Change password</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Current password</Label>
              <Input
                type="password"
                value={pwForm.current}
                onChange={(e) => setPwForm({ ...pwForm, current: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>New password (8+ characters)</Label>
              <Input
                type="password"
                value={pwForm.next}
                onChange={(e) => setPwForm({ ...pwForm, next: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={changePassword} className="bg-[#DFE104] text-black hover:bg-[#c9cb04]">
              Update password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
