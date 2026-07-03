import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { toast } from "@/components/ui/toaster";
import Header from "@/components/Header";
import Modal from "@/components/Modal";
import { cn } from "@/lib/utils";
import { formatMoney, parseMoney, formatDate } from "@/lib/format";
import type { Project } from "@shared/schema";
import type { Client } from "@shared/crm-schema";
import {
  CONTRACT_KINDS,
  CONTRACT_STATUSES,
  CONTRACT_KIND_LABELS,
  CONTRACT_STATUS_LABELS,
  type Contract,
  type ContractKind,
  type ContractStatus,
} from "@shared/pm-schema";
import { FileSignature, Loader2, Plus, Pencil, Trash2 } from "lucide-react";

type ContractRow = Contract & { projectName: string | null };

const inputCls =
  "h-11 w-full rounded-lg border border-input bg-background px-3 text-base text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring";

const KIND_CHIP: Record<ContractKind, string> = {
  contract: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  sow: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  nda: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  msa: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
  other: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
};

const STATUS_CHIP: Record<ContractStatus, string> = {
  draft: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
  sent: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  signed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  active: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  expired: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  terminated: "bg-red-500/10 text-red-700 dark:text-red-400",
};

function ymdToDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function dateSpan(c: ContractRow): string {
  const s = c.startDate ? formatDate(ymdToDate(c.startDate)) : "";
  const e = c.endDate ? formatDate(ymdToDate(c.endDate)) : "";
  if (s && e) return `${s} → ${e}`;
  if (s) return `${s} →`;
  if (e) return `→ ${e}`;
  return "—";
}

// ─── Create / edit dialog ────────────────────────────────────────────────────

