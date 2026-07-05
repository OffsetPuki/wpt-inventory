// =============================================================================
//  Quote assembly — turn a line state (items + labor) into a priced quote using
//  the existing pricing engine (lib/calc.js). Markup & tax come from the quote
//  (seeded from the price book, overridable per quote).
// =============================================================================

import { calcQuote } from './calc.js';
import { toMaterials } from './estimate.js';

/**
 * Build the object shape lib/calc.js expects.
 * pricing = { materialMarkupPct, laborMarkupPct, taxPct, deliveryMiles, deliveryPerMile }.
 * Materials and labor each carry their own markup; delivery is a pass-through
 * (no markup) but is taxable per the engine defaults.
 */
export function toCalcQuote(lineState, pricing) {
  const ls = lineState || { items: [], labor: { hours: 0, rate: 0 } };
  const p = pricing || {};
  return {
    materials: toMaterials(ls.items),
    labor: { hours: Number(ls.labor?.hours) || 0, rate: Number(ls.labor?.rate) || 0 },
    finishing: { areaSqFt: 0, pricePerSqFt: 0, note: '' },
    delivery: {
      miles: Number(p.deliveryMiles) || 0,
      pricePerMile: Number(p.deliveryPerMile) || 0,
      note: '',
    },
    markupPctByLine: {
      material: Number(p.materialMarkupPct) || 0,
      labor: Number(p.laborMarkupPct) || 0,
      finishing: 0,
      delivery: 0, // delivery billed at cost
    },
    taxPct: Number(p.taxPct) || 0,
  };
}

/** Compute full totals for a line state. Returns the calc result. */
export function computeTotals(lineState, pricing) {
  return calcQuote(toCalcQuote(lineState, pricing));
}
