import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  availableStock,
  isTool,
  fractionalUnit,
  invalidateInventory,
  stockLabel,
} from "@/lib/inventory";
import { inputCls, primaryBtn } from "@/lib/ui-styles";
import { toast } from "@/components/ui/toaster";
import type { Item, Project } from "@shared/schema";
import type { InventoryLoan, InventoryReservation } from "@shared/inventory";
import Modal from "./Modal";
export default function CheckDialog({
  item,
  mode,
  open,
  onClose,
}: {
  item: Item;
  mode: "check_out" | "check_in" | "receive";
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient(),
    key = useRef(crypto.randomUUID());
  const [quantity, setQuantity] = useState("1"),
    [projectId, setProjectId] = useState(""),
    [loanId, setLoanId] = useState(""),
    [notes, setNotes] = useState(""),
    [search, setSearch] = useState(""),
    [jobSearch, setJobSearch] = useState("");
  const tool = isTool(item),
    out = mode === "check_out";
  const title = out
    ? tool
      ? "Check out"
      : "Use on job"
    : mode === "receive"
      ? "Receive stock"
      : tool
        ? "Return tool"
        : "Return unused";
  useEffect(() => {
    if (open) {
      setQuantity("1");
      setProjectId("");
      setLoanId("");
      setNotes("");
      key.current = crypto.randomUUID();
    }
  }, [open, item.id, mode]);
  useEffect(() => {
    const timer = setTimeout(() => setJobSearch(search), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const jobs = useQuery<Project[]>({
    queryKey: ["inventory", "jobs", jobSearch],
    enabled: open && (out || (!tool && mode === "check_in")),
    queryFn: async ({ signal }) =>
      (
        await apiRequest(
          "GET",
          `/api/inventory/jobs?q=${encodeURIComponent(jobSearch)}`,
          undefined,
          { signal },
        )
      ).json(),
  });
  const availability = useQuery<{
    loans: InventoryLoan[];
    reservations: InventoryReservation[];
  }>({
    queryKey: ["inventory", "availability", item.id],
    enabled: open,
    queryFn: async () =>
      (await apiRequest("GET", `/api/items/${item.id}/availability`)).json(),
  });
  const own = (availability.data?.reservations || [])
    .filter((r) => r.projectId === Number(projectId))
    .reduce((sum, r) => sum + r.quantity, 0);
  const max = Math.min(item.quantity, availableStock(item) + own);
  const save = useMutation({
    mutationFn: async () => {
      await apiRequest(
        "POST",
        `/api/items/${item.id}/${out ? "checkout" : "checkin"}`,
        {
          quantity: Number(quantity),
          projectId: projectId ? Number(projectId) : undefined,
          loanId: loanId ? Number(loanId) : undefined,
          action: mode === "receive" ? "receive" : undefined,
          notes: notes.trim() || undefined,
          requestKey: key.current,
        },
      );
    },
    onSuccess: () => {
      void invalidateInventory(qc);
      toast({ variant: "success", title: "Stock updated" });
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
      title={title}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <p className="text-sm">
          {item.name} · {stockLabel(item.quantity, item.unit)} on hand
        </p>
        {tool && mode === "check_in" && (
          <label className="block text-sm">
            Checkout being returned
            <select
              aria-label="Checkout being returned"
              required
              className={inputCls}
              value={loanId}
              onChange={(e) => setLoanId(e.target.value)}
            >
              <option value="">Choose checkout</option>
              {availability.data?.loans.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.borrowerName} · {l.remaining} out
                  {l.jobNumber ? ` · ${l.jobNumber}` : ""}
                </option>
              ))}
            </select>
            {availability.data?.loans.length === 0 && (
              <p className="mt-2 text-muted-foreground">
                No tracked checkouts. Use Count stock to reconcile older tool
                records, or Receive stock for new purchases.
              </p>
            )}
          </label>
        )}
        {(out || (!tool && mode === "check_in")) && (
          <div className="space-y-2">
            <label className="block text-sm">
              Find job
              <input
                className={inputCls}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Job number or name"
              />
            </label>
            <label className="block text-sm">
              Job
              <select
                aria-label="Job"
                className={inputCls}
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                <option value="">Shop use (no job)</option>
                {jobs.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.jobNumber} — {p.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-sm text-muted-foreground">
              {stockLabel(max, item.unit)} available for this selection
              {own > 0 ? ` (${own} reserved for this job)` : ""}.
            </p>
            {jobs.error && <p role="alert">Could not load jobs. Try again.</p>}
          </div>
        )}
        <label className="block text-sm">
          Quantity ({item.unit})
          <input
            required
            className={inputCls}
            type="number"
            min={fractionalUnit(item.unit) && !tool ? 0.0001 : 1}
            step={fractionalUnit(item.unit) && !tool ? 0.0001 : 1}
            max={
              out
                ? max
                : tool && mode === "check_in"
                  ? availability.data?.loans.find(
                      (l) => l.id === Number(loanId),
                    )?.remaining
                  : undefined
            }
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          Notes (optional)
          <input
            className={inputCls}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        {save.error && (
          <p role="alert" className="text-sm text-destructive">
            {save.error.message}
          </p>
        )}
        {availability.error && (
          <p role="alert">
            Could not check reservations and returns. Close and try again.
          </p>
        )}
        <button
          className={`${primaryBtn} w-full`}
          disabled={
            save.isPending || availability.isLoading || availability.isError
          }
        >
          {save.isPending ? "Saving…" : title}
        </button>
      </form>
    </Modal>
  );
}
