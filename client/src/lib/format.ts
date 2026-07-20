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

// Display names only — the underlying enum values are baked into existing
// item rows, so a metals-shop relabel is purely cosmetic and safe.
export const CATEGORY_LABELS: Record<Category, string> = {
  electric: "Electrical & Automation",
  welder: "Welding",
  it: "Office & IT",
  raw_materials: "Steel & Materials",
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
  purchased: "Purchased",
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
  if (item.rackLetter) parts.push(`Rack ${item.rackLetter}`);
  if (item.rackLevel) parts.push(`Level ${item.rackLevel}`);
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

// Bare "YYYY-MM-DD" strings (the shape of every calendar-date column) must be
// parsed as LOCAL dates: new Date("2026-07-03") is UTC midnight, which
// toLocaleDateString renders as July 2 anywhere west of UTC.
const YMD_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function toLocalDate(value: string | number | Date): Date {
  if (typeof value === "string" && YMD_ONLY.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(value);
}

export function formatDate(value: string | number | Date | null | undefined): string {
  if (!value) return "";
  const d = toLocalDate(value);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateTime(value: string | number | Date | null | undefined): string {
  if (!value) return "";
  const d = toLocalDate(value); // same YMD guard; instants pass through
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ─── Money (all amounts are stored as integer cents) ──────────────────────────

export function formatMoney(cents: number | null | undefined): string {
  const v = (cents ?? 0) / 100;
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    // Whole-dollar amounts read cleaner without the trailing .00 in tables.
    minimumFractionDigits: v % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/** Parse a user-typed dollar string ("1,250.50", "$99") into integer cents. */
export function parseMoney(input: string): number {
  const cleaned = input.replace(/[$,\s]/g, "");
  const v = parseFloat(cleaned);
  return isNaN(v) ? 0 : Math.round(v * 100);
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value == null || isNaN(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

/** Basis points (825 → "8.25%") used for tax rates on estimates/invoices. */
export function formatBp(bp: number | null | undefined): string {
  return `${((bp ?? 0) / 100).toFixed(2).replace(/\.?0+$/, "")}%`;
}

export function formatHours(minutes: number | null | undefined): string {
  const m = minutes ?? 0;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return `${rest}m`;
  return rest === 0 ? `${h}h` : `${h}h ${rest}m`;
}

// ─── Calendar-date helpers (bare YYYY-MM-DD strings) ──────────────────────────

/** Local "YYYY-MM-DD" for today — used to seed <input type="date"> fields. */
export function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/** Parse a bare "YYYY-MM-DD" as a LOCAL date (reuses the toLocalDate guard). */
export function ymdToDate(ymd: string): Date {
  return toLocalDate(ymd);
}
/** Alias of {@link ymdToDate}. */
export const parseYmd = ymdToDate;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days between `ms` (epoch millis) and now; negative if `ms` is in the future. */
export function daysAgo(ms: number): number {
  return Math.floor((Date.now() - ms) / DAY_MS);
}

/** Relative "3 days ago" label; "never" when there is no timestamp, "today" for <1 day. */
export function relDays(ms: number | null | undefined): string {
  if (!ms) return "never";
  const days = daysAgo(ms);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

// ─── Money input helper ────────────────────────────────────────────────────────

/** Integer cents → an editable dollar string; "" for zero, trailing .00 stripped. */
export function centsToInput(cents: number): string {
  return cents === 0 ? "" : (cents / 100).toFixed(2).replace(/\.00$/, "");
}

// ─── JSON column helpers (server stores some columns as raw JSON strings) ──────

/** JSON.parse a string column into an array, tolerating null/malformed input. */
export function parseJsonArray<T = unknown>(json: string | null | undefined): T[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

/** JSON.parse a string column into a plain object, tolerating null/malformed input. */
export function parseJsonObject<
  T extends Record<string, unknown> = Record<string, unknown>,
>(json: string | null | undefined): T {
  if (!json) return {} as T;
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as T)
      : ({} as T);
  } catch {
    return {} as T;
  }
}
