export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown } = {}
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? 'GET',
    credentials: 'include',
    headers: {
      // CSRF guard: the server rejects mutations without this custom header,
      // which cross-origin pages cannot attach without a CORS preflight.
      'X-Requested-With': 'latech-portal',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const j = await res.json();
      if (j?.error) message = j.error;
    } catch {
      /* keep default */
    }
    throw new ApiError(res.status, message);
  }
  return res.json() as Promise<T>;
}

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  isCeo: boolean;
  financeAccess: boolean;
  mustChangePassword: boolean;
  departmentId: number | null;
  role: 'ceo' | 'head' | 'member' | 'unassigned';
}

export interface Department {
  id: number;
  name: string;
  head_user_id: number | null;
  head_name: string | null;
  members: Array<{ id: number; name: string; email: string; role: string; finance_access?: number }> | null;
}

export interface Task {
  id: number;
  title: string;
  description: string;
  status: 'todo' | 'in_progress' | 'blocked' | 'done';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  due_date: string | null;
  project_id: number | null;
  department_id: number;
  assigned_to: number | null;
  created_by: number;
  parent_task_id: number | null;
  created_at: string;
  assignee_name?: string;
  creator_name?: string;
  department_name?: string;
  project_name?: string | null;
}

export interface Project {
  id: number;
  name: string;
  description: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
}
