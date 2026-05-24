import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { toast } from "@/components/ui/toaster";
import type { Item, Adjustment } from "@shared/schema";
import {
  itemPhotos,
  locationString,
  isLowStock,
  ITEM_TYPE_LABELS,
  ADJUSTMENT_REASON_LABELS,
  formatDateTime,
} from "@/lib/format";
import PhotoGallery from "@/components/PhotoGallery";
import CategoryBadge from "@/components/CategoryBadge";
import EquipmentAttrsCard from "@/components/EquipmentAttrsCard";
import CheckDialog from "@/components/CheckDialog";
import AdjustDialog from "@/components/AdjustDialog";
import QRDialog from "@/components/QRDialog";
import Modal from "@/components/Modal";
import {
  PackageMinus,
  PackagePlus,
  Sliders,
  QrCode,
  Pencil,
  Trash2,
  ArrowLeft,
  AlertTriangle,
  Loader2,
} from "lucide-react";

type TxnRow = {
  id: number;
  type: "check_out" | "check_in";
  quantity: number;
  notes: string | null;
  created_at: number;
  user_name?: string;
  project_id?: number | null;
};

export default function ItemDetailPage({ id }: { id: string }) {
  const itemId = Number(id);
  const { isManager } = useAuth();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();

  const [checkMode, setCheckMode] = useState<null | "check_out" | "check_in">(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: item, isLoading } = useQuery<Item>({
    queryKey: ["item", itemId],
    queryFn: async () => (await apiRequest("GET", `/api/items/${itemId}`)).json(),
  });

  const { data: txns = [] } = useQuery<TxnRow[]>({
    queryKey: ["transactions", { itemId }],
    queryFn: async () =>
      (await apiRequest("GET", `/api/transactions?itemId=${itemId}&limit=10`)).json(),
  });

  const { data: adjustments = [] } = useQuery<Adjustment[]>({
    queryKey: ["adjustments", itemId],
    queryFn: async () => (await apiRequest("GET", `/api/items/${itemId}/adjustments`)).json(),
  });

  const del = useMutation({
    mutationFn: async () => apiRequest("DELETE", `/api/items/${itemId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["items"] });
      toast({ variant: "success", title: "Item deleted" });
      setLocation("/home");
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not delete", description: e?.message }),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-20 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }
  if (!item) {
    return (
      <div className="mx-auto max-w-3xl py-16 text-center text-muted-foreground">
        <p>Item not found.</p>
        <Link href="/home" className="mt-2 inline-block font-medium text-primary hover:underline">
          Back to items
        </Link>
      </div>
    );
  }

  const low = isLowStock(item);
  const photos = itemPhotos(item);

  const ActionBtn = ({
    onClick,
    icon: Icon,
    label,
    danger,
  }: {
    onClick: () => void;
    icon: typeof QrCode;
    label: string;
    danger?: boolean;
  }) => (
    <button
      onClick={onClick}
      className={
        "flex flex-1 min-w-[88px] flex-col items-center gap-1.5 rounded-xl border border-border p-3 text-sm font-medium transition-colors " +
        (danger
          ? "text-destructive hover:border-destructive hover:bg-destructive/10"
          : "text-foreground hover:border-primary hover:bg-primary/5")
      }
    >
      <Icon className="h-5 w-5" />
      {label}
    </button>
  );

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/home"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to items
      </Link>

      <div className="grid gap-6 lg:grid-cols-2">
        <PhotoGallery photos={photos} />

        <div className="flex flex-col gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <CategoryBadge category={item.category} size="md" />
              <span className="rounded-full bg-secondary px-3 py-1 text-sm text-secondary-foreground">
                {ITEM_TYPE_LABELS[item.itemType]}
              </span>
              {low && (
                <span className="flex items-center gap-1 rounded-full bg-orange-500/15 px-3 py-1 text-sm font-medium text-orange-400">
                  <AlertTriangle className="h-4 w-4" />
                  Low stock
                </span>
              )}
            </div>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-foreground">{item.name}</h1>
            <p className="mt-1 text-muted-foreground">{locationString(item)}</p>
            {(item.partNumber || item.mfgPartNumber) && (
              <p className="mt-1 text-sm text-muted-foreground">
                {item.partNumber && <>Part: {item.partNumber} </>}
                {item.mfgPartNumber && <>· Mfg: {item.mfgPartNumber}</>}
              </p>
            )}
          </div>

          <div className="flex items-baseline gap-2 rounded-xl border border-border bg-card p-4">
            <span className={"text-4xl font-bold " + (low ? "text-orange-400" : "text-foreground")}>
              {item.quantity}
            </span>
            <span className="text-muted-foreground">in stock</span>
            {item.quantityReserved > 0 && (
              <span className="ml-auto text-sm text-muted-foreground">
                {item.quantityReserved} reserved
              </span>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <ActionBtn onClick={() => setCheckMode("check_out")} icon={PackageMinus} label="Check out" />
            <ActionBtn onClick={() => setCheckMode("check_in")} icon={PackagePlus} label="Check in" />
            {isManager && <ActionBtn onClick={() => setAdjustOpen(true)} icon={Sliders} label="Adjust" />}
            <ActionBtn onClick={() => setQrOpen(true)} icon={QrCode} label="QR" />
            {isManager && (
              <ActionBtn onClick={() => setLocation(`/item/${itemId}/edit`)} icon={Pencil} label="Edit" />
            )}
            {isManager && (
              <ActionBtn onClick={() => setConfirmDelete(true)} icon={Trash2} label="Delete" danger />
            )}
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-6">
        <EquipmentAttrsCard item={item} />

        {item.notes && (
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-2 text-base font-semibold text-foreground">Notes</h2>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{item.notes}</p>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Transactions */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-3 text-base font-semibold text-foreground">Recent activity</h2>
            {txns.length === 0 ? (
              <p className="text-sm text-muted-foreground">No check-ins or check-outs yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {txns.map((t) => (
                  <li key={t.id} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      {t.type === "check_out" ? (
                        <PackageMinus className="h-4 w-4 text-orange-400" />
                      ) : (
                        <PackagePlus className="h-4 w-4 text-green-400" />
                      )}
                      <span className="text-foreground">
                        {t.type === "check_out" ? "−" : "+"}
                        {t.quantity}
                      </span>
                      <span className="text-muted-foreground">{t.user_name ?? ""}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(t.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Adjustments */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-3 text-base font-semibold text-foreground">Stock adjustments</h2>
            {adjustments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No adjustments recorded.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {adjustments.map((a) => (
                  <li key={a.id} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <span
                        className={
                          "font-medium " + (a.delta < 0 ? "text-destructive" : "text-green-400")
                        }
                      >
                        {a.delta > 0 ? "+" : ""}
                        {a.delta}
                      </span>
                      <span className="text-muted-foreground">
                        {ADJUSTMENT_REASON_LABELS[a.reason]}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(a.createdAt as unknown as string)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Dialogs */}
      {checkMode && (
        <CheckDialog item={item} mode={checkMode} open={true} onClose={() => setCheckMode(null)} />
      )}
      <AdjustDialog item={item} open={adjustOpen} onClose={() => setAdjustOpen(false)} />
      <QRDialog item={item} open={qrOpen} onClose={() => setQrOpen(false)} />

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete item?">
        <p className="text-sm text-muted-foreground">
          This permanently removes <span className="font-medium text-foreground">{item.name}</span>{" "}
          and its history. This cannot be undone.
        </p>
        <div className="mt-5 flex justify-end gap-3">
          <button
            onClick={() => setConfirmDelete(false)}
            className="h-11 rounded-xl border border-border px-5 font-medium text-foreground hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={() => del.mutate()}
            disabled={del.isPending}
            className="flex h-11 items-center gap-2 rounded-xl bg-destructive px-5 font-semibold text-destructive-foreground hover:opacity-90 disabled:opacity-60"
          >
            {del.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Delete
          </button>
        </div>
      </Modal>
    </div>
  );
}
