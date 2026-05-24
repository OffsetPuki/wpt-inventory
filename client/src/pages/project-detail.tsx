import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { toast } from "@/components/ui/toaster";
import { PROJECT_STATUSES, type Project, type ProjectStatus, type Category } from "@shared/schema";
import { CATEGORY_LABELS, formatDateTime } from "@/lib/format";
import Header from "@/components/Header";
import Modal from "@/components/Modal";
import ProjectChecklist from "@/components/ProjectChecklist";
import { ArrowLeft, Loader2, PackageMinus, PackagePlus, Trash2 } from "lucide-react";

const STATUS_LABEL: Record<ProjectStatus, string> = {
  active: "Active",
  done: "Done",
  on_hold: "On hold",
};

interface Usage {
  totalItems: number;
  byCategory: Record<string, number>;
  topItems: { name: string; count: number }[];
  transactions: {
    id: number;
    type: "check_out" | "check_in";
    quantity: number;
    item_name?: string;
    user_name?: string;
    created_at: number;
  }[];
}

export default function ProjectDetailPage({ id }: { id: string }) {
  const projectId = Number(id);
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: project, isLoading } = useQuery<Project>({
    queryKey: ["project", projectId],
    queryFn: async () => (await apiRequest("GET", `/api/projects/${projectId}`)).json(),
  });

  const { data: usage } = useQuery<Usage>({
    queryKey: ["project-usage", projectId],
    queryFn: async () => (await apiRequest("GET", `/api/projects/${projectId}/usage`)).json(),
  });

  const setStatus = useMutation({
    mutationFn: async (status: ProjectStatus) =>
      apiRequest("PATCH", `/api/projects/${projectId}`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Update failed", description: e?.message }),
  });

  const del = useMutation({
    mutationFn: async () => apiRequest("DELETE", `/api/projects/${projectId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast({ variant: "success", title: "Project deleted" });
      setLocation("/projects");
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not delete", description: e?.message }),
  });

  if (isLoading || !project) {
    return (
      <div className="flex justify-center py-20 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const catEntries = usage ? Object.entries(usage.byCategory) : [];
  const maxCat = catEntries.reduce((m, [, v]) => Math.max(m, v), 0) || 1;

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/projects"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to projects
      </Link>

      <Header title={project.name} description={`${project.jobNumber}${project.customer ? ` · ${project.customer}` : ""}`}>
        {isManager ? (
          <>
            <select
              value={project.status}
              onChange={(e) => setStatus.mutate(e.target.value as ProjectStatus)}
              className="h-11 rounded-xl border border-input bg-background px-3 text-base text-foreground outline-none focus:border-primary"
            >
              {PROJECT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex h-11 items-center gap-2 rounded-xl border border-destructive/40 px-4 font-medium text-destructive transition-colors hover:bg-destructive/10"
            >
              <Trash2 className="h-5 w-5" />
              Delete
            </button>
          </>
        ) : (
          <span className="rounded-full bg-secondary px-3 py-1 text-sm text-secondary-foreground">
            {STATUS_LABEL[project.status]}
          </span>
        )}
      </Header>

      {project.notes && (
        <div className="mb-6 rounded-xl border border-border bg-card p-5">
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{project.notes}</p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Totals */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-1 text-base font-semibold text-foreground">Items used</h2>
          <p className="text-3xl font-bold text-foreground">{usage?.totalItems ?? 0}</p>
          <div className="mt-4 flex flex-col gap-2">
            {catEntries.map(([cat, count]) => (
              <div key={cat}>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{CATEGORY_LABELS[cat as Category] ?? cat}</span>
                  <span>{count}</span>
                </div>
                <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${(count / maxCat) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Checklist spans 2 cols */}
        <div className="lg:col-span-2">
          <ProjectChecklist projectId={projectId} />
        </div>
      </div>

      {/* Items used / transactions */}
      <div className="mt-6 rounded-xl border border-border bg-card p-5">
        <h2 className="mb-3 text-base font-semibold text-foreground">Recent item activity</h2>
        {!usage || usage.transactions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No items checked out to this project yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {usage.transactions.map((t) => (
              <li key={t.id} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  {t.type === "check_out" ? (
                    <PackageMinus className="h-4 w-4 text-orange-400" />
                  ) : (
                    <PackagePlus className="h-4 w-4 text-green-400" />
                  )}
                  <span className="text-foreground">
                    {t.type === "check_out" ? "−" : "+"}
                    {t.quantity}
                  </span>
                  <span className="text-foreground">{t.item_name}</span>
                  <span className="text-muted-foreground">{t.user_name}</span>
                </span>
                <span className="text-xs text-muted-foreground">{formatDateTime(t.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete project?">
        <p className="text-sm text-muted-foreground">
          This permanently removes{" "}
          <span className="font-medium text-foreground">{project.name}</span> and its checklist.
          This cannot be undone.
        </p>
        <div className="mt-5 flex justify-end gap-3">
          <button
            onClick={() => setConfirmDelete(false)}
            className="h-11 rounded-xl border border-border px-5 font-medium text-foreground hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={() => del.mutate()}
            disabled={del.isPending}
            className="flex h-11 items-center gap-2 rounded-xl bg-destructive px-5 font-semibold text-destructive-foreground hover:opacity-90 disabled:opacity-60"
          >
            {del.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Delete
          </button>
        </div>
      </Modal>
    </div>
  );
}
