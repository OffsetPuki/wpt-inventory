import { useRef, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Item } from "@shared/schema";
import {
  availableStock,
  fractionalUnit,
  invalidateInventory,
  stockRound,
} from "@/lib/inventory";
import { apiRequest } from "@/lib/queryClient";
import { formatMoney } from "@/lib/format";
import { primaryBtn, inputCls } from "@/lib/ui-styles";
import Modal from "../Modal";
export default function RestockDialog({
  items,
  onClose,
}: {
  items: Item[];
  onClose: () => void;
}) {
  const qc = useQueryClient(),
    key = useRef(crypto.randomUUID());
  const [vendor, setVendor] = useState(
    items.every((i) => i.supplier === items[0]?.supplier)
      ? items[0]?.supplier || ""
      : "",
  );
  const [lines, setLines] = useState(
    items.map((item) => ({
      item,
      qty: String(
        Math.max(
          fractionalUnit(item.unit) ? 0.01 : 1,
          stockRound(
            Math.max(
              item.reorderTarget,
              item.lowStockThreshold + (fractionalUnit(item.unit) ? 0.01 : 1),
            ) - availableStock(item),
          ),
        ),
      ),
      cost: item.lastCostCents ? (item.lastCostCents / 100).toFixed(2) : "",
    })),
  );
  const [created, setCreated] = useState<any>(null);
  const save = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("POST", "/api/inventory/restock", {
          requestKey: key.current,
          vendor,
          lines: lines.map((l) => ({
            itemId: l.item.id,
            quantity: Number(l.qty),
            unitCostCents: Math.round(Number(l.cost) * 100),
          })),
        })
      ).json(),
    onSuccess: (po) => {
      setCreated(po);
      void invalidateInventory(qc);
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Restock inventory"
      maxWidth="max-w-2xl"
    >
      {created ? (
        <div className="space-y-4">
          <p>
            {created.number} created for {created.vendor}. Record each delivery
            when it arrives.
          </p>
          <Link className={primaryBtn} href="/finance/purchase-orders">
            Open purchase orders
          </Link>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <p className="text-sm text-muted-foreground">
            Review quantities and costs before creating an order. Group items
            for the same supplier.
          </p>
          <label className="block text-sm">
            Supplier
            <input
              required
              className={inputCls}
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
            />
          </label>
          {lines.map((l, index) => (
            <div key={l.item.id} className="rounded-xl border p-3">
              <p className="font-medium">{l.item.name}</p>
              <p className="mb-2 text-xs text-muted-foreground">
                {availableStock(l.item)} {l.item.unit} available ·{" "}
                {l.item.supplier || "No saved supplier"}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm">
                  Order quantity ({l.item.unit})
                  <input
                    required
                    min={fractionalUnit(l.item.unit) ? 0.0001 : 1}
                    step={fractionalUnit(l.item.unit) ? 0.0001 : 1}
                    type="number"
                    className={inputCls}
                    value={l.qty}
                    onChange={(e) =>
                      setLines((v) =>
                        v.map((x, i) =>
                          i === index ? { ...x, qty: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </label>
                <label className="text-sm">
                  Cost per {l.item.unit} ($)
                  <input
                    required
                    min="0"
                    step="0.01"
                    type="number"
                    className={inputCls}
                    value={l.cost}
                    onChange={(e) =>
                      setLines((v) =>
                        v.map((x, i) =>
                          i === index ? { ...x, cost: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </label>
              </div>
            </div>
          ))}
          <p className="font-semibold">
            Total{" "}
            {formatMoney(
              lines.reduce(
                (sum, l) =>
                  sum + Math.round(Number(l.qty) * Number(l.cost) * 100),
                0,
              ),
            )}
          </p>
          {save.error && (
            <p role="alert" className="text-destructive">
              {save.error.message}
            </p>
          )}
          <button className={primaryBtn} disabled={save.isPending}>
            Create purchase order
          </button>
        </form>
      )}
    </Modal>
  );
}
