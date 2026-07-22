import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, Eye, Wallet, Flag, Plus, Trash2, Pencil } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { useAuth } from '../AuthContext';
import { api, type Project, type Task, type Department } from '../api';

interface Milestone {
  id: number;
  title: string;
  due_date: string | null;
  completed_at: string | null;
}

export default function ProjectDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletingMilestone, setDeletingMilestone] = useState<Milestone | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [visibility, setVisibility] = useState<Array<{ id: number; name: string }>>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [msForm, setMsForm] = useState({ title: '', dueDate: '' });
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    name: '',
    description: '',
    status: 'active',
    startDate: '',
    endDate: '',
  });

  const load = useCallback(() => {
    api<{ project: Project; tasks: Task[]; visibility?: Array<{ id: number; name: string }> }>(`/projects/${id}`)
      .then((r) => {
        setProject(r.project);
        setTasks(r.tasks);
        setVisibility(r.visibility ?? []);
      })
      .catch(() => setNotFound(true));
    api<{ milestones: Milestone[] }>(`/projects/${id}/milestones`)
      .then((r) => setMilestones(r.milestones))
      .catch(() => {});
  }, [id]);
  useEffect(load, [load]);

  const confirmDeleteMilestone = async () => {
    if (!deletingMilestone) return;
    try {
      await api(`/milestones/${deletingMilestone.id}`, { method: 'DELETE' });
      setDeletingMilestone(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  useEffect(() => {
    if (!user?.isCeo) return;
    api<{ departments: Department[] }>('/departments').then((r) => setDepartments(r.departments)).catch(() => {});
  }, [user]);

  if (notFound) {
    return (
      <div className="p-8">
        <p className="text-sm text-[#71717A]">Project not found or not visible to your department.</p>
        <Link to="/portal/projects" className="text-sm text-[#DFE104] mt-2 inline-block">
          ← Back to projects
        </Link>
      </div>
    );
  }
  if (!project) return <div className="p-8 text-sm text-[#71717A]">Loading…</div>;

  const toggleVisibility = async (deptId: number, grant: boolean) => {
    const ids = grant ? [...visibility.map((v) => v.id), deptId] : visibility.filter((v) => v.id !== deptId).map((v) => v.id);
    try {
      await api(`/projects/${project.id}`, { method: 'PATCH', body: { departmentIds: ids } });
      load();
      toast.success('Visibility updated');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  const openEdit = () => {
    setEditForm({
      name: project.name,
      description: project.description ?? '',
      status: project.status,
      startDate: project.start_date ?? '',
      endDate: project.end_date ?? '',
    });
    setEditing(true);
  };

  const canSaveEdit = editForm.name.trim() !== '' && editForm.startDate !== '' && editForm.endDate !== '';

  const saveEdit = async () => {
    if (!canSaveEdit) return;
    try {
      await api(`/projects/${project.id}`, {
        method: 'PATCH',
        body: {
          name: editForm.name,
          description: editForm.description,
          status: editForm.status,
          startDate: editForm.startDate,
          endDate: editForm.endDate,
        },
      });
      setEditing(false);
      load();
      toast.success('Project updated');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  return (
    <div className="p-8 max-w-3xl">
      <Link to="/portal/projects" className="text-sm text-[#A1A1AA] hover:text-[#FAFAFA] flex items-center gap-1 mb-4">
        <ArrowLeft size={14} /> Projects
      </Link>

      <div className="flex items-center gap-3 mb-2">
        <h1 className="ptitle font-display font-bold text-2xl">{project.name}</h1>
        <Badge variant="outline" className="capitalize">{project.status.replace('_', ' ')}</Badge>
        {user?.isCeo && (
          <>
            <Button variant="ghost" size="sm" onClick={openEdit} className="text-[#A1A1AA] hover:text-[#FAFAFA]">
              <Pencil size={13} className="mr-1" /> Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmDelete(true)}
              className="text-[#A1A1AA] hover:text-red-400"
              title="Delete project"
            >
              <Trash2 size={13} className="mr-1" /> Delete
            </Button>
          </>
        )}
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader className="flex-row items-center gap-3 space-y-0">
            <span className="dialog-icon-badge destructive">
              <Trash2 size={16} />
            </span>
            <AlertDialogTitle>Delete "{project.name}"?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Permanently removes this project, its milestones, its visibility grants, and its entire finance
                  ledger (budgets, expenses, income). This cannot be undone.
                </p>
                <p>
                  {tasks.length > 0
                    ? `${tasks.length} linked task${tasks.length === 1 ? '' : 's'} will be kept and unlinked, not deleted.`
                    : 'No tasks are linked to this project.'}
                </p>
              </div>
            </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                try {
                  await api(`/projects/${project.id}`, { method: 'DELETE' });
                  toast.success('Project deleted');
                  navigate('/portal/projects');
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : 'Failed');
                }
              }}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              Delete project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deletingMilestone} onOpenChange={(o) => !o && setDeletingMilestone(null)}>
        <AlertDialogContent>
          <AlertDialogHeader className="flex-row items-center gap-3 space-y-0">
            <span className="dialog-icon-badge destructive">
              <Trash2 size={16} />
            </span>
            <AlertDialogTitle>Delete milestone "{deletingMilestone?.title}"?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteMilestone} className="bg-red-600 text-white hover:bg-red-700">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {(project.start_date || project.end_date) && (
        <p className="text-xs text-[#71717A] mb-4">
          {project.start_date ?? '…'} → {project.end_date ?? '…'}
        </p>
      )}
      {project.description && <p className="text-sm text-[#D4D4D8] whitespace-pre-wrap mb-8">{project.description}</p>}

      {user?.isCeo && (
        <section className="mb-8">
          <h2 className="text-sm font-medium text-[#A1A1AA] uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <Eye size={13} /> Department visibility
          </h2>
          <div className="pcard space-y-2 p-3 max-w-sm">
            {departments.map((d) => (
              <label key={d.id} className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={visibility.some((v) => v.id === d.id)}
                  onCheckedChange={(c) => toggleVisibility(d.id, !!c)}
                />
                {d.name}
              </label>
            ))}
          </div>
        </section>
      )}
      {(user?.isCeo || user?.financeAccess) && (
        <Link
          to={`/portal/finance/${project.id}`}
          className="inline-flex items-center gap-1.5 text-sm text-[#DFE104] hover:underline mb-8"
        >
          <Wallet size={14} /> Open finance ledger
        </Link>
      )}

      {/* Milestones timeline */}
      <section className="mb-8">
        <h2 className="text-sm font-medium text-[#A1A1AA] uppercase tracking-wide mb-3 flex items-center gap-1.5">
          <Flag size={13} /> Milestones
        </h2>
        <div className="border-l border-[#1f1f23] ml-1.5 pl-5 space-y-3">
          {milestones.map((m) => (
            <div key={m.id} className="relative flex items-center gap-3 group">
              <span
                className={`absolute -left-[26px] w-2.5 h-2.5 rounded-full ${
                  m.completed_at ? 'bg-[#DFE104]' : 'bg-[#333] border border-[#555]'
                }`}
              />
              <Checkbox
                checked={!!m.completed_at}
                disabled={!(user?.isCeo || user?.role === 'head')}
                onCheckedChange={async (c) => {
                  try {
                    await api(`/milestones/${m.id}`, { method: 'PATCH', body: { completed: !!c } });
                    load();
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : 'Failed');
                  }
                }}
              />
              <span className={`text-sm ${m.completed_at ? 'line-through text-[#71717A]' : ''}`}>{m.title}</span>
              {m.due_date && <span className="text-xs text-[#71717A]">due {m.due_date}</span>}
              {user?.isCeo && (
                <button
                  className="opacity-0 group-hover:opacity-100 text-[#71717A] hover:text-red-400 transition-opacity"
                  onClick={() => setDeletingMilestone(m)}
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}
          {milestones.length === 0 && <p className="text-sm text-[#71717A]">No milestones yet.</p>}
        </div>
        {user?.isCeo && (
          <div className="flex gap-2 mt-4 max-w-md">
            <Input
              placeholder="Milestone title *"
              value={msForm.title}
              onChange={(e) => setMsForm({ ...msForm, title: e.target.value })}
              className="flex-1"
            />
            <Input
              type="date"
              value={msForm.dueDate}
              onChange={(e) => setMsForm({ ...msForm, dueDate: e.target.value })}
              className="w-36"
            />
            <Button
              disabled={!msForm.title.trim()}
              onClick={async () => {
                if (!msForm.title.trim()) return;
                try {
                  await api(`/projects/${project.id}/milestones`, {
                    method: 'POST',
                    body: { title: msForm.title, dueDate: msForm.dueDate || null },
                  });
                  setMsForm({ title: '', dueDate: '' });
                  load();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : 'Failed');
                }
              }}
              className="bg-[#DFE104] text-black hover:bg-[#c9cb04] disabled:opacity-50"
            >
              <Plus size={14} />
            </Button>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-medium text-[#A1A1AA] uppercase tracking-wide mb-3">
          Linked tasks ({tasks.length})
        </h2>
        <div className="space-y-1">
          {tasks.map((t) => (
            <Link
              key={t.id}
              to={`/portal/tasks/${t.id}`}
              className="prow flex items-center justify-between px-3 py-2 bg-[#0f0f12] border border-[#1f1f23] text-sm"
            >
              <span>{t.title}</span>
              <Badge variant="outline" className="text-xs capitalize">
                {t.status.replace('_', ' ')}
              </Badge>
            </Link>
          ))}
          {tasks.length === 0 && <p className="text-sm text-[#71717A]">No tasks linked yet.</p>}
        </div>
      </section>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-w-lg">
          <DialogHeader className="flex-row items-center gap-3 space-y-0">
            <span className="dialog-icon-badge">
              <Pencil size={16} />
            </span>
            <DialogTitle>Edit project</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 stagger">
            <div className="space-y-1.5">
              <Label>Name <span className="text-red-500">*</span></Label>
              <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                rows={3}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={editForm.status} onValueChange={(v) => setEditForm({ ...editForm, status: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {['active', 'on_hold', 'completed', 'archived'].map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">
                      {s.replace('_', ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Start date <span className="text-red-500">*</span></Label>
                <Input
                  type="date"
                  value={editForm.startDate}
                  onChange={(e) => setEditForm({ ...editForm, startDate: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>End date <span className="text-red-500">*</span></Label>
                <Input
                  type="date"
                  min={editForm.startDate || undefined}
                  value={editForm.endDate}
                  onChange={(e) => setEditForm({ ...editForm, endDate: e.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={saveEdit}
              disabled={!canSaveEdit}
              className="bg-[#DFE104] text-black hover:bg-[#c9cb04] disabled:opacity-50"
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
