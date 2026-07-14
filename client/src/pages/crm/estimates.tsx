import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { toast } from "@/components/ui/toaster";
import Header from "@/components/Header";
import Modal from "@/components/Modal";
import { cn } from "@/lib/utils";
import { useApiMutation } from "@/hooks/useApiMutation";
import { LoadingBlock, EmptyState } from "@/components/ui/Feedback";
import { Chip, type ChipTone } from "@/components/ui/Chip";
import { inputCls } from "@/lib/ui-styles";
import { formatDate, formatMoney, parseMoney } from "@/lib/format";
import { parseLineItems } from "@shared/biz-common";
import {
  ESTIMATE_STATUS_LABELS,
  type Estimate,
  type EstimateStatus,
  type Client,
  type Lead,
  type Product,
} from "@shared/crm-schema";
import { Loader2, Plus, FileText, Trash2, Send, Check, X, Pencil } from "lucide-react";

const STATUS_TONE: Record<EstimateStatus, ChipTone> = {
  draft: "zinc",
  sent: "blue",
  accepted: "emerald",
  declined: "red",
  expired: "amber",
};

const TABS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "accepted", label: "Accepted" },
  { value: "declined", label: "Declined" },
];

interface RowDraft {
  description: string;
  qty: string;
  price: string; // dollars, text
  unit?: string;
  productId?: number;
}

const emptyRow = (): RowDraft => ({ description: "", qty: "1", price: "" });

// ─── Builder dialog ───────────────────────────────────────────────────────────

