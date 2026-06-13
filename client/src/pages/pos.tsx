import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { toast } from "@/components/ui/toaster";
import Header from "@/components/Header";
import { cn } from "@/lib/utils";
import { Loader2, PackageCheck, ClipboardList, ExternalLink } from "lucide-react";

interface PoLine {
  id: number;
  qb_item_id: string | null;
  qb_item_name?: string | null;
  local_item_id: number | null;
  local_item_name?: string | null;
  description: string | null;
  qty: number;
  unit_cost: number | null;
  qty_received: number;
}

interface Po {
  id: number;
  doc_number: string | null;
  vendor_name: string | null;
  txn_date: string | null;
  qb_status: string | null;
  memo: string | null;
  lines: PoLine[];
}

function ReceiveControl({ line, onDone }: { line: PoLine; onDone: () => void }) {
  const remaining = Math.max(0, line.qty - line.qty_received);
  const [qty, setQty] = useState(String(Math.floor(remaining) || 1));

  const receive = useMutation({
    mutationFn: async () =>
      apiRequest("POST", `/api/pos/lines/${line.id}/receive`, { qty: parseInt(qty, 10) }),
    onSuccess: () => {
      toast({ variant: "success", title: "Received", description: `${qty} added to stock` });
      onDone();
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Receive failed", description: e?.message }),
  });

  if (remaining <= 0) {
    return <span className="text-sm font-medium text-green-400">Fully received</span>;
  }
  if (!line.local_item_id) {
    return (
      <span className="text-xs text-orange-400">
        Not mapped — link this item on the QuickBooks page
      </span>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        min={1}
        max={Math.ceil(remaining)}
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        className="h-9 w-20 rounded-lg border border-input bg-background px-2 text-sm text-foreground outline-none focus:border-primary"
      />
      <button
        onClick={() => receive.mutate()}
        disabled={receive.isPending || !qty}
        className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
      >
        {receive.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
        Receive
      </button>
    </div>
  );
}

export default function PurchaseOrdersPage() {
  const { isTechnician } = useAuth();
  const qc = useQueryClient();

  const { data: pos = [], isLoading } = useQuery<Po[]>({
    queryKey: ["pos"],
    queryFn: async () => (await apiRequest("GET", "/api/pos")).json(),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["pos"] });
    qc.invalidateQueries({ queryKey: ["items"] });
  };

  return (
    <div className="mx-auto max-w-4xl">
      <Header title="Purchase Orders" description="Open orders from QuickBooks — receive deliveries here">
        {isTechnician && (
          <Link
            href="/qb"
            className="flex h-11 items-center gap-2 rounded-xl border border-border px-4 font-medium text-foreground hover:border-primary"
          >
            <ExternalLink className="h-4 w-4" />
            QuickBooks setup
          </Link>
        )}
      </Header>

      {isLoading ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : pos.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
          <ClipboardList className="h-12 w-12" />
          <p className="text-lg">No open purchase orders</p>
          <p className="max-w-sm text-sm">
            POs are entered in QuickBooks by the bookkeeper and appear here after a
            sync. Connect and sync from Settings.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {pos.map((po) => {
            const totalRemaining = po.lines.reduce(
              (s, l) => s + Math.max(0, l.qty - l.qty_received), 0
            );
            return (
              <div key={po.id} className="rounded-xl border border-border bg-card p-5">
                <div className="mb-3 flex flex-wrap items-center gap-3">
                  <h2 className="text-lg font-semibold text-foreground">
                    PO {po.doc_number || `#${po.id}`}
                  </h2>
                  {po.vendor_name && (
                    <span className="text-sm text-muted-foreground">{po.vendor_name}</span>
                  )}
                  {po.txn_date && (
                    <span className="text-sm text-muted-foreground">· {po.txn_date}</span>
                  )}
                  <span
                    className={cn(
                      "ml-auto rounded-full px-2.5 py-1 text-xs font-medium",
                      totalRemaining === 0
                        ? "bg-green-500/15 text-green-400"
                        : "bg-blue-500/15 text-blue-400"
                    )}
                  >
                    {totalRemaining === 0 ? "Fully received" : `${totalRemaining} expected`}
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="pb-2 pr-3 font-medium">Item</th>
                        <th className="pb-2 pr-3 font-medium">Ordered</th>
                        <th className="pb-2 pr-3 font-medium">Received</th>
                        <th className="pb-2 font-medium">Receive</th>
                      </tr>
                    </thead>
                    <tbody>
                      {po.lines.map((l) => (
                        <tr key={l.id} className="border-b border-border/50">
                          <td className="py-2 pr-3">
                            {l.local_item_id ? (
                              <Link
                                href={`/item/${l.local_item_id}`}
                                className="text-primary hover:underline"
                              >
                                {l.local_item_name || l.qb_item_name || l.description}
                              </Link>
                            ) : (
                              <span className="text-foreground">
                                {l.qb_item_name || l.description || "—"}
                              </span>
                            )}
                          </td>
                          <td className="py-2 pr-3 text-muted-foreground">{l.qty}</td>
                          <td className="py-2 pr-3 text-muted-foreground">{l.qty_received}</td>
                          <td className="py-2">
                            <ReceiveControl line={l} onDone={refresh} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
