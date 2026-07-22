import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Plus, Crown, UserMinus, Wallet, Pencil, Archive, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
import { api, type Department } from '../api';
import type { PortalUser } from './People';

export default function Departments() {
  const { user } = useAuth();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [newDeptName, setNewDeptName] = useState('');
  const [addingTo, setAddingTo] = useState<Department | null>(null);
  const [unassigned, setUnassigned] = useState<PortalUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [renaming, setRenaming] = useState<Department | null>(null);
  const [removingMember, setRemovingMember] = useState<{ deptId: number; deptName: string; member: { id: number; name: string } } | null>(
    null
  );
  const [renameValue, setRenameValue] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<{ departments: Department[] }>('/departments')
      .then((r) => setDepartments(r.departments))
      .catch((e) => toast.error(e.message));
    // Assignment pool: active, non-CEO users without a department.
    api<{ users: PortalUser[] }>('/users')
      .then((r) => setUnassigned(r.users.filter((u) => u.active && !u.is_ceo && u.department_id == null)))
      .catch(() => {}); // non-CEO viewers can't list users; they also can't assign
  }, []);
  useEffect(load, [load]);

  // Every mutation below shares one busy flag — the dialogs and buttons
  // that trigger them are disabled while it's true, so a double-click
  // can't fire the same request twice.
  const createDept = async () => {
    if (!newDeptName.trim() || busy) return;
    setBusy(true);
    try {
      await api('/departments', { method: 'POST', body: { name: newDeptName } });
      setNewDeptName('');
      load();
      toast.success('Department created');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const addMember = async () => {
    if (!addingTo || !selectedUserId || busy) return;
    setBusy(true);
    try {
      await api(`/departments/${addingTo.id}/members`, { method: 'POST', body: { userId: Number(selectedUserId) } });
      toast.success('Member assigned');
      setAddingTo(null);
      setSelectedUserId('');
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const assignHead = async (deptId: number, userId: number) => {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/departments/${deptId}/head`, { method: 'POST', body: { userId } });
      load();
      toast.success('Department head assigned');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const toggleFinance = async (userId: number, grant: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/users/${userId}/finance-access`, { method: 'POST', body: { grant } });
      load();
      toast.success(grant ? 'Finance access granted' : 'Finance access revoked');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const confirmRemoveMember = async () => {
    if (!removingMember || busy) return;
    setBusy(true);
    try {
      await api(`/departments/${removingMember.deptId}/members/${removingMember.member.id}`, { method: 'DELETE' });
      toast.success(`${removingMember.member.name} removed from ${removingMember.deptName}`);
      setRemovingMember(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const renameDept = async () => {
    if (!renaming || !renameValue.trim() || busy) return;
    setBusy(true);
    try {
      await api(`/departments/${renaming.id}`, { method: 'PATCH', body: { name: renameValue } });
      toast.success('Department renamed');
      setRenaming(null);
      setRenameValue('');
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const archiveDept = async (dept: Department) => {
    if (busy || !confirm(`Archive "${dept.name}"? This can't be undone from here.`)) return;
    setBusy(true);
    try {
      await api(`/departments/${dept.id}`, { method: 'PATCH', body: { archive: true } });
      toast.success('Department archived');
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-8">
        <h1 className="ptitle font-display font-bold text-2xl">Departments</h1>
        {user?.isCeo && (
          <div className="flex gap-2">
            <Input
              placeholder="New department name *"
              value={newDeptName}
              onChange={(e) => setNewDeptName(e.target.value)}
              className="w-56"
              onKeyDown={(e) => e.key === 'Enter' && createDept()}
            />
            <Button
              onClick={createDept}
              disabled={!newDeptName.trim() || busy}
              className="bg-[#DFE104] text-black hover:bg-[#c9cb04] disabled:opacity-50"
            >
              <Plus size={15} className="mr-1" /> Create
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-6 stagger">
        {departments.map((d) => (
          <div key={d.id} className="pcard pcard-hover">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#1f1f23]">
              <div className="flex items-center gap-3">
                <span className="font-medium">{d.name}</span>
                {d.head_name && (
                  <Badge variant="outline" className="text-xs">
                    <Crown size={11} className="mr-1 text-[#DFE104]" /> {d.head_name}
                  </Badge>
                )}
              </div>
              {user?.isCeo && (
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    title="Rename department"
                    onClick={() => {
                      setRenaming(d);
                      setRenameValue(d.name);
                    }}
                    className="text-[#A1A1AA] hover:text-[#FAFAFA]"
                  >
                    <Pencil size={13} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    title="Archive department"
                    onClick={() => archiveDept(d)}
                    className="text-[#A1A1AA] hover:text-[#FAFAFA]"
                  >
                    <Archive size={13} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setAddingTo(d)}
                    className="text-[#A1A1AA] hover:text-[#FAFAFA]"
                  >
                    <Plus size={14} className="mr-1" /> Add member
                  </Button>
                </div>
              )}
            </div>
            {d.members ? (
              <ul>
                {d.members.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center justify-between px-4 py-2 text-sm border-b border-[#141417] last:border-0"
                  >
                    <div>
                      <span>{m.name}</span>
                      <span className="text-[#71717A] ml-2">{m.email}</span>
                      {m.role === 'head' && <span className="text-[#DFE104] ml-2 text-xs">HEAD</span>}
                      {m.finance_access ? (
                        <span className="text-emerald-400 ml-2 text-xs">FINANCE</span>
                      ) : null}
                    </div>
                    {user?.isCeo && (
                      <div className="flex gap-1">
                        {m.role !== 'head' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Make head"
                            onClick={() => assignHead(d.id, m.id)}
                          >
                            <Crown size={13} />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          title={m.finance_access ? 'Revoke finance access' : 'Grant finance access'}
                          className={m.finance_access ? 'text-emerald-400' : ''}
                          onClick={() => toggleFinance(m.id, !m.finance_access)}
                        >
                          <Wallet size={13} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Remove from department"
                          onClick={() => setRemovingMember({ deptId: d.id, deptName: d.name, member: { id: m.id, name: m.name } })}
                        >
                          <UserMinus size={13} />
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
                {d.members.length === 0 && (
                  <li className="px-4 py-3 text-sm text-[#71717A]">No members yet.</li>
                )}
              </ul>
            ) : (
              <div className="px-4 py-3 text-sm text-[#71717A]">
                Other department — members not visible to you.
              </div>
            )}
          </div>
        ))}
        {departments.length === 0 && <p className="text-sm text-[#71717A]">No departments yet.</p>}
      </div>

      <Dialog open={!!addingTo} onOpenChange={(o) => !o && setAddingTo(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader className="flex-row items-center gap-3 space-y-0">
            <span className="dialog-icon-badge">
              <UserPlus size={16} />
            </span>
            <DialogTitle>Assign member to {addingTo?.name}</DialogTitle>
          </DialogHeader>
          {unassigned.length === 0 ? (
            <p className="text-sm text-[#A1A1AA]">
              No unassigned users available. Create one in the{' '}
              <Link to="/portal/people" className="text-[#DFE104] hover:underline">
                People
              </Link>{' '}
              section first.
            </p>
          ) : (
            <div className="space-y-1.5">
              <Label>Unassigned user</Label>
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a user" />
                </SelectTrigger>
                <SelectContent>
                  {unassigned.map((u) => (
                    <SelectItem key={u.id} value={String(u.id)}>
                      {u.name} ({u.email})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <DialogFooter>
            <Button
              onClick={addMember}
              disabled={!selectedUserId || busy}
              className="bg-[#DFE104] text-black hover:bg-[#c9cb04]"
            >
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader className="flex-row items-center gap-3 space-y-0">
            <span className="dialog-icon-badge">
              <Pencil size={16} />
            </span>
            <DialogTitle>Rename department</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Name <span className="text-red-500">*</span></Label>
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && renameDept()}
            />
          </div>
          <DialogFooter>
            <Button
              onClick={renameDept}
              disabled={!renameValue.trim() || busy}
              className="bg-[#DFE104] text-black hover:bg-[#c9cb04] disabled:opacity-50"
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!removingMember} onOpenChange={(o) => !o && setRemovingMember(null)}>
        <AlertDialogContent>
          <AlertDialogHeader className="flex-row items-center gap-3 space-y-0">
            <span className="dialog-icon-badge destructive">
              <UserMinus size={16} />
            </span>
            <AlertDialogTitle>
              Remove {removingMember?.member.name} from {removingMember?.deptName}?
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription>
            They lose access to this department's tasks and projects. They can be reassigned here later.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRemoveMember} className="bg-red-600 text-white hover:bg-red-700">
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
