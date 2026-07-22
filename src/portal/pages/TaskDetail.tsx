import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, Plus, Pencil, Trash2 } from 'lucide-react';
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { useAuth } from '../AuthContext';
import Attachments from '../Attachments';
import { api, type Task, type Department } from '../api';

interface Comment {
  id: number;
  author_name: string;
  body: string;
  created_at: string;
}

const STATUSES = ['todo', 'in_progress', 'blocked', 'done'];

const PRIORITY_PILL_ACTIVE: Record<string, string> = {
  low: 'bg-[#3f3f46] border-[#3f3f46]',
  medium: 'bg-[#6b6b76] border-[#6b6b76]',
  high: 'bg-[#DFE104] border-[#DFE104] shadow-[0_0_14px_rgb(223_225_4/0.4)]',
  urgent: 'bg-red-500 border-red-500 shadow-[0_0_14px_rgb(239_68_68/0.4)]',
};

export default function TaskDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [task, setTask] = useState<Task | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [subtasks, setSubtasks] = useState<Task[]>([]);
  const [comment, setComment] = useState('');
  const [subTitle, setSubTitle] = useState('');
  const [subAssignee, setSubAssignee] = useState('');
  const [members, setMembers] = useState<Array<{ id: number; name: string }>>([]);
  const [notFound, setNotFound] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    title: '',
    description: '',
    priority: 'medium',
    dueDate: '',
    assignedTo: '',
  });

  const load = useCallback(() => {
    api<{ task: Task; comments: Comment[]; subtasks: Task[] }>(`/tasks/${id}`)
      .then((r) => {
        setTask(r.task);
        setComments(r.comments);
        setSubtasks(r.subtasks);
      })
      .catch(() => setNotFound(true));
  }, [id]);
  useEffect(load, [load]);

  // Heads (and the CEO) can split a task into sub-tasks for dept members.
  const canDelegate = user?.isCeo || (user?.role === 'head' && user.departmentId === task?.department_id);

  useEffect(() => {
    if (!canDelegate || !task) return;
    api<{ departments: Department[] }>('/departments')
      .then((r) => {
        const dept = r.departments.find((d) => d.id === task.department_id);
        setMembers(dept?.members ?? []);
      })
      .catch(() => {});
  }, [canDelegate, task]);

  if (notFound) {
    return (
      <div className="p-8">
        <p className="text-sm text-[#71717A]">Task not found or not visible to you.</p>
        <Link to="/portal/tasks" className="text-sm text-[#DFE104] mt-2 inline-block">
          ← Back to tasks
        </Link>
      </div>
    );
  }
  if (!task) return <div className="p-8 text-sm text-[#71717A]">Loading…</div>;

  const setStatus = async (status: string) => {
    try {
      await api(`/tasks/${task.id}`, { method: 'PATCH', body: { status } });
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  const openEdit = () => {
    setEditForm({
      title: task.title,
      description: task.description ?? '',
      priority: task.priority,
      dueDate: task.due_date ?? '',
      assignedTo: task.assigned_to ? String(task.assigned_to) : '',
    });
    setEditing(true);
  };

  const canSaveEdit = editForm.title.trim() !== '';

  const saveEdit = async () => {
    if (!canSaveEdit) return;
    try {
      await api(`/tasks/${task.id}`, {
        method: 'PATCH',
        body: {
          title: editForm.title,
          description: editForm.description,
          priority: editForm.priority,
          dueDate: editForm.dueDate || null,
          assignedTo: editForm.assignedTo ? Number(editForm.assignedTo) : null,
        },
      });
      setEditing(false);
      load();
      toast.success('Task updated');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  const addComment = async () => {
    if (!comment.trim()) return;
    try {
      await api(`/tasks/${task.id}/comments`, { method: 'POST', body: { body: comment } });
      setComment('');
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  const addSubtask = async () => {
    if (!subTitle.trim() || !subAssignee) return;
    try {
      await api('/tasks', {
        method: 'POST',
        body: {
          title: subTitle,
          parentTaskId: task.id,
          assignedTo: Number(subAssignee),
          departmentId: task.department_id,
          projectId: task.project_id ?? undefined,
        },
      });
      setSubTitle('');
      setSubAssignee('');
      load();
      toast.success('Sub-task assigned');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  return (
    <div className="p-8 max-w-3xl">
      <Link to="/portal/tasks" className="text-sm text-[#A1A1AA] hover:text-[#FAFAFA] flex items-center gap-1 mb-4">
        <ArrowLeft size={14} /> Tasks
      </Link>

      <div className="flex items-start justify-between gap-4 mb-2">
        <div className="flex items-center gap-2">
          <h1 className="ptitle font-display font-bold text-2xl">{task.title}</h1>
          {canDelegate && (
            <Button variant="ghost" size="sm" onClick={openEdit} className="text-[#A1A1AA] hover:text-[#FAFAFA]">
              <Pencil size={13} />
            </Button>
          )}
          {user?.isCeo && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmDelete(true)}
              className="text-[#A1A1AA] hover:text-red-400"
              title="Delete task"
            >
              <Trash2 size={13} />
            </Button>
          )}
        </div>
        <Select value={task.status} onValueChange={setStatus}>
          <SelectTrigger className="w-36 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s} className="capitalize">
                {s.replace('_', ' ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap gap-2 text-xs text-[#A1A1AA] mb-6">
        <Badge variant="outline">{task.department_name}</Badge>
        <Badge variant="outline" className="capitalize">{task.priority}</Badge>
        {task.assignee_name && <Badge variant="outline">→ {task.assignee_name}</Badge>}
        {task.due_date && <Badge variant="outline">due {task.due_date}</Badge>}
        {task.project_name && (
          <Link to={`/portal/projects/${task.project_id}`}>
            <Badge variant="outline" className="hover:border-[#DFE104]">{task.project_name}</Badge>
          </Link>
        )}
        <span className="self-center text-[#71717A]">created by {task.creator_name}</span>
      </div>

      {task.description && <p className="text-sm text-[#D4D4D8] whitespace-pre-wrap mb-6">{task.description}</p>}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader className="flex-row items-center gap-3 space-y-0">
            <span className="dialog-icon-badge destructive">
              <Trash2 size={16} />
            </span>
            <AlertDialogTitle>Delete "{task.title}"?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription>
            Permanently removes this task, its comments and attachments
            {subtasks.length > 0
              ? `, and its ${subtasks.length} sub-task${subtasks.length === 1 ? '' : 's'}`
              : ''}
            . This cannot be undone.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                try {
                  await api(`/tasks/${task.id}`, { method: 'DELETE' });
                  toast.success('Task deleted');
                  navigate('/portal/tasks');
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : 'Failed');
                }
              }}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <section className="mb-8">
        <h2 className="text-sm font-medium text-[#A1A1AA] uppercase tracking-wide mb-2">Attachments</h2>
        <Attachments entityType="task" entityId={task.id} />
      </section>

      <section className="mb-8">
        <h2 className="text-sm font-medium text-[#A1A1AA] uppercase tracking-wide mb-3">
          Sub-tasks ({subtasks.length})
        </h2>
        <div className="space-y-1 mb-3">
          {subtasks.map((s) => (
            <Link
              key={s.id}
              to={`/portal/tasks/${s.id}`}
              className="prow flex items-center justify-between px-3 py-2 bg-[#0f0f12] border border-[#1f1f23] text-sm"
            >
              <span>{s.title}</span>
              <span className="text-xs text-[#71717A]">
                {s.assignee_name} · {s.status.replace('_', ' ')}
              </span>
            </Link>
          ))}
        </div>
        {canDelegate && (
          <div className="flex gap-2">
            <Input
              placeholder="Sub-task title"
              value={subTitle}
              onChange={(e) => setSubTitle(e.target.value)}
              className="flex-1"
            />
            <Select value={subAssignee} onValueChange={setSubAssignee}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Assign to" />
              </SelectTrigger>
              <SelectContent>
                {members.map((m) => (
                  <SelectItem key={m.id} value={String(m.id)}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={addSubtask} className="bg-[#DFE104] text-black hover:bg-[#c9cb04]">
              <Plus size={14} />
            </Button>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-medium text-[#A1A1AA] uppercase tracking-wide mb-3">Comments</h2>
        <div className="space-y-3 mb-4">
          {comments.map((c) => (
            <div key={c.id} className="pcard animate-fade-up px-3 py-2">
              <div className="text-xs text-[#71717A] mb-1">
                {c.author_name} · {c.created_at}
              </div>
              <div className="text-sm whitespace-pre-wrap">{c.body}</div>
            </div>
          ))}
          {comments.length === 0 && <p className="text-sm text-[#71717A]">No comments yet.</p>}
        </div>
        <div className="flex gap-2">
          <Textarea
            placeholder="Write a comment…"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            className="flex-1"
          />
          <Button onClick={addComment} className="self-end bg-[#DFE104] text-black hover:bg-[#c9cb04]">
            Send
          </Button>
        </div>
      </section>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-w-lg">
          <DialogHeader className="flex-row items-center gap-3 space-y-0">
            <span className="dialog-icon-badge">
              <Pencil size={16} />
            </span>
            <DialogTitle>Edit task</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 stagger">
            <div className="space-y-1.5">
              <Label>Title <span className="text-red-500">*</span></Label>
              <Input value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                rows={3}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Priority</Label>
                <div className="flex gap-1">
                  {(['low', 'medium', 'high', 'urgent'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      className={`pill-option text-[#FAFAFA] ${p === editForm.priority ? PRIORITY_PILL_ACTIVE[p] : ''}`}
                      data-active={editForm.priority === p}
                      onClick={() => setEditForm({ ...editForm, priority: p })}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Due date</Label>
                <Input
                  type="date"
                  value={editForm.dueDate}
                  onChange={(e) => setEditForm({ ...editForm, dueDate: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Assignee</Label>
              <Select
                value={editForm.assignedTo}
                onValueChange={(v) => setEditForm({ ...editForm, assignedTo: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  {members.map((m) => (
                    <SelectItem key={m.id} value={String(m.id)}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
