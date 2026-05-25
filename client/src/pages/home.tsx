import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { CATEGORIES, AREAS, type Item, type Category, type Area } from "@shared/schema";
import { CATEGORY_LABELS, AREA_LABELS } from "@/lib/format";
import Header from "@/components/Header";
import ItemCard from "@/components/ItemCard";
import { cn } from "@/lib/utils";
import { Search, Plus, Package, AlertTriangle, Loader2 } from "lucide-react";

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
        "shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
        active
          ? "border-primary bg-primary/15 text-primary"
          : "border-border text-muted-foreground hover:border-primary/40"
      )}
    >
      {children}
    </button>
  );
}

export default function HomePage() {
  // Deep-link support: dashboard KPIs can pre-apply filters via ?lowStock=1, ?category=, ?area=
  const urlParams = new URLSearchParams(window.location.search);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<Category | "">(
    (urlParams.get("category") as Category) || ""
  );
  const [area, setArea] = useState<Area | "">((urlParams.get("area") as Area) || "");
  const [lowStockOnly, setLowStockOnly] = useState(urlParams.get("lowStock") === "1");

  const { data: items = [], isLoading } = useQuery<Item[]>({
    queryKey: ["items", { q, category, area, lowStockOnly }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (category) params.set("category", category);
      if (area) params.set("area", area);
      if (lowStockOnly) params.set("lowStockOnly", "1");
      const res = await apiRequest("GET", `/api/items?${params.toString()}`);
      return res.json();
    },
  });

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
          className="h-14 w-full rounded-xl border border-input bg-card pl-12 pr-4 text-lg text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* Filters */}
      <div className="mb-2 flex gap-2 overflow-x-auto pb-2">
        <Chip active={category === ""} onClick={() => setCategory("")}>
          All categories
        </Chip>
        {CATEGORIES.map((c) => (
          <Chip key={c} active={category === c} onClick={() => setCategory(c)}>
            {CATEGORY_LABELS[c]}
          </Chip>
        ))}
      </div>
      <div className="mb-2 flex gap-2 overflow-x-auto pb-2">
        <Chip active={area === ""} onClick={() => setArea("")}>
          All areas
        </Chip>
        {AREAS.map((a) => (
          <Chip key={a} active={area === a} onClick={() => setArea(a)}>
            {AREA_LABELS[a]}
          </Chip>
        ))}
      </div>
      <div className="mb-6 flex gap-2">
        <Chip active={lowStockOnly} onClick={() => setLowStockOnly(!lowStockOnly)}>
          <span className="flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4" />
            Low stock only
          </span>
        </Chip>
      </div>

      {/* Results */}
      {isLoading ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
          <Package className="h-12 w-12" />
          <p className="text-lg">No items found</p>
          <Link href="/add" className="font-medium text-primary hover:underline">
            Add your first item
          </Link>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
