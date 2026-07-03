import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, Eye, Wallet } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { useAuth } from '../AuthContext';
import { api, type Project, type Task, type Department } from '../api';

export default function ProjectDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [visibility, setVisibility] = useState<Array<{ id: number; name: string }>>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(() => {
    api<{ project: Project; tasks: Task[]; visibility?: Array<{ id: number; name: string }> }>(`/projects/${id}`)
      .then((r) => {
        setProject(r.project);
        setTasks(r.tasks);
        setVisibility(r.visibility ?? []);
      })
      .catch(() => setNotFound(true));
  }, [id]);
  useEffect(load, [load]);

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

  return (
    <div className="p-8 max-w-3xl">
      <Link to="/portal/projects" className="text-sm text-[#A1A1AA] hover:text-[#FAFAFA] flex items-center gap-1 mb-4">
        <ArrowLeft size={14} /> Projects
      </Link>

      <div className="flex items-center gap-3 mb-2">
        <h1 className="font-display font-bold text-2xl">{project.name}</h1>
        <Badge variant="outline" className="capitalize">{project.status.replace('_', ' ')}</Badge>
      </div>
      {(project.start_date || project.end_date) && (
        <p className="text-xs text-[#71717A] mb-4">
          {project.start_date ?? '…'} → {project.end_date ?? '…'}
        </p>
      )}
      {project.description && <p className="text-sm text-[#D4D4D8] whitespace-pre-wrap mb-8">{project.description}</p>}

      {user?.isCeo && (
        <>
          <section className="mb-8">
            <h2 className="text-sm font-medium text-[#A1A1AA] uppercase tracking-wide mb-3 flex items-center gap-1.5">
              <Eye size={13} /> Department visibility
            </h2>
            <div className="space-y-2 border border-[#1f1f23] bg-[#0f0f12] p-3 max-w-sm">
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
          <Link
            to={`/portal/finance/${project.id}`}
            className="inline-flex items-center gap-1.5 text-sm text-[#DFE104] hover:underline mb-8"
          >
            <Wallet size={14} /> Open finance ledger (CEO only)
          </Link>
        </>
      )}

      <section>
        <h2 className="text-sm font-medium text-[#A1A1AA] uppercase tracking-wide mb-3">
          Linked tasks ({tasks.length})
        </h2>
        <div className="space-y-1">
          {tasks.map((t) => (
            <Link
              key={t.id}
              to={`/portal/tasks/${t.id}`}
              className="flex items-center justify-between px-3 py-2 bg-[#0f0f12] border border-[#1f1f23] hover:border-[#333] text-sm"
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
    </div>
  );
}
