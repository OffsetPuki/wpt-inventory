import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

export interface Trend {
  pct: number; // 0.12 = +12% vs the previous period
  // For most numbers up is good (revenue); for some down is good (expenses).
  goodWhenUp?: boolean;
  label?: string; // defaults to "vs last month"
}

// The suite-wide KPI card. `filled` renders the accent "hero" variant (solid
// primary background, white text) used for the headline number of a page.
export default function StatCard({
  label,
  value,
  trend,
  href,
  filled = false,
  tone = "default",
}: {
  label: string;
  value: string | number | null | undefined;
  trend?: Trend | null;
  href: string;
  filled?: boolean;
  tone?: "default" | "warn" | "danger" | "good";
}) {
  const toneCls =
    tone === "danger"
      ? "text-destructive"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : tone === "good"
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-foreground";

  // "Good" when the direction of movement matches the direction that's good
  // for this metric (revenue up = good, expenses up = bad).
  const trendGood = trend ? (trend.goodWhenUp ?? true) === (trend.pct >= 0) : false;

  return (
    <Link
      href={href}
      className={cn(
        "flex flex-col gap-1 rounded-2xl border p-5 transition-all hover:-translate-y-0.5",
        filled
          ? "border-transparent bg-primary text-primary-foreground shadow-sm hover:shadow-md"
          : "border-border bg-card hover:border-primary/50"
      )}
    >
      <p className={cn("text-sm", filled ? "text-primary-foreground/80" : "text-muted-foreground")}>
        {label}
      </p>
      <p
        className={cn(
          "truncate text-3xl font-bold tabular-nums tracking-tight",
          filled ? "text-primary-foreground" : toneCls
        )}
      >
        {value ?? "—"}
      </p>
      {trend && isFinite(trend.pct) && (
        <p
          className={cn(
            "mt-0.5 flex items-center gap-1 text-xs font-medium",
            filled
              ? "text-primary-foreground/90"
              : trendGood
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-red-600 dark:text-red-400"
          )}
        >
          {trend.pct >= 0 ? (
            <ArrowUpRight className="h-3.5 w-3.5" />
          ) : (
            <ArrowDownRight className="h-3.5 w-3.5" />
          )}
          {Math.abs(trend.pct * 100).toFixed(0)}% {trend.label ?? "vs last month"}
        </p>
      )}
    </Link>
  );
}
