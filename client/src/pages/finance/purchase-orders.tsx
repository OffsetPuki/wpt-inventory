import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { toast } from "@/components/ui/toaster";
import { useApiMutation } from "@/hooks/useApiMutation";
import { inputCls, primaryBtn, secondaryBtn } from "@/lib/ui-styles";
import { Chip, type ChipTone } from "@/components/ui/Chip";
import { LoadingBlock, EmptyState } from "@/components/ui/Feedback";
import Header from "@/components/Header";
import Modal from "@/components/Modal";
import { cn } from "@/lib/utils";
import { formatDate, formatMoney, parseMoney } from "@/lib/format";
import {
  PO_STATUSES,
  PO_STATUS_LABELS,
  type PoStatus,
  type PurchaseOrder,
} from "@shared/finance-schema";
import type { Project } from "@shared/schema";
import { parseLineItems, type LineItem } from "@shared/biz-common";
import {
  Ban,
  CheckCircle2,
  Loader2,
  Lock,
  Package,
  Plus,
  Search,
  Send,
  X,
} from "lucide-react";

// ─── Shared bits ──────────────────────────────────────────────────────────────

const STATUS_TONE: Record<PoStatus, ChipTone> = {
  draft: "zinc",
  sent: "blue",
  received: "emerald",
  closed: "muted",
  cancelled: "red",
};

function StatusChip({ status }: { status: PoStatus }) {
  return <Chip tone={STATUS_TONE[status]}>{PO_STATUS_LABELS[status]}</Chip>;
}

const PO_KEYS = [["finance-pos"], ["finance-stats"]];

// ─── Line-items editor ────────────────────────────────────────────────────────

interface ItemDraft {
  description: string;
  qty: string;
  unitPrice: string;
}

const EMPTY_ITEM: ItemDraft = { description: "", qty: "1", unitPrice: "" };

function draftsToLineItems(drafts: ItemDraft[]): LineItem[] {
  // Rows without a valid positive qty are dropped, not coerced to 1 — keeps
  // the saved PO identical to what the dialog's total showed.
  return drafts
    .filter((d) => d.description.trim() && parseFloat(d.qty) > 0)
    .map((d) => ({
      description: d.description.trim(),
      qty: parseFloat(d.qty),
      unitPriceCents: parseMoney(d.unitPrice),
    }));
}

function draftTotalCents(drafts: ItemDraft[]): number {
  return draftsToLineItems(drafts).reduce(
    (sum, it) => sum + Math.round(it.qty * it.unitPriceCents),
    0
  );
}

function LineItemsEditor({
  drafts,
  onChange,
}: {
  drafts: ItemDraft[];
  onChange: (next: ItemDraft[]) => void;
}) {
  const update = (i: number, patch: Partial<ItemDraft>) =>
    onChange(drafts.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
        <span className="flex-1">Description</span>
        <span className="w-16 text-right">Qty</span>
        <span className="w-24 text-right">Unit $</span>
        <span className="w-8" />
      </div>
      {drafts.map((d, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            className={cn(inputCls, "h-10 flex-1 text-sm")}
            placeholder="Description"
            value={d.description}
            onChange={(e) => update(i, { description: e.target.value })}
          />
          <input
            className={cn(inputCls, "h-10 w-16 text-right text-sm tabular-nums")}
            inputMode="decimal"
            value={d.qty}
            onChange={(e) => update(i, { qty: e.target.value })}
          />
          <input
            className={cn(inputCls, "h-10 w-24 text-right text-sm tabular-nums")}
            inputMode="decimal"
            placeholder="0.00"
            value={d.unitPrice}
            onChange={(e) => update(i, { unitPrice: e.target.value })}
          />
          <button
            type="button"
            aria-label="Remove line"
            onClick={() => onChange(drafts.filter((_, idx) => idx !== i))}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...drafts, { ...EMPTY_ITEM }])}
        className="flex h-9 w-fit items-center gap-1.5 rounded-lg border border-dashed border-border px-3 text-sm font-medium text-muted-foreground hover:border-primary hover:text-foreground"
      >
        <Plus className="h-4 w-4" />
        Add line
      </button>
    </div>
  );
}

