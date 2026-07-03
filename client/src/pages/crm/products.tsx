import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { toast } from "@/components/ui/toaster";
import Header from "@/components/Header";
import Modal from "@/components/Modal";
import { cn } from "@/lib/utils";
import { formatMoney, formatPercent, parseMoney } from "@/lib/format";
import type { Product } from "@shared/crm-schema";
import { Loader2, Plus, Package, Search, Pencil } from "lucide-react";

const inputCls =
  "h-11 w-full rounded-lg border border-input bg-background px-3 text-base text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring";

const chipCls = "rounded-full px-2.5 py-0.5 text-xs font-medium";

// ─── Create / edit dialog ─────────────────────────────────────────────────────

function ProductFormModal({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [sku, setSku] = useState(product?.sku ?? "");
  const [name, setName] = useState(product?.name ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [category, setCategory] = useState(product?.category ?? "");
  const [unit, setUnit] = useState(product?.unit ?? "");
  const [price, setPrice] = useState(product ? String(product.unitPriceCents / 100) : "");
  const [cost, setCost] = useState(product ? String(product.costCents / 100) : "");
  const [active, setActive] = useState(product?.active ?? true);

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        sku: sku.trim() || null,
        name: name.trim(),
        description: description.trim() || null,
        category: category.trim() || null,
        unit: unit.trim() || null,
        unitPriceCents: parseMoney(price),
        costCents: parseMoney(cost),
        active,
      };
      const res = product
        ? await apiRequest("PATCH", `/api/crm/products/${product.id}`, body)
        : await apiRequest("POST", "/api/crm/products", body);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm-products"] });
      toast({ variant: "success", title: product ? "Product updated" : "Product created" });
      onClose();
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not save product", description: e?.message }),
  });

  return (
    <Modal open onClose={onClose} title={product ? "Edit product" : "New product"} maxWidth="max-w-lg">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) {
            toast({ variant: "destructive", title: "Name is required" });
            return;
          }
          save.mutate();
        }}
        className="flex flex-col gap-4"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Name</span>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">SKU</span>
            <input className={inputCls} value={sku} onChange={(e) => setSku(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Category</span>
            <input className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Unit</span>
            <input className={inputCls} placeholder="each, hour, ft…" value={unit} onChange={(e) => setUnit(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Price ($)</span>
            <input className={inputCls} inputMode="decimal" placeholder="0.00" value={price} onChange={(e) => setPrice(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Cost ($)</span>
            <input className={inputCls} inputMode="decimal" placeholder="0.00" value={cost} onChange={(e) => setCost(e.target.value)} />
          </label>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Description</span>
          <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="flex items-center gap-2.5">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="h-4 w-4 accent-[hsl(var(--primary))]"
          />
          <span className="text-sm font-medium text-foreground">Active (available on estimates)</span>
        </label>
        <button
          type="submit"
          disabled={save.isPending}
          className="mt-1 flex h-12 items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          {save.isPending && <Loader2 className="h-5 w-5 animate-spin" />}
          {product ? "Save changes" : "Create product"}
        </button>
      </form>
    </Modal>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProductsPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [activeFilter, setActiveFilter] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);

  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  if (activeFilter) params.set("active", activeFilter);
  const url = `/api/crm/products${params.toString() ? `?${params.toString()}` : ""}`;

  const { data: products = [], isLoading } = useQuery<Product[]>({
    queryKey: ["crm-products", q.trim(), activeFilter],
    queryFn: async () => (await apiRequest("GET", url)).json(),
  });

  const toggleActive = useMutation({
    mutationFn: async (p: Product) =>
      (await apiRequest("PATCH", `/api/crm/products/${p.id}`, { active: !p.active })).json(),
    onSuccess: (row: Product) => {
      qc.invalidateQueries({ queryKey: ["crm-products"] });
      toast({ variant: "success", title: row.active ? "Product activated" : "Product deactivated" });
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not update product", description: e?.message }),
  });

  const margin = (p: Product): number | null =>
    p.unitPriceCents > 0 ? (p.unitPriceCents - p.costCents) / p.unitPriceCents : null;

  return (
    <div className="mx-auto max-w-6xl">
      <Header title="Products & Services" description="The catalog behind your estimates">
        <button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
          className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-5 w-5" />
          New product
        </button>
      </Header>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, SKU, or description…"
            className="h-11 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring"
          />
        </div>
        <select
          className="h-11 rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring"
          value={activeFilter}
          onChange={(e) => setActiveFilter(e.target.value)}
        >
          <option value="">All</option>
          <option value="1">Active</option>
          <option value="0">Inactive</option>
        </select>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : products.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
          <Package className="h-12 w-12" />
          <p className="text-lg">No products yet</p>
          <button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-5 w-5" />
            Add your first product
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-muted-foreground">
                <th className="px-4 py-3 font-medium">SKU</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Unit</th>
                <th className="px-4 py-3 text-right font-medium">Price</th>
                <th className="px-4 py-3 text-right font-medium">Cost</th>
                <th className="px-4 py-3 text-right font-medium">Margin</th>
                <th className="px-4 py-3 font-medium">Active</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {products.map((p) => {
                const m = margin(p);
                return (
                  <tr key={p.id} className="hover:bg-accent/50">
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{p.sku ?? "—"}</td>
                    <td className="px-4 py-3 font-medium text-foreground">
                      {p.name}
                      {p.description && (
                        <p className="mt-0.5 max-w-xs truncate text-xs font-normal text-muted-foreground">
                          {p.description}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{p.category ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{p.unit ?? "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground">
                      {formatMoney(p.unitPriceCents)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      {formatMoney(p.costCents)}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-3 text-right tabular-nums",
                        m == null
                          ? "text-muted-foreground"
                          : m < 0
                            ? "text-red-700 dark:text-red-400"
                            : "text-foreground"
                      )}
                    >
                      {formatPercent(m, 0)}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggleActive.mutate(p)}
                        disabled={toggleActive.isPending}
                        className={cn(
                          chipCls,
                          "cursor-pointer disabled:opacity-60",
                          p.active
                            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                            : "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400"
                        )}
                        title={p.active ? "Click to deactivate" : "Click to activate"}
                      >
                        {p.active ? "Active" : "Inactive"}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => {
                          setEditing(p);
                          setFormOpen(true);
                        }}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-foreground hover:border-primary"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {formOpen && (
        <ProductFormModal
          key={editing?.id ?? "new"}
          product={editing}
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
