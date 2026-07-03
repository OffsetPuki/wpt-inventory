import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { formatMoney, formatPercent } from "@/lib/format";
import Header from "@/components/Header";
import { Loader2, TrendingUp } from "lucide-react";
import {
  LEAD_STAGES,
  LEAD_STAGE_LABELS,
  LEAD_SOURCE_LABELS,
  WIN_LOSS_REASON_LABELS,
  type LeadStage,
  type LeadSource,
  type WinLossReason,
} from "@shared/crm-schema";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";

interface CrmStats {
  openLeads: number;
  leadsThisWeek: number;
  pipelineValueCents: number;
  quotesSentLast30: number;
  closeRate: number | null;
  revenueClosed30dCents: number;
  topSource: { source: LeadSource; count: number } | null;
}

interface CrmReports {
  monthlyRevenue: { month: string; revenueCents: number }[];
  monthlyLeads: { month: string; count: number }[];
  bySource: { source: LeadSource; leads: number; won: number; revenueCents: number }[];
  byStage: { stage: LeadStage; count: number; valueCents: number }[];
  winLoss: { reason: WinLossReason | null; count: number }[];
}

/** "YYYY-MM" keys for the last 12 months, oldest first. */
function last12Months(): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map((n) => parseInt(n, 10));
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short" });
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="mb-4 text-sm font-medium text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

const tooltipStyle = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  color: "hsl(var(--foreground))",
  fontSize: 13,
};

export default function CrmOverviewPage() {
  const { data: stats, isLoading: statsLoading } = useQuery<CrmStats>({
    queryKey: ["crm-stats"],
    queryFn: async () => (await apiRequest("GET", "/api/crm/stats")).json(),
  });

  const { data: reports, isLoading: reportsLoading } = useQuery<CrmReports>({
    queryKey: ["crm-reports"],
    queryFn: async () => (await apiRequest("GET", "/api/crm/reports")).json(),
  });

  if (statsLoading || reportsLoading) {
    return (
      <div className="mx-auto max-w-6xl">
        <Header title="Sales" description="Pipeline, revenue, and lead performance" />
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </div>
    );
  }

  const revenueData = last12Months().map((ym) => ({
    month: monthLabel(ym),
    revenue: (reports?.monthlyRevenue.find((r) => r.month === ym)?.revenueCents ?? 0) / 100,
  }));

  const sourceData = [...(reports?.bySource ?? [])]
    .sort((a, b) => b.leads - a.leads)
    .map((s) => ({ name: LEAD_SOURCE_LABELS[s.source] ?? s.source, leads: s.leads }));

  const byStage = reports?.byStage ?? [];
  const maxStageCount = Math.max(1, ...byStage.map((s) => s.count));
  const winLoss = reports?.winLoss ?? [];

  return (
    <div className="mx-auto max-w-6xl">
      <Header title="Sales" description="Pipeline, revenue, and lead performance" />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label="Open leads" value={String(stats?.openLeads ?? 0)} />
        <Kpi label="Pipeline value" value={formatMoney(stats?.pipelineValueCents)} />
        <Kpi
          label="Close rate"
          value={stats?.closeRate == null ? "—" : formatPercent(stats.closeRate, 0)}
        />
        <Kpi label="Quotes sent (30d)" value={String(stats?.quotesSentLast30 ?? 0)} />
        <Kpi label="Revenue closed (30d)" value={formatMoney(stats?.revenueClosed30dCents)} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <ChartCard title="Monthly revenue (accepted estimates)">
          {revenueData.every((d) => d.revenue === 0) ? (
            <div className="flex h-[240px] flex-col items-center justify-center gap-2 text-muted-foreground">
              <TrendingUp className="h-8 w-8" />
              <p className="text-sm">No revenue recorded yet</p>
            </div>
          ) : (
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={revenueData} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                  <XAxis
                    dataKey="month"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={56}
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                    tickFormatter={(v: number) => `$${v >= 1000 ? `${Math.round(v / 1000)}k` : v}`}
                  />
                  <Tooltip
                    cursor={{ fill: "hsl(var(--muted))" }}
                    contentStyle={tooltipStyle}
                    formatter={(v) => [formatMoney(Math.round(Number(v) * 100)), "Revenue"]}
                  />
                  <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>

        <ChartCard title="Leads by source">
          {sourceData.length === 0 ? (
            <div className="flex h-[240px] flex-col items-center justify-center gap-2 text-muted-foreground">
              <TrendingUp className="h-8 w-8" />
              <p className="text-sm">No leads yet</p>
            </div>
          ) : (
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={sourceData}
                  layout="vertical"
                  margin={{ top: 4, right: 8, bottom: 0, left: 4 }}
                >
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={110}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                  />
                  <Tooltip cursor={{ fill: "hsl(var(--muted))" }} contentStyle={tooltipStyle} />
                  <Bar dataKey="leads" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>

        <ChartCard title="Funnel by stage">
          {byStage.length === 0 ? (
            <div className="flex h-[200px] flex-col items-center justify-center gap-2 text-muted-foreground">
              <TrendingUp className="h-8 w-8" />
              <p className="text-sm">No leads yet</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {LEAD_STAGES.map((stage) => {
                const row = byStage.find((s) => s.stage === stage);
                const count = row?.count ?? 0;
                return (
                  <div key={stage} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 text-sm text-muted-foreground">
                      {LEAD_STAGE_LABELS[stage]}
                    </span>
                    <div className="h-6 flex-1 overflow-hidden rounded bg-muted">
                      <div
                        className="h-full rounded bg-primary/70"
                        style={{ width: `${(count / maxStageCount) * 100}%` }}
                      />
                    </div>
                    <span className="w-10 shrink-0 text-right text-sm tabular-nums text-foreground">
                      {count}
                    </span>
                    <span className="hidden w-24 shrink-0 text-right text-sm tabular-nums text-muted-foreground sm:block">
                      {formatMoney(row?.valueCents ?? 0)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </ChartCard>

        <ChartCard title="Win / loss reasons (lost leads)">
          {winLoss.length === 0 ? (
            <div className="flex h-[200px] flex-col items-center justify-center gap-2 text-muted-foreground">
              <TrendingUp className="h-8 w-8" />
              <p className="text-sm">No closed leads yet</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {winLoss.map((w, i) => (
                <li key={i} className="flex items-center justify-between py-2.5">
                  <span className="text-sm text-foreground">
                    {w.reason ? WIN_LOSS_REASON_LABELS[w.reason] : "Unknown"}
                  </span>
                  <span className="text-sm font-medium tabular-nums text-foreground">{w.count}</span>
                </li>
              ))}
            </ul>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
