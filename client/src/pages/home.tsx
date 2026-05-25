import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { CATEGORIES, type Item, type Category } from "@shared/schema";
import { CATEGORY_LABELS } from "@/lib/format";
import Header from "@/components/Header";
import ItemCard from "@/components/ItemCard";
import { CATEGORY_STYLES } from "@/components/CategoryBadge";
import { cn } from "@/lib/utils";
import { Search, Plus, Package, AlertTriangle, Loader2, X } from "lucide-react";

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-all hover:shadow-sm",
        active
          ? "border-primary bg-primary/15 text-primary"
          : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

export default function HomePage() {
  // Deep-link support: dashboard KPIs can pre-apply filters via ?lowStock=1, ?category=
  const urlParams = new URLSearchParams(window.location.search);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<Category | "">(
    (urlParams.get("category") as Category) || ""
  );
  const [lowStockOnly, setLowStockOnly] = useState(urlParams.get("lowStock") === "1");

  const { data: items = [], isLoading } = useQuery<Item[]>({
    queryKey: ["items", { q, category, lowStockOnly }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (category) params.set("category", category);
      if (lowStockOnly) params.set("lowStockOnly", "1");
      const res = await apiRequest("GET", `/api/items?${params.toString()}`);
      return res.json();
    },
  });

  const anyFilter = Boolean(q || category || lowStockOnly);
  function clearAll() {
    setQ("");
    setCategory("");
    setLowStockOnly(false);
  }

  return (
    <div className="mx-auto max-w-5xl">
      <Header title="Find Items" description="Search by name, part number, or location">
        <Link
          href="/add"
          className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Plus className="h-5 w-5" />
          Add item
        </Link>
      </Header>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search parts…"
          className="h-14 w-full rounded-xl border border-input bg-card pl-12 pr-12 text-lg text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring"
        />
        {q && (
          <button
            onClick={() => setQ("")}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="mb-2 flex gap-2 overflow-x-auto pb-2">
        <Chip active={category === ""} onClick={() => setCategory("")}>
          All
        </Chip>
        {CATEGORIES.map((c) => {
          const s = CATEGORY_STYLES[c];
          const Icon = s.icon;
          const isActive = category === c;
          return (
            <button
              key={c}
              onClick={() => setCategory(isActive ? "" : c)}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-all hover:shadow-sm",
                isActive
                  ? "border-primary bg-primary/15 text-primary"
                  : cn("border-border hover:bg-muted", s.text)
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {CATEGORY_LABELS[c]}
            </button>
          );
        })}
      </div>
      <div className="mb-6 flex gap-2">
        <Chip active={lowStockOnly} onClick={() => setLowStockOnly(!lowStockOnly)}>
          <span className="flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4" />
            Low stock only
          </span>
        </Chip>
      </div>

      {/* Result count + clear filters */}
      {!isLoading && (
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {items.length} {items.length === 1 ? "item" : "items"}
          </p>
          {anyFilter && (
            <button
              onClick={clearAll}
              className="flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              <X className="h-4 w-4" /> Clear filters
            </button>
          )}
        </div>
      )}

      {/* Results */}
      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="aspect-[4/3] w-full animate-pulse bg-muted" />
              <div className="flex flex-col gap-2 p-3">
                <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
                <div className="h-4 w-5/6 animate-pulse rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
          <Package className="h-12 w-12" />
          <p className="text-lg">No items found</p>
          {anyFilter ? (
            <button onClick={clearAll} className="font-medium text-primary hover:underline">
              Clear filters
            </button>
          ) : (
            <Link href="/add" className="font-medium text-primary hover:underline">
              Add your first item
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {items.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
