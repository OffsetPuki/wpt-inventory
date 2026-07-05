import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { toast } from "@/components/ui/toaster";
import { PROJECT_STATUSES, type Project, type ProjectStatus } from "@shared/schema";
import { formatDateTime } from "@/lib/format";
import Header from "@/components/Header";
import Modal from "@/components/Modal";
import ProjectChecklist from "@/components/ProjectChecklist";
import { uploadPhoto } from "@/lib/uploadPhoto";
import {
  ArrowLeft,
  Globe,
  Image as ImageIcon,
  ImageOff,
  Loader2,
  PackageMinus,
  PackagePlus,
  Trash2,
  Upload,
} from "lucide-react";

const STATUS_LABEL: Record<ProjectStatus, string> = {
  active: "Active",
  done: "Done",
  on_hold: "On hold",
};

interface UsageTransaction {
  id: number;
  type: "check_out" | "check_in";
  quantity: number;
  item_id?: number;
  item_name?: string;
  // Server pre-extracts the first available photo (json array or legacy column)
  // so the client doesn't have to parse or fall back.
  item_photo?: string | null;
  user_name?: string;
  created_at: number;
}

interface Usage {
  transactions: UsageTransaction[];
}

// Publish the finished job to the cjmmetals.com "recent work" gallery.
// Projects carry no photos of their own, so the dialog asks for one — the
// server requires photoUrl and defaults the title to the project name.
function PublishPortfolioDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(project.name);
  const [category, setCategory] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const publish = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("POST", `/api/projects/${project.id}/publish-portfolio`, {
          title: title.trim() || undefined,
          category: category.trim() || null,
          photoUrl,
        })
      ).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["marketing", "portfolio"] });
      toast({ variant: "success", title: "Published — live on cjmmetals.com within ~5 minutes." });
      onClose();
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not publish", description: e?.message }),
  });

  const pickPhoto = async (file: File) => {
    setUploading(true);
    try {
      setPhotoUrl(await uploadPhoto(file));
    } catch (e: any) {
      toast({ variant: "destructive", title: "Upload failed", description: e?.message });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Publish to website portfolio">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!photoUrl) {
            toast({ variant: "destructive", title: "A photo of the finished work is required" });
            return;
          }
          publish.mutate();
        }}
        className="flex flex-col gap-4"
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Title</span>
          <input
            className="h-11 w-full rounded-xl border border-input bg-background px-3 text-base text-foreground outline-none focus:border-primary"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Category (optional)</span>
          <input
            className="h-11 w-full rounded-xl border border-input bg-background px-3 text-base text-foreground outline-none focus:border-primary"
            placeholder="Gates, Fencing, Carports, Railings…"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
        </label>
        <div className="flex items-center gap-4">
          {photoUrl ? (
            <img src={photoUrl} alt="" className="h-24 w-24 rounded-lg border border-border object-cover" />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground">
              <ImageIcon className="h-8 w-8" />
            </div>
          )}
          <label className="flex h-11 cursor-pointer items-center gap-2 rounded-xl border border-border px-5 font-medium text-foreground hover:bg-accent">
            {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
            {photoUrl ? "Replace photo" : "Upload photo"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && pickPhoto(e.target.files[0])}
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={publish.isPending || uploading}
          className="mt-1 flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          {publish.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Publish to website
        </button>
      </form>
    </Modal>
  );
}

export default function ProjectDetailPage({ id }: { id: string }) {
  const projectId = Number(id);
  // Manager + technician both manage project status / checklist / deletion.
  const { isElevated: isManager } = useAuth();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);

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
            <button
              onClick={() => setPublishOpen(true)}
              className="flex h-11 items-center gap-2 rounded-xl border border-border px-4 font-medium text-foreground transition-colors hover:bg-accent"
            >
              <Globe className="h-5 w-5" />
              Publish to website
            </button>
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

      <ProjectChecklist projectId={projectId} />

      {/* Recent item activity — each row shows the item's photo and links to
          its detail page, so you can jump straight to it from the project. */}
      <div className="mt-6 rounded-xl border border-border bg-card p-5">
        <h2 className="mb-3 text-base font-semibold text-foreground">Recent item activity</h2>
        {!usage || usage.transactions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No items checked out to this project yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {usage.transactions.map((t) => {
              const photo = t.item_photo || null;
              const row = (
                <div className="flex items-center gap-3 rounded-lg border border-transparent p-2 transition-colors hover:border-border hover:bg-accent">
                  <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
                    {photo ? (
                      <img
                        src={photo}
                        alt={t.item_name ?? "Item"}
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                        <ImageOff className="h-5 w-5" />
                      </div>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                    {t.type === "check_out" ? (
                      <PackageMinus className="h-4 w-4 shrink-0 text-orange-600 dark:text-orange-400" />
                    ) : (
                      <PackagePlus className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
                    )}
                    <span className="shrink-0 font-medium text-foreground">
                      {t.type === "check_out" ? "−" : "+"}
                      {t.quantity}
                    </span>
                    <span className="truncate text-foreground">{t.item_name}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {t.user_name}
                    </span>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatDateTime(t.created_at)}
                  </span>
                </div>
              );
              return (
                <li key={t.id}>
                  {t.item_id ? (
                    <Link href={`/item/${t.item_id}`} className="block">
                      {row}
                    </Link>
                  ) : (
                    row
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {publishOpen && (
        <PublishPortfolioDialog project={project} onClose={() => setPublishOpen(false)} />
      )}

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
