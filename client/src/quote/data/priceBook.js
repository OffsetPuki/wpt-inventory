// =============================================================================
//  Price book — the single, owner-editable source of rates.
//
//  Two layers:
//
//  1. MATERIALS — the shared material library. One price per physical material
//     (4×4×3/16 tubing, concrete bag, mesh...). Every product formula pulls
//     from here, so changing a material price reprices every product that uses
//     it — fences, gates, pergolas, the website ballpark, all at once.
//     Each material carries its own waste % (blended into the effective rate).
//
//  2. PRODUCT RATES — per-product fabrication rates and upcharges that are NOT
//     a raw material (arched-top fabrication, designer-leg welding, roof rates).
//
//  The configurator turns a design into material QUANTITIES via the shop-math
//  formulas in lib/estimate.js; this book turns quantities into money. Every
//  line the estimate produces is ALSO editable per quote (overrides), so the
//  book is a smart starting point, never a cage.
//
//  ⚠ SEEDED PRICES ARE PLACEHOLDER ESTIMATES (2026) — set your real supplier
//  prices in Settings → Price book. All money is USD.
// =============================================================================

// Pricing methods a material can use. `kind` maps to the estimate line kinds.
export const MATERIAL_UNITS = {
  ft:    { kind: 'length', suffix: '/ ft' },      // price per linear foot
  sqft:  { kind: 'area',   suffix: '/ sq ft' },   // price per square foot
  piece: { kind: 'unit',   suffix: '/ piece' },   // price per piece
  bag:   { kind: 'unit',   suffix: '/ bag' },     // price per bag
  set:   { kind: 'unit',   suffix: '/ set' },     // price per hardware set
};

