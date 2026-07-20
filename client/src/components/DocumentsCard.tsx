import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getAuthToken } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { toast } from "@/components/ui/toaster";
import { useApiMutation } from "@/hooks/useApiMutation";
import { inputCls, primaryBtn } from "@/lib/ui-styles";
import Modal from "@/components/Modal";
import { cn } from "@/lib/utils";
import { formatDate, todayYmd } from "@/lib/format";
import {
  DOCUMENT_KINDS,
  DOCUMENT_KIND_LABELS,
  type DocumentKind,
  type PmDocument,
} from "@shared/pm-schema";
import { Download, FileText, Loader2, Trash2, Upload } from "lucide-react";

// ─── Compliance documents card (Phase G #4) ──────────────────────────────────
// Two homes, one component: a job's docs (project-detail, projectId set) and
// the company-level COI/W-9 the owner sends to GCs (settings, projectId
// absent). Files are PDFs/images stored server-side and only reachable through
// the authed download endpoint — hence the fetch+blob download, not a plain
// <a href> (same reasoning as the settings BackupCard).

export default function DocumentsCard({
  projectId,
  title = "Documents",
  description,
}: {
  projectId?: number;
  title?: string;
  description?: string;
}) {
  const { isElevated } = useAuth();
  const qc = useQueryClient();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [kind, setKind] = useState<DocumentKind>(projectId != null ? "lien_waiver" : "coi");
  const [docTitle, setDocTitle] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const queryKey = ["pm-documents", projectId ?? "company"];
  const { data: docs = [] } = useQuery<PmDocument[]>({
    queryKey,
    queryFn: async () =>
      (await apiRequest(
        "GET",
        projectId != null ? `/api/pm/documents?projectId=${projectId}` : "/api/pm/documents?company=1",
      )).json(),
    retry: false,
  });

  const del = useApiMutation<unknown, number>({
    request: (id) => ({ method: "DELETE", url: `/api/pm/documents/${id}` }),
    invalidate: [queryKey],
    successTitle: "Document deleted",
    errorTitle: "Could not delete",
  });

  async function upload() {
    if (!file) {
      toast({ variant: "destructive", title: "Pick a file first" });
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", kind);
      if (docTitle.trim()) fd.append("title", docTitle.trim());
      if (expiresAt) fd.append("expiresAt", expiresAt);
      if (projectId != null) fd.append("projectId", String(projectId));
      const token = getAuthToken();
      const res = await fetch("/api/pm/documents", {
        method: "POST",
        headers: token ? { "X-Auth": token } : {},
        body: fd,
      });
      if (!res.ok) {
        throw new Error((await res.json().catch(() => null))?.message ?? "Upload failed");
      }
      qc.invalidateQueries({ queryKey });
      toast({ variant: "success", title: "Document uploaded" });
      setUploadOpen(false);
      setDocTitle("");
      setExpiresAt("");
      setFile(null);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Upload failed", description: e?.message });
    } finally {
      setUploading(false);
    }
  }

  async function download(doc: PmDocument) {
    setDownloadingId(doc.id);
    try {
      const res = await apiRequest("GET", `/api/pm/documents/${doc.id}/file`);
      const blob = await res.blob();
      const name =
        res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? doc.title;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Download failed", description: e?.message });
    } finally {
      setDownloadingId(null);
    }
  }

  const today = todayYmd();
  // "Expiring soon" horizon — matches the automations sweep's 30-day nag.
  const d30 = new Date(Date.now() + 30 * 86400000);
  const soon = `${d30.getFullYear()}-${String(d30.getMonth() + 1).padStart(2, "0")}-${String(d30.getDate()).padStart(2, "0")}`;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {isElevated && (
          <button
            onClick={() => setUploadOpen(true)}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium text-foreground hover:border-primary"
          >
            <Upload className="h-4 w-4" />
            Upload
          </button>
        )}
      </div>
      {description && <p className="mb-3 text-sm text-muted-foreground">{description}</p>}
      {docs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {projectId != null
            ? "No documents on this job yet — COIs, lien waivers, signed contracts."
            : "Nothing here yet — upload your COI and W-9 so they're ready to send to GCs."}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-3 py-2 text-sm">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">{d.title}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {DOCUMENT_KIND_LABELS[d.kind]}
              </span>
              {d.expiresAt && (
                <span
                  className={cn(
                    "shrink-0 text-xs",
                    d.expiresAt < today
                      ? "font-medium text-red-600 dark:text-red-400"
                      : d.expiresAt <= soon
                        ? "font-medium text-amber-700 dark:text-amber-400"
                        : "text-muted-foreground",
                  )}
                >
                  {d.expiresAt < today ? "Expired" : "Expires"} {formatDate(d.expiresAt)}
                </span>
              )}
              <button
                aria-label="Download"
                title="Download"
                disabled={downloadingId === d.id}
                onClick={() => download(d)}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-60"
              >
                {downloadingId === d.id
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Download className="h-4 w-4" />}
              </button>
              {isElevated && (
                <button
                  aria-label="Delete"
                  title="Delete"
                  disabled={del.isPending}
                  onClick={() => {
                    if (window.confirm(`Delete '${d.title}'?`)) del.mutate(d.id);
                  }}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-red-600 disabled:opacity-60"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal open={uploadOpen} onClose={() => setUploadOpen(false)} title="Upload document">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void upload();
          }}
          className="flex flex-col gap-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-foreground">Kind</span>
              <select
                className={inputCls}
                value={kind}
                onChange={(e) => setKind(e.target.value as DocumentKind)}
              >
                {DOCUMENT_KINDS.map((k) => (
                  <option key={k} value={k}>{DOCUMENT_KIND_LABELS[k]}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-foreground">Expires (optional)</span>
              <input
                type="date"
                className={inputCls}
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </label>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Title (optional)</span>
            <input
              className={inputCls}
              placeholder="Defaults to the file name"
              value={docTitle}
              onChange={(e) => setDocTitle(e.target.value)}
            />
          </label>
          <label className="flex h-11 w-fit cursor-pointer items-center gap-2 rounded-xl border border-border px-5 font-medium text-foreground hover:bg-accent">
            <Upload className="h-5 w-5" />
            {file ? file.name : "Choose file (PDF or image)"}
            <input
              type="file"
              accept="application/pdf,image/*"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <button type="submit" disabled={uploading} className={primaryBtn}>
            {uploading && <Loader2 className="h-5 w-5 animate-spin" />}
            Upload
          </button>
        </form>
      </Modal>
    </div>
  );
}
