import { Link } from "wouter";
import type { Item } from "@shared/schema";
import { itemPhotos, locationString, isLowStock } from "@/lib/format";
import CategoryBadge from "./CategoryBadge";
import { cn } from "@/lib/utils";
import { Package, MapPin, AlertTriangle } from "lucide-react";

export default function ItemCard({ item }: { item: Item }) {
  const photo = itemPhotos(item)[0];
  const low = isLowStock(item);

  return (
    <Link
      href={`/item/${item.id}`}
      className="group flex gap-4 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/50"
    >
      <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
        {photo ? (
          <img src={photo} alt={item.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <Package className="h-7 w-7" />
          </div>
        )}
        {low && (
          <span className="absolute right-1 top-1 h-3 w-3 rounded-full bg-orange-500 ring-2 ring-card" />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-between">
        <div>
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate text-base font-semibold text-foreground group-hover:text-primary">
              {item.name}
            </h3>
            <CategoryBadge category={item.category} />
          </div>
          <p className="mt-1 flex items-center gap-1 truncate text-sm text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            {locationString(item)}
          </p>
          {(item.partNumber || item.mfgPartNumber) && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {item.partNumber || item.mfgPartNumber}
            </p>
          )}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span
            className={cn(
              "text-lg font-bold",
              low ? "text-orange-400" : "text-foreground"
            )}
          >
            {item.quantity}
          </span>
          <span className="text-sm text-muted-foreground">in stock</span>
          {low && (
            <span className="ml-auto flex items-center gap-1 text-xs font-medium text-orange-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              Low
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
