import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { toast } from "@/components/ui/toaster";
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
import { Loader2, Timer, Trash2 } from "lucide-react";

// ─── Create / edit task dialog (shared by the board and gantt pages) ─────────

export type TaskRow = PmTask & { projectName: string | null; assigneeName: string | null };

export const inputCls =
  "h-11 w-full rounded-lg border border-input bg-background px-3 text-base text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring";

export function TaskDialog({
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
