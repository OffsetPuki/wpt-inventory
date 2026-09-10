import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { formatDateTime, ADJUSTMENT_REASON_LABELS } from "@/lib/format";
import { inputCls, secondaryBtn } from "@/lib/ui-styles";
import type { StockHistoryRow } from "@shared/inventory";
const labels: Record<string, string> = {
  ...ADJUSTMENT_REASON_LABELS,
  check_out: "Checked out",
  check_in: "Checked in",
  use_on_job: "Used on job",
  receive: "Received stock",
  return_tool: "Returned tool",
  return_unused: "Returned unused",
};
export default function StockHistory({ itemId }: { itemId?: number }) {
  const initial = new URLSearchParams(
    window.location.hash.split("?")[1] || window.location.search,
  );
  const [filter, setFilter] = useState(initial.get("filter") || "all"),
    [q, setQ] = useState(""),
    [search, setSearch] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [page, setPage] = useState(1);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(q);
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);
  const params = new URLSearchParams({
    filter,
    q: search,
    from,
    to,
    page: String(page),
    limit: "20",
    ...(itemId ? { itemId: String(itemId) } : {}),
  });
  const result = useQuery<{
    rows: StockHistoryRow[];
    total: number;
    page: number;
    pages: number;
  }>({
    queryKey: ["inventory", "history", params.toString()],
    queryFn: async ({ signal }) =>
      (
        await apiRequest("GET", `/api/inventory/history?${params}`, undefined, {
          signal,
        })
      ).json(),
  });
  return (
    <section className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <input
          aria-label="Search stock history"
          placeholder="Item, person, job, or note"
          className={`${inputCls} col-span-2`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          aria-label="Movement type"
          className={inputCls}
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="all">All movements</option>
          <option value="check_out">Used / checked out</option>
          <option value="check_in">Received / returned</option>
          <option value="adjust">Counts / adjustments</option>
        </select>
        <span className="self-center text-sm text-muted-foreground">
          {result.data?.total ?? "…"} records
        </span>
        <label className="text-xs">
          From
          <input
            type="date"
            className={inputCls}
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label className="text-xs">
          Through
          <input
            type="date"
            className={inputCls}
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
          />
        </label>
      </div>
      {result.isLoading ? (
        <p role="status">Loading history…</p>
      ) : result.error ? (
        <div role="alert">
          <p>Could not load history.</p>
          <button
            className={secondaryBtn}
            onClick={() => void result.refetch()}
          >
            Retry
          </button>
        </div>
      ) : result.data?.rows.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">
          No movements match these filters.
        </p>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {result.data?.rows.map((row) => (
            <li key={`${row.kind}-${row.id}`} className="p-3">
              <div className="flex justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">
                    {labels[row.reason] || row.reason} ·{" "}
                    {row.delta > 0 ? "+" : ""}
                    {row.delta} {row.unit}
                  </p>
                  {!itemId && (
                    <Link
                      className="text-sm text-primary"
                      href={`/item/${row.itemId}`}
                    >
                      {row.itemName || `Item #${row.itemId}`}
                    </Link>
                  )}
                </div>
                <p className="shrink-0 text-sm tabular-nums">
                  {row.before == null
                    ? "Earlier record"
                    : `${row.before} → ${row.after}`}
                </p>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {row.userName || "Unknown user"} · {formatDateTime(row.at)}
                {row.jobNumber ? ` · ${row.jobNumber}` : ""}
              </p>
              {row.notes && (
                <p className="mt-1 break-words text-sm text-muted-foreground">
                  {row.notes}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {result.data && (
        <div className="flex items-center justify-between">
          <button
            className={secondaryBtn}
            disabled={result.data.page <= 1}
            onClick={() => setPage(result.data!.page - 1)}
          >
            Newer
          </button>
          <span className="text-sm">
            Page {result.data.page} of {result.data.pages}
          </span>
          <button
            className={secondaryBtn}
            disabled={result.data.page >= result.data.pages}
            onClick={() => setPage(result.data!.page + 1)}
          >
            Older
          </button>
        </div>
      )}
    </section>
  );
}
