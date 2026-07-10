// =============================================================================
//  Estimate — the bridge between a design and a price.
//
//  deriveItems(type, state, priceBook) reads a configurator state (the same
//  object that drives the SVG preview) and the central price book, and returns
//  a list of GENERIC line items + an estimated labor-hours figure.
//
//  Generic item shape (UI- and override-friendly):
//    { key, name, kind: 'area'|'unit'|'length'|'flat', qty, rate }
//      area   : qty = sq ft,  rate = $/sq ft   → cost = qty × rate
//      unit   : qty = count,  rate = $/ea       → cost = qty × rate
//      length : qty = ft,     rate = $/ft       → cost = qty × rate
//      flat   : qty = 1,      rate = amount      → cost = rate
//
//  `key` is a STABLE role id so per-quote edits (overrides) survive option
//  changes — bump the post price and it stays bumped after you change height.
//
//  toMaterials() converts the generic items into the shape the pricing engine
//  (lib/calc.js) already understands, so markup/tax handling is unchanged.
// =============================================================================

import { round2 } from './format.js';
import { optionLabel, finishLabel } from '../data/configurators.js';

/**
 * Append an item AND mark it `unpriced` when geometry is non-trivial but the
 * rate is 0 — so the LineItems UI can flag unset placeholders the owner needs
 * to fill in. Items with qty=0 are skipped (no design impact, no warning).
 */
function pushPriced(items, item) {
  const qty = Number(item.qty) || 0;
  const rate = Number(item.rate) || 0;
  if (qty <= 0 && item.kind !== 'flat') return;
  // Flat items with an unset rate stay visible as $0 placeholders (like every
  // other kind) so the option the customer picked never silently prices at $0.
  items.push(rate <= 0 ? { ...item, unpriced: true } : item);
}

/** Cost of a single generic line item. */
export function lineCost(item) {
  if (!item) return 0;
  const qty = Number(item.qty) || 0;
  const rate = Number(item.rate) || 0;
  return item.kind === 'flat' ? rate : qty * rate;
}

/** Convert a generic item into a lib/calc material line. */
function toMaterial(item) {
  const qty = Number(item.qty) || 0;
  const rate = Number(item.rate) || 0;
  switch (item.kind) {
    case 'area':   return { name: item.name, method: 'area', quantity: 1, areaEachSqFt: qty, pricePerSqFt: rate };
    case 'length': return { name: item.name, method: 'linear', quantity: 1, lengthEachFt: qty, pricePerFt: rate };
    case 'unit':   return { name: item.name, method: 'perUnit', quantity: qty, pricePerUnit: rate };
    case 'flat':
    default:       return { name: item.name, method: 'flat', quantity: 1, flatCost: rate };
  }
}

/** Map a list of generic items to calc-engine materials (adds stable ids). */
export function toMaterials(items) {
  return (items || []).map((it, i) => ({ id: `m_${it.key || i}`, ...toMaterial(it) }));
}

// -----------------------------------------------------------------------------
//  Per-type estimates
// -----------------------------------------------------------------------------

function finishItem(type, state, pb, area) {
  const up = (pb.finishUpchargePerSqFt || {})[state.color] || 0;
  if (!(up > 0) || !(area > 0)) return null;
  const noun = type === 'carport' || type === 'pergola' ? 'frame finish' : 'finish';
  return { key: 'finish', name: `${finishLabel(state.color)} ${noun}`, kind: 'area', qty: round2(area), rate: round2(up) };
}

