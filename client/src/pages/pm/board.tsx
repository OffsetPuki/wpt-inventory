import {L} from '@/lib/language';
import {RecordSelect} from "@/components/RecordSelect";
import {useScopedQuery as useQuery} from "@/hooks/useScopedQuery";
import { RetryBlock } from "@/components/RetryBlock";
import { useEffect,useMemo, useState } from "react";
import {usePageFilters} from '@/hooks/usePageFilters';
import {useApiMutation} from '@/hooks/useApiMutation';
import TaskReschedule from '@/components/TaskReschedule';
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useRecordLink } from '@/lib/record-link';
import { useAuth } from "@/lib/auth";
import { toast } from "@/components/ui/toaster";
import Header from "@/components/Header";
import { cn } from "@/lib/utils";
import { formatDate, todayYmd } from "@/lib/format";
import type { PublicUser } from "@shared/schema";
import {
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  TASK_PRIORITY_LABELS,
  TASK_KIND_LABELS,
  type TaskStatus,
  type TaskPriority,
} from "@shared/pm-schema";
import { Chip } from "@/components/ui/Chip";
import { Plus, Loader2, Search, SquareKanban } from "lucide-react";
import { TaskDialog, inputCls, fmtH, type TaskRow } from "./task-dialog";

const PRIORITY_DOT: Record<TaskPriority, string> = {
  low: "bg-zinc-400",
  medium: "bg-blue-500",
  high: "bg-amber-500",
  urgent: "bg-red-500",
};

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

// ─── Board page ──────────────────────────────────────────────────────────────

