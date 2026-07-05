// =============================================================================
//  Pricing engine — pure functions, no React, no DOM.
//  This is the single source of truth for how a quote total is built.
//
//  Material is now an ITEMIZED list. Each line item is priced one of five ways
//  and shown separately, so the estimator sees the cost of every component
//  (posts, roof, frame, ...). The material line in the breakdown is the SUM of
//  all items. Markup and tax then apply per the configurable line settings.
//
//  Per-item methods:
//    perUnit : quantity × pricePerUnit
//    linear  : quantity × lengthEachFt × pricePerFt
//    area    : quantity × areaEachSqFt × pricePerSqFt
//    weight  : quantity × (L×W×T×density) × pricePerLb
//    flat    : flatCost   (a fixed total for the line)
//
//  Calc order:
//    1. material = Σ items ; labor = hrs×rate ; finishing = area×rate ; delivery = mi×rate
//    2. markup applied PER LINE (only lines in quote.markupApplyTo)
//    3. subtotal = Σ marked line totals
//    4. tax on the marked total of taxable lines (quote.taxApplyTo)
//    5. total = subtotal + tax
//
//  Rounding to 2 decimals happens at each displayed sub-line so the printed
//  quote reconciles by hand. No rates are invented — all come from the inputs.
// =============================================================================

import { round2 } from "./format.js";
import { weightLb } from "./materials.js";

export const LINE_KEYS = ["material", "labor", "finishing", "delivery"];

const DEFAULT_MARKUP_APPLY = { material: true, labor: true, finishing: false, delivery: false };
const DEFAULT_TAX_APPLY    = { material: true, labor: true, finishing: true,  delivery: true  };

// --- Material items -----------------------------------------------------------

/** Cost of a single material line item (un-rounded). */
export function materialItemCost(item) {
  if (!item) return 0;
  const qty = item.quantity ?? 1;
  switch (item.method) {
    case "perUnit": return (qty || 0) * (item.pricePerUnit || 0);
    case "linear":  return (qty || 0) * (item.lengthEachFt || 0) * (item.pricePerFt || 0);
    case "area":    return (qty || 0) * (item.areaEachSqFt || 0) * (item.pricePerSqFt || 0);
    case "weight": {
      const lb = weightLb({
        lengthIn: item.lengthIn,
        widthIn: item.widthIn,
        thicknessIn: item.thicknessIn,
        densityLbPerIn3: item.densityLbPerIn3,
      });
      return (qty || 0) * lb * (item.pricePerLb || 0);
    }
    case "flat":
    default:        return item.flatCost || 0;
  }
}

/**
 * Returns the material line items for a quote as an array, migrating older
 * quotes that used a single `quote.material` object.
 */
export function getMaterials(quote) {
  const q = quote || {};
  if (Array.isArray(q.materials)) return q.materials;
  if (q.material) return [migrateLegacyMaterial(q.material)];
  return [];
}

// Convert the old single-material shape into one new line item.
function migrateLegacyMaterial(m) {
  const qty = m.quantity || 1;
  const base = { name: "Material", quantity: qty };
  switch (m.method) {
    case "area":
      return { ...base, method: "area", areaEachSqFt: m.areaSqFt || 0, pricePerSqFt: m.pricePerSqFt || 0 };
    case "linear":
      return { ...base, method: "linear", lengthEachFt: m.lengthFt || 0, pricePerFt: m.pricePerFt || 0 };
    case "weight":
      return {
        ...base, method: "weight",
        materialKey: m.materialKey, densityLbPerIn3: m.densityLbPerIn3,
        lengthIn: m.lengthIn, widthIn: m.widthIn, thicknessIn: m.thicknessIn,
        pricePerLb: m.pricePerLb || 0,
      };
    case "flat":
    default:
      // Old flat cost was per-piece × quantity; collapse to a single line total.
      return { name: "Material", method: "flat", quantity: 1, flatCost: (m.flatCost || 0) * qty };
  }
}

// --- Pipeline / dashboard helpers --------------------------------------------

/**
 * Is this quote past its valid-until date and not yet decided?
 * validUntil is a "YYYY-MM-DD" string; treated as end of that day.
 */
export function isExpired(quote, now = new Date()) {
  const q = quote || {};
  if (!q.validUntil) return false;
  if (q.status === "accepted" || q.status === "declined") return false;
  const due = new Date(q.validUntil + "T23:59:59");
  return !Number.isNaN(due.getTime()) && due < now;
}

/**
 * Roll up saved quotes into dashboard numbers.
 * Returns { quotedMonth, acceptedMonth, winRate (0..1 or null), counts, decided }.
 */
export function quoteStats(quotes, now = new Date()) {
  const list = Array.isArray(quotes) ? quotes : [];
  const y = now.getFullYear();
  const m = now.getMonth();
  const counts = { draft: 0, sent: 0, accepted: 0, declined: 0 };
  let quotedMonth = 0;
  let acceptedMonth = 0;
  let accepted = 0;
  let declined = 0;

  for (const q of list) {
    const total = calcQuote(q).total;
    const status = q.status || "draft";
    counts[status] = (counts[status] || 0) + 1;

    const d = q.createdAt ? new Date(q.createdAt) : null;
    const inMonth = d && d.getFullYear() === y && d.getMonth() === m;
    if (inMonth) quotedMonth += total;
    if (status === "accepted") { accepted++; if (inMonth) acceptedMonth += total; }
    if (status === "declined") declined++;
  }

  const decided = accepted + declined;
  return {
    quotedMonth: round2(quotedMonth),
    acceptedMonth: round2(acceptedMonth),
    winRate: decided > 0 ? accepted / decided : null,
    counts,
    decided,
  };
}

