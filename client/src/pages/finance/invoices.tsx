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
import { formatDate, formatMoney, parseMoney, formatBp, todayYmd } from "@/lib/format";
import {
  INVOICE_STATUS_LABELS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  type Invoice,
  type InvoicePayment,
  type InvoiceStatus,
  type PaymentGateway,
  type PaymentMethod,
} from "@shared/finance-schema";
import type { Client, Estimate } from "@shared/crm-schema";
import type { Project } from "@shared/schema";
import { parseLineItems, type LineItem } from "@shared/biz-common";
import {
  FileText,
  Loader2,
  Plus,
  Search,
  Send,
  X,
  Undo2,
  Ban,
  Pencil,
  CreditCard,
  FolderInput,
  Trash2,
} from "lucide-react";

// ─── Shared bits ──────────────────────────────────────────────────────────────

type InvoiceRow = Invoice & { balanceCents: number };

const STATUS_TONE: Record<InvoiceStatus, ChipTone> = {
  draft: "zinc",
  sent: "blue",
  partial: "amber",
  paid: "emerald",
  overdue: "red",
  void: "muted",
};

function StatusChip({ status }: { status: InvoiceStatus }) {
  return <Chip tone={STATUS_TONE[status]}>{INVOICE_STATUS_LABELS[status]}</Chip>;
}

const INVOICE_KEYS = [
  ["finance-invoices"],
  ["finance-invoice"],
  ["finance-stats"],
  ["finance-reports"],
];

// ─── Line-items editor ────────────────────────────────────────────────────────

interface ItemDraft {
  description: string;
  qty: string;
  unitPrice: string;
}

const EMPTY_ITEM: ItemDraft = { description: "", qty: "1", unitPrice: "" };

function draftSubtotalCents(drafts: ItemDraft[]): number {
  return drafts.reduce((sum, d) => {
    const qty = parseFloat(d.qty);
    if (!d.description.trim() || isNaN(qty) || qty <= 0) return sum;
    return sum + Math.round(qty * parseMoney(d.unitPrice));
  }, 0);
}

