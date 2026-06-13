import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { toast } from "@/components/ui/toaster";
import type { Item, Project } from "@shared/schema";
import Header from "@/components/Header";
import { cn } from "@/lib/utils";
import { Loader2, Link2, EyeOff, RefreshCw } from "lucide-react";

interface QbItem {
  qb_id: string;
  name: string;
  sku: string | null;
  type: string | null;
  item_id: number | null;
  local_item_name?: string | null;
  map_status: "unmatched" | "matched" | "ignored";
}

interface QbCustomer {
  qb_id: string;
  display_name: string;
  is_project: number;
  project_id: number | null;
  project_name?: string | null;
  job_number?: string | null;
}

interface QueueRow {
  id: number;
  kind: string;
  status: string;
  last_error: string | null;
  qb_doc_id: string | null;
  created_at: number;
}

const selectCls =
  "h-9 max-w-[260px] rounded-lg border border-input bg-background px-2 text-sm text-foreground outline-none focus:border-primary";

function ItemMappingSection() {
  const qc = useQueryClient();
  const { data: qbItems = [], isLoading } = useQuery<QbItem[]>({
    queryKey: ["qb-items"],
    queryFn: async () => (await apiRequest("GET", "/api/qb/mappings/items")).json(),
  });
  const { data: items = [] } = useQuery<Item[]>({
    queryKey: ["items"],
    queryFn: async () => (await apiRequest("GET", "/api/items")).json(),
  });

  const map = useMutation({
    mutationFn: async (p: { qbId: string; itemId?: number; ignore?: boolean }) =>
      apiRequest("POST", `/api/qb/mappings/items/${encodeURIComponent(p.qbId)}`, p),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["qb-items"] }),
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Mapping failed", description: e?.message }),
  });

  const unmatched = qbItems.filter((q) => q.map_status === "unmatched");
  const matched = qbItems.filter((q) => q.map_status === "matched");

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h2 className="mb-1 text-base font-semibold text-foreground">Item mapping</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Link QuickBooks items to inventory items so issues and receipts line up.
        {matched.length > 0 && ` ${matched.length} matched.`}
      </p>

      {isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : unmatched.length === 0 ? (
        <p className="text-sm text-green-400">All QuickBooks items are mapped or ignored.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {unmatched.map((q) => (
            <li key={q.qb_id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 p-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{q.name}</p>
                <p className="text-xs text-muted-foreground">
                  {q.sku ? `SKU ${q.sku} · ` : ""}{q.type ?? "Item"}
                </p>
              </div>
              <select
                className={selectCls}
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) map.mutate({ qbId: q.qb_id, itemId: Number(e.target.value) });
                }}
              >
                <option value="" disabled>Link to inventory item…</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>{i.name}</option>
                ))}
              </select>
              <button
                onClick={() => map.mutate({ qbId: q.qb_id, ignore: true })}
                className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-muted-foreground hover:border-primary"
                title="Hide this QuickBooks item (not tracked here)"
              >
                <EyeOff className="h-4 w-4" />
                Ignore
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProjectMappingSection() {
  const qc = useQueryClient();
  const { data: customers = [], isLoading } = useQuery<QbCustomer[]>({
    queryKey: ["qb-customers"],
    queryFn: async () => (await apiRequest("GET", "/api/qb/mappings/projects")).json(),
  });
  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: async () => (await apiRequest("GET", "/api/projects")).json(),
  });

  const map = useMutation({
    mutationFn: async (p: { qbId: string; projectId: number | null }) =>
      apiRequest("POST", `/api/qb/mappings/projects/${encodeURIComponent(p.qbId)}`, p),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["qb-customers"] }),
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Mapping failed", description: e?.message }),
  });

  // Projects/jobs first — they're what issues get costed to.
  const sorted = [...customers].sort((a, b) => (b.is_project - a.is_project));
  const unmapped = sorted.filter((c) => !c.project_id);
  const mapped = sorted.filter((c) => c.project_id);

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h2 className="mb-1 text-base font-semibold text-foreground">Project mapping</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Link QuickBooks customers/projects to jobs so issued parts cost to the right job.
        {mapped.length > 0 && ` ${mapped.length} mapped.`}
      </p>

      {isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : unmapped.length === 0 ? (
        <p className="text-sm text-green-400">All QuickBooks customers are mapped.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {unmapped.map((c) => (
            <li key={c.qb_id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 p-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{c.display_name}</p>
                <p className="text-xs text-muted-foreground">{c.is_project ? "Project" : "Customer"}</p>
              </div>
              <select
                className={selectCls}
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) map.mutate({ qbId: c.qb_id, projectId: Number(e.target.value) });
                }}
              >
                <option value="" disabled>Link to job…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.jobNumber} — {p.name}</option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function QueueSection() {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery<QueueRow[]>({
    queryKey: ["qb-queue"],
    queryFn: async () => (await apiRequest("GET", "/api/qb/queue")).json(),
  });

  const retry = useMutation({
    mutationFn: async (id: number) => apiRequest("POST", `/api/qb/queue/${id}/retry`),
    onSuccess: () => {
      toast({ variant: "success", title: "Retrying", description: "Re-queued for the next sync." });
      qc.invalidateQueries({ queryKey: ["qb-queue"] });
    },
    onError: (e: any) => toast({ variant: "destructive", title: "Retry failed", description: e?.message }),
  });

  if (rows.length === 0) return null;

  const KIND_LABEL: Record<string, string> = {
    issue: "Issue to job",
    issue_return: "Return from job",
    adjust: "Adjustment",
  };
  const STATUS_STYLE: Record<string, string> = {
    pending: "bg-secondary text-secondary-foreground",
    done: "bg-green-500/15 text-green-400",
    error: "bg-destructive/15 text-destructive",
    manual: "bg-orange-500/15 text-orange-400",
  };

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h2 className="mb-1 text-base font-semibold text-foreground">Sync queue</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Outbound events. “Manual” rows couldn't be pushed automatically and
        need to be entered in QuickBooks by hand.
      </p>
      <ul className="flex flex-col gap-1.5">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLE[r.status] ?? "bg-secondary")}>
              {r.status}
            </span>
            <span className="text-foreground">{KIND_LABEL[r.kind] ?? r.kind}</span>
            {r.qb_doc_id && <span className="text-xs text-muted-foreground">QB doc {r.qb_doc_id}</span>}
            {r.last_error && <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{r.last_error}</span>}
            {(r.status === "error" || r.status === "manual") && (
              <button
                onClick={() => retry.mutate(r.id)}
                disabled={retry.isPending}
                className="ml-auto flex h-7 items-center gap-1 rounded-lg border border-border px-2 text-xs font-medium text-foreground hover:border-primary disabled:opacity-60"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Retry
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function QuickBooksPage() {
  const qc = useQueryClient();
  const [syncing, setSyncing] = useState(false);

  async function syncNow() {
    setSyncing(true);
    try {
      const res = await apiRequest("POST", "/api/qb/sync");
      const s = await res.json();
      toast({
        variant: "success",
        title: "Synced with QuickBooks",
        description: `${s.purchaseOrders} POs, ${s.items} items, ${s.customers} customers. ${s.autoMatchedItems + s.autoMatchedProjects} auto-matched.`,
      });
      qc.invalidateQueries({ queryKey: ["qb-items"] });
      qc.invalidateQueries({ queryKey: ["qb-customers"] });
      qc.invalidateQueries({ queryKey: ["qb-queue"] });
      qc.invalidateQueries({ queryKey: ["pos"] });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Sync failed", description: e?.message });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Header title="QuickBooks" description="Mapping and sync between QuickBooks Online and inventory">
        <button
          onClick={syncNow}
          disabled={syncing}
          className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          {syncing ? <Loader2 className="h-5 w-5 animate-spin" /> : <RefreshCw className="h-5 w-5" />}
          Sync now
        </button>
      </Header>

      <div className="flex flex-col gap-5">
        <ItemMappingSection />
        <ProjectMappingSection />
        <QueueSection />
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Link2 className="h-3.5 w-3.5" />
          Connection is managed in Settings → QuickBooks.
        </p>
      </div>
    </div>
  );
}