function estimateFence(s, pb) {
  const f = pb.fence;
  const length = Math.max(0, Number(s.totalLengthFt) || 0);
  const height = Number(s.height) || 0;
  const panelWidth = Number(s.panelWidth) || 6;
  const faceArea = round2(length * height);
  const panels = Math.max(1, Math.ceil(length / panelWidth));
  const posts = panels + 1;

  // Tighter-than-regular slat spacing packs more steel into the same face.
  // Regular = 1" gap, 3" slat. factor relative to that; clamped to sane bounds.
  const slatFactor = s.type === 'horizontal-slat'
    ? Math.min(1.6, Math.max(0.6, (3 + 1) / (3 + (Number(s.slatSpacing) || 1))))
    : 1;
  const panelRate = round2((f.panelPerSqFt[s.type] || 0) * slatFactor);

  const items = [
    { key: 'panels', name: `${optionLabel('fence', 'type', s.type)} panels`, kind: 'area', qty: faceArea, rate: panelRate },
  ];
  pushPriced(items, {
    key: 'posts', name: `Posts (${posts} × ${height} ft tall)`, kind: 'length',
    qty: round2(posts * height), rate: round2(Number(f.postPricePerFt) || 0),
  });
  if (s.topEdge === 'capped' && posts > 0) {
    pushPriced(items, {
      key: 'capped', name: 'Capped post tops', kind: 'unit',
      qty: posts, rate: round2(Number(f.cappedUpchargePerPost) || 0),
    });
  }
  if (s.type === 'wood-mesh') {
    const meshRatio = Math.max(0, Math.min(100, Number(s.meshRatio) || 0));
    const meshArea = round2(faceArea * meshRatio / 100);
    if (meshArea > 0) {
      pushPriced(items, {
        key: 'mesh', name: 'Mesh portion upcharge', kind: 'area',
        qty: meshArea, rate: round2(f.meshUpchargePerSqFt || 0),
      });
    }
    if (s.style === 'arched') {
      items.push({ key: 'arched', name: 'Arched profile', kind: 'unit', qty: panels, rate: round2(f.archedUpchargePerPanel) });
    }
  }
  const fin = finishItem('fence', s, pb, faceArea);
  if (fin) items.push(fin);

  return { items, laborHours: round2(length * f.laborHoursPerFt) };
}

function estimateGate(s, pb) {
  const g = pb.gate;
  const width = Number(s.width) || 0;
  const height = Number(s.height) || 0;
  const faceArea = round2(width * height);

  const items = [
    { key: 'hardware', name: `${optionLabel('gate', 'type', s.type)} hardware`, kind: 'unit', qty: 1, rate: round2(g.hardware[s.type] || 0) },
    { key: 'infill', name: `${optionLabel('gate', 'infill', s.infill)} infill`, kind: 'area', qty: faceArea, rate: round2(g.infillPerSqFt[s.infill] || 0) },
  ];
  // Gate framing — every gate has 2 posts, 2 lateral sides, top + bottom rails.
  // All by-ft so height drives posts/laterals and width drives top/bottom.
  pushPriced(items, {
    key: 'posts', name: `Posts (2 × ${height} ft tall)`, kind: 'length',
    qty: round2(2 * height), rate: round2(Number(g.postPricePerFt) || 0),
  });
  pushPriced(items, {
    key: 'lateralFrame', name: `Lateral frame (2 × ${height} ft)`, kind: 'length',
    qty: round2(2 * height), rate: round2(Number(g.lateralFramePerFt) || 0),
  });
  pushPriced(items, {
    key: 'topBottomFrame', name: `Top & bottom frame (2 × ${width} ft)`, kind: 'length',
    qty: round2(2 * width), rate: round2(Number(g.topBottomFramePerFt) || 0),
  });
  if (s.infill === 'metal-wood' && s.mesh === 'yes') {
    items.push({ key: 'mesh', name: 'Mesh upgrade', kind: 'area', qty: round2(faceArea * (Number(s.meshRatio) || 25) / 100), rate: round2(g.meshUpchargePerSqFt) });
  }
  if (s.arch === 'arched') {
    items.push({ key: 'arched', name: 'Arched top', kind: 'flat', qty: 1, rate: round2(g.archedUpcharge) });
  }
  if (s.topEdge === 'capped') {
    pushPriced(items, {
      key: 'capped', name: 'Capped top edge', kind: 'flat',
      qty: 1, rate: round2(g.cappedUpcharge || 0),
    });
  }
  // Personalization upsell from the website designer — plasma-cut initials
  // medallion or the customer's own artwork. Flat per gate.
  if (s.personalization === 'initials') {
    pushPriced(items, {
      key: 'monogram', name: 'Monogram initials (plasma-cut)', kind: 'flat',
      qty: 1, rate: round2(g.monogramFlat || 0),
    });
  } else if (s.personalization === 'image') {
    pushPriced(items, {
      key: 'customArt', name: 'Custom plasma-cut artwork', kind: 'flat',
      qty: 1, rate: round2(g.customArtFlat || 0),
    });
  }
  const fin = finishItem('gate', s, pb, faceArea);
  if (fin) items.push(fin);

  return { items, laborHours: round2(g.laborHours[s.type] || 0) };
}

