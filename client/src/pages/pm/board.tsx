import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { toast } from "@/components/ui/toaster";
import Header from "@/components/Header";
import Modal from "@/components/Modal";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
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
import { Plus, Loader2, Search, SquareKanban, Timer, Trash2 } from "lucide-react";

type TaskRow = PmTask & { projectName: string | null; assigneeName: string | null };

const inputCls =
  "h-11 w-full rounded-lg border border-input bg-background px-3 text-base text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring";

const PRIORITY_DOT: Record<TaskPriority, string> = {
  low: "bg-zinc-400",
  medium: "bg-blue-500",
  high: "bg-amber-500",
  urgent: "bg-red-500",
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

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

// ─── Create / edit dialog ────────────────────────────────────────────────────

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

// ─── Board page ──────────────────────────────────────────────────────────────

export default function PmBoardPage() {
  const { isElevated } = useAuth();
  const qc = useQueryClient();
  const [projectFilter, setProjectFilter] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [q, setQ] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TaskRow | null>(null);
  const [dragOver, setDragOver] = useState<TaskStatus | null>(null);

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: async () => (await apiRequest("GET", "/api/projects")).json(),
  });

  const { data: users = [] } = useQuery<PublicUser[]>({
    queryKey: ["users"],
    queryFn: async () => (await apiRequest("GET", "/api/users")).json(),
    enabled: isElevated,
  });

  const params = new URLSearchParams();
  if (projectFilter) params.set("projectId", projectFilter);
  if (assigneeFilter) params.set("assigneeId", assigneeFilter);
  if (q.trim()) params.set("q", q.trim());
  const qs = params.toString();

  const { data: tasks = [], isLoading } = useQuery<TaskRow[]>({
    queryKey: ["pm-tasks", projectFilter, assigneeFilter, q],
    queryFn: async () => (await apiRequest("GET", `/api/pm/tasks${qs ? `?${qs}` : ""}`)).json(),
  });

  const byStatus = useMemo(() => {
    const map: Record<TaskStatus, TaskRow[]> = { todo: [], in_progress: [], review: [], done: [] };
    for (const t of tasks) map[t.status]?.push(t);
    return map;
  }, [tasks]);

  const reorder = useMutation({
    mutationFn: async (move: { id: number; status: TaskStatus; orderIndex: number }) =>
      (await apiRequest("POST", "/api/pm/tasks/reorder", { moves: [move] })).json(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pm-tasks"] }),
    onError: (e: any) => {
      toast({ variant: "destructive", title: "Could not move task", description: e?.message });
      qc.invalidateQueries({ queryKey: ["pm-tasks"] });
    },
  });

  const onDropColumn = (status: TaskStatus, e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    const id = Number(e.dataTransfer.getData("text/plain"));
    if (!id) return;
    const task = tasks.find((t) => t.id === id);
    if (!task || task.status === status) return;
    const maxIdx = Math.max(-1, ...byStatus[status].map((t) => t.orderIndex));
    reorder.mutate({ id, status, orderIndex: maxIdx + 1 });
  };

  const openEdit = (t: TaskRow) => {
    setEditing(t);
    setDialogOpen(true);
  };

  const today = todayYmd();

  return (
    <div className="mx-auto max-w-full">
      <Header title="Task board" description="Drag tasks between columns to update their status">
        <button
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
          className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-5 w-5" />
          New task
        </button>
      </Header>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search tasks…"
            className={cn(inputCls, "pl-9")}
          />
        </div>
        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className={cn(inputCls, "w-auto min-w-[170px]")}
        >
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {isElevated && (
          <select
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
            className={cn(inputCls, "w-auto min-w-[160px]")}
          >
            <option value="">All assignees</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : tasks.length === 0 && !q && !projectFilter && !assigneeFilter ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
          <SquareKanban className="h-12 w-12" />
          <p className="text-lg">No tasks yet</p>
          <button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
            className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-5 w-5" />
            Create the first task
          </button>
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {TASK_STATUSES.map((s) => (
            <div
              key={s}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(s);
              }}
              onDragLeave={() => setDragOver((cur) => (cur === s ? null : cur))}
              onDrop={(e) => onDropColumn(s, e)}
              className={cn(
                "flex w-72 shrink-0 flex-col gap-2 rounded-xl border border-border bg-muted/30 p-3",
                dragOver === s && "border-primary"
              )}
            >
              <div className="mb-1 flex items-center justify-between px-1">
                <span className="text-sm font-semibold text-foreground">
                  {TASK_STATUS_LABELS[s]}
                </span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {byStatus[s].length}
                </span>
              </div>
              {byStatus[s].length === 0 && (
                <p className="px-1 py-4 text-center text-xs text-muted-foreground">No tasks</p>
              )}
              {byStatus[s].map((t) => {
                const overdue = !!t.dueDate && t.dueDate < today && t.status !== "done";
                return (
                  <div
                    key={t.id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", String(t.id))}
                    onClick={() => openEdit(t)}
                    className="cursor-pointer rounded-xl border border-border bg-card p-3 transition-shadow hover:shadow-md"
                  >
                    <div className="flex items-start gap-2">
                      <span
                        className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", PRIORITY_DOT[t.priority])}
                        title={TASK_PRIORITY_LABELS[t.priority]}
                      />
                      <p className="flex-1 text-sm font-medium leading-snug text-foreground">
                        {t.title}
                      </p>
                    </div>
                    {t.projectName && (
                      <span className="mt-2 inline-block rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                        {t.projectName}
                      </span>
                    )}
                    <div className="mt-2 flex items-center justify-between">
                      {t.dueDate ? (
                        <span
                          className={cn(
                            "text-xs",
                            overdue
                              ? "font-medium text-red-600 dark:text-red-400"
                              : "text-muted-foreground"
                          )}
                        >
                          {formatDate(ymdToDate(t.dueDate))}
                        </span>
                      ) : (
                        <span />
                      )}
                      {t.assigneeName && (
                        <span
                          title={t.assigneeName}
                          className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground"
                        >
                          {initials(t.assigneeName)}
                        </span>
                      )}
                    </div>
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
