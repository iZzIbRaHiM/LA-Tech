import { lazy, Suspense, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '../AuthContext';
import { api, type Task, type Project } from '../api';

// recharts is a heavy dependency used nowhere else in the app — lazy-load
// it so only a CEO's browser ever downloads it, not every portal user.
const CeoInsights = lazy(() => import('../CeoInsights'));

interface Activity {
  id: number;
  actor_name: string;
  entity_type: string;
  action: string;
  created_at: string;
}

export default function Dashboard() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);

  useEffect(() => {
    api<{ tasks: Task[] }>('/tasks').then((r) => setTasks(r.tasks)).catch((e) => toast.error(e.message));
    api<{ projects: Project[] }>('/projects').then((r) => setProjects(r.projects)).catch((e) => toast.error(e.message));
    api<{ activity: Activity[] }>('/activity').then((r) => setActivity(r.activity)).catch((e) => toast.error(e.message));
  }, []);

  const open = tasks.filter((t) => t.status !== 'done');
  const overdue = open.filter((t) => t.due_date && t.due_date < new Date().toISOString().slice(0, 10));

  return (
    <div className="p-8 max-w-6xl">
      <h1 className="font-display font-bold text-2xl mb-1">
        Welcome back, {user?.name?.split(' ')[0]}
      </h1>
      <p className="text-sm text-[#A1A1AA] mb-8 capitalize">{user?.role} view</p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
        <Card className="bg-[#0f0f12] border-[#1f1f23]">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-[#A1A1AA] font-normal">Open tasks</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-display font-bold">{open.length}</CardContent>
        </Card>
        <Card className="bg-[#0f0f12] border-[#1f1f23]">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-[#A1A1AA] font-normal">Overdue</CardTitle>
          </CardHeader>
          <CardContent className={`text-3xl font-display font-bold ${overdue.length ? 'text-red-400' : ''}`}>
            {overdue.length}
          </CardContent>
        </Card>
        <Card className="bg-[#0f0f12] border-[#1f1f23]">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-[#A1A1AA] font-normal">
              {user?.isCeo ? 'Projects' : 'Shared projects'}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-display font-bold">{projects.length}</CardContent>
        </Card>
      </div>

      {user?.isCeo && (
        <Suspense fallback={<div className="h-32 mb-12 animate-pulse bg-[#0f0f12] border border-[#1f1f23]" />}>
          <CeoInsights />
        </Suspense>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <section>
          <h2 className="text-sm font-medium text-[#A1A1AA] uppercase tracking-wide mb-3">My open tasks</h2>
          <div className="space-y-1">
            {open.slice(0, 8).map((t) => (
              <Link
                key={t.id}
                to={`/portal/tasks/${t.id}`}
                className="flex items-center justify-between px-3 py-2 bg-[#0f0f12] border border-[#1f1f23] hover:border-[#333] transition-colors"
              >
                <span className="text-sm truncate">{t.title}</span>
                <Badge variant="outline" className="ml-2 shrink-0 text-xs capitalize">
                  {t.status.replace('_', ' ')}
                </Badge>
              </Link>
            ))}
            {open.length === 0 && <p className="text-sm text-[#71717A]">No open tasks.</p>}
          </div>
        </section>

        <section>
          <h2 className="text-sm font-medium text-[#A1A1AA] uppercase tracking-wide mb-3">Recent activity</h2>
          <div className="space-y-2">
            {activity.slice(0, 10).map((a) => (
              <div key={a.id} className="text-sm text-[#A1A1AA]">
                <span className="text-[#FAFAFA]">{a.actor_name}</span> {a.action.replace(/_/g, ' ')}{' '}
                <span className="text-[#71717A]">· {a.entity_type}</span>
              </div>
            ))}
            {activity.length === 0 && <p className="text-sm text-[#71717A]">Nothing yet.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
