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

// A plain <a href="/api/..."> for authenticated downloads works when it
// succeeds, but on failure (expired session, permission denied, missing
// file) the browser just renders/downloads the raw JSON error body with no
// feedback. Fetching it ourselves lets us surface a real error via toast.
export async function downloadFile(path: string, filename: string): Promise<void> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: { 'X-Requested-With': 'latech-portal' },
  });
  if (!res.ok) {
    let message = `Download failed (${res.status})`;
    try {
      const j = await res.json();
      if (j?.error) message = j.error;
    } catch {
      /* keep default */
    }
    throw new ApiError(res.status, message);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  isCeo: boolean;
  financeAccess: boolean;
  mustChangePassword: boolean;
  departmentId: number | null;
  role: 'ceo' | 'head' | 'member' | 'intern' | 'unassigned';
}

// One row per employee, as returned by GET /org-tree — flat, edges implied
// by manager_id. See src/portal/pages/OrgChart.tsx for tree assembly.
export interface OrgNode {
  id: number;
  name: string;
  email: string;
  title: string;
  phone: string;
  manager_id: number | null;
  is_ceo: number;
  finance_access: number;
  active: number;
  online: boolean;
  department_id: number | null;
  department_name: string | null;
  membership_role: 'head' | 'member' | 'intern' | null;
  direct_reports_count: number;
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

export interface Meeting {
  id: number;
  title: string;
  created_by: number;
  creator_name: string;
  ended_at: string | null;
  created_at: string;
  in_room_count: number;
}

export interface WorkSchedule {
  id: number;
  name: string;
  office_start_time: string;
  office_end_time: string;
  late_threshold_minutes: number;
  half_day_threshold_minutes: number;
}

export interface ScheduleAssignment {
  schedule_id: number;
  target_type: 'department' | 'user';
  target_id: number;
  target_name: string | null;
}

export interface ResolvedSchedule {
  office_start_time: string;
  office_end_time: string;
  late_threshold_minutes: number;
  half_day_threshold_minutes: number;
  schedule_name: string | null;
}
