import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
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

export default function TaskDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [task, setTask] = useState<Task | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [subtasks, setSubtasks] = useState<Task[]>([]);
  const [comment, setComment] = useState('');
  const [subTitle, setSubTitle] = useState('');
  const [subAssignee, setSubAssignee] = useState('');
  const [members, setMembers] = useState<Array<{ id: number; name: string }>>([]);
  const [notFound, setNotFound] = useState(false);

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
        <h1 className="font-display font-bold text-2xl">{task.title}</h1>
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
              className="flex items-center justify-between px-3 py-2 bg-[#0f0f12] border border-[#1f1f23] hover:border-[#333] text-sm"
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
            <div key={c.id} className="bg-[#0f0f12] border border-[#1f1f23] px-3 py-2">
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
    </div>
  );
}
