import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { LoadingBlock, EmptyState } from "@/components/ui/Feedback";
import Header from "@/components/Header";
import { cn } from "@/lib/utils";
import { todayYmd, ymdToDate, formatDate } from "@/lib/format";
import type { Project, PublicUser } from "@shared/schema";
import { TASK_STATUS_LABELS, type TaskStatus } from "@shared/pm-schema";
import { CalendarRange, ChevronLeft, ChevronRight } from "lucide-react";
import { TaskDialog, type TaskRow } from "./task-dialog";

// Same status hues as the board/gantt pills (shared Chip tones), applied to
// compact block chips instead of rounded-full pills.
const CHIP_STYLE: Record<TaskStatus, string> = {
  todo: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
  in_progress: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  review: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  done: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
};

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const x = new Date(y, m - 1, d + days);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(
    x.getDate()
  ).padStart(2, "0")}`;
}

/** Monday of the week containing `ymd`. */
function mondayOf(ymd: string): string {
  return addDaysYmd(ymd, -((ymdToDate(ymd).getDay() + 6) % 7));
}

/** A task's day range: start→due, single-dated tasks collapse to that day. */
function spanOf(t: TaskRow): [string, string] | null {
  const s = t.startDate ?? t.dueDate;
  const e = t.dueDate ?? t.startDate;
  if (!s || !e) return null;
  return s <= e ? [s, e] : [e, s];
}

type LeaveRow = {
  userId: number | null;
  employeeName?: string;
  startDate: string;
  endDate: string;
  status: string;
};

// ─── Schedule page (crew week view) ──────────────────────────────────────────

export default function PmSchedulePage() {
  const { isElevated } = useAuth();
  const [weekStart, setWeekStart] = useState(() => mondayOf(todayYmd()));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TaskRow | null>(null);

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: async () => (await apiRequest("GET", "/api/projects")).json(),
  });

  const { data: users = [] } = useQuery<PublicUser[]>({
    queryKey: ["users"],
    queryFn: async () => (await apiRequest("GET", "/api/users")).json(),
    enabled: isElevated,
  });

  const { data: tasks = [], isLoading } = useQuery<TaskRow[]>({
    queryKey: ["pm-tasks"],
    queryFn: async () => (await apiRequest("GET", "/api/pm/tasks")).json(),
  });

  // Approved HR leave, matched to assignees via userId — same feed the gantt
  // uses for its leave-clash markers (Phase D #24c). Non-elevated users only
  // receive their own requests; the view degrades gracefully.
  const { data: leave = [] } = useQuery<LeaveRow[]>({
    queryKey: ["hr-leave"],
    queryFn: async () => (await apiRequest("GET", "/api/hr/leave")).json(),
    retry: false,
  });
  const approvedLeave = useMemo(
    () => leave.filter((l) => l.status === "approved" && l.userId != null),
    [leave]
  );

  const today = todayYmd();
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDaysYmd(weekStart, i)),
    [weekStart]
  );
  const weekEnd = days[6];

  const weekTasks = useMemo(
    () =>
      tasks.filter((t) => {
        const span = spanOf(t);
        return span != null && span[0] <= weekEnd && span[1] >= weekStart;
      }),
    [tasks, weekStart, weekEnd]
  );

  // Rows: the same user list the assignee pickers use. Workers can't list
  // users, so fall back to the assignees present on tasks.
  const crew = useMemo(() => {
    if (users.length > 0) return users.map((u) => ({ id: u.id, name: u.name }));
    const seen = new Map<number, string>();
    for (const t of tasks) {
      if (t.assigneeId != null && !seen.has(t.assigneeId)) {
        seen.set(t.assigneeId, t.assigneeName ?? `User #${t.assigneeId}`);
      }
    }
    return Array.from(seen, ([id, name]) => ({ id, name }));
  }, [users, tasks]);

  const rows: { key: string; name: string; userId: number | null }[] = useMemo(
    () => [
      ...crew.map((c) => ({ key: `u${c.id}`, name: c.name, userId: c.id as number | null })),
      { key: "unassigned", name: "Unassigned", userId: null },
    ],
    [crew]
  );

  // ponytail: linear scans per cell — 8 rows × 7 days at shop scale.
  const leaveOn = (userId: number | null, day: string) =>
    userId != null
      ? approvedLeave.find((l) => l.userId === userId && l.startDate <= day && l.endDate >= day)
      : undefined;

  const unassignedCount = weekTasks.filter((t) => t.assigneeId == null).length;
  const crewOnLeave = new Set(
    approvedLeave
      .filter((l) => l.startDate <= weekEnd && l.endDate >= weekStart)
      .map((l) => l.userId)
  ).size;

  const openEdit = (t: TaskRow) => {
    setEditing(t);
    setDialogOpen(true);
  };

  const navBtn =
    "flex h-9 items-center justify-center rounded-lg border border-border text-foreground hover:border-primary";

  return (
    <div className="mx-auto max-w-full">
      <Header title="Schedule" description="Who is doing what, day by day, this week" />

      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setWeekStart(addDaysYmd(weekStart, -7))}
            aria-label="Previous week"
            className={cn(navBtn, "w-9")}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => setWeekStart(mondayOf(todayYmd()))}
            className={cn(navBtn, "px-3 text-sm font-medium")}
          >
            Today
          </button>
          <button
            onClick={() => setWeekStart(addDaysYmd(weekStart, 7))}
            aria-label="Next week"
            className={cn(navBtn, "w-9")}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <span className="text-sm font-semibold text-foreground">
          {formatDate(weekStart)} – {formatDate(weekEnd)}
        </span>
        {!isLoading && (
          <span className="text-sm text-muted-foreground">
            {weekTasks.length} task{weekTasks.length === 1 ? "" : "s"} this week ·{" "}
            {unassignedCount} unassigned · {crewOnLeave} crew on leave
          </span>
        )}
      </div>

      {isLoading ? (
        <LoadingBlock />
      ) : weekTasks.length === 0 && crewOnLeave === 0 ? (
        <EmptyState icon={CalendarRange} message="Nothing scheduled this week">
          <p className="text-sm">
            Give tasks dates on the{" "}
            <Link href="/pm/board" className="underline hover:text-foreground">
              board
            </Link>{" "}
            and they will show up here.
          </p>
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          {/* Header: Mon–Sun with dates, today highlighted */}
          <div
            className="grid border-b border-border"
            style={{ gridTemplateColumns: "140px repeat(7, minmax(130px, 1fr))" }}
          >
            <div className="px-3 py-2 text-xs font-semibold text-muted-foreground">Crew</div>
            {days.map((d) => {
              const date = ymdToDate(d);
              return (
                <div
                  key={d}
                  className={cn(
                    "border-l border-border/60 px-2 py-2 text-center text-xs",
                    d === today
                      ? "bg-primary/5 font-semibold text-primary"
                      : "font-semibold text-muted-foreground"
                  )}
                >
                  {date.toLocaleDateString("en-US", { weekday: "short" })}{" "}
                  <span className="font-normal">
                    {date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                </div>
              );
            })}
          </div>

          {/* One row per crew member + Unassigned */}
          {rows.map((row) => (
            <div
              key={row.key}
              className="grid border-b border-border/60 last:border-b-0"
              style={{ gridTemplateColumns: "140px repeat(7, minmax(130px, 1fr))" }}
            >
              <div
                className={cn(
                  "px-3 py-2 text-sm font-medium",
                  row.userId == null ? "text-muted-foreground" : "text-foreground"
                )}
              >
                {row.name}
              </div>
              {days.map((day) => {
                const onLeave = leaveOn(row.userId, day);
                const cellTasks = weekTasks.filter((t) => {
                  if ((t.assigneeId ?? null) !== row.userId) return false;
                  const span = spanOf(t)!;
                  return span[0] <= day && span[1] >= day;
                });
                return (
                  <div
                    key={day}
                    className={cn(
                      "flex min-h-[44px] flex-col gap-1 border-l border-border/60 p-1.5",
                      day === today && "bg-primary/5"
                    )}
                  >
                    {onLeave && (
                      <div
                        title={`${onLeave.employeeName ?? row.name} is on leave ${onLeave.startDate} → ${onLeave.endDate}`}
                        className="rounded-md bg-zinc-500/10 px-2 py-1 text-center text-xs font-medium text-zinc-500"
                      >
                        On leave
                      </div>
                    )}
                    {cellTasks.map((t) => {
                      const overdue = !!t.dueDate && t.dueDate < today && t.status !== "done";
                      return (
                        <button
                          key={t.id}
                          onClick={() => openEdit(t)}
                          title={`${t.title}${t.projectName ? ` · ${t.projectName}` : ""} · ${TASK_STATUS_LABELS[t.status]}${t.dueDate ? ` · due ${t.dueDate}` : ""}`}
                          className={cn(
                            "block w-full truncate rounded-md px-2 py-1 text-left text-xs font-medium transition-opacity hover:opacity-80",
                            CHIP_STYLE[t.status],
                            overdue && "text-red-600 dark:text-red-400"
                          )}
                        >
                          {/* Same leave-clash marker as the gantt (Phase D #24c) */}
                          {onLeave && (
                            <span className="mr-1 text-amber-600 dark:text-amber-400">⚠</span>
                          )}
                          {t.title}
                          {t.projectName && (
                            <span className="ml-1 font-normal opacity-70">· {t.projectName}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      <TaskDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        task={editing}
        projects={projects}
        users={users}
        isElevated={isElevated}
      />
    </div>
  );
}
