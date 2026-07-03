import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { toast } from "@/components/ui/toaster";
import Header from "@/components/Header";
import { cn } from "@/lib/utils";
import { formatHours } from "@/lib/format";
import {
  TIMESHEET_STATUS_LABELS,
  type TimesheetStatus,
} from "@shared/pm-schema";
import { ChevronLeft, ChevronRight, Clock, Loader2, Send, BadgeCheck } from "lucide-react";

interface SheetRow {
  userId: number;
  userName: string;
  days: number[]; // 7 buckets, Mon..Sun, minutes
  totalMin: number;
  billableMin: number;
  status: TimesheetStatus;
  timesheetId: number | null;
}

const STATUS_CHIP: Record<TimesheetStatus, string> = {
  open: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
  submitted: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  approved: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
};

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function ymdToDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDaysYmd(s: string, days: number): string {
  const [y, m, d] = s.split("-").map(Number);
  return ymd(new Date(y, m - 1, d + days));
}

/** Monday of the week containing `d`. */
function mondayOf(d: Date): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return ymd(x);
}

function weekLabel(weekStart: string): string {
  const start = ymdToDate(weekStart);
  const end = ymdToDate(addDaysYmd(weekStart, 6));
  const fmt = (d: Date, withYear: boolean) =>
    d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      ...(withYear ? { year: "numeric" } : {}),
    });
  return `${fmt(start, false)} – ${fmt(end, true)}`;
}

export default function PmTimesheetsPage() {
  const { user, isElevated } = useAuth();
  const qc = useQueryClient();
  const currentWeek = mondayOf(new Date());
  const [weekStart, setWeekStart] = useState(currentWeek);

  const { data: rows = [], isLoading } = useQuery<SheetRow[]>({
    queryKey: ["pm-timesheets", weekStart],
    queryFn: async () =>
      (await apiRequest("GET", `/api/pm/timesheets?weekStart=${weekStart}`)).json(),
  });

  const submit = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/pm/timesheets/submit", { weekStart })).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pm-timesheets"] });
      toast({ variant: "success", title: "Timesheet submitted" });
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not submit", description: e?.message }),
  });

  const approve = useMutation({
    mutationFn: async (timesheetId: number) =>
      (await apiRequest("POST", `/api/pm/timesheets/${timesheetId}/approve`)).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pm-timesheets"] });
      toast({ variant: "success", title: "Timesheet approved" });
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not approve", description: e?.message }),
  });

  const dayDates = DAY_NAMES.map((_, i) => ymdToDate(addDaysYmd(weekStart, i)).getDate());

  return (
    <div className="mx-auto max-w-6xl">
      <Header title="Timesheets" description="Weekly hours, submitted for approval" />

      {/* Week navigation */}
      <div className="mb-6 flex items-center gap-2">
        <button
          onClick={() => setWeekStart(addDaysYmd(weekStart, -7))}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-border text-foreground hover:border-primary"
          aria-label="Previous week"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <span className="min-w-[210px] text-center text-base font-semibold text-foreground">
          {weekLabel(weekStart)}
        </span>
        <button
          onClick={() => setWeekStart(addDaysYmd(weekStart, 7))}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-border text-foreground hover:border-primary"
          aria-label="Next week"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
        {weekStart !== currentWeek && (
          <button
            onClick={() => setWeekStart(currentWeek)}
            className="h-10 rounded-xl border border-border px-4 text-sm font-medium text-muted-foreground hover:border-primary"
          >
            This week
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
          <Clock className="h-12 w-12" />
          <p className="text-lg">No time logged this week</p>
          <p className="text-sm">Entries from the time tracker roll up here automatically.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-muted-foreground">
                <th className="px-4 py-3 font-medium">User</th>
                {DAY_NAMES.map((n, i) => (
                  <th key={n} className="px-2 py-3 text-right font-medium">
                    {n} {dayDates[i]}
                  </th>
                ))}
                <th className="px-4 py-3 text-right font-medium">Total</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border border-t border-border">
              {rows.map((r) => {
                const own = r.userId === user?.id;
                return (
                  <tr key={r.userId}>
                    <td className="px-4 py-3 font-medium text-foreground">
                      {r.userName}
                      {own && <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>}
                    </td>
                    {r.days.map((min, i) => (
                      <td
                        key={i}
                        className={cn(
                          "px-2 py-3 text-right tabular-nums",
                          min === 0 ? "text-muted-foreground/50" : "text-foreground"
                        )}
                      >
                        {min === 0 ? "—" : formatHours(min)}
                      </td>
                    ))}
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-foreground">
                      {formatHours(r.totalMin)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-0.5 text-xs font-medium",
                          STATUS_CHIP[r.status] ?? STATUS_CHIP.open
                        )}
                      >
                        {TIMESHEET_STATUS_LABELS[r.status] ?? r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {own && r.status === "open" && (
                        <button
                          onClick={() => submit.mutate()}
                          disabled={submit.isPending}
                          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
                        >
                          {submit.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Send className="h-4 w-4" />
                          )}
                          Submit
                        </button>
                      )}
                      {isElevated && r.status === "submitted" && r.timesheetId != null && (
                        <button
                          onClick={() => approve.mutate(r.timesheetId!)}
                          disabled={approve.isPending}
                          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3.5 text-sm font-medium text-foreground hover:border-primary disabled:opacity-60"
                        >
                          {approve.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <BadgeCheck className="h-4 w-4" />
                          )}
                          Approve
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