function ContractDialog({
  open,
  onClose,
  contract,
  projects,
  clients,
}: {
  open: boolean;
  onClose: () => void;
  contract: ContractRow | null;
  projects: Project[];
  clients: Client[];
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<ContractKind>("contract");
  const [status, setStatus] = useState<ContractStatus>("draft");
  const [clientSel, setClientSel] = useState("");
  const [clientNameText, setClientNameText] = useState("");
  const [projectSel, setProjectSel] = useState("");
  const [valueStr, setValueStr] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [body, setBody] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    setTitle(contract?.title ?? "");
    setKind(contract?.kind ?? "contract");
    setStatus(contract?.status ?? "draft");
    setClientSel(contract?.clientId ? String(contract.clientId) : "");
    setClientNameText(contract?.clientId ? "" : contract?.clientName ?? "");
    setProjectSel(contract?.projectId ? String(contract.projectId) : "");
    setValueStr(
      contract && contract.valueCents ? String(contract.valueCents / 100) : ""
    );
    setStartDate(contract?.startDate ?? "");
    setEndDate(contract?.endDate ?? "");
    setBody(contract?.body ?? "");
    setNotes(contract?.notes ?? "");
  }, [open, contract]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        title: title.trim(),
        kind,
        status,
        clientId: clientSel ? Number(clientSel) : null,
        clientName: clientSel ? null : clientNameText.trim() || null,
        projectId: projectSel ? Number(projectSel) : null,
        valueCents: parseMoney(valueStr),
        startDate: startDate || null,
        endDate: endDate || null,
        body: body.trim() || null,
        notes: notes.trim() || null,
      };
      return contract
        ? (await apiRequest("PATCH", `/api/pm/contracts/${contract.id}`, payload)).json()
        : (await apiRequest("POST", "/api/pm/contracts", payload)).json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pm-contracts"] });
      toast({ variant: "success", title: contract ? "Contract updated" : "Contract created" });
      onClose();
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not save", description: e?.message }),
  });

  const del = useMutation({
    mutationFn: async () =>
      (await apiRequest("DELETE", `/api/pm/contracts/${contract!.id}`)).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pm-contracts"] });
      toast({ variant: "success", title: "Contract deleted" });
      onClose();
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not delete", description: e?.message }),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={contract ? "Edit contract" : "New contract"}
      maxWidth="max-w-2xl"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) {
            toast({ variant: "destructive", title: "Title is required" });
            return;
          }
          save.mutate();
        }}
        className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1"
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Title</span>
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Kind</span>
            <select
              className={inputCls}
              value={kind}
              onChange={(e) => setKind(e.target.value as ContractKind)}
            >
              {CONTRACT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {CONTRACT_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Status</span>
            <select
              className={inputCls}
              value={status}
              onChange={(e) => setStatus(e.target.value as ContractStatus)}
            >
              {CONTRACT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {CONTRACT_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Client</span>
            <select
              className={inputCls}
              value={clientSel}
              onChange={(e) => setClientSel(e.target.value)}
            >
              <option value="">No linked client (type a name below)</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.company ? ` — ${c.company}` : ""}
                </option>
              ))}
            </select>
          </label>
          {!clientSel && (
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-foreground">Client name (free text)</span>
              <input
                className={inputCls}
                value={clientNameText}
                onChange={(e) => setClientNameText(e.target.value)}
                placeholder="Acme Corp"
              />
            </label>
          )}
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Project (optional)</span>
            <select
              className={inputCls}
              value={projectSel}
              onChange={(e) => setProjectSel(e.target.value)}
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
            <span className="text-sm font-medium text-foreground">Value ($)</span>
            <input
              className={inputCls}
              value={valueStr}
              onChange={(e) => setValueStr(e.target.value)}
              placeholder="0.00"
              inputMode="decimal"
            />
          </label>
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
            <span className="text-sm font-medium text-foreground">End date</span>
            <input
              type="date"
              className={inputCls}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </label>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Body / scope of work</span>
          <textarea
            className={cn(inputCls, "h-auto min-h-[140px] py-2")}
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Scope, deliverables, terms…"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Notes (optional)</span>
          <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

        <div className="mt-1 flex items-center gap-2">
          {contract && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm("Delete this contract?")) del.mutate();
              }}
              disabled={del.isPending}
              className="flex h-11 items-center gap-2 rounded-xl border border-border px-4 font-medium text-red-600 hover:border-red-500 disabled:opacity-60 dark:text-red-400"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          )}
          <button
            type="submit"
            disabled={save.isPending}
            className="ml-auto flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {contract ? "Save changes" : "Create contract"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Read view ───────────────────────────────────────────────────────────────

