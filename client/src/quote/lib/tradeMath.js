// =============================================================================
//  Trade math — concrete + insulation quantity formulas, ported verbatim from
//  the sister sites' single-source-of-math modules:
//    CJM-Concrete/src/lib/estimate.mjs   (yards, rebar grid, control joints)
//    CJM-Insulation/src/lib/estimate.mjs (pipe/tank/autoclave/blanket areas)
//
//  Lives in its own module because data/configurators.js (spec rows),
//  lib/estimate.js (line items) and lib/preview/* (drawings) all need the same
//  numbers, and estimate.js already imports configurators.js — a shared leaf
//  module keeps the graph acyclic. Pure JS, imported by the server too.
// =============================================================================

// ── Concrete ─────────────────────────────────────────────────────────────────

/** 80 lb bag of mix yields ~0.6 cu ft, so 27 / 0.6 = 45 bags per cubic yard. */
export const BAGS_PER_YARD = 45;

/** A full ready-mix truck. Most DFW plants charge a short-load fee under ~4 yd. */
export const TRUCK_YARDS = 10;
export const SHORT_LOAD_YARDS = 4;

/** Square feet of a rectangular pour. */
export function areaSqft(lengthFt, widthFt) {
  return Math.max(0, lengthFt) * Math.max(0, widthFt);
}

/**
 * Cubic yards of mix, including waste. Ordering the exact calculated volume is
 * how a pour ends 40 minutes short of the far corner — 10% covers subgrade
 * dips, spillage and over-excavation. (Same rule as the website calculator.)
 */
export function cubicYards(area, thicknessIn, wastePct = 10) {
  const cuFt = area * (thicknessIn / 12);
  return (cuFt / 27) * (1 + wastePct / 100);
}

/** Bagged mix equivalent. */
export function bags80(cuYd) {
  return Math.ceil(cuYd * BAGS_PER_YARD);
}

/** Ready-mix trucks needed, and whether the load is small enough to draw a fee. */
export function trucks(cuYd) {
  return { loads: Math.max(1, Math.ceil(cuYd / TRUCK_YARDS)), shortLoad: cuYd < SHORT_LOAD_YARDS };
}

/**
 * Rebar grid spacing by slab thickness — the website's rule: 12" on centre once
 * the slab is 5" or thicker (truck / RV / shop slabs), 18" for 4" flatwork.
 */
export function rebarGridIn(thicknessIn) {
  return thicknessIn >= 5 ? 12 : 18;
}

/**
 * Linear feet of rebar for a grid at `spacingIn` on centre, both directions.
 * Bars run the full length in one direction and the full width in the other.
 */
export function rebarFeet(lengthFt, widthFt, spacingIn = 18) {
  if (lengthFt <= 0 || widthFt <= 0) return 0;
  const step = spacingIn / 12;
  const alongLength = Math.floor(widthFt / step) + 1;
  const alongWidth = Math.floor(lengthFt / step) + 1;
  return Math.round(alongLength * lengthFt + alongWidth * widthFt);
}

/**
 * Control-joint spacing. Rule of thumb: 2–3× the slab thickness in inches,
 * read as feet, never more than ~15 ft; near-square panels on narrow pours.
 */
export function jointSpacingFt(thicknessIn, narrowFt = Infinity) {
  let min = Math.min(thicknessIn * 2, 12);
  let max = Math.min(Math.round(thicknessIn * 2.5), 15);
  if (narrowFt > 0 && narrowFt < min) {
    min = Math.round(narrowFt);
    max = Math.min(max, Math.round(narrowFt * 1.25));
  }
  return { min, max };
}

/** How many equal panels one dimension is cut into. */
export function panelCount(dimFt, maxSpacingFt) {
  if (!(dimFt > 0) || !(maxSpacingFt > 0)) return 1;
  // The epsilon keeps an exact fit (30 ft at 10 ft) from rounding up on a
  // floating-point hair.
  return Math.max(1, Math.ceil(dimFt / maxSpacingFt - 1e-9));
}

/**
 * Where the control joints fall along one dimension — the slab is cut into
 * EQUAL panels, as few as possible without any exceeding `maxSpacingFt`.
 */
export function jointOffsets(dimFt, maxSpacingFt) {
  const n = panelCount(dimFt, maxSpacingFt);
  if (n < 2) return [];
  const panel = dimFt / n;
  return Array.from({ length: n - 1 }, (_, i) => (i + 1) * panel);
}

// ── Insulation ───────────────────────────────────────────────────────────────

/** Nominal pipe size → outside diameter, inches (ASME B36.10). */
export const PIPE_OD = {
  '1': 1.315,
  '2': 2.375,
  '3': 3.5,
  '4': 4.5,
  '6': 6.625,
  '8': 8.625,
  '12': 12.75,
};

/**
 * One bare valve or flange pair loses about as much as this many feet of bare
 * pipe of the same size — the classic survey rule the blanket geometry uses.
 */
export const BLANKET_EQUIV_FT = {
  '1': 3, '2': 3, '3': 3.5, '4': 4, '6': 4.5, '8': 5, '12': 6,
};

/**
 * Own-key lookup with a fallback — these keys can arrive from URLs/leads, and
 * 'constructor' resolves through Object.prototype to truthy junk otherwise.
 */
const own = (obj, key, fallback) =>
  (Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : fallback);

/**
 * Bare and finished (jacketed) areas of each system, sq ft — ported from the
 * insulation site's areas(). For tank/autoclave pass the SHELL length as
 * `lengthFt` (the suite state calls it heightFt; the caller maps it).
 */
export function insulationAreas(input) {
  const { system, lengthFt = 0, diaFt = 0, nps = '4', thickness = 2, count = 0 } = input;
  if (system === 'pipe' || system === 'blanket') {
    const od = own(PIPE_OD, nps, PIPE_OD['4']);
    const bare = (Math.PI * od / 12)
      * (system === 'pipe' ? lengthFt : own(BLANKET_EQUIV_FT, nps, BLANKET_EQUIV_FT['4']) * count);
    const finished = system === 'pipe'
      ? (Math.PI * (od + 2 * thickness) / 12) * lengthFt
      : bare * 1.3;
    return { bare, finished };
  }
  // tank: shell + top head; autoclave: shell + both heads (door and back).
  const heads = system === 'autoclave' ? 2 : 1;
  const bare = Math.PI * diaFt * lengthFt + heads * (Math.PI / 4) * diaFt * diaFt;
  return { bare, finished: bare * 1.05 };
}

/**
 * The MINIMUM insulation thickness at a line temperature — the conservative end
 * of common mechanical-insulation practice (site's recommendThickness).
 */
export function recommendThickness(tempF) {
  if (tempF <= 200) return 1.5;
  if (tempF <= 350) return 2;
  if (tempF <= 600) return 3;
  return 4;
}

/** Max service temperature per insulation material (site's MATERIALS table). */
export const MATERIAL_MAX_TEMP_F = {
  fiberglass: 850,
  mineralwool: 1200,
  calsil: 1200,
  aerogel: 1200,
};
