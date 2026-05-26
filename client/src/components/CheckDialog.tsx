import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { toast } from "@/components/ui/toaster";
import type { Item, Project } from "@shared/schema";
import Modal from "./Modal";
import { Loader2, PackageMinus, PackagePlus } from "lucide-react";

const inputCls =
  "h-11 w-full rounded-lg border border-input bg-background px-3 text-base text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring";

interface CheckDialogProps {
  item: Item;
  mode: "check_out" | "check_in";
  open: boolean;
  onClose: () => void;
}

export default function CheckDialog({ item, mode, open, onClose }: CheckDialogProps) {
  const qc = useQueryClient();
  const [quantity, setQuantity] = useState("1");
  const [projectId, setProjectId] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open) {
      setQuantity("1");
      setProjectId("");
      setNotes("");
    }
  }, [open]);

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: async () => (await apiRequest("GET", "/api/projects")).json(),
    enabled: open,
  });

  const isOut = mode === "check_out";

  const mut = useMutation({
    mutationFn: async () => {
      const path = isOut ? "checkout" : "checkin";
      await apiRequest("POST", `/api/items/${item.id}/${path}`, {
        quantity: Number(quantity),
        projectId: projectId ? Number(projectId) : undefined,
        notes: notes.trim() || undefined,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["item", item.id] });
      qc.invalidateQueries({ queryKey: ["item-detail", item.id] });
      qc.invalidateQueries({ queryKey: ["items"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      toast({ variant: "success", title: isOut ? "Checked out" : "Checked in" });
      onClose();
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not save", description: e?.message }),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = Number(quantity);
    if (!q || q < 1) {
      toast({ variant: "destructive", title: "Enter a quantity of at least 1" });
      return;
    }
    if (isOut && q > item.quantity) {
      toast({ variant: "destructive", title: `Only ${item.quantity} in stock` });
      return;
    }
    mut.mutate();
  }

  return (
    <Modal open={open} onClose={onClose} title={isOut ? "Check out" : "Check in"}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {item.name} — <span className="font-medium text-foreground">{item.quantity}</span> in
          stock
        </p>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Quantity</span>
          <input
            className={inputCls}
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Project (optional)</span>
          <select
            className={inputCls}
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">— None —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.jobNumber} — {p.name}
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
          {mut.isPending ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : isOut ? (
            <PackageMinus className="h-5 w-5" />
          ) : (
            <PackagePlus className="h-5 w-5" />
          )}
          {isOut ? "Check out" : "Check in"}
        </button>
      </form>
    </Modal>
  );
}
