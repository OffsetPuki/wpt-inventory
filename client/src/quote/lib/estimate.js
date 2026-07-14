// =============================================================================
//  Estimate — the bridge between a design and a price.
//
//  deriveItems(type, state, priceBook) reads a configurator state (the same
//  object that drives the SVG preview) and the central price book, and returns
//  a list of GENERIC line items + estimated shop & install labor hours.
//
//  Shop-math, material-first: every estimator computes QUANTITIES of shared
//  materials (posts = count × (height + underground), 4 bags of concrete per
//  post, slats = inside width × slat count, 5 decorative 1×1 pieces per
//  designer leg...) and prices them through priceBook.materials — so one
//  material price edit reprices every product that uses it.
//
//  Generic item shape (UI- and override-friendly):
//    { key, name, kind: 'area'|'unit'|'length'|'flat', qty, rate,
//      materialId?, unit? }
//      area   : qty = sq ft,  rate = $/sq ft   → cost = qty × rate
//      unit   : qty = count,  rate = $/ea       → cost = qty × rate
//      length : qty = ft,     rate = $/ft       → cost = qty × rate
//      flat   : qty = 1,      rate = amount      → cost = rate
//
//  `key` is a STABLE role id so per-quote edits (overrides) survive option
//  changes — bump the post price and it stays bumped after you change height.
//  `materialId` ties a line back to the shared library (for the materials
//  summary / cut list); its rate is the material cost with waste % blended in.
//
//  toMaterials() converts the generic items into the shape the pricing engine
//  (lib/calc.js) already understands, so markup/tax handling is unchanged.
//
//  This module is imported by BOTH the client and server/public-portal.ts —
//  keep it pure JS (no React, no DOM).
// =============================================================================

import { round2 } from './format.js';
import { optionLabel, finishLabel } from '../data/configurators.js';

// ── Number & material helpers ─────────────────────────────────────────────────

