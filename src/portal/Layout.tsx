import { useEffect, useState, useCallback, useRef } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
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
  Settings as SettingsIcon,
  MessageSquare,
  Network,
  Video,
  Menu,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PasswordInput } from '@/components/ui/password-input';
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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
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
import { usePolling } from './usePolling';

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
  const location = useLocation();
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const passwordPolicyOk =
    pwForm.next.length >= 10 &&
    /[a-z]/.test(pwForm.next) &&
    /[A-Z]/.test(pwForm.next) &&
    /[0-9]/.test(pwForm.next) &&
    /[^A-Za-z0-9]/.test(pwForm.next);

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

  // Cursor-tracking spotlight on .pcard-hover surfaces: one delegated
  // listener feeds --mx/--my to the CSS radial highlight (see index.css).
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const card = (e.target as Element | null)?.closest?.('.pcard-hover') as HTMLElement | null;
      if (!card) return;
      const rect = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${e.clientX - rect.left}px`);
      card.style.setProperty('--my', `${e.clientY - rect.top}px`);
    };
    document.addEventListener('mousemove', onMove, { passive: true });
    return () => document.removeEventListener('mousemove', onMove);
  }, []);

  useEffect(() => {
    if (!debounced.trim()) return;
    api<typeof results>(`/search?q=${encodeURIComponent(debounced)}`).then(setResults).catch(() => {});
  }, [debounced]);

  // Stale results are filtered at render instead of cleared in the effect.
  const shownResults = debounced.trim() ? results : { tasks: [], projects: [] };

  // Track the newest notification we've already seen so fresh meeting
  // invites can surface as an actionable toast, not just a stale badge.
  const newestSeenRef = useRef<number | null>(null);

  const loadNotifications = useCallback(() => {
    api<{ notifications: Notification[] }>('/notifications')
      .then((r) => {
        setNotifications(r.notifications);
        const newest = r.notifications[0]?.id ?? 0;
        const prevNewest = newestSeenRef.current;
        // First load establishes the baseline silently.
        if (prevNewest !== null && newest > prevNewest) {
          for (const n of r.notifications) {
            if (n.id <= prevNewest) break;
            if (!n.read_at && n.link.startsWith('/portal/meetings/')) {
              toast.info(n.message, {
                action: { label: 'Join', onClick: () => navigate(n.link) },
                duration: 15000,
              });
            }
          }
        }
        newestSeenRef.current = newest;
      })
      .catch(() => {});
  }, [navigate]);

  // Poll so invites and mentions arrive while the tab is open — the bell
  // count was previously loaded once and went stale for the whole session.
  // Visibility-aware: a backgrounded tab polls nothing (free-tier quotas).
  usePolling(loadNotifications, 30000);

  const unread = notifications.filter((n) => !n.read_at).length;

  const nav = [
    { to: '/portal', label: 'Dashboard', icon: LayoutDashboard, end: true },
    ...(user?.isCeo ? [{ to: '/portal/people', label: 'People', icon: UserCog }] : []),
    ...(user?.isCeo ? [{ to: '/portal/org', label: 'Org Chart', icon: Network }] : []),
    { to: '/portal/departments', label: 'Departments', icon: Users },
    { to: '/portal/tasks', label: 'Tasks', icon: CheckSquare },
    { to: '/portal/projects', label: 'Projects', icon: FolderKanban },
    { to: '/portal/attendance', label: 'Attendance', icon: Clock },
    { to: '/portal/leave', label: 'Leave', icon: CalendarDays },
    { to: '/portal/chat', label: 'Chat', icon: MessageSquare },
    { to: '/portal/meetings', label: 'Meetings', icon: Video },
    ...(user?.isCeo || user?.financeAccess ? [{ to: '/portal/finance', label: 'Finance', icon: Wallet }] : []),
    ...(user?.isCeo ? [{ to: '/portal/salary', label: 'Salary', icon: Wallet }] : []),
    ...(user?.isCeo ? [{ to: '/portal/audit', label: 'Audit Log', icon: ScrollText }] : []),
    ...(user?.isCeo ? [{ to: '/portal/settings', label: 'Settings', icon: SettingsIcon }] : []),
  ];

  const navContent = (onNavigate?: () => void) => (
    <>
      <nav className="flex-1 px-2 space-y-0.5 overflow-y-auto">
        {nav.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
              `pnav press flex items-center gap-2.5 px-2.5 py-1.5 text-sm transition-colors ${
                isActive
                  ? 'pnav-active bg-[#1c1c20] text-[#FAFAFA] shadow-[inset_0_1px_0_rgb(255_255_255/0.03)]'
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
    </>
  );

  return (
    <div className="portal-scroll flex h-screen bg-[#09090B] text-[#FAFAFA]">
      {/* Notion-style sidebar — desktop only; mobile gets the drawer below */}
      <aside className="hidden md:flex w-60 shrink-0 border-r border-[#1f1f23] flex-col">
        <div className="px-4 py-4 flex items-center gap-2 group cursor-default">
          <img
            src="/brand/latech-symbol.svg"
            alt=""
            className="h-6 w-auto shrink-0 transition-all duration-300 group-hover:drop-shadow-[0_0_8px_rgb(223_225_4/0.6)] group-hover:rotate-[8deg]"
          />
          <span className="font-display font-bold uppercase tracking-tight text-lg">
            LATech <span className="text-[#DFE104]">Portal</span>
          </span>
        </div>
        {navContent()}
      </aside>

      {/* Mobile nav drawer */}
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-64 p-0 bg-[#09090B] border-[#1f1f23] flex flex-col md:hidden">
          <SheetHeader className="px-4 py-4">
            <SheetTitle className="flex items-center gap-2 font-display font-bold uppercase tracking-tight text-lg">
              <img src="/brand/latech-symbol.svg" alt="" className="h-6 w-auto shrink-0" />
              LATech <span className="text-[#DFE104]">Portal</span>
            </SheetTitle>
          </SheetHeader>
          {navContent(() => setMobileNavOpen(false))}
        </SheetContent>
      </Sheet>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-12 shrink-0 border-b border-[#1f1f23] flex items-center justify-between px-4 gap-3 shadow-[0_2px_12px_rgb(0_0_0/0.4)] relative z-10 bg-[#09090B]">
          <div className="flex items-center gap-2 min-w-0">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden shrink-0"
              onClick={() => setMobileNavOpen(true)}
              title="Menu"
            >
              <Menu size={17} />
            </Button>
            <button
              onClick={() => setSearchOpen(true)}
              className="flex items-center gap-2 text-sm text-[#A1A1AA] hover:text-[#FAFAFA] transition-colors"
            >
              <Search size={14} />
              Search
              <Kbd className="ml-1 hidden sm:inline-flex">Ctrl K</Kbd>
            </button>
          </div>
          <Popover onOpenChange={(open) => {
            if (open && unread > 0) {
              api('/notifications/read', { method: 'POST' }).then(loadNotifications).catch(() => {});
            }
          }}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="relative press">
                <Bell size={15} className={unread > 0 ? 'animate-[wiggle_0.8s_ease-in-out]' : ''} />
                {unread > 0 && (
                  <span className="glow-pulse absolute -top-0.5 -right-0.5 bg-[#DFE104] text-black text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
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
                    className="prow w-full text-left px-3 py-2 text-sm border-b border-[#141417]"
                    onClick={() => n.link && navigate(n.link.replace(/^\/portal/, '/portal'))}
                  >
                    <div className={`flex items-start gap-2 ${n.read_at ? 'text-[#A1A1AA]' : ''}`}>
                      {!n.read_at && (
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#DFE104] shadow-[0_0_6px_rgb(223_225_4/0.6)]" />
                      )}
                      <span>{n.message}</span>
                    </div>
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
        <main className="portal-main flex-1 overflow-auto">
          {/* Keyed by path so every route change re-triggers the entrance
              animation. h-full (not min-h-full): full-height pages (OrgChart,
              Chat, MeetingRoom) size themselves with percentage heights, which
              need a definite parent height; taller pages simply overflow this
              wrapper and scroll via <main>. */}
          <div key={location.pathname} className="animate-fade-up h-full">
            <Outlet />
          </div>
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
          <DialogHeader className="flex-row items-center gap-3 space-y-0">
            <span className="dialog-icon-badge">
              <KeyRound size={16} />
            </span>
            <DialogTitle>Change password</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 stagger">
            <div className="space-y-1.5">
              <Label>Current password <span className="text-red-500">*</span></Label>
              <PasswordInput
                value={pwForm.current}
                onChange={(e) => setPwForm({ ...pwForm, current: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>New password <span className="text-red-500">*</span></Label>
              <PasswordInput
                value={pwForm.next}
                onChange={(e) => setPwForm({ ...pwForm, next: e.target.value })}
              />
              <p className="text-xs text-[#71717A]">
                10+ characters, with uppercase, lowercase, a number, and a special character.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={changePassword}
              disabled={!pwForm.current || !passwordPolicyOk}
              className="bg-[#DFE104] text-black hover:bg-[#c9cb04] disabled:opacity-50"
            >
              Update password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