// ─── Create / edit dialog (with status actions when editing) ─────────────────

function PoFormModal({
  open,
  onClose,
  po,
  projects,
}: {
  open: boolean;
  onClose: () => void;
  po?: PurchaseOrder | null;
  projects: Project[];
}) {
  const [vendor, setVendor] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [projectId, setProjectId] = useState("");
  const [drafts, setDrafts] = useState<ItemDraft[]>([{ ...EMPTY_ITEM }]);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    if (po) {
      setVendor(po.vendor);
      setExpectedDate(po.expectedDate ?? "");
      setProjectId(po.projectId != null ? String(po.projectId) : "");
      const items = parseLineItems(po.items);
      setDrafts(
        items.length
          ? items.map((it) => ({
              description: it.description,
              qty: String(it.qty),
              unitPrice: (it.unitPriceCents / 100).toFixed(2),
            }))
          : [{ ...EMPTY_ITEM }]
      );
      setNotes(po.notes ?? "");
    } else {
      setVendor("");
      setExpectedDate("");
      setProjectId("");
      setDrafts([{ ...EMPTY_ITEM }]);
      setNotes("");
    }
  }, [open, po]);

  const save = useApiMutation({
    request: () => {
      const body = {
        vendor: vendor.trim(),
        expectedDate: expectedDate || null,
        projectId: projectId ? Number(projectId) : null,
        items: JSON.stringify(draftsToLineItems(drafts)),
        notes: notes.trim() || null,
      };
      return po
        ? { method: "PATCH", url: `/api/finance/purchase-orders/${po.id}`, body }
        : { method: "POST", url: "/api/finance/purchase-orders", body };
    },
    invalidate: PO_KEYS,
    successTitle: po ? "Purchase order updated" : "Purchase order created",
    errorTitle: "Could not save",
    onSuccess: onClose,
  });

  const setStatus = useApiMutation<unknown, PoStatus>({
    request: (status) => ({
      method: "PATCH",
      url: `/api/finance/purchase-orders/${po!.id}`,
      body: { status },
    }),
    invalidate: PO_KEYS,
    successTitle: (_row, status) => `Marked ${PO_STATUS_LABELS[status].toLowerCase()}`,
    errorTitle: "Could not update",
    onSuccess: onClose,
  });

  const totalCents = draftTotalCents(drafts);
  const editable = !po || po.status === "draft" || po.status === "sent";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={po ? po.number : "New purchase order"}
      maxWidth="max-w-2xl"
    >
      <div className="flex max-h-[72vh] flex-col gap-4 overflow-y-auto pr-1">
        {po && (
          <div className="flex items-center gap-3">
            <StatusChip status={po.status} />
            {!editable && (
              <span className="text-sm text-muted-foreground">
                {po.status === "cancelled" ? "Cancelled — view only." : "Locked — view only."}
              </span>
            )}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!vendor.trim()) {
              toast({ variant: "destructive", title: "Vendor is required" });
              return;
            }
            save.mutate();
          }}
          className="flex flex-col gap-4"
        >
          <fieldset disabled={!editable} className="flex flex-col gap-4 disabled:opacity-70">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-foreground">Vendor</span>
                <input
                  className={inputCls}
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-foreground">Expected date</span>
                <input
                  type="date"
                  className={inputCls}
                  value={expectedDate}
                  onChange={(e) => setExpectedDate(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1.5 sm:col-span-2">
                <span className="text-sm font-medium text-foreground">Project (optional)</span>
                <select
                  className={inputCls}
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                >
                  <option value="">— None —</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.jobNumber} — {p.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium text-foreground">Line items</p>
              <LineItemsEditor drafts={drafts} onChange={setDrafts} />
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-foreground">Notes (optional)</span>
              <input
                className={inputCls}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
          </fieldset>

          <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2 text-sm">
            <span className="font-semibold text-foreground">Total</span>
            <span className="tabular-nums font-semibold text-foreground">
              {formatMoney(totalCents)}
            </span>
          </div>

          {editable && (
            <button type="submit" disabled={save.isPending} className={primaryBtn}>
              {save.isPending && <Loader2 className="h-5 w-5 animate-spin" />}
              {po ? "Save changes" : "Create purchase order"}
            </button>
          )}
        </form>

        {/* Status advance / cancel */}
        {po && po.status !== "closed" && po.status !== "cancelled" && (
          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            {po.status === "draft" && (
              <button
                onClick={() => setStatus.mutate("sent")}
                disabled={setStatus.isPending}
                className={secondaryBtn}
              >
                <Send className="h-4 w-4" />
                Mark sent
              </button>
            )}
            {po.status === "sent" && (
              <button
                onClick={() => setStatus.mutate("received")}
                disabled={setStatus.isPending}
                className={secondaryBtn}
              >
                <CheckCircle2 className="h-4 w-4" />
                Mark received
              </button>
            )}
            {po.status === "received" && (
              <button
                onClick={() => setStatus.mutate("closed")}
                disabled={setStatus.isPending}
                className={secondaryBtn}
              >
                <Lock className="h-4 w-4" />
                Close PO
              </button>
            )}
            {(po.status === "draft" || po.status === "sent") && (
              <button
                onClick={() => {
                  if (window.confirm(`Cancel ${po.number}? This cannot be undone.`)) {
                    setStatus.mutate("cancelled");
                  }
                }}
                disabled={setStatus.isPending}
                className={cn(secondaryBtn, "text-red-600 dark:text-red-400")}
              >
                <Ban className="h-4 w-4" />
                Cancel PO
              </button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const TABS: { key: string; label: string }[] = [
  { key: "", label: "All" },
  ...PO_STATUSES.map((s) => ({ key: s, label: PO_STATUS_LABELS[s] })),
];

export default function PurchaseOrdersPage() {
  const [tab, setTab] = useState("");
  const [q, setQ] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PurchaseOrder | null>(null);

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: async () => (await apiRequest("GET", "/api/projects")).json(),
  });
  const projectName = (id: number | null) => {
    if (id == null) return "—";
    const p = projects.find((pr) => pr.id === id);
    return p ? p.jobNumber : `#${id}`;
  };

  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (tab) params.set("status", tab);
    if (q.trim()) params.set("q", q.trim());
    const s = params.toString();
    return `/api/finance/purchase-orders${s ? `?${s}` : ""}`;
  }, [tab, q]);

  const { data: rows = [], isLoading } = useQuery<PurchaseOrder[]>({
    queryKey: ["finance-pos", tab, q],
    queryFn: async () => (await apiRequest("GET", url)).json(),
  });

  return (
    <div className="mx-auto max-w-6xl">
      <Header title="Purchase orders" description="Orders the business sends to vendors">
        <button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
          className={primaryBtn}
        >
          <Plus className="h-5 w-5" />
          New purchase order
        </button>
      </Header>

      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
              tab === t.key
                ? "bg-primary text-primary-foreground"
                : "border border-border text-muted-foreground hover:border-primary hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="relative mb-6">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by vendor…"
          className="h-12 w-full rounded-xl border border-input bg-card pl-12 pr-4 text-base text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring"
        />
      </div>

      {isLoading ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Package}
          message={`No purchase orders${tab ? " with this status" : " yet"}`}
        >
          {!tab && !q && (
            <button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
              className={primaryBtn}
            >
              <Plus className="h-5 w-5" />
              New purchase order
            </button>
          )}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-medium uppercase text-muted-foreground">
                <th className="px-4 py-3">Number</th>
                <th className="px-4 py-3">Vendor</th>
                <th className="px-4 py-3">Expected</th>
                <th className="px-4 py-3">Project</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((po) => (
                <tr
                  key={po.id}
                  onClick={() => {
                    setEditing(po);
                    setFormOpen(true);
                  }}
                  className="cursor-pointer transition-colors hover:bg-accent/50"
                >
                  <td className="px-4 py-3 font-mono text-xs text-foreground">{po.number}</td>
                  <td className="px-4 py-3 text-foreground">{po.vendor}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                    {po.expectedDate ? formatDate(po.expectedDate) : "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {projectName(po.projectId)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-foreground">
                    {formatMoney(po.totalCents)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusChip status={po.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PoFormModal
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        po={editing}
        projects={projects}
      />
    </div>
  );
}
