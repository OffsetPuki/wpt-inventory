import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { apiRequest } from "@/lib/queryClient";
import type { Category } from "@shared/schema";
import { CATEGORY_LABELS } from "@/lib/format";
import Header from "@/components/Header";
import {
  Package,
  Layers,
  AlertTriangle,
  FolderKanban,
  PlusCircle,
  PackageMinus,
  TrendingDown,
  Loader2,
} from "lucide-react";

interface Stats {
  totalItems: number;
  totalQty: number;
  lowStock: number;
  activeProjects: number;
  itemsAdded7d: number;
  checkouts7d: number;
  shrinkage7d: number;
  byCategory: { category: Category; count: number }[];
  weeklyCheckouts: { week: number; total: number }[];
  topWorkers: { name: string; total: number }[];
  topItems: { name: string; total: number }[];
  lowStockItems: {
    id: number;
    name: string;
    quantity: number;
    low_stock_threshold: number;
    category: Category;
  }[];
}

function Kpi({
  icon: Icon,
  label,
  value,
  tone = "primary",
  href,
}: {
  icon: typeof Package;
  label: string;
  value: number;
  tone?: "primary" | "warn" | "danger";
  href: string;
}) {
  const toneCls =
    tone === "danger"
      ? "text-destructive"
      : tone === "warn"
        ? "text-orange-400"
        : "text-primary";
  return (
    <Link
      href={href}
      className="group rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/50"
    >
      <Icon className={`h-5 w-5 ${toneCls}`} />
      <p className="mt-2 text-2xl font-bold text-foreground group-hover:text-primary">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </Link>
  );
}

const tooltipStyle = {
  background: "hsl(222 40% 9%)",
  border: "1px solid hsl(222 20% 18%)",
  borderRadius: 8,
  color: "hsl(210 20% 92%)",
};

export default function DashboardPage() {
  const { data: stats, isLoading } = useQuery<Stats>({
    queryKey: ["stats"],
    queryFn: async () => (await apiRequest("GET", "/api/stats")).json(),
  });

  if (isLoading || !stats) {
    return (
      <div className="flex justify-center py-20 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const catData = stats.byCategory.map((c) => ({
    name: CATEGORY_LABELS[c.category] ?? c.category,
    count: c.count,
  }));
  const weekData = stats.weeklyCheckouts.map((w, i) => ({
    name: `W${i + 1}`,
    total: w.total,
  }));

  return (
    <div className="mx-auto max-w-6xl">
      <Header title="Dashboard" description="Inventory health at a glance" />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <Kpi icon={Package} label="Total items" value={stats.totalItems} href="/home" />
        <Kpi icon={Layers} label="Total quantity" value={stats.totalQty} href="/home" />
        <Kpi icon={AlertTriangle} label="Low stock" value={stats.lowStock} tone="warn" href="/home?lowStock=1" />
        <Kpi icon={FolderKanban} label="Active projects" value={stats.activeProjects} href="/projects" />
        <Kpi icon={PlusCircle} label="Added (7d)" value={stats.itemsAdded7d} href="/home" />
        <Kpi icon={PackageMinus} label="Checkouts (7d)" value={stats.checkouts7d} href="/activity?filter=check_out" />
        <Kpi icon={TrendingDown} label="Shrinkage (7d)" value={stats.shrinkage7d} tone="danger" href="/activity?filter=adjust" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-4 text-base font-semibold text-foreground">Items per category</h2>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={catData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(222 20% 18%)" />
              <XAxis dataKey="name" tick={{ fill: "hsl(215 15% 55%)", fontSize: 12 }} />
              <YAxis tick={{ fill: "hsl(215 15% 55%)", fontSize: 12 }} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "hsl(222 30% 16% / 0.4)" }} />
              <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-4 text-base font-semibold text-foreground">Weekly checkouts</h2>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={weekData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(222 20% 18%)" />
              <XAxis dataKey="name" tick={{ fill: "hsl(215 15% 55%)", fontSize: 12 }} />
              <YAxis tick={{ fill: "hsl(215 15% 55%)", fontSize: 12 }} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Line type="monotone" dataKey="total" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 text-base font-semibold text-foreground">Top workers (7d)</h2>
          {stats.topWorkers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No checkouts yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {stats.topWorkers.map((w) => (
                <li key={w.name} className="flex justify-between text-sm">
                  <span className="text-foreground">{w.name}</span>
                  <span className="font-medium text-muted-foreground">{w.total}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 text-base font-semibold text-foreground">Top items (7d)</h2>
          {stats.topItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">No usage yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {stats.topItems.map((it) => (
                <li key={it.name} className="flex justify-between text-sm">
                  <span className="text-foreground">{it.name}</span>
                  <span className="font-medium text-muted-foreground">{it.total}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 text-base font-semibold text-foreground">Reorder list</h2>
          {stats.lowStockItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing low on stock.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {stats.lowStockItems.map((it) => (
                <li key={it.id} className="flex items-center justify-between gap-2 text-sm">
                  <Link href={`/item/${it.id}`} className="truncate text-primary hover:underline">
                    {it.name}
                  </Link>
                  <span className="shrink-0 text-orange-400">
                    {it.quantity}/{it.low_stock_threshold}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
