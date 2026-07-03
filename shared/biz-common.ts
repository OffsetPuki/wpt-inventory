import { z } from "zod";

// ─── Shared line-item shape ──────────────────────────────────────────────────
// Used by CRM estimates, Finance invoices, and Finance purchase orders.
// Stored as a JSON string column; all money is integer cents.

export interface LineItem {
  description: string;
  qty: number;
  unitPriceCents: number;
  unit?: string;
  productId?: number;
}

export const lineItemSchema = z.object({
  description: z.string().min(1),
  qty: z.number().positive(),
  unitPriceCents: z.number().int().nonnegative(),
  unit: z.string().optional(),
  productId: z.number().int().optional(),
});

export const lineItemsSchema = z.array(lineItemSchema);

export function lineItemsTotalCents(items: LineItem[]): number {
  return items.reduce((sum, it) => sum + Math.round(it.qty * it.unitPriceCents), 0);
}

/** Parse a JSON line-items column defensively — malformed data yields []. */
export function parseLineItems(json: string | null | undefined): LineItem[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
