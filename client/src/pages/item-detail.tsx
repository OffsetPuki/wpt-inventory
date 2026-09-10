import { lazy, Suspense, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { itemPhotos, locationString, formatDateTime } from "@/lib/format";
import {
  availableStock,
  isTool,
  invalidateInventory,
  inventoryReturnPath,
  stockLabel,
} from "@/lib/inventory";
import { primaryBtn, secondaryBtn } from "@/lib/ui-styles";
import type { Item } from "@shared/schema";
import type { InventoryLoan, InventoryReservation } from "@shared/inventory";
import PhotoGallery from "@/components/PhotoGallery";
import EquipmentAttrsCard from "@/components/EquipmentAttrsCard";
import CategoryBadge from "@/components/CategoryBadge";
import CheckDialog from "@/components/CheckDialog";
import AdjustDialog from "@/components/AdjustDialog";
import QRDialog from "@/components/QRDialog";
import Modal from "@/components/Modal";
import StockHistory from "@/components/inventory/StockHistory";
import ReserveDialog from "@/components/inventory/ReserveDialog";
const ItemLocationMap = lazy(() => import("@/components/ItemLocationMap"));
const RestockDialog = lazy(
  () => import("@/components/inventory/RestockDialog"),
);
export default function ItemDetailPage({ id }: { id: string }) {
  const itemId = Number(id),
    { isElevated } = useAuth(),
    [, navigate] = useLocation(),
    qc = useQueryClient();
  const [checkMode, setCheckMode] = useState<
      "check_out" | "check_in" | "receive" | null
    >(null),
    [adjust, setAdjust] = useState(false),
    [qr, setQr] = useState(false),
    [reserve, setReserve] = useState(false),
    [legacyReview, setLegacyReview] = useState(false),
    [restock, setRestock] = useState(false),
    [map, setMap] = useState(false),
    [remove, setRemove] = useState(false);
  const detail = useQuery<{
    item: Item;
    reservations: InventoryReservation[];
    loans: InventoryLoan[];
  }>({
    queryKey: ["item-detail", itemId],
    queryFn: async () =>
      (await apiRequest("GET", `/api/items/${itemId}/detail`)).json(),
  });
  const release = useMutation({
    mutationFn: (reservationId: number) =>
      apiRequest(
        "DELETE",
        `/api/items/${itemId}/reservations/${reservationId}`,
      ),
    onSuccess: () => {
      void invalidateInventory(qc);
    },
  });
  const del = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/items/${itemId}`),
    onSuccess: () => {
      void invalidateInventory(qc);
      navigate(inventoryReturnPath());
    },
  });
  if (detail.isLoading)
    return (
      <p role="status" className="py-12 text-center">
        Loading item…
      </p>
    );
  if (detail.error || !detail.data)
    return (
      <div role="alert" className="py-12">
        <p>{detail.error?.message || "Item not found."}</p>
        <button className={secondaryBtn} onClick={() => void detail.refetch()}>
          Retry
        </button>
        <Link className={secondaryBtn} href={inventoryReturnPath()}>
          Back to inventory
        </Link>
      </div>
    );
  const { item, reservations, loans } = detail.data,
    tool = isTool(item),
    available = availableStock(item);
  const unattributed = Math.max(
    0,
    item.quantityReserved - reservations.reduce((n, r) => n + r.quantity, 0),
  );
  return (
    <div className="mx-auto max-w-4xl space-y-5 pb-6">
      <Link className="text-sm text-primary" href={inventoryReturnPath()}>
        ← Back to inventory
      </Link>
      <div className="flex items-start justify-between gap-3">
        <div>
          <CategoryBadge category={item.category} />
          <h1 className="mt-2 text-2xl font-bold sm:text-3xl">{item.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {locationString(item)}
          </p>
          {item.partNumber && (
            <p className="text-sm text-muted-foreground">
              Part {item.partNumber}
            </p>
          )}
        </div>
        <details className="relative shrink-0">
          <summary className={`${secondaryBtn} cursor-pointer`}>
            More actions
          </summary>
          <div
            onClick={(e) =>
              e.currentTarget.closest("details")?.removeAttribute("open")
            }
            className="absolute right-0 z-20 mt-2 flex min-w-48 flex-col gap-1 rounded-xl border bg-card p-2 shadow-xl"
          >
            <Link className={secondaryBtn} href={`/item/${itemId}/edit`}>
              Edit details
            </Link>
            <button className={secondaryBtn} onClick={() => setQr(true)}>
              Print QR label
            </button>
            {isElevated && (
              <>
                <button
                  className={secondaryBtn}
                  onClick={() => setAdjust(true)}
                >
                  Count stock
                </button>
                <button
                  className={secondaryBtn}
                  onClick={() => setReserve(true)}
                >
                  Reserve for job
                </button>
                <button
                  className={secondaryBtn}
                  onClick={() => setRestock(true)}
                >
                  Restock
                </button>
                <button
                  className={`${secondaryBtn} text-destructive`}
                  onClick={() => setRemove(true)}
                >
                  Delete item
                </button>
              </>
            )}
          </div>
        </details>
      </div>
      <div className="grid grid-cols-3 gap-2 rounded-xl border bg-card p-4">
        <div>
          <p className="text-xs text-muted-foreground">Available</p>
          <p
            className={`mt-1 text-2xl font-bold ${available === 0 ? "text-destructive" : ""}`}
          >
            {available}
          </p>
          <p className="text-xs">{item.unit}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">On hand</p>
          <p className="mt-1 text-2xl font-semibold">{item.quantity}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Reserved</p>
          <p className="mt-1 text-2xl font-semibold">{item.quantityReserved}</p>
        </div>
      </div>
      {item.quantityReserved > item.quantity && (
        <p role="alert" className="rounded-lg bg-amber-500/10 p-3 text-sm">
          Reserved jobs are short by{" "}
          {stockLabel(item.quantityReserved - item.quantity, item.unit)}. Review
          reservations or restock.
        </p>
      )}
      <div className="sticky top-0 z-10 flex flex-wrap gap-2 border-y bg-background py-3">
        <button
          className={primaryBtn}
          onClick={() => setCheckMode("check_out")}
        >
          {tool ? "Check out" : "Use on job"}
        </button>
        <button
          className={secondaryBtn}
          onClick={() => setCheckMode("check_in")}
        >
          {tool ? "Return tool" : "Return unused"}
        </button>
        <button
          className={secondaryBtn}
          onClick={() => setCheckMode("receive")}
        >
          Receive stock
        </button>
      </div>
      {(reservations.length > 0 || unattributed > 0) && (
        <section className="rounded-xl border bg-card p-4">
          <h2 className="mb-3 font-semibold">Reserved for jobs</h2>
          {reservations.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between gap-3 border-t py-2 text-sm"
            >
              <span>
                {r.jobNumber} · {r.projectName}
                <strong className="ml-2">
                  {r.quantity} {item.unit}
                </strong>
              </span>
              {isElevated && (
                <button
                  className="text-primary underline"
                  disabled={release.isPending}
                  onClick={() => release.mutate(r.id)}
                >
                  Release
                </button>
              )}
            </div>
          ))}
          {unattributed > 0 && (
            <p className="text-sm text-amber-700">
              {unattributed} reserved in older records without a confirmed job.
              Review these reservations before using the stock.
              {isElevated && (
                <button
                  className="ml-2 underline"
                  onClick={() => setLegacyReview(true)}
                >
                  Review reservation
                </button>
              )}
            </p>
          )}
          {release.error && <p role="alert">{release.error.message}</p>}
        </section>
      )}
      {tool && (
        <section className="rounded-xl border bg-card p-4">
          <h2 className="mb-2 font-semibold">Who has this tool?</h2>
          {loans.length ? (
            loans.map((l) => (
              <div key={l.id} className="border-t py-2 text-sm">
                <strong>{l.borrowerName}</strong> · {l.remaining} out
                {l.jobNumber ? ` · ${l.jobNumber}` : ""}
                <p className="text-xs text-muted-foreground">
                  Checked out {formatDateTime(l.createdAt)}
                </p>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              No tracked checkouts. Earlier movements remain in history.
            </p>
          )}
        </section>
      )}
      {itemPhotos(item).length > 0 && (
        <details className="rounded-xl border bg-card p-4">
          <summary className="cursor-pointer font-medium">Photos</summary>
          <div className="mt-3 max-w-md">
            <PhotoGallery photos={itemPhotos(item)} />
          </div>
        </details>
      )}
      {item.area && (
        <>
          <button
            className="text-sm text-primary underline"
            onClick={() => setMap((v) => !v)}
          >
            {map ? "Hide map" : "Show on shop map"}
          </button>
          {map && (
            <Suspense fallback={<p>Loading map…</p>}>
              <ItemLocationMap item={item} />
            </Suspense>
          )}
        </>
      )}
      {item.notes && (
        <p className="whitespace-pre-wrap rounded-xl border p-4 text-sm">
          {item.notes}
        </p>
      )}
      <EquipmentAttrsCard item={item} />
      <div>
        <h2 className="mb-3 text-lg font-semibold">Stock history</h2>
        <StockHistory itemId={item.id} />
      </div>
      {checkMode && (
        <CheckDialog
          item={item}
          mode={checkMode}
          open
          onClose={() => setCheckMode(null)}
        />
      )}
      <AdjustDialog
        item={item}
        open={adjust}
        onClose={() => setAdjust(false)}
      />
      <QRDialog item={item} open={qr} onClose={() => setQr(false)} />
      {legacyReview && (
        <ReserveDialog
          item={item}
          legacy={unattributed}
          onClose={() => setLegacyReview(false)}
        />
      )}{" "}
      {reserve && (
        <ReserveDialog item={item} onClose={() => setReserve(false)} />
      )}
      <Suspense fallback={<p>Opening…</p>}>
        {restock && (
          <RestockDialog items={[item]} onClose={() => setRestock(false)} />
        )}
      </Suspense>
      <Modal
        open={remove}
        onClose={() => setRemove(false)}
        title="Delete item?"
      >
        <p className="text-sm">
          {item.name} will move to the trash. It can be restored for 30 days.
        </p>
        {del.error && <p role="alert">{del.error.message}</p>}
        <button
          className={`${primaryBtn} mt-4`}
          disabled={del.isPending}
          onClick={() => del.mutate()}
        >
          Delete item
        </button>
      </Modal>
    </div>
  );
}