export const DEFAULT_PRICE_BOOK = {
  // ── Shared material library ────────────────────────────────────────────────
  // One entry per physical material. `cost` is what YOU pay per unit;
  // `wastePct` is blended into the effective rate (cutoffs, drops, spoilage).
  materials: {
    tube_4x4_316: { name: '4×4×3/16 steel tubing', unit: 'ft',   cost: 12,   wastePct: 10 },
    tube_6x6:     { name: '6×6 steel tubing',       unit: 'ft',   cost: 21,   wastePct: 10 },
    tube_1x1:     { name: '1×1 square tubing',      unit: 'ft',   cost: 2.5,  wastePct: 10 },
    tube_2x2:     { name: '2×2 square tubing',      unit: 'ft',   cost: 4.5,  wastePct: 10 },
    tube_4x1:     { name: '4×1 rectangular tubing', unit: 'ft',   cost: 5,    wastePct: 10 },
    tube_4x2:     { name: '4×2 rectangular tubing', unit: 'ft',   cost: 6.5,  wastePct: 10 },
    wood_4x1:     { name: '4×1 wood board',         unit: 'ft',   cost: 1.75, wastePct: 10 },
    mesh:         { name: 'Metal mesh',             unit: 'sqft', cost: 2.5,  wastePct: 5 },
    corrugated_panel: { name: 'Corrugated metal panel', unit: 'sqft', cost: 3.5, wastePct: 8 },
    concrete_bag: { name: 'Concrete (80 lb bag)',   unit: 'bag',  cost: 7,    wastePct: 0 },
    hw_single:    { name: 'Single-swing hardware set',           unit: 'set', cost: 125,  wastePct: 0 },
    hw_double:    { name: 'Double-swing hardware set',           unit: 'set', cost: 250,  wastePct: 0 },
    hw_slide:     { name: 'Sliding hardware set (track, rollers, catcher)', unit: 'set', cost: 550, wastePct: 0 },
    hw_operator:  { name: 'Gate operator kit (motor + safety)', unit: 'set', cost: 1900, wastePct: 0 },
  },

  // ── Global ─────────────────────────────────────────────────────────────────
  // Markup is split so materials and labor can carry different margins.
  materialMarkupPct: 35,
  laborMarkupPct: 35,
  taxPct: 8.25,
  laborRatePerHour: 65,        // shop fabrication $/hr
  installRatePerHour: 55,      // on-site installation $/hr

  // Small jobs still cost a truck roll + setup. 0 disables the floor.
  minJobCharge: 500,

  // Consumables (welding wire, gas, grinding/cut discs, primer/paint, fasteners)
  // as a percentage of material cost — they scale with how much you build.
  consumablesPct: 5,

  // Delivery, per mile (round trip is your call — bake it into the rate or the
  // miles).
  deliveryPerMile: 2,

  // Haul-off / dump fee added once whenever a quote includes demo of an old
  // fence or gate.
  dumpFeeFlat: 150,

  // Coating system upcharge, per sq ft of visible face. Standard shop finish
  // (paint over prep) is the $0 baseline.
  coatingUpchargePerSqFt: {
    standard: 0,
    powder: 4,      // powder coat
    galvanized: 3,  // hot-dip galvanized
  },

  // Frame-finish COLOR upcharge, per sq ft of visible face. Matte Black is standard ($0).
  finishUpchargePerSqFt: {
    '#0A0A0A': 0,    // Matte Black (standard)
    '#5C4A3A': 2.5,  // Bronze
    '#8A8A85': 1,    // Raw Steel
    '#E8E6E0': 0,    // White (railing only) — default 0, set if powder-coat white costs extra
  },

  fence: {
    cappedUpchargePerPost: 8,
    archedUpchargePerPanel: 25,
    demoPerFt: 6,                // tear-out of the old fence, $/ft (dump fee added separately)
    laborHoursPerFt: 0.2,        // shop fabrication
    installHoursPerFt: 0.15,     // on-site install (dig, set, hang)
  },

  gate: {
    archedUpcharge: 90,
    // Flat upcharge when the gate's top edge is "capped" (mirrors fence cap).
    cappedUpcharge: 25,
    // Personalization upsell from the website designer — laser-cut initials
    // medallion, or the customer's own artwork (logo / ranch brand / silhouette).
    monogramFlat: 150,
    customArtFlat: 250,
    demoFlat: 75,                // remove old gate (dump fee added separately)
    laborHours: { single: 8, double: 12, slide: 16 },      // shop fabrication
    installHours: { single: 3, double: 5, slide: 8 },      // on-site install
  },

  carport: {
    roofPerSqFt: 9,
    panelUpchargePerSqFt: { corrugated: 0, 'standing-seam': 3.5, polycarbonate: 5 },
    // Support frame (rafters, headers, purlins) per sq ft of plan footprint.
    // Separate from roof material (roofPerSqFt). Columns are 4×4×3/16 from
    // the material library.
    framePerSqFt: 3,
    sidePanelPerSqFt: 7,
    guttersPerFt: 6,
    // Per sq ft of roof, by roof-finish color. Galvalume is standard ($0).
    roofFinishUpchargePerSqFt: {
      '#A7A8A4': 0, // Galvalume (standard)
      '#1C1C1A': 0, // Matte Black
      '#E9E7E1': 0, // White
    },
    laborHoursPer100SqFt: 4,       // shop fabrication
    installHoursPer100SqFt: 3,     // on-site install
  },

  pergola: {
    // Open rafter/lattice top, per sq ft of plan footprint — the "frame charged
    // by square foot" rule. Posts + decorative pieces come from the material
    // library (4×4×3/16 and 1×1).
    rafterPerSqFt: 7,
    // Header beams around the perimeter, per linear foot.
    beamPerFt: 16,
    // Shade-panel upcharge over the open rafters, per sq ft of plan.
    shadePanelPerSqFt: 6,
    // Designer / side-screen legs FABRICATION upcharge per post — the extra
    // cutting + welding. The 1×1 steel itself is a material line (5 pieces per
    // leg designer, 12 per leg side screens).
    legsDesignerPerPost: 60,
    legsSidesPerPost: 90,
    laborHoursPer100SqFt: 5,       // shop fabrication
    installHoursPer100SqFt: 3,     // on-site install
  },

  railing: {
    // Base railing, per linear foot of run, by infill style. These carry the
    // posts/rails/infill for a standard-height run; height nudges are per-quote.
    railPerLnFt: {
      pickets: 85,
      horizontal: 95,
      cable: 110,
      glass: 140,
      ornamental: 130,
    },
    // Wall handrail is its own animal (rail + brackets, no infill).
    handrailPerLnFt: 45,
    // Raked (stair) work costs more per foot than level runs.
    stairsUpchargePerLnFt: 15,
    // Top-rail upgrades over the standard flat bar, per linear foot.
    toprailUpchargePerLnFt: { round: 0, wood: 12 },
    // Side/fascia mounting hardware, per post (posts ≈ every 6 ft + 1).
    fasciaMountPerPost: 12,
    laborHoursPerFt: 0.3,        // shop fabrication
    installHoursPerFt: 0.2,      // on-site install
  },
};

