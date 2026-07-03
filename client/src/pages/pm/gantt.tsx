import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { toast } from "@/components/ui/toaster";
import Header from "@/components/Header";
import Modal from "@/components/Modal";
import { cn } from "@/lib/utils";
import type { Project, PublicUser } from "@shared/schema";
import {
  TASK_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUS_LABELS,
  TASK_PRIORITY_LABELS,
  type PmTask,
  type TaskStatus,
  type TaskPriority,
} from "@shared/pm-schema";
import { ChartGantt, Loader2, Timer, Trash2, CalendarDays } from "lucide-react";

type TaskRow = PmTask & { projectName: string | null; assigneeName: string | null };

const inputCls =
  "h-11 w-full rounded-lg border border-input bg-background px-3 text-base text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring";

const DAY_W = 26;
const LABEL_W = 224;

const BAR_STYLE: Record<TaskStatus, string> = {
  todo: "bg-muted-foreground/40",
  in_progress: "bg-primary",
  review: "bg-amber-500",
  done: "bg-emerald-500/60",
};

const STATUS_CHIP: Record<TaskStatus, string> = {
  todo: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
  in_progress: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  review: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  done: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
};

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function ymdToDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const x = new Date(y, m - 1, d + days);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(
    x.getDate()
  ).padStart(2, "0")}`;
}

function dayDiff(fromYmd: string, toYmd: string): number {
  return Math.round((ymdToDate(toYmd).getTime() - ymdToDate(fromYmd).getTime()) / 86400000);
}

// ─── Task dialog (same shape as the board's — kept local to this page) ───────

function TaskDialog({
  open,
  onClose,
  task,
  projects,
  users,
  isElevated,
}: {
  open: boolean;
  onClose: () => void;
  task: TaskRow | null;
  projects: Project[];
  users: PublicUser[];
  isElevated: boolean;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState("");
  const [status, setStatus] = useState<TaskStatus>("todo");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [assigneeId, setAssigneeId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [estimateHours, setEstimateHours] = useState("");

  useEffect(() => {
    if (!open) return;
    setTitle(task?.title ?? "");
    setDescription(task?.description ?? "");
    setProjectId(task?.projectId ? String(task.projectId) : "");
    setStatus(task?.status ?? "todo");
    setPriority(task?.priority ?? "medium");
    setAssigneeId(task?.assigneeId ? String(task.assigneeId) : "");
    setStartDate(task?.startDate ?? "");
    setDueDate(task?.dueDate ?? "");
    setEstimateHours(task?.estimateHours != null ? String(task.estimateHours) : "");
  }, [open, task]);

  const buildPayload = () => {
    const eh = parseFloat(estimateHours);
    return {
      title: title.trim(),
      description: description.trim() || null,
      projectId: projectId ? Number(projectId) : null,
      status,
      priority,
      assigneeId: assigneeId ? Number(assigneeId) : null,
      startDate: startDate || null,
      dueDate: dueDate || null,
      estimateHours: isNaN(eh) ? null : eh,
    };
  };

  const save = useMutation({
    mutationFn: async () =>
      task
        ? (await apiRequest("PATCH", `/api/pm/tasks/${task.id}`, buildPayload())).json()
        : (await apiRequest("POST", "/api/pm/tasks", buildPayload())).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pm-tasks"] });
      toast({ variant: "success", title: task ? "Task updated" : "Task created" });
      onClose();
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not save task", description: e?.message }),
  });

  const del = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", `/api/pm/tasks/${task!.id}`)).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pm-tasks"] });
      toast({ variant: "success", title: "Task deleted" });
      onClose();
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not delete", description: e?.message }),
  });

  const startTimer = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("POST", "/api/pm/time/start", {
          taskId: task!.id,
          projectId: task!.projectId ?? undefined,
          description: task!.title,
        })
      ).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pm-time-running"] });
      toast({ variant: "success", title: "Timer started", description: task?.title });
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not start timer", description: e?.message }),
  });

  return (
    <Modal open={open} onClose={onClose} title={task ? "Edit task" : "New task"} maxWidth="max-w-lg">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) {
            toast({ variant: "destructive", title: "Title is required" });
            return;
          }
          save.mutate();
        }}
        className="flex flex-col gap-4"
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Title</span>
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Description (optional)</span>
          <textarea
            className={cn(inputCls, "h-auto min-h-[80px] py-2")}
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Project</span>
            <select className={inputCls} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Status</span>
            <select
              className={inputCls}
              value={status}
              onChange={(e) => setStatus(e.target.value as TaskStatus)}
            >
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {TASK_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Priority</span>
            <select
              className={inputCls}
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
            >
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {TASK_PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </label>
          {isElevated && (
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-foreground">Assignee</span>
              <select
                className={inputCls}
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
              >
                <option value="">Unassigned</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Start date</span>
            <input
              type="date"
              className={inputCls}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Due date</span>
            <input
              type="date"
              className={inputCls}
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Estimate (hours)</span>
            <input
              type="number"
              min="0"
              step="0.25"
              className={inputCls}
              value={estimateHours}
              onChange={(e) => setEstimateHours(e.target.value)}
            />
          </label>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-2">
          {task && (
            <>
              <button
                type="button"
                onClick={() => startTimer.mutate()}
                disabled={startTimer.isPending}
                className="flex h-11 items-center gap-2 rounded-xl border border-border px-4 font-medium text-foreground hover:border-primary disabled:opacity-60"
              >
                {startTimer.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Timer className="h-4 w-4" />
                )}
                Start timer
              </button>
              <button
                type="button"
                onClick={() => del.mutate()}
                disabled={del.isPending}
                className="flex h-11 items-center gap-2 rounded-xl border border-border px-4 font-medium text-red-600 hover:border-red-500 disabled:opacity-60 dark:text-red-400"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </button>
            </>
          )}
          <button
            type="submit"
            disabled={save.isPending}
            className="ml-auto flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {task ? "Save changes" : "Create task"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Gantt page ──────────────────────────────────────────────────────────────

export default function PmGanttPage() {
  const { isElevated } = useAuth();
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

  const scheduled = useMemo(
    () => tasks.filter((t) => t.startDate && t.dueDate),
    [tasks]
  );
  const unscheduled = useMemo(
    () => tasks.filter((t) => !t.startDate || !t.dueDate),
    [tasks]
  );

  const groups = useMemo(() => {
    const map = new Map<string, TaskRow[]>();
    for (const t of scheduled) {
      const key = t.projectName ?? "No project";
      const list = map.get(key);
      if (list) list.push(t);
      else map.set(key, [t]);
    }
    return Array.from(map.entries()).map(([name, list]) => ({ name, tasks: list }));
  }, [scheduled]);

  const range = useMemo(() => {
    if (scheduled.length === 0) return null;
    let min = scheduled[0].startDate!;
    let max = scheduled[0].dueDate!;
    for (const t of scheduled) {
      if (t.startDate! < min) min = t.startDate!;
      if (t.dueDate! > max) max = t.dueDate!;
      // Defensive: a due date before the start still needs to fit the range.
      if (t.dueDate! < min) min = t.dueDate!;
      if (t.startDate! > max) max = t.startDate!;
    }
    const start = addDaysYmd(min, -7);
    const end = addDaysYmd(max, 7);
    return { start, end, totalDays: dayDiff(start, end) + 1 };
  }, [scheduled]);

  const days = useMemo(() => {
    if (!range) return [];
    const arr: { i: number; date: Date }[] = [];
    for (let i = 0; i < range.totalDays; i++) {
      arr.push({ i, date: ymdToDate(addDaysYmd(range.start, i)) });
    }
    return arr;
  }, [range]);

  const openEdit = (t: TaskRow) => {
    setEditing(t);
    setDialogOpen(true);
  };

  const today = todayYmd();
  const chartW = range ? range.totalDays * DAY_W : 0;
  const todayIdx = range ? dayDiff(range.start, today) : -1;
  const monthStarts = days.filter((d) => d.date.getDate() === 1);
  // Skip the leading range label if a real month boundary sits right next to it.
  const showLeadLabel =
    days.length > 0 &&
    days[0].date.getDate() !== 1 &&
    (monthStarts.length === 0 || monthStarts[0].i * DAY_W > 80);

  return (
    <div className="mx-auto max-w-full">
      <Header title="Gantt" description="Scheduled tasks across projects on a shared timeline" />

      {isLoading ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : scheduled.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
          <ChartGantt className="h-12 w-12" />
          <p className="text-lg">Nothing scheduled yet</p>
          <p className="text-sm">
            Give tasks a start and due date on the board and they will appear here.
          </p>
        </div>
      ) : (
        range && (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              {TASK_STATUSES.map((s) => (
                <span key={s} className="flex items-center gap-1.5">
                  <span className={cn("h-2.5 w-2.5 rounded-sm", BAR_STYLE[s])} />
                  {TASK_STATUS_LABELS[s]}
                </span>
              ))}
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-px bg-red-500" style={{ height: 10 }} />
                Today
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <div className="relative" style={{ width: LABEL_W + chartW }}>
                {/* Grid overlay: day lines, heavier Monday lines, today line */}
                <div
                  className="pointer-events-none absolute bottom-0"
                  style={{ left: LABEL_W, width: chartW, top: 32 }}
                >
                  {days.map(
                    (d) =>
                      d.i > 0 && (
                        <div
                          key={d.i}
                          className={cn(
                            "absolute bottom-0 top-0 w-px",
                            d.date.getDay() === 1 ? "bg-border" : "bg-border/40"
                          )}
                          style={{ left: d.i * DAY_W }}
                        />
                      )
                  )}
                  {todayIdx >= 0 && todayIdx < range.totalDays && (
                    <div
                      className="absolute bottom-0 top-0 w-0.5 bg-red-500"
                      style={{ left: todayIdx * DAY_W + DAY_W / 2 }}
                    />
                  )}
                </div>

                {/* Axis: month labels + Monday day numbers */}
                <div className="flex border-b border-border">
                  <div style={{ width: LABEL_W }} className="shrink-0 border-r border-border" />
                  <div className="relative h-8" style={{ width: chartW }}>
                    {showLeadLabel && (
                      <span className="absolute left-1 top-0.5 text-xs font-medium text-foreground">
                        {days[0].date.toLocaleDateString("en-US", {
                          month: "short",
                          year: "numeric",
                        })}
                      </span>
                    )}
                    {monthStarts.map((d) => (
                      <span
                        key={d.i}
                        className="absolute top-0.5 text-xs font-medium text-foreground"
                        style={{ left: d.i * DAY_W + 4 }}
                      >
                        {d.date.toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                      </span>
                    ))}
                    {days
                      .filter((d) => d.date.getDay() === 1)
                      .map((d) => (
                        <span
                          key={`w${d.i}`}
                          className="absolute bottom-0.5 text-[10px] text-muted-foreground"
                          style={{ left: d.i * DAY_W + 3 }}
                        >
                          {d.date.getDate()}
                        </span>
                      ))}
                  </div>
                </div>

                {/* Rows */}
                {groups.map((g) => (
                  <div key={g.name}>
                    <div
                      className="flex h-9 items-center bg-muted/40 px-3 text-sm font-semibold text-foreground"
                      style={{ width: LABEL_W + chartW }}
                    >
                      {g.name}
                    </div>
                    {g.tasks.map((t) => {
                      const startIdx = Math.max(0, dayDiff(range.start, t.startDate!));
                      const span = dayDiff(t.startDate!, t.dueDate!) + 1;
                      const w = Math.max(DAY_W, span * DAY_W);
                      return (
                        <div
                          key={t.id}
                          className="flex h-9 items-stretch border-b border-border/60 last:border-b-0"
                        >
                          <div
                            style={{ width: LABEL_W }}
                            className="flex shrink-0 items-center border-r border-border px-3"
                          >
                            <span className="truncate text-sm text-foreground">{t.title}</span>
                          </div>
                          <div className="relative" style={{ width: chartW }}>
                            <button
                              onClick={() => openEdit(t)}
                              title={`${t.title} · ${TASK_STATUS_LABELS[t.status]} · ${t.startDate} → ${t.dueDate}`}
                              className={cn(
                                "absolute top-1.5 h-6 rounded-md transition-opacity hover:opacity-80",
                                BAR_STYLE[t.status]
                              )}
                              style={{ left: startIdx * DAY_W + 1, width: w - 2 }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </>
        )
      )}

      {!isLoading && unscheduled.length > 0 && (
        <div className="mt-8 max-w-3xl">
          <h2 className="mb-1 text-lg font-semibold text-foreground">Unscheduled</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            Add both a start and due date to place these tasks on the timeline.
          </p>
          <div className="divide-y divide-border rounded-xl border border-border bg-card">
            {unscheduled.map((t) => (
              <button
                key={t.id}
                onClick={() => openEdit(t)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent/50"
              >
                <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate text-sm font-medium text-foreground">
                  {t.title}
                </span>
                {t.projectName && (
                  <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                    {t.projectName}
                  </span>
                )}
                <span
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-xs font-medium",
                    STATUS_CHIP[t.status]
                  )}
                >
                  {TASK_STATUS_LABELS[t.status]}
                </span>
              </button>
            ))}
          </div>
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
