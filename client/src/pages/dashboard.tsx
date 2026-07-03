import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { apiRequest } from "@/lib/queryClient";
import { formatMoney, formatPercent, formatHours, formatDate } from "@/lib/format";
import Header from "@/components/Header";
import StatCard, { type Trend } from "@/components/StatCard";
import { AlertTriangle, ArrowRight, Clock4, Loader2 } from "lucide-react";

// ─── Per-module stats shapes (contracts implemented by each server module) ───

interface CrmStats {
  openLeads: number;
  leadsThisWeek: number;
  pipelineValueCents: number;
  quotesSentLast30: number;
  closeRate: number | null;
  revenueClosed30dCents: number;
  topSource: { source: string; count: number } | null;
}

interface CrmReports {
  monthlyRevenue: { month: string; revenueCents: number }[];
  monthlyLeads: { month: string; count: number }[];
}

interface MarketingStats {
  leadsThisWeek: number;
  cplCents30d: number | null;
  activeCampaigns: number;
  openTasks: number;
  overdueTasks: number;
  avgRating30d: number | null;
  unrespondedReviews: number;
  alerts: string[];
}

interface HrStats {
  activeEmployees: number;
  clockedInNow: number;
  pendingLeave: number;
  openPositions: number;
  candidatesInPipeline: number;
  nextPayDate: string | null;
}

interface PmStats {
  openTasks: number;
  inProgress: number;
  overdueTasks: number;
  hoursThisWeekMin: number;
  activeContractsValueCents: number;
  kbCount: number;
  doneTasks: number;
}

interface FinanceStats {
  outstandingCents: number;
  overdueCents: number;
  paidThisMonthCents: number;
  expensesThisMonthCents: number;
  netThisMonthCents: number;
  draftInvoices: number;
  enabledGateways: number;
}

interface FinanceReports {
  monthly: { month: string; incomeCents: number; expenseCents: number; netCents: number }[];
}

interface InventoryStats {
  totalItems: number;
  lowStock: number;
  activeProjects: number;
  checkouts7d: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function useStats<T>(key: string, url: string) {
  return useQuery<T>({
    queryKey: [key],
    queryFn: async () => (await apiRequest("GET", url)).json(),
    retry: false,
  });
}

// Month-over-month trend from a monthly series (…, prev, current). Null when
// there's no meaningful previous value to compare against.
function momTrend(series: number[] | undefined, goodWhenUp = true): Trend | null {
  if (!series || series.length < 2) return null;
  const cur = series[series.length - 1];
  const prev = series[series.length - 2];
  if (!prev) return null;
  return { pct: (cur - prev) / prev, goodWhenUp };
}

function Section({
  title,
  href,
  isLoading,
  cols = 6,
  children,
}: {
  title: string;
  href: string;
  isLoading?: boolean;
  cols?: 3 | 4 | 5 | 6;
  children: React.ReactNode;
}) {
  const colCls = {
    3: "sm:grid-cols-3",
    4: "sm:grid-cols-2 lg:grid-cols-4",
    5: "sm:grid-cols-3 lg:grid-cols-5",
    6: "sm:grid-cols-3 lg:grid-cols-6",
  }[cols];
  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
        <Link
          href={href}
          className="flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          Open <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      {isLoading ? (
        <div className="flex justify-center rounded-2xl border border-border bg-card py-8 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <div className={`grid grid-cols-2 gap-3 ${colCls}`}>{children}</div>
      )}
    </section>
  );
}

// Donezo-style completion ring — pure SVG, no dependency.
function ProgressRing({ pct }: { pct: number }) {
  const r = 40;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, pct));
  return (
    <svg viewBox="0 0 100 100" className="h-28 w-28">
      <circle cx="50" cy="50" r={r} fill="none" strokeWidth="10" className="stroke-muted" />
      <circle
        cx="50"
        cy="50"
        r={r}
        fill="none"
        strokeWidth="10"
        strokeLinecap="round"
        className="stroke-primary"
        strokeDasharray={`${c * clamped} ${c}`}
        transform="rotate(-90 50 50)"
      />
      <text
        x="50"
        y="55"
        textAnchor="middle"
        className="fill-foreground text-[20px] font-bold"
      >
        {Math.round(clamped * 100)}%
      </text>
    </svg>
  );
}

const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString("en-US", { month: "short" });
};

