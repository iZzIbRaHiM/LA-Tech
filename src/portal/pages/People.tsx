import { useCallback, useEffect, useState } from 'react';
import { Plus, KeyRound, UserX, UserCheck, Wallet, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { api, type Department } from '../api';

export interface PortalUser {
  id: number;
  name: string;
  email: string;
  is_ceo: number;
  finance_access: number;
  active: number;
  must_change_password: number;
  department_id: number | null;
  department_name: string | null;
  role: string | null;
}

export default function People() {
  const [users, setUsers] = useState<PortalUser[]>([]);
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<PortalUser | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [form, setForm] = useState({ name: '', email: '', password: '', title: '', departmentId: '' });
  const [resetPw, setResetPw] = useState('');

  const passwordPolicyOk = (pw: string) =>
    pw.length >= 10 && /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw);

  const canCreateUser = form.name.trim() !== '' && form.email.trim() !== '' && passwordPolicyOk(form.password);
  const canResetPassword = passwordPolicyOk(resetPw);

  const load = useCallback(() => {
    api<{ users: PortalUser[] }>('/users').then((r) => setUsers(r.users)).catch((e) => toast.error(e.message));
  }, []);
  useEffect(load, [load]);

  const openCreate = () => {
    setForm({ name: '', email: '', password: '', title: '', departmentId: '' });
    setCreating(true);
    api<{ departments: Department[] }>('/departments').then((r) => setDepartments(r.departments)).catch(() => {});
  };

  const createUser = async () => {
    if (!canCreateUser) return;
    try {
      await api('/users', {
        method: 'POST',
        body: {
          name: form.name,
          email: form.email,
          password: form.password,
          title: form.title,
          departmentId: form.departmentId ? Number(form.departmentId) : undefined,
        },
      });
      toast.success(
        `${form.name} created — temp password: ${form.password}. Share it once; they'll be asked to change it.`
      );
      setCreating(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  const resetPassword = async () => {
    if (!resetting || !canResetPassword) return;
    try {
      await api(`/users/${resetting.id}/reset-password`, { method: 'POST', body: { password: resetPw } });
      toast.success(`Password reset for ${resetting.name} — new temp password: ${resetPw}`);
      setResetting(null);
      setResetPw('');
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  const setActive = async (u: PortalUser, active: boolean) => {
    try {
      await api(`/users/${u.id}/active`, { method: 'POST', body: { active } });
      toast.success(active ? `${u.name} reactivated` : `${u.name} deactivated — their session is now invalid`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  const toggleFinance = async (u: PortalUser) => {
    try {
      await api(`/users/${u.id}/finance-access`, { method: 'POST', body: { grant: !u.finance_access } });
      toast.success(u.finance_access ? 'Finance access revoked' : 'Finance access granted');
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-2">
        <h1 className="ptitle font-display font-bold text-2xl">People</h1>
        <Button onClick={openCreate} className="bg-[#DFE104] text-black hover:bg-[#c9cb04]">
          <Plus size={15} className="mr-1" /> New user
        </Button>
      </div>
      <p className="text-sm text-[#A1A1AA] mb-8">
        Create accounts here, then assign them to a department from the Departments page.
      </p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Department</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((u) => (
            <TableRow key={u.id} className={u.active ? '' : 'opacity-50'}>
              <TableCell>
                {u.name}
                {u.is_ceo ? <span className="text-[#DFE104] ml-2 text-xs">CEO</span> : null}
                {u.role === 'head' ? <span className="text-[#DFE104] ml-2 text-xs">HEAD</span> : null}
                {u.finance_access ? <span className="text-emerald-400 ml-2 text-xs">FINANCE</span> : null}
              </TableCell>
              <TableCell className="text-[#A1A1AA]">{u.email}</TableCell>
              <TableCell className="text-[#A1A1AA]">{u.department_name ?? 'Unassigned'}</TableCell>
              <TableCell>
                <Badge
                  variant="outline"
                  className={`text-xs ${u.active ? 'text-emerald-400 border-emerald-900' : 'text-red-400 border-red-900'}`}
                >
                  {u.active ? 'Active' : 'Deactivated'}
                </Badge>
                {u.active && u.must_change_password ? (
                  <Badge variant="outline" className="text-xs ml-1 text-[#DFE104] border-[#555]">
                    Temp password
                  </Badge>
                ) : null}
              </TableCell>
              <TableCell className="text-right">
                {!u.is_ceo && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      title={u.finance_access ? 'Revoke finance access' : 'Grant finance access'}
                      className={u.finance_access ? 'text-emerald-400' : ''}
                      onClick={() => toggleFinance(u)}
                    >
                      <Wallet size={13} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Reset password"
                      onClick={() => setResetting(u)}
                      disabled={!u.active}
                    >
                      <KeyRound size={13} />
                    </Button>
                    {u.active ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Deactivate (removes department membership, ends session)"
                        className="text-red-400"
                        onClick={() => setActive(u, false)}
                      >
                        <UserX size={13} />
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Reactivate"
                        className="text-emerald-400"
                        onClick={() => setActive(u, true)}
                      >
                        <UserCheck size={13} />
                      </Button>
                    )}
                  </>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {users.length === 0 && <p className="text-sm text-[#71717A] mt-4">No users yet.</p>}

      {/* Create user */}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-sm">
          <DialogHeader className="flex-row items-center gap-3 space-y-0">
            <span className="dialog-icon-badge">
              <UserPlus size={16} />
            </span>
            <div>
              <DialogTitle>New user</DialogTitle>
              <DialogDescription className="mt-0.5">Issues a temporary password on creation.</DialogDescription>
            </div>
          </DialogHeader>
          <div className="space-y-3 stagger">
            <div className="space-y-1.5">
              <Label>Full name <span className="text-red-500">*</span></Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Email <span className="text-red-500">*</span></Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Role / title</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Frontend Developer" />
            </div>
            <div className="space-y-1.5">
              <Label>Department (optional)</Label>
              <Select value={form.departmentId} onValueChange={(v) => setForm({ ...form, departmentId: v === '0' ? '' : v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Unassigned</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Temporary password <span className="text-red-500">*</span> (shown once)</Label>
              <Input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              <p className="text-xs text-[#71717A]">
                10+ characters, with uppercase, lowercase, a number, and a special character.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={createUser}
              disabled={!canCreateUser}
              className="bg-[#DFE104] text-black hover:bg-[#c9cb04] disabled:opacity-50"
            >
              Create user
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset password */}
      <Dialog open={!!resetting} onOpenChange={(o) => !o && setResetting(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader className="flex-row items-center gap-3 space-y-0">
            <span className="dialog-icon-badge">
              <KeyRound size={16} />
            </span>
            <DialogTitle>Reset password for {resetting?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>New temporary password <span className="text-red-500">*</span></Label>
            <Input value={resetPw} onChange={(e) => setResetPw(e.target.value)} />
            <p className="text-xs text-[#71717A]">
              10+ characters, with uppercase, lowercase, a number, and a special character.
            </p>
          </div>
          <DialogFooter>
            <Button
              onClick={resetPassword}
              disabled={!canResetPassword}
              className="bg-[#DFE104] text-black hover:bg-[#c9cb04] disabled:opacity-50"
            >
              Reset password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
