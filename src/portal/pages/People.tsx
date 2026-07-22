import { useCallback, useEffect, useState } from 'react';
import { Plus, KeyRound, UserX, UserCheck, Wallet, UserPlus, Trash2 } from 'lucide-react';
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
  deleted_at: string | null;
  department_id: number | null;
  department_name: string | null;
  role: string | null;
}

export default function People() {
  const [users, setUsers] = useState<PortalUser[]>([]);
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<PortalUser | null>(null);
  const [deactivating, setDeactivating] = useState<PortalUser | null>(null);
  const [deleting, setDeleting] = useState<PortalUser | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
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
    // Deactivation ends their session, drops department membership, and
    // bubbles up any direct reports server-side — too consequential for a
    // single click. Reactivation is safe and fully reversible, so it stays
    // instant.
    if (!active) {
      setDeactivating(u);
      return;
    }
    try {
      await api(`/users/${u.id}/active`, { method: 'POST', body: { active } });
      toast.success(`${u.name} reactivated`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  const confirmDeactivate = async () => {
    if (!deactivating) return;
    try {
      await api(`/users/${deactivating.id}/active`, { method: 'POST', body: { active: false } });
      toast.success(`${deactivating.name} deactivated — their session is now invalid`);
      setDeactivating(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  const confirmPermanentDelete = async () => {
    if (!deleting || deleteConfirmText !== deleting.name) return;
    try {
      await api(`/users/${deleting.id}/permanent-delete`, { method: 'POST' });
      toast.success(`${deleting.name}'s account has been permanently deleted`);
      setDeleting(null);
      setDeleteConfirmText('');
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
                {u.deleted_at ? (
                  <Badge variant="outline" className="text-xs text-[#71717A] border-[#3a3a40]">
                    Deleted
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className={`text-xs ${u.active ? 'text-emerald-400 border-emerald-900' : 'text-red-400 border-red-900'}`}
                  >
                    {u.active ? 'Active' : 'Deactivated'}
                  </Badge>
                )}
                {u.active && u.must_change_password ? (
                  <Badge variant="outline" className="text-xs ml-1 text-[#DFE104] border-[#555]">
                    Temp password
                  </Badge>
                ) : null}
              </TableCell>
              <TableCell className="text-right">
                {!u.is_ceo && !u.deleted_at && (
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
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Reactivate"
                          className="text-emerald-400"
                          onClick={() => setActive(u, true)}
                        >
                          <UserCheck size={13} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Delete permanently — cannot be undone"
                          className="text-red-500"
                          onClick={() => setDeleting(u)}
                        >
                          <Trash2 size={13} />
                        </Button>
                      </>
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

      <AlertDialog open={!!deactivating} onOpenChange={(o) => !o && setDeactivating(null)}>
        <AlertDialogContent>
          <AlertDialogHeader className="flex-row items-center gap-3 space-y-0">
            <span className="dialog-icon-badge destructive">
              <UserX size={16} />
            </span>
            <AlertDialogTitle>Deactivate {deactivating?.name}?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm">
              <p>
                Their session ends immediately and they can no longer sign in. Nothing is deleted — tasks,
                attendance, and salary history are all kept, and they can be reactivated later.
              </p>
              <p>Any direct reports move up to report to their manager automatically.</p>
              <p className="text-[#71717A]">Blocked if they still have open tasks — reassign those first.</p>
            </div>
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeactivate} className="bg-red-600 text-white hover:bg-red-700">
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!deleting}
        onOpenChange={(o) => {
          if (!o) {
            setDeleting(null);
            setDeleteConfirmText('');
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader className="flex-row items-center gap-3 space-y-0">
            <span className="dialog-icon-badge destructive">
              <Trash2 size={16} />
            </span>
            <AlertDialogTitle>Permanently delete {deleting?.name}?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm">
              <p>
                This is irreversible. Their name, email, and login are erased forever — they can never sign in
                again and this cannot be undone, even by re-creating an account with the same email.
              </p>
              <p className="text-[#71717A]">
                Their tasks, attendance, finance entries, and salary history stay in the system for audit and
                payroll purposes, attributed to "Deleted User" instead of their name.
              </p>
              <div className="space-y-1.5 pt-1">
                <Label className="text-xs">
                  Type <span className="text-[#FAFAFA] font-medium">{deleting?.name}</span> to confirm
                </Label>
                <Input
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  autoComplete="off"
                />
              </div>
            </div>
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmPermanentDelete}
              disabled={deleteConfirmText !== deleting?.name}
              className="bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:pointer-events-none"
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
