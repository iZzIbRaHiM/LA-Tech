import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, Download, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import Attachments from '../Attachments';
import { api, downloadFile } from '../api';

interface ProjectFinance {
  id: number;
  name: string;
  status: string;
  budget: number;
  expenses: number;
  income: number;
}

interface Entry {
  id: number;
  type: 'expense' | 'income' | 'budget';
  amount: number;
  category: string;
  note: string;
  created_by_name: string;
  created_at: string;
}

interface SalaryPayment {
  id: number;
  user_name: string;
  period: string;
  net_amount: number;
}

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

export function FinanceOverview() {
  const { user } = useAuth();
  const [perProject, setPerProject] = useState<ProjectFinance[]>([]);
  const [totals, setTotals] = useState({ budget: 0, expenses: 0, income: 0 });
  const [salaryPayments, setSalaryPayments] = useState<SalaryPayment[]>([]);
  const [salaryTotal, setSalaryTotal] = useState(0);

  useEffect(() => {
    api<{ perProject: ProjectFinance[]; totals: typeof totals }>('/finance/overview')
      .then((r) => {
        setPerProject(r.perProject);
        setTotals(r.totals);
      })
      .catch((e) => toast.error(e.message));
  }, []);

  useEffect(() => {
    // Salary is CEO-only (stricter than finance-delegate access) — never
    // fetched or rendered for a non-CEO finance delegate, even though they
    // can otherwise see this page.
    if (!user?.isCeo) return;
    api<{ payments: SalaryPayment[]; total: number }>('/salary/payments')
      .then((r) => {
        setSalaryPayments(r.payments);
        setSalaryTotal(r.total);
      })
      .catch(() => {});
  }, [user]);

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="ptitle font-display font-bold text-2xl mb-1">Finance</h1>
      <p className="text-sm text-[#A1A1AA] mb-8">
        {user?.isCeo ? 'Visible only to the CEO and finance delegates.' : 'You have finance delegate access.'}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10 stagger">
        {(
          [
            ['Total budget', totals.budget, ''],
            ['Total expenses', totals.expenses, 'text-red-400'],
            ['Total income', totals.income, 'text-emerald-400'],
          ] as const
        ).map(([label, value, cls]) => (
          <Card key={label} className="pcard pcard-hover">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-[#A1A1AA] font-normal">{label}</CardTitle>
            </CardHeader>
            <CardContent className={`text-2xl font-display font-bold ${cls}`}>{fmt(value)}</CardContent>
          </Card>
        ))}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Project</TableHead>
            <TableHead className="text-right">Budget</TableHead>
            <TableHead className="text-right">Expenses</TableHead>
            <TableHead className="text-right">Income</TableHead>
            <TableHead className="text-right">Net</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {perProject.map((p) => (
            <TableRow key={p.id}>
              <TableCell>
                <Link to={`/portal/finance/${p.id}`} className="hover:text-[#DFE104]">
                  {p.name}
                </Link>
              </TableCell>
              <TableCell className="text-right">{fmt(p.budget)}</TableCell>
              <TableCell className="text-right text-red-400">{fmt(p.expenses)}</TableCell>
              <TableCell className="text-right text-emerald-400">{fmt(p.income)}</TableCell>
              <TableCell className={`text-right ${p.income - p.expenses >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {fmt(p.income - p.expenses)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {perProject.length === 0 && <p className="text-sm text-[#71717A] mt-4">No projects yet.</p>}

      {user?.isCeo && (
        <section className="mt-10">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-[#A1A1AA] uppercase tracking-wide">Salary payments</h2>
            <Link to="/portal/salary" className="text-sm text-[#DFE104] hover:underline">
              Manage salaries →
            </Link>
          </div>
          {/* Payroll figures render only for the CEO — this whole section is
              isCeo-gated, so finance delegates never see payroll magnitude
              even though they can see the project totals above. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4 max-w-xl">
            <Card className="pcard pcard-hover">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-[#A1A1AA] font-normal">Total payroll paid (all time)</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-display font-bold">{fmt(salaryTotal)}</CardContent>
            </Card>
            <Card className="pcard pcard-hover">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-[#A1A1AA] font-normal">Net profit (incl. payroll)</CardTitle>
              </CardHeader>
              <CardContent
                className={`text-2xl font-display font-bold ${
                  totals.income - totals.expenses - salaryTotal >= 0 ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                {fmt(totals.income - totals.expenses - salaryTotal)}
              </CardContent>
            </Card>
          </div>
          {salaryPayments.length === 0 ? (
            <p className="text-sm text-[#71717A]">No salary payments recorded yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-right">Net paid</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {salaryPayments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{p.user_name}</TableCell>
                    <TableCell className="text-[#A1A1AA]">{p.period}</TableCell>
                    <TableCell className="text-right">{fmt(p.net_amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      )}
    </div>
  );
}

export function FinanceLedger() {
  const { projectId } = useParams();
  const [name, setName] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [form, setForm] = useState({ type: 'expense', amount: '', category: '', note: '' });

  const load = useCallback(() => {
    api<{ project: { name: string }; entries: Entry[] }>(`/finance/projects/${projectId}`)
      .then((r) => {
        setName(r.project.name);
        setEntries(r.entries);
      })
      .catch((e) => toast.error(e.message));
  }, [projectId]);
  useEffect(load, [load]);

  const canAddEntry = Number.isFinite(Number(form.amount)) && Number(form.amount) > 0;

  const addEntry = async () => {
    if (!canAddEntry) return;
    try {
      await api(`/finance/projects/${projectId}/entries`, {
        method: 'POST',
        body: { type: form.type, amount: Number(form.amount), category: form.category, note: form.note },
      });
      setForm({ type: 'expense', amount: '', category: '', note: '' });
      load();
      toast.success('Entry added');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  const remove = async (id: number) => {
    try {
      await api(`/finance/entries/${id}`, { method: 'DELETE' });
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  const downloadCsv = async () => {
    try {
      await downloadFile(
        `/finance/projects/${projectId}/export.csv`,
        `${name.replace(/[^a-z0-9]/gi, '_')}_finance.csv`
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed');
    }
  };

  return (
    <div className="p-8 max-w-4xl">
      <Link to="/portal/finance" className="text-sm text-[#A1A1AA] hover:text-[#FAFAFA] flex items-center gap-1 mb-4">
        <ArrowLeft size={14} /> Finance
      </Link>
      <div className="flex items-center justify-between mb-8">
        <h1 className="ptitle font-display font-bold text-2xl">{name} — Ledger</h1>
        <Button variant="outline" size="sm" onClick={downloadCsv}>
          <Download size={14} className="mr-1" /> CSV
        </Button>
      </div>

      <div className="flex flex-wrap gap-2 mb-6 items-end">
        <div>
          <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="expense">Expense</SelectItem>
              <SelectItem value="income">Income</SelectItem>
              <SelectItem value="budget">Budget</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Input
          type="number"
          placeholder="Amount *"
          value={form.amount}
          onChange={(e) => setForm({ ...form, amount: e.target.value })}
          className="w-28"
        />
        <Input
          placeholder="Category"
          value={form.category}
          onChange={(e) => setForm({ ...form, category: e.target.value })}
          className="w-36"
        />
        <Input
          placeholder="Note"
          value={form.note}
          onChange={(e) => setForm({ ...form, note: e.target.value })}
          className="flex-1 min-w-40"
        />
        <Button
          onClick={addEntry}
          disabled={!canAddEntry}
          className="bg-[#DFE104] text-black hover:bg-[#c9cb04] disabled:opacity-50"
        >
          <Plus size={14} className="mr-1" /> Add
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Note</TableHead>
            <TableHead>By</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((e) => (
            <TableRow key={e.id}>
              <TableCell className="text-xs text-[#A1A1AA]">{e.created_at}</TableCell>
              <TableCell className="capitalize">{e.type}</TableCell>
              <TableCell
                className={`text-right ${
                  e.type === 'income' ? 'text-emerald-400' : e.type === 'expense' ? 'text-red-400' : ''
                }`}
              >
                {fmt(e.amount)}
              </TableCell>
              <TableCell>{e.category}</TableCell>
              <TableCell className="text-[#A1A1AA]">
                {e.note}
                <Attachments entityType="finance" entityId={e.id} compact />
              </TableCell>
              <TableCell className="text-[#A1A1AA]">{e.created_by_name}</TableCell>
              <TableCell>
                <Button variant="ghost" size="sm" onClick={() => remove(e.id)}>
                  <Trash2 size={13} />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {entries.length === 0 && <p className="text-sm text-[#71717A] mt-4">No entries yet.</p>}
    </div>
  );
}
