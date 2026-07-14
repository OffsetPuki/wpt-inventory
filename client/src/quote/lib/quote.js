// =============================================================================
//  Quote assembly — turn a line state (items + shop labor + install labor) into
//  a priced quote using the existing pricing engine (lib/calc.js). Markup & tax
//  come from the quote (seeded from the price book, overridable per quote).
//
//  Mapping into the calc engine's four fixed lines:
//    material  ← the derived items          (material markup)
//    labor     ← shop fabrication hours     (labor markup)
//    finishing ← INSTALLATION hours          (labor markup — the line is
//                relabeled "Installation" everywhere it's displayed)
//    delivery  ← miles × $/mile             (billed at cost)
//
//  After the engine runs, two per-quote adjustments apply:
//    discount   — % off the pre-tax subtotal (tax shrinks proportionally)
//    min charge — the price-book floor for small jobs
//
//  This module is imported by BOTH the client and server/public-portal.ts —
//  keep it pure JS.
// =============================================================================

import { calcQuote } from './calc.js';
import { round2 } from './format.js';
import { toMaterials } from './estimate.js';

/**
 * Build the object shape lib/calc.js expects.
 * pricing = { materialMarkupPct, laborMarkupPct, taxPct, deliveryMiles,
 *             deliveryPerMile, discountPct, minJobCharge }.
 */
export function toCalcQuote(lineState, pricing) {
  const ls = lineState || { items: [], labor: { hours: 0, rate: 0 }, install: { hours: 0, rate: 0 } };
  const p = pricing || {};
  return {
    materials: toMaterials(ls.items),
    labor: { hours: Number(ls.labor?.hours) || 0, rate: Number(ls.labor?.rate) || 0 },
    // Installation rides the engine's "finishing" line: qty = hours, rate = $/hr.
    finishing: {
      areaSqFt: Number(ls.install?.hours) || 0,
      pricePerSqFt: Number(ls.install?.rate) || 0,
      note: 'Installation',
    },
    delivery: {
      miles: Number(p.deliveryMiles) || 0,
      pricePerMile: Number(p.deliveryPerMile) || 0,
      note: '',
    },
    markupPctByLine: {
      material: Number(p.materialMarkupPct) || 0,
      labor: Number(p.laborMarkupPct) || 0,
      finishing: Number(p.laborMarkupPct) || 0, // install carries the labor margin
      delivery: 0, // delivery billed at cost
    },
    taxPct: Number(p.taxPct) || 0,
  };
}

/**
 * Compute full totals for a line state, then apply the per-quote discount and
 * the price-book minimum job charge.
 * Returns the calc result plus { discountPct, discountAmt, minAdjustment }.
 */
export function computeTotals(lineState, pricing) {
  const p = pricing || {};
  const res = calcQuote(toCalcQuote(lineState, p));

  // Discount: % off the pre-tax subtotal; tax shrinks proportionally so the
  // customer is taxed on what they actually pay.
  const dPct = Math.min(100, Math.max(0, Number(p.discountPct) || 0));
  let discountAmt = 0;
  let tax = res.tax;
  if (dPct > 0) {
    discountAmt = round2(res.subtotal * dPct / 100);
    tax = round2(res.tax * (1 - dPct / 100));
  }
  let total = round2(res.subtotal - discountAmt + tax);

  // Minimum job charge: small jobs still cost a truck roll + setup.
  const min = Math.max(0, Number(p.minJobCharge) || 0);
  let minAdjustment = 0;
  if (total > 0 && min > 0 && total < min) {
    minAdjustment = round2(min - total);
    total = min;
  }

  return {
    ...res,
    tax,
    total,
    totalWithUpgrades: round2(total + (res.upgradesTotal || 0)),
    discountPct: dPct,
    discountAmt,
    minAdjustment,
  };
}
