import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Check, Circle, Pencil, UserRound, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '../AuthContext';
import { api, type Task, type Project, type ResolvedSchedule } from '../api';

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

interface MyProfile {
  title: string;
  phone: string;
  created_at: string;
  manager_id: number | null;
  manager_name: string | null;
  manager_title: string | null;
  department_name: string | null;
  membership_role: string | null;
}

export default function Dashboard() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [schedule, setSchedule] = useState<ResolvedSchedule | null>(null);
  const [checkedInToday, setCheckedInToday] = useState<boolean | null>(null);
  const [editingPhone, setEditingPhone] = useState(false);
  const [phoneDraft, setPhoneDraft] = useState('');
  const [checklistDismissed, setChecklistDismissed] = useState(
    () => localStorage.getItem('portal-onboarding-dismissed') === '1'
  );

  const loadProfile = useCallback(() => {
    api<{ profile: MyProfile; schedule: ResolvedSchedule | null }>('/me/profile')
      .then((r) => {
        setProfile(r.profile);
        setSchedule(r.schedule);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    api<{ tasks: Task[] }>('/tasks').then((r) => setTasks(r.tasks)).catch((e) => toast.error(e.message));
    api<{ projects: Project[] }>('/projects').then((r) => setProjects(r.projects)).catch((e) => toast.error(e.message));
    api<{ activity: Activity[] }>('/activity').then((r) => setActivity(r.activity)).catch((e) => toast.error(e.message));
    loadProfile();
    if (!user?.isCeo) {
      api<{ own: Array<{ record_date: string }> }>('/attendance')
        .then((r) => setCheckedInToday(r.own.some((a) => a.record_date === new Date().toISOString().slice(0, 10))))
        .catch(() => {});
    }
  }, [loadProfile, user?.isCeo]);

  const savePhone = async () => {
    try {
      await api('/me/profile', { method: 'PATCH', body: { phone: phoneDraft } });
      toast.success('Phone updated');
      setEditingPhone(false);
      loadProfile();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  const open = tasks.filter((t) => t.status !== 'done');
  const overdue = open.filter((t) => t.due_date && t.due_date < new Date().toISOString().slice(0, 10));

  // First-run checklist for non-CEO users — auto-detects real completion
  // where it can, and disappears once everything is done (or dismissed).
  const checklist = !user?.isCeo
    ? [
        { label: 'Set your own password', done: !user?.mustChangePassword, to: undefined },
        { label: 'Check in for today', done: !!checkedInToday, to: '/portal/attendance' },
        { label: 'Add your phone number', done: !!profile?.phone, to: undefined },
      ]
    : [];
  const checklistComplete = checklist.every((c) => c.done);
  const showChecklist = !user?.isCeo && !checklistDismissed && !checklistComplete && checkedInToday !== null;

  return (
    <div className="p-4 sm:p-8 max-w-6xl">
      <h1 className="font-display font-bold text-2xl mb-1">
        Welcome back, {user?.name?.split(' ')[0]}
      </h1>
      <p className="text-sm text-[#A1A1AA] mb-6 capitalize">
        {profile?.title || user?.role}
        {profile?.department_name ? ` · ${profile.department_name}` : ''}
      </p>

      {/* Getting-started checklist (new users) */}
      {showChecklist && (
        <div className="mb-6 border border-[#DFE104]/30 bg-[#DFE104]/5 px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-[#DFE104]">Getting started</span>
            <button
              onClick={() => {
                localStorage.setItem('portal-onboarding-dismissed', '1');
                setChecklistDismissed(true);
              }}
              className="text-[#71717A] hover:text-[#FAFAFA]"
              title="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-6">
            {checklist.map((c) =>
              c.to && !c.done ? (
                <Link key={c.label} to={c.to} className="flex items-center gap-1.5 text-sm text-[#FAFAFA] hover:text-[#DFE104]">
                  <Circle size={13} className="text-[#71717A]" /> {c.label}
                </Link>
              ) : (
                <span key={c.label} className={`flex items-center gap-1.5 text-sm ${c.done ? 'text-[#71717A] line-through' : 'text-[#FAFAFA]'}`}>
                  {c.done ? <Check size={13} className="text-emerald-400" /> : <Circle size={13} className="text-[#71717A]" />} {c.label}
                </span>
              )
            )}
          </div>
        </div>
      )}

      {/* My profile card (everyone but the CEO, who has the whole org tree) */}
      {!user?.isCeo && profile && (
        <div className="mb-8 border border-[#1f1f23] bg-[#0f0f12] px-4 py-3 flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
          <span className="flex items-center gap-2 text-[#A1A1AA]">
            <UserRound size={14} className="text-[#DFE104]" />
            Reports to{' '}
            <span className="text-[#FAFAFA]">
              {profile.manager_name ?? '—'}
              {profile.manager_title ? <span className="text-[#71717A]"> ({profile.manager_title})</span> : null}
            </span>
          </span>
          <span className="text-[#A1A1AA]">
            Department: <span className="text-[#FAFAFA]">{profile.department_name ?? 'Not assigned yet'}</span>
            {profile.membership_role === 'intern' && (
              <Badge variant="outline" className="ml-1.5 text-[10px] text-[#DFE104] border-[#555]">INTERN</Badge>
            )}
          </span>
          {schedule && (
            <span className="text-[#A1A1AA]">
              Office hours:{' '}
              <span className="text-[#FAFAFA]">
                {schedule.office_start_time}–{schedule.office_end_time}
              </span>
              {schedule.schedule_name ? <span className="text-[#71717A]"> ({schedule.schedule_name})</span> : null}
            </span>
          )}
          <span className="flex items-center gap-1.5 text-[#A1A1AA]">
            Phone:{' '}
            {editingPhone ? (
              <span className="inline-flex items-center gap-1.5">
                <Input value={phoneDraft} onChange={(e) => setPhoneDraft(e.target.value)} className="h-7 w-40" placeholder="+92 …" />
                <Button size="sm" className="h-7 bg-[#DFE104] text-black hover:bg-[#c9cb04]" onClick={savePhone}>
                  Save
                </Button>
                <Button size="sm" variant="ghost" className="h-7" onClick={() => setEditingPhone(false)}>
                  Cancel
                </Button>
              </span>
            ) : (
              <>
                <span className="text-[#FAFAFA]">{profile.phone || 'not set'}</span>
                <button
                  onClick={() => {
                    setPhoneDraft(profile.phone);
                    setEditingPhone(true);
                  }}
                  className="text-[#71717A] hover:text-[#DFE104]"
                  title="Edit phone"
                >
                  <Pencil size={12} />
                </button>
              </>
            )}
          </span>
        </div>
      )}

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
            {open.length === 0 && (
              <p className="text-sm text-[#71717A]">
                {user?.isCeo
                  ? 'No open tasks — create one from the Tasks page.'
                  : profile?.department_name
                  ? 'No open tasks — your department head assigns work here.'
                  : 'No tasks yet. Once the CEO places you in a department, assigned work shows up here.'}
              </p>
            )}
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
