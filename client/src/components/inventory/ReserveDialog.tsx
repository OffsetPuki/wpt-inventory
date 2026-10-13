import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Item, Project } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import {
  availableStock,
  fractionalUnit,
  invalidateInventory,
} from "@/lib/inventory";
import { inputCls, primaryBtn } from "@/lib/ui-styles";
import Modal from "../Modal";
import { RetryBlock } from "../RetryBlock";
export default function ReserveDialog({
  item,
  onClose,
  legacy: initialLegacy,
}: {
  item: Item;
  onClose: () => void;
  legacy?: number;
}) {
  const qc = useQueryClient(),
    key = useRef(crypto.randomUUID()),
    baseline = useRef({ available: availableStock(item), version: item.stockVersion, legacy: initialLegacy });
  const legacy = baseline.current.legacy;
  const [selectedJob, setSelectedJob] = useState<Project | null>(null);
  const projectId = selectedJob ? String(selectedJob.id) : '';
  const [quantity, setQuantity] = useState(String(legacy || 1)),
    [q, setQ] = useState(""),
    [search, setSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSearch(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  const [action, setAction] = useState("assign");
  const jobs = useQuery<Project[]>({
    queryKey: ["inventory", "jobs", search],
    queryFn: async ({ signal }) =>
      (
        await apiRequest(
          "GET",
          `/api/inventory/jobs?q=${encodeURIComponent(search)}`,
          undefined,
          { signal },
        )
      ).json(),
  });
  const jobOptions = selectedJob
    ? [selectedJob, ...(jobs.data || []).filter(job => job.id !== selectedJob.id)]
    : jobs.data || [];
  const save = useMutation({
    mutationFn: async () =>
      apiRequest(
        "POST",
        `/api/items/${item.id}/${legacy ? "legacy-reservation" : "reservations"}`,
        {
          projectId: projectId ? Number(projectId) : undefined,
          quantity: Number(quantity),
          requestKey: key.current,
          ...(legacy ? { action, expectedVersion: baseline.current.version } : {}),
        },
      ),
    onSuccess: () => {
      void invalidateInventory(qc);
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      busy={save.isPending}
      title={legacy ? "Review older reservation" : "Reserve for a job"}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <p>
          {legacy
            ? `${legacy} ${item.unit} reserved without a confirmed job`
            : `${baseline.current.available} ${item.unit} available when opened`}
        </p>
        {!!legacy && (
          <label className="block text-sm">
            Action
            <select
              aria-label="Reservation action"
              className={inputCls}
              value={action}
              onChange={(e) => setAction(e.target.value)}
            >
              <option value="assign">Assign to a job</option>
              <option value="release">Release this reservation</option>
            </select>
          </label>
        )}
        {(!legacy || action === "assign") && (
          <>
            <label className="block text-sm">
              Find job
              <input
                className={inputCls}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              Job
              <select
                aria-label="Job"
                required
                className={inputCls}
                value={projectId}
                onChange={(e) => setSelectedJob(jobOptions.find(job => job.id === Number(e.target.value)) || null)}
              >
                <option value="">Choose job</option>
                {jobOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.jobNumber} — {p.name}
                  </option>
                ))}
              </select>
            </label>
            {jobs.isLoading && <p className="text-sm text-muted-foreground">Loading jobs…</p>}
            {jobs.error && <RetryBlock query={jobs} />}
          </>
        )}
        <label className="block text-sm">
          Quantity
          <input
            required
            type="number"
            min={fractionalUnit(item.unit) ? 0.0001 : 1}
            step={fractionalUnit(item.unit) ? 0.0001 : 1}
            max={legacy || baseline.current.available}
            className={inputCls}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </label>
        {save.error && (
          <p role="alert" className="text-sm text-destructive">
            {save.error.message}
          </p>
        )}
        <div className="suite-modal-actions"><button className={primaryBtn} disabled={save.isPending}>
          {legacy ? "Save reviewed reservation" : "Reserve stock"}
        </button></div>
      </form>
    </Modal>
  );
}