function estimateCarport(s, pb) {
  const c = pb.carport;
  const width = Number(s.width) || 0;
  const depth = Number(s.depth) || 0;
  const height = Number(s.height) || 0;
  const planArea = width * depth;

  // Sloped roofs have more surface than their plan footprint.
  let slope = 1;
  if (s.roof === 'gable') slope = Math.sqrt(1 + Math.pow((Number(s.pitch) || 3) / 12, 2));
  else if (s.roof === 'lean-to') slope = 1 / Math.cos(((Number(s.elevation) || 15) * Math.PI) / 180);
  const roofArea = round2(planArea * slope);

  const bays = Math.max(1, Math.round(width / 12));
  const rows = s.mounting === 'attached' ? 1 : 2; // attached = front posts only
  const posts = (bays + 1) * rows;

  // Posts (vertical columns) are priced by-ft so clearance moves the cost.
  // Frame (horizontal support beams) scales with the plan footprint.
  const items = [
    {
      key: 'roof', name: `Roof — ${optionLabel('carport', 'panel', s.panel)}`, kind: 'area', qty: roofArea,
      rate: round2(c.roofPerSqFt + (c.panelUpchargePerSqFt[s.panel] || 0)),
    },
  ];
  pushPriced(items, {
    key: 'posts', name: `Posts (${posts} × ${height} ft clearance)`, kind: 'length',
    qty: round2(posts * height), rate: round2(Number(c.postPricePerFt) || 0),
  });
  pushPriced(items, {
    key: 'frame', name: 'Frame — support beams', kind: 'area',
    qty: round2(planArea), rate: round2(Number(c.framePerSqFt) || 0),
  });
  if (s.sides !== 'open') {
    const sideArea = depth * height * (s.sides === 'two' ? 2 : 1);
    items.push({ key: 'sides', name: 'Enclosed sides', kind: 'area', qty: round2(sideArea), rate: round2(c.sidePanelPerSqFt) });
  }
  if (s.gutters === 'yes') {
    items.push({ key: 'gutters', name: 'Gutters & downspouts', kind: 'length', qty: round2(width), rate: round2(c.guttersPerFt) });
  }
  const roofFinishRate = (c.roofFinishUpchargePerSqFt || {})[s.roofColor] || 0;
  const isStandardRoof = s.roofColor === '#A7A8A4'; // Galvalume is the standard, $0 base
  if (roofFinishRate > 0) {
    items.push({
      key: 'roofFinish', name: `${finishLabel(s.roofColor)} roof finish`, kind: 'area',
      qty: roofArea, rate: round2(roofFinishRate),
    });
  } else if (!isStandardRoof && roofArea > 0) {
    // Non-standard color chosen, but no upcharge set → placeholder so owner notices.
    items.push({
      key: 'roofFinish', name: `${finishLabel(s.roofColor)} roof finish (unset)`,
      kind: 'area', qty: roofArea, rate: 0, unpriced: true,
    });
  }
  const fin = finishItem('carport', s, pb, round2(planArea));
  if (fin) items.push(fin);

  return { items, laborHours: round2((roofArea / 100) * c.laborHoursPer100SqFt) };
}