function draftsToLineItems(drafts: ItemDraft[]): LineItem[] {
  // Same row filter as draftSubtotalCents — a row the live total skipped must
  // not sneak into the saved invoice with a coerced qty.
  return drafts
    .filter((d) => d.description.trim() && parseFloat(d.qty) > 0)
    .map((d) => ({
      description: d.description.trim(),
      qty: parseFloat(d.qty),
      unitPriceCents: parseMoney(d.unitPrice),
    }));
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

// ─── Create / edit invoice ────────────────────────────────────────────────────

function InvoiceFormModal({
  open,
  onClose,
  invoice,
}: {
  open: boolean;
  onClose: () => void;
  invoice?: Invoice | null;
}) {
  const [clientId, setClientId] = useState("");
  const [clientName, setClientName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [issueDate, setIssueDate] = useState(todayYmd());
  const [dueDate, setDueDate] = useState("");
  const [drafts, setDrafts] = useState<ItemDraft[]>([{ ...EMPTY_ITEM }]);
  const [taxPct, setTaxPct] = useState("0");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    if (invoice) {
      setClientId(invoice.clientId != null ? String(invoice.clientId) : "");
      setClientName(invoice.clientName ?? "");
      setProjectId(invoice.projectId != null ? String(invoice.projectId) : "");
      setIssueDate(invoice.issueDate ?? "");
      setDueDate(invoice.dueDate ?? "");
      const items = parseLineItems(invoice.items);
      setDrafts(
        items.length
          ? items.map((it) => ({
              description: it.description,
              qty: String(it.qty),
              unitPrice: (it.unitPriceCents / 100).toFixed(2),
            }))
          : [{ ...EMPTY_ITEM }]
      );
      setTaxPct(String(invoice.taxRateBp / 100));
      setNotes(invoice.notes ?? "");
    } else {
      setClientId("");
      setClientName("");
      setProjectId("");
      setIssueDate(todayYmd());
      setDueDate("");
      setDrafts([{ ...EMPTY_ITEM }]);
      setTaxPct("0");
      setNotes("");
    }
  }, [open, invoice]);

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ["crm-clients"],
    queryFn: async () => (await apiRequest("GET", "/api/crm/clients")).json(),
    enabled: open,
  });
  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: async () => (await apiRequest("GET", "/api/projects")).json(),
    enabled: open,
  });

  const taxRateBp = Math.round((parseFloat(taxPct) || 0) * 100);
  const subtotalCents = draftSubtotalCents(drafts);
  const taxCents = Math.round((subtotalCents * taxRateBp) / 10000);
  const totalCents = subtotalCents + taxCents;

  const save = useApiMutation({
    request: () => {
      const body = {
        clientId: clientId ? Number(clientId) : null,
        clientName: clientId ? undefined : clientName.trim() || null,
        projectId: projectId ? Number(projectId) : null,
        issueDate: issueDate || null,
        dueDate: dueDate || null,
        items: JSON.stringify(draftsToLineItems(drafts)),
        taxRateBp,
        notes: notes.trim() || null,
      };
      return invoice
        ? { method: "PATCH", url: `/api/finance/invoices/${invoice.id}`, body }
        : { method: "POST", url: "/api/finance/invoices", body };
    },
    invalidate: INVOICE_KEYS,
    successTitle: invoice ? "Invoice updated" : "Invoice created",
    errorTitle: "Could not save",
    onSuccess: onClose,
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={invoice ? `Edit ${invoice.number}` : "New invoice"}
      maxWidth="max-w-2xl"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!clientId && !clientName.trim()) {
            toast({ variant: "destructive", title: "Pick a client or enter a name" });
            return;
          }
          if (draftsToLineItems(drafts).length === 0) {
            toast({ variant: "destructive", title: "Add at least one line item" });
            return;
          }
          save.mutate();
        }}
        className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Client</span>
            <select
              className={inputCls}
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            >
              <option value="">— No linked client —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.company ? ` (${c.company})` : ""}
                </option>
              ))}
            </select>
          </label>
          {!clientId && (
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-foreground">Client name</span>
              <input
                className={inputCls}
                placeholder="Free-text name"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
              />
            </label>
          )}
          <label className="flex flex-col gap-1.5">
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
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Issue date</span>
            <input
              type="date"
              className={inputCls}
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Due date</span>
            <input
              type="date"
              className={inputCls}
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </label>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-foreground">Line items</p>
          <LineItemsEditor drafts={drafts} onChange={setDrafts} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Tax %</span>
            <input
              className={inputCls}
              inputMode="decimal"
              value={taxPct}
              onChange={(e) => setTaxPct(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Notes (optional)</span>
            <input
              className={inputCls}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
        </div>

        <div className="rounded-lg border border-border bg-background p-3 text-sm">
          <div className="flex justify-between py-0.5">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="tabular-nums text-foreground">{formatMoney(subtotalCents)}</span>
          </div>
          <div className="flex justify-between py-0.5">
            <span className="text-muted-foreground">Tax ({formatBp(taxRateBp)})</span>
            <span className="tabular-nums text-foreground">{formatMoney(taxCents)}</span>
          </div>
          <div className="flex justify-between border-t border-border pt-1.5 font-semibold">
            <span className="text-foreground">Total</span>
            <span className="tabular-nums text-foreground">{formatMoney(totalCents)}</span>
          </div>
          {(invoice?.depositCents ?? 0) > 0 && (
            <div className="flex justify-between pt-0.5">
              <span className="text-amber-700 dark:text-amber-400">Deposit due</span>
              <span className="tabular-nums text-amber-700 dark:text-amber-400">
                {formatMoney(invoice!.depositCents!)}
              </span>
            </div>
          )}
        </div>

        <button type="submit" disabled={save.isPending} className={primaryBtn}>
          {save.isPending && <Loader2 className="h-5 w-5 animate-spin" />}
          {invoice ? "Save changes" : "Create invoice"}
        </button>
      </form>
    </Modal>
  );
}

