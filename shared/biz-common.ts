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
  // Phase C #17/#18: soft ref into the quote price book's materials{} — a PO
  // line that carries one auto-stocks the matching inventory item (by
  // items.material_key) when the PO is received.
  materialKey?: string;
}

export const lineItemSchema = z.object({
  description: z.string().min(1),
  qty: z.number().positive(),
  // Negative is allowed on purpose: a "-300" line IS how the owner writes a
  // discount or a credit against the other lines. computeDocTotals refuses a
  // document whose lines add up below zero, so a credit can't outrun the bill.
  unitPriceCents: z.number().int(),
  unit: z.string().optional(),
  productId: z.number().int().optional(),
  materialKey: z.string().optional(),
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
//
// `discountCents` comes off the subtotal BEFORE tax — you don't owe the state
// sales tax on money the customer never paid. Clamped to [0, subtotal] so a
// discount can never push a document negative. Callers that pass none get
// their exact prior numbers.
export function computeDocTotals(
  itemsJson: string,
  taxRateBp: number,
  opts: { clampTax?: boolean; discountCents?: number } = {},
): { subtotalCents: number; discountCents: number; taxCents: number; totalCents: number } {
  const items = lineItemsSchema.parse(parseLineItems(itemsJson));
  const subtotalCents = lineItemsTotalCents(items);
  // Credit lines may net against the others, never past zero — a negative
  // document is a refund, and this app records those as payments reversed.
  if (subtotalCents < 0) throw new Error("Line items add up below zero");
  const discountCents = Math.min(Math.max(0, Math.round(opts.discountCents ?? 0)), subtotalCents);
  const bp = opts.clampTax ? Math.max(0, taxRateBp) : taxRateBp;
  const taxCents = Math.round(((subtotalCents - discountCents) * bp) / 10000);
  return { subtotalCents, discountCents, taxCents, totalCents: subtotalCents - discountCents + taxCents };
}