function estimateRailing(s, pb) {
  const r = pb.railing;
  const length = Math.max(0, Number(s.lengthFt) || 0);
  const isHand = s.app === 'handrail';

  // Base run: everything a standard railing needs (posts, rails, infill),
  // priced per linear foot by infill style. Handrail is its own rate.
  const baseRate = isHand
    ? Number(r.handrailPerLnFt) || 0
    : Number((r.railPerLnFt || {})[s.infill]) || 0;
  const baseName = isHand
    ? 'Wall handrail'
    : `${optionLabel('railing', 'infill', s.infill)} railing`;

  const items = [
    { key: 'rail', name: `${baseName} (${length} ft run)`, kind: 'length', qty: round2(length), rate: round2(baseRate) },
  ];
  if (s.app === 'stairs') {
    pushPriced(items, {
      key: 'stairs', name: 'Stair (raked) upcharge', kind: 'length',
      qty: round2(length), rate: round2(Number(r.stairsUpchargePerLnFt) || 0),
    });
  }
  if (s.toprail !== 'flat') {
    pushPriced(items, {
      key: 'toprail', name: `${optionLabel('railing', 'toprail', s.toprail)} top rail`, kind: 'length',
      qty: round2(length), rate: round2(Number((r.toprailUpchargePerLnFt || {})[s.toprail]) || 0),
    });
  }
  if (!isHand && s.mounting === 'fascia') {
    // Posts at most 6 ft apart plus the end post — ceil so a 7 ft run
    // correctly needs 3, matching the fence estimator's end-post math.
    const posts = Math.max(1, Math.ceil(length / 6)) + 1;
    pushPriced(items, {
      key: 'fascia', name: `Fascia mounting (${posts} posts)`, kind: 'unit',
      qty: posts, rate: round2(Number(r.fasciaMountPerPost) || 0),
    });
  }
  // Visible face for the finish upcharge: run length × rail height (inches → ft).
  const faceArea = round2(length * ((Number(s.height) || 36) / 12));
  const fin = finishItem('railing', s, pb, faceArea);
  if (fin) items.push(fin);

  return { items, laborHours: round2(length * (Number(r.laborHoursPerFt) || 0)) };
}

function estimatePergola(s, pb) {
  const p = pb.pergola || {};
  const width = Number(s.width) || 0;
  const height = Number(s.height) || 0;
  const hex = s.style === 'hexagonal';
  const depth = hex ? 0 : Number(s.depth) || 0;

  // Regular hexagon, W = width across flats: area = (√3/2)·W², perimeter = 2√3·W.
  const planArea = round2(hex ? (Math.sqrt(3) / 2) * width * width : width * depth);
  const perimeter = round2(hex ? 2 * Math.sqrt(3) * width : 2 * (width + depth));
  // Rect: 4 corner posts, +1 mid-span pair once a side passes 16 ft. Hex: one per corner.
  const posts = hex ? 6 : Math.max(width, depth) > 16 ? 6 : 4;

  const items = [
    {
      key: 'rafters', name: hex ? 'Radial rafter grid (hexagonal)' : 'Rafter grid',
      kind: 'area', qty: planArea, rate: round2(Number(p.rafterPerSqFt) || 0),
    },
  ];
  pushPriced(items, {
    // Whole feet in the display name (hex perimeter is irrational); qty stays precise.
    key: 'beams', name: `Header beams (${Math.round(perimeter)} ft perimeter)`, kind: 'length',
    qty: perimeter, rate: round2(Number(p.beamPerFt) || 0),
  });
  pushPriced(items, {
    key: 'posts', name: `Posts (${posts} × ${height} ft)`, kind: 'length',
    qty: round2(posts * height), rate: round2(Number(p.postPricePerFt) || 0),
  });
  // Designer (slatted) legs from the CJM design — per-post upcharge over the
  // standard square post. Rectangular only: the control is hidden for hex, so
  // ignore a stale 'designer' left behind by a style switch.
  if (!hex && s.legs === 'designer') {
    pushPriced(items, {
      key: 'legs', name: `Designer legs (${posts} posts)`, kind: 'unit',
      qty: posts, rate: round2(Number(p.legsDesignerPerPost) || 0),
    });
  }
  if (s.shade === 'panels') {
    pushPriced(items, {
      key: 'shade', name: 'Shade panels', kind: 'area',
      qty: planArea, rate: round2(Number(p.shadePanelPerSqFt) || 0),
    });
  }
  const fin = finishItem('pergola', s, pb, planArea);
  if (fin) items.push(fin);

  // Hexagonal = 6 mitered corners and radial fit-up — more hours per sq ft.
  const laborMult = hex ? Number(p.hexLaborMult) || 1 : 1;
  return { items, laborHours: round2((planArea / 100) * (Number(p.laborHoursPer100SqFt) || 0) * laborMult) };
}