/**
 * Split `targetTotal` across items weighted by `weights`, rounded to cents so
 * the parts sum EXACTLY to targetTotal. Used to show customers a per-component
 * price (with material markup blended in) that still reconciles to the total.
 */
export function distributeToTotal(weights, targetTotal) {
  const n = weights.length;
  if (n === 0) return [];
  const target = Math.round((targetTotal || 0) * 100); // cents
  if (target === 0) return weights.map(() => 0);

  const sumW = weights.reduce((s, w) => s + (w || 0), 0);
  const exact = sumW > 0
    ? weights.map((w) => ((w || 0) / sumW) * target)
    : weights.map(() => target / n); // even split when no weights

  const cents = exact.map((x) => Math.floor(x));
  let rem = target - cents.reduce((s, c) => s + c, 0); // 0..n
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < rem; k++) cents[order[k].i]++;

  return cents.map((c) => c / 100);
}

// --- Full quote totals --------------------------------------------------------

export function calcQuote(quote) {
  const q = quote || {};
  const labor    = q.labor    || {};
  const finishing= q.finishing|| {};
  const delivery = q.delivery || {};

  const markupApply = { ...DEFAULT_MARKUP_APPLY, ...(q.markupApplyTo || {}) };
  const taxApply    = { ...DEFAULT_TAX_APPLY,    ...(q.taxApplyTo    || {}) };
  const markupPct   = q.markupPct || 0;
  const taxPct      = q.taxPct    || 0;

  // Markup can be a single rate gated per line (legacy), OR a per-line rate map
  // (q.markupPctByLine) so material and labor carry different margins. Either
  // way, lineMarkupPct(key) is the % applied to that line.
  const byLine = q.markupPctByLine;
  const lineMarkupPct = (key) => {
    if (byLine && byLine[key] != null) return Number(byLine[key]) || 0;
    return markupApply[key] ? markupPct : 0;
  };

  // 1. Raw cost per line — split INCLUDED (base price) vs OPTIONAL (upgrades) --
  const materials = getMaterials(q);
  const includedItems = materials.filter((it) => !it.optional);
  const optionalItems = materials.filter((it) => it.optional);

  const materialItems = includedItems.map((it) => ({
    name: it.name || "Material",
    method: it.method,
    cost: round2(materialItemCost(it)),
  }));
  const materialRaw = includedItems.reduce((s, it) => s + materialItemCost(it), 0);

  const finishingRaw = (finishing.areaSqFt || 0) * (finishing.pricePerSqFt || 0);
  const deliveryRaw  = (delivery.miles || 0) * (delivery.pricePerMile || 0);
  const finishingOptional = !!finishing.optional;
  const deliveryOptional  = !!delivery.optional;

  const raw = {
    material:  materialRaw,
    labor:     (labor.hours || 0) * (labor.rate || 0),
    finishing: finishingOptional ? 0 : finishingRaw,
    delivery:  deliveryOptional ? 0 : deliveryRaw,
  };

  // 2. Markup per line + 3/4. accumulate subtotal & taxable base --------------
  const lines = {};
  let subtotal = 0;
  let totalMarkup = 0;
  let taxableBase = 0;

  for (const key of LINE_KEYS) {
    const rawAmt = raw[key];
    const pct = lineMarkupPct(key);
    const marked = pct > 0;
    const markedAmt = rawAmt * (1 + pct / 100);
    const taxed = !!taxApply[key];

    subtotal += markedAmt;
    totalMarkup += markedAmt - rawAmt;
    if (taxed) taxableBase += markedAmt;

    lines[key] = {
      raw: round2(rawAmt),
      markup: round2(markedAmt - rawAmt),
      total: round2(markedAmt),
      markupPct: pct,
      marked,
      taxed,
    };
  }

  // 5. Tax + total ------------------------------------------------------------
  const tax = taxableBase * (taxPct / 100);
  const total = subtotal + tax;

  // 6. Optional upgrades (not in base) — show each with its all-in price impact
  const upgrades = [];
  const pushUpgrade = (name, lineKey, rawAmt) => {
    if (!(rawAmt > 0)) return;
    const marked = rawAmt * (1 + lineMarkupPct(lineKey) / 100);
    const taxable = !!taxApply[lineKey];
    const allIn = marked * (taxable ? 1 + taxPct / 100 : 1);
    upgrades.push({ name, price: round2(marked), allIn: round2(allIn), taxable });
  };
  optionalItems.forEach((it) => pushUpgrade(it.name || "Upgrade", "material", materialItemCost(it)));
  if (finishingOptional) pushUpgrade(finishing.note ? `Finishing — ${finishing.note}` : "Finishing", "finishing", finishingRaw);
  if (deliveryOptional)  pushUpgrade(delivery.note ? `Delivery — ${delivery.note}` : "Delivery", "delivery", deliveryRaw);

  const upgradesTotal = round2(upgrades.reduce((s, u) => s + u.allIn, 0));

  return {
    lines,
    materialItems, // per-component costs for the breakdown (INCLUDED only)
    upgrades,      // optional add-ons: { name, price, allIn, taxable }
    upgradesTotal,
    totalWithUpgrades: round2(total + upgradesTotal),

    subtotal:    round2(subtotal),
    totalMarkup: round2(totalMarkup),
    taxableBase: round2(taxableBase),
    tax:         round2(tax),
    total:       round2(total),

    markupPct,
    taxPct,
    markupApplyTo: markupApply,
    taxApplyTo: taxApply,
  };
}
