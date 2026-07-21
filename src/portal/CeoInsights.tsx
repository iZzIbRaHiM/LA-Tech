import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  Legend,
} from 'recharts';
import { TrendingUp, TrendingDown, Wallet, DollarSign } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, type Task } from './api';

interface ProjectFinance {
  id: number;
  name: string;
  status: string;
  budget: number;
  expenses: number;
  income: number;
}

interface SalaryPayment {
  id: number;
  period: string;
  net_amount: number;
}

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

const TASK_COLORS: Record<string, string> = {
  todo: '#71717A',
  in_progress: '#60A5FA',
  blocked: '#F87171',
  done: '#34D399',
};

const ATTENDANCE_COLORS: Record<string, string> = {
  on_time: '#34D399',
  late: '#DFE104',
  half_day: '#FB923C',
  absent: '#F87171',
};

// Matches the Card look used everywhere else in the portal, so tooltips
// don't look like a bolted-on default recharts widget.
function ChartTip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color?: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#0c0c0f] border border-[#1f1f23] px-3 py-2 text-xs shadow-xl">
      {label && <div className="text-[#A1A1AA] mb-1">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span className="w-2 h-2 shrink-0" style={{ backgroundColor: p.color }} />
          <span className="text-[#A1A1AA] capitalize">{p.name.replace('_', ' ')}:</span>
          <span className="text-[#FAFAFA] font-medium">{fmt(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

function KpiCard({
  label,
  value,
  icon: Icon,
  glow,
  trend,
}: {
  label: string;
  value: string;
  icon: typeof TrendingUp;
  glow: string;
  trend?: 'up' | 'down';
}) {
  return (
    <Card className="pcard pcard-hover relative overflow-hidden">
      <div className="absolute -top-6 -right-6 w-24 h-24 rounded-full blur-2xl opacity-20" style={{ background: glow }} />
      <CardHeader className="pb-2 relative">
        <CardTitle className="text-sm text-[#A1A1AA] font-normal flex items-center gap-1.5">
          <Icon size={13} /> {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-2xl font-display font-bold relative flex items-center gap-2">
        {value}
        {trend && (trend === 'up' ? <TrendingUp size={16} className="text-emerald-400" /> : <TrendingDown size={16} className="text-red-400" />)}
      </CardContent>
    </Card>
  );
}

export default function CeoInsights() {
  const [perProject, setPerProject] = useState<ProjectFinance[]>([]);
  const [totals, setTotals] = useState({ budget: 0, expenses: 0, income: 0 });
  const [salaryPayments, setSalaryPayments] = useState<SalaryPayment[]>([]);
  const [salaryTotal, setSalaryTotal] = useState(0);
  const [attendanceSummary, setAttendanceSummary] = useState<Array<{ category: string; count: number }>>([]);
  const [allTasks, setAllTasks] = useState<Task[]>([]);

  useEffect(() => {
    api<{ perProject: ProjectFinance[]; totals: typeof totals }>('/finance/overview')
      .then((r) => {
        setPerProject(r.perProject);
        setTotals(r.totals);
      })
      .catch(() => {});
    api<{ payments: SalaryPayment[]; total: number }>('/salary/payments')
      .then((r) => {
        setSalaryPayments(r.payments);
        setSalaryTotal(r.total);
      })
      .catch(() => {});
    api<{ rows: Array<{ category: string; count: number }> }>(
      `/reports/attendance/summary?month=${new Date().toISOString().slice(0, 7)}`
    )
      .then((r) => setAttendanceSummary(r.rows))
      .catch(() => {});
    api<{ tasks: Task[] }>('/tasks').then((r) => setAllTasks(r.tasks)).catch(() => {});
  }, []);

  const netProfit = totals.income - totals.expenses - salaryTotal;
  const totalExpensesWithPayroll = totals.expenses + salaryTotal;

  const revenueChartData = perProject.slice(0, 8).map((p) => ({
    name: p.name.length > 14 ? `${p.name.slice(0, 14)}…` : p.name,
    Budget: p.budget,
    Expenses: p.expenses,
    Income: p.income,
  }));

  const taskStatusData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of allTasks) counts[t.status] = (counts[t.status] ?? 0) + 1;
    return Object.entries(counts).map(([status, count]) => ({ name: status, value: count }));
  }, [allTasks]);

  const attendanceChartData = attendanceSummary.map((r) => ({ name: r.category, value: r.count }));

  const payrollTrend = useMemo(() => {
    const byPeriod = new Map<string, number>();
    for (const p of salaryPayments) byPeriod.set(p.period, (byPeriod.get(p.period) ?? 0) + p.net_amount);
    return [...byPeriod.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, total]) => ({ period, total }));
  }, [salaryPayments]);

  return (
    <div className="mb-12">
      <h2 className="text-sm font-medium text-[#A1A1AA] uppercase tracking-wide mb-3 flex items-center gap-1.5">
        <DollarSign size={13} /> Company overview
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="Net profit"
          value={fmt(netProfit)}
          icon={netProfit >= 0 ? TrendingUp : TrendingDown}
          glow={netProfit >= 0 ? '#34D399' : '#F87171'}
          trend={netProfit >= 0 ? 'up' : 'down'}
        />
        <KpiCard label="Total revenue" value={fmt(totals.income)} icon={TrendingUp} glow="#34D399" />
        <KpiCard label="Total expenses" value={fmt(totalExpensesWithPayroll)} icon={TrendingDown} glow="#F87171" />
        <KpiCard label="Total payroll" value={fmt(salaryTotal)} icon={Wallet} glow="#DFE104" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="pcard pcard-hover">
          <CardHeader>
            <CardTitle className="text-sm text-[#A1A1AA] font-normal">Revenue vs expenses by project</CardTitle>
          </CardHeader>
          <CardContent>
            {revenueChartData.length === 0 ? (
              <p className="text-sm text-[#71717A]">No project finance data yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={revenueChartData} margin={{ left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f1f23" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: '#71717A', fontSize: 11 }} axisLine={{ stroke: '#1f1f23' }} tickLine={false} />
                  <YAxis tick={{ fill: '#71717A', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTip />} cursor={{ fill: '#1f1f2340' }} />
                  <Legend wrapperStyle={{ fontSize: 12, color: '#A1A1AA' }} />
                  <Bar dataKey="Budget" fill="#52525B" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="Expenses" fill="#F87171" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="Income" fill="#34D399" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="pcard pcard-hover">
          <CardHeader>
            <CardTitle className="text-sm text-[#A1A1AA] font-normal">Payroll trend</CardTitle>
          </CardHeader>
          <CardContent>
            {payrollTrend.length === 0 ? (
              <p className="text-sm text-[#71717A]">No salary payments recorded yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={payrollTrend} margin={{ left: -20 }}>
                  <defs>
                    <linearGradient id="payrollGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#DFE104" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#DFE104" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f1f23" vertical={false} />
                  <XAxis dataKey="period" tick={{ fill: '#71717A', fontSize: 11 }} axisLine={{ stroke: '#1f1f23' }} tickLine={false} />
                  <YAxis tick={{ fill: '#71717A', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTip />} cursor={{ stroke: '#DFE104', strokeWidth: 1 }} />
                  <Area type="monotone" dataKey="total" name="Payroll" stroke="#DFE104" fill="url(#payrollGradient)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="pcard pcard-hover">
          <CardHeader>
            <CardTitle className="text-sm text-[#A1A1AA] font-normal">Task status (all departments)</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-center">
            {taskStatusData.length === 0 ? (
              <p className="text-sm text-[#71717A]">No tasks yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={taskStatusData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
                    {taskStatusData.map((d) => (
                      <Cell key={d.name} fill={TASK_COLORS[d.name] ?? '#52525B'} stroke="none" />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTip />} />
                  <Legend
                    wrapperStyle={{ fontSize: 12, color: '#A1A1AA', textTransform: 'capitalize' }}
                    formatter={(v: string) => v.replace('_', ' ')}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="pcard pcard-hover">
          <CardHeader>
            <CardTitle className="text-sm text-[#A1A1AA] font-normal">Attendance this month</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-center">
            {attendanceChartData.length === 0 ? (
              <p className="text-sm text-[#71717A]">No attendance data yet this month.</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={attendanceChartData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
                    {attendanceChartData.map((d) => (
                      <Cell key={d.name} fill={ATTENDANCE_COLORS[d.name] ?? '#52525B'} stroke="none" />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTip />} />
                  <Legend
                    wrapperStyle={{ fontSize: 12, color: '#A1A1AA', textTransform: 'capitalize' }}
                    formatter={(v: string) => v.replace('_', ' ')}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
