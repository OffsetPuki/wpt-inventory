import { Link } from "wouter";
import type { Item } from "@shared/schema";
import { itemPhotos, locationString, isLowStock } from "@/lib/format";
import CategoryBadge, { CATEGORY_STYLES } from "./CategoryBadge";
import { cn } from "@/lib/utils";
import { MapPin } from "lucide-react";

export default function ItemCard({ item }: { item: Item }) {
  const photo = itemPhotos(item)[0];
  const low = isLowStock(item);
  const cat = CATEGORY_STYLES[item.category] ?? CATEGORY_STYLES.tools;

  return (
    <Link
      href={`/item/${item.id}`}
      className={cn(
        "group flex flex-col overflow-hidden rounded-xl border bg-card transition-all hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-lg",
        cat.border
      )}
    >
      {/* Photo */}
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
        {photo ? (
          <img
            src={photo}
            alt={item.name}
            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-4 text-center">
            <span className="line-clamp-2 text-sm font-medium text-muted-foreground/60">{item.name}</span>
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/40">
              no photo
            </span>
          </div>
        )}

        {/* Category badge */}
        <div className="absolute left-2 top-2">
          <CategoryBadge category={item.category} overlay />
        </div>

        {/* Stock badge */}
        <span
          className={cn(
            "absolute right-2 top-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold uppercase tracking-wide shadow-sm ring-1 backdrop-blur-sm",
            low
              ? "bg-orange-100/90 text-orange-800 ring-orange-900/10"
              : "bg-emerald-100/90 text-emerald-800 ring-emerald-900/10"
          )}
        >
          {low ? "Low" : "In stock"} ×{item.quantity}
        </span>
      </div>

      {/* Body */}
      <div className="flex flex-col gap-1 p-3">
        <p className="flex items-start gap-1 text-xs text-muted-foreground">
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="line-clamp-2">{locationString(item)}</span>
        </p>
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-foreground group-hover:text-primary">
          {item.name}
        </h3>
      </div>
    </Link>
  );
}