/** Number with a default — respects an explicit 0, falls back on null/NaN. */
function num(v, dflt) {
  if (v == null || v === '') return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

/** Material definition from the shared library. */
export function matDef(pb, id) {
  return ((pb && pb.materials) || {})[id] || { name: id, unit: 'ft', cost: 0, wastePct: 0 };
}

/** Effective $/unit for a material: cost with its waste % blended in. */
export function matRate(pb, id) {
  const m = matDef(pb, id);
  const waste = Math.max(0, num(m.wastePct, 0));
  return round2(num(m.cost, 0) * (1 + waste / 100));
}

const MAT_KIND = { ft: 'length', sqft: 'area', piece: 'unit', bag: 'unit', set: 'unit' };
const MAT_QTY_UNIT = { ft: 'ft', sqft: 'sq ft', piece: 'pieces', bag: 'bags', set: 'sets' };

/** Build a line item priced from the material library. */
function matItem(pb, { key, materialId, qty, name }) {
  const m = matDef(pb, materialId);
  return {
    key,
    materialId,
    name: name || m.name,
    kind: MAT_KIND[m.unit] || 'unit',
    unit: MAT_QTY_UNIT[m.unit] || '',
    qty: round2(qty),
    rate: matRate(pb, materialId),
  };
}

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

/**
 * Aggregate line items back into per-material purchase totals (the shop
 * summary / cut list): total ft of each tubing, bags of concrete, sets...
 */
export function materialTotals(items, pb) {
  const acc = new Map();
  for (const it of items || []) {
    if (!it.materialId) continue;
    const cur = acc.get(it.materialId) || { id: it.materialId, name: matDef(pb, it.materialId).name, unit: it.unit || '', qty: 0 };
    cur.qty += Number(it.qty) || 0;
    acc.set(it.materialId, cur);
  }
  return [...acc.values()].map((m) => ({ ...m, qty: round2(m.qty) }));
}

// ── Shared shop-math pieces ───────────────────────────────────────────────────

/**
 * Slats per section: the entered design count wins; 0/blank auto-fits a 4-inch
 * slat face with the given gap into the visible height.
 */
function slatCountFor(heightFt, slatCount, gapIn) {
  const manual = num(slatCount, 0);
  if (manual > 0) return Math.round(manual);
  const gap = Math.max(0, num(gapIn, 1));
  return Math.max(1, Math.round((num(heightFt, 0) * 12) / (4 + gap)));
}

/** 4×1 wood coverage: a 4-inch board face → 3 linear ft of board per sq ft. */
const WOOD_FT_PER_SQFT = 3;

/** Posts + concrete: the fence/gate/pergola/carport shared pattern. */
function postAndConcreteItems(pb, s, items, { count, heightFt, materialId, keyPrefix = '' }) {
  const underground = Math.max(0, num(s.undergroundFt, 3));
  const postLen = num(heightFt, 0) + underground;
  const m = matDef(pb, materialId);
  pushPriced(items, matItem(pb, {
    key: `${keyPrefix}posts`,
    materialId,
    qty: count * postLen,
    name: `Posts — ${count} × ${m.name} (${num(heightFt, 0)} ft${underground > 0 ? ` + ${underground} ft underground` : ''})`,
  }));
  const bagsPerPost = Math.max(0, num(s.bagsPerPost, 4));
  const bags = count * bagsPerPost;
  if (bags > 0) {
    pushPriced(items, matItem(pb, {
      key: `${keyPrefix}concrete`,
      materialId: 'concrete_bag',
      qty: bags,
      name: `Concrete — ${bags} bags (${bagsPerPost} per post)`,
    }));
  }
  return { underground, postLen, bags };
}

/** Coating-system upcharge (powder / galvanized) over an area. */
function coatingItem(pb, s, area) {
  const sys = s.coating;
  if (!sys || sys === 'standard' || !(area > 0)) return null;
  const rate = num((pb.coatingUpchargePerSqFt || {})[sys], 0);
  const label = sys === 'powder' ? 'Powder coat' : sys === 'galvanized' ? 'Galvanized' : sys;
  const item = { key: 'coating', name: `${label} finish`, kind: 'area', qty: round2(area), rate: round2(rate) };
  if (!(rate > 0)) item.unpriced = true;
  return item;
}

function finishItem(type, state, pb, area) {
  const up = (pb.finishUpchargePerSqFt || {})[state.color] || 0;
  if (!(up > 0) || !(area > 0)) return null;
  const noun = type === 'carport' || type === 'pergola' ? 'frame finish' : 'finish';
  return { key: 'finish', name: `${finishLabel(state.color)} ${noun}`, kind: 'area', qty: round2(area), rate: round2(up) };
}

// -----------------------------------------------------------------------------
//  Per-type estimates
// -----------------------------------------------------------------------------

function estimateFence(s, pb) {
  const f = pb.fence;
  const length = Math.max(0, num(s.totalLengthFt, 0));
  const height = num(s.height, 0);
  const panelWidth = num(s.panelWidth, 6); // inside distance between posts
  const faceArea = round2(length * height);
  const panels = Math.max(1, Math.ceil(length / panelWidth));
  const posts = panels + 1;

  const items = [];

  // Posts: 4×4×3/16, visible height + underground ft each, concrete per post.
  postAndConcreteItems(pb, s, items, { count: posts, heightFt: height, materialId: 'tube_4x4_316' });

  if (s.type === 'horizontal-slat') {
    // Slats: length = inside distance between posts, × slats in the design.
    const perSection = slatCountFor(height, s.slatCount, s.slatSpacing);
    const slatMatId = s.slatMaterial === '4x2' ? 'tube_4x2' : 'tube_4x1';
    const slatFt = perSection * panels * panelWidth;
    pushPriced(items, matItem(pb, {
      key: 'slats',
      materialId: slatMatId,
      qty: slatFt,
      name: `Slats — ${perSection}/section × ${panels} sections × ${panelWidth} ft (${matDef(pb, slatMatId).name})`,
    }));
  }

  if (s.type === 'wood-mesh') {
    // 3 horizontal 4×4×3/16 members per section, length = panel width.
    const railFt = 3 * panels * panelWidth;
    pushPriced(items, matItem(pb, {
      key: 'rails',
      materialId: 'tube_4x4_316',
      qty: railFt,
      name: `Horizontal members — 3/section × ${panels} sections × ${panelWidth} ft`,
    }));
    const meshRatio = Math.max(0, Math.min(100, num(s.meshRatio, 0)));
    const meshArea = round2(faceArea * meshRatio / 100);
    if (meshArea > 0) {
      pushPriced(items, matItem(pb, {
        key: 'mesh', materialId: 'mesh', qty: meshArea,
        name: `Metal mesh — ${meshArea} sq ft (${meshRatio}% of face)`,
      }));
    }
    const woodArea = round2(faceArea * (100 - meshRatio) / 100);
    if (woodArea > 0) {
      pushPriced(items, matItem(pb, {
        key: 'wood', materialId: 'wood_4x1', qty: woodArea * WOOD_FT_PER_SQFT,
        name: `4×1 wood — ${woodArea} sq ft coverage (${round2(woodArea * WOOD_FT_PER_SQFT)} board-ft)`,
      }));
    }
    if (s.style === 'arched') {
      items.push({ key: 'arched', name: 'Arched profile', kind: 'unit', qty: panels, rate: round2(f.archedUpchargePerPanel) });
    }
  }

  if (s.topEdge === 'capped' && posts > 0) {
    pushPriced(items, {
      key: 'capped', name: 'Capped post tops', kind: 'unit',
      qty: posts, rate: round2(num(f.cappedUpchargePerPost, 0)),
    });
  }

  const coat = coatingItem(pb, s, faceArea);
  if (coat) items.push(coat);
  const fin = finishItem('fence', s, pb, faceArea);
  if (fin) items.push(fin);

  // Demo of the old fence + one dump fee.
  const demoFt = Math.max(0, num(s.demoFt, 0));
  if (demoFt > 0) {
    pushPriced(items, {
      key: 'demo', name: `Remove old fence (${demoFt} ft)`, kind: 'length',
      qty: demoFt, rate: round2(num(f.demoPerFt, 0)),
    });
    pushPriced(items, {
      key: 'dump', name: 'Dump / haul-off fee', kind: 'flat',
      qty: 1, rate: round2(num(pb.dumpFeeFlat, 0)),
    });
  }

  return {
    items,
    laborHours: round2(length * num(f.laborHoursPerFt, 0)),
    installHours: round2(length * num(f.installHoursPerFt, 0)),
  };
}

function estimateGate(s, pb) {
  const g = pb.gate;
  const width = num(s.width, 0);
  const height = num(s.height, 0);
  const faceArea = round2(width * height);

  const items = [];

  // Frame: 4×4×3/16. Single = 2 stiles + top/bottom. Double = 4 stiles (two
  // leaves) + top/bottom. Sliding adds the cantilever counterbalance tail.
  const stiles = s.type === 'double' ? 4 : 2;
  const frameFt = stiles * height + 2 * width;
  pushPriced(items, matItem(pb, {
    key: 'frame', materialId: 'tube_4x4_316', qty: frameFt,
    name: `Gate frame — ${stiles} × ${height} ft + 2 × ${width} ft (4×4×3/16)`,
  }));
  if (s.type === 'slide') {
    // Cantilever tail ≈ half the opening: top + bottom extensions + end upright.
    const tailFt = round2(width + height);
    pushPriced(items, matItem(pb, {
      key: 'counterbalance', materialId: 'tube_4x4_316', qty: tailFt,
      name: `Counterbalance tail (cantilever) — ~${tailFt} ft`,
    }));
  }

  if (s.infill === 'horizontal-slat') {
    // Slats: 4×4×3/16 per the shop standard; length = gate width × design count.
    const perGate = slatCountFor(height, s.slatCount, 1);
    pushPriced(items, matItem(pb, {
      key: 'slats', materialId: 'tube_4x4_316', qty: perGate * width,
      name: `Slats — ${perGate} × ${width} ft (4×4×3/16)`,
    }));
  }

  if (s.infill === 'metal-wood') {
    const meshRatio = s.mesh === 'yes' ? Math.max(0, Math.min(100, num(s.meshRatio, 25))) : 0;
    const woodArea = round2(faceArea * (100 - meshRatio) / 100);
    if (woodArea > 0) {
      pushPriced(items, matItem(pb, {
        key: 'wood', materialId: 'wood_4x1', qty: woodArea * WOOD_FT_PER_SQFT,
        name: `4×1 wood — ${woodArea} sq ft coverage (${round2(woodArea * WOOD_FT_PER_SQFT)} board-ft)`,
      }));
    }
    if (meshRatio > 0) {
      const meshArea = round2(faceArea * meshRatio / 100);
      pushPriced(items, matItem(pb, {
        key: 'mesh', materialId: 'mesh', qty: meshArea,
        name: `Metal mesh — ${meshArea} sq ft (${meshRatio}% of face)`,
      }));
    }
  }

  // Support posts: 6×6, height + underground, concrete per post. Double swing
  // can take 2 extra posts when the installation calls for it.
  const postCount = s.type === 'double' && s.extraPosts === 'yes' ? 4 : 2;
  postAndConcreteItems(pb, s, items, { count: postCount, heightFt: height, materialId: 'tube_6x6' });

  // Hardware set by gate type (double is its own set — priced ~2× single).
  const hwId = s.type === 'double' ? 'hw_double' : s.type === 'slide' ? 'hw_slide' : 'hw_single';
  pushPriced(items, matItem(pb, {
    key: 'hardware', materialId: hwId, qty: 1,
    name: `${optionLabel('gate', 'type', s.type)} — ${matDef(pb, hwId).name}`,
  }));

  // Gate operator (automation) kits.
  if (s.operator === 'one' || s.operator === 'two') {
    const n = s.operator === 'two' ? 2 : 1;
    pushPriced(items, matItem(pb, {
      key: 'operator', materialId: 'hw_operator', qty: n,
      name: `Gate operator kit${n > 1 ? 's' : ''} — ${n} × motor + safety`,
    }));
  }

  if (s.arch === 'arched') {
    items.push({ key: 'arched', name: 'Arched top', kind: 'flat', qty: 1, rate: round2(g.archedUpcharge) });
  }
  if (s.topEdge === 'capped') {
    pushPriced(items, {
      key: 'capped', name: 'Capped top edge', kind: 'flat',
      qty: 1, rate: round2(num(g.cappedUpcharge, 0)),
    });
  }
  // Personalization upsell from the website designer — laser-cut initials
  // medallion or the customer's own artwork. Flat per gate.
  if (s.personalization === 'initials') {
    pushPriced(items, {
      key: 'monogram', name: 'Monogram initials (laser-cut)', kind: 'flat',
      qty: 1, rate: round2(num(g.monogramFlat, 0)),
    });
  } else if (s.personalization === 'image') {
    pushPriced(items, {
      key: 'customArt', name: 'Custom laser-cut artwork', kind: 'flat',
      qty: 1, rate: round2(num(g.customArtFlat, 0)),
    });
  }

  const coat = coatingItem(pb, s, faceArea);
  if (coat) items.push(coat);
  const fin = finishItem('gate', s, pb, faceArea);
  if (fin) items.push(fin);

  if (s.demoOld === 'yes') {
    pushPriced(items, {
      key: 'demo', name: 'Remove old gate', kind: 'flat',
      qty: 1, rate: round2(num(g.demoFlat, 0)),
    });
    pushPriced(items, {
      key: 'dump', name: 'Dump / haul-off fee', kind: 'flat',
      qty: 1, rate: round2(num(pb.dumpFeeFlat, 0)),
    });
  }

  return {
    items,
    laborHours: round2(num((g.laborHours || {})[s.type], 0)),
    installHours: round2(num((g.installHours || {})[s.type], 0)),
  };
}

function estimateCarport(s, pb) {
  const c = pb.carport;
  const width = num(s.width, 0);
  const depth = num(s.depth, 0);
  const height = num(s.height, 0);
  const planArea = width * depth;

  // Sloped roofs have more surface than their plan footprint.
  let slope = 1;
  if (s.roof === 'gable') slope = Math.sqrt(1 + Math.pow(num(s.pitch, 3) / 12, 2));
  else if (s.roof === 'lean-to') slope = 1 / Math.cos((num(s.elevation, 15) * Math.PI) / 180);
  const roofArea = round2(planArea * slope);

  const bays = Math.max(1, Math.round(width / 12));
  const rows = s.mounting === 'attached' ? 1 : 2; // attached = front posts only
  const posts = (bays + 1) * rows;

  const items = [
    {
      key: 'roof', name: `Roof — ${optionLabel('carport', 'panel', s.panel)}`, kind: 'area', qty: roofArea,
      rate: round2(c.roofPerSqFt + (c.panelUpchargePerSqFt[s.panel] || 0)),
    },
  ];

  // Columns: 4×4×3/16 from the material library. Embedded anchoring adds
  // underground length + concrete; base-plate mounts don't.
  if (s.anchor === 'embedded') {
    postAndConcreteItems(pb, s, items, { count: posts, heightFt: height, materialId: 'tube_4x4_316' });
  } else {
    pushPriced(items, matItem(pb, {
      key: 'posts', materialId: 'tube_4x4_316', qty: posts * height,
      name: `Columns — ${posts} × ${height} ft clearance (base plate)`,
    }));
  }

  pushPriced(items, {
    key: 'frame', name: 'Frame — support beams', kind: 'area',
    qty: round2(planArea), rate: round2(num(c.framePerSqFt, 0)),
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
  const coat = coatingItem(pb, s, round2(planArea));
  if (coat) items.push(coat);
  const fin = finishItem('carport', s, pb, round2(planArea));
  if (fin) items.push(fin);

  return {
    items,
    laborHours: round2((roofArea / 100) * num(c.laborHoursPer100SqFt, 0)),
    installHours: round2((roofArea / 100) * num(c.installHoursPer100SqFt, 0)),
  };
}

function estimateRailing(s, pb) {
  const r = pb.railing;
  const length = Math.max(0, num(s.lengthFt, 0));
  const isHand = s.app === 'handrail';

  // Base run: everything a standard railing needs (posts, rails, infill),
  // priced per linear foot by infill style. Handrail is its own rate.
  const baseRate = isHand
    ? num(r.handrailPerLnFt, 0)
    : num((r.railPerLnFt || {})[s.infill], 0);
  const baseName = isHand
    ? 'Wall handrail'
    : `${optionLabel('railing', 'infill', s.infill)} railing`;

  const items = [
    { key: 'rail', name: `${baseName} (${length} ft run)`, kind: 'length', qty: round2(length), rate: round2(baseRate) },
  ];
  if (s.app === 'stairs') {
    pushPriced(items, {
      key: 'stairs', name: 'Stair (raked) upcharge', kind: 'length',
      qty: round2(length), rate: round2(num(r.stairsUpchargePerLnFt, 0)),
    });
  }
  if (s.toprail !== 'flat') {
    pushPriced(items, {
      key: 'toprail', name: `${optionLabel('railing', 'toprail', s.toprail)} top rail`, kind: 'length',
      qty: round2(length), rate: round2(num((r.toprailUpchargePerLnFt || {})[s.toprail], 0)),
    });
  }
  if (!isHand && s.mounting === 'fascia') {
    // Posts at most 6 ft apart plus the end post — ceil so a 7 ft run
    // correctly needs 3, matching the fence estimator's end-post math.
    const posts = Math.max(1, Math.ceil(length / 6)) + 1;
    pushPriced(items, {
      key: 'fascia', name: `Fascia mounting (${posts} posts)`, kind: 'unit',
      qty: posts, rate: round2(num(r.fasciaMountPerPost, 0)),
    });
  }
  // Visible face for the finish upcharge: run length × rail height (inches → ft).
  const faceArea = round2(length * (num(s.height, 36) / 12));
  const fin = finishItem('railing', s, pb, faceArea);
  if (fin) items.push(fin);

  return {
    items,
    laborHours: round2(length * num(r.laborHoursPerFt, 0)),
    installHours: round2(length * num(r.installHoursPerFt, 0)),
  };
}

function estimatePergola(s, pb) {
  const p = pb.pergola || {};
  const width = num(s.width, 0);
  const height = num(s.height, 0); // head clearance
  const hex = s.style === 'hexagonal';
  const depth = hex ? 0 : num(s.depth, 0);

  // Regular hexagon, W = width across flats: area = (√3/2)·W², perimeter = 2√3·W.
  const planArea = round2(hex ? (Math.sqrt(3) / 2) * width * width : width * depth);
  const perimeter = round2(hex ? 2 * Math.sqrt(3) * width : 2 * (width + depth));
  // Rect: 4 corner posts, +1 mid-span pair once a side passes 16 ft. Hex: one per corner.
  const posts = hex ? 6 : Math.max(width, depth) > 16 ? 6 : 4;

  const items = [];

  // Legs: 4×4×3/16 by head clearance. Embedded anchoring adds underground
  // length + concrete; base-plate mounts don't.
  if (s.anchor === 'embedded') {
    postAndConcreteItems(pb, s, items, { count: posts, heightFt: height, materialId: 'tube_4x4_316' });
  } else {
    pushPriced(items, matItem(pb, {
      key: 'posts', materialId: 'tube_4x4_316', qty: posts * height,
      name: `Posts — ${posts} × ${height} ft (base plate)`,
    }));
  }

  // Frame charged by plan square footage + header beams by perimeter.
  items.unshift({
    key: 'rafters', name: hex ? 'Radial rafter grid (hexagonal)' : 'Rafter grid / frame',
    kind: 'area', qty: planArea, rate: round2(num(p.rafterPerSqFt, 0)),
  });
  pushPriced(items, {
    // Whole feet in the display name (hex perimeter is irrational); qty stays precise.
    key: 'beams', name: `Header beams (${Math.round(perimeter)} ft perimeter)`, kind: 'length',
    qty: perimeter, rate: round2(num(p.beamPerFt, 0)),
  });

  // Post-style variants from the CJM design. Decorative pieces are 1×1 square
  // tubing from the material library — 5 per leg (designer), 12 per leg (side
  // screens), each ≈ head-clearance long. Fabrication upcharge rides per post.
  // Rectangular only: the control is hidden for hex, so ignore a stale value.
  if (!hex && s.legs === 'designer') {
    const pieces = 5 * posts;
    pushPriced(items, matItem(pb, {
      key: 'legDeco', materialId: 'tube_1x1', qty: pieces * height,
      name: `Designer legs — ${pieces} × 1×1 pieces (5/leg × ${height} ft)`,
    }));
    pushPriced(items, {
      key: 'legs', name: `Designer legs fabrication (${posts} posts)`, kind: 'unit',
      qty: posts, rate: round2(num(p.legsDesignerPerPost, 0)),
    });
  } else if (!hex && s.legs === 'sides') {
    const pieces = 12 * posts;
    pushPriced(items, matItem(pb, {
      key: 'legDeco', materialId: 'tube_1x1', qty: pieces * height,
      name: `Side screens — ${pieces} × 1×1 pieces (12/leg × ${height} ft)`,
    }));
    pushPriced(items, {
      key: 'legs', name: `Side screens fabrication (${posts} posts)`, kind: 'unit',
      qty: posts, rate: round2(num(p.legsSidesPerPost, 0)),
    });
  }

  if (s.shade === 'panels') {
    pushPriced(items, {
      key: 'shade', name: 'Shade panels', kind: 'area',
      qty: planArea, rate: round2(num(p.shadePanelPerSqFt, 0)),
    });
  }
  const coat = coatingItem(pb, s, planArea);
  if (coat) items.push(coat);
  const fin = finishItem('pergola', s, pb, planArea);
  if (fin) items.push(fin);

  // Hexagonal = 6 mitered corners and radial fit-up — more hours per sq ft.
  const laborMult = hex ? num(p.hexLaborMult, 1) : 1;
  return {
    items,
    laborHours: round2((planArea / 100) * num(p.laborHoursPer100SqFt, 0) * laborMult),
    installHours: round2((planArea / 100) * num(p.installHoursPer100SqFt, 0) * laborMult),
  };
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
  if (!fn) return { items: [], laborHours: 0, installHours: 0 };
  const { items, laborHours, installHours } = fn(state, priceBook);
  // Consumables ride on the material subtotal, so append after the build items.
  return {
    items: [...items, consumablesItem(items, priceBook)],
    laborHours,
    installHours: installHours || 0,
  };
}

/**
 * Derive, then layer per-quote overrides on top (keyed by item role) so manual
 * edits survive option changes.
 * overrides = { items:{[key]:{qty,rate,custom?,name?,kind?}},
 *               labor:{hours,rate}, install:{hours,rate} }.
 */
export function buildLineState(type, state, priceBook, overrides) {
  const { items, laborHours, installHours } = deriveItems(type, state, priceBook);
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
  const install = {
    hours: ov.install?.hours != null ? ov.install.hours : installHours,
    rate: ov.install?.rate != null ? ov.install.rate : num(priceBook.installRatePerHour, 0),
    edited: ov.install?.hours != null || ov.install?.rate != null,
  };

  return { items: merged, labor, install };
}

// -----------------------------------------------------------------------------
//  "Did you forget?" checklist
// -----------------------------------------------------------------------------

/**
 * Cross-check a quote for commonly forgotten charges. Returns
 * [{ level: 'warn'|'info', msg }] — 'warn' = probably a mistake,
 * 'info' = double-check. Pure function; pricing carries the per-quote scalars
 * ({ materialMarkupPct, laborMarkupPct, taxPct, deliveryMiles, discountPct }).
 */
export function deriveWarnings(type, state, lineState, pricing) {
  const s = state || {};
  const ls = lineState || { items: [], labor: {}, install: {} };
  const p = pricing || {};
  const out = [];
  const warn = (msg) => out.push({ level: 'warn', msg });
  const info = (msg) => out.push({ level: 'info', msg });
  const has = (key) => ls.items.some((it) => it.key === key && lineCost(it) > 0);

  const metalSet = type === 'fence' || type === 'gate';
  const embedded = metalSet || s.anchor === 'embedded';

  // Posts & concrete
  if (embedded && !(num(s.undergroundFt, 3) > 0) && ls.items.some((it) => it.key === 'posts')) {
    warn('Posts have no underground length — the +3 ft rule is off.');
  }
  if (embedded && ls.items.some((it) => it.key === 'posts') && !has('concrete')) {
    warn('No concrete charged — posts are set without bags on this quote.');
  }

  // Hardware
  if (type === 'gate' && !has('hardware')) warn('No gate hardware set on this quote.');
  if (type === 'gate' && s.type === 'slide' && s.operator !== 'one' && s.operator !== 'two') {
    info('Sliding gate without an operator kit — manual slide intended?');
  }
  if (type === 'gate' && s.type === 'double' && s.extraPosts !== 'yes') {
    info('Double swing without the 2 extra support posts — is the existing structure carrying it?');
  }

  // Labor
  if (!(Number(ls.labor?.hours) > 0) || !(Number(ls.labor?.rate) > 0)) {
    warn('No shop fabrication labor on this quote.');
  }
  if (!(Number(ls.install?.hours) > 0) || !(Number(ls.install?.rate) > 0)) {
    warn('No installation labor on this quote.');
  }

  // Money knobs
  if (!(Number(p.materialMarkupPct) > 0) && !(Number(p.laborMarkupPct) > 0)) {
    warn('Markup is 0% — this quote is at cost.');
  }
  if (!(Number(p.taxPct) > 0)) info('Sales tax is off for this quote.');
  if (!(Number(p.deliveryMiles) > 0)) info('No delivery / travel charge.');
  if (Number(p.discountPct) >= 15) info(`Discount is ${p.discountPct}% — double-check the margin.`);

  // Finish
  if (s.color === '#8A8A85' && (!s.coating || s.coating === 'standard')) {
    info('Raw steel with the standard finish — no coating charged.');
  }

  // Product-specific nudges
  if (type === 'fence') {
    info('Does this fence need a gate? Quote it as a separate Gate quote.');
    if (!(num(s.demoFt, 0) > 0)) info('Old fence removal not included.');
  }
  if (type === 'gate' && s.demoOld !== 'yes') info('Old gate removal not included.');

  return out;
}
