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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
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
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query, 200);
  const [results, setResults] = useState<{
    tasks: Array<{ id: number; title: string; status: string }>;
    projects: Array<{ id: number; name: string; status: string }>;
  }>({ tasks: [], projects: [] });
  const [notifications, setNotifications] = useState<Notification[]>([]);

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
    if (!debounced.trim()) {
      setResults({ tasks: [], projects: [] });
      return;
    }
    api<typeof results>(`/search?q=${encodeURIComponent(debounced)}`).then(setResults).catch(() => {});
  }, [debounced]);

  const loadNotifications = useCallback(() => {
    api<{ notifications: Notification[] }>('/notifications')
      .then((r) => setNotifications(r.notifications))
      .catch(() => {});
  }, []);

  useEffect(loadNotifications, [loadNotifications]);

  const unread = notifications.filter((n) => !n.read_at).length;

  const nav = [
    { to: '/portal', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/portal/departments', label: 'Departments', icon: Users },
    { to: '/portal/tasks', label: 'Tasks', icon: CheckSquare },
    { to: '/portal/projects', label: 'Projects', icon: FolderKanban },
    ...(user?.isCeo ? [{ to: '/portal/finance', label: 'Finance', icon: Wallet }] : []),
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
          <Button variant="ghost" size="icon" onClick={() => logout()} title="Sign out">
            <LogOut size={15} />
          </Button>
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
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>

      {/* Cmd+K search */}
      <CommandDialog open={searchOpen} onOpenChange={setSearchOpen}>
        <CommandInput placeholder="Search tasks and projects…" value={query} onValueChange={setQuery} />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          {results.tasks.length > 0 && (
            <CommandGroup heading="Tasks">
              {results.tasks.map((t) => (
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
          {results.projects.length > 0 && (
            <CommandGroup heading="Projects">
              {results.projects.map((p) => (
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
    </div>
  );
}
