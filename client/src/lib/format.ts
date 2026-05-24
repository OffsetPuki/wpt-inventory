import type { Item, Category, Area, ItemType, AdjustmentReason } from "@shared/schema";

// ─── Label maps ───────────────────────────────────────────────────────────────

export const AREA_LABELS: Record<Area, string> = {
  main_shop: "Main Shop",
  machine_shop: "Machine Shop",
  panel_shop: "Panel Shop",
  concrete_pad: "Concrete Pad",
  shipping_container_1: "Electrical Container",
  shipping_container_2: "Plumbing Container",
};

export const CATEGORY_LABELS: Record<Category, string> = {
  electric: "Electric",
  welder: "Welder",
  it: "IT",
  raw_materials: "Raw Materials",
  tools: "Tools",
};

export const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  stock: "Stock",
  raw_material: "Raw Material",
  tool: "Tool",
  consumable: "Consumable",
  service_spare: "Service Spare",
  job_reserved: "Job Reserved",
};

export const ADJUSTMENT_REASON_LABELS: Record<AdjustmentReason, string> = {
  damaged: "Damaged",
  consumed: "Consumed",
  scrap: "Scrap",
  install_on_job: "Installed on Job",
  missing: "Missing",
  count_correction: "Count Correction",
  returned_from_field: "Returned from Field",
};

// ─── Item JSON hydration (server returns these columns as raw JSON strings) ────

export function itemPhotos(item: Pick<Item, "photos" | "photoUrl">): string[] {
  const list: string[] = [];
  if (item.photos) {
    try {
      const parsed = JSON.parse(item.photos);
      if (Array.isArray(parsed)) list.push(...parsed.filter(Boolean));
    } catch {
      /* ignore malformed */
    }
  }
  if (list.length === 0 && item.photoUrl) list.push(item.photoUrl);
  return list;
}

export function itemAttrs(
  item: Pick<Item, "customAttrs">
): Record<string, string | number | null> {
  if (!item.customAttrs) return {};
  try {
    const parsed = JSON.parse(item.customAttrs);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

// ─── Location formatting ───────────────────────────────────────────────────────

export function locationString(item: Item): string {
  const parts: string[] = [];
  if (item.area) parts.push(AREA_LABELS[item.area as Area] ?? item.area);
  if (item.rackLetter) {
    parts.push(`Rack ${item.rackLetter}${item.rackLevel ? `-${item.rackLevel}` : ""}`);
  }
  if (item.subLocation) parts.push(item.subLocation);
  if (item.shelf) parts.push(`Shelf ${item.shelf}`);
  if (item.bin) parts.push(`Bin ${item.bin}`);
  return parts.length ? parts.join(" · ") : "No location set";
}

// ─── Low stock ─────────────────────────────────────────────────────────────────

export function isLowStock(item: Pick<Item, "lowStockThreshold" | "quantity">): boolean {
  return item.lowStockThreshold > 0 && item.quantity <= item.lowStockThreshold;
}

// ─── Date formatting ───────────────────────────────────────────────────────────

export function formatDate(value: string | number | Date | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateTime(value: string | number | Date | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
