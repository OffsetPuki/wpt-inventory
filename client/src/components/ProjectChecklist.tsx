import { memo, useCallback, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { toast } from "@/components/ui/toaster";
import { CHECKLIST_STATUS, type ChecklistRowWithItem, type ChecklistStatus, type Item } from "@shared/schema";
import { cn } from "@/lib/utils";
import { Plus, Trash2, Loader2 } from "lucide-react";

const STATUS_STYLE: Record<ChecklistStatus, string> = {
  pending: "bg-secondary text-secondary-foreground",
  ordered: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  done: "bg-green-500/15 text-green-700 dark:text-green-400",
  skipped: "bg-muted text-muted-foreground line-through",
};

const STATUS_LABEL: Record<ChecklistStatus, string> = {
  pending: "Pending",
  ordered: "Ordered",
  done: "Done",
  skipped: "Skipped",
};

const inputCls =
  "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring";

// A single checklist row, memoized so that flipping one row's status doesn't
// re-render every other row. The parent passes stable callbacks (useCallback)
// so React.memo's referential equality check actually holds.
const ChecklistRow = memo(function ChecklistRow({
  row,
  isManager,
  items,
  onStatusChange,
  onLinkItem,
  onDelete,
}: {
  row: ChecklistRowWithItem;
  isManager: boolean;
  items: Item[];
  onStatusChange: (id: number, status: ChecklistStatus) => void;
  onLinkItem: (id: number, itemId: number) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <tr className="border-b border-border/50">
      <td className="py-2 pr-3">
        {/* Workers and managers can both check items off while prepping. */}
        <select
          value={row.status}
          onChange={(e) => onStatusChange(row.id, e.target.value as ChecklistStatus)}
          className={cn(
            "cursor-pointer rounded-full px-2.5 py-1 text-xs font-medium outline-none",
            STATUS_STYLE[row.status]
          )}
        >
          {CHECKLIST_STATUS.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </td>
      <td className="py-2 pr-3">
        {row.item ? (
          <Link href={`/item/${row.item.id}`} className="text-primary hover:underline">
            {row.label}
          </Link>
        ) : (
          <span className="text-foreground">{row.label}</span>
        )}
        {/* #19b: managers link a free-text row to a real inventory item so
            checking it off moves stock. */}
        {isManager && !row.item && items.length > 0 && (
          <select
            className="mt-1 block h-7 max-w-[220px] rounded-md border border-input bg-background px-1.5 text-xs text-muted-foreground outline-none focus:border-primary"
            value=""
            onChange={(e) => {
              if (e.target.value) onLinkItem(row.id, Number(e.target.value));
            }}
          >
            <option value="">Link inventory item…</option>
            {items.map((it) => (
              <option key={it.id} value={it.id}>
                {it.name}
              </option>
            ))}
          </select>
        )}
      </td>
      <td className="py-2 pr-3 text-muted-foreground">
        {row.qty}
        {row.unit ? ` ${row.unit}` : ""}
      </td>
      <td className="py-2 pr-3 text-muted-foreground">{row.notes}</td>
      {isManager && (
        <td className="py-2 text-right">
          <button
            onClick={() => onDelete(row.id)}
            className="text-muted-foreground transition-colors hover:text-destructive"
            aria-label="Delete row"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </td>
      )}
    </tr>
  );
});

export default function ProjectChecklist({ projectId }: { projectId: number }) {
  // Manager + technician both edit checklists. Workers can only tick rows off.
  const { isElevated: isManager } = useAuth();
  const qc = useQueryClient();
  const [newLabel, setNewLabel] = useState("");
  const [newQty, setNewQty] = useState("1");
  const [newUnit, setNewUnit] = useState("");
  const [newItemId, setNewItemId] = useState("");

  const { data: rows = [], isLoading } = useQuery<ChecklistRowWithItem[]>({
    queryKey: ["checklist", projectId],
    queryFn: async () =>
      (await apiRequest("GET", `/api/projects/${projectId}/checklist`)).json(),
  });

  // Inventory items for the optional row↔item link (#19b) — managers only.
  const { data: allItems = [] } = useQuery<Item[]>({
    queryKey: ["items"],
    queryFn: async () => (await apiRequest("GET", "/api/items")).json(),
    enabled: isManager,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["checklist", projectId] });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: ChecklistStatus }) =>
      apiRequest("PATCH", `/api/checklist/${id}`, { status }),
    onSuccess: invalidate,
    onError: (e: any) => toast({ variant: "destructive", title: "Update failed", description: e?.message }),
  });

  const addRow = useMutation({
    mutationFn: async () =>
      apiRequest("POST", `/api/projects/${projectId}/checklist`, {
        label: newLabel.trim(),
        qty: newQty.trim() || "1",
        unit: newUnit.trim() || undefined,
        itemId: newItemId ? Number(newItemId) : undefined,
      }),
    onSuccess: () => {
      setNewLabel("");
      setNewQty("1");
      setNewUnit("");
      setNewItemId("");
      invalidate();
    },
    onError: (e: any) => toast({ variant: "destructive", title: "Could not add", description: e?.message }),
  });

  const linkItem = useMutation({
    mutationFn: async ({ id, itemId }: { id: number; itemId: number }) =>
      apiRequest("PATCH", `/api/checklist/${id}`, { itemId }),
    onSuccess: invalidate,
    onError: (e: any) => toast({ variant: "destructive", title: "Could not link item", description: e?.message }),
  });

  const delRow = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/checklist/${id}`),
    onSuccess: invalidate,
  });

  // Stable callbacks so ChecklistRow's memo prop check actually holds.
  const handleStatusChange = useCallback(
    (id: number, status: ChecklistStatus) => setStatus.mutate({ id, status }),
    [setStatus],
  );
  const handleLinkItem = useCallback(
    (id: number, itemId: number) => linkItem.mutate({ id, itemId }),
    [linkItem],
  );
  const handleDelete = useCallback((id: number) => delRow.mutate(id), [delRow]);

  const total = rows.length;
  const skipped = rows.filter((r) => r.status === "skipped").length;
  const done = rows.filter((r) => r.status === "done").length;
  const denom = total - skipped;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground">Checklist</h2>
        <span className="text-sm font-medium text-muted-foreground">
          {done} / {denom} done
        </span>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No checklist items yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="pb-2 pr-3 font-medium">Status</th>
                <th className="pb-2 pr-3 font-medium">Part</th>
                <th className="pb-2 pr-3 font-medium">Qty</th>
                <th className="pb-2 pr-3 font-medium">Notes</th>
                {isManager && <th className="pb-2 font-medium" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <ChecklistRow
                  key={r.id}
                  row={r}
                  isManager={isManager}
                  items={allItems}
                  onStatusChange={handleStatusChange}
                  onLinkItem={handleLinkItem}
                  onDelete={handleDelete}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isManager && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!newLabel.trim()) return;
            addRow.mutate();
          }}
          className="mt-4 flex flex-wrap items-end gap-2 border-t border-border pt-4"
        >
          <div className="min-w-[160px] flex-1">
            <input
              className={inputCls}
              placeholder="Add a part…"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
            />
          </div>
          <input
            className={cn(inputCls, "w-20")}
            placeholder="Qty"
            value={newQty}
            onChange={(e) => setNewQty(e.target.value)}
          />
          <input
            className={cn(inputCls, "w-24")}
            placeholder="Unit"
            value={newUnit}
            onChange={(e) => setNewUnit(e.target.value)}
          />
          <select
            className={cn(inputCls, "w-44")}
            value={newItemId}
            onChange={(e) => setNewItemId(e.target.value)}
            title="Link to an inventory item so checking it off moves stock"
          >
            <option value="">No inventory link</option>
            {allItems.map((it) => (
              <option key={it.id} value={it.id}>
                {it.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={addRow.isPending}
            className="flex h-10 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            <Plus className="h-4 w-4" />
            Add
          </button>
        </form>
      )}
    </div>
  );
}
