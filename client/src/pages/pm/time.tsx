import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { toast } from "@/components/ui/toaster";
import Header from "@/components/Header";
import Modal from "@/components/Modal";
import { cn } from "@/lib/utils";
import { formatHours } from "@/lib/format";
import type { Project, PublicUser } from "@shared/schema";
import type { PmTask, TimeEntry } from "@shared/pm-schema";
import {
  Clock,
  Loader2,
  Play,
  Square,
  Plus,
  Pencil,
  Trash2,
  CircleDollarSign,
} from "lucide-react";

type TimeRow = TimeEntry & { projectName: string | null; taskTitle: string | null };
type TaskRow = PmTask & { projectName: string | null; assigneeName: string | null };

const inputCls =
  "h-11 w-full rounded-lg border border-input bg-background px-3 text-base text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring";

function ymdOfMs(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function hhmmOfMs(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function dayLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function timeRange(e: TimeRow): string {
  const start = hhmmOfMs(e.startedAt);
  return e.endedAt ? `${start} – ${hhmmOfMs(e.endedAt)}` : `${start} –`;
}

// ─── Manual entry dialog (create + edit) ─────────────────────────────────────

function EntryDialog({
  open,
  onClose,
  entry,
  projects,
}: {
  open: boolean;
  onClose: () => void;
  entry: TimeRow | null;
  projects: Project[];
}) {
  const qc = useQueryClient();
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [duration, setDuration] = useState("");
  // Whether the user actually touched the Duration field this session — the
  // prefilled value must not override the server's recompute when only the
  // times were edited.
  const [durationDirty, setDurationDirty] = useState(false);
  const [description, setDescription] = useState("");
  const [projectSel, setProjectSel] = useState("");
  const [taskSel, setTaskSel] = useState("");
  const [billable, setBillable] = useState(true);

  useEffect(() => {
    if (!open) return;
    setDurationDirty(false);
    if (entry) {
      setDate(ymdOfMs(entry.startedAt));
      setStartTime(hhmmOfMs(entry.startedAt));
      setEndTime(entry.endedAt ? hhmmOfMs(entry.endedAt) : "");
      setDuration(String(entry.durationMin));
      setDescription(entry.description ?? "");
      setProjectSel(entry.projectId ? String(entry.projectId) : "");
      setTaskSel(entry.taskId ? String(entry.taskId) : "");
      setBillable(entry.billable);
    } else {
      setDate(ymdOfMs(Date.now()));
      setStartTime("");
      setEndTime("");
      setDuration("");
      setDescription("");
      setProjectSel("");
      setTaskSel("");
      setBillable(true);
    }
  }, [open, entry]);

  const { data: tasks = [] } = useQuery<TaskRow[]>({
    queryKey: ["pm-tasks", projectSel],
    queryFn: async () =>
      (await apiRequest("GET", `/api/pm/tasks?projectId=${projectSel}`)).json(),
    enabled: open && !!projectSel,
  });

  const save = useMutation({
    mutationFn: async (payload: Record<string, unknown>) =>
      entry
        ? (await apiRequest("PATCH", `/api/pm/time/${entry.id}`, payload)).json()
        : (await apiRequest("POST", "/api/pm/time", payload)).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pm-time"] });
      qc.invalidateQueries({ queryKey: ["pm-timesheets"] });
      toast({ variant: "success", title: entry ? "Entry updated" : "Entry added" });
      onClose();
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not save entry", description: e?.message }),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!date) {
      toast({ variant: "destructive", title: "Date is required" });
      return;
    }
    const startedAt = startTime ? new Date(`${date}T${startTime}`).getTime() : undefined;
    let endedAt = endTime ? new Date(`${date}T${endTime}`).getTime() : undefined;
    // An end time earlier than the start means the shift crossed midnight
    // (22:00 → 01:30) — both fields share one Date input, so roll end forward.
    if (startedAt !== undefined && endedAt !== undefined && endedAt < startedAt) {
      endedAt += 24 * 60 * 60 * 1000;
    }
    // The prefilled duration on edit must not defeat the server's recompute —
    // only send it when the user typed it (or when it's the only time info).
    const sendDuration = duration.trim() !== "" && (durationDirty || startedAt === undefined || endedAt === undefined);
    const dur = sendDuration ? parseInt(duration, 10) : undefined;
    if (dur !== undefined && (isNaN(dur) || dur < 0)) {
      toast({ variant: "destructive", title: "Duration must be a positive number of minutes" });
      return;
    }
    const known = [startedAt, endedAt, dur].filter((v) => v !== undefined).length;
    if (known < 2) {
      toast({
        variant: "destructive",
        title: "Not enough time info",
        description: "Provide start and end times, or one of them plus a duration.",
      });
      return;
    }
    if (startedAt !== undefined && endedAt !== undefined && endedAt === startedAt) {
      toast({ variant: "destructive", title: "End time must be after the start time" });
      return;
    }
    save.mutate({
      // Edits send explicit nulls to CLEAR a field — undefined keys are
      // dropped by JSON.stringify and the server reads that as "unchanged".
      description: description.trim() || (entry ? null : undefined),
      projectId: projectSel ? Number(projectSel) : entry ? null : undefined,
      taskId: taskSel ? Number(taskSel) : entry ? null : undefined,
      startedAt,
      endedAt,
      durationMin: dur,
      billable,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={entry ? "Edit time entry" : "Add manual entry"}
      maxWidth="max-w-lg"
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Date</span>
            <input
              type="date"
              className={inputCls}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Duration (minutes)</span>
            <input
              type="number"
              min="0"
              placeholder="e.g. 90"
              className={inputCls}
              value={duration}
              onChange={(e) => { setDuration(e.target.value); setDurationDirty(true); }}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Start time</span>
            <input
              type="time"
              className={inputCls}
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">End time</span>
            <input
              type="time"
              className={inputCls}
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          Give start and end times, or one of them plus a duration — the rest is worked out.
        </p>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Description (optional)</span>
          <input
            className={inputCls}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Project</span>
            <select
              className={inputCls}
              value={projectSel}
              onChange={(e) => {
                setProjectSel(e.target.value);
                setTaskSel("");
              }}
            >
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Task</span>
            <select
              className={inputCls}
              value={taskSel}
              onChange={(e) => setTaskSel(e.target.value)}
              disabled={!projectSel}
            >
              <option value="">{projectSel ? "No task" : "Pick a project first"}</option>
              {tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex items-center gap-2.5">
          <input
            type="checkbox"
            checked={billable}
            onChange={(e) => setBillable(e.target.checked)}
            className="h-4 w-4 accent-[hsl(var(--primary))]"
          />
          <span className="text-sm font-medium text-foreground">Billable</span>
        </label>
        <button
          type="submit"
          disabled={save.isPending}
          className="mt-1 flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {entry ? "Save changes" : "Add entry"}
        </button>
      </form>
    </Modal>
  );
}

// ─── Time page ───────────────────────────────────────────────────────────────

export default function PmTimePage() {
  const { user, isElevated } = useAuth();
  const qc = useQueryClient();

  // Timer / quick-start state
  const [desc, setDesc] = useState("");
  const [projectSel, setProjectSel] = useState("");
  const [taskSel, setTaskSel] = useState("");
  const [now, setNow] = useState(Date.now());

  // Filters
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [userFilter, setUserFilter] = useState("");

  // Dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<TimeRow | null>(null);

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: async () => (await apiRequest("GET", "/api/projects")).json(),
  });

  const { data: users = [] } = useQuery<PublicUser[]>({
    queryKey: ["users"],
    queryFn: async () => (await apiRequest("GET", "/api/users")).json(),
    enabled: isElevated,
  });

  const { data: running } = useQuery<TimeEntry | null>({
    queryKey: ["pm-time-running"],
    queryFn: async () => (await apiRequest("GET", "/api/pm/time/running")).json(),
  });

  const { data: quickTasks = [] } = useQuery<TaskRow[]>({
    queryKey: ["pm-tasks", projectSel],
    queryFn: async () =>
      (await apiRequest("GET", `/api/pm/tasks?projectId=${projectSel}`)).json(),
    enabled: !!projectSel,
  });

  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (isElevated && userFilter) params.set("userId", userFilter);
  const qs = params.toString();

  const { data: entries = [], isLoading } = useQuery<TimeRow[]>({
    queryKey: ["pm-time", from, to, userFilter],
    queryFn: async () => (await apiRequest("GET", `/api/pm/time${qs ? `?${qs}` : ""}`)).json(),
  });

  // Ticking clock for the running timer.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running?.id]);

  const start = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("POST", "/api/pm/time/start", {
          description: desc.trim() || undefined,
          projectId: projectSel ? Number(projectSel) : undefined,
          taskId: taskSel ? Number(taskSel) : undefined,
        })
      ).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pm-time-running"] });
      qc.invalidateQueries({ queryKey: ["pm-time"] });
      setDesc("");
      setProjectSel("");
      setTaskSel("");
      setNow(Date.now());
      toast({ variant: "success", title: "Timer started" });
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not start timer", description: e?.message }),
  });

  const stop = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/pm/time/stop")).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pm-time-running"] });
      qc.invalidateQueries({ queryKey: ["pm-time"] });
      qc.invalidateQueries({ queryKey: ["pm-timesheets"] });
      toast({ variant: "success", title: "Timer stopped" });
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not stop timer", description: e?.message }),
  });

  const del = useMutation({
    mutationFn: async (id: number) => (await apiRequest("DELETE", `/api/pm/time/${id}`)).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pm-time"] });
      qc.invalidateQueries({ queryKey: ["pm-timesheets"] });
      toast({ variant: "success", title: "Entry deleted" });
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not delete", description: e?.message }),
  });

  const runningProject = running?.projectId
    ? projects.find((p) => p.id === running.projectId)
    : undefined;

  const userName = (id: number) =>
    id === user?.id ? "You" : users.find((u) => u.id === id)?.name ?? `User #${id}`;

  const groups = useMemo(() => {
    const map = new Map<string, TimeRow[]>();
    for (const e of entries) {
      const k = ymdOfMs(e.startedAt);
      const list = map.get(k);
      if (list) list.push(e);
      else map.set(k, [e]);
    }
    return Array.from(map.entries());
  }, [entries]);

  return (
    <div className="mx-auto max-w-6xl">
      <Header title="Time tracking" description="Track hours with a live timer or manual entries">
        <button
          onClick={() => {
            setEditingEntry(null);
            setDialogOpen(true);
          }}
          className="flex h-11 items-center gap-2 rounded-xl border border-border px-5 font-medium text-foreground hover:border-primary"
        >
          <Plus className="h-5 w-5" />
          Add manual entry
        </button>
      </Header>

      {/* Hero timer card */}
      <div className="mb-8 rounded-xl border border-border bg-card p-5">
        {running ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">Timer running</p>
              <p className="mt-1 truncate text-lg font-semibold text-foreground">
                {running.description || "(no description)"}
              </p>
              {runningProject && (
                <span className="mt-1 inline-block rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                  {runningProject.name}
                </span>
              )}
            </div>
            <div className="flex items-center gap-5">
              <span className="text-4xl font-semibold tabular-nums text-foreground">
                {formatElapsed(now - running.startedAt)}
              </span>
              <button
                onClick={() => stop.mutate()}
                disabled={stop.isPending}
                className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
              >
                {stop.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Square className="h-4 w-4" />
                )}
                Stop
              </button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              start.mutate();
            }}
            className="flex flex-col gap-3 lg:flex-row lg:items-end"
          >
            <label className="flex flex-1 flex-col gap-1.5">
              <span className="text-sm font-medium text-foreground">What are you working on?</span>
              <input
                className={inputCls}
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="Describe the work…"
              />
            </label>
            <label className="flex flex-col gap-1.5 lg:w-52">
              <span className="text-sm font-medium text-foreground">Project</span>
              <select
                className={inputCls}
                value={projectSel}
                onChange={(e) => {
                  setProjectSel(e.target.value);
                  setTaskSel("");
                }}
              >
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 lg:w-52">
              <span className="text-sm font-medium text-foreground">Task</span>
              <select
                className={inputCls}
                value={taskSel}
                onChange={(e) => setTaskSel(e.target.value)}
                disabled={!projectSel}
              >
                <option value="">{projectSel ? "No task" : "Pick a project first"}</option>
                {quickTasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={start.isPending}
              className="flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              {start.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Start
            </button>
          </form>
        )}
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">From</span>
          <input
            type="date"
            className={cn(inputCls, "w-auto")}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">To</span>
          <input
            type="date"
            className={cn(inputCls, "w-auto")}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        {isElevated && (
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">User</span>
            <select
              className={cn(inputCls, "w-auto min-w-[160px]")}
              value={userFilter}
              onChange={(e) => setUserFilter(e.target.value)}
            >
              <option value="">Everyone</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {(from || to || userFilter) && (
          <button
            onClick={() => {
              setFrom("");
              setTo("");
              setUserFilter("");
            }}
            className="h-11 rounded-xl border border-border px-4 text-sm font-medium text-muted-foreground hover:border-primary"
          >
            Clear
          </button>
        )}
      </div>

      {/* Entries grouped by day */}
      {isLoading ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
          <Clock className="h-12 w-12" />
          <p className="text-lg">No time entries</p>
          <p className="text-sm">Start the timer above or add a manual entry.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map(([day, dayEntries]) => (
            <div key={day}>
              <div className="mb-2 flex items-baseline justify-between px-1">
                <h3 className="text-sm font-semibold text-foreground">{dayLabel(day)}</h3>
                <span className="text-sm tabular-nums text-muted-foreground">
                  {formatHours(dayEntries.reduce((s, e) => s + e.durationMin, 0))}
                </span>
              </div>
              <div className="divide-y divide-border rounded-xl border border-border bg-card">
                {dayEntries.map((e) => (
                  <div key={e.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {e.description || e.taskTitle || "(no description)"}
                      </p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {isElevated && !userFilter && <span>{userName(e.userId)}</span>}
                        {e.projectName && (
                          <span className="rounded-full bg-muted px-2 py-0.5 font-medium">
                            {e.projectName}
                          </span>
                        )}
                        {e.taskTitle && e.description && (
                          <span className="truncate">{e.taskTitle}</span>
                        )}
                        <span className="tabular-nums">{timeRange(e)}</span>
                      </div>
                    </div>
                    {e.billable && (
                      <CircleDollarSign
                        className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                        aria-label="Billable"
                      />
                    )}
                    <span className="w-16 shrink-0 text-right text-sm font-medium tabular-nums text-foreground">
                      {e.endedAt ? formatHours(e.durationMin) : "running"}
                    </span>
                    {e.endedAt && (
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          onClick={() => {
                            setEditingEntry(e);
                            setDialogOpen(true);
                          }}
                          className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                          aria-label="Edit entry"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => {
                            if (window.confirm("Delete this time entry?")) del.mutate(e.id);
                          }}
                          className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-red-600 dark:hover:text-red-400"
                          aria-label="Delete entry"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <EntryDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        entry={editingEntry}
        projects={projects}
      />
    </div>
  );
}