function ContractViewModal({
  contract,
  onClose,
  onEdit,
  canEdit,
}: {
  contract: ContractRow | null;
  onClose: () => void;
  onEdit: () => void;
  canEdit: boolean;
}) {
  return (
    <Modal
      open={!!contract}
      onClose={onClose}
      title={contract?.title ?? ""}
      maxWidth="max-w-2xl"
    >
      {contract && (
        <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "rounded-full px-2.5 py-0.5 text-xs font-medium",
                KIND_CHIP[contract.kind]
              )}
            >
              {CONTRACT_KIND_LABELS[contract.kind]}
            </span>
            <span
              className={cn(
                "rounded-full px-2.5 py-0.5 text-xs font-medium",
                STATUS_CHIP[contract.status]
              )}
            >
              {CONTRACT_STATUS_LABELS[contract.status]}
            </span>
          </div>
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <p className="text-xs uppercase text-muted-foreground">Client</p>
              <p className="mt-0.5 font-medium text-foreground">
                {contract.clientName || "—"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">Project</p>
              <p className="mt-0.5 font-medium text-foreground">
                {contract.projectName || "—"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">Value</p>
              <p className="mt-0.5 font-medium tabular-nums text-foreground">
                {formatMoney(contract.valueCents)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">Dates</p>
              <p className="mt-0.5 font-medium text-foreground">{dateSpan(contract)}</p>
            </div>
          </div>
          {contract.body && (
            <div>
              <p className="mb-1.5 text-xs uppercase text-muted-foreground">Body / scope</p>
              <div className="whitespace-pre-wrap rounded-lg bg-muted/40 p-4 text-sm leading-relaxed text-foreground">
                {contract.body}
              </div>
            </div>
          )}
          {contract.notes && (
            <div>
              <p className="mb-1 text-xs uppercase text-muted-foreground">Notes</p>
              <p className="text-sm text-foreground">{contract.notes}</p>
            </div>
          )}
          {canEdit && (
            <div className="flex justify-end">
              <button
                onClick={onEdit}
                className="flex h-11 items-center gap-2 rounded-xl border border-border px-5 font-medium text-foreground hover:border-primary"
              >
                <Pencil className="h-4 w-4" />
                Edit
              </button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// ─── Contracts page ──────────────────────────────────────────────────────────

export default function PmContractsPage() {
  const { isElevated } = useAuth();
  const [kindTab, setKindTab] = useState<"" | ContractKind>("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ContractRow | null>(null);
  const [viewing, setViewing] = useState<ContractRow | null>(null);

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: async () => (await apiRequest("GET", "/api/projects")).json(),
  });

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ["crm-clients"],
    queryFn: async () => (await apiRequest("GET", "/api/crm/clients")).json(),
  });

  const params = new URLSearchParams();
  if (kindTab) params.set("kind", kindTab);
  if (statusFilter) params.set("status", statusFilter);
  const qs = params.toString();

  const { data: contracts = [], isLoading } = useQuery<ContractRow[]>({
    queryKey: ["pm-contracts", kindTab, statusFilter],
    queryFn: async () =>
      (await apiRequest("GET", `/api/pm/contracts${qs ? `?${qs}` : ""}`)).json(),
  });

  const tabs: { value: "" | ContractKind; label: string }[] = [
    { value: "", label: "All" },
    ...CONTRACT_KINDS.map((k) => ({ value: k, label: CONTRACT_KIND_LABELS[k] })),
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <Header title="Contracts & SOWs" description="Agreements, scopes of work, and NDAs">
        {isElevated && (
          <button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
            className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-5 w-5" />
            New contract
          </button>
        )}
      </Header>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1.5">
          {tabs.map((t) => (
            <button
              key={t.value}
              onClick={() => setKindTab(t.value)}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                kindTab === t.value
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:border-primary hover:text-foreground"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className={cn(inputCls, "ml-auto w-auto min-w-[150px]")}
        >
          <option value="">All statuses</option>
          {CONTRACT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {CONTRACT_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : contracts.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
          <FileSignature className="h-12 w-12" />
          <p className="text-lg">No contracts yet</p>
          {isElevated && (
            <button
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
              className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90"
            >
              <Plus className="h-5 w-5" />
              Create the first contract
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-muted-foreground">
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Kind</th>
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium">Project</th>
                <th className="px-4 py-3 text-right font-medium">Value</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Dates</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border border-t border-border">
              {contracts.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => setViewing(c)}
                  className="cursor-pointer transition-colors hover:bg-accent/50"
                >
                  <td className="px-4 py-3 font-medium text-foreground">{c.title}</td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-xs font-medium",
                        KIND_CHIP[c.kind]
                      )}
                    >
                      {CONTRACT_KIND_LABELS[c.kind]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{c.clientName || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.projectName || "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-foreground">
                    {formatMoney(c.valueCents)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-xs font-medium",
                        STATUS_CHIP[c.status]
                      )}
                    >
                      {CONTRACT_STATUS_LABELS[c.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                    {dateSpan(c)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ContractViewModal
        contract={viewing}
        onClose={() => setViewing(null)}
        canEdit={isElevated}
        onEdit={() => {
          setEditing(viewing);
          setViewing(null);
          setDialogOpen(true);
        }}
      />
      {isElevated && (
        <ContractDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          contract={editing}
          projects={projects}
          clients={clients}
        />
      )}
    </div>
  );
}
