import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Plus, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { useAuth } from '../AuthContext';
import { api, type Project, type Department } from '../api';

export default function Projects() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', startDate: '', endDate: '' });
  const [visibleTo, setVisibleTo] = useState<number[]>([]);

  const load = useCallback(() => {
    api<{ projects: Project[] }>('/projects').then((r) => setProjects(r.projects)).catch((e) => toast.error(e.message));
  }, []);
  useEffect(load, [load]);

  useEffect(() => {
    if (!user?.isCeo) return;
    api<{ departments: Department[] }>('/departments').then((r) => setDepartments(r.departments)).catch(() => {});
  }, [user]);

  const canCreate = form.name.trim() !== '' && form.startDate !== '' && form.endDate !== '';

  const createProject = async () => {
    if (!canCreate) return;
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
    }
  };

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-8">
        <h1 className="ptitle font-display font-bold text-2xl">Projects</h1>
        {user?.isCeo && (
          <Button onClick={() => setCreating(true)} className="bg-[#DFE104] text-black hover:bg-[#c9cb04]">
            <Plus size={15} className="mr-1" /> New project
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 stagger">
        {projects.map((p) => (
          <Link
            key={p.id}
            to={`/portal/projects/${p.id}`}
            className="pcard pcard-hover press p-4"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium">{p.name}</span>
              <Badge variant="outline" className="capitalize text-xs">
                {p.status.replace('_', ' ')}
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
      {projects.length === 0 && (
        <p className="text-sm text-[#71717A]">
          {user?.isCeo ? 'No projects yet — create one.' : 'No projects shared with your department yet.'}
        </p>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
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
              disabled={!canCreate}
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
