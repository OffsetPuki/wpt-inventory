import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { CATEGORIES, AREAS, type Item } from "@shared/schema";
import { CATEGORY_LABELS, AREA_LABELS, locationString } from "@/lib/format";
import { stockLabel } from "@/lib/inventory";
import { inputCls, primaryBtn, secondaryBtn } from "@/lib/ui-styles";
import Header from "@/components/Header";
import ItemCard from "@/components/ItemCard";
import { Search, Plus, QrCode, Loader2 } from "lucide-react";
const ScanDialog = lazy(() => import("@/components/inventory/ScanDialog"));
const BatchLabels = lazy(() => import("@/components/inventory/BatchLabels"));
const RestockDialog = lazy(
  () => import("@/components/inventory/RestockDialog"),
);
type StockItem = Item & { available: number; onLoan: number };
export default function HomePage() {
  const [location] = useHashLocation(),
    [, navigate] = useLocation(),
    { isElevated } = useAuth();
  const params = new URLSearchParams(
    location.split("?")[1] || window.location.search,
  );
  const query = params.toString(),
    [q, setQ] = useState(params.get("q") || "");
  const [dialog, setDialog] = useState<"scan" | "labels" | "restock" | null>(
    null,
  );
  const [selected, setSelected] = useState<Map<number, Item>>(new Map());
  const restored = useRef(false);
  const filter =
      params.get("filter") || (params.get("lowStock") === "1" ? "low" : "all"),
    view = params.get("view") || "list";
  const setFilters = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    next.delete("lowStock");
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    navigate(`/home?${next}`, { replace: true });
  };
  useEffect(() => {
    setQ(params.get("q") || "");
  }, [params.get("q")]);
  useEffect(() => {
    if (q === (params.get("q") || "")) return;
    const timer = setTimeout(() => setFilters({ q, page: "1" }), 250);
    return () => clearTimeout(timer);
  }, [q, query]);
  const urlParams = new URLSearchParams(params);
  urlParams.set("filter", filter);
  const result = useQuery<{
    items: StockItem[];
    total: number;
    page: number;
    pages: number;
    limit: number;
  }>({
    queryKey: ["inventory", "list", urlParams.toString()],
    queryFn: async ({ signal }) =>
      (
        await apiRequest(
          "GET",
          `/api/inventory/items?${urlParams}`,
          undefined,
          { signal },
        )
      ).json(),
  });
  const data = result.data;
  useEffect(() => {
    try {
      sessionStorage.setItem("cjm.inventory.return", `/home?${query}`);
    } catch {}
  }, [query]);
  useEffect(() => {
    if (!data || restored.current) return;
    restored.current = true;
    try {
      const id = sessionStorage.getItem("cjm.inventory.focus");
      if (id)
        document
          .getElementById(`stock-${id}`)
          ?.scrollIntoView({ block: "center" });
    } catch {}
  }, [data]);
  const remember = (id: number) => {
    try {
      sessionStorage.setItem("cjm.inventory.focus", String(id));
    } catch {}
  };
  const toggle = (item: Item) =>
    setSelected((previous) => {
      const next = new Map(previous);
      if (next.has(item.id)) next.delete(item.id);
      else if (next.size < 100) next.set(item.id, item);
      return next;
    });
  const selectedItems = Array.from(selected.values());
  return (
    <div className="mx-auto max-w-6xl">
      <Header title="Inventory" description="Find it, use it, restock it">
        <button className={secondaryBtn} onClick={() => setDialog("scan")}>
          <QrCode className="h-4 w-4" />
          Scan QR
        </button>
        <Link className={primaryBtn} href="/add">
          <Plus className="h-4 w-4" />
          Add item
        </Link>
      </Header>
      <div className="sticky top-0 z-10 mb-4 space-y-3 bg-background py-3">
        <label className="relative block">
          <span className="sr-only">Search inventory</span>
          <Search className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
          <input
            className={`${inputCls} pl-10`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name, part number, rack, shelf, or location"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          {[
            ["all", "All"],
            ["low", "Low stock"],
            ["out", "Out of stock"],
            ["loans", "Tools checked out"],
          ].map(([key, label]) => (
            <button
              key={key}
              aria-pressed={filter === key}
              onClick={() => setFilters({ filter: key, page: "1", q })}
              className={`rounded-full border px-3 py-2 text-sm ${filter === key ? "border-primary bg-primary/10 text-primary" : "border-border"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <select
            aria-label="Category"
            className={`${inputCls} sm:w-auto`}
            value={params.get("category") || ""}
            onChange={(e) =>
              setFilters({ category: e.target.value, page: "1", q })
            }
          >
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
          <select
            aria-label="Location"
            className={`${inputCls} sm:w-auto`}
            value={params.get("area") || ""}
            onChange={(e) => setFilters({ area: e.target.value, page: "1", q })}
          >
            <option value="">All locations</option>
            {AREAS.map((a) => (
              <option key={a} value={a}>
                {AREA_LABELS[a]}
              </option>
            ))}
          </select>
          <select
            aria-label="Sort inventory"
            className={`${inputCls} sm:w-auto`}
            value={params.get("sort") || "name"}
            onChange={(e) => setFilters({ sort: e.target.value, page: "1", q })}
          >
            <option value="name">Name A–Z</option>
            <option value="newest">Newest first</option>
          </select>
          <select
            aria-label="View"
            className={`${inputCls} sm:ml-auto sm:w-auto`}
            value={view}
            onChange={(e) => setFilters({ view: e.target.value, q })}
          >
            <option value="list">Compact list</option>
            <option value="grid">Photo grid</option>
          </select>
        </div>
      </div>
      {selected.size > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
          <span className="text-sm">{selected.size} selected</span>
          <button className={secondaryBtn} onClick={() => setDialog("labels")}>
            Print labels
          </button>
          {isElevated && (
            <button className={primaryBtn} onClick={() => setDialog("restock")}>
              Restock selected
            </button>
          )}
          <button
            className="ml-auto text-sm underline"
            onClick={() => setSelected(new Map())}
          >
            Clear selection
          </button>
        </div>
      )}
      {result.isError ? (
        <div role="alert" className="rounded-xl border p-5">
          <p>Could not load inventory. {result.error.message}</p>
          <button
            className={`${secondaryBtn} mt-3`}
            onClick={() => void result.refetch()}
          >
            Retry
          </button>
        </div>
      ) : result.isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-7 w-7 animate-spin" />
        </div>
      ) : (
        data && (
          <>
            <div className="mb-3 flex items-center gap-3 text-sm text-muted-foreground">
              <span>{data.total} matching items</span>
              {data.items.length > 0 && (
                <label className="ml-auto flex items-center gap-2">
                  <input
                    type="checkbox"
                    aria-label="Select page"
                    checked={data.items.every((i) => selected.has(i.id))}
                    onChange={(e) =>
                      setSelected((previous) => {
                        const next = new Map(previous);
                        data.items.forEach((i) => {
                          if (e.target.checked && next.size < 100)
                            next.set(i.id, i);
                          else if (!e.target.checked) next.delete(i.id);
                        });
                        return next;
                      })
                    }
                  />
                  Select page
                </label>
              )}
            </div>
            {data.items.length === 0 ? (
              <div className="rounded-xl border p-8 text-center">
                <p>No items match these filters.</p>
                <button
                  className="mt-3 text-primary underline"
                  onClick={() => {
                    setQ("");
                    navigate("/home", { replace: true });
                  }}
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <div
                className={
                  view === "grid"
                    ? "grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4"
                    : "divide-y divide-border rounded-xl border border-border bg-card"
                }
              >
                {data.items.map((item) =>
                  view === "grid" ? (
                    <div
                      id={`stock-${item.id}`}
                      key={item.id}
                      onClick={() => remember(item.id)}
                    >
                      <label className="mb-1 flex items-center gap-2 text-xs">
                        <input
                          aria-label={`Select ${item.name}`}
                          type="checkbox"
                          checked={selected.has(item.id)}
                          onChange={() => toggle(item)}
                        />
                        Select
                      </label>
                      <ItemCard item={item} />
                    </div>
                  ) : (
                    <div
                      id={`stock-${item.id}`}
                      key={item.id}
                      className="flex items-center gap-3 p-3"
                    >
                      <input
                        className="h-4 w-4 shrink-0"
                        aria-label={`Select ${item.name}`}
                        type="checkbox"
                        checked={selected.has(item.id)}
                        onChange={() => toggle(item)}
                      />
                      <Link
                        onClick={() => remember(item.id)}
                        href={`/item/${item.id}`}
                        className="flex min-w-0 flex-1 items-center gap-3"
                      >
                        {item.photoUrl ? (
                          <img
                            src={item.photoUrl}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            className="h-12 w-12 shrink-0 rounded-lg object-cover"
                          />
                        ) : (
                          <span className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted text-xs text-muted-foreground sm:flex">
                            #{item.id}
                          </span>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="font-medium leading-tight">
                            {item.name}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {locationString(item)}
                          </p>
                          {item.onLoan > 0 && (
                            <p className="text-xs text-primary">
                              {item.onLoan} checked out
                            </p>
                          )}
                        </div>
                        <div className="max-w-[35%] text-right">
                          <p
                            className={`font-semibold ${item.available === 0 ? "text-destructive" : item.lowStockThreshold > 0 && item.available <= item.lowStockThreshold ? "text-orange-600" : ""}`}
                          >
                            {stockLabel(item.available, item.unit)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {item.available === 0
                              ? "Out of stock"
                              : "available"}
                          </p>
                          {item.quantityReserved > 0 && (
                            <p className="text-xs text-muted-foreground">
                              {item.quantityReserved} reserved
                            </p>
                          )}
                        </div>
                      </Link>
                    </div>
                  ),
                )}
              </div>
            )}
            <div className="my-5 flex items-center justify-between gap-2">
              <button
                className={secondaryBtn}
                disabled={data.page <= 1}
                onClick={() => setFilters({ page: String(data.page - 1) })}
              >
                Previous
              </button>
              <span className="text-sm">
                Page {data.page} of {data.pages}
              </span>
              <button
                className={secondaryBtn}
                disabled={data.page >= data.pages}
                onClick={() => setFilters({ page: String(data.page + 1) })}
              >
                Next
              </button>
            </div>
          </>
        )
      )}
      <Suspense fallback={<p role="status">Opening…</p>}>
        {dialog === "scan" && <ScanDialog onClose={() => setDialog(null)} />}{" "}
        {dialog === "labels" && (
          <BatchLabels items={selectedItems} onClose={() => setDialog(null)} />
        )}{" "}
        {dialog === "restock" && (
          <RestockDialog
            items={selectedItems}
            onClose={() => setDialog(null)}
          />
        )}
      </Suspense>
    </div>
  );
}