// Editor layout: groups of editable scalar fields. `path` is a dot-path into the
// price book; prefix/suffix decorate the input (e.g. "$" … "/ sq ft").
// The Materials group is rendered separately (see PriceBookPanel) from
// DEFAULT_PRICE_BOOK.materials — it isn't listed here.
export const PRICE_BOOK_SCHEMA = [
  {
    title: 'Global',
    note: 'Applied to every quote. Overridable per quote.',
    fields: [
      { path: 'materialMarkupPct', label: 'Material markup', suffix: '%', step: 1 },
      { path: 'laborMarkupPct', label: 'Labor markup', suffix: '%', step: 1 },
      { path: 'taxPct', label: 'Sales tax', suffix: '%', step: 0.01 },
      { path: 'laborRatePerHour', label: 'Shop labor rate', prefix: '$', suffix: '/ hr', step: 1 },
      { path: 'installRatePerHour', label: 'Install labor rate', prefix: '$', suffix: '/ hr', step: 1 },
      { path: 'minJobCharge', label: 'Minimum job charge', prefix: '$', step: 25 },
      { path: 'consumablesPct', label: 'Consumables (of material)', suffix: '%', step: 1 },
      { path: 'deliveryPerMile', label: 'Delivery', prefix: '$', suffix: '/ mile', step: 0.5 },
      { path: 'dumpFeeFlat', label: 'Dump / haul-off fee', prefix: '$', step: 5 },
    ],
  },
  {
    title: 'Coating & finish upcharge',
    note: 'Per sq ft of visible face. Standard shop finish / Matte Black are the $0 baseline.',
    fields: [
      { path: 'coatingUpchargePerSqFt.powder', label: 'Powder coat', prefix: '$', suffix: '/ sq ft', step: 0.25 },
      { path: 'coatingUpchargePerSqFt.galvanized', label: 'Galvanized', prefix: '$', suffix: '/ sq ft', step: 0.25 },
      { path: 'finishUpchargePerSqFt.#5C4A3A', label: 'Bronze color', prefix: '$', suffix: '/ sq ft', step: 0.25 },
      { path: 'finishUpchargePerSqFt.#8A8A85', label: 'Raw Steel color', prefix: '$', suffix: '/ sq ft', step: 0.25 },
      { path: 'finishUpchargePerSqFt.#E8E6E0', label: 'White (railing)', prefix: '$', suffix: '/ sq ft', step: 0.25 },
    ],
  },
  {
    title: 'Fence',
    note: 'Posts, slats, rails, mesh, wood and concrete all price from the material library.',
    fields: [
      { path: 'fence.cappedUpchargePerPost', label: 'Capped top', prefix: '$', suffix: '/ post', step: 1 },
      { path: 'fence.archedUpchargePerPanel', label: 'Arched profile', prefix: '$', suffix: '/ panel', step: 1 },
      { path: 'fence.demoPerFt', label: 'Old fence removal', prefix: '$', suffix: '/ ft', step: 0.5 },
      { path: 'fence.laborHoursPerFt', label: 'Shop labor', suffix: 'hrs / ft', step: 0.05 },
      { path: 'fence.installHoursPerFt', label: 'Install labor', suffix: 'hrs / ft', step: 0.05 },
    ],
  },
  {
    title: 'Gate',
    note: 'Frame + slats are 4×4×3/16, support posts 6×6, hardware sets — all from the material library.',
    fields: [
      { path: 'gate.archedUpcharge', label: 'Arched top', prefix: '$', step: 5 },
      { path: 'gate.cappedUpcharge', label: 'Capped top edge', prefix: '$', step: 5 },
      { path: 'gate.monogramFlat', label: 'Monogram initials (laser-cut)', prefix: '$', step: 5 },
      { path: 'gate.customArtFlat', label: 'Custom laser-cut artwork', prefix: '$', step: 5 },
      { path: 'gate.demoFlat', label: 'Old gate removal', prefix: '$', step: 5 },
      { path: 'gate.laborHours.single', label: 'Shop labor — single', suffix: 'hrs', step: 0.5 },
      { path: 'gate.laborHours.double', label: 'Shop labor — double', suffix: 'hrs', step: 0.5 },
      { path: 'gate.laborHours.slide', label: 'Shop labor — sliding', suffix: 'hrs', step: 0.5 },
      { path: 'gate.installHours.single', label: 'Install — single', suffix: 'hrs', step: 0.5 },
      { path: 'gate.installHours.double', label: 'Install — double', suffix: 'hrs', step: 0.5 },
      { path: 'gate.installHours.slide', label: 'Install — sliding', suffix: 'hrs', step: 0.5 },
    ],
  },
  {
    title: 'Carport',
    note: 'Columns price from the material library (4×4×3/16).',
    fields: [
      { path: 'carport.roofPerSqFt', label: 'Roof base', prefix: '$', suffix: '/ sq ft', step: 0.5 },
      { path: 'carport.panelUpchargePerSqFt.standing-seam', label: 'Standing-seam panel', prefix: '$', suffix: '/ sq ft', step: 0.5 },
      { path: 'carport.panelUpchargePerSqFt.polycarbonate', label: 'Polycarbonate panel', prefix: '$', suffix: '/ sq ft', step: 0.5 },
      { path: 'carport.framePerSqFt', label: 'Support frame (rafters/headers)', prefix: '$', suffix: '/ sq ft of plan', step: 0.5 },
      { path: 'carport.sidePanelPerSqFt', label: 'Enclosed side', prefix: '$', suffix: '/ sq ft', step: 0.5 },
      { path: 'carport.guttersPerFt', label: 'Gutters', prefix: '$', suffix: '/ ft', step: 0.5 },
      { path: 'carport.roofFinishUpchargePerSqFt.#1C1C1A', label: 'Roof finish — Matte Black', prefix: '$', suffix: '/ sq ft', step: 0.25 },
      { path: 'carport.roofFinishUpchargePerSqFt.#E9E7E1', label: 'Roof finish — White', prefix: '$', suffix: '/ sq ft', step: 0.25 },
      { path: 'carport.laborHoursPer100SqFt', label: 'Shop labor', suffix: 'hrs / 100 sq ft', step: 0.5 },
      { path: 'carport.installHoursPer100SqFt', label: 'Install labor', suffix: 'hrs / 100 sq ft', step: 0.5 },
    ],
  },
  {
    title: 'Pergola',
    note: 'Posts (4×4×3/16) and decorative pieces (1×1) price from the material library. Plan-footprint rates.',
    fields: [
      { path: 'pergola.rafterPerSqFt', label: 'Rafter grid / frame', prefix: '$', suffix: '/ sq ft of plan', step: 0.5 },
      { path: 'pergola.beamPerFt', label: 'Header beams', prefix: '$', suffix: '/ ft', step: 1 },
      { path: 'pergola.legsDesignerPerPost', label: 'Designer legs fabrication', prefix: '$', suffix: '/ post', step: 5 },
      { path: 'pergola.legsSidesPerPost', label: 'Side screens fabrication', prefix: '$', suffix: '/ post', step: 5 },
      { path: 'pergola.shadePanelPerSqFt', label: 'Shade panels', prefix: '$', suffix: '/ sq ft', step: 0.5 },
      { path: 'pergola.laborHoursPer100SqFt', label: 'Shop labor', suffix: 'hrs / 100 sq ft', step: 0.5 },
      { path: 'pergola.installHoursPer100SqFt', label: 'Install labor', suffix: 'hrs / 100 sq ft', step: 0.5 },
    ],
  },
  {
    title: 'Railing',
    note: 'Base rates are per linear foot of run and include posts, rails and infill.',
    fields: [
      { path: 'railing.railPerLnFt.pickets', label: 'Pickets', prefix: '$', suffix: '/ ln ft', step: 1 },
      { path: 'railing.railPerLnFt.horizontal', label: 'Horizontal bars', prefix: '$', suffix: '/ ln ft', step: 1 },
      { path: 'railing.railPerLnFt.cable', label: 'Cable-look', prefix: '$', suffix: '/ ln ft', step: 1 },
      { path: 'railing.railPerLnFt.glass', label: 'Glass panels', prefix: '$', suffix: '/ ln ft', step: 1 },
      { path: 'railing.railPerLnFt.ornamental', label: 'Ornamental', prefix: '$', suffix: '/ ln ft', step: 1 },
      { path: 'railing.handrailPerLnFt', label: 'Wall handrail', prefix: '$', suffix: '/ ln ft', step: 1 },
      { path: 'railing.stairsUpchargePerLnFt', label: 'Stair (raked) upcharge', prefix: '$', suffix: '/ ln ft', step: 1 },
      { path: 'railing.toprailUpchargePerLnFt.round', label: 'Round top rail', prefix: '$', suffix: '/ ln ft', step: 1 },
      { path: 'railing.toprailUpchargePerLnFt.wood', label: 'Wood-cap top rail', prefix: '$', suffix: '/ ln ft', step: 1 },
      { path: 'railing.fasciaMountPerPost', label: 'Fascia mount', prefix: '$', suffix: '/ post', step: 1 },
      { path: 'railing.laborHoursPerFt', label: 'Shop labor', suffix: 'hrs / ft', step: 0.05 },
      { path: 'railing.installHoursPerFt', label: 'Install labor', suffix: 'hrs / ft', step: 0.05 },
    ],
  },
];
