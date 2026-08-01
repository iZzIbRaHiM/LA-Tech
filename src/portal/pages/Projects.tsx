import { useCallback, useEffect, useState, useRef } from 'react';
import { Link } from 'react-router';
import { Plus, Eye, FolderKanban } from 'lucide-react';
import EmptyState from '../components/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { useAuth } from '../AuthContext';
import { api, type Project, type Department } from '../api';
import { PROJECT_STATUSES, projectStatusBadge, projectStatusLabel } from '../projectStatus';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function Projects() {
  const { user } = useAuth();
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', startDate: '', endDate: '' });
  const [visibleTo, setVisibleTo] = useState<number[]>([]);
  // Status was only visible as a per-card badge and only changeable from inside
  // a project's edit dialog, so there was no way to answer "what is still
  // running and what is finished" from this page.
  //
  // Defaults to All rather than Ongoing on purpose: this page previously showed
  // every project, and silently hiding completed ones would look like they had
  // disappeared. The counts on each tab make the split visible without changing
  // what lands on screen first.
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const load = useCallback(() => {
    api<{ projects: Project[] }>('/projects').then((r) => setProjects(r.projects)).catch((e) => toast.error(e.message));
  }, []);
  useEffect(load, [load]);

  useEffect(() => {
    if (!user?.isCeo) return;
    api<{ departments: Department[] }>('/departments').then((r) => setDepartments(r.departments)).catch(() => {});
  }, [user]);

  const canCreate = form.name.trim() !== '' && form.startDate !== '' && form.endDate !== '';

  const countFor = (status: string) =>
    status === 'all' ? projects.length : projects.filter((p) => p.status === status).length;
  const visibleProjects =
    statusFilter === 'all' ? projects : projects.filter((p) => p.status === statusFilter);

  // Ref-based in-flight guard: blocks a duplicate submit synchronously, before
  // React re-renders to disable the button. A state-only check is too late —
  // rapid clicks all read the stale value. See Chat.tsx for the incident.
  const createProject = async () => {
    if (!canCreate || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await api('/projects', {
        method: 'POST',
        body: {
          name: form.name,
          description: form.description,
          startDate: form.startDate,
          endDate: form.endDate,
          departmentIds: visibleTo,
        },
      });
      setCreating(false);
      setForm({ name: '', description: '', startDate: '', endDate: '' });
      setVisibleTo([]);
      load();
      toast.success('Project created');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="p-4 sm:p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-8">
        <h1 className="ptitle font-display font-bold text-2xl">Projects</h1>
        {user?.isCeo && (
          <Button onClick={() => setCreating(true)} className="bg-[#DFE104] text-black hover:bg-[#c9cb04]">
            <Plus size={15} className="mr-1" /> New project
          </Button>
        )}
      </div>

      <Tabs value={statusFilter} onValueChange={setStatusFilter} className="mb-5">
        <TabsList className="flex-wrap h-auto">
          {['all', ...PROJECT_STATUSES].map((s) => (
            <TabsTrigger key={s} value={s} className="capitalize">
              {s === 'all' ? 'All' : projectStatusLabel(s)}
              <span className="ml-1.5 text-[11px] text-[#71717A] tabular-nums">{countFor(s)}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 stagger">
        {visibleProjects.map((p) => (
          <Link
            key={p.id}
            to={`/portal/projects/${p.id}`}
            className="pcard pcard-hover press p-4"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium">{p.name}</span>
              <Badge variant="outline" className={`text-xs shrink-0 ${projectStatusBadge(p.status)}`}>
                {projectStatusLabel(p.status)}
              </Badge>
            </div>
            {p.description && <p className="text-sm text-[#A1A1AA] line-clamp-2">{p.description}</p>}
            {(p.start_date || p.end_date) && (
              <p className="text-xs text-[#71717A] mt-2">
                {p.start_date ?? '…'} → {p.end_date ?? '…'}
              </p>
            )}
          </Link>
        ))}
      </div>
      {/* "None at all" and "none in this filter" are different situations —
          saying "create one" to someone who simply has no completed projects
          yet would be wrong. */}
      {projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title={user?.isCeo ? 'No projects yet — create one.' : 'No projects shared with your department yet.'}
        />
      ) : (
        visibleProjects.length === 0 && (
          <EmptyState
            compact
            icon={FolderKanban}
            title={`No ${projectStatusLabel(statusFilter).toLowerCase()} projects.`}
          />
        )
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-lg">
          <DialogHeader className="flex-row items-center gap-3 space-y-0">
            <span className="dialog-icon-badge">
              <FolderKanban size={16} />
            </span>
            <div>
              <DialogTitle>New project</DialogTitle>
              <DialogDescription className="mt-0.5">Grant departments visibility once created.</DialogDescription>
            </div>
          </DialogHeader>
          <div className="space-y-3 stagger">
            <div className="space-y-1.5">
              <Label>Name <span className="text-red-500">*</span></Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={3}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Start date <span className="text-red-500">*</span></Label>
                <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>End date <span className="text-red-500">*</span></Label>
                <Input
                  type="date"
                  min={form.startDate || undefined}
                  value={form.endDate}
                  onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <Eye size={13} /> Visible to departments (unchecked departments won't know it exists)
              </Label>
              <div className="space-y-2 border border-[#1f1f23] p-3">
                {departments.map((d) => (
                  <label key={d.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={visibleTo.includes(d.id)}
                      onCheckedChange={(c) =>
                        setVisibleTo((v) => (c ? [...v, d.id] : v.filter((x) => x !== d.id)))
                      }
                    />
                    {d.name}
                  </label>
                ))}
                {departments.length === 0 && (
                  <p className="text-xs text-[#71717A]">No departments yet — the project will be CEO-only.</p>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={createProject}
              disabled={!canCreate || busy}
              className="bg-[#DFE104] text-black hover:bg-[#c9cb04] disabled:opacity-50"
            >
              Create project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
