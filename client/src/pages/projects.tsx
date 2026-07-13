import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { toast } from "@/components/ui/toaster";
import type { Project, ProjectStatus } from "@shared/schema";
import type { Client } from "@shared/crm-schema";
import Header from "@/components/Header";
import Modal from "@/components/Modal";
import FromTemplateDialog from "@/components/FromTemplateDialog";
import { cn } from "@/lib/utils";
import { Sparkles, Plus, FolderKanban, Loader2, Search } from "lucide-react";

const STATUS_STYLE: Record<ProjectStatus, string> = {
  active: "bg-green-500/15 text-green-700 dark:text-green-400",
  done: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  on_hold: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
};
const STATUS_LABEL: Record<ProjectStatus, string> = {
  active: "Active",
  done: "Done",
  on_hold: "On hold",
};

const inputCls =
  "h-11 w-full rounded-lg border border-input bg-background px-3 text-base text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring";

function NewProjectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const [jobNumber, setJobNumber] = useState("");
  const [name, setName] = useState("");
  const [customer, setCustomer] = useState("");
  const [clientId, setClientId] = useState<number | null>(null);
  const [notes, setNotes] = useState("");

  // Fix 2 (wiring plan): jobs link to a CRM client by id. The picker is
  // optional — free-text customer still works for non-CRM names.
  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ["crm-clients-picker"],
    queryFn: async () => (await apiRequest("GET", "/api/crm/clients?status=active")).json(),
    enabled: open,
  });

  const create = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("POST", "/api/projects", {
          jobNumber: jobNumber.trim(),
          name: name.trim(),
          customer: customer.trim() || undefined,
          clientId: clientId ?? undefined,
          notes: notes.trim() || undefined,
        })
      ).json(),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast({ variant: "success", title: "Project created" });
      onClose();
      setLocation(`/project/${p.id}`);
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not create", description: e?.message }),
  });

  return (
    <Modal open={open} onClose={onClose} title="New project">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!jobNumber.trim() || !name.trim()) {
            toast({ variant: "destructive", title: "Job number and name are required" });
            return;
          }
          create.mutate();
        }}
        className="flex flex-col gap-4"
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Job number</span>
          <input className={inputCls} value={jobNumber} onChange={(e) => setJobNumber(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Project name</span>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">CRM client (optional)</span>
          <select
            className={inputCls}
            value={clientId ?? ""}
            onChange={(e) => {
              const id = e.target.value ? parseInt(e.target.value, 10) : null;
              setClientId(id);
              // Prefill the display name; still editable below.
              const c = clients.find((cl) => cl.id === id);
              if (c) setCustomer(c.name);
            }}
          >
            <option value="">— not linked —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}{c.company ? ` (${c.company})` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Customer name (optional)</span>
          <input className={inputCls} value={customer} onChange={(e) => setCustomer(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Notes (optional)</span>
          <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <button
          type="submit"
          disabled={create.isPending}
          className="mt-1 flex h-12 items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          {create.isPending && <Loader2 className="h-5 w-5 animate-spin" />}
          Create project
        </button>
      </form>
    </Modal>
  );
}

export default function ProjectsPage() {
  // Manager + technician both create / manage projects.
  const { isElevated: isManager } = useAuth();
  const [, setLocation] = useLocation();
  const [q, setQ] = useState("");
  const [templateOpen, setTemplateOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  const { data: projects = [], isLoading } = useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: async () => (await apiRequest("GET", "/api/projects")).json(),
  });

  const filtered = projects.filter(
    (p) =>
      !q ||
      p.name.toLowerCase().includes(q.toLowerCase()) ||
      p.jobNumber.toLowerCase().includes(q.toLowerCase()) ||
      (p.customer ?? "").toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div className="mx-auto max-w-5xl">
      <Header title="Projects" description="Jobs, builds, and service dispatches">
        {isManager && (
          <>
            <button
              onClick={() => setTemplateOpen(true)}
              className="flex h-11 items-center gap-2 rounded-xl border border-border px-5 font-medium text-foreground transition-colors hover:border-primary"
            >
              <Sparkles className="h-5 w-5" />
              Start from template
            </button>
            <button
              onClick={() => setNewOpen(true)}
              className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90"
            >
              <Plus className="h-5 w-5" />
              New project
            </button>
          </>
        )}
      </Header>

      <div className="relative mb-6">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search projects…"
          className="h-12 w-full rounded-xl border border-input bg-card pl-12 pr-4 text-base text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring"
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
          <FolderKanban className="h-12 w-12" />
          <p className="text-lg">No projects yet</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <Link
              key={p.id}
              href={`/project/${p.id}`}
              className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-mono text-xs text-muted-foreground">{p.jobNumber}</span>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-xs font-medium",
                    STATUS_STYLE[p.status]
                  )}
                >
                  {STATUS_LABEL[p.status]}
                </span>
              </div>
              <h3 className="font-semibold text-foreground">{p.name}</h3>
              {p.customer && <p className="text-sm text-muted-foreground">{p.customer}</p>}
            </Link>
          ))}
        </div>
      )}

      <FromTemplateDialog
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
        onCreated={(id) => setLocation(`/project/${id}`)}
      />
      <NewProjectModal open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}
