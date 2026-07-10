// =============================================================================
//  Price book — the single, owner-editable source of rates.
//
//  The configurator turns a design into quantities; the price book turns those
//  quantities into money. Every rate here is editable in the Price Book screen
//  and persists locally. Each line the estimate produces is ALSO editable per
//  quote (overrides), so the book is a smart starting point, never a cage.
//
//  All money is USD. "per sq ft" rates are applied to a face/plan area; labor is
//  in hours and multiplied by the global labor rate.
// =============================================================================

export const DEFAULT_PRICE_BOOK = {
  // Global
  // Markup is split so materials and labor can carry different margins.
  // Both default to 35% (the old single markup) so existing quotes don't move —
  // set labor markup to 0 if your hourly rate already includes profit.
  materialMarkupPct: 35,
  laborMarkupPct: 35,
  taxPct: 8.25,
  laborRatePerHour: 65,

  // Consumables (welding wire, gas, grinding/cut discs, primer/paint, fasteners)
  // as a percentage of material cost — they scale with how much you build.
  // Default 0 → set it so every job recovers its shop consumables.
  consumablesPct: 0,

  // Delivery, per mile (round trip is your call — bake it into the rate or the
  // miles). Default 0 → set it so delivered jobs recover fuel + truck time.
  deliveryPerMile: 0,

  // Frame-finish upcharge, per sq ft of visible face. Matte Black is standard ($0).
  finishUpchargePerSqFt: {
    '#0A0A0A': 0,    // Matte Black (standard)
    '#5C4A3A': 2.5,  // Bronze
    '#8A8A85': 1,    // Raw Steel
    '#E8E6E0': 0,    // White (railing only) — default 0, set if powder-coat white costs extra
  },

  fence: {
    panelPerSqFt: { 'horizontal-slat': 14, 'wood-mesh': 18 },
    // Posts are priced per linear foot of post (post count × fence height).
    // Default 0 → set this so taller fences correctly cost more in post steel.
    postPricePerFt: 0,
    cappedUpchargePerPost: 8,
    archedUpchargePerPanel: 25,
    // Applied to the MESH portion of a wood-mesh panel face (faceArea × meshRatio%).
    // Default 0 → set this so the mesh % slider actually moves the price.
    meshUpchargePerSqFt: 0,
    laborHoursPerFt: 0.35,
  },

  gate: {
    infillPerSqFt: { 'horizontal-slat': 22, 'metal-wood': 28 },
    hardware: { single: 120, double: 220, slide: 480 },
    meshUpchargePerSqFt: 8,
    archedUpcharge: 90,
    // Flat upcharge when the gate's top edge is "capped" (mirrors fence cap).
    // Default 0 → set this so the gate's top-edge picker moves the price.
    cappedUpcharge: 0,
    // Personalization upsell from the website designer — plasma-cut initials
    // medallion, or the customer's own artwork (logo / ranch brand / silhouette).
    monogramFlat: 150,
    customArtFlat: 250,
    // Gate framing — every gate gets posts (2 × height), lateral frame
    // (2 × height) and top+bottom frame (2 × width). All by-ft, all default
    // 0 — set them so height and width move the gate price.
    postPricePerFt: 0,
    lateralFramePerFt: 0,
    topBottomFramePerFt: 0,
    laborHours: { single: 8, double: 12, slide: 16 },
  },

  carport: {
    roofPerSqFt: 9,
    panelUpchargePerSqFt: { corrugated: 0, 'standing-seam': 3.5, polycarbonate: 5 },
    // Posts priced per linear foot of post (post count × clearance).
    // Default 0 → set this so taller carports correctly cost more.
    postPricePerFt: 0,
    // Support frame (rafters, headers, purlins) per sq ft of plan footprint.
    // Separate from roof material (roofPerSqFt). Default 0 — set after you've
    // decided what's in roofPerSqFt vs the frame line.
    framePerSqFt: 0,
    sidePanelPerSqFt: 7,
    guttersPerFt: 6,
    // Per sq ft of roof, by roof-finish color. Galvalume is standard ($0).
    // Defaults 0 → set Matte Black / White if you charge an upcharge for them.
    roofFinishUpchargePerSqFt: {
      '#A7A8A4': 0, // Galvalume (standard)
      '#1C1C1A': 0, // Matte Black
      '#E9E7E1': 0, // White
    },
    laborHoursPer100SqFt: 6,
  },

  pergola: {
    // Open rafter/lattice top, per sq ft of plan footprint. Nonzero by default —
    // the website ballpark needs a real base rate to show a range at all.
    rafterPerSqFt: 7,
    // Header beams around the perimeter, per linear foot.
    beamPerFt: 16,
    // Posts per linear foot of post (post count × head clearance).
    postPricePerFt: 14,
    // Shade-panel upcharge over the open rafters, per sq ft of plan.
    shadePanelPerSqFt: 6,
    // Designer (slatted multi-bar) legs from the CJM Fusion design — extra
    // cutting + welding per post over the standard square post. Per post.
    legsDesignerPerPost: 60,
    // Side-screen variant — louvered privacy screens wrapping each post.
    // Considerably more steel + welding than designer legs. Per post.
    legsSidesPerPost: 90,
    // Hexagonal = 6 mitered corners + radial rafter fit-up; multiplies labor hours.
    hexLaborMult: 1.35,
    laborHoursPer100SqFt: 8,
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
    // Raked (stair) work costs more per foot than level runs. Default 0 → set
    // it so stair jobs correctly price above balcony runs.
    stairsUpchargePerLnFt: 0,
    // Top-rail upgrades over the standard flat bar, per linear foot.
    toprailUpchargePerLnFt: { round: 0, wood: 12 },
    // Side/fascia mounting hardware, per post (posts ≈ every 6 ft + 1).
    // Default 0 → set it if fascia brackets/standoffs cost you extra.
    fasciaMountPerPost: 0,
    laborHoursPerFt: 0.5,
  },
};

