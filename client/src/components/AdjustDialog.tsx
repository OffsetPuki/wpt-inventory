import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { toast } from "@/components/ui/toaster";
import { ADJUSTMENT_REASONS, type Item, type AdjustmentReason } from "@shared/schema";
import { ADJUSTMENT_REASON_LABELS } from "@/lib/format";
import Modal from "./Modal";
import { Loader2 } from "lucide-react";

const inputCls =
  "h-11 w-full rounded-lg border border-input bg-background px-3 text-base text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring";

interface AdjustDialogProps {
  item: Item;
  open: boolean;
  onClose: () => void;
}

export default function AdjustDialog({ item, open, onClose }: AdjustDialogProps) {
  const qc = useQueryClient();
  const [delta, setDelta] = useState("0");
  const [reason, setReason] = useState<AdjustmentReason>("count_correction");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open) {
      setDelta("0");
      setReason("count_correction");
      setNotes("");
    }
  }, [open]);

  const deltaNum = Number(delta) || 0;
  const projected = item.quantity + deltaNum;

  const mut = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/items/${item.id}/adjust`, {
        delta: deltaNum,
        reason,
        notes: notes.trim() || undefined,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["item", item.id] });
      qc.invalidateQueries({ queryKey: ["item-detail", item.id] });
      qc.invalidateQueries({ queryKey: ["items"] });
      qc.invalidateQueries({ queryKey: ["adjustments", item.id] });
      toast({ variant: "success", title: "Stock adjusted" });
      onClose();
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not adjust", description: e?.message }),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (deltaNum === 0) {
      toast({ variant: "destructive", title: "Enter a non-zero change" });
      return;
    }
    mut.mutate();
  }

  return (
    <Modal open={open} onClose={onClose} title="Adjust stock">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {item.name} — <span className="font-medium text-foreground">{item.quantity}</span> in
          stock
        </p>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">
            Change (use a negative number to remove)
          </span>
          <input
            className={inputCls}
            type="number"
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
          />
        </label>

        <p className="text-sm text-muted-foreground">
          New quantity will be{" "}
          <span
            className={
              projected < 0 ? "font-semibold text-destructive" : "font-semibold text-foreground"
            }
          >
            {projected}
          </span>
        </p>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Reason</span>
          <select
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

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Notes (optional)</span>
          <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

        <button
          type="submit"
          disabled={mut.isPending}
          className="mt-1 flex h-12 items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {mut.isPending && <Loader2 className="h-5 w-5 animate-spin" />}
          Save adjustment
        </button>
      </form>
    </Modal>
  );
}
