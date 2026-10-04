import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { toast } from "@/components/ui/toaster";
import { useApiMutation } from "@/hooks/useApiMutation";
import { type Project } from "@shared/schema";
import {
  CONTRACT_KIND_LABELS,
  CONTRACT_STATUS_LABELS,
  CHANGE_ORDER_STATUS_LABELS,
  type ChangeOrder,
  type ChangeOrderStatus,
  type ContractKind,
  type ContractStatus,
} from "@shared/pm-schema";
import { formatMoney, parseMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { inputCls, primaryBtn } from "@/lib/ui-styles";
import Modal from "@/components/Modal";
import {
  Ban,
  Check,
  Loader2,
  Plus,
} from "lucide-react";

export function ContractsCard({ project }: { project: Project }) {
  const { data: contracts = [] } = useQuery<
    { id: number; title: string; kind: ContractKind; status: ContractStatus; valueCents: number }[]
  >({
    queryKey: ["pm-contracts", "project", project.id],
    queryFn: async () =>
      (await apiRequest("GET", `/api/pm/contracts?projectId=${project.id}`)).json(),
    retry: false,
  });
  const { data: quotes = [] } = useQuery<{ number: string; totalCents: number }[]>({
    queryKey: ["quotes", "job", project.id],
    queryFn: async () => (await apiRequest("GET", `/api/quotes?projectId=${project.id}`)).json(),
    retry: false,
  });
  const quote = quotes[0];
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

export function ChangeOrdersCard({ projectId }: { projectId: number }) {
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

