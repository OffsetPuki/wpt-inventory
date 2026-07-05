import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { toast } from "@/components/ui/toaster";
import { formatDateTime } from "@/lib/format";
import Header from "@/components/Header";
import { Loader2, RotateCcw, Trash2, FolderKanban, Package } from "lucide-react";
import type { Item, Project } from "@shared/schema";

const RETENTION_DAYS = 30;

interface DeletedItem extends Item { deletedAt: number }
interface DeletedProject extends Project { deletedAt: number }

function daysLeft(deletedAt: number): number {
  const ms = deletedAt + RETENTION_DAYS * 24 * 60 * 60 * 1000 - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

export default function TrashPage() {
  // Restore items needs technician; restore projects needs elevated. The
  // server enforces both — the UI just hides the section the user can't act on.
  const { isTechnician, isElevated } = useAuth();
  const qc = useQueryClient();

  const items = useQuery<DeletedItem[]>({
    queryKey: ["trash", "items"],
    queryFn: async () => (await apiRequest("GET", "/api/items/deleted")).json(),
    enabled: isTechnician,
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
      toast({ variant: "success", title: "Project restored" });
    },
    onError: (e: any) => toast({ variant: "destructive", title: "Restore failed", description: e?.message }),
  });

  return (
    <div className="mx-auto max-w-4xl">
      <Header
        title="Trash"
        description={`Deleted items and projects, recoverable for ${RETENTION_DAYS} days. After that they're purged for good.`}
      />

      {isTechnician && (
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
            <FolderKanban className="h-5 w-5" /> Projects
          </h2>
          {projects.isLoading ? (
            <div className="flex justify-center py-8 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (projects.data ?? []).length === 0 ? (
            <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
              No deleted projects right now.
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

      {!isElevated && !isTechnician && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-12 text-muted-foreground">
          <Trash2 className="h-10 w-10" />
          <p className="text-base">Only managers and technicians can view the trash.</p>
        </div>
      )}
    </div>
  );
}
