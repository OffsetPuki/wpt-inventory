import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {useState} from 'react';
import {useApiMutation} from '@/hooks/useApiMutation';
import {inputCls,secondaryBtn} from '@/lib/ui-styles';
import {RetryBlock} from '@/components/RetryBlock';
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { toast } from "@/components/ui/toaster";
import { formatDateTime } from "@/lib/format";
import Header from "@/components/Header";
import { Loader2, RotateCcw, Trash2, FolderKanban, Package } from "lucide-react";
import type { Item, Project } from "@shared/schema";

const RETENTION_DAYS = 30;
function DeletedCustomers({resource,label}:{resource:'clients'|'leads';label:string}){
  const [search,setSearch]=useState('');
  const query=useQuery<{id:number;name:string;email:string|null;phone:string|null;deletedAt:number}[]>({queryKey:['trash',resource,search],staleTime:0,queryFn:async()=>(await apiRequest('GET',`/api/crm/${resource}/deleted?q=${encodeURIComponent(search)}`)).json()});
  const restore=useApiMutation<unknown,number>({request:id=>({method:'POST',url:`/api/crm/${resource}/${id}/restore`}),invalidate:[['trash',resource],['crm-clients'],['crm-leads'],['crm-client-detail']],successTitle:`${resource==='clients'?'Customer':'Lead'} restored`,errorTitle:'Could not restore'});
  return <section className="mb-8" aria-label={`Deleted ${label.toLowerCase()}`}><h2 className="mb-3 text-lg font-semibold">{label}</h2>
    <input className={`${inputCls} mb-3`} aria-label={`Search deleted ${label.toLowerCase()}`} placeholder="Search by name" value={search} onChange={e=>setSearch(e.target.value)}/>
    {query.isError?<RetryBlock query={query}/>:query.isLoading?<p>Loading…</p>:!query.data?.length?<p className="text-sm text-muted-foreground">No matching deleted {label.toLowerCase()}.</p>:<ul className="space-y-2">{query.data.map(row=><li className="flex items-center justify-between gap-3 rounded-xl border bg-card p-4" key={row.id}><div className="min-w-0"><p className="break-words font-medium">{row.name}</p><p className="break-words text-sm text-muted-foreground">{[row.email,row.phone].filter(Boolean).join(' · ')}</p><p className="text-xs text-muted-foreground">Deleted {formatDateTime(row.deletedAt)}</p></div><button className={secondaryBtn} disabled={restore.isPending} onClick={()=>restore.mutate(row.id)}>Restore</button></li>)}</ul>}
  </section>;
}

interface DeletedItem extends Item { deletedAt: number }
interface DeletedProject extends Project { deletedAt: number }

function daysLeft(deletedAt: number): number {
  const ms = deletedAt + RETENTION_DAYS * 24 * 60 * 60 * 1000 - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

export default function TrashPage() {
  // Restoring (items or projects) is owner-only; the server enforces it and
  // the UI just hides what the user can't act on.
  const { isElevated } = useAuth();
  const qc = useQueryClient();

  const items = useQuery<DeletedItem[]>({
    queryKey: ["trash", "items"],
    queryFn: async () => (await apiRequest("GET", "/api/items/deleted")).json(),
    enabled: isElevated,
  });
  const projects = useQuery<DeletedProject[]>({
    queryKey: ["trash", "projects"],
    queryFn: async () => (await apiRequest("GET", "/api/projects/deleted")).json(),
    enabled: isElevated,
  });

  const restoreItem = useMutation({
    mutationFn: async (id: number) => apiRequest("POST", `/api/items/${id}/restore`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trash"] });
      qc.invalidateQueries({ queryKey: ["items"] });
      toast({ variant: "success", title: "Item restored" });
    },
    onError: (e: any) => toast({ variant: "destructive", title: "Restore failed", description: e?.message }),
  });

  const restoreProject = useMutation({
    mutationFn: async (id: number) => apiRequest("POST", `/api/projects/${id}/restore`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trash"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast({ variant: "success", title: "Job restored", description: "Review material reservations before continuing work." });
    },
    onError: (e: any) => toast({ variant: "destructive", title: "Restore failed", description: e?.message }),
  });

  return (
    <div className="mx-auto max-w-4xl">
      <Header
        title="Trash"
        description={`Restore deleted records here. Items and jobs remain recoverable for ${RETENTION_DAYS} days.`}
      />
      {isElevated&&<><DeletedCustomers resource="clients" label="Customers"/><DeletedCustomers resource="leads" label="Leads"/></>}

      {isElevated && (
        <section className="mb-8">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-foreground">
            <Package className="h-5 w-5" /> Items
          </h2>
          {items.isLoading ? (
            <div className="flex justify-center py-8 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (items.data ?? []).length === 0 ? (
            <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
              No deleted items right now.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {items.data!.map((it) => (
                <li key={it.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{it.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Deleted {formatDateTime(it.deletedAt)} · purges in {daysLeft(it.deletedAt)} day(s)
                    </p>
                  </div>
                  <button
                    onClick={() => restoreItem.mutate(it.id)}
                    disabled={restoreItem.isPending}
                    className="flex h-10 shrink-0 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-60"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {isElevated && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-foreground">
            <FolderKanban className="h-5 w-5" /> Jobs
          </h2>
          {projects.isLoading ? (
            <div className="flex justify-center py-8 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (projects.data ?? []).length === 0 ? (
            <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
              No deleted jobs right now.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {projects.data!.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.jobNumber} · deleted {formatDateTime(p.deletedAt)} · purges in {daysLeft(p.deletedAt)} day(s)
                    </p>
                  </div>
                  <button
                    onClick={() => restoreProject.mutate(p.id)}
                    disabled={restoreProject.isPending}
                    className="flex h-10 shrink-0 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-60"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {!isElevated && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-12 text-muted-foreground">
          <Trash2 className="h-10 w-10" />
          <p className="text-base">Only owners and managers can view Trash.</p>
        </div>
      )}
    </div>
  );
}
