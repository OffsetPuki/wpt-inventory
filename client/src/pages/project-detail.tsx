import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { toast } from "@/components/ui/toaster";
import { useApiMutation } from "@/hooks/useApiMutation";
import { PROJECT_STATUSES, type Project, type ProjectStatus } from "@shared/schema";
import type { Client } from "@shared/crm-schema";
import {
  CONTRACT_KIND_LABELS,
  CONTRACT_STATUS_LABELS,
  CHANGE_ORDER_STATUS_LABELS,
  type ChangeOrder,
  type ChangeOrderStatus,
  type ContractKind,
  type ContractStatus,
} from "@shared/pm-schema";
import { formatDateTime, formatMoney, formatHours, formatDate, parseMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { inputCls, primaryBtn } from "@/lib/ui-styles";
import Header from "@/components/Header";
import Modal from "@/components/Modal";
import ProjectChecklist from "@/components/ProjectChecklist";
import DocumentsCard from "@/components/DocumentsCard";
import { uploadPhoto } from "@/lib/uploadPhoto";
import {
  ArrowLeft,
  Ban,
  Check,
  Globe,
  Image as ImageIcon,
  ImageOff,
  Loader2,
  PackageMinus,
  PackagePlus,
  Plus,
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
  const [title, setTitle] = useState(project.name);
  const [category, setCategory] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const publish = useApiMutation({
    request: () => ({
      method: "POST",
      url: `/api/projects/${project.id}/publish-portfolio`,
      body: {
        title: title.trim() || undefined,
        category: category.trim() || null,
        photoUrl,
      },
    }),
    invalidate: [["marketing", "portfolio"]],
    successTitle: "Published — live on cjmmetals.com within ~5 minutes.",
    errorTitle: "Could not publish",
    onSuccess: onClose,
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

// ─── Job hub cards ───────────────────────────────────────────────────────────
// The project page is the job's home base: who it's for (client card), what's
// left to do (open tasks), and whether it's making money (finances card).

function ClientCard({ clientId }: { clientId: number | null }) {
  const { data: client } = useQuery<Client>({
    queryKey: ["crm-client", clientId],
    queryFn: async () => (await apiRequest("GET", `/api/crm/clients/${clientId}`)).json(),
    enabled: clientId != null,
    retry: false,
  });
  if (clientId == null || !client) return null;
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h2 className="mb-3 text-base font-semibold text-foreground">Client</h2>
      <p className="font-medium text-foreground">
        {client.name}
        {client.company && <span className="text-muted-foreground"> — {client.company}</span>}
      </p>
      <div className="mt-2 flex flex-col gap-1 text-sm">
        {client.phone && (
          <a href={`tel:${client.phone}`} className="text-muted-foreground hover:text-foreground hover:underline">
            {client.phone}
          </a>
        )}
        {client.email && (
          <a href={`mailto:${client.email}`} className="text-muted-foreground hover:text-foreground hover:underline">
            {client.email}
          </a>
        )}
        {(client.address || client.city) && (
          <span className="text-muted-foreground">
            {[client.address, client.city, client.zip].filter(Boolean).join(", ")}
          </span>
        )}
      </div>
      <Link href="/crm/clients" className="mt-3 inline-block text-sm text-muted-foreground underline hover:text-foreground">
        Open in CRM
      </Link>
    </div>
  );
}

interface ProjectTaskRow {
  id: number;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
}

interface ProjectMkTaskRow {
  id: number;
  title: string;
  dueAt: number | null;
}

function OpenTasksCard({ projectId }: { projectId: number }) {
  const { data: tasks = [] } = useQuery<ProjectTaskRow[]>({
    queryKey: ["project-tasks", projectId],
    queryFn: async () => (await apiRequest("GET", `/api/pm/tasks?projectId=${projectId}`)).json(),
    retry: false,
  });
  // Phase D #20: the automation sink's chase tasks stamped with this job
  // (unbilled nags, "schedule the job", warranty callbacks…) — listed under
  // the board tasks, labeled so the two inboxes stay distinguishable.
  const { data: mkTasks = [] } = useQuery<ProjectMkTaskRow[]>({
    queryKey: ["project-mk-tasks", projectId],
    queryFn: async () =>
      (await apiRequest("GET", `/api/marketing/tasks?status=open&projectId=${projectId}`)).json(),
    retry: false,
  });
  const open = tasks.filter((t) => t.status !== "done");
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h2 className="mb-3 text-base font-semibold text-foreground">
        Open tasks{" "}
        <span className="font-normal text-muted-foreground">— {open.length + mkTasks.length}</span>
      </h2>
      {open.length === 0 && mkTasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing open. Plan the job in{" "}
          <Link href="/pm/board" className="underline hover:text-foreground">Projects → Board</Link>.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {open.slice(0, 5).map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 truncate text-sm text-foreground">{t.title}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {t.priority === "urgent" || t.priority === "high" ? "⚠ " : ""}
                {t.dueDate ? formatDate(t.dueDate) : t.status.replace("_", " ")}
              </span>
            </li>
          ))}
          {open.length > 5 && (
            <li className="py-2 text-xs text-muted-foreground">
              +{open.length - 5} more on the{" "}
              <Link href="/pm/board" className="underline hover:text-foreground">board</Link>
            </li>
          )}
          {mkTasks.map((t) => (
            <li key={`mk-${t.id}`} className="flex items-center justify-between gap-3 py-2">
              <Link href="/marketing" className="min-w-0 truncate text-sm text-foreground hover:underline">
                {t.title}
              </Link>
              <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                Follow-up
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Phase D #21: the agreements governing this job, plus a one-click "New
// contract" that lands on the contracts page prefilled with this project /
// client — and, when the job came from an online-accepted quote (jobNumber ==
// quote.number), the quote ref and value too.
function ContractsCard({ project }: { project: Project }) {
  const { data: contracts = [] } = useQuery<
    { id: number; title: string; kind: ContractKind; status: ContractStatus; valueCents: number }[]
  >({
    queryKey: ["pm-contracts", "project", project.id],
    queryFn: async () =>
      (await apiRequest("GET", `/api/pm/contracts?projectId=${project.id}`)).json(),
    retry: false,
  });
  const { data: quotes = [] } = useQuery<{ number: string; totalCents: number }[]>({
    queryKey: ["quotes"],
    queryFn: async () => (await apiRequest("GET", "/api/quotes")).json(),
    retry: false,
  });
  const quote = quotes.find((q) => q.number === project.jobNumber);
  const params = new URLSearchParams({ new: "1", projectId: String(project.id) });
  params.set("title", project.name);
  if (project.clientId != null) params.set("clientId", String(project.clientId));
  else if (project.customer) params.set("clientName", project.customer);
  if (quote) {
    params.set("quoteRef", quote.number);
    params.set("valueCents", String(quote.totalCents));
  }
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h2 className="mb-3 text-base font-semibold text-foreground">Contracts</h2>
      {contracts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No contract on this job yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {contracts.map((c) => (
            <li key={c.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">{c.title}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {CONTRACT_KIND_LABELS[c.kind]} · {CONTRACT_STATUS_LABELS[c.status]}
              </span>
              <span className="shrink-0 tabular-nums text-foreground">{formatMoney(c.valueCents)}</span>
            </li>
          ))}
        </ul>
      )}
      <Link
        href={`/pm/contracts?${params.toString()}`}
        className="mt-3 inline-block text-sm text-muted-foreground underline hover:text-foreground"
      >
        New contract{quote ? ` from quote ${quote.number}` : ""}
      </Link>
    </div>
  );
}

// Phase G #1: the commercial paper trail — scope/price changes after signing.
// Approved COs feed the job's effective contract total (finances card).
const CO_CHIP: Record<ChangeOrderStatus, string> = {
  draft: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
  approved: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  void: "bg-zinc-500/10 text-zinc-500",
};

function ChangeOrdersCard({ projectId }: { projectId: number }) {
  const { isElevated } = useAuth();
  const [addOpen, setAddOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");

  const { data: cos = [] } = useQuery<ChangeOrder[]>({
    queryKey: ["pm-change-orders", projectId],
    queryFn: async () =>
      (await apiRequest("GET", `/api/pm/change-orders?projectId=${projectId}`)).json(),
    retry: false,
  });

  const invalidate = [["pm-change-orders", projectId], ["project-fin-summary", projectId]];
  const create = useApiMutation({
    request: () => ({
      method: "POST",
      url: "/api/pm/change-orders",
      body: {
        projectId,
        title: title.trim(),
        description: description.trim() || null,
        amountCents: parseMoney(amount),
      },
    }),
    invalidate,
    successTitle: "Change order added",
    errorTitle: "Could not add change order",
    onSuccess: () => {
      setAddOpen(false);
      setTitle("");
      setAmount("");
      setDescription("");
    },
  });
  const setStatus = useApiMutation<unknown, { id: number; status: ChangeOrderStatus }>({
    request: ({ id, status }) => ({
      method: "PATCH",
      url: `/api/pm/change-orders/${id}`,
      body: { status },
    }),
    invalidate,
    successTitle: (_d, v) => (v.status === "approved" ? "Change order approved" : "Change order voided"),
    errorTitle: "Could not update",
  });

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground">Change orders</h2>
        {isElevated && (
          <button
            onClick={() => setAddOpen(true)}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium text-foreground hover:border-primary"
          >
            <Plus className="h-4 w-4" />
            Add
          </button>
        )}
      </div>
      {cos.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No change orders. Scope changed after signing? Paper it here before doing the work.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {cos.map((co) => (
            <li key={co.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate font-medium text-foreground" title={co.description ?? undefined}>
                {co.title}
              </span>
              <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", CO_CHIP[co.status])}>
                {CHANGE_ORDER_STATUS_LABELS[co.status]}
              </span>
              <span
                className={cn(
                  "shrink-0 tabular-nums",
                  co.status === "void" ? "text-muted-foreground line-through" : "text-foreground",
                )}
              >
                {co.amountCents >= 0 ? "+" : ""}{formatMoney(co.amountCents)}
              </span>
              {isElevated && co.status === "draft" && (
                <button
                  title="Approve — counts toward the contract total"
                  disabled={setStatus.isPending}
                  onClick={() => setStatus.mutate({ id: co.id, status: "approved" })}
                  className="rounded-lg p-1.5 text-emerald-700 hover:bg-accent disabled:opacity-60 dark:text-emerald-400"
                >
                  <Check className="h-4 w-4" />
                </button>
              )}
              {isElevated && co.status === "approved" && (
                <button
                  title="Void this change order"
                  disabled={setStatus.isPending}
                  onClick={() => {
                    if (window.confirm(`Void change order '${co.title}'?`)) {
                      setStatus.mutate({ id: co.id, status: "void" });
                    }
                  }}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-red-600 disabled:opacity-60"
                >
                  <Ban className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="New change order">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) {
              toast({ variant: "destructive", title: "Give the change order a title" });
              return;
            }
            create.mutate();
          }}
          className="flex flex-col gap-4"
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Title</span>
            <input
              className={inputCls}
              placeholder="Add 20 ft of railing to mezzanine"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Amount $</span>
            <input
              className={inputCls}
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <span className="text-xs text-muted-foreground">
              Enter a negative amount for a deductive change order (scope removed).
            </span>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Description (optional)</span>
            <input
              className={inputCls}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <button type="submit" disabled={create.isPending} className={primaryBtn}>
            {create.isPending && <Loader2 className="h-5 w-5 animate-spin" />}
            Add change order
          </button>
        </form>
      </Modal>
    </div>
  );
}

interface ProjectFinSummary {
  invoices: {
    id: number;
    number: string;
    status: string;
    totalCents: number;
    balanceCents: number;
  }[];
  totals: {
    contractCents: number;
    changeOrderCents: number;
    invoicedCents: number;
    paidCents: number;
    outstandingCents: number;
    retainageHeldCents: number;
    expenseCents: number;
    laborMinutes: number;
    laborCostCents: number;
    marginCents: number;
  };
}

const INV_CHIP: Record<string, string> = {
  draft: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
  sent: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  partial: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  paid: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  overdue: "bg-red-500/10 text-red-700 dark:text-red-400",
};

// Elevated-only (caller gates on isManager): billed vs collected vs cost.
function JobFinancesCard({ projectId, projectStatus }: { projectId: number; projectStatus: string }) {
  const { data } = useQuery<ProjectFinSummary>({
    queryKey: ["project-fin-summary", projectId],
    queryFn: async () =>
      (await apiRequest("GET", `/api/finance/projects/${projectId}/summary`)).json(),
    retry: false,
  });
  // Phase G #3: bill everything still withheld on the job as one release invoice.
  const billRetainage = useApiMutation<{ number: string }>({
    request: () => ({
      method: "POST",
      url: `/api/finance/projects/${projectId}/bill-retainage`,
    }),
    invalidate: [["project-fin-summary", projectId], ["finance-invoices"], ["finance-stats"]],
    successTitle: (inv) => `Draft invoice ${inv.number} created — send it from Finance → Invoices`,
    errorTitle: "Could not bill retainage",
  });
  if (!data) return null;
  const t = data.totals;
  const contractCents = t.contractCents ?? 0;
  const changeOrderCents = t.changeOrderCents ?? 0;
  // Phase G #1: approved change orders move the goalposts — reconcile billing
  // against the EFFECTIVE contract total, not the original signature value.
  const effectiveCents = contractCents + changeOrderCents;
  if (t.invoicedCents === 0 && t.expenseCents === 0 && t.laborMinutes === 0 && effectiveCents === 0) return null;
  // Phase A #3: the contract vs what's been billed. Amber on a DONE job with
  // contract money still unbilled — that invoice will never send itself.
  const leftToBillCents = Math.max(0, effectiveCents - t.invoicedCents);
  const underBilled = leftToBillCents > 0 && projectStatus === "done";
  const retainageHeldCents = t.retainageHeldCents ?? 0;
  const stat = (label: string, value: string, tone?: string) => (
    <div>
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 font-semibold tabular-nums", tone ?? "text-foreground")}>{value}</p>
    </div>
  );
  return (
    <div className="mb-6 rounded-xl border border-border bg-card p-5">
      <h2 className="mb-4 text-base font-semibold text-foreground">Job finances</h2>
      {effectiveCents > 0 && (
        <p
          className={cn(
            "mb-4 text-sm",
            underBilled
              ? "font-medium text-amber-700 dark:text-amber-400"
              : "text-muted-foreground",
          )}
        >
          Contract {formatMoney(contractCents)}
          {changeOrderCents !== 0 && <> + COs {formatMoney(changeOrderCents)}</>}
          {" "}· Invoiced {formatMoney(t.invoicedCents)} · Left to bill {formatMoney(leftToBillCents)}
          {underBilled && " — job is done but under-billed"}
        </p>
      )}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {stat("Billed", formatMoney(t.invoicedCents))}
        {stat("Collected", formatMoney(t.paidCents))}
        {stat(
          "Outstanding",
          formatMoney(t.outstandingCents),
          t.outstandingCents > 0 ? "text-amber-700 dark:text-amber-400" : undefined,
        )}
        {stat("Expenses", formatMoney(t.expenseCents))}
        {stat("Labor", `${formatHours(t.laborMinutes)} · ${formatMoney(t.laborCostCents)}`)}
        {stat(
          "Margin",
          formatMoney(t.marginCents),
          t.marginCents >= 0
            ? "text-emerald-700 dark:text-emerald-400"
            : "text-red-600 dark:text-red-400",
        )}
      </div>
      {retainageHeldCents > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2">
          <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
            Retainage held: {formatMoney(retainageHeldCents)}
          </p>
          <button
            onClick={() => billRetainage.mutate()}
            disabled={billRetainage.isPending}
            className="ml-auto flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground hover:border-primary disabled:opacity-60"
            title="Create a draft invoice releasing all retainage withheld on this job"
          >
            {billRetainage.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Bill retainage
          </button>
        </div>
      )}
      {data.invoices.length > 0 && (
        <ul className="mt-4 divide-y divide-border border-t border-border">
          {data.invoices.map((inv) => (
            <li key={inv.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="font-mono text-xs text-muted-foreground">{inv.number}</span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-medium",
                  INV_CHIP[inv.status] ?? "bg-muted text-muted-foreground",
                )}
              >
                {inv.status}
              </span>
              <span className="ml-auto tabular-nums text-foreground">{formatMoney(inv.totalCents)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Labor priced at each worker’s HR pay rate. Manage invoices in Finance → Invoices.
      </p>
    </div>
  );
}

// Fix 4 (wiring plan): money waiting to be invoiced on this job — billable
// expenses + per-worker labor not yet pulled onto an invoice. Renders nothing
// when there's nothing unbilled. Finance API is elevated-only, so the caller
// gates on isManager; retry off so a 403 doesn't hammer.
function UnbilledCard({ projectId }: { projectId: number }) {
  const { data } = useQuery<{
    totals: { laborCents: number; expenseCents: number; totalCents: number };
  }>({
    queryKey: ["project-unbilled", projectId],
    queryFn: async () =>
      (await apiRequest("GET", `/api/finance/projects/${projectId}/unbilled`)).json(),
    retry: false,
  });
  if (!data || data.totals.totalCents <= 0) return null;
  return (
    <div className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/5 p-5">
      <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
        {formatMoney(data.totals.totalCents)} unbilled on this job
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {formatMoney(data.totals.laborCents)} labor · {formatMoney(data.totals.expenseCents)} expenses
        {" — "}open the job’s draft invoice in Finance and use “Pull unbilled from job”.
      </p>
    </div>
  );
}

export default function ProjectDetailPage({ id }: { id: string }) {
  const projectId = Number(id);
  // Manager + technician both manage project status / checklist / deletion.
  const { isElevated: isManager } = useAuth();
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

  const setStatus = useApiMutation<any, ProjectStatus>({
    request: (status) => ({
      method: "PATCH",
      url: `/api/projects/${projectId}`,
      body: { status },
    }),
    invalidate: [["project", projectId], ["projects"]],
    errorTitle: "Update failed",
  });

  const del = useApiMutation({
    request: () => ({ method: "DELETE", url: `/api/projects/${projectId}` }),
    invalidate: [["projects"]],
    successTitle: "Project deleted",
    errorTitle: "Could not delete",
    onSuccess: () => setLocation("/projects"),
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

      {isManager && <UnbilledCard projectId={projectId} />}
      {isManager && <JobFinancesCard projectId={projectId} projectStatus={project.status} />}

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <ClientCard clientId={project.clientId} />
        <OpenTasksCard projectId={projectId} />
        <ContractsCard project={project} />
        <ChangeOrdersCard projectId={projectId} />
        <DocumentsCard projectId={projectId} />
      </div>

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