// ─── From-estimate picker ─────────────────────────────────────────────────────

function FromEstimateModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const { data: estimates = [], isLoading } = useQuery<Estimate[]>({
    queryKey: ["crm-estimates", "accepted"],
    queryFn: async () =>
      (await apiRequest("GET", "/api/crm/estimates?status=accepted")).json(),
    enabled: open,
  });

  const create = useApiMutation<InvoiceRow, number>({
    request: (estimateId) => ({
      method: "POST",
      url: `/api/finance/invoices/from-estimate/${estimateId}`,
    }),
    invalidate: INVOICE_KEYS,
    successTitle: (inv) => `Invoice ${inv.number} created`,
    errorTitle: "Could not create invoice",
    onSuccess: (inv) => {
      onClose();
      onCreated(inv.id);
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="Invoice from estimate" maxWidth="max-w-lg">
      {isLoading ? (
        <div className="flex justify-center py-10 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : estimates.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
          <FileText className="h-10 w-10" />
          <p>No accepted estimates</p>
        </div>
      ) : (
        <div className="flex max-h-[60vh] flex-col divide-y divide-border overflow-y-auto">
          {estimates.map((est) => (
            <button
              key={est.id}
              disabled={create.isPending}
              onClick={() => create.mutate(est.id)}
              className="flex items-center gap-3 py-3 text-left hover:bg-accent/50 disabled:opacity-60"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">{est.title}</p>
                <p className="font-mono text-xs text-muted-foreground">{est.number}</p>
              </div>
              <span className="tabular-nums text-foreground">
                {formatMoney(est.totalCents)}
              </span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

// ─── Record payment ───────────────────────────────────────────────────────────

function RecordPaymentForm({
  invoice,
  onDone,
}: {
  invoice: InvoiceRow;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState((invoice.balanceCents / 100).toFixed(2));
  const [method, setMethod] = useState<PaymentMethod>("check");
  const [gatewayKey, setGatewayKey] = useState("");
  const [reference, setReference] = useState("");
  const [paidAt, setPaidAt] = useState(todayYmd());

  const { data: gateways = [] } = useQuery<PaymentGateway[]>({
    queryKey: ["finance-gateways"],
    queryFn: async () => (await apiRequest("GET", "/api/finance/gateways")).json(),
    enabled: method === "gateway",
  });
  const enabledGateways = gateways.filter((g) => g.enabled);

  const record = useApiMutation({
    request: () => ({
      method: "POST",
      url: `/api/finance/invoices/${invoice.id}/payments`,
      body: {
        amountCents: parseMoney(amount),
        method,
        gatewayKey: method === "gateway" && gatewayKey ? gatewayKey : undefined,
        reference: reference.trim() || undefined,
        paidAt: paidAt || undefined,
      },
    }),
    invalidate: INVOICE_KEYS,
    successTitle: "Payment recorded",
    errorTitle: "Could not record payment",
    onSuccess: onDone,
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (parseMoney(amount) <= 0) {
          toast({ variant: "destructive", title: "Enter a payment amount" });
          return;
        }
        record.mutate();
      }}
      className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4"
    >
      <p className="text-sm font-semibold text-foreground">Record payment</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Amount $</span>
          <input
            className={inputCls}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Method</span>
          <select
            className={inputCls}
            value={method}
            onChange={(e) => setMethod(e.target.value as PaymentMethod)}
          >
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </select>
        </label>
        {method === "gateway" && (
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Gateway</span>
            <select
              className={inputCls}
              value={gatewayKey}
              onChange={(e) => setGatewayKey(e.target.value)}
            >
              <option value="">— Select —</option>
              {enabledGateways.map((g) => (
                <option key={g.key} value={g.key}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Reference</span>
          <input
            className={inputCls}
            placeholder="Check #, transaction id…"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Date</span>
          <input
            type="date"
            className={inputCls}
            value={paidAt}
            onChange={(e) => setPaidAt(e.target.value)}
          />
        </label>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={record.isPending} className={cn(primaryBtn, "flex-1")}>
          {record.isPending && <Loader2 className="h-5 w-5 animate-spin" />}
          Record payment
        </button>
        <button type="button" onClick={onDone} className={secondaryBtn}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// ─── Invoice detail ───────────────────────────────────────────────────────────

function InvoiceDetailModal({
  id,
  onClose,
  onEdit,
}: {
  id: number;
  onClose: () => void;
  onEdit: (invoice: Invoice) => void;
}) {
  const [paying, setPaying] = useState(false);

  const { data, isLoading } = useQuery<{ invoice: InvoiceRow; payments: InvoicePayment[] }>({
    queryKey: ["finance-invoice", id],
    queryFn: async () => (await apiRequest("GET", `/api/finance/invoices/${id}`)).json(),
  });

  const setStatus = useApiMutation<unknown, InvoiceStatus>({
    request: (status) => ({
      method: "PATCH",
      url: `/api/finance/invoices/${id}`,
      body: { status },
    }),
    invalidate: INVOICE_KEYS,
    successTitle: (_row, status) =>
      status === "void" ? "Invoice voided" : "Invoice marked sent",
    errorTitle: "Could not update",
  });

  const reversePayment = useApiMutation<unknown, number>({
    request: (paymentId) => ({
      method: "DELETE",
      url: `/api/finance/payments/${paymentId}`,
    }),
    invalidate: INVOICE_KEYS,
    successTitle: "Payment reversed",
    errorTitle: "Could not reverse",
  });

  const del = useApiMutation({
    request: () => ({ method: "DELETE", url: `/api/finance/invoices/${id}` }),
    invalidate: INVOICE_KEYS,
    successTitle: "Invoice deleted",
    errorTitle: "Could not delete",
    onSuccess: onClose,
  });

  // Fix 4 (wiring plan): pull the job's billable-but-unbilled expenses and
  // per-worker labor onto this draft invoice as line items.
  const pullUnbilled = useApiMutation({
    request: () => ({
      method: "POST",
      url: `/api/finance/invoices/${id}/pull-unbilled`,
      body: { projectId: data?.invoice?.projectId },
    }),
    invalidate: INVOICE_KEYS,
    successTitle: "Unbilled work pulled onto invoice",
    errorTitle: "Could not pull unbilled work",
  });

  const inv = data?.invoice;
  const payments = data?.payments ?? [];
  const items = inv ? parseLineItems(inv.items) : [];
  const receivable = inv && (inv.status === "sent" || inv.status === "partial" || inv.status === "overdue");

  return (
    <Modal
      open
      onClose={onClose}
      title={inv ? inv.number : "Invoice"}
      maxWidth="max-w-2xl"
    >
      {isLoading || !inv ? (
        <div className="flex justify-center py-12 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : (
        <div className="flex max-h-[72vh] flex-col gap-4 overflow-y-auto pr-1">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <StatusChip status={inv.status} />
            <span className="font-medium text-foreground">
              {inv.clientName ?? "No client"}
            </span>
            {inv.issueDate && (
              <span className="text-muted-foreground">Issued {formatDate(inv.issueDate)}</span>
            )}
            {inv.dueDate && (
              <span className="text-muted-foreground">Due {formatDate(inv.dueDate)}</span>
            )}
          </div>

          {inv.notes && <p className="text-sm text-muted-foreground">{inv.notes}</p>}

          {/* Line items */}
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium uppercase text-muted-foreground">
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Unit</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">
                      No line items
                    </td>
                  </tr>
                ) : (
                  items.map((it, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 text-foreground">{it.description}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-foreground">
                        {it.qty}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-foreground">
                        {formatMoney(it.unitPriceCents)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-foreground">
                        {formatMoney(Math.round(it.qty * it.unitPriceCents))}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="ml-auto w-full max-w-xs text-sm">
            <div className="flex justify-between py-0.5">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="tabular-nums text-foreground">{formatMoney(inv.subtotalCents)}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-muted-foreground">Tax ({formatBp(inv.taxRateBp)})</span>
              <span className="tabular-nums text-foreground">{formatMoney(inv.taxCents)}</span>
            </div>
            <div className="flex justify-between border-t border-border py-1 font-semibold">
              <span className="text-foreground">Total</span>
              <span className="tabular-nums text-foreground">{formatMoney(inv.totalCents)}</span>
            </div>
            {(inv.depositCents ?? 0) > 0 && (
              <div className="flex justify-between py-0.5">
                <span className="text-amber-700 dark:text-amber-400">Deposit due</span>
                <span className="tabular-nums text-amber-700 dark:text-amber-400">
                  {formatMoney(inv.depositCents!)}
                </span>
              </div>
            )}
            <div className="flex justify-between py-0.5">
              <span className="text-muted-foreground">Paid</span>
              <span className="tabular-nums text-foreground">{formatMoney(inv.paidCents)}</span>
            </div>
            <div className="flex justify-between py-0.5 font-semibold">
              <span className="text-foreground">Balance</span>
              <span
                className={cn(
                  "tabular-nums",
                  inv.status === "overdue"
                    ? "text-red-600 dark:text-red-400"
                    : "text-foreground"
                )}
              >
                {formatMoney(inv.balanceCents)}
              </span>
            </div>
          </div>

          {/* Payments */}
          {payments.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-semibold text-foreground">Payments</p>
              <div className="divide-y divide-border rounded-lg border border-border">
                {payments.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="tabular-nums font-medium text-foreground">
                      {formatMoney(p.amountCents)}
                    </span>
                    <span className="text-muted-foreground">
                      {PAYMENT_METHOD_LABELS[p.method]}
                      {p.reference ? ` · ${p.reference}` : ""}
                    </span>
                    <span className="ml-auto text-muted-foreground">
                      {formatDate(p.paidAt ?? p.createdAt)}
                    </span>
                    {inv.status !== "void" && (
                      <button
                        aria-label="Reverse payment"
                        title="Reverse payment"
                        disabled={reversePayment.isPending}
                        onClick={() => {
                          if (window.confirm("Reverse this payment?")) {
                            reversePayment.mutate(p.id);
                          }
                        }}
                        className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-60"
                      >
                        <Undo2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions by state */}
          {paying && receivable ? (
            <RecordPaymentForm invoice={inv} onDone={() => setPaying(false)} />
          ) : (
            <div className="flex flex-wrap gap-2">
              {inv.status === "draft" && (
                <>
                  <button onClick={() => onEdit(inv)} className={secondaryBtn}>
                    <Pencil className="h-4 w-4" />
                    Edit
                  </button>
                  {inv.projectId != null && (
                    <button
                      onClick={() => pullUnbilled.mutate()}
                      disabled={pullUnbilled.isPending}
                      className={secondaryBtn}
                      title="Add the job's unbilled billable expenses and labor as line items"
                    >
                      {pullUnbilled.isPending
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <FolderInput className="h-4 w-4" />}
                      Pull unbilled from job
                    </button>
                  )}
                  <button
                    onClick={() => setStatus.mutate("sent")}
                    disabled={setStatus.isPending}
                    className={primaryBtn}
                  >
                    <Send className="h-4 w-4" />
                    Mark sent
                  </button>
                </>
              )}
              {receivable && (
                <>
                  <button onClick={() => setPaying(true)} className={primaryBtn}>
                    <CreditCard className="h-4 w-4" />
                    Record payment
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm(`Void invoice ${inv.number}? This cannot be undone.`)) {
                        setStatus.mutate("void");
                      }
                    }}
                    disabled={setStatus.isPending}
                    className={cn(secondaryBtn, "text-red-600 dark:text-red-400")}
                  >
                    <Ban className="h-4 w-4" />
                    Void
                  </button>
                </>
              )}
              {(inv.status === "paid" || inv.status === "void") && (
                <p className="text-sm text-muted-foreground">
                  {inv.status === "paid" ? "Paid in full — view only." : "Voided — view only."}
                </p>
              )}
              {/* Deletable only while no money is recorded against it — the
                  server enforces the same rule; paid history voids instead. */}
              {payments.length === 0 && (
                <button
                  onClick={() => {
                    if (window.confirm(`Delete invoice ${inv.number}? It moves out of the books entirely; any pulled billable work becomes billable again.`)) {
                      del.mutate();
                    }
                  }}
                  disabled={del.isPending}
                  className={cn(secondaryBtn, "ml-auto text-red-600 dark:text-red-400")}
                >
                  {del.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  Delete
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const TABS: { key: string; label: string }[] = [
  { key: "", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "sent", label: "Sent" },
  { key: "partial", label: "Partial" },
  { key: "overdue", label: "Overdue" },
  { key: "paid", label: "Paid" },
];

export default function InvoicesPage() {
  const [tab, setTab] = useState("");
  const [q, setQ] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [fromEstOpen, setFromEstOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [editInvoice, setEditInvoice] = useState<Invoice | null>(null);

  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (tab) params.set("status", tab);
    if (q.trim()) params.set("q", q.trim());
    const s = params.toString();
    return `/api/finance/invoices${s ? `?${s}` : ""}`;
  }, [tab, q]);

  const { data: rows = [], isLoading } = useQuery<InvoiceRow[]>({
    queryKey: ["finance-invoices", tab, q],
    queryFn: async () => (await apiRequest("GET", url)).json(),
  });

  return (
    <div className="mx-auto max-w-6xl">
      <Header title="Invoices" description="Billing and accounts receivable">
        <button onClick={() => setFromEstOpen(true)} className={secondaryBtn}>
          <FileText className="h-5 w-5" />
          From estimate
        </button>
        <button onClick={() => setNewOpen(true)} className={primaryBtn}>
          <Plus className="h-5 w-5" />
          New invoice
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
          placeholder="Search by number or client…"
          className="h-12 w-full rounded-xl border border-input bg-card pl-12 pr-4 text-base text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring"
        />
      </div>

      {isLoading ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <EmptyState icon={FileText} message={`No invoices${tab ? " with this status" : " yet"}`}>
          {!tab && !q && (
            <button onClick={() => setNewOpen(true)} className={primaryBtn}>
              <Plus className="h-5 w-5" />
              New invoice
            </button>
          )}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-medium uppercase text-muted-foreground">
                <th className="px-4 py-3">Number</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Issued</th>
                <th className="px-4 py-3">Due</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-right">Balance</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((inv) => (
                <tr
                  key={inv.id}
                  onClick={() => setDetailId(inv.id)}
                  className="cursor-pointer transition-colors hover:bg-accent/50"
                >
                  <td className="px-4 py-3 font-mono text-xs text-foreground">{inv.number}</td>
                  <td className="px-4 py-3 text-foreground">{inv.clientName ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {inv.issueDate ? formatDate(inv.issueDate) : "—"}
                  </td>
                  <td
                    className={cn(
                      "px-4 py-3",
                      inv.status === "overdue"
                        ? "font-medium text-red-600 dark:text-red-400"
                        : "text-muted-foreground"
                    )}
                  >
                    {inv.dueDate ? formatDate(inv.dueDate) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-foreground">
                    {formatMoney(inv.totalCents)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-foreground">
                    {formatMoney(inv.balanceCents)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusChip status={inv.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <InvoiceFormModal
        open={newOpen || editInvoice !== null}
        onClose={() => {
          setNewOpen(false);
          setEditInvoice(null);
        }}
        invoice={editInvoice}
      />
      <FromEstimateModal
        open={fromEstOpen}
        onClose={() => setFromEstOpen(false)}
        onCreated={(id) => setDetailId(id)}
      />
      {detailId !== null && (
        <InvoiceDetailModal
          id={detailId}
          onClose={() => setDetailId(null)}
          onEdit={(inv) => {
            setDetailId(null);
            setEditInvoice(inv);
          }}
        />
      )}
    </div>
  );
}
