import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { invalidateInventory, fractionalUnit } from "@/lib/inventory";
import { inputCls, primaryBtn, secondaryBtn } from "@/lib/ui-styles";
import { toast } from "@/components/ui/toaster";
import {
  ADJUSTMENT_REASONS,
  type Item,
  type AdjustmentReason,
} from "@shared/schema";
import { ADJUSTMENT_REASON_LABELS } from "@/lib/format";
import Modal from "./Modal";
export default function AdjustDialog({
  item,
  open,
  onClose,
}: {
  item: Item;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient(),
    key = useRef(crypto.randomUUID()),
    baseline = useRef({ version: item.stockVersion, quantity: item.quantity });
  const [count, setCount] = useState(String(item.quantity)),
    [reason, setReason] = useState<AdjustmentReason>("count_correction"),
    [notes, setNotes] = useState("");
  const reset = () => {
    baseline.current = { version: item.stockVersion, quantity: item.quantity };
    setCount(String(item.quantity));
    key.current = crypto.randomUUID();
  };
  useEffect(() => {
    if (open) {
      reset();
      setReason("count_correction");
      setNotes("");
    }
  }, [open, item.id]);
  const save = useMutation({
    mutationFn: async () =>
      apiRequest("POST", `/api/items/${item.id}/adjust`, {
        countedQuantity: Number(count),
        expectedVersion: baseline.current.version,
        reason,
        notes,
        requestKey: key.current,
      }),
    onSuccess: () => {
      void invalidateInventory(qc);
      toast({ variant: "success", title: "Count recorded" });
      onClose();
    },
    onError: () => {
      void invalidateInventory(qc);
    },
  });
  return (
    <Modal
      open={open}
      onClose={save.isPending ? () => {} : onClose}
      title="Count stock"
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <p className="text-sm">
          {item.name} · recorded count: {baseline.current.quantity} {item.unit}
        </p>
        <label className="block text-sm">
          I counted
          <input
            required
            type="number"
            min="0"
            step={fractionalUnit(item.unit) ? 0.0001 : 1}
            className={inputCls}
            value={count}
            onChange={(e) => setCount(e.target.value)}
          />
        </label>
        <p className="text-sm text-muted-foreground">
          Change:{" "}
          {(Number(count) - baseline.current.quantity).toLocaleString(
            undefined,
            { maximumFractionDigits: 4 },
          )}{" "}
          {item.unit}. Every count is recorded in history.
        </p>
        {Number(count) < item.quantityReserved && (
          <p className="text-sm text-amber-700">
            This is less than the reserved quantity. Review the affected jobs
            after recording your count.
          </p>
        )}
        <label className="block text-sm">
          Reason
          <select
            aria-label="Reason"
            className={inputCls}
            value={reason}
            onChange={(e) => setReason(e.target.value as AdjustmentReason)}
          >
            {ADJUSTMENT_REASONS.map((r) => (
              <option key={r} value={r}>
                {ADJUSTMENT_REASON_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Notes
          <input
            className={inputCls}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        {save.error && (
          <div role="alert">
            <p className="text-sm text-destructive">{save.error.message}</p>
            <button
              type="button"
              className={secondaryBtn}
              onClick={() => {
                reset();
                save.reset();
              }}
            >
              Start from latest count
            </button>
          </div>
        )}
        <button className={primaryBtn} disabled={save.isPending}>
          Record count
        </button>
      </form>
    </Modal>
  );
}
