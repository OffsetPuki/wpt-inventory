import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { ADJUSTMENT_REASON_LABELS, formatDateTime } from "@/lib/format";
import type { AdjustmentReason } from "@shared/schema";
import Header from "@/components/Header";
import { cn } from "@/lib/utils";
import { PackageMinus, PackagePlus, Sliders, Loader2, Activity as ActivityIcon } from "lucide-react";

interface TxnRow {
  id: number;
  type: "check_out" | "check_in";
  quantity: number;
  item_id: number;
  item_name?: string;
  user_name?: string;
  created_at: number;
}
interface AdjRow {
  id: number;
  delta: number;
  reason: AdjustmentReason;
  item_id: number;
  item_name?: string;
  user_name?: string;
  notes: string | null;
  created_at: number;
}

type FeedItem =
  | { kind: "check_out" | "check_in"; id: number; qty: number; itemId: number; itemName?: string; userName?: string; at: number }
  | { kind: "adjust"; id: number; delta: number; reason: AdjustmentReason; itemId: number; itemName?: string; userName?: string; at: number };

type Filter = "all" | "check_out" | "check_in" | "adjust";

export default function ActivityPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");

  const { data: txns = [], isLoading: l1 } = useQuery<TxnRow[]>({
    queryKey: ["transactions", { all: true }],
    queryFn: async () => (await apiRequest("GET", "/api/transactions?limit=200")).json(),
  });
  const { data: adjs = [], isLoading: l2 } = useQuery<AdjRow[]>({
    queryKey: ["adjustments", { all: true }],
    queryFn: async () => (await apiRequest("GET", "/api/adjustments?limit=200")).json(),
  });

  const feed: FeedItem[] = useMemo(() => {
    const t: FeedItem[] = txns.map((x) => ({
      kind: x.type,
      id: x.id,
      qty: x.quantity,
      itemId: x.item_id,
      itemName: x.item_name,
      userName: x.user_name,
      at: x.created_at,
    }));
    const a: FeedItem[] = adjs.map((x) => ({
      kind: "adjust",
      id: x.id + 1_000_000_000,
      delta: x.delta,
      reason: x.reason,
      itemId: x.item_id,
      itemName: x.item_name,
      userName: x.user_name,
      at: x.created_at,
    }));
    return [...t, ...a].sort((p, q2) => q2.at - p.at);
  }, [txns, adjs]);

  const filtered = feed.filter((f) => {
    if (filter !== "all" && f.kind !== filter) return false;
    if (q) {
      const hay = `${f.itemName ?? ""} ${f.userName ?? ""}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  });

  const tabs: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "check_out", label: "Check-outs" },
    { key: "check_in", label: "Check-ins" },
    { key: "adjust", label: "Adjustments" },
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <Header title="Activity" description="Every check-in, check-out, and stock adjustment" />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setFilter(t.key)}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
              filter === t.key
                ? "border-primary bg-primary/15 text-primary"
                : "border-border text-muted-foreground hover:border-primary/40"
            )}
          >
            {t.label}
          </button>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by item or person…"
          className="ml-auto h-9 w-48 rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none focus:border-primary"
        />
      </div>

      {l1 || l2 ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
          <ActivityIcon className="h-12 w-12" />
          <p className="text-lg">No activity yet</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((f) => (
            <li
              key={`${f.kind}-${f.id}`}
              className="flex items-center gap-3 rounded-xl border border-border bg-card p-3"
            >
              {f.kind === "check_out" ? (
                <PackageMinus className="h-5 w-5 shrink-0 text-orange-400" />
              ) : f.kind === "check_in" ? (
                <PackagePlus className="h-5 w-5 shrink-0 text-green-400" />
              ) : (
                <Sliders className="h-5 w-5 shrink-0 text-primary" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">
                  {f.kind === "adjust" ? (
                    <>
                      <span className={f.delta < 0 ? "text-destructive" : "text-green-400"}>
                        {f.delta > 0 ? "+" : ""}
                        {f.delta}
                      </span>{" "}
                      {ADJUSTMENT_REASON_LABELS[f.reason]}
                    </>
                  ) : (
                    <>
                      {f.kind === "check_out" ? "Checked out " : "Checked in "}
                      <span className="font-medium">{f.qty}</span>
                    </>
                  )}{" "}
                  ·{" "}
                  <Link href={`/item/${f.itemId}`} className="text-primary hover:underline">
                    {f.itemName ?? `Item #${f.itemId}`}
                  </Link>
                </p>
                <p className="text-xs text-muted-foreground">
                  {f.userName ?? "Unknown"} · {formatDateTime(f.at)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
