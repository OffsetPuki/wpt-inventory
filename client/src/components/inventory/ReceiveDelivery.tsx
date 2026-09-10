import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { invalidateInventory, fractionalUnit } from "@/lib/inventory";
import { normalizeStockUnit } from "@shared/inventory";
import { locationString } from "@/lib/format";
import { inputCls, primaryBtn } from "@/lib/ui-styles";
import type { Item } from "@shared/schema";
import Modal from "../Modal";
type ReceiptDraft = {
  quantity: string;
  destination: string;
  stockQuantity: string;
  conversionNote: string;
  item?: Item;
};
function DeliveryLine({
  line,
  draft,
  onChange,
}: {
  line: any;
  draft: ReceiptDraft;
  onChange: (patch: Partial<ReceiptDraft>) => void;
}) {
  const [q, setQ] = useState(""),
    [search, setSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSearch(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  const matches = useQuery<{ items: Item[] }>({
    queryKey: ["inventory", "receiving-search", search],
    enabled: !!search.trim(),
    queryFn: async ({ signal }) =>
      (
        await apiRequest(
          "GET",
          `/api/inventory/items?q=${encodeURIComponent(search)}&limit=15`,
          undefined,
          { signal },
        )
      ).json(),
  });
  const options = Array.from(
    new Map(
      [
        ...(line.matches || []),
        ...(matches.data?.items || []),
        ...(draft.item ? [draft.item] : []),
      ].map((i) => [i.id, i]),
    ).values(),
  ) as Item[];
  const unit = draft.item?.unit;
  const conversion = !!unit && normalizeStockUnit(line.unit) !== unit;
  return (
    <div className="space-y-3 rounded-xl border p-3">
      <div>
        <p className="font-semibold">{line.description}</p>
        <p className="text-xs text-muted-foreground">
          Ordered {line.qty} {line.unit || "each"} · Already received{" "}
          {line.received} · Remaining {line.remaining}
        </p>
      </div>
      <label className="block text-sm">
        Received this delivery ({line.unit || "each"})
        <input
          className={inputCls}
          required
          type="number"
          min="0"
          max={line.remaining}
          step="0.0001"
          value={draft.quantity}
          onChange={(e) =>
            onChange({
              quantity: e.target.value,
              ...(!conversion ? { stockQuantity: e.target.value } : {}),
            })
          }
        />
      </label>
      {Number(draft.quantity) > 0 && (
        <>
          <label className="block text-sm">
            Find destination item
            <input
              className={inputCls}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search stock by name or location"
            />
          </label>
          <label className="block text-sm">
            Receive into
            <select
              aria-label="Receive into"
              required
              className={inputCls}
              value={draft.destination}
              onChange={(e) => {
                const item = options.find(
                  (i) => i.id === Number(e.target.value),
                );
                onChange({
                  destination: e.target.value,
                  item,
                  stockQuantity: item
                    ? normalizeStockUnit(line.unit) === item.unit
                      ? draft.quantity
                      : ""
                    : "0",
                });
              }}
            >
              <option value="">Choose inventory item and location</option>
              <option value="none">
                No inventory — service or direct expense
              </option>
              {options.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} · {i.unit} · {locationString(i)}
                </option>
              ))}
            </select>
          </label>
          {!line.matches.length && !draft.destination && (
            <p className="text-sm text-amber-700">
              This line is not linked to inventory. Choose its destination or
              mark it as a direct expense.
            </p>
          )}
          {conversion && (
            <div className="space-y-2 rounded-lg bg-amber-500/10 p-3">
              <p className="text-sm">
                Order uses {line.unit || "each"}; stock uses {unit}. Enter the
                converted quantity.
              </p>
              <label className="block text-sm">
                Add to stock ({unit})
                <input
                  required
                  type="number"
                  min={fractionalUnit(unit!) ? 0.0001 : 1}
                  step={fractionalUnit(unit!) ? 0.0001 : 1}
                  className={inputCls}
                  value={draft.stockQuantity}
                  onChange={(e) => onChange({ stockQuantity: e.target.value })}
                />
              </label>
              <label className="block text-sm">
                Conversion explanation
                <input
                  required
                  className={inputCls}
                  value={draft.conversionNote}
                  onChange={(e) => onChange({ conversionNote: e.target.value })}
                  placeholder="Example: 40 feet = two 20-foot sticks"
                />
              </label>
            </div>
          )}
          {draft.item && !conversion && (
            <p className="text-sm text-muted-foreground">
              Adds {draft.quantity} {unit} to {locationString(draft.item)}.
            </p>
          )}
          {matches.error && (
            <p role="alert">Could not find inventory items. Try again.</p>
          )}
        </>
      )}
    </div>
  );
}
export default function ReceiveDelivery({
  poId,
  onClose,
}: {
  poId: number;
  onClose: () => void;
}) {
  const qc = useQueryClient(),
    key = useRef(crypto.randomUUID()),
    initialized = useRef(false);
  const [drafts, setDrafts] = useState<Record<number, ReceiptDraft>>({});
  const detail = useQuery<any>({
    queryKey: ["inventory", "receiving", poId],
    queryFn: async () =>
      (
        await apiRequest(
          "GET",
          `/api/finance/purchase-orders/${poId}/receiving`,
        )
      ).json(),
  });
  useEffect(() => {
    if (!detail.data || initialized.current) return;
    initialized.current = true;
    setDrafts(
      Object.fromEntries(
        detail.data.lines.map((line: any) => {
          const item = line.matches.length === 1 ? line.matches[0] : undefined;
          return [
            line.lineIndex,
            {
              quantity: String(line.remaining),
              destination: item ? String(item.id) : "",
              item,
              stockQuantity:
                item && normalizeStockUnit(line.unit) === item.unit
                  ? String(line.remaining)
                  : "",
              conversionNote: "",
            },
          ];
        }),
      ),
    );
  }, [detail.data]);
  const save = useMutation({
    mutationFn: async () => {
      const lines = Object.entries(drafts)
        .filter(([, d]) => Number(d.quantity) > 0)
        .map(([i, d]) => ({
          lineIndex: Number(i),
          quantity: Number(d.quantity),
          itemId: d.destination === "none" ? null : Number(d.destination),
          stockQuantity: d.destination === "none" ? 0 : Number(d.stockQuantity),
          conversionNote: d.conversionNote,
        }));
      if (!lines.length)
        throw new Error("Enter at least one delivered quantity.");
      return apiRequest(
        "POST",
        `/api/finance/purchase-orders/${poId}/receive`,
        { requestKey: key.current, lines },
      );
    },
    onSuccess: () => {
      void invalidateInventory(qc);
      onClose();
    },
    onError: () => {
      void invalidateInventory(qc);
    },
  });
  return (
    <Modal
      open
      onClose={save.isPending ? () => {} : onClose}
      title={`Receive delivery${detail.data?.number ? ` · ${detail.data.number}` : ""}`}
      maxWidth="max-w-2xl"
    >
      <p className="mb-4 text-sm text-muted-foreground">
        Enter only what arrived today. Leave other lines at zero. The order
        stays open until everything is received.
      </p>
      {detail.error ? (
        <p role="alert">Could not load order. {detail.error.message}</p>
      ) : detail.isLoading ? (
        <p>Loading order…</p>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          {detail.data?.lines
            .filter((l: any) => l.remaining > 0)
            .map(
              (line: any) =>
                drafts[line.lineIndex] && (
                  <DeliveryLine
                    key={line.lineIndex}
                    line={line}
                    draft={drafts[line.lineIndex]}
                    onChange={(patch) =>
                      setDrafts((v) => ({
                        ...v,
                        [line.lineIndex]: { ...v[line.lineIndex], ...patch },
                      }))
                    }
                  />
                ),
            )}
          {save.error && (
            <p role="alert" className="text-destructive">
              {save.error.message}
            </p>
          )}
          <button
            className={primaryBtn}
            disabled={save.isPending || !Object.keys(drafts).length}
          >
            Record delivery
          </button>
        </form>
      )}
    </Modal>
  );
}