function EstimateBuilderModal({
  estimate,
  clients,
  leads,
  products,
  onClose,
}: {
  estimate: Estimate | null;
  clients: Client[];
  leads: Lead[];
  products: Product[];
  onClose: () => void;
}) {
  const [title, setTitle] = useState(estimate?.title ?? "");
  const [clientId, setClientId] = useState(estimate?.clientId != null ? String(estimate.clientId) : "");
  const [leadId, setLeadId] = useState(estimate?.leadId != null ? String(estimate.leadId) : "");
  const [validUntil, setValidUntil] = useState(estimate?.validUntil ?? "");
  const [taxPct, setTaxPct] = useState(
    estimate ? String(estimate.taxRateBp / 100) : "0"
  );
  const [notes, setNotes] = useState(estimate?.notes ?? "");
  const [rows, setRows] = useState<RowDraft[]>(() => {
    const existing = parseLineItems(estimate?.items).map((it) => ({
      description: it.description,
      qty: String(it.qty),
      price: String(it.unitPriceCents / 100),
      unit: it.unit,
      productId: it.productId,
    }));
    return existing.length > 0 ? existing : [emptyRow()];
  });

  const setRow = (i: number, patch: Partial<RowDraft>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const pickProduct = (i: number, id: string) => {
    if (!id) {
      setRow(i, { productId: undefined });
      return;
    }
    const p = products.find((pr) => pr.id === parseInt(id, 10));
    if (!p) return;
    setRow(i, {
      productId: p.id,
      description: p.name,
      price: String(p.unitPriceCents / 100),
      unit: p.unit ?? undefined,
    });
  };

  // Live totals from the current draft rows.
  const subtotalCents = rows.reduce((sum, r) => {
    const qty = parseFloat(r.qty);
    if (!r.description.trim() || isNaN(qty) || qty <= 0) return sum;
    return sum + Math.round(qty * parseMoney(r.price));
  }, 0);
  const taxRateBp = Math.round((parseFloat(taxPct) || 0) * 100);
  const taxCents = Math.round((subtotalCents * taxRateBp) / 10000);
  const totalCents = subtotalCents + taxCents;

  const buildItems = () =>
    // Same row filter as the live totals above — a row the preview skipped
    // must not be saved with a coerced qty of 1.
    rows
      .filter((r) => r.description.trim() && parseFloat(r.qty) > 0)
      .map((r) => ({
        description: r.description.trim(),
        qty: parseFloat(r.qty),
        unitPriceCents: parseMoney(r.price),
        ...(r.unit ? { unit: r.unit } : {}),
        ...(r.productId != null ? { productId: r.productId } : {}),
      }));

  const save = useApiMutation({
    request: () => {
      const body = {
        title: title.trim(),
        clientId: clientId ? parseInt(clientId, 10) : null,
        leadId: leadId ? parseInt(leadId, 10) : null,
        validUntil: validUntil || null,
        items: buildItems(),
        taxRateBp,
        notes: notes.trim() || null,
      };
      return estimate
        ? { method: "PATCH", url: `/api/crm/estimates/${estimate.id}`, body }
        : { method: "POST", url: "/api/crm/estimates", body };
    },
    invalidate: [["crm-estimates"], ["crm-stats"], ["crm-reports"]],
    successTitle: estimate ? "Estimate updated" : "Draft saved",
    errorTitle: "Could not save estimate",
    onSuccess: () => onClose(),
  });

  const smallInput =
    "h-10 w-full rounded-lg border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring";

  return (
    <Modal open onClose={onClose} title={estimate ? `Edit ${estimate.number}` : "New estimate"} maxWidth="max-w-3xl">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) {
            toast({ variant: "destructive", title: "Title is required" });
            return;
          }
          if (buildItems().length === 0) {
            toast({ variant: "destructive", title: "Add at least one line item" });
            return;
          }
          save.mutate();
        }}
        className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Title</span>
            <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Client</span>
            <select className={inputCls} value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">None</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Linked lead (optional)</span>
            <select className={inputCls} value={leadId} onChange={(e) => setLeadId(e.target.value)}>
              <option value="">None</option>
              {leads.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Valid until</span>
            <input type="date" className={inputCls} value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </label>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-foreground">Line items</p>
          <div className="flex flex-col gap-2">
            {rows.map((r, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <select
                  className="h-10 w-40 shrink-0 rounded-lg border border-input bg-background px-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring"
                  value={r.productId != null ? String(r.productId) : ""}
                  onChange={(e) => pickProduct(i, e.target.value)}
                >
                  <option value="">— product —</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <input
                  className={cn(smallInput, "min-w-40 flex-1")}
                  placeholder="Description"
                  value={r.description}
                  onChange={(e) => setRow(i, { description: e.target.value })}
                />
                <input
                  className={cn(smallInput, "w-20 text-right tabular-nums")}
                  inputMode="decimal"
                  placeholder="Qty"
                  value={r.qty}
                  onChange={(e) => setRow(i, { qty: e.target.value })}
                />
                <input
                  className={cn(smallInput, "w-28 text-right tabular-nums")}
                  inputMode="decimal"
                  placeholder="Unit $"
                  value={r.price}
                  onChange={(e) => setRow(i, { price: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => setRows((rs) => (rs.length === 1 ? [emptyRow()] : rs.filter((_, idx) => idx !== i)))}
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label="Remove line"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setRows((rs) => [...rs, emptyRow()])}
            className="mt-2 flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium text-foreground hover:border-primary"
          >
            <Plus className="h-4 w-4" /> Add line
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Tax rate (%)</span>
            <input className={inputCls} inputMode="decimal" value={taxPct} onChange={(e) => setTaxPct(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Notes</span>
            <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>

        <div className="rounded-xl border border-border bg-background p-4">
          <div className="ml-auto flex max-w-60 flex-col gap-1 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal</span>
              <span className="tabular-nums">{formatMoney(subtotalCents)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Tax ({(taxRateBp / 100).toFixed(2).replace(/\.?0+$/, "") || "0"}%)</span>
              <span className="tabular-nums">{formatMoney(taxCents)}</span>
            </div>
            <div className="mt-1 flex justify-between border-t border-border pt-2 text-base font-semibold text-foreground">
              <span>Total</span>
              <span className="tabular-nums">{formatMoney(totalCents)}</span>
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={save.isPending}
          className="flex h-12 items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          {save.isPending && <Loader2 className="h-5 w-5 animate-spin" />}
          {estimate ? "Save changes" : "Save draft"}
        </button>
      </form>
    </Modal>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EstimatesPage() {
  const [statusTab, setStatusTab] = useState("");
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editing, setEditing] = useState<Estimate | null>(null);

  const url = `/api/crm/estimates${statusTab ? `?status=${statusTab}` : ""}`;
  const { data: estimates = [], isLoading } = useQuery<Estimate[]>({
    queryKey: ["crm-estimates", statusTab],
    queryFn: async () => (await apiRequest("GET", url)).json(),
  });

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ["crm-clients"],
    queryFn: async () => (await apiRequest("GET", "/api/crm/clients")).json(),
  });
  const clientName = (id: number | null) =>
    id == null ? "—" : clients.find((c) => c.id === id)?.name ?? `#${id}`;

  const { data: leads = [] } = useQuery<Lead[]>({
    queryKey: ["crm-leads"],
    queryFn: async () => (await apiRequest("GET", "/api/crm/leads")).json(),
  });

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["crm-products", "", "1"],
    queryFn: async () => (await apiRequest("GET", "/api/crm/products?active=1")).json(),
  });

  const setStatus = useApiMutation<Estimate, { id: number; status: EstimateStatus }>({
    request: ({ id, status }) => ({ method: "PATCH", url: `/api/crm/estimates/${id}`, body: { status } }),
    invalidate: [["crm-estimates"], ["crm-leads"], ["crm-stats"], ["crm-reports"]],
    successTitle: (row) => `Estimate ${ESTIMATE_STATUS_LABELS[row.status].toLowerCase()}`,
    errorTitle: "Could not update estimate",
  });

  const actionBtn =
    "inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-medium text-foreground hover:border-primary disabled:opacity-60";

  return (
    <div className="mx-auto max-w-6xl">
      <Header title="Estimates" description="Proposals and quotes, from draft to decision">
        <button
          onClick={() => {
            setEditing(null);
            setBuilderOpen(true);
          }}
          className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-5 w-5" />
          New estimate
        </button>
      </Header>

      <div className="mb-6 flex flex-wrap items-center gap-1 rounded-xl border border-border p-1">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setStatusTab(t.value)}
            className={cn(
              "flex h-9 items-center rounded-lg px-4 text-sm font-medium",
              statusTab === t.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <LoadingBlock />
      ) : estimates.length === 0 ? (
        <EmptyState icon={FileText} message={statusTab ? "No estimates with this status" : "No estimates yet"}>
          {!statusTab && (
            <button
              onClick={() => {
                setEditing(null);
                setBuilderOpen(true);
              }}
              className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90"
            >
              <Plus className="h-5 w-5" />
              Build your first estimate
            </button>
          )}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-muted-foreground">
                <th className="px-4 py-3 font-medium">Number</th>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Total</th>
                <th className="px-4 py-3 font-medium">Valid until</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {estimates.map((est) => (
                <tr key={est.id} className="hover:bg-accent/50">
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{est.number}</td>
                  <td className="px-4 py-3 font-medium text-foreground">{est.title}</td>
                  <td className="px-4 py-3 text-muted-foreground">{clientName(est.clientId)}</td>
                  <td className="px-4 py-3">
                    <Chip tone={STATUS_TONE[est.status]}>
                      {ESTIMATE_STATUS_LABELS[est.status]}
                    </Chip>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-foreground">
                    {formatMoney(est.totalCents)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {est.validUntil ? formatDate(est.validUntil) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        className={actionBtn}
                        onClick={() => {
                          setEditing(est);
                          setBuilderOpen(true);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </button>
                      {est.status === "draft" && (
                        <button
                          className={actionBtn}
                          disabled={setStatus.isPending}
                          onClick={() => setStatus.mutate({ id: est.id, status: "sent" })}
                        >
                          <Send className="h-3.5 w-3.5" /> Mark sent
                        </button>
                      )}
                      {est.status === "sent" && (
                        <>
                          <button
                            className={cn(actionBtn, "text-emerald-700 dark:text-emerald-400")}
                            disabled={setStatus.isPending}
                            onClick={() => setStatus.mutate({ id: est.id, status: "accepted" })}
                          >
                            <Check className="h-3.5 w-3.5" /> Accept
                          </button>
                          <button
                            className={cn(actionBtn, "text-red-700 dark:text-red-400")}
                            disabled={setStatus.isPending}
                            onClick={() => setStatus.mutate({ id: est.id, status: "declined" })}
                          >
                            <X className="h-3.5 w-3.5" /> Decline
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {builderOpen && (
        <EstimateBuilderModal
          key={editing?.id ?? "new"}
          estimate={editing}
          clients={clients}
          leads={leads}
          products={products}
          onClose={() => {
            setBuilderOpen(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
