import { useCallback, useEffect, useState } from 'react';
import { Plus, KeyRound, UserX, UserCheck, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
import { api } from '../api';

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
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [resetPw, setResetPw] = useState('');

  const load = useCallback(() => {
    api<{ users: PortalUser[] }>('/users').then((r) => setUsers(r.users)).catch((e) => toast.error(e.message));
  }, []);
  useEffect(load, [load]);

  const createUser = async () => {
    try {
      await api('/users', { method: 'POST', body: form });
      toast.success(
        `${form.name} created — temp password: ${form.password}. Share it once; they'll be asked to change it.`
      );
      setCreating(false);
      setForm({ name: '', email: '', password: '' });
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  const resetPassword = async () => {
    if (!resetting) return;
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
        <h1 className="font-display font-bold text-2xl">People</h1>
        <Button onClick={() => setCreating(true)} className="bg-[#DFE104] text-black hover:bg-[#c9cb04]">
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
          <DialogHeader>
            <DialogTitle>New user</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Full name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Temporary password (8+ chars — shown once)</Label>
              <Input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={createUser} className="bg-[#DFE104] text-black hover:bg-[#c9cb04]">
              Create user
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset password */}
      <Dialog open={!!resetting} onOpenChange={(o) => !o && setResetting(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reset password for {resetting?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>New temporary password (8+ chars)</Label>
            <Input value={resetPw} onChange={(e) => setResetPw(e.target.value)} />
          </div>
          <DialogFooter>
            <Button onClick={resetPassword} className="bg-[#DFE104] text-black hover:bg-[#c9cb04]">
              Reset password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
