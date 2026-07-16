import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Plus, Trash2 } from 'lucide-react';
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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { useAuth } from '../AuthContext';
import { api, type Task, type Department, type Project } from '../api';

const STATUSES = [
  { key: 'todo', label: 'To Do' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'done', label: 'Done' },
] as const;

const PRIORITY_COLOR: Record<Task['priority'], string> = {
  low: 'text-[#71717A]',
  medium: 'text-[#A1A1AA]',
  high: 'text-[#DFE104]',
  urgent: 'text-red-400',
};

export default function Tasks() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [view, setView] = useState('board');
  const [creating, setCreating] = useState(false);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [form, setForm] = useState({
    title: '',
    description: '',
    priority: 'medium',
    dueDate: '',
    departmentId: '',
    assignedTo: '',
    projectId: '',
  });

  const canCreate = user?.isCeo || user?.role === 'head';

  const load = useCallback(() => {
    api<{ tasks: Task[] }>('/tasks').then((r) => setTasks(r.tasks)).catch((e) => toast.error(e.message));
  }, []);
  useEffect(load, [load]);

  useEffect(() => {
    if (!canCreate) return;
    api<{ departments: Department[] }>('/departments').then((r) => setDepartments(r.departments)).catch(() => {});
    api<{ projects: Project[] }>('/projects').then((r) => setProjects(r.projects)).catch(() => {});
  }, [canCreate]);

  // Head assigns within own department; CEO picks a department.
  const assignableMembers = useMemo(() => {
    if (user?.isCeo) {
      const d = departments.find((x) => String(x.id) === form.departmentId);
      return d?.members ?? [];
    }
    return departments.find((x) => x.id === user?.departmentId)?.members ?? [];
  }, [departments, form.departmentId, user]);

  const canSubmitTask = form.title.trim() !== '' && (!user?.isCeo || form.departmentId !== '');

  const createTask = async () => {
    if (!canSubmitTask) return;
    try {
      await api('/tasks', {
        method: 'POST',
        body: {
          title: form.title,
          description: form.description,
          priority: form.priority,
          dueDate: form.dueDate || null,
          departmentId: user?.isCeo ? Number(form.departmentId) : undefined,
          assignedTo: form.assignedTo ? Number(form.assignedTo) : undefined,
          projectId: form.projectId ? Number(form.projectId) : undefined,
        },
      });
      setCreating(false);
      setForm({ title: '', description: '', priority: 'medium', dueDate: '', departmentId: '', assignedTo: '', projectId: '' });
      load();
      toast.success('Task created');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  const setStatus = async (task: Task, status: string) => {
    try {
      await api(`/tasks/${task.id}`, { method: 'PATCH', body: { status } });
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  const [deleting, setDeleting] = useState<Task | null>(null);
  const deleteTask = async () => {
    if (!deleting) return;
    try {
      await api(`/tasks/${deleting.id}`, { method: 'DELETE' });
      toast.success(`"${deleting.title}" deleted`);
      setDeleting(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  const TaskCard = ({ t }: { t: Task }) => (
    <Link
      to={`/portal/tasks/${t.id}`}
      className="block bg-[#0f0f12] border border-[#1f1f23] hover:border-[#333] transition-colors p-3"
    >
      <div className="text-sm mb-1.5">{t.title}</div>
      <div className="flex items-center gap-2 text-xs text-[#71717A]">
        <span className={PRIORITY_COLOR[t.priority]}>{t.priority}</span>
        {t.assignee_name && <span>· {t.assignee_name}</span>}
        {t.due_date && <span>· due {t.due_date}</span>}
        {t.project_name && <span>· {t.project_name}</span>}
      </div>
    </Link>
  );

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display font-bold text-2xl">Tasks</h1>
        <div className="flex items-center gap-3">
          <Tabs value={view} onValueChange={setView}>
            <TabsList>
              <TabsTrigger value="board">Board</TabsTrigger>
              <TabsTrigger value="list">List</TabsTrigger>
              <TabsTrigger value="table">Table</TabsTrigger>
            </TabsList>
          </Tabs>
          {canCreate && (
            <Button onClick={() => setCreating(true)} className="bg-[#DFE104] text-black hover:bg-[#c9cb04]">
              <Plus size={15} className="mr-1" /> New task
            </Button>
          )}
        </div>
      </div>

      {view === 'board' && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {STATUSES.map((s) => (
            <div key={s.key}>
              <div className="text-xs uppercase tracking-wide text-[#A1A1AA] mb-2 flex items-center justify-between">
                {s.label}
                <span className="text-[#71717A]">{tasks.filter((t) => t.status === s.key).length}</span>
              </div>
              <div className="space-y-2 min-h-24">
                {tasks
                  .filter((t) => t.status === s.key)
                  .map((t) => (
                    <TaskCard key={t.id} t={t} />
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {view === 'list' && (
        <div className="space-y-1 max-w-3xl">
          {tasks.map((t) => (
            <div key={t.id} className="flex items-center gap-3 px-3 py-2 bg-[#0f0f12] border border-[#1f1f23]">
              <Select value={t.status} onValueChange={(v) => setStatus(t, v)}>
                <SelectTrigger className="w-32 h-7 text-xs shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s.key} value={s.key}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Link to={`/portal/tasks/${t.id}`} className="text-sm flex-1 truncate hover:text-[#DFE104]">
                {t.title}
              </Link>
              <span className={`text-xs ${PRIORITY_COLOR[t.priority]}`}>{t.priority}</span>
              {t.due_date && <span className="text-xs text-[#71717A]">{t.due_date}</span>}
              {user?.isCeo && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-[#71717A] hover:text-red-400 shrink-0"
                  title="Delete task"
                  onClick={() => setDeleting(t)}
                >
                  <Trash2 size={13} />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {view === 'table' && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Assignee</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Due</TableHead>
              {user?.isCeo && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((t) => (
              <TableRow key={t.id}>
                <TableCell>
                  <Link to={`/portal/tasks/${t.id}`} className="hover:text-[#DFE104]">
                    {t.title}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="capitalize text-xs">
                    {t.status.replace('_', ' ')}
                  </Badge>
                </TableCell>
                <TableCell className={PRIORITY_COLOR[t.priority]}>{t.priority}</TableCell>
                <TableCell>{t.assignee_name ?? '—'}</TableCell>
                <TableCell>{t.department_name}</TableCell>
                <TableCell>{t.project_name ?? '—'}</TableCell>
                <TableCell>{t.due_date ?? '—'}</TableCell>
                {user?.isCeo && (
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-[#71717A] hover:text-red-400"
                      title="Delete task"
                      onClick={() => setDeleting(t)}
                    >
                      <Trash2 size={13} />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleting?.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Permanently removes this task, its comments, attachments, and any sub-tasks under it. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={deleteTask} className="bg-red-600 text-white hover:bg-red-700">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {tasks.length === 0 && <p className="text-sm text-[#71717A] mt-6">No tasks visible to you yet.</p>}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New task</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Title <span className="text-red-500">*</span></Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
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
                <Label>Priority</Label>
                <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['low', 'medium', 'high', 'urgent'].map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Due date</Label>
                <Input
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                />
              </div>
            </div>
            {user?.isCeo && (
              <div className="space-y-1.5">
                <Label>Department (assigns to its head unless you pick someone) <span className="text-red-500">*</span></Label>
                <Select
                  value={form.departmentId}
                  onValueChange={(v) => setForm({ ...form, departmentId: v, assignedTo: '' })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select department" />
                  </SelectTrigger>
                  <SelectContent>
                    {departments.map((d) => (
                      <SelectItem key={d.id} value={String(d.id)}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {(user?.role === 'head' || (user?.isCeo && form.departmentId)) && (
              <div className="space-y-1.5">
                <Label>{user?.isCeo ? 'Assignee (optional — defaults to head)' : 'Assign to team member'}</Label>
                <Select value={form.assignedTo} onValueChange={(v) => setForm({ ...form, assignedTo: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select member" />
                  </SelectTrigger>
                  <SelectContent>
                    {assignableMembers.map((m) => (
                      <SelectItem key={m.id} value={String(m.id)}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {projects.length > 0 && (
              <div className="space-y-1.5">
                <Label>Project (optional)</Label>
                <Select value={form.projectId} onValueChange={(v) => setForm({ ...form, projectId: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="No project" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              onClick={createTask}
              disabled={!canSubmitTask}
              className="bg-[#DFE104] text-black hover:bg-[#c9cb04] disabled:opacity-50"
            >
              Create task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