export default function PmBoardPage() {
  const { isElevated,user } = useAuth();
  const qc = useQueryClient();
  const [filters,setFilters]=usePageFilters({projectId:'',assigneeId:'',q:'',view:'list',status:'open',page:'0'});
  const {projectId:projectFilter,assigneeId:assigneeFilter,q,view}=filters;
  const page=Math.max(0,Math.floor(Number(filters.page)||0));
  const setProjectFilter=(projectId:string)=>setFilters({projectId}),setAssigneeFilter=(assigneeId:string)=>setFilters({assigneeId}),setQ=(q:string)=>setFilters({q});
  const [selected,setSelected]=useState<number[]>([]),[rescheduling,setRescheduling]=useState(false);
  useEffect(()=>setSelected([]),[projectFilter,assigneeFilter,q,page,filters.status]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TaskRow | null>(null);
  const [dragOver, setDragOver] = useState<TaskStatus | null>(null);


  const { data: users = [] } = useQuery<PublicUser[]>({
    queryKey: ["users"],
    queryFn: async () => (await apiRequest("GET", "/api/users")).json(),
    enabled: isElevated,
  });

  const params = new URLSearchParams();
  if (projectFilter) params.set("projectId", projectFilter);
  if (assigneeFilter) params.set("assigneeId", assigneeFilter);
  if (q.trim()) params.set("q", q.trim());
  if(filters.status)params.set('status',filters.status);
  params.set('limit','100');params.set('page',String(page));
  const qs = params.toString();

  const { data: result, isLoading, isError: loadFailed, error: loadError, refetch: retryLoad } = useQuery<{rows:TaskRow[];total:number}>({
    queryKey: ["pm-tasks", projectFilter, assigneeFilter, q,filters.status,page],
    queryFn: async () => {const r=await apiRequest("GET", `/api/pm/tasks?${qs}`);return {rows:await r.json(),total:Number(r.headers.get('X-Total-Count')||0)};},
  });
  const tasks=result?.rows||[];
  const updateStatus=useApiMutation<any,{task:TaskRow;status:TaskStatus}>({request:({task,status})=>({method:'PATCH',url:`/api/pm/tasks/${task.id}`,body:{status},expectedVersion:task._version}),errorTitle:'Could not update task',successTitle:'Task updated',invalidate:[['pm-tasks']]});

  useRecordLink('task','/api/pm/tasks',task=>{setEditing(task);setDialogOpen(true);});

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
      <Header title="Tasks" description="Choose your next action. Switch to the board when you want to see stages.">
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
      <div className="mb-4 flex flex-wrap gap-2"><button type="button" className="min-h-11 rounded-xl border px-4 text-sm" aria-pressed={view!=='board'} onClick={()=>setFilters({view:'list'})}>List by job</button><button type="button" className="min-h-11 rounded-xl border px-4 text-sm" aria-pressed={view==='board'} onClick={()=>setFilters({view:'board'})}>Board</button><button type="button" className="min-h-11 rounded-xl border px-4 text-sm" aria-pressed={assigneeFilter===String(user?.id)} onClick={()=>setAssigneeFilter(assigneeFilter===String(user?.id)?'':String(user?.id))}>My tasks</button><label className="sr-only" htmlFor="task-stage">Task stage</label><select id="task-stage" className="min-h-11 rounded-xl border bg-background px-3 text-sm" value={filters.status} onChange={e=>setFilters({status:e.target.value})}><option value="open">Open tasks</option><option value="">All stages</option>{TASK_STATUSES.map(s=><option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>)}</select></div>
      {!!selected.length&&<div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border p-3"><span>{selected.length} selected</span><button type="button" className="min-h-11 rounded-lg border px-3 text-sm" onClick={()=>setRescheduling(true)}>Review new due dates</button><button type="button" className="min-h-11 px-3 text-sm underline" onClick={()=>setSelected([])}>Clear selection</button></div>}

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
        <RecordSelect type="jobs"
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className={cn(inputCls, "w-auto min-w-[170px]")}
        />
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

      {loadFailed ? <RetryBlock query={{error:loadError,refetch:retryLoad}}/> : isLoading ? (
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
      ) : view!=='board' ? (
        <div className="space-y-5">{[...new Set(tasks.map(t=>t.projectId))].map(projectId=><section key={projectId||'none'} className="rounded-xl border bg-card p-4"><h2 className="mb-3 font-semibold">{tasks.find(t=>t.projectId===projectId)?.projectName||'Unassigned to a job'}</h2><div className="divide-y">{tasks.filter(t=>t.projectId===projectId).map(t=><article key={t.id} className="flex flex-wrap items-center gap-3 py-3">{isElevated&&t.status!=='done'&&<label className="flex h-11 w-11 shrink-0 items-center justify-center"><input type="checkbox" aria-label={`Select ${t.title}`} className="h-5 w-5" checked={selected.includes(t.id)} disabled={!selected.includes(t.id)&&selected.length>=50} onChange={e=>setSelected(ids=>e.target.checked?[...ids,t.id]:ids.filter(id=>id!==t.id))}/></label>}<button type="button" className="min-h-11 min-w-0 flex-1 text-left" onClick={()=>openEdit(t)}><strong className="block break-words text-sm">{t.title}</strong><span className="text-xs text-muted-foreground">{t.assigneeName||'Unassigned'} · {t.dueDate?`Due ${formatDate(t.dueDate)}`:'No due date'}</span></button><select aria-label={`Status of ${t.title}`} className="min-h-11 max-w-full rounded-lg border bg-background px-3 text-sm" value={t.status} disabled={updateStatus.isPending} onChange={e=>updateStatus.mutate({task:t,status:e.target.value as TaskStatus})}>{TASK_STATUSES.map(s=><option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>)}</select></article>)}</div></section>)}{!tasks.length&&<p>No tasks match these filters.</p>}</div>
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
                    role="button"
                    tabIndex={0}
                    onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openEdit(t);}}}
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
                    {/* Package C: merged follow-ups carry their kind as a chip. */}
                    {(t.kind ?? "task") !== "task" && (
                      <span className="mt-2 mr-1 inline-block">
                        <Chip tone="amber">{TASK_KIND_LABELS[t.kind] ?? "Other"}</Chip>
                      </span>
                    )}
                    {t.projectName && (
                      <span className="mt-2 inline-block rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                        {t.projectName}
                      </span>
                    )}
                    <div className="mt-2 flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        {t.dueDate && (
                          <span
                            className={cn(
                              "text-xs",
                              overdue
                                ? "font-medium text-red-600 dark:text-red-400"
                                : "text-muted-foreground"
                            )}
                          >
                            {formatDate(t.dueDate)}
                          </span>
                        )}
                        {/* Phase D #24b: logged vs estimate, red when over. */}
                        {(t.loggedMin ?? 0) > 0 && t.estimateHours != null && (
                          <span
                            className={cn(
                              "text-xs tabular-nums",
                              (t.loggedMin ?? 0) > t.estimateHours * 60
                                ? "font-medium text-red-600 dark:text-red-400"
                                : "text-muted-foreground"
                            )}
                          >
                            {fmtH(t.loggedMin ?? 0)}/{t.estimateHours}h
                          </span>
                        )}
                      </span>
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
      {!!result?.total&&<nav className="my-4 flex flex-wrap items-center justify-between gap-3" aria-label="Task pages"><button className="min-h-11 rounded-lg border px-3" disabled={!page} onClick={()=>setFilters({page:String(page-1)})}><L>{"Previous"}</L></button><span className="text-sm">{page*100+1}–{Math.min((page+1)*100,result.total)} of {result.total} <L>{"tasks"}</L></span><button className="min-h-11 rounded-lg border px-3" disabled={(page+1)*100>=result.total} onClick={()=>setFilters({page:String(page+1)})}><L>{"Next"}</L></button></nav>}
      {rescheduling&&<TaskReschedule ids={selected} close={()=>{setRescheduling(false);setSelected([]);}}/>}

      <TaskDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        task={editing}
        users={users}
        isElevated={isElevated}
      />
    </div>
  );
}