// Editor layout: groups of editable scalar fields. `path` is a dot-path into the
// price book; prefix/suffix decorate the input (e.g. "$" … "/ sq ft").
export const PRICE_BOOK_SCHEMA = [
  {
    title: 'Global',
    note: 'Applied to every quote. Overridable per quote.',
    fields: [
      { path: 'materialMarkupPct', label: 'Material markup', suffix: '%', step: 1 },
      { path: 'laborMarkupPct', label: 'Labor markup', suffix: '%', step: 1 },
      { path: 'taxPct', label: 'Sales tax', suffix: '%', step: 0.01 },
      { path: 'laborRatePerHour', label: 'Labor rate', prefix: '$', suffix: '/ hr', step: 1 },
      { path: 'consumablesPct', label: 'Consumables (of material)', suffix: '%', step: 1 },
      { path: 'deliveryPerMile', label: 'Delivery', prefix: '$', suffix: '/ mile', step: 0.5 },
    ],
  },
  {
    title: 'Finish upcharge',
    note: 'Per sq ft of visible face. Matte Black is standard.',
    fields: [
      { path: 'finishUpchargePerSqFt.#5C4A3A', label: 'Bronze', prefix: '$', suffix: '/ sq ft', step: 0.25 },
      { path: 'finishUpchargePerSqFt.#8A8A85', label: 'Raw Steel', prefix: '$', suffix: '/ sq ft', step: 0.25 },
      { path: 'finishUpchargePerSqFt.#E8E6E0', label: 'White (railing)', prefix: '$', suffix: '/ sq ft', step: 0.25 },
    ],
  },
  {
    title: 'Fence',
    fields: [
      { path: 'fence.panelPerSqFt.horizontal-slat', label: 'Horizontal-slat panel', prefix: '$', suffix: '/ sq ft', step: 0.5 },
      { path: 'fence.panelPerSqFt.wood-mesh', label: 'Wood + mesh panel', prefix: '$', suffix: '/ sq ft', step: 0.5 },
      { path: 'fence.postPricePerFt', label: 'Posts', prefix: '$', suffix: '/ ft of post', step: 1 },
      { path: 'fence.cappedUpchargePerPost', label: 'Capped top', prefix: '$', suffix: '/ post', step: 1 },
      { path: 'fence.archedUpchargePerPanel', label: 'Arched profile', prefix: '$', suffix: '/ panel', step: 1 },
      { path: 'fence.meshUpchargePerSqFt', label: 'Wood-mesh — mesh upcharge', prefix: '$', suffix: '/ sq ft', step: 0.5 },
      { path: 'fence.laborHoursPerFt', label: 'Labor', suffix: 'hrs / ft', step: 0.05 },
    ],
  },
  {
    title: 'Gate',
    fields: [
      { path: 'gate.infillPerSqFt.horizontal-slat', label: 'Slat infill', prefix: '$', suffix: '/ sq ft', step: 0.5 },
      { path: 'gate.infillPerSqFt.metal-wood', label: 'Metal + wood infill', prefix: '$', suffix: '/ sq ft', step: 0.5 },
      { path: 'gate.hardware.single', label: 'Single-swing hardware', prefix: '$', step: 5 },
      { path: 'gate.hardware.double', label: 'Double-swing hardware', prefix: '$', step: 5 },
      { path: 'gate.hardware.slide', label: 'Sliding gear + track', prefix: '$', step: 5 },
      { path: 'gate.meshUpchargePerSqFt', label: 'Mesh upgrade', prefix: '$', suffix: '/ sq ft', step: 0.5 },
      { path: 'gate.archedUpcharge', label: 'Arched top', prefix: '$', step: 5 },
      { path: 'gate.cappedUpcharge', label: 'Capped top edge', prefix: '$', step: 5 },
      { path: 'gate.monogramFlat', label: 'Monogram initials (plasma-cut)', prefix: '$', step: 5 },
      { path: 'gate.customArtFlat', label: 'Custom plasma-cut artwork', prefix: '$', step: 5 },
      { path: 'gate.postPricePerFt', label: 'Posts', prefix: '$', suffix: '/ ft of post', step: 1 },
      { path: 'gate.lateralFramePerFt', label: 'Lateral frame', prefix: '$', suffix: '/ ft', step: 1 },
      { path: 'gate.topBottomFramePerFt', label: 'Top & bottom frame', prefix: '$', suffix: '/ ft', step: 1 },
      { path: 'gate.laborHours.single', label: 'Labor — single', suffix: 'hrs', step: 0.5 },
      { path: 'gate.laborHours.double', label: 'Labor — double', suffix: 'hrs', step: 0.5 },
      { path: 'gate.laborHours.slide', label: 'Labor — sliding', suffix: 'hrs', step: 0.5 },
    ],
  },
  {
    title: 'Carport',
    fields: [
      { path: 'carport.roofPerSqFt', label: 'Roof base', prefix: '$', suffix: '/ sq ft', step: 0.5 },
      { path: 'carport.panelUpchargePerSqFt.standing-seam', label: 'Standing-seam panel', prefix: '$', suffix: '/ sq ft', step: 0.5 },
      { path: 'carport.panelUpchargePerSqFt.polycarbonate', label: 'Polycarbonate panel', prefix: '$', suffix: '/ sq ft', step: 0.5 },
      { path: 'carport.postPricePerFt', label: 'Posts', prefix: '$', suffix: '/ ft of post', step: 1 },
      { path: 'carport.framePerSqFt', label: 'Support frame (rafters/headers)', prefix: '$', suffix: '/ sq ft of plan', step: 0.5 },
      { path: 'carport.sidePanelPerSqFt', label: 'Enclosed side', prefix: '$', suffix: '/ sq ft', step: 0.5 },
      { path: 'carport.guttersPerFt', label: 'Gutters', prefix: '$', suffix: '/ ft', step: 0.5 },
      { path: 'carport.roofFinishUpchargePerSqFt.#1C1C1A', label: 'Roof finish — Matte Black', prefix: '$', suffix: '/ sq ft', step: 0.25 },
      { path: 'carport.roofFinishUpchargePerSqFt.#E9E7E1', label: 'Roof finish — White', prefix: '$', suffix: '/ sq ft', step: 0.25 },
      { path: 'carport.laborHoursPer100SqFt', label: 'Labor', suffix: 'hrs / 100 sq ft', step: 0.5 },
    ],
  },
  {
    title: 'Pergola',
    note: 'Plan-footprint rates. Hexagonal jobs multiply labor by the hex factor.',
    fields: [
      { path: 'pergola.rafterPerSqFt', label: 'Rafter grid', prefix: '$', suffix: '/ sq ft of plan', step: 0.5 },
      { path: 'pergola.beamPerFt', label: 'Header beams', prefix: '$', suffix: '/ ft', step: 1 },
      { path: 'pergola.postPricePerFt', label: 'Posts', prefix: '$', suffix: '/ ft of post', step: 1 },
      { path: 'pergola.legsDesignerPerPost', label: 'Designer legs upcharge', prefix: '$', suffix: '/ post', step: 5 },
      { path: 'pergola.legsSidesPerPost', label: 'Side screens upcharge', prefix: '$', suffix: '/ post', step: 5 },
      { path: 'pergola.shadePanelPerSqFt', label: 'Shade panels', prefix: '$', suffix: '/ sq ft', step: 0.5 },
      { path: 'pergola.hexLaborMult', label: 'Hexagonal labor multiplier', suffix: '×', step: 0.05 },
      { path: 'pergola.laborHoursPer100SqFt', label: 'Labor', suffix: 'hrs / 100 sq ft', step: 0.5 },
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
      { path: 'railing.laborHoursPerFt', label: 'Labor', suffix: 'hrs / ft', step: 0.05 },
    ],
  },
];