// ─── Page ────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const crm = useStats<CrmStats>("crm-stats", "/api/crm/stats");
  const crmReports = useStats<CrmReports>("crm-reports", "/api/crm/reports");
  const mk = useStats<MarketingStats>("marketing-stats", "/api/marketing/stats");
  const hr = useStats<HrStats>("hr-stats", "/api/hr/stats");
  const pm = useStats<PmStats>("pm-stats", "/api/pm/stats");
  const fin = useStats<FinanceStats>("finance-stats", "/api/finance/stats");
  const finReports = useStats<FinanceReports>("finance-reports", "/api/finance/reports");
  const inv = useStats<InventoryStats>("stats", "/api/stats");

  const alerts = mk.data?.alerts ?? [];
  const monthly = finReports.data?.monthly ?? [];
  const incomeTrend = momTrend(monthly.map((m) => m.incomeCents));
  const expenseTrend = momTrend(monthly.map((m) => m.expenseCents), false);
  const leadSeries = crmReports.data?.monthlyLeads?.map((m) => m.count);
  const leadTrend = momTrend(leadSeries);
  const leadsThisMonth = leadSeries?.length ? leadSeries[leadSeries.length - 1] : undefined;

  const chartData = monthly.slice(-6).map((m) => ({
    name: monthLabel(m.month),
    income: m.incomeCents / 100,
    expenses: m.expenseCents / 100,
  }));

  const taskTotal = (pm.data?.openTasks ?? 0) + (pm.data?.doneTasks ?? 0);
  const donePct = taskTotal > 0 ? (pm.data?.doneTasks ?? 0) / taskTotal : 0;

  return (
    <div className="mx-auto max-w-6xl">
      <Header title="Dashboard" description="Your business at a glance" />

      {alerts.length > 0 && (
        <div className="mb-6 flex flex-col gap-2">
          {alerts.map((a, i) => (
            <Link
              key={i}
              href="/marketing"
              className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 transition-colors hover:border-amber-500/60 dark:text-amber-300"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {a}
            </Link>
          ))}
        </div>
      )}

      {/* Hero row — the four numbers that answer "how's business?" */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          filled
          label="Paid this month"
          value={fin.data && formatMoney(fin.data.paidThisMonthCents)}
          trend={incomeTrend}
          href="/finance"
        />
        <StatCard
          label="Outstanding"
          value={fin.data && formatMoney(fin.data.outstandingCents)}
          tone={fin.data && fin.data.overdueCents > 0 ? "warn" : "default"}
          href="/finance/invoices"
        />
        <StatCard
          label="Net this month"
          value={fin.data && formatMoney(fin.data.netThisMonthCents)}
          tone={fin.data ? (fin.data.netThisMonthCents >= 0 ? "good" : "danger") : "default"}
          href="/finance"
        />
        <StatCard
          label="New leads (month)"
          value={leadsThisMonth ?? crm.data?.leadsThisWeek}
          trend={leadTrend}
          href="/crm/leads"
        />
      </div>

      {/* Chart + right-hand tracker column */}
      <div className="mt-6 grid gap-3 lg:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-5 lg:col-span-2">
          <h2 className="text-base font-semibold text-foreground">Income vs expenses</h2>
          <p className="mb-4 text-sm text-muted-foreground">Last 6 months</p>
          {chartData.length === 0 ? (
            <div className="flex h-52 items-center justify-center text-sm text-muted-foreground">
              No financial activity yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={210}>
              <BarChart data={chartData} barGap={4}>
                <XAxis
                  dataKey="name"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                  tickFormatter={(v: number) => `$${v >= 1000 ? `${Math.round(v / 1000)}k` : v}`}
                />
                <Tooltip
                  cursor={{ fill: "hsl(var(--muted) / 0.6)" }}
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 12,
                    color: "hsl(var(--popover-foreground))",
                    fontSize: 13,
                  }}
                  formatter={(v: number, name: string) => [
                    `$${v.toLocaleString()}`,
                    name === "income" ? "Income" : "Expenses",
                  ]}
                />
                <Bar dataKey="income" fill="hsl(var(--chart-1))" radius={[6, 6, 0, 0]} maxBarSize={28} />
                <Bar dataKey="expenses" fill="hsl(var(--chart-4))" radius={[6, 6, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="flex flex-col gap-3">
          {/* Dark contrast card — the Donezo "time tracker" block */}
          <Link
            href="/pm/time"
            className="flex flex-1 flex-col justify-between rounded-2xl bg-zinc-900 p-5 text-white transition-all hover:-translate-y-0.5 hover:shadow-md dark:bg-zinc-950/60 dark:ring-1 dark:ring-border"
          >
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <Clock4 className="h-4 w-4" />
              Hours this week
            </div>
            <p className="mt-2 text-4xl font-bold tabular-nums tracking-tight">
              {pm.data ? formatHours(pm.data.hoursThisWeekMin) : "—"}
            </p>
            <p className="mt-2 text-sm text-zinc-400">
              {hr.data ? `${hr.data.clockedInNow} clocked in right now` : "…"}
            </p>
          </Link>

          {/* Completion ring */}
          <Link
            href="/pm/board"
            className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-primary/50"
          >
            <div>
              <p className="text-base font-semibold text-foreground">Tasks completed</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {pm.data ? `${pm.data.doneTasks} of ${taskTotal} tasks done` : "…"}
              </p>
            </div>
            <ProgressRing pct={donePct} />
          </Link>
        </div>
      </div>

      <Section title="Money" href="/finance" isLoading={fin.isLoading} cols={3}>
        <StatCard
          label="Overdue"
          value={fin.data && formatMoney(fin.data.overdueCents)}
          tone={fin.data && fin.data.overdueCents > 0 ? "danger" : "default"}
          href="/finance/invoices"
        />
        <StatCard
          label="Expenses this month"
          value={fin.data && formatMoney(fin.data.expensesThisMonthCents)}
          trend={expenseTrend}
          href="/finance/expenses"
        />
        <StatCard label="Draft invoices" value={fin.data?.draftInvoices} href="/finance/invoices" />
      </Section>

      <Section title="Sales & Marketing" href="/crm" isLoading={crm.isLoading || mk.isLoading}>
        <StatCard label="Leads this week" value={crm.data?.leadsThisWeek} href="/crm/leads" />
        <StatCard label="Open leads" value={crm.data?.openLeads} href="/crm/leads" />
        <StatCard
          label="Pipeline value"
          value={crm.data && formatMoney(crm.data.pipelineValueCents)}
          href="/crm/deals"
        />
        <StatCard
          label="Close rate"
          value={crm.data && (crm.data.closeRate == null ? "—" : formatPercent(crm.data.closeRate, 0))}
          href="/crm"
        />
        <StatCard
          label="Cost per lead (30d)"
          value={mk.data && (mk.data.cplCents30d == null ? "—" : formatMoney(mk.data.cplCents30d))}
          href="/marketing"
        />
        <StatCard
          label="Marketing tasks due"
          value={mk.data?.overdueTasks}
          tone={mk.data && mk.data.overdueTasks > 0 ? "warn" : "default"}
          href="/marketing"
        />
      </Section>

      <Section title="Work" href="/pm/board" isLoading={pm.isLoading} cols={5}>
        <StatCard label="Open tasks" value={pm.data?.openTasks} href="/pm/board" />
        <StatCard label="In progress" value={pm.data?.inProgress} href="/pm/board" />
        <StatCard
          label="Overdue tasks"
          value={pm.data?.overdueTasks}
          tone={pm.data && pm.data.overdueTasks > 0 ? "warn" : "default"}
          href="/pm/board"
        />
        <StatCard
          label="Active contracts"
          value={pm.data && formatMoney(pm.data.activeContractsValueCents)}
          href="/pm/contracts"
        />
        <StatCard label="KB articles" value={pm.data?.kbCount} href="/pm/kb" />
      </Section>

      <Section title="Team" href="/hr" isLoading={hr.isLoading}>
        <StatCard label="Active employees" value={hr.data?.activeEmployees} href="/hr/employees" />
        <StatCard label="Clocked in now" value={hr.data?.clockedInNow} tone="good" href="/hr/attendance" />
        <StatCard
          label="Pending leave"
          value={hr.data?.pendingLeave}
          tone={hr.data && hr.data.pendingLeave > 0 ? "warn" : "default"}
          href="/hr/leave"
        />
        <StatCard label="Open positions" value={hr.data?.openPositions} href="/hr/recruitment" />
        <StatCard label="Candidates" value={hr.data?.candidatesInPipeline} href="/hr/recruitment" />
        <StatCard
          label="Next pay date"
          value={hr.data && (hr.data.nextPayDate ? formatDate(hr.data.nextPayDate) : "—")}
          href="/hr/payroll"
        />
      </Section>

      <Section title="Inventory" href="/home" isLoading={inv.isLoading} cols={4}>
        <StatCard label="Items" value={inv.data?.totalItems} href="/home" />
        <StatCard
          label="Low stock"
          value={inv.data?.lowStock}
          tone={inv.data && inv.data.lowStock > 0 ? "warn" : "default"}
          href="/home?lowStock=1"
        />
        <StatCard label="Active projects" value={inv.data?.activeProjects} href="/projects" />
        <StatCard label="Checkouts (7d)" value={inv.data?.checkouts7d} href="/activity?filter=check_out" />
      </Section>
    </div>
  );
}
