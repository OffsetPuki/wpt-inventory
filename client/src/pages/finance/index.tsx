import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { formatMoney } from "@/lib/format";
import Header from "@/components/Header";
import { cn } from "@/lib/utils";
import { Loader2, Receipt, Users } from "lucide-react";
import {
  EXPENSE_CATEGORY_LABELS,
  type ExpenseCategory,
} from "@shared/finance-schema";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";

// ─── API shapes ───────────────────────────────────────────────────────────────

interface FinanceStats {
  outstandingCents: number;
  overdueCents: number;
  paidThisMonthCents: number;
  expensesThisMonthCents: number;
  netThisMonthCents: number;
  draftInvoices: number;
  enabledGateways: number;
}

interface MonthlyRow {
  month: string; // "YYYY-MM"
  incomeCents: number;
  expenseCents: number;
  netCents: number;
}

interface ArAging {
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90plus: number;
}

interface FinanceReports {
  monthly: MonthlyRow[];
  expenseByCategory: { category: string; amountCents: number }[];
  arAging: ArAging;
  topClients: { clientName: string; revenueCents: number }[];
}

// ─── Small pieces ─────────────────────────────────────────────────────────────

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map((v) => parseInt(v, 10));
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short" });
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "red" | "green";
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums text-foreground",
          tone === "red" && "text-red-600 dark:text-red-400",
          tone === "green" && "text-emerald-600 dark:text-emerald-400"
        )}
      >
        {value}
      </p>
    </div>
  );
}

const AGING_BUCKETS: {
  key: keyof ArAging;
  label: string;
  bg: string;
  amount: string;
}[] = [
  { key: "current", label: "Current", bg: "bg-card", amount: "text-foreground" },
  {
    key: "d1_30",
    label: "1–30 days",
    bg: "bg-red-500/5",
    amount: "text-red-600/80 dark:text-red-400/80",
  },
  {
    key: "d31_60",
    label: "31–60 days",
    bg: "bg-red-500/10",
    amount: "text-red-600 dark:text-red-400",
  },
  {
    key: "d61_90",
    label: "61–90 days",
    bg: "bg-red-500/15",
    amount: "text-red-700 dark:text-red-400",
  },
  {
    key: "d90plus",
    label: "90+ days",
    bg: "bg-red-500/20",
    amount: "text-red-700 dark:text-red-300",
  },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FinanceOverviewPage() {
  const { data: stats, isLoading: statsLoading } = useQuery<FinanceStats>({
    queryKey: ["finance-stats"],
    queryFn: async () => (await apiRequest("GET", "/api/finance/stats")).json(),
  });

  const { data: reports, isLoading: reportsLoading } = useQuery<FinanceReports>({
    queryKey: ["finance-reports"],
    queryFn: async () => (await apiRequest("GET", "/api/finance/reports")).json(),
  });

  if (statsLoading || reportsLoading) {
    return (
      <div className="mx-auto max-w-6xl">
        <Header title="Finance" description="Accounting overview" />
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </div>
    );
  }

  const chartData = (reports?.monthly ?? []).map((m) => ({
    ...m,
    label: monthLabel(m.month),
  }));
  const categories = reports?.expenseByCategory ?? [];
  const maxCategory = Math.max(...categories.map((c) => c.amountCents), 1);
  const topClients = reports?.topClients ?? [];

  return (
    <div className="mx-auto max-w-6xl">
      <Header title="Finance" description="Accounting overview" />

      {/* KPI row */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label="Outstanding" value={formatMoney(stats?.outstandingCents)} />
        <Kpi
          label="Overdue"
          value={formatMoney(stats?.overdueCents)}
          tone={(stats?.overdueCents ?? 0) > 0 ? "red" : undefined}
        />
        <Kpi label="Paid this month" value={formatMoney(stats?.paidThisMonthCents)} />
        <Kpi
          label="Expenses this month"
          value={formatMoney(stats?.expensesThisMonthCents)}
        />
        <Kpi
          label="Net this month"
          value={formatMoney(stats?.netThisMonthCents)}
          tone={
            (stats?.netThisMonthCents ?? 0) > 0
              ? "green"
              : (stats?.netThisMonthCents ?? 0) < 0
                ? "red"
                : undefined
          }
        />
      </div>

      {/* Income vs expenses */}
      <div className="mt-6 rounded-xl border border-border bg-card p-5">
        <h2 className="mb-4 font-semibold text-foreground">
          Income vs expenses{" "}
          <span className="font-normal text-muted-foreground">— last 12 months</span>
        </h2>
        <div className="h-60">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} barGap={2}>
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={56}
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                tickFormatter={(v: number) =>
                  `$${Math.round(v / 100).toLocaleString("en-US")}`
                }
              />
              <Tooltip
                cursor={{ fill: "hsl(var(--muted))", opacity: 0.35 }}
                contentStyle={{
                  backgroundColor: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "0.5rem",
                  color: "hsl(var(--foreground))",
                }}
                formatter={(value: any, name: any) => [
                  formatMoney(Number(value)),
                  name,
                ]}
              />
              <Bar
                dataKey="incomeCents"
                name="Income"
                fill="hsl(var(--primary))"
                radius={[3, 3, 0, 0]}
              />
              <Bar
                dataKey="expenseCents"
                name="Expenses"
                fill="hsl(0 72% 51%)"
                fillOpacity={0.45}
                radius={[3, 3, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* AR aging */}
      <div className="mt-6">
        <h2 className="mb-3 font-semibold text-foreground">Accounts receivable aging</h2>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {AGING_BUCKETS.map((b) => (
            <div
              key={b.key}
              className={cn("rounded-xl border border-border p-4", b.bg)}
            >
              <p className="text-sm text-muted-foreground">{b.label}</p>
              <p className={cn("mt-1 text-2xl font-semibold tabular-nums", b.amount)}>
                {formatMoney(reports?.arAging?.[b.key])}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Expense breakdown + top clients */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-4 font-semibold text-foreground">
            Expenses by category{" "}
            <span className="font-normal text-muted-foreground">— last 12 months</span>
          </h2>
          {categories.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
              <Receipt className="h-10 w-10" />
              <p>No expenses recorded yet</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {categories.map((c) => (
                <div key={c.category}>
                  <div className="mb-1 flex items-baseline justify-between text-sm">
                    <span className="text-foreground">
                      {EXPENSE_CATEGORY_LABELS[c.category as ExpenseCategory] ??
                        c.category}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {formatMoney(c.amountCents)}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-muted">
                    <div
                      className="h-2 rounded-full bg-primary"
                      style={{
                        width: `${Math.max(2, (c.amountCents / maxCategory) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-4 font-semibold text-foreground">
            Top clients{" "}
            <span className="font-normal text-muted-foreground">— by payments received</span>
          </h2>
          {topClients.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
              <Users className="h-10 w-10" />
              <p>No payments received yet</p>
            </div>
          ) : (
            <ol className="divide-y divide-border">
              {topClients.map((c, i) => (
                <li key={c.clientName} className="flex items-center gap-3 py-3">
                  <span className="w-6 text-sm tabular-nums text-muted-foreground">
                    {i + 1}.
                  </span>
                  <span className="flex-1 truncate font-medium text-foreground">
                    {c.clientName}
                  </span>
                  <span className="tabular-nums text-foreground">
                    {formatMoney(c.revenueCents)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