const ESTIMATORS = { fence: estimateFence, gate: estimateGate, carport: estimateCarport, railing: estimateRailing, pergola: estimatePergola };

/**
 * Consumables (wire, gas, discs, primer/paint, fasteners) as a % of the material
 * subtotal so far — they scale with how much you build. Always present so the
 * owner remembers to set the rate; flagged unpriced (and $0) when the % is 0.
 */
function consumablesItem(materialItems, priceBook) {
  const pct = Number(priceBook.consumablesPct) || 0;
  const base = (materialItems || []).reduce((s, it) => s + lineCost(it), 0);
  const amt = round2(base * pct / 100);
  const item = {
    key: 'consumables',
    name: 'Consumables (wire, gas, discs, paint)',
    kind: 'flat', qty: 1, rate: amt,
  };
  if (!(pct > 0)) item.unpriced = true;
  return item;
}

/** Derive generic line items + labor hours for a design (no overrides applied). */
export function deriveItems(type, state, priceBook) {
  const fn = ESTIMATORS[type];
  if (!fn) return { items: [], laborHours: 0 };
  const { items, laborHours } = fn(state, priceBook);
  // Consumables ride on the material subtotal, so append after the build items.
  return { items: [...items, consumablesItem(items, priceBook)], laborHours };
}

/**
 * Derive, then layer per-quote overrides on top (keyed by item role) so manual
 * edits survive option changes. overrides = { items:{[key]:{qty,rate}}, labor:{hours,rate} }.
 */
export function buildLineState(type, state, priceBook, overrides) {
  const { items, laborHours } = deriveItems(type, state, priceBook);
  const ov = overrides || {};
  const ovItems = ov.items || {};

  const merged = items.map((it) => {
    const o = ovItems[it.key];
    if (!o) return it;
    const nextRate = o.rate != null ? Number(o.rate) : it.rate;
    return {
      ...it,
      qty: o.qty != null ? o.qty : it.qty,
      rate: nextRate,
      edited: o.qty != null || o.rate != null,
      // An override that fills in a real rate clears the placeholder flag.
      unpriced: it.unpriced && !(Number(nextRate) > 0),
    };
  });

  // Any override whose key is no longer produced (e.g. an extra custom line) is kept too.
  Object.keys(ovItems).forEach((key) => {
    if (merged.some((m) => m.key === key)) return;
    const o = ovItems[key];
    if (!o || !o.custom) return;
    merged.push({ key, name: o.name || 'Custom line', kind: o.kind || 'flat', qty: o.qty ?? 1, rate: o.rate ?? 0, edited: true, custom: true });
  });

  // Consumables ride on the material subtotal — recompute from the
  // POST-override lines (including custom ones) so per-quote edits move it
  // too. An explicit override on the consumables line itself still wins.
  if (!ovItems.consumables) {
    const ci = merged.findIndex((m) => m.key === 'consumables');
    if (ci !== -1) {
      const pct = Number(priceBook.consumablesPct) || 0;
      const base = merged.reduce((sum, it, i) => (i === ci ? sum : sum + lineCost(it)), 0);
      merged[ci] = { ...merged[ci], rate: round2(base * pct / 100) };
    }
  }

  const labor = {
    hours: ov.labor?.hours != null ? ov.labor.hours : laborHours,
    rate: ov.labor?.rate != null ? ov.labor.rate : priceBook.laborRatePerHour,
    edited: ov.labor?.hours != null || ov.labor?.rate != null,
  };

  return { items: merged, labor };
}
