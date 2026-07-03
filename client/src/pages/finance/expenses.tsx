import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { toast } from "@/components/ui/toaster";
import Header from "@/components/Header";
import Modal from "@/components/Modal";
import { cn } from "@/lib/utils";
import { formatDate, formatMoney, parseMoney } from "@/lib/format";
import { shrinkAndUpload } from "@/lib/uploadPhoto";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  type Expense,
  type ExpenseCategory,
  type PaymentMethod,
} from "@shared/finance-schema";
import type { Project } from "@shared/schema";
import {
  BadgeCheck,
  Loader2,
  Paperclip,
  Plus,
  Receipt,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";

// ─── Shared bits ──────────────────────────────────────────────────────────────

const inputCls =
  "h-11 w-full rounded-lg border border-input bg-background px-3 text-base text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring";
const primaryBtn =
  "flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60";
const secondaryBtn =
  "flex h-11 items-center justify-center gap-2 rounded-xl border border-border px-5 font-medium text-foreground hover:border-primary disabled:opacity-60";

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

const EXPENSE_KEYS = [["finance-expenses"], ["finance-stats"], ["finance-reports"]];

// Understated, theme-safe accents — a few hues cycled over the 13 categories.
const CATEGORY_STYLE: Record<ExpenseCategory, string> = {
  materials: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  fuel: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  tools_equipment: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  rent: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
  utilities: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400",
  marketing: "bg-pink-500/10 text-pink-700 dark:text-pink-400",
  insurance: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400",
  software: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  travel: "bg-teal-500/10 text-teal-700 dark:text-teal-400",
  meals: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  taxes_fees: "bg-red-500/10 text-red-700 dark:text-red-400",
  subcontractors: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  other: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
};

// ─── Add / edit dialog ────────────────────────────────────────────────────────

function ExpenseFormModal({
  open,
  onClose,
  expense,
  projects,
}: {
  open: boolean;
  onClose: () => void;
  expense?: Expense | null;
  projects: Project[];
}) {
  const qc = useQueryClient();
  const [date, setDate] = useState(todayStr());
  const [vendor, setVendor] = useState("");
  const [category, setCategory] = useState<ExpenseCategory>("materials");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("card");
  const [projectId, setProjectId] = useState("");
  const [billable, setBillable] = useState(false);
  const [notes, setNotes] = useState("");
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    if (expense) {
      setDate(expense.date);
      setVendor(expense.vendor ?? "");
      setCategory(expense.category);
      setAmount((expense.amountCents / 100).toFixed(2));
      setMethod(expense.paymentMethod);
      setProjectId(expense.projectId != null ? String(expense.projectId) : "");
      setBillable(expense.billable);
      setNotes(expense.notes ?? "");
      setReceiptUrl(expense.receiptUrl ?? null);
    } else {
      setDate(todayStr());
      setVendor("");
      setCategory("materials");
      setAmount("");
      setMethod("card");
      setProjectId("");
      setBillable(false);
      setNotes("");
      setReceiptUrl(null);
    }
  }, [open, expense]);

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        date,
        vendor: vendor.trim() || null,
        category,
        amountCents: parseMoney(amount),
        paymentMethod: method,
        projectId: projectId ? Number(projectId) : null,
        billable,
        notes: notes.trim() || null,
        receiptUrl,
      };
      const res = expense
        ? await apiRequest("PATCH", `/api/finance/expenses/${expense.id}`, body)
        : await apiRequest("POST", "/api/finance/expenses", body);
      return res.json();
    },
    onSuccess: () => {
      EXPENSE_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      toast({ variant: "success", title: expense ? "Expense updated" : "Expense added" });
      onClose();
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not save", description: e?.message }),
  });

  const remove = useMutation({
    mutationFn: async () =>
      (await apiRequest("DELETE", `/api/finance/expenses/${expense!.id}`)).json(),
    onSuccess: () => {
      EXPENSE_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      toast({ variant: "success", title: "Expense deleted" });
      onClose();
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not delete", description: e?.message }),
  });

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const url = await shrinkAndUpload(file);
      setReceiptUrl(url);
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Upload failed",
        description: e?.message,
      });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={expense ? "Edit expense" : "Add expense"}
      maxWidth="max-w-lg"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!date) {
            toast({ variant: "destructive", title: "Date is required" });
            return;
          }
          if (parseMoney(amount) <= 0) {
            toast({ variant: "destructive", title: "Enter an amount" });
            return;
          }
          save.mutate();
        }}
        className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Date</span>
            <input
              type="date"
              className={inputCls}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Vendor</span>
            <input
              className={inputCls}
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Category</span>
            <select
              className={inputCls}
              value={category}
              onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
            >
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {EXPENSE_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
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
        </div>

        <label className="flex items-center gap-2.5">
          <input
            type="checkbox"
            checked={billable}
            onChange={(e) => setBillable(e.target.checked)}
            className="h-5 w-5 rounded border-input accent-[hsl(var(--primary))]"
          />
          <span className="text-sm font-medium text-foreground">
            Billable to client / project
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Notes (optional)</span>
          <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

        {/* Receipt photo */}
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Receipt photo</span>
          {receiptUrl ? (
            <div className="flex items-center gap-2 text-sm">
              <a
                href={receiptUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-primary underline-offset-2 hover:underline"
              >
                <Paperclip className="h-4 w-4" />
                View attached receipt
              </a>
              <button
                type="button"
                aria-label="Remove receipt"
                onClick={() => setReceiptUrl(null)}
                className="rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              className={cn(secondaryBtn, "w-fit")}
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {uploading ? "Uploading…" : "Upload photo"}
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </div>

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={save.isPending || uploading}
            className={cn(primaryBtn, "flex-1")}
          >
            {save.isPending && <Loader2 className="h-5 w-5 animate-spin" />}
            {expense ? "Save changes" : "Add expense"}
          </button>
          {expense && (
            <button
              type="button"
              disabled={remove.isPending}
              onClick={() => {
                if (window.confirm("Delete this expense?")) remove.mutate();
              }}
              className={cn(secondaryBtn, "text-red-600 dark:text-red-400")}
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ExpensesPage() {
  const [category, setCategory] = useState("");
  const [projectId, setProjectId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);

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
    if (category) params.set("category", category);
    if (projectId) params.set("projectId", projectId);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (q.trim()) params.set("q", q.trim());
    const s = params.toString();
    return `/api/finance/expenses${s ? `?${s}` : ""}`;
  }, [category, projectId, from, to, q]);

  const { data, isLoading } = useQuery<{ rows: Expense[]; totalCents: number }>({
    queryKey: ["finance-expenses", category, projectId, from, to, q],
    queryFn: async () => (await apiRequest("GET", url)).json(),
  });
  const rows = data?.rows ?? [];
  const filtered = !!(category || projectId || from || to || q.trim());

  return (
    <div className="mx-auto max-w-6xl">
      <Header title="Expenses" description="Track what the business spends">
        <button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
          className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-5 w-5" />
          Add expense
        </button>
      </Header>

      {/* Filters */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <select
          className={inputCls}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">All categories</option>
          {EXPENSE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {EXPENSE_CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        <select
          className={inputCls}
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        >
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.jobNumber} — {p.name}
            </option>
          ))}
        </select>
        <input
          type="date"
          className={inputCls}
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          aria-label="From date"
        />
        <input
          type="date"
          className={inputCls}
          value={to}
          onChange={(e) => setTo(e.target.value)}
          aria-label="To date"
        />
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search vendor, notes…"
            className={cn(inputCls, "pl-9")}
          />
        </div>
      </div>

      {/* Running total of the filtered set */}
      <div className="mb-6 rounded-xl border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">
          {filtered ? "Total of filtered expenses" : "Total expenses"}
          {rows.length > 0 && ` · ${rows.length} ${rows.length === 1 ? "entry" : "entries"}`}
        </p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
          {formatMoney(data?.totalCents)}
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
          <Receipt className="h-12 w-12" />
          <p className="text-lg">{filtered ? "No expenses match the filters" : "No expenses yet"}</p>
          {!filtered && (
            <button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
              className={primaryBtn}
            >
              <Plus className="h-5 w-5" />
              Add expense
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-medium uppercase text-muted-foreground">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Vendor</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Project</th>
                <th className="px-4 py-3">Method</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3 text-center">Billable</th>
                <th className="px-4 py-3 text-center">Receipt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((e) => (
                <tr
                  key={e.id}
                  onClick={() => {
                    setEditing(e);
                    setFormOpen(true);
                  }}
                  className="cursor-pointer transition-colors hover:bg-accent/50"
                >
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                    {formatDate(e.date)}
                  </td>
                  <td className="px-4 py-3 text-foreground">{e.vendor ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium",
                        CATEGORY_STYLE[e.category]
                      )}
                    >
                      {EXPENSE_CATEGORY_LABELS[e.category]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{projectName(e.projectId)}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {PAYMENT_METHOD_LABELS[e.paymentMethod]}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-foreground">
                    {formatMoney(e.amountCents)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {e.billable && (
                      <BadgeCheck
                        className="inline h-4 w-4 text-emerald-600 dark:text-emerald-400"
                        aria-label="Billable"
                      />
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {e.receiptUrl && (
                      <a
                        href={e.receiptUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(ev) => ev.stopPropagation()}
                        className="inline-flex rounded-lg p-1 text-primary hover:bg-accent"
                        aria-label="View receipt"
                      >
                        <Paperclip className="h-4 w-4" />
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ExpenseFormModal
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        expense={editing}
        projects={projects}
      />
    </div>
  );
}
