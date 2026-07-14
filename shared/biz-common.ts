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

// Server-side document totals from a JSON line-items column + a tax rate in
// basis points. Totals are always recomputed here — client-supplied
// subtotal/tax/total are ignored so the books can't be desynced by a stale or
// malicious UI. Throws (zod) on malformed line items so callers surface a 400.
//
// `clampTax` floors the tax rate at zero (Finance's fix — a negative rate would
// refund tax against the subtotal). It is opt-in so each caller keeps its exact
// prior behaviour: Finance passes clampTax, CRM estimates do not.
export function computeDocTotals(
  itemsJson: string,
  taxRateBp: number,
  opts: { clampTax?: boolean } = {},
): { subtotalCents: number; taxCents: number; totalCents: number } {
  const items = lineItemsSchema.parse(parseLineItems(itemsJson));
  const subtotalCents = lineItemsTotalCents(items);
  const bp = opts.clampTax ? Math.max(0, taxRateBp) : taxRateBp;
  const taxCents = Math.round((subtotalCents * bp) / 10000);
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}
